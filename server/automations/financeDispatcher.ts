import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { automationSettings, liveChannels, type AutomationSettings } from './config.js';
import { sendEmail } from './providers.js';
import { EMAIL_RE, maskEmail } from './rules.js';
import { renderFinanceMail } from './templates.js';

/**
 * Sends the queued Department Head e-mails (public.finance_mail_events): a payment recorded for the department, a payment verified, an expense
 * allocated to it. The database decides WHAT is due, one row per recipient under a unique key, so nothing is queued twice; this claims due rows
 * (two runs never take the same row), renders, sends through the CRM's existing mail setup and records SENT / RETRY / FAILED / SKIPPED per
 * recipient. A failure here never touches the payment or expense: those were saved long before.
 * AUTOMATION_MODE: off = nothing; dry_run (default) = logged, not sent (a row can be sent again by Accounts once live); live = sent.
 */
interface ClaimedEvent {
  id: string;
  kind: string;
  attempts: number;
  to: string | null;
  toName: string | null;
  payload: Record<string, unknown>;
}
type Outcome = { outcome: 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED'; detail: string; code?: number | null; ref?: string | null };
export interface FinanceMailSummary { mode: AutomationSettings['mode']; claimed: number; sent: number; skipped: number; retrying: number; failed: number; note?: string }

export async function processFinanceEvent(s: AutomationSettings, ev: ClaimedEvent): Promise<Outcome> {
  const to = (ev.to || '').trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return { outcome: 'FAILED', detail: 'The Department Head has no valid e-mail address.' };
  const mail = renderFinanceMail({ kind: ev.kind, toName: ev.toName || '', payload: ev.payload, link: s.appUrl ? `${s.appUrl}/department-hub` : '' });
  if (s.mode !== 'live') return { outcome: 'SKIPPED', detail: `Dry run - not sent: "${mail.subject}" to ${maskEmail(to)}` };
  if (s.testRecipients && !s.testRecipients.emails.has(to)) return { outcome: 'SKIPPED', detail: `Test mode - ${maskEmail(to)} is not a test recipient` };
  const r = await sendEmail(s, { email: to, name: ev.toName || to }, mail, undefined, { category: 'ACCOUNTS', template: `finance-${String(ev.kind).toLowerCase()}`, idempotencyKey: `finance-mail:${ev.id}` });
  if (r.ok) return { outcome: 'SENT', detail: `Sent to ${maskEmail(to)}`, code: r.code, ref: r.ref };
  return { outcome: r.retry ? 'RETRY' : 'FAILED', detail: r.detail, code: r.code };
}

export async function runFinanceMailDispatch(opts: { limit?: number; budgetMs?: number; db?: SupabaseClient } = {}): Promise<FinanceMailSummary> {
  const s = automationSettings();
  const summary: FinanceMailSummary = { mode: s.mode, claimed: 0, sent: 0, skipped: 0, retrying: 0, failed: 0 };
  if (s.mode === 'off') return { ...summary, note: 'E-mail automation is switched off (AUTOMATION_MODE=off).' };
  if (!opts.db && !hasServiceClient()) return { ...summary, note: 'The server has no service key.' };
  if (s.mode === 'live' && !liveChannels(s).includes('EMAIL')) return { ...summary, note: 'E-mail sending is not configured; messages wait in the queue.' };
  const db = opts.db ?? getServiceClient();
  const limit = opts.limit ?? 30;
  const deadline = Date.now() + (opts.budgetMs ?? 15_000);
  while (summary.claimed < limit && Date.now() < deadline) {
    const { data, error } = await db.rpc('finance_mail_claim', {
      p_limit: Math.min(5, limit - summary.claimed),
      p_mode: s.mode === 'live' ? 'live' : 'dry_run',
      p_only_recipients: s.mode === 'live' && s.testRecipients ? [...s.testRecipients.emails] : null
    });
    if (error) throw new Error(`finance_mail_claim: ${error.message}`);
    const events = (data ?? []) as ClaimedEvent[];
    if (!events.length) break;
    summary.claimed += events.length;
    const outcomes = await Promise.all(
      events.map(async ev => {
        let o: Outcome;
        try {
          o = await processFinanceEvent(s, ev);
        } catch (err) {
          o = { outcome: 'RETRY', detail: `Unexpected error: ${(err as Error)?.message ?? 'unknown'}`.slice(0, 300) };
        }
        const { error: finishError } = await db.rpc('finance_mail_finish', { p_event: ev.id, p_outcome: o.outcome, p_detail: o.detail, p_response_code: o.code ?? null, p_provider_ref: o.ref ?? null });
        if (finishError) console.error(JSON.stringify({ level: 'error', msg: 'finance_mail_finish failed', event: ev.id, error: finishError.message }));
        return o.outcome;
      })
    );
    for (const o of outcomes) {
      if (o === 'SENT') summary.sent++;
      else if (o === 'SKIPPED') summary.skipped++;
      else if (o === 'RETRY') summary.retrying++;
      else summary.failed++;
    }
  }
  return summary;
}

/** For request hooks: never fails the caller's request. */
export async function financeMailQuietly(budgetMs = 6_000): Promise<void> {
  try {
    await runFinanceMailDispatch({ limit: 10, budgetMs });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'finance e-mail dispatch failed', error: (err as Error)?.message }));
  }
}
