import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiResponse } from '../shared/contracts.js';
import { assertActive, authenticate } from './auth/authenticate.js';
import { ConfigurationError, getEnv } from './config/env.js';
import { AppError } from './http/errors.js';
import type { ApiRequest, HttpMethod } from './http/types.js';
import { router } from './routes.js';

export const API_PREFIX = '/api/v1';
const MAX_BODY_BYTES = 1_000_000;
const METHODS: HttpMethod[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];

type NodeRequest = IncomingMessage & { body?: unknown };

/**
 * Framework-agnostic entry point: used by the Vercel function
 * (api/crm.ts) and by the Vite dev-server middleware.
 */
export async function handleApiRequest(req: NodeRequest, res: ServerResponse): Promise<void> {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  try {
    const request = await toApiRequest(req);
    const { handler, params, options } = router.match(request.method, request.path);
    if (options.public) {
      const result = await options.public(request);
      send(res, 200, { success: true, data: result });
      return;
    }
    const { actor, db } = await authenticate(request.headers.authorization);
    if (!options.allowInactive) assertActive(actor);
    const result = await handler({ req: request, params, actor, db });
    send(res, result.status ?? 200, { success: true, data: result.data });
  } catch (err) {
    const appError = toAppError(err);
    send(res, appError.status, { success: false, error: appError.toBody() });
  }
}

async function toApiRequest(req: NodeRequest): Promise<ApiRequest> {
  const method = (req.method || 'GET').toUpperCase() as HttpMethod;
  if (!METHODS.includes(method)) throw new AppError('METHOD_NOT_ALLOWED');
  const url = new URL(req.url || '/', 'http://localhost');
  // On Vercel the original path arrives as ?__path=… (see vercel.json rewrite);
  // in the Vite dev server the request URL is still /api/v1/….
  const rewritten = url.searchParams.get('__path');
  const path =
    rewritten !== null
      ? `/${rewritten.replace(/^\/+/, '')}`
      : url.pathname.startsWith(API_PREFIX)
        ? url.pathname.slice(API_PREFIX.length) || '/'
        : url.pathname;
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    if (key !== '__path' && key !== 'route' && key !== '...route') query[key] = value;
  });
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  return { method, path, query, headers, body: method === 'GET' ? undefined : await readBody(req) };
}

async function readBody(req: NodeRequest): Promise<unknown> {
  // Vercel pre-parses JSON bodies; the Vite middleware does not.
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return parseJson(req.body);
    if (Buffer.isBuffer(req.body)) return parseJson(req.body.toString('utf8'));
    return req.body;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new AppError('VALIDATION_ERROR', 'Request body is too large.');
    chunks.push(buf);
  }
  return chunks.length ? parseJson(Buffer.concat(chunks).toString('utf8')) : undefined;
}

function parseJson(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Request body must be valid JSON.');
  }
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ConfigurationError) {
    console.error('[api] configuration error:', err.message);
    return new AppError('SERVICE_UNAVAILABLE');
  }
  console.error('[api] unhandled error', err);
  return new AppError('INTERNAL');
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  let allowed: string[] = [];
  try {
    allowed = getEnv().allowedOrigins;
  } catch {
    /* reported when the request is handled */
  }
  // Same-origin requests need no CORS headers; only listed origins get them.
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
}

function send(res: ServerResponse, status: number, body: ApiResponse<unknown>): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
