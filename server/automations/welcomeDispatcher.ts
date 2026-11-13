import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { AuthAdminRepository } from '../repositories/AuthAdminRepository.js';
import { automationSettings, COMPANY, hrSenderName, liveChannels, senderSettings, type AutomationSettings } from './config.js';
import { sendEmail } from './providers.js';
import { EMAIL_RE, maskEmail } from './rules.js';
import { renderWelcomeEmail } from './welcomeTemplates.js';

/**
 * Sends the welcome e-mails of new employees (public.employee_welcome_emails). The DATABASE queues one row when an account is really active
 * (an approved request, or an active account created by an authorised person) and decides what is due; this claims due rows (two runs never
 * take the same row), makes a fresh one-time "set your password" link, sends through the CRM's existing mail setup and records SENT / RETRYING /
 * FAILED / SKIPPED / DRY_RUN. SENT is recorded only after the provider accepted the message.
 *
 * The link exists only in the e-mail: it is not stored, logged or returned by any API, and a new one replaces the older one (Auth keeps one).
 * AUTOMATION_MODE: off = nothing; dry_run (default) = prepared, nothing leaves the server and no link is made; live = sent.
 * Running it with no Email Automation page open is the normal case: the app triggers it after an approval / creation and the scheduler retries.
 */
interface ClaimedWelcome {
  id: string;
  attempts: number;
  to: string | null;
  name: string | null;
  employeeCode: string | null;
  department: string | null;
  designation: string | null;
}
type Outcome = { outcome: 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED' | 'DRY_RUN'; detail: string; code?: number | null; ref?: string | null };
export interface WelcomeRunSummary { mode: string; claimed: number; sent: number; dryRun: number; skipped: number; retrying: number; failed: number; note?: string }

/** The welcome e-mail comes from the company, replies go to HR, and the client-facing CC / BCC lists are not copied. */
function welcomeSettings(base: AutomationSettings): AutomationSettings {
  // sent by HR: EMAIL_FROM_HR when set; HR_EMAIL_FROM_NAME / HR_REPLY_TO still win, as before
  const s = senderSettings('hr', base);
  return { ...s, email: { ...s.email, fromName: hrSenderName(s), replyTo: process.env.HR_REPLY_TO?.trim() || s.email.replyTo, cc: [], bcc: [] } };
}

const appUrl = (s: AutomationSettings) => (s.appUrl ?? '').replace(/\/+$/, '');

async function processWelcome(s: AutomationSettings, ev: ClaimedWelcome, admin: AuthAdminRepository): Promise<Outcome> {
  const to = (ev.to || '').trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return { outcome: 'SKIPPED', detail: 'The employee has no valid e-mail address.' };
  if (s.mode !== 'live') return { outcome: 'DRY_RUN', detail: `Dry run - not sent: welcome e-mail to ${maskEmail(to)}` };
  if (s.testRecipients && !s.testRecipients.emails.has(to)) return { outcome: 'DRY_RUN', detail: `Test mode - ${maskEmail(to)} is not a test recipient; not sent.` };
  const base = appUrl(s);
  if (!base) return { outcome: 'RETRY', detail: 'The CRM address (APP_URL) is not configured.' };
  let setupUrl: string;
  try {
    setupUrl = await admin.passwordLink(to, `${base}/set-password`);
  } catch {
    // the reason is deliberately generic: nothing about the link or the account is written to the record
    return { outcome: 'RETRY', detail: 'The sign-in link could not be created.' };
  }
  const mail = renderWelcomeEmail({
    name: ev.name?.trim() || to,
    loginId: to,
    employeeCode: ev.employeeCode,
    department: ev.department,
    designation: ev.designation,
    loginUrl: `${base}/login`,
    setupUrl,
    logoUrl: `${base}/amuwa-logo.png`,
    supportEmail: process.env.HR_REPLY_TO?.trim() || s.email.replyTo || COMPANY.companyEmail,
    supportPhone: COMPANY.companyPhone
  });
  const r = await sendEmail(welcomeSettings(s), { email: to, name: ev.name || to }, mail);
  if (r.ok) return { outcome: 'SENT', detail: `Accepted by the mail provider for ${maskEmail(to)}`, code: r.code, ref: r.ref };
  return { outcome: r.retry ? 'RETRY' : 'FAILED', detail: r.detail, code: r.code };
}

export async function runWelcomeEmailDispatch(opts: { limit?: number; budgetMs?: number; db?: SupabaseClient; admin?: AuthAdminRepository } = {}): Promise<WelcomeRunSummary> {
  const s = automationSettings();
  const summary: WelcomeRunSummary = { mode: s.mode, claimed: 0, sent: 0, dryRun: 0, skipped: 0, retrying: 0, failed: 0 };
  if (s.mode === 'off') return { ...summary, note: 'E-mail automation is switched off (AUTOMATION_MODE=off).' };
  // an operator's kill switch for this one e-mail (the queue keeps filling and the other automations are untouched); never set in production by default
  if (process.env.WELCOME_EMAIL?.trim().toLowerCase() === 'off') return { ...summary, note: 'Welcome e-mails are switched off (WELCOME_EMAIL=off).' };
  if (!opts.db && !hasServiceClient()) return { ...summary, note: 'The server has no service key.' };
  if (s.mode === 'live' && !liveChannels(s).includes('EMAIL')) {
    return { ...summary, note: 'E-mail sending is not configured (EMAIL_PROVIDER and its credentials); welcome e-mails wait in the queue.' };
  }
  const db = opts.db ?? getServiceClient();
  const admin = opts.admin ?? new AuthAdminRepository();
  const limit = opts.limit ?? 10;
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);

  while (summary.claimed < limit && Date.now() < deadline) {
    const { data, error } = await db.rpc('welcome_email_claim', {
      p_limit: Math.min(5, limit - summary.claimed),
      p_mode: s.mode === 'live' ? 'live' : 'dry_run',
      p_only_recipients: s.mode === 'live' && s.testRecipients ? [...s.testRecipients.emails] : null
    });
    if (error) throw new Error(`welcome_email_claim: ${error.message}`);
    const events = (data ?? []) as ClaimedWelcome[];
    if (!events.length) break;
    summary.claimed += events.length;
    const outcomes = await Promise.all(
      events.map(async ev => {
        let o: Outcome;
        try {
          o = await processWelcome(s, ev, admin);
        } catch (err) {
          o = { outcome: 'RETRY', detail: `Unexpected error: ${(err as Error)?.message ?? 'unknown'}`.slice(0, 200) };
        }
        const { error: finishError } = await db.rpc('welcome_email_finish', {
          p_id: ev.id, p_outcome: o.outcome, p_detail: o.detail, p_response_code: o.code ?? null, p_provider_ref: o.ref ?? null
        });
        // If recording fails after a successful send the row stays PROCESSING until its lease ends; the log line makes that visible.
        if (finishError) console.error(JSON.stringify({ level: 'error', msg: 'welcome_email_finish failed', email: ev.id, error: finishError.message }));
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

/** Right after an approval or an account creation: send at once, within the same request. Never throws, never fails the request. */
export async function welcomeEmailQuietly(budgetMs = 8_000): Promise<void> {
  try {
    await runWelcomeEmailDispatch({ limit: 5, budgetMs });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'welcome e-mail dispatch failed', error: (err as Error)?.message }));
  }
}
