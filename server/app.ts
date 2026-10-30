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
import { AppError, fromDatabaseError } from './http/errors.js';
import { parse } from './http/validate.js';
import { biometricPunchSchema, loginFailureReportSchema } from '../shared/validation.js';
import { enforce, ipBuckets, type BucketResult } from './http/rateLimit.js';
import type { ApiRequest, HttpMethod, RouteDef } from './http/types.js';
import { routes } from './routes.js';
import { automationSettings } from './automations/config.js';
import { authenticateClient, clientRouteMatchers, clientRoutes, clientServices } from './clientRoutes.js';
import { dispatchQuietly, runDispatch } from './automations/dispatcher.js';
import { runHrAutomation } from './automations/hrDispatcher.js';
import { financeMailQuietly, runFinanceMailDispatch } from './automations/financeDispatcher.js';
import { runPerformanceAutomation } from './performance/writer.js';
import { runTrainingAutomation } from './automations/trainingDispatcher.js';
import { runSubscriptionReminders } from './automations/subscriptionReminders.js';
import { bolifySender } from './automations/bolify.js';
import { runAllSubscriptionMessages } from './automations/subscriptionMessages.js';
import { applyDeliveryReport, normalizeProviderStatus, runInvoiceWhatsApp } from './invoices/whatsapp.js';
import { StorageRepository } from './repositories/StorageRepository.js';
import { timingSafeEqual } from 'node:crypto';
import { getServiceClient, hasServiceClient } from './db/supabase.js';
import { clientForgotPassword } from './services/CustomerImportService.js';
import { requestInfo } from './http/context.js';
import { recordSecurityEvent, sessionClaims } from './security/events.js';
import { locateRequest, trustedClientIp } from './security/clientNetwork.js';

export const API_PREFIX = '/api/v1';
const MAX_BODY_BYTES = 1_000_000;
const IMPORT_BODY_BYTES = 4_000_000;

type Env = { Variables: { requestId: string; actor?: Actor; db?: SupabaseClient; errorCode?: string } };

// ---------------------------------------------------------------------------
// App + global middleware
// ---------------------------------------------------------------------------
/** Only the shape of the two scope headers is checked here; whether the caller may use them is the database's decision. */
function requestedScope(department: string | undefined, division: string | undefined): { department?: string; division?: string } | undefined {
  const d = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(department ?? '') ? department!.toLowerCase() : undefined;
  const v = /^(SALES|SUPPORT)$/i.test(division ?? '') ? division!.toUpperCase() : undefined;
  return d || v ? { department: d, division: v } : undefined;
}

export const app = new Hono<Env>().basePath(API_PREFIX);

app.use('*', requestId());
// the request id (and caller address) follow the request into the database client, so audit rows can be tied back to it
app.use('*', (c, next) => requestInfo.run({ requestId: c.get('requestId'), ip: clientIp(c), scope: requestedScope(c.req.header('x-active-department'), c.req.header('x-active-division')) }, next));
app.use('*', accessLog());
app.use('*', securityAudit());
app.use('*', secureHeaders({ crossOriginResourcePolicy: 'same-site' }));
app.use(
  '*',
  cors({
    // Same-origin calls need no CORS; only explicitly allowed origins get headers.
    origin: origin => (allowedOrigins().includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-Active-Department', 'X-Active-Division'],
    exposeHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After'],
    maxAge: 600
  })
);
app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
});
const tooLarge = () => {
  throw new AppError('VALIDATION_ERROR', 'Request body is too large.');
};
const defaultBodyLimit = bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge });
// The Excel import of existing customers sends the whole workbook as JSON (up to 5000 rows).
const importBodyLimit = bodyLimit({ maxSize: IMPORT_BODY_BYTES, onError: tooLarge });
app.use('*', (c, next) => (relativePath(c) === '/customers/import-existing' ? importBodyLimit(c, next) : defaultBodyLimit(c, next)));
// Layer 1: coarse per-IP flood protection before any auth work.
app.use('*', async (c, next) => {
  if (c.req.method !== 'OPTIONS') await enforce(ipBuckets(clientIp(c)), 'memory');
  await next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/health', async c => c.json(ok(await healthCheck())));

// Onboarding emails / WhatsApp: a change made in the Technical Consultant's (or
// Accounts') work queues messages in the database; send them right away, within
// the same request, so they go out in seconds. Never fails the request itself.
app.use('/pipeline/customers/*', async (c, next) => {
  await next();
  if (c.req.method !== 'GET' && c.res.status < 300) await dispatchQuietly();
});

// An expense (or a retry of a Department Head e-mail) in Accounts' finance pages: its e-mails go out right away.
app.use('/accounts/finance/*', async (c, next) => {
  await next();
  if (c.req.method !== 'GET' && c.res.status < 300) await financeMailQuietly();
});
app.use('/accounts/finance-mail/*', async (c, next) => {
  await next();
  if (c.req.method !== 'GET' && c.res.status < 300) await financeMailQuietly();
});

// An approval or a retry in the HR dashboard sends its e-mails right away (the scheduler would do it at its next run).
app.use('/hr/email-automation/*', async (c, next) => {
  await next();
  if (c.req.method === 'POST' && c.res.status < 300 && !relativePath(c).endsWith('/run')) await runHrAutomation().catch(() => undefined);
});

// The WhatsApp provider's delivery reports for the invoices sent through it: POST { reference, status: delivered | read | failed, detail? } with
// "Authorization: Bearer <WABASTORE_STATUS_SECRET>" (16+ characters). A report only moves a message forward (accepted -> delivered -> read).
app.post('/internal/whatsapp/status', async c => {
  const secret = (process.env.WABASTORE_STATUS_SECRET || '').trim();
  if (secret.length < 16) throw new AppError('SERVICE_UNAVAILABLE', 'Delivery reports are not configured.');
  const given = Buffer.from((c.req.header('authorization') || '').replace(/^Bearer\s+/i, '') || c.req.header('x-webhook-secret') || '');
  const want = Buffer.from(secret);
  if (want.length !== given.length || !timingSafeEqual(want, given)) throw new AppError('UNAUTHENTICATED');
  if (Number(c.req.header('content-length') || 0) > 20_000) throw new AppError('VALIDATION_ERROR', 'The report is too large.');
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const ref = String(body?.reference ?? body?.message_id ?? body?.id ?? '').trim();
  const status = normalizeProviderStatus(body?.status);
  if (!body || !ref || ref.length > 200) throw new AppError('VALIDATION_ERROR', 'Send the message reference and its status.');
  if (!status) return c.json(ok({ matched: false, ignored: true }));
  const detail = typeof body.detail === 'string' ? body.detail.slice(0, 300) : null;
  return c.json(ok(await applyDeliveryReport(ref, status, detail)));
});

// Safety net + retries: call with "Authorization: Bearer <AUTOMATION_DISPATCH_SECRET>"
// (or Vercel Cron's CRON_SECRET), e.g. every few minutes from Supabase pg_cron.
app.on(['GET', 'POST'], '/internal/automations/dispatch', async c => {
  const secrets = automationSettings().dispatchSecrets;
  if (!secrets.length) throw new AppError('SERVICE_UNAVAILABLE', 'Automation dispatch is not configured.');
  const given = Buffer.from((c.req.header('authorization') || '').replace(/^Bearer\s+/i, ''));
  const okSecret = secrets.some(sec => {
    const want = Buffer.from(sec);
    return want.length === given.length && timingSafeEqual(want, given);
  });
  if (!okSecret) throw new AppError('UNAUTHENTICATED');
  // The same safety-net run moves overdue tickets up (RM -> Team Lead -> Department Head) when pg_cron is not set up.
  let ticketsEscalated = 0;
  if (hasServiceClient()) {
    const { data, error } = await getServiceClient().rpc('escalate_overdue_tickets');
    if (error) log('error', 'ticket escalation failed', c, { message: error.message });
    else ticketsEscalated = Number(data) || 0;
  }
  // The Technical Consultant's consultation follow-ups: revalidate every open one against the persisted customer, cancel what no longer applies,
  // notify the responsible user ONCE when one has become due. Persistent (no browser timers); idempotent.
  let tcFollowups: unknown = null;
  if (hasServiceClient()) {
    const { data, error } = await getServiceClient().rpc('tc_followups_process_due');
    if (error) log('error', 'consultation follow-ups failed', c, { message: error.message });
    else tcFollowups = data;
  }
  // HR e-mails (birthdays, anniversaries, probation reminders, confirmations): decide what is due today, then send. Idempotent.
  const hr = await runHrAutomation();
  // Department Head e-mails about payments and expenses: the retries (and anything left waiting).
  const financeMail = await runFinanceMailDispatch().catch(err => ({ error: err instanceof Error ? err.message : 'failed' }));
  // Subscription expiry reminder calls (7, 3 and 1 day before expiry): decided and tracked in the database. Dry run by default; live places the
  // calls through BolifyAI when BOLIFY_WEBHOOK_URL is set.
  const subscriptionReminders = await runSubscriptionReminders({ sender: bolifySender() });
  // The same reminders by e-mail and WhatsApp (Wabastore): dry run by default; live only with an approved wording and a connected provider.
  const subscriptionMessages = await runAllSubscriptionMessages();
  // Paid invoices by WhatsApp: the retries (and anything left waiting). A click sends its own message at once; this is the safety net.
  const invoiceWhatsApp = await runInvoiceWhatsApp(new StorageRepository());
  // Performance reports (Team Lead / Department Head): refresh the weekly and monthly reports whose task figures changed, then write their analysis. Idempotent.
  // HR training: end the programs that are over, make the consolidated reports, remind HR of the day reports still missing. Idempotent.
  const training = await runTrainingAutomation().catch(err => ({ error: err instanceof Error ? err.message : 'failed' }));
  const performance = await runPerformanceAutomation().catch(err => ({ error: err instanceof Error ? err.message : 'failed' }));
  return c.json(ok({ ...(await runDispatch({ limit: 50, budgetMs: 25_000 })), ticketsEscalated, tcFollowups, hr, financeMail, subscriptionReminders, subscriptionMessages, invoiceWhatsApp, performance, training }));
});

// Biometric device gateway: one punch per call, authenticated with "Authorization: Bearer <BIOMETRIC_INGEST_SECRET>".
// The first punch of the office day for that e-mail counts. Unknown or inactive e-mails are refused (404).
app.post('/integrations/biometric/punch', async c => {
  const secrets = (process.env.BIOMETRIC_INGEST_SECRET || '').split(',').map(s => s.trim()).filter(s => s.length >= 16);
  if (!secrets.length) throw new AppError('SERVICE_UNAVAILABLE', 'Biometric punches are not configured.');
  const given = Buffer.from((c.req.header('authorization') || '').replace(/^Bearer\s+/i, ''));
  if (!secrets.some(sec => { const want = Buffer.from(sec); return want.length === given.length && timingSafeEqual(want, given); })) {
    throw new AppError('UNAUTHENTICATED');
  }
  const input = parse(biometricPunchSchema, await readJson(c));
  const { data, error } = await getServiceClient().rpc('record_biometric_punch', { p_email: input.email, p_punched_at: input.punchedAt });
  if (error) throw fromDatabaseError(error);
  if (data === 'UNKNOWN_EMPLOYEE') throw new AppError('NOT_FOUND', 'No active employee has this e-mail.');
  return c.json(ok({ recorded: true }));
});

// "Forgot password?" on the client sign-in page (no login). Same answer whatever the e-mail.
app.post('/client-auth/forgot-password', async c => {
  await enforce([{ key: `forgot:${clientIp(c)}`, limit: 5, window: 900 }], 'memory');
  return c.json(ok(await clientForgotPassword(await readJson(c), c.req.header('origin'))));
});

/** a***@example.com: enough to recognise a typing mistake, not enough to learn an address from the log */
function maskIdentifier(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (!v) return '';
  const at = v.indexOf('@');
  return at > 0 ? `${v[0]}***${v.slice(at)}` : `${v[0]}***`;
}

/**
 * The sign-in page reports a refused password (no login exists yet, so this is public). It is evidence about the ATTEMPT, never about an
 * account: the row has no person, the typed e-mail is kept masked and marked unverified, the address and place come from the platform
 * (not from the body), and a caller can record only a few per quarter hour. (A refusal for a known account is also written by the
 * Auth password hook as LOGIN_FAILED, which has no address.)
 */
app.post('/auth/login-failed', async c => {
  await enforce([{ key: `loginfail:${clientIp(c)}`, limit: 10, window: 900 }], 'memory');
  const input = parse(loginFailureReportSchema, await readJson(c));
  const ip = auditIp(c);
  const identifier = maskIdentifier(input.identifier ?? '');
  if (ip || identifier) {
    await recordSecurityEvent({
      action: 'LOGIN_ATTEMPT_FAILED',
      entityType: 'auth',
      actorId: null,
      outcome: 'FAILURE',
      requestId: c.get('requestId'),
      ip: ip ?? undefined,
      location: await locateRequest(name => c.req.header(name), ip),
      dedupeKey: `loginfail:${ip ?? clientIp(c)}:${identifier}:${Math.floor(Date.now() / 60_000)}`,
      metadata: { surface: 'staff', identifier: identifier || null, identifierVerified: false }
    });
  }
  return c.json(ok({ recorded: true }));
});

// The client dashboard: the customer's own login, their own records only.
for (const route of clientRoutes) {
  app.on(route.method, `/client${route.path}`, async c => {
    const { db, me, limit } = await authenticateClient(c.req.header('authorization'));
    setRateHeaders(c, limit);
    await noteSessionStart(c, null, { customerId: me.customerId });
    const request: ApiRequest = {
      method: c.req.method as HttpMethod,
      path: relativePath(c),
      query: Object.fromEntries(Object.entries(c.req.query()).filter(([k]) => k !== '__path')),
      headers: Object.fromEntries(Object.entries(c.req.header()).map(([k, v]) => [k.toLowerCase(), v])),
      body: c.req.method === 'GET' || c.req.method === 'DELETE' ? undefined : await readJson(c)
    };
    const result = await route.handler({ req: request, params: c.req.param() as Record<string, string>, db, me, services: clientServices(db) });
    return c.json(ok(result.data), (result.status ?? 200) as 200);
  });
}

for (const route of routes) {
  app.on(route.method, route.path, authenticated(route), adapt(route));
}

const routeMatchers = [...routes.map(r => new RegExp(`^${r.path.replace(/:[^/]+/g, '[^/]+')}$`)), ...clientRouteMatchers];

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
    // set first: a refused (inactive) caller is still named in the security log
    c.set('actor', actor);
    c.set('db', db);
    if (!route.options?.allowInactive) assertActive(actor);
    await noteSessionStart(c, actor);
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
  (c as Context<Env>).set('errorCode', err.code);
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

/**
 * The address recorded in the audit log: only what the hosting platform itself set (see security/clientNetwork.ts). clientIp() above
 * also serves rate limiting, where a forged value can only hurt the forger; an audit record must never hold one.
 */
function auditIp(c: Context): string | null {
  return trustedClientIp(name => c.req.header(name));
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

// ---------------------------------------------------------------------------
// Security log: what the database cannot record because a refused request rolls its own transaction back
// ---------------------------------------------------------------------------
const ROUTE_LABELS: { rx: RegExp; method: string; label: string }[] = [
  ...routes.map(r => ({ rx: new RegExp(`^${r.path.replace(/:[^/]+/g, '[^/]+')}$`), method: r.method, label: r.path })),
  ...clientRoutes.map(r => ({ rx: new RegExp(`^/client${r.path.replace(/:[^/]+/g, '[^/]+')}$`), method: r.method, label: `/client${r.path}` }))
];
const STATIC_LABELS = new Set(['/health', '/internal/automations/dispatch', '/integrations/biometric/punch', '/client-auth/forgot-password', '/auth/login-failed']);

/** The route PATTERN (never the raw path: no ids, no query string), or 'unmatched'. */
function routeLabel(method: string, path: string): string {
  if (STATIC_LABELS.has(path)) return path;
  return ROUTE_LABELS.find(r => r.method === method && r.rx.test(path))?.label ?? 'unmatched';
}

function securityAudit(): MiddlewareHandler<Env> {
  return async (c, next) => {
    await next();
    const status = c.res.status;
    const code = c.get('errorCode');
    if (!code || (status !== 401 && status !== 403 && status !== 429)) return;
    const actor = c.get('actor');
    const route = routeLabel(c.req.method, relativePath(c));
    const ip = auditIp(c);
    const rateKey = clientIp(c);
    const action = status === 401 ? 'AUTH_REJECTED' : status === 429 ? 'RATE_LIMITED' : 'ACCESS_DENIED';
    await recordSecurityEvent({
      action,
      entityType: 'request',
      actorId: actor?.id ?? null,
      outcome: 'DENIED',
      requestId: c.get('requestId'),
      ip: ip ?? undefined,
      // one row per caller, kind of refusal and route per five minutes: a retry or a flood is a single event
      dedupeKey: `${action}:${code}:${actor?.id ?? rateKey}:${c.req.method}:${route}:${Math.floor(Date.now() / 300_000)}`,
      metadata: { method: c.req.method, route, status, code, ...(actor ? { role: actor.role, accountStatus: actor.status } : {}) }
    });
  };
}

const knownSessions = new Set<string>();
/** The first request of a sign-in session is the sign-in as the API sees it (the session id comes from the verified token). */
async function noteSessionStart(c: Context<Env>, actor: Actor | null, extra: Record<string, unknown> = {}) {
  const claims = sessionClaims(c.req.header('authorization'));
  if (!claims || knownSessions.has(claims.sessionId)) return;
  if (knownSessions.size > 5000) knownSessions.clear();
  knownSessions.add(claims.sessionId);
  const ip = auditIp(c);
  // the place of a staff sign-in (customers' sign-ins keep only the address): bounded wait, never a reason for the request to fail
  const location = actor ? await locateRequest(name => c.req.header(name), ip) : null;
  await recordSecurityEvent({
    action: 'SESSION_STARTED',
    entityType: actor ? 'session' : 'client_session',
    entityId: typeof extra.customerId === 'string' ? extra.customerId : null,
    actorId: actor?.id ?? null,
    outcome: 'SUCCESS',
    requestId: c.get('requestId'),
    ip: ip ?? undefined,
    location,
    dedupeKey: `session:${claims.sessionId}`,
    metadata: { method: claims.method, ...(actor ? { role: actor.role } : {}) }
  });
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
  // Vercel's rewrite also adds the matched route parameter (:path*) as a plain `path` query parameter. It is routing data, not
  // something the caller sent, and endpoints that accept only their own parameters (the client calendar, attendance, leave
  // months) refuse an unknown one, whatever its value is encoded as: "Unrecognized key(s) in object: 'path'".
  // (Only on a rewritten request: a direct call to /api/v1/... that sends its own `path` is still refused.)
  url.searchParams.delete('path');
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
