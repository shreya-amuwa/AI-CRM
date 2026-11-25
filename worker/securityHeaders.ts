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
