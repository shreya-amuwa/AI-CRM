import type { VercelRequest, VercelResponse } from '@vercel/node';
import { assertActive, authenticateRequest } from '../server/auth/authenticate.js';
import { AppError } from '../server/http/errors.js';
import { BlockedTargetError, safeGet } from '../server/net/safeFetch.js';

/**
 * Read-only "fetch this public address for me" helper used by the Accounts expense sync (Google Sheets) and the lead
 * webhook checker when the browser is blocked by CORS.
 *
 * Security: only a signed-in, ACTIVE CRM user may call it; GET only; no CORS headers (same-origin use only); the
 * caller's own credentials are never forwarded; the target must be a public http(s) address (see server/net/safeFetch.ts:
 * no loopback / private / link-local / cloud-metadata addresses, redirects re-checked, time and size limits).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Only GET is supported.' });
  }

  try {
    const { actor } = await authenticateRequest(req.headers.authorization, 'default');
    assertActive(actor);

    const target = Array.isArray(req.query.url) ? req.query.url[0] : req.query.url;
    if (!target || typeof target !== 'string' || target.length > 2048) {
      return res.status(400).json({ error: 'Missing target url parameter' });
    }

    const upstream = await safeGet(target);
    // Served as plain data: never as something the browser would render or run.
    const type = /^(application\/json|text\/csv|text\/plain)\b/i.test(upstream.contentType) ? upstream.contentType : 'text/plain; charset=utf-8';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return res.status(upstream.status >= 200 && upstream.status < 600 ? upstream.status : 502).send(upstream.body);
  } catch (err) {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
    if (err instanceof BlockedTargetError) return res.status(400).json({ error: err.message });
    return res.status(502).json({ error: 'Could not fetch the address.' });
  }
}
