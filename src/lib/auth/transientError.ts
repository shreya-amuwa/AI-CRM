import { ApiError } from '../api/client';

/**
 * No answer from the server (offline, timed out) or a server-side error (a busy database, a gateway): worth trying again, and never a reason to
 * sign anybody out or to show the sign-in page. A refused token (401), a closed account (403) or a bad request are real answers and are not transient.
 */
export function isTransient(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 0 || err.status >= 500);
}
