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

export function userMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as { message?: unknown; code?: unknown; name?: unknown } | null | undefined;
  if (e && (e.code === 'NETWORK_ERROR' || e.name === 'AbortError' || (e.name === 'TypeError' && /fetch/i.test(String(e.message))))) return NETWORK_MESSAGE;
  const raw = typeof err === 'string' ? err : typeof e?.message === 'string' ? e.message : '';
  const msg = raw.replace(/\s+/g, ' ').trim();
  if (!msg || msg.length > 300 || TECHNICAL.some(rx => rx.test(msg))) return fallback;
  return msg;
}
