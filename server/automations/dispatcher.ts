import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { automationSettings, liveChannels, PANEL_URLS, type AutomationSettings } from './config.js';
import { postWhatsApp, sendEmail, type SendResult } from './providers.js';
import { cleanPhone, EMAIL_RE, maskEmail, maskPhone, STAGE_LABEL, type ClientStage } from './rules.js';
import { decryptSecret } from './secrets.js';
import { renderEmail } from './templates.js';

/**
 * Sends the queued onboarding messages (automation_jobs). The database queues
 * them; this claims due jobs (two runs never take the same job), validates with
 * the Apps Script's rules, sends, and records SENT / SKIPPED / RETRY / FAILED.
 *
 * Runs right after a Technical Consultant / Accounts action (so messages go out
 * within seconds) and from POST /internal/automations/dispatch (retries, safety net).
 */
interface ClaimedJob {
  id: string;
  channel: 'EMAIL' | 'WHATSAPP';
  stage: ClientStage;
  attempts: number;
  context: { from?: string };
  secret: string | null;
  customer: {
    id: string;
    name: string;
    company: string | null;
    email: string | null;
    whatsapp: string | null;
    departmentSlug: string;
    department: string;
    website: string | null;
    loginEmail: string | null;
  };
}

type Outcome = { outcome: 'SENT' | 'SKIPPED' | 'RETRY' | 'FAILED'; detail: string; code?: number | null; recipient?: string | null; ref?: string | null };

export interface DispatchSummary {
  mode: AutomationSettings['mode'];
  claimed: number;
  sent: number;
  skipped: number;
  retrying: number;
  failed: number;
}

const websiteOf = (w: string | null) => (w && w !== 'NO_WEBSITE' ? w : '');

/** Decide and (in live mode) send one job. Never throws. */
async function processJob(s: AutomationSettings, job: ClaimedJob): Promise<Outcome> {
  const c = job.customer;
  const name = c.name?.trim() || 'Customer';
  const phone10 = cleanPhone(c.whatsapp);
  const live = s.mode === 'live';

  if (job.channel === 'EMAIL') {
    const email = (c.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { outcome: 'SKIPPED', detail: 'Invalid client email – nothing sent' };
    if (s.requireValidWhatsapp && !phone10) return { outcome: 'SKIPPED', detail: 'NOT sent – WhatsApp Number is missing or invalid.' };
    if (job.stage === 'WEBSITE_READY' && !websiteOf(c.website)) {
      return { outcome: 'SKIPPED', detail: 'NOT sent – the customer has no website link yet' };
    }
    const panelUrl = PANEL_URLS[c.departmentSlug] || '';
    if (job.stage === 'COMPLETED' && !panelUrl) {
      return { outcome: 'SKIPPED', detail: `NOT sent – no panel URL for department "${c.department}"` };
    }
    const password = job.stage === 'COMPLETED' ? decryptSecret(job.secret, s.secretKey) : null;
    const mail = renderEmail(job.stage, {
      name,
      email,
      department: c.department,
      panelUrl,
      userId: c.loginEmail || email,
      password,
      websiteCreated: job.context?.from === 'WEBSITE_PENDING',
      website: websiteOf(c.website)
    });
    const note = job.stage === 'COMPLETED' && !password ? ' (without the password)' : '';
    if (!live) return { outcome: 'SKIPPED', detail: `Dry run – not sent: "${mail.subject}" to ${maskEmail(email)}${note}`, recipient: email };
    if (s.testRecipients && !s.testRecipients.emails.has(email)) {
      return { outcome: 'SKIPPED', detail: `Test mode – ${maskEmail(email)} is not a test recipient`, recipient: email };
    }
    return fromResult(await sendEmail(s, { email, name }, mail), email, `${STAGE_LABEL[job.stage]} email sent${note}`);
  }

  // WhatsApp
  if (!phone10) return { outcome: 'SKIPPED', detail: 'WhatsApp not sent – WhatsApp Number is missing or invalid.' };
  if (job.stage === 'WEBSITE_READY' && !websiteOf(c.website)) {
    return { outcome: 'SKIPPED', detail: 'WhatsApp not sent – the customer has no website link yet' };
  }
  const full = '91' + phone10;
  const status = STAGE_LABEL[job.stage];
  if (!live) return { outcome: 'SKIPPED', detail: `Dry run – not sent: "${status}" WhatsApp to ${maskPhone(full)}`, recipient: full };
  if (s.testRecipients && !s.testRecipients.phones.has(phone10)) {
    return { outcome: 'SKIPPED', detail: `Test mode – ${maskPhone(full)} is not a test recipient`, recipient: full };
  }
  const r = await postWhatsApp(s, {
    name,
    email: (c.email || '').trim(),
    phone: full,
    department: c.department,
    website: websiteOf(c.website),
    whatsapp_number: full,
    status,
    source: s.whatsapp.source,
    automation: 'Client Onboarding',
    event_key: ['crm', c.id, status.toLowerCase(), full].join('|')
  });
  return fromResult(r, full, `${status} WhatsApp request accepted by webhook (${r.detail})`);
}

function fromResult(r: SendResult, recipient: string, okText: string): Outcome {
  if (r.ok) return { outcome: 'SENT', detail: okText, code: r.code, recipient, ref: r.ref };
  return { outcome: r.retry ? 'RETRY' : 'FAILED', detail: r.detail, code: r.code, recipient };
}

/**
 * Claim and process due jobs until there are none, the limit is reached or the
 * time budget is used up. Safe to call concurrently.
 */
export async function runDispatch(opts: { limit?: number; budgetMs?: number; db?: SupabaseClient } = {}): Promise<DispatchSummary> {
  const s = automationSettings();
  const summary: DispatchSummary = { mode: s.mode, claimed: 0, sent: 0, skipped: 0, retrying: 0, failed: 0 };
  if (s.mode === 'off' || (!opts.db && !hasServiceClient())) return summary;
  const channels = s.mode === 'live' ? liveChannels(s) : ['EMAIL', 'WHATSAPP'];
  if (!channels.length) return summary;
  const db = opts.db ?? getServiceClient();
  const limit = opts.limit ?? 20;
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);

  while (summary.claimed < limit && Date.now() < deadline) {
    const { data, error } = await db.rpc('automation_claim_jobs', { p_channels: channels, p_limit: Math.min(5, limit - summary.claimed) });
    if (error) throw new Error(`automation_claim_jobs: ${error.message}`);
    const jobs = (data ?? []) as ClaimedJob[];
    if (!jobs.length) break;
    summary.claimed += jobs.length;
    const outcomes = await Promise.all(
      jobs.map(async job => {
        let o: Outcome;
        try {
          o = await processJob(s, job);
        } catch (err) {
          o = { outcome: 'RETRY', detail: `Unexpected error: ${(err as Error)?.message ?? 'unknown'}`.slice(0, 300) };
        }
        const { error: finishError } = await db.rpc('automation_finish_job', {
          p_job: job.id,
          p_outcome: o.outcome,
          p_detail: o.detail,
          p_response_code: o.code ?? null,
          p_recipient: o.recipient ?? null,
          p_provider_ref: o.ref ?? null
        });
        if (finishError) console.error(JSON.stringify({ level: 'error', msg: 'automation_finish_job failed', job: job.id, error: finishError.message }));
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
export async function dispatchQuietly(budgetMs = 8_000): Promise<void> {
  try {
    await runDispatch({ limit: 10, budgetMs });
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'automation dispatch failed', error: (err as Error)?.message }));
  }
}
