import { automationSettings } from '../automations/config.js';
import { getServiceClient } from '../db/supabase.js';
import { decryptToken, encryptToken, exchangeCode, googleConfig, revokeToken, verifyState } from './google.js';
import { meetingsQuietly } from './worker.js';

const appUrl = () => automationSettings().appUrl ?? 'https://crm.amuwacorporation.com';

/**
 * Google's return from the sign-in (GET /integrations/google/callback?code=...&state=...). No CRM login comes with this request, so the
 * signed state names the employee who started it. Answers with where to send the browser back to (the Meetings page, with the outcome).
 */
export async function finishGoogleConnect(query: Record<string, string | undefined>): Promise<string> {
  const back = (outcome: string) => `${appUrl()}/?tab=meetings&google=${encodeURIComponent(outcome)}`;
  const cfg = googleConfig(process.env, appUrl());
  if (!cfg) return back('not-configured');
  const profileId = verifyState(query.state, cfg.tokenKey);
  if (!profileId) return back('expired');
  if (query.error) return back(query.error === 'access_denied' ? 'denied' : 'failed');
  if (!query.code || query.code.length > 2000) return back('failed');
  const db = getServiceClient();
  const { data: profile } = await db.from('profiles').select('id, status').eq('id', profileId).maybeSingle();
  if (!profile || profile.status !== 'ACTIVE') return back('failed');
  try {
    const t = await exchangeCode(cfg, query.code);
    const { error } = await db.from('google_calendar_connections').upsert({
      profile_id: profileId,
      google_email: t.email,
      refresh_token_enc: encryptToken(t.refreshToken, cfg),
      scopes: t.scopes.slice(0, 2000),
      calendar_id: 'primary',
      status: 'CONNECTED',
      last_error: null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    if (error) return back('failed');
    await db.rpc('mtg_connection_saved', { p_profile: profileId });
    await audit(profileId, 'GOOGLE_CALENDAR_CONNECTED', { googleEmail: t.email });
    await meetingsQuietly();
    return back('connected');
  } catch {
    return back('failed');
  }
}

/** Ends the CRM's access to the employee's Google Calendar (at Google too) and forgets the stored token. Events already made stay. */
export async function disconnectGoogle(profileId: string): Promise<void> {
  const cfg = googleConfig(process.env, appUrl());
  const db = getServiceClient();
  const { data } = await db.from('google_calendar_connections').select('refresh_token_enc').eq('profile_id', profileId).maybeSingle();
  if (data?.refresh_token_enc && cfg) {
    const token = decryptToken(data.refresh_token_enc, cfg);
    if (token) await revokeToken(token);
  }
  await db.from('google_calendar_connections').delete().eq('profile_id', profileId);
  await db.from('meetings').update({ google_sync_status: 'NOT_CONNECTED' }).eq('host_id', profileId).in('google_sync_status', ['PENDING', 'FAILED']);
  await audit(profileId, 'GOOGLE_CALENDAR_DISCONNECTED', {});
}

async function audit(profileId: string, action: string, metadata: Record<string, unknown>) {
  await getServiceClient().from('audit_logs')
    .insert({ actor_id: profileId, action, entity_type: 'profile', entity_id: profileId, metadata })
    .then(() => undefined, () => undefined);
}
