import { ConfigurationError } from './config/env.js';
import { AppError } from './http/errors.js';

/**
 * Error reporting hook of the API. The API code calls reportServerError() where it already turns an unexpected failure into a 500 (app.onError);
 * what happens next depends on the entry point: on Vercel server/sentry.ts registers a Sentry reporter, anywhere else (the Cloudflare
 * Worker, tests, `npm run dev`) there is none and the call does nothing. This file imports no SDK, so every deployment still bundles.
 */
export interface ErrorReport {
  error: unknown;
  /** The request id (also in the Vercel log line) and the route PATTERN: never the address with its ids, query or body. */
  requestId?: string;
  route?: string;
  method?: string;
  status?: number;
  /** The caller's role (not the person), when signed in. */
  role?: string;
}
type Reporter = (report: ErrorReport) => void;

let reporter: Reporter | null = null;
export function setErrorReporter(next: Reporter | null): void {
  reporter = next;
}

/**
 * Defects and outages are reported; the caller's own mistakes are not (a wrong password, a missing field, a refused permission, a rate
 * limit, a 404 are the API working as designed and would only bury the real errors).
 */
export function shouldReportError(error: unknown): boolean {
  if (error instanceof AppError) return error.status >= 500;
  if (error instanceof ConfigurationError) return true;
  // an HTTP exception thrown by the framework carries a client status (too large, malformed): not a defect
  if (error && typeof error === 'object' && 'status' in error && typeof (error as { status: unknown }).status === 'number') {
    return (error as { status: number }).status >= 500;
  }
  return true;
}

/** Never throws and never waits: reporting must not be able to break or slow a request. */
export function reportServerError(report: ErrorReport): void {
  if (!reporter || !shouldReportError(report.error)) return;
  try {
    reporter(report);
  } catch {
    /* a failing reporter must not change the answer */
  }
}
