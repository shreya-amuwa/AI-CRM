import * as Sentry from '@sentry/node';
import { IGNORED_ERRORS, scrubBreadcrumb, scrubSentryEvent } from '../shared/sentryScrub.js';
import { setErrorReporter } from './monitoring.js';

/**
 * Error reporting for the API on Vercel (Sentry project "ai-crm-server"). api/crm.ts and api/webhook.ts import this file FIRST.
 * It does nothing unless SENTRY_DSN is set on the server, so tests and `npm run dev` are unaffected.
 *
 * The Cloudflare Worker DOES load this file (worker/index.ts imports api/webhook.ts, which imports it first) and has SENTRY_DSN among its
 * variables, so it must not start the client there: Sentry.init starts a timer, and a Worker may not start timers (or any I/O) while its
 * code is loading ("Disallowed operation called within global scope", error 10021: the deploy is refused). CRM_PLATFORM is "cloudflare"
 * on the Worker (wrangler.jsonc), so nothing is started there; the Worker's errors are in Cloudflare's Observability logs.
 *
 * Privacy (strict): no user, cookies, headers, request bodies or query strings; every text is masked (shared/sentryScrub.ts); a report
 * carries the error, its stack, the route pattern, the request id and the caller's role.
 * Tracing is OFF unless SENTRY_TRACES_SAMPLE_RATE is set: Vercel starts the function without Sentry's loader, so automatic spans are
 * limited, and the extra work at cold start is not worth it while the API is under load. See docs/ERROR_MONITORING.md.
 */
const onCloudflareWorker = process.env.CRM_PLATFORM === 'cloudflare';
const dsn = onCloudflareWorker ? undefined : process.env.SENTRY_DSN?.trim();
let pending = false;
let tracing = false;

if (dsn) {
  const rate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE);
  tracing = process.env.SENTRY_TRACES_SAMPLE_RATE !== undefined && process.env.SENTRY_TRACES_SAMPLE_RATE !== '' && Number.isFinite(rate) && rate > 0;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT?.trim() || process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
    release: process.env.SENTRY_RELEASE?.trim() || process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    ...(tracing ? { tracesSampleRate: rate } : {}),
    // whole transactions (not streamed spans), so that beforeSendTransaction below can mask every URL and text before it is sent
    traceLifecycle: 'static',
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    ignoreErrors: IGNORED_ERRORS,
    beforeSend: event => scrubSentryEvent(event),
    beforeSendTransaction: event => scrubSentryEvent(event),
    beforeBreadcrumb: crumb => scrubBreadcrumb(crumb)
  });
  setErrorReporter(({ error, requestId, route, method, status, role }) => {
    pending = true;
    Sentry.withScope(scope => {
      if (requestId) scope.setTag('request_id', requestId);
      if (route) scope.setTag('route', route);
      if (method) scope.setTag('method', method);
      if (status) scope.setTag('http_status', String(status));
      if (role) scope.setTag('role', role);
      Sentry.captureException(error);
    });
  });
}

/**
 * A Vercel function may be frozen as soon as it answers, before Sentry has sent anything: wait (at most 2 s) for the report, but only
 * when this invocation produced one (or tracing is on), so normal requests are not slowed.
 */
export async function flushSentry(): Promise<void> {
  if (!dsn || (!pending && !tracing)) return;
  pending = false;
  await Sentry.flush(2000).catch(() => false);
}

/** Report an error that happened outside the Hono app (the webhook function), then wait for it to be sent. */
export async function captureAndFlush(error: unknown): Promise<void> {
  if (!dsn) return;
  Sentry.captureException(error);
  pending = true;
  await flushSentry();
}
