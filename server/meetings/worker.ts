import type { SupabaseClient } from '@supabase/supabase-js';
import { automationSettings, clientEmailSettings } from '../automations/config.js';
import { sendEmail } from '../automations/providers.js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { sendBlocker } from '../invoices/mailer.js';
import {
  decryptToken, deleteEvent, eventBody, freeBusy, googleConfig, GoogleAuthLostError, insertEvent, patchEvent, refreshAccessToken,
  type BusyBlock, type CalendarMeeting, type GoogleConfig
} from './google.js';
import { GOOGLE_SENDS, ICS_KINDS, linkSecret, manageToken, meetingIcs, renderMeetingEmail, type MailMeeting, type MeetingMailKind } from './mail.js';

/**
 * The meetings worker (server only, service role): runs with every automation dispatch (pg_cron, every few minutes) and right after a
 * meeting changes in the CRM, so Google and the guests hear about it at once.
 *   1. reminders that are due (24 h and 1 h before) are recorded once;
 *   2. meetings waiting for Google are created / changed / removed on the HOST's Google Calendar (with a Meet link when asked);
 *   3. e-mails to guests outside the company are sent (skipped when Google already sent its own invitation).
 * Everything is idempotent and retried with back-off; nothing here can block a meeting from being booked.
 */

export interface MeetingsRunSummary {
  reminders: number;
  synced: number;
  syncFailed: number;
  mailed: number;
  mailSkipped: number;
  mailFailed: number;
  error?: string;
}

const appUrl = () => automationSettings().appUrl ?? 'https://crm.amuwacorporation.com';

interface Connection {
  profile_id: string;
  refresh_token_enc: string;
  calendar_id: string;
  status: string;
  google_email: string | null;
}

/** Access tokens of this run, per employee (a run is short; Google's tokens live an hour). */
class TokenCache {
  private readonly tokens = new Map<string, string>();
  constructor(private readonly db: SupabaseClient, private readonly cfg: GoogleConfig) {}

  async connection(profileId: string): Promise<Connection | null> {
    const { data } = await this.db.from('google_calendar_connections').select('profile_id, refresh_token_enc, calendar_id, status, google_email')
      .eq('profile_id', profileId).maybeSingle();
    return data && data.status === 'CONNECTED' ? (data as Connection) : null;
  }

  async access(c: Connection): Promise<string> {
    const cached = this.tokens.get(c.profile_id);
    if (cached) return cached;
    const refresh = decryptToken(c.refresh_token_enc, this.cfg);
    if (!refresh) throw new GoogleAuthLostError('The stored Google access cannot be read (the key changed). Connect again.');
    const token = await refreshAccessToken(this.cfg, refresh);
    this.tokens.set(c.profile_id, token);
    return token;
  }
}

async function lost(db: SupabaseClient, profileId: string, err: Error) {
  await db.rpc('mtg_connection_broken', { p_profile: profileId, p_error: err.message.slice(0, 500) });
}

// ---------------------------------------------------------------------------
// Google sync
// ---------------------------------------------------------------------------
type ClaimedMeeting = CalendarMeeting & { hostId: string; status: string; googleEventId: string | null; googleCalendarId: string | null };

async function syncOne(db: SupabaseClient, cache: TokenCache, m: ClaimedMeeting): Promise<boolean> {
  const result = (p: Record<string, unknown>) => db.rpc('mtg_sync_result', { p_id: m.id, p_version: m.version, ...p });
  const c = await cache.connection(m.hostId);
  if (!c) {
    await result({ p_ok: true, p_skipped: true });
    return true;
  }
  const calendarId = m.googleCalendarId || c.calendar_id || 'primary';
  try {
    const token = await cache.access(c);
    const live = m.status === 'SCHEDULED' || m.status === 'COMPLETED';
    if (!live) {
      // cancelled / declined, or (moved back into) a request: no event on the calendar
      if (m.googleEventId) await deleteEvent(token, calendarId, m.googleEventId);
      await result({ p_ok: true, p_skipped: !m.googleEventId, p_event_removed: true });
      return true;
    }
    if (m.status === 'COMPLETED' && m.googleEventId) {
      await result({ p_ok: true });
      return true;
    }
    const url = appUrl();
    let ev = m.googleEventId ? await patchEvent(token, calendarId, m.googleEventId, eventBody(m, url, m.mode === 'GOOGLE_MEET' && !m.meetLink)) : null;
    if (!ev) ev = await insertEvent(token, calendarId, eventBody(m, url, m.mode === 'GOOGLE_MEET'));
    await result({ p_ok: true, p_event_id: ev.eventId, p_calendar_id: calendarId, p_meet_link: ev.meetLink });
    return true;
  } catch (err) {
    if (err instanceof GoogleAuthLostError) await lost(db, m.hostId, err);
    await result({ p_ok: false, p_error: (err as Error).message.slice(0, 500) });
    return false;
  }
}

// ---------------------------------------------------------------------------
// E-mails to guests
// ---------------------------------------------------------------------------
interface ClaimedMail {
  id: number;
  toEmail: string;
  toName: string | null;
  kind: MeetingMailKind;
  meetingVersion: number;
  meeting: MailMeeting & { googleSyncStatus: string; createdAt: string; updatedAt: string };
}

async function mailOne(db: SupabaseClient, o: ClaimedMail): Promise<'SENT' | 'SKIPPED' | 'FAILED' | 'DEFER'> {
  const done = (status: string, error?: string) => db.rpc('mtg_mail_result', { p_id: o.id, p_status: status, p_error: error ?? null });
  const m = o.meeting;
  // the invitation, its change and its cancellation come from Google when the meeting is on the host's Google Calendar
  // (a guest who booked through a link still gets ours: it carries their private link)
  if (GOOGLE_SENDS.includes(o.kind) && m.bookedVia !== 'BOOKING_LINK') {
    if (m.googleSyncStatus === 'SYNCED') {
      await done('SKIPPED', 'Google sent the invitation.');
      return 'SKIPPED';
    }
    // still syncing: wait a little (at most ~15 minutes after the change), then send ours anyway
    if (m.googleSyncStatus === 'PENDING' && Date.now() - new Date(m.updatedAt).getTime() < 15 * 60_000) {
      await done('DEFER');
      return 'DEFER';
    }
  }
  const settings = clientEmailSettings(automationSettings());
  const blocked = sendBlocker(settings, o.toEmail);
  if (blocked) {
    await done('SKIPPED', blocked);
    return 'SKIPPED';
  }
  const secret = linkSecret();
  const manageUrl = m.bookedVia === 'BOOKING_LINK' && secret && !['CANCELLED', 'DECLINED'].includes(o.kind)
    ? `${appUrl()}/book/manage/${manageToken(m.id, secret)}` : null;
  const mail = renderMeetingEmail(o.kind, m, o.toName, manageUrl);
  const attachments = ICS_KINDS.includes(o.kind)
    ? [{ filename: 'meeting.ics', content: new TextEncoder().encode(meetingIcs(m, o.kind === 'CANCELLED')), contentType: 'text/calendar; charset=utf-8' }]
    : undefined;
  const r = await sendEmail(settings, { email: o.toEmail, name: o.toName || o.toEmail, display: true }, mail, attachments);
  if (r.ok) {
    await done('SENT');
    return 'SENT';
  }
  await done(r.retry ? 'FAILED' : 'SKIPPED', r.detail);
  return r.retry ? 'FAILED' : 'SKIPPED';
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------
export async function runMeetingsDispatch(opts: { budgetMs?: number; limit?: number; db?: SupabaseClient } = {}): Promise<MeetingsRunSummary> {
  const summary: MeetingsRunSummary = { reminders: 0, synced: 0, syncFailed: 0, mailed: 0, mailSkipped: 0, mailFailed: 0 };
  if (!opts.db && !hasServiceClient()) return { ...summary, error: 'The service role is not configured.' };
  const db = opts.db ?? getServiceClient();
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  const limit = opts.limit ?? 20;
  try {
    const rem = await db.rpc('mtg_enqueue_reminders');
    summary.reminders = Number(rem.data) || 0;

    const cfg = googleConfig(process.env, appUrl());
    if (cfg) {
      const cache = new TokenCache(db, cfg);
      const { data } = await db.rpc('mtg_sync_claim', { p_limit: limit });
      for (const m of (data ?? []) as ClaimedMeeting[]) {
        if (Date.now() > deadline) break;
        if (await syncOne(db, cache, m)) summary.synced++;
        else summary.syncFailed++;
      }
    }

    const { data: mails } = await db.rpc('mtg_mail_claim', { p_limit: limit });
    for (const o of (mails ?? []) as ClaimedMail[]) {
      if (Date.now() > deadline) break;
      const r = await mailOne(db, o).catch(() => 'FAILED' as const);
      if (r === 'SENT') summary.mailed++;
      else if (r === 'SKIPPED') summary.mailSkipped++;
      else if (r === 'FAILED') summary.mailFailed++;
    }
  } catch (err) {
    summary.error = (err as Error).message?.slice(0, 200) ?? 'failed';
  }
  return summary;
}

/** Right after a change in the CRM: a short run, never failing the request that triggered it. */
export async function meetingsQuietly(): Promise<void> {
  await runMeetingsDispatch({ budgetMs: 8_000, limit: 10 }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Free / busy of colleagues in Google (for picking a time and for booking pages)
// ---------------------------------------------------------------------------
/** Google busy times of these employees (those who connected); employees whose connection fails are simply left out. */
export async function googleBusy(profileIds: string[], from: Date, to: Date, db: SupabaseClient = getServiceClient()): Promise<Record<string, BusyBlock[]>> {
  const cfg = googleConfig(process.env, appUrl());
  const out: Record<string, BusyBlock[]> = {};
  if (!cfg || !profileIds.length || !hasServiceClient()) return out;
  const cache = new TokenCache(db, cfg);
  await Promise.all(profileIds.slice(0, 30).map(async id => {
    const c = await cache.connection(id);
    if (!c) return;
    try {
      out[id] = await freeBusy(await cache.access(c), c.calendar_id || 'primary', from, to);
    } catch (err) {
      if (err instanceof GoogleAuthLostError) await lost(db, id, err);
    }
  }));
  return out;
}
