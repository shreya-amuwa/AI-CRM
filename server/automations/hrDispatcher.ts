import type { SupabaseClient } from '@supabase/supabase-js';
import type { HrEmailKind, HrEmailRunSummary } from '../../shared/contracts.js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { automationSettings, hrSenderName, liveChannels, senderSettings, type AutomationSettings } from './config.js';
import { renderHrEmail, type HrMailPayload } from './hrTemplates.js';
import { sendEmail } from './providers.js';
import { EMAIL_RE, maskEmail } from './rules.js';

/**
 * Sends the queued HR e-mails (public.hr_email_events). The database decides WHAT is due (hr_schedule_emails: birthdays,
 * anniversaries, probation reminders, approved confirmations) and keeps one row per occasion under a unique key, so an occasion
 * is never queued twice. This claims due rows (two runs never take the same row), renders, sends through the CRM's existing mail
 * setup and records SENT / RETRY / FAILED / SKIPPED / DRY_RUN.
 *
 * AUTOMATION_MODE: off = nothing happens; dry_run (default) = rows are prepared and logged, nothing leaves the server; live = sent.
 * AUTOMATION_TEST_RECIPIENTS limits live sending to the listed addresses (the rest wait as DRY_RUN).
 */
interface ClaimedEvent {
  id: string;
  kind: HrEmailKind;
  attempts: number;
  to: string | null;
  toName: string | null;
  payload: HrMailPayload;
}

type Outcome = { outcome: 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED' | 'DRY_RUN'; detail: string; code?: number | null; ref?: string | null };

/** HR e-mails are personal: the CRM's client-facing CC / BCC lists are not copied, and replies go to HR. */
function hrSettings(base: AutomationSettings): AutomationSettings {
  // EMAIL_FROM_HR (e.g. "Amuwa HR <hr@amuwa.com>") when set; HR_EMAIL_FROM_NAME / HR_REPLY_TO still win, as before
  const s = senderSettings('hr', base);
  return {
    ...s,
    email: {
      ...s.email,
      fromName: hrSenderName(s),
      replyTo: process.env.HR_REPLY_TO?.trim() || s.email.replyTo,
      cc: [],
      bcc: []
    }
  };
}

async function processEvent(s: AutomationSettings, ev: ClaimedEvent): Promise<Outcome> {
  const to = (ev.to || '').trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return { outcome: 'SKIPPED', detail: 'No valid e-mail address for the recipient.' };
  const mail = renderHrEmail(ev.kind, ev.payload);
  if (s.mode !== 'live') return { outcome: 'DRY_RUN', detail: `Dry run – not sent: "${mail.subject}" to ${maskEmail(to)}` };
  if (s.testRecipients && !s.testRecipients.emails.has(to)) {
    return { outcome: 'DRY_RUN', detail: `Test mode – ${maskEmail(to)} is not a test recipient; not sent.` };
  }
  const r = await sendEmail(hrSettings(s), { email: to, name: ev.toName || to }, mail, undefined, { category: 'HR', template: `hr-${String(ev.kind).toLowerCase()}`, idempotencyKey: `hr-mail:${ev.id}` });
  if (r.ok) return { outcome: 'SENT', detail: `Sent to ${maskEmail(to)}`, code: r.code, ref: r.ref };
  return { outcome: r.retry ? 'RETRY' : 'FAILED', detail: r.detail, code: r.code };
}

export async function scheduleHrEmails(db?: SupabaseClient, today?: string): Promise<HrEmailRunSummary['schedule']> {
  if (!db && !hasServiceClient()) return null;
  const { data, error } = await (db ?? getServiceClient()).rpc('hr_schedule_emails', { p_today: today ?? null });
  if (error) throw new Error(`hr_schedule_emails: ${error.message}`);
  return data as HrEmailRunSummary['schedule'];
}

export async function runHrEmailDispatch(opts: { limit?: number; budgetMs?: number; db?: SupabaseClient } = {}): Promise<HrEmailRunSummary['send']> {
  const s = automationSettings();
  const summary: HrEmailRunSummary['send'] = { mode: s.mode, claimed: 0, sent: 0, dryRun: 0, skipped: 0, retrying: 0, failed: 0 };
  if (s.mode === 'off') return { ...summary, note: 'E-mail automation is switched off (AUTOMATION_MODE=off).' };
  if (!opts.db && !hasServiceClient()) return { ...summary, note: 'The server has no service key.' };
  if (s.mode === 'live' && !liveChannels(s).includes('EMAIL')) {
    return { ...summary, note: 'E-mail sending is not configured (EMAIL_PROVIDER and its credentials); messages wait in the queue.' };
  }
  const db = opts.db ?? getServiceClient();
  const limit = opts.limit ?? 30;
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);

  while (summary.claimed < limit && Date.now() < deadline) {
    const { data, error } = await db.rpc('hr_email_claim', {
      p_limit: Math.min(5, limit - summary.claimed),
      p_mode: s.mode === 'live' ? 'live' : 'dry_run',
      // test mode: only the listed addresses are claimed, everybody else's e-mail waits untouched
      p_only_recipients: s.mode === 'live' && s.testRecipients ? [...s.testRecipients.emails] : null
    });
    if (error) throw new Error(`hr_email_claim: ${error.message}`);
    const events = (data ?? []) as ClaimedEvent[];
    if (!events.length) break;
    summary.claimed += events.length;
    const outcomes = await Promise.all(events.map(ev => finishEvent(db, s, ev)));
    for (const o of outcomes) {
      if (o === 'SENT') summary.sent++;
      else if (o === 'DRY_RUN') summary.dryRun++;
      else if (o === 'SKIPPED') summary.skipped++;
      else if (o === 'RETRY') summary.retrying++;
      else summary.failed++;
    }
  }
  return summary;
}

/**
 * Send one probation cycle's due confirmation e-mails right now (after Confirm / Retry in the dashboard), with the same rules as the scheduler:
 * the database claims the rows (two senders never take the same one) and records each outcome. When the employee's e-mail is recorded SENT,
 * the database completes the confirmation by itself. Returns a short reason when nothing could be sent (switched off, not configured).
 */
export async function sendHrCycleEmails(cycleId: string, opts: { db?: SupabaseClient } = {}): Promise<{ sent: number; failed: number; note?: string }> {
  const s = automationSettings();
  if (s.mode === 'off') return { sent: 0, failed: 0, note: 'E-mail sending is switched off on the server, so the confirmation e-mail was not sent.' };
  if (!opts.db && !hasServiceClient()) return { sent: 0, failed: 0, note: 'The server cannot send e-mails right now.' };
  if (s.mode === 'live' && !liveChannels(s).includes('EMAIL')) return { sent: 0, failed: 0, note: 'E-mail sending is not configured on the server, so the confirmation e-mail is waiting.' };
  const db = opts.db ?? getServiceClient();
  const { data, error } = await db.rpc('hr_email_claim_cycle', {
    p_cycle: cycleId,
    p_mode: s.mode === 'live' ? 'live' : 'dry_run',
    p_only_recipients: s.mode === 'live' && s.testRecipients ? [...s.testRecipients.emails] : null
  });
  if (error) throw new Error(`hr_email_claim_cycle: ${error.message}`);
  let sent = 0;
  let failed = 0;
  for (const ev of (data ?? []) as ClaimedEvent[]) {
    const o = await finishEvent(db, s, ev);
    if (o === 'SENT') sent++;
    else failed++;
  }
  return { sent, failed, note: s.mode !== 'live' ? 'E-mails are in dry-run mode on the server, so the confirmation e-mail was not really sent.' : undefined };
}

async function finishEvent(db: SupabaseClient, s: AutomationSettings, ev: ClaimedEvent): Promise<Outcome['outcome']> {
  let o: Outcome;
  try {
    o = await processEvent(s, ev);
  } catch (err) {
    o = { outcome: 'RETRY', detail: `Unexpected error: ${(err as Error)?.message ?? 'unknown'}`.slice(0, 300) };
  }
  const { error: finishError } = await db.rpc('hr_email_finish', {
    p_event: ev.id, p_outcome: o.outcome, p_detail: o.detail, p_response_code: o.code ?? null, p_provider_ref: o.ref ?? null
  });
  // If recording fails after a successful send the row stays SENDING until its lease ends; the log line makes that visible.
  if (finishError) console.error(JSON.stringify({ level: 'error', msg: 'hr_email_finish failed', event: ev.id, error: finishError.message }));
  return o.outcome;
}

/** The scheduler tick: decide what is due, then send. Never throws (it runs inside other requests too). */
export async function runHrAutomation(opts: { db?: SupabaseClient; today?: string } = {}): Promise<HrEmailRunSummary & { error?: string }> {
  const s = automationSettings();
  const out: HrEmailRunSummary & { error?: string } = { schedule: null, send: { mode: s.mode, claimed: 0, sent: 0, dryRun: 0, skipped: 0, retrying: 0, failed: 0 } };
  if (s.mode === 'off') return { ...out, send: { ...out.send, note: 'E-mail automation is switched off (AUTOMATION_MODE=off).' } };
  try {
    out.schedule = await scheduleHrEmails(opts.db, opts.today);
    out.send = await runHrEmailDispatch({ db: opts.db });
  } catch (err) {
    out.error = (err as Error)?.message ?? 'unknown';
    console.error(JSON.stringify({ level: 'error', msg: 'HR e-mail automation failed', error: out.error }));
  }
  return out;
}
