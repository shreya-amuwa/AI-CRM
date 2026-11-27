/**
 * The browser security headers every response of the CRM carries (they were the "headers" block of vercel.json).
 * Static files served straight from Cloudflare get them from public/_headers; responses made by the Worker (the API, the
 * single-page-app fallback) get them from here. supabase/tests/cloudflare_worker.test.ts checks that the two lists match.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' blob: data: https:; connect-src 'self' https: wss:; frame-src 'self' blob: data: https:; worker-src 'self' blob:; object-src 'self' blob:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups'
};

/**
 * A copy of the response with the security headers added. A header the handler already set on purpose is kept: for example
 * /api/proxy's "Content-Security-Policy: default-src 'none'; sandbox" must not be widened to the site-wide policy.
 */
export function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!out.headers.has(name)) out.headers.set(name, value);
  }
  return out;
}

/**
 * Dashboard Explorer's preview frame (/dashboard-preview/*, docs/DASHBOARD_EXPLORER.md). The Worker serves these files itself (wrangler.jsonc
 * assets.run_worker_first) and REPLACES the site-wide policy with this one:
 *  - sandbox without allow-same-origin: the page runs in an opaque origin, so it can never read the Managing Director's session (local
 *    storage), cookies or IndexedDB, nor register a service worker - also when someone opens the address directly;
 *  - connect-src 'none': no fetch, XHR, WebSocket or EventSource to the API, Supabase or anywhere else; worker-src / frame-src 'none';
 *  - frame-ancestors 'self': only the CRM's own page can show it in a frame;
 *  - Access-Control-Allow-Origin: the opaque-origin page loads its own script and style files with CORS (public, static files only).
 */
export const PREVIEW_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'none'; connect-src 'none'; worker-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts allow-forms",
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Access-Control-Allow-Origin': '*',
  'X-Robots-Tag': 'noindex'
};

/** A copy of the response with the preview frame's headers, replacing any site-wide ones. */
export function withPreviewHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [name, value] of Object.entries(PREVIEW_HEADERS)) out.headers.set(name, value);
  return out;
}
