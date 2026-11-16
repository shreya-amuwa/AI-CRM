import * as Sentry from '@sentry/react';
import { IGNORED_ERRORS, IGNORED_URLS, scrubBreadcrumb, scrubSentryEvent } from '../shared/sentryScrub';

/**
 * Error reporting for the website (Sentry project "ai-crm-frontend"). Imported FIRST in main.tsx so that errors during start-up are caught.
 * It does nothing unless VITE_SENTRY_DSN is set at build time, so local development and tests send nothing.
 *
 * Privacy (strict): no session replay, no user, cookies, headers, request bodies or query strings; every text is masked
 * (shared/sentryScrub.ts). Only same-origin API calls (/api/...) carry the trace headers, never Supabase or other sites.
 * See docs/ERROR_MONITORING.md.
 */
const dsn = import.meta.env.VITE_SENTRY_DSN;

if (dsn) {
  const configured = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE);
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || (import.meta.env.PROD ? 'production' : 'development'),
    // the release comes from the source map upload (the build injects it); this is only a fallback
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    integrations: [Sentry.browserTracingIntegration()],
    // 10% of page loads and API calls in production, all of them while developing; VITE_SENTRY_TRACES_SAMPLE_RATE changes it
    tracesSampleRate: import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE && Number.isFinite(configured) ? configured : import.meta.env.PROD ? 0.1 : 1.0,
    tracePropagationTargets: [/^\/api\//],
    // whole transactions (not streamed spans), so that beforeSendTransaction below can mask every URL and text before it is sent
    traceLifecycle: 'static',
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    ignoreErrors: IGNORED_ERRORS,
    denyUrls: IGNORED_URLS,
    beforeSend: event => scrubSentryEvent(event),
    beforeSendTransaction: event => scrubSentryEvent(event),
    beforeBreadcrumb: crumb => scrubBreadcrumb(crumb)
  });
}
