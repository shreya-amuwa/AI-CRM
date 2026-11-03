import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { automationSettings, COMPANY, liveChannels, type AutomationSettings } from '../automations/config.js';
import { sendEmail } from '../automations/providers.js';
import { EMAIL_RE, maskEmail } from '../automations/rules.js';
import { formatDecisionDate, renderDecisionEmail, type DecisionEmailType } from './emailTemplates.js';

/**
 * Sends the candidate's selection / rejection e-mails (public.recruitment_decision_emails). BACKEND ONLY: no screen, button or API for a recruiter touches this.
 *
 * The DATABASE queues exactly one row per recorded decision, in the same transaction as the decision (so a decision always has its e-mail event, and a
 * repeated request never has two). This claims due rows (two runs never take the same row; a lease frees rows whose worker died), builds the message
 * from the live application record, sends it through the CRM's existing mail setup and records PENDING -> PROCESSING -> SENT / RETRYING / FAILED /
 * SKIPPED / DRY_RUN. SENT is recorded only after the provider accepted the message. A failed e-mail never changes the decision.
 *
 * AUTOMATION_MODE: off = nothing; dry_run (default) = prepared, nothing leaves the server; live = sent (and only to test recipients while
 * AUTOMATION_TEST_RECIPIENTS is set). RECRUITMENT_EMAIL=off is an operator's kill switch for this one e-mail (the queue keeps filling).
 */
export interface ClaimedDecisionEmail {
  id: string;
  attempts: number;
  type: DecisionEmailType;
  to: string | null;
  applicationId: string;
  candidateName: string | null;
  positionName: string | null;
  departmentName: string | null;
  decisionDate: string | null;
}
export type DecisionOutcome = { outcome: 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED' | 'DRY_RUN'; detail: string; code?: number | null; ref?: string | null };
export interface DecisionEmailRunSummary { mode: string; claimed: number; sent: number; dryRun: number; skipped: number; retrying: number; failed: number; note?: string }

/** The e-mail comes from the company's recruitment team; replies go to HR; the client-facing CC / BCC lists are never copied. */
function recruitmentSettings(s: AutomationSettings): AutomationSettings {
  return { ...s, email: { ...s.email, fromName: process.env.HR_EMAIL_FROM_NAME?.trim() || 'Amuwa Corporation HR', replyTo: process.env.HR_REPLY_TO?.trim() || s.email.replyTo, cc: [], bcc: [] } };
}

const appUrl = (s: AutomationSettings) => (s.appUrl ?? '').replace(/\/+$/, '');

export type MailSender = typeof sendEmail;

export async function processDecisionEmail(s: AutomationSettings, ev: ClaimedDecisionEmail, send: MailSender = sendEmail): Promise<DecisionOutcome> {
  const to = (ev.to || '').trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return { outcome: 'SKIPPED', detail: 'The candidate has no valid e-mail address.' };
  if (ev.type !== 'SELECTION' && ev.type !== 'REJECTION') return { outcome: 'FAILED', detail: 'Unknown e-mail type.' };
  if (s.mode !== 'live') return { outcome: 'DRY_RUN', detail: `Dry run - not sent: ${ev.type.toLowerCase()} e-mail to ${maskEmail(to)}` };
  if (s.testRecipients && !s.testRecipients.emails.has(to)) return { outcome: 'DRY_RUN', detail: `Test mode - ${maskEmail(to)} is not a test recipient; not sent.` };
  const base = appUrl(s);
  const mail = renderDecisionEmail(ev.type, {
    candidateName: ev.candidateName?.trim() || 'Candidate',
    positionName: ev.positionName?.trim() || 'the position you applied for',
    departmentName: ev.departmentName,
    selectionDate: formatDecisionDate(ev.decisionDate),
    logoUrl: base ? `${base}/amuwa-logo.png` : '',
    supportEmail: process.env.HR_REPLY_TO?.trim() || s.email.replyTo || COMPANY.companyEmail
  });
  const r = await send(recruitmentSettings(s), { email: to, name: ev.candidateName?.trim() || to }, mail);
  if (r.ok) return { outcome: 'SENT', detail: `Accepted by the mail provider for ${maskEmail(to)}`, code: r.code, ref: r.ref };
  return { outcome: r.retry ? 'RETRY' : 'FAILED', detail: r.detail, code: r.code };
}

export async function runDecisionEmailDispatch(opts: { limit?: number; budgetMs?: number; db?: SupabaseClient; settings?: AutomationSettings; send?: MailSender } = {}): Promise<DecisionEmailRunSummary> {
  const s = opts.settings ?? automationSettings();
  const summary: DecisionEmailRunSummary = { mode: s.mode, claimed: 0, sent: 0, dryRun: 0, skipped: 0, retrying: 0, failed: 0 };
  if (s.mode === 'off') return { ...summary, note: 'E-mail automation is switched off (AUTOMATION_MODE=off).' };
  if (process.env.RECRUITMENT_EMAIL?.trim().toLowerCase() === 'off') return { ...summary, note: 'Recruitment e-mails are switched off (RECRUITMENT_EMAIL=off).' };
  if (!opts.db && !hasServiceClient()) return { ...summary, note: 'The server has no service key.' };
  if (s.mode === 'live' && !liveChannels(s).includes('EMAIL')) {
    return { ...summary, note: 'E-mail sending is not configured (EMAIL_PROVIDER and its credentials); recruitment e-mails wait in the queue.' };
  }
  const db = opts.db ?? getServiceClient();
  const limit = opts.limit ?? 10;
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);

  while (summary.claimed < limit && Date.now() < deadline) {
    const { data, error } = await db.rpc('recruitment_email_claim', {
      p_limit: Math.min(5, limit - summary.claimed),
      p_mode: s.mode === 'live' ? 'live' : 'dry_run',
      p_only_recipients: s.mode === 'live' && s.testRecipients ? [...s.testRecipients.emails] : null
    });
    if (error) throw new Error(`recruitment_email_claim: ${error.message}`);
    const events = (data ?? []) as ClaimedDecisionEmail[];
    if (!events.length) break;
    summary.claimed += events.length;
    const outcomes = await Promise.all(
      events.map(async ev => {
        let o: DecisionOutcome;
        try {
          o = await processDecisionEmail(s, ev, opts.send);
        } catch (err) {
          o = { outcome: 'RETRY', detail: `Unexpected error: ${(err as Error)?.message ?? 'unknown'}`.slice(0, 200) };
        }
        const { error: finishError } = await db.rpc('recruitment_email_finish', {
          p_id: ev.id, p_outcome: o.outcome, p_detail: o.detail, p_response_code: o.code ?? null, p_provider_ref: o.ref ?? null
        });
        // If recording fails after a successful send the row stays PROCESSING until its lease ends; the log line makes that visible (no address, no content).
        if (finishError) console.error(JSON.stringify({ level: 'error', msg: 'recruitment_email_finish failed', email: ev.id, error: finishError.message }));
        return o.outcome;
      })
    );
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

/** Right after a decision is recorded: send at once, within the same request. Never throws, never fails (or slows beyond the budget) the request. */
export async function recruitmentEmailQuietly(budgetMs = 8_000): Promise<void> {
  try {
    await runDecisionEmailDispatch({ limit: 5, budgetMs });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'recruitment e-mail dispatch failed', error: (err as Error)?.message }));
  }
}
