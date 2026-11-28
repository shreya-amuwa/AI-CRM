/**
 * One safe, readable sentence from any failure, for a toast or an inline message (docs/APP_FEEDBACK_SYSTEM.md).
 *
 * The API already answers with messages written for people (server/http/errors.ts), so those are kept. Anything that looks technical
 * (a stack trace, SQL, a database or network library message, a very long text) is replaced by the fallback: the details belong in the
 * error report (Sentry), never on the screen.
 */
const TECHNICAL = [
  /\bat\s+\S+\s+\(.*:\d+:\d+\)/, // stack frame
  /\b(select|insert|update|delete)\b[\s\S]*\b(from|into|set|where)\b/i,
  /\b(PGRST\d+|SQLSTATE|duplicate key value|violates (foreign key|check|unique|not-null) constraint|relation "|column "|syntax error)\b/i,
  /\b(TypeError|ReferenceError|SyntaxError|RangeError):/,
  /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ERR_[A-Z_]+)\b/,
  /<\/?(html|body|script)\b/i
];

export const NETWORK_MESSAGE = 'Connection lost. Please check your internet and try again.';

export const OFFLINE_MESSAGE = 'Internet connection unavailable. Please check your connection and try again.';
export const PERMISSION_MESSAGE = 'You do not have permission to perform this action.';
export const SESSION_MESSAGE = 'Your session has expired. Please sign in again.';
export const RATE_MESSAGE = 'Too many attempts. Please wait a moment and try again.';

export function userMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as { message?: unknown; code?: unknown; name?: unknown; status?: unknown } | null | undefined;
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (e && (e.code === 'NETWORK_ERROR' || e.name === 'AbortError' || (e.name === 'TypeError' && /fetch/i.test(String(e.message))))) return offline ? OFFLINE_MESSAGE : NETWORK_MESSAGE;
  const raw = typeof err === 'string' ? err : typeof e?.message === 'string' ? e.message : '';
  const msg = raw.replace(/\s+/g, ' ').trim();
  const readable = msg && msg.length <= 300 && !TECHNICAL.some(rx => rx.test(msg));
  if (readable) return msg;
  // no readable message: a clear default for the common refusals instead of the generic fallback
  if (e?.code === 'FORBIDDEN' || e?.status === 403) return PERMISSION_MESSAGE;
  if (e?.code === 'UNAUTHENTICATED' || e?.status === 401) return SESSION_MESSAGE;
  if (e?.code === 'RATE_LIMITED' || e?.status === 429) return RATE_MESSAGE;
  return fallback;
}
