/**
 * The CRM on Cloudflare Workers: one Worker serves the built frontend (static assets, see wrangler.jsonc) and the whole API.
 * It replaces vercel.json's rewrites, headers and crons:
 *
 *   /api/v1/*                          -> the Hono API (server/app.ts), the same code the Vercel function and the tests run
 *   /api/proxy                         -> api/proxy.ts      (the signed-in "fetch this public address" helper)
 *   /api/webhook, /api/webhooks/...    -> api/webhook.ts    (the inbound lead webhook)
 *   any other path with no static file -> index.html        (the single-page app), except /api, /assets and /ocr: 404
 *   cron (wrangler.jsonc "triggers")   -> /api/v1/internal/automations/dispatch, with the dispatch secret
 *
 * Server settings and secrets (SUPABASE_URL, EMAIL_API_KEY, ...) are Worker variables / secrets; with the nodejs_compat flag they
 * appear in process.env, which is where server/ reads them, so the server code is unchanged.
 */
import { app } from '../server/app.js';
import { automationSettings } from '../server/automations/config.js';
import proxyHandler from '../api/proxy.js';
import webhookHandler from '../api/webhook.js';
import { runNodeStyleHandler } from './nodeHandler.js';
import { withSecurityHeaders } from './securityHeaders.js';

/*
 * The few Workers runtime shapes used here, written out instead of loading @cloudflare/workers-types, whose global Request / URL /
 * TextDecoder declarations clash with the Node.js types the server code is checked with.
 */
export interface WorkerEnv {
  /** The built frontend (dist/), bound in wrangler.jsonc. */
  ASSETS: { fetch(request: Request): Promise<Response> };
}
interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}
/** Cloudflare's own data about the caller (request.cf). */
interface RequestCf {
  country?: string;
  region?: string;
  city?: string;
  latitude?: string;
  longitude?: string;
}

/**
 * The caller's address and place as Cloudflare itself saw them. Whatever the caller sent under these names is dropped first, so the
 * rate limits, the audit log and the sign-in location (server/security/clientNetwork.ts) can never be fed a forged value.
 */
export function withPlatformHeaders(request: Request): Request {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith('x-vercel-') || name.startsWith('cf-ip') || name === 'cf-region' || name === 'x-real-ip' || name === 'x-forwarded-for') {
      headers.delete(name);
    }
  }
  const ip = request.headers.get('cf-connecting-ip')?.trim();
  if (ip) {
    headers.set('x-real-ip', ip);
    headers.set('x-forwarded-for', ip);
  }
  const cf = (request as Request & { cf?: RequestCf }).cf;
  // Header values must be Latin-1: names of places are sent URI-encoded (clientNetwork.ts decodes them), as Vercel did.
  const put = (name: string, value: unknown) => {
    if (value !== undefined && value !== null && String(value) !== '') headers.set(name, encodeURIComponent(String(value)));
  };
  put('cf-ipcountry', cf?.country);
  put('cf-region', cf?.region);
  put('cf-ipcity', cf?.city);
  put('cf-iplatitude', cf?.latitude);
  put('cf-iplongitude', cf?.longitude);
  return new Request(request, { headers });
}

const notFound = () => Response.json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found.' } }, { status: 404 });

export async function handleRequest(request: Request, env: WorkerEnv, ctx?: WorkerContext): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === '/api/v1' || pathname.startsWith('/api/v1/')) {
    return withSecurityHeaders(await app.fetch(withPlatformHeaders(request), env, ctx as never));
  }
  if (pathname === '/api/proxy') {
    return withSecurityHeaders(await runNodeStyleHandler(proxyHandler, withPlatformHeaders(request)));
  }
  if (pathname === '/api/webhook' || pathname === '/api/webhooks' || pathname.startsWith('/api/webhooks/')) {
    return withSecurityHeaders(await runNodeStyleHandler(webhookHandler, withPlatformHeaders(request)));
  }
  // A missing file under these must stay a 404: answering index.html there turns a stale script link into a confusing page error.
  if (pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/assets/') || pathname.startsWith('/ocr/')) {
    return withSecurityHeaders(notFound());
  }
  // Any other path is a screen of the single-page app (the router reads the path in the browser).
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return withSecurityHeaders(new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, HEAD' } }));
  }
  const index = await env.ASSETS.fetch(new Request(new URL('/', request.url), { method: request.method, headers: request.headers }));
  return withSecurityHeaders(index);
}

/** The scheduled run (was vercel.json "crons"): the same authenticated request Vercel Cron sent, made inside the Worker. */
export async function runScheduledDispatch(env: WorkerEnv): Promise<void> {
  // Off unless switched on: during the rehearsal on workers.dev and until the switch-over, Vercel Cron still runs the automations against
  // the same database; two runs at once could send a reminder twice. Go-live turns this on and Vercel's cron off together.
  if ((process.env.SCHEDULED_ENABLED || '').trim().toLowerCase() !== 'true') {
    console.log('[cron] skipped: SCHEDULED_ENABLED is not "true" (switch it on at go-live, when Vercel Cron is turned off)');
    return;
  }
  const secret = automationSettings().dispatchSecrets[0];
  if (!secret) {
    throw new Error('Scheduled automations are not configured: set the CRON_SECRET (or AUTOMATION_DISPATCH_SECRET) secret, 16+ characters.');
  }
  const res = await app.fetch(
    new Request('https://worker.internal/api/v1/internal/automations/dispatch', { method: 'POST', headers: { authorization: `Bearer ${secret}` } }),
    env
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Scheduled automations failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  console.log(`[cron] automations dispatched: HTTP ${res.status}`);
}

/** The cron of the attendance reminders (wrangler.jsonc). */
export const REMINDERS_CRON = '*/5 * * * *';

/** The attendance reminders, every 5 minutes: the same switch and the same secret as the automations. */
export async function runScheduledReminders(env: WorkerEnv): Promise<void> {
  if ((process.env.SCHEDULED_ENABLED || '').trim().toLowerCase() !== 'true') {
    console.log('[cron] reminders skipped: SCHEDULED_ENABLED is not "true"');
    return;
  }
  const secret = automationSettings().dispatchSecrets[0];
  if (!secret) {
    throw new Error('Attendance reminders are not configured: set the CRON_SECRET (or AUTOMATION_DISPATCH_SECRET) secret, 16+ characters.');
  }
  const res = await app.fetch(
    new Request('https://worker.internal/api/v1/internal/attendance/reminders', { method: 'POST', headers: { authorization: `Bearer ${secret}` } }),
    env
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Attendance reminders failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  console.log(`[cron] attendance reminders: HTTP ${res.status} ${text.slice(0, 200)}`);
}

export default {
  fetch: (request: Request, env: WorkerEnv, ctx: WorkerContext) => handleRequest(request, env, ctx),
  // Awaited (not waitUntil) so a failed run shows as failed in the Worker's cron history.
  scheduled: async (controller: { cron?: string }, env: WorkerEnv) => {
    if (controller?.cron === REMINDERS_CRON) await runScheduledReminders(env);
    else await runScheduledDispatch(env);
  }
};
