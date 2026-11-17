/**
 * What may leave the CRM in an error report (Sentry), shared by the website (src/instrument.ts) and the API (server/sentry.ts).
 *
 * The CRM holds employee punch locations, customer contacts, invoices and login links, so the rule is STRICT: a report carries the error,
 * its stack trace, the route and a request id, and nothing about a person. On top of the SDK options that switch collection off
 * (cookies, headers, request bodies, query strings, user info), every text in a report is passed through maskText() so that an e-mail
 * address, a phone number or a login token that ended up inside an error message, a URL or a breadcrumb is replaced before it is sent.
 * Pure functions, no SDK import: unit-tested in supabase/tests/sentry_scrub.test.ts.
 */
export const MASK = '[masked]';

const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
/** Indian mobile numbers (10 digits starting 6-9, optional +91 / 91 / 0 prefix); not longer digit runs such as ids and timestamps. */
const PHONE = /(?<![\d.])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?![\d])/g;
/** A signed token (JWT) or a Supabase / Sentry style secret. */
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
/** token=..., token_hash=..., access_token=..., apikey=..., password=... in a URL, a hash or a text. */
const SECRET_PAIR = /\b(token_hash|access_token|refresh_token|id_token|token|apikey|api_key|secret|password|code)=([^&\s"'#]+)/gi;

export function maskText(text: string): string {
  return text
    .replace(JWT, MASK)
    .replace(BEARER, `$1 ${MASK}`)
    .replace(SECRET_PAIR, `$1=${MASK}`)
    .replace(EMAIL, MASK)
    .replace(PHONE, MASK);
}

/** A URL without its query string and fragment (they carry filters, tokens, e-mail addresses), then masked. */
export function cleanUrl(url: string): string {
  const cut = url.split(/[?#]/)[0];
  return maskText(cut);
}

const KEEP_AS_IS = new Set(['event_id', 'trace_id', 'span_id', 'parent_span_id', 'release', 'dist', 'sdk', 'platform', 'timestamp', 'start_timestamp', 'type', 'level', 'logger', 'environment', 'server_name']);
const URL_KEYS = new Set(['url', 'to', 'from', 'http.url', 'url.full', 'http.target', 'http.query', 'url.query']);

function scrubValue(value: unknown, key: string, depth: number): unknown {
  if (depth > 12) return value;
  if (typeof value === 'string') {
    if (KEEP_AS_IS.has(key)) return value;
    return URL_KEYS.has(key) && /^((https?:)?\/\/|\/)/.test(value) ? cleanUrl(value) : maskText(value);
  }
  if (Array.isArray(value)) return value.map(v => scrubValue(v, key, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'http.query' || k === 'url.query') continue; // never sent
      out[k] = scrubValue(v, k, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * The event as it may be sent: no user, no cookies / headers / body / query string, every text masked. Returns the same object type it
 * was given (so it fits the SDK's beforeSend / beforeSendTransaction hooks).
 */
export function scrubSentryEvent<T extends object>(event: T): T {
  const e = event as Record<string, unknown>;
  delete e.user;
  const request = e.request as Record<string, unknown> | undefined;
  if (request && typeof request === 'object') {
    delete request.cookies;
    delete request.headers;
    delete request.data;
    delete request.query_string;
    if (typeof request.url === 'string') request.url = cleanUrl(request.url);
  }
  // the machine's name and the caller's address are personal data too
  const contexts = e.contexts as Record<string, unknown> | undefined;
  if (contexts && typeof contexts === 'object') delete contexts.geo;
  return scrubValue(e, '', 0) as T;
}

/** A breadcrumb with masked text and clean URLs; console output is dropped (it may hold anything the code logged). */
export function scrubBreadcrumb<T extends { category?: string }>(crumb: T): T | null {
  if (crumb.category === 'console') return null;
  return scrubValue(crumb, '', 0) as T;
}

/** Errors that are noise, not defects: browser quirks, extensions, a tab that is offline, a new deployment (handled by a reload). */
export const IGNORED_ERRORS: (string | RegExp)[] = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications',
  /^Non-Error promise rejection captured/,
  /Failed to fetch dynamically imported module/,
  /Importing a module script failed/,
  /error loading dynamically imported module/i,
  /Loading chunk [\w-]+ failed/,
  /^(TypeError: )?(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/,
  /^AbortError/
];
export const IGNORED_URLS: RegExp[] = [/^chrome-extension:\/\//, /^moz-extension:\/\//, /^safari-extension:\/\//, /^safari-web-extension:\/\//];
