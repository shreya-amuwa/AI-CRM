import { getSupabase } from '../../services/supabaseClient';

/**
 * GET a public address through the CRM's own /api/proxy (for pages that block the browser with CORS).
 * The proxy only answers signed-in CRM users, so the session token is attached.
 */
export async function proxyFetch(targetUrl: string): Promise<Response> {
  const session = (await getSupabase()?.auth.getSession())?.data.session;
  return fetch(`/api/proxy?url=${encodeURIComponent(targetUrl)}`, {
    headers: session ? { Authorization: `Bearer ${session.access_token}` } : {}
  });
}
