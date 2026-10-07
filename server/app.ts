import { getRequestListener } from '@hono/node-server';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApiResponse } from '../shared/contracts.js';
import { assertActive, authenticateRequest, type Actor } from './auth/authenticate.js';
import { ConfigurationError, getEnv } from './config/env.js';
import { healthCheck } from './health.js';
import { AppError } from './http/errors.js';
import { enforce, ipBuckets, type BucketResult } from './http/rateLimit.js';
import type { ApiRequest, HttpMethod, RouteDef } from './http/types.js';
import { routes } from './routes.js';

export const API_PREFIX = '/api/v1';
const MAX_BODY_BYTES = 1_000_000;

type Env = { Variables: { requestId: string; actor?: Actor; db?: SupabaseClient } };

// ---------------------------------------------------------------------------
// App + global middleware
// ---------------------------------------------------------------------------
export const app = new Hono<Env>().basePath(API_PREFIX);

app.use('*', requestId());
app.use('*', accessLog());
app.use('*', secureHeaders({ crossOriginResourcePolicy: 'same-site' }));
app.use(
  '*',
  cors({
    // Same-origin calls need no CORS; only explicitly allowed origins get headers.
    origin: origin => (allowedOrigins().includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type'],
    exposeHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
    maxAge: 600
  })
);
app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});
app.use(
  '*',
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: () => {
      throw new AppError('VALIDATION_ERROR', 'Request body is too large.');
    }
  })
);
// Layer 1: coarse per-IP flood protection before any auth work.
app.use('*', async (c, next) => {
  if (c.req.method !== 'OPTIONS') await enforce(ipBuckets(clientIp(c)), 'memory');
  await next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/health', async c => c.json(ok(await healthCheck())));

for (const route of routes) {
  app.on(route.method, route.path, authenticated(route), adapt(route));
}

const routeMatchers = routes.map(r => new RegExp(`^${r.path.replace(/:[^/]+/g, '[^/]+')}$`));

app.notFound(c => {
  const path = relativePath(c);
  const known = path === '/health' || routeMatchers.some(rx => rx.test(path));
  return fail(c, known ? new AppError('METHOD_NOT_ALLOWED') : new AppError('NOT_FOUND', 'Unknown API route.'));
});

app.onError((err, c) => {
  if (err instanceof AppError) return fail(c, err);
  if (err instanceof ConfigurationError) {
    log('error', 'configuration error', c, { message: err.message });
    return fail(c, new AppError('SERVICE_UNAVAILABLE'));
  }
  if (err instanceof HTTPException) {
    return fail(c, new AppError(err.status === 413 ? 'VALIDATION_ERROR' : 'INTERNAL', err.status === 413 ? 'Request body is too large.' : undefined));
  }
  log('error', 'unhandled error', c, { message: (err as Error)?.message, stack: (err as Error)?.stack });
  return fail(c, new AppError('INTERNAL'));
});

// ---------------------------------------------------------------------------
// Route middleware
// ---------------------------------------------------------------------------
/**
 * Verify the token, load the profile and consume the per-user quota (one
 * database round trip), then require ACTIVE unless the route allows otherwise.
 */
function authenticated(route: RouteDef): MiddlewareHandler<Env> {
  return async (c, next) => {
    const { actor, db, limit } = await authenticateRequest(c.req.header('authorization'), route.options?.rate || 'default');
    setRateHeaders(c, limit);
    if (!route.options?.allowInactive) assertActive(actor);
    c.set('actor', actor);
    c.set('db', db);
    await next();
  };
}

/** Bridge Hono's context to the framework-independent controllers. */
function adapt(route: RouteDef) {
  return async (c: Context<Env>) => {
    const request: ApiRequest = {
      method: c.req.method as HttpMethod,
      path: relativePath(c),
      query: Object.fromEntries(Object.entries(c.req.query()).filter(([k]) => k !== '__path')),
      headers: Object.fromEntries(Object.entries(c.req.header()).map(([k, v]) => [k.toLowerCase(), v])),
      body: c.req.method === 'GET' ? undefined : await readJson(c)
    };
    const result = await route.handler({ req: request, params: c.req.param() as Record<string, string>, actor: c.get('actor')!, db: c.get('db')! });
    return c.json(ok(result.data), (result.status ?? 200) as 200);
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ok = <T>(data: T): ApiResponse<T> => ({ success: true, data });

function fail(c: Context, err: AppError) {
  if (err.code === 'RATE_LIMITED') {
    const retry = (err.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
    if (retry) c.header('Retry-After', String(retry));
  }
  return c.json({ success: false, error: err.toBody() } satisfies ApiResponse<never>, err.status as 400);
}

async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON.');
  }
}

function relativePath(c: Context): string {
  const p = c.req.path;
  return p.startsWith(API_PREFIX) ? p.slice(API_PREFIX.length) || '/' : p;
}

function clientIp(c: Context): string {
  return (
    c.req.header('x-real-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function setRateHeaders(c: Context, r: BucketResult) {
  c.header('RateLimit-Limit', String(r.max_hits));
  c.header('RateLimit-Remaining', String(Math.max(0, r.max_hits - r.hits)));
  c.header('RateLimit-Reset', String(Math.max(0, Math.ceil((new Date(r.reset_at).getTime() - Date.now()) / 1000))));
}

function allowedOrigins(): string[] {
  try {
    return getEnv().allowedOrigins;
  } catch {
    return [];
  }
}

function log(level: 'info' | 'warn' | 'error', msg: string, c: Context<Env>, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, msg, requestId: c.get('requestId'), method: c.req.method, path: relativePath(c), userId: c.get('actor')?.id, ...extra });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

/** One structured log line per request (visible in Vercel → Logs). */
function accessLog(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const started = Date.now();
    await next();
    if (process.env.API_ACCESS_LOG === 'off') return;
    const status = c.res.status;
    log(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'request', c, { status, ms: Date.now() - started });
  };
}

// ---------------------------------------------------------------------------
// Node entry point (Vercel function, Vite dev middleware, tests)
// ---------------------------------------------------------------------------
/**
 * On Vercel, vercel.json rewrites /api/v1/<path> → /api/crm?__path=<path>.
 * Restore the original path so Hono routes it normally.
 */
function restoreRewrittenPath(req: Request): Request {
  const url = new URL(req.url);
  const original = url.searchParams.get('__path');
  if (original === null) return req;
  url.searchParams.delete('__path');
  url.pathname = `${API_PREFIX}/${original.replace(/^\/+/, '')}`;
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method,
    headers: req.headers,
    body: hasBody ? req.body : undefined,
    // Required by Node's fetch implementation when streaming a request body.
    ...(hasBody ? { duplex: 'half' } : {})
  } as RequestInit);
}

export const handleApiRequest = getRequestListener(req => app.fetch(restoreRewrittenPath(req)));
