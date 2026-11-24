import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { automationSettings, clientEmailSettings, liveChannels, PANEL_URLS, whatsappStatus, type AutomationSettings } from './config.js';
import { postWhatsApp, sendEmail, type SendResult } from './providers.js';
import { cleanPhone, EMAIL_RE, maskEmail, maskPhone, STAGE_LABEL, type ClientStage } from './rules.js';
import { renderClientPasswordEmail, renderPanelCredentialsEmail, renderPanelLinkEmail, renderSubscriptionActivatedEmail, renderTemporaryAccessEmail } from './templates.js';
import { checkPanelUrl } from '../../shared/panelUrl.js';
import { decryptSecret } from './secrets.js';
import { AuthAdminRepository } from '../repositories/AuthAdminRepository.js';
import { renderAccountsEmail, renderEmail } from './templates.js';
import { financeMailQuietly } from './financeDispatcher.js';

/**
 * Sends the queued onboarding messages (automation_jobs). The database queues
 * them; this claims due jobs (two runs never take the same job), validates with
 * the Apps Script's rules, sends, and records SENT / SKIPPED / RETRY / FAILED.
 *
 * Runs right after a Technical Consultant / Accounts action (so messages go out
 * within seconds) and from POST /internal/automations/dispatch (retries, safety net).
 */
export interface ClaimedJob {
  id: string;
  channel: 'EMAIL' | 'WHATSAPP';
  stage: ClientStage;
  attempts: number;
  context: { from?: string } & Record<string, string | undefined>;
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
    /** The Client Panel URL the Meta Verifier saved (the first of the customer's services that has one). */
    panelUrl?: string | null;
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

/**
 * The payment-request email to one Accounts member (internal: a staff email, so no test-recipient rule and no customer checks). Every
 * eligible member has a job of their own, so an invalid address or a provider failure for one never holds back another. Sent through the
 * same email provider as the customer emails.
 */
async function processAccountsMail(s: AutomationSettings, job: ClaimedJob): Promise<Outcome> {
  const x = job.context;
  const to = (x.to || '').trim().toLowerCase();
  if (job.channel !== 'EMAIL') return { outcome: 'SKIPPED', detail: 'Only the email is sent to Accounts' };
  if (!EMAIL_RE.test(to)) return { outcome: 'SKIPPED', detail: 'The Accounts person has no valid email address' };
  const mail = renderAccountsEmail({
    toName: x.toName || '',
    kind: x.kind || '',
    title: x.title || '',
    customer: x.customer || job.customer.company || job.customer.name,
    contact: x.contact || job.customer.name,
    reference: x.reference,
    from: x.from,
    fromDepartment: x.fromDepartment,
    link: s.appUrl ? `${s.appUrl}/accounts/dashboard/${job.customer.id}` : ''
  });
  if (s.mode !== 'live') return { outcome: 'SKIPPED', detail: `Dry run – not sent: "${mail.subject}" to ${maskEmail(to)}`, recipient: to };
  return fromResult(await sendEmail(s, { email: to, name: x.toName || to }, mail, undefined,
    { category: 'ACCOUNTS', template: 'accounts-payment-request', idempotencyKey: `automation-job:${job.id}`, context: { customerId: job.customer.id } }),
    to, `Payment request email sent to ${maskEmail(to)}`);
}

/**
 * "Your login is ready": the client's one-time set-password link. The link is made now, at send time (it expires, so a retry makes a
 * fresh one) and is never stored or logged. Goes to the login's own e-mail. No password exists to send.
 */
async function processAccountCreatedMail(s: AutomationSettings, job: ClaimedJob): Promise<Outcome> {
  const c = job.customer;
  const email = (c.loginEmail || c.email || '').trim().toLowerCase();
  if (!c.loginEmail) return { outcome: 'SKIPPED', detail: 'NOT sent - the customer has no client login (anymore)' };
  if (!EMAIL_RE.test(email)) return { outcome: 'FAILED', detail: 'The client login has no valid e-mail address - nothing sent' };
  const name = c.name?.trim() || 'Customer';
  const businessName = c.company?.trim() || name;
  if (s.mode !== 'live') return { outcome: 'SKIPPED', detail: `Dry run - not sent: "Set your password" e-mail to ${maskEmail(email)}`, recipient: email };
  if (s.testRecipients && !s.testRecipients.emails.has(email)) {
    return { outcome: 'SKIPPED', detail: `Test mode - ${maskEmail(email)} is not a test recipient`, recipient: email };
  }
  if (!s.appUrl) return { outcome: 'FAILED', detail: 'Set APP_URL on the server so the set-password link can point to the CRM.', recipient: email };
  if (job.context?.credential === 'TEMPORARY') {
    // the temporary password travels encrypted on this job; it cannot be read back without the key, and a failure never sends a half-filled mail
    const password = decryptSecret(job.secret, s.secretKey);
    if (!password) return { outcome: 'FAILED', detail: 'The temporary password could not be read (check AUTOMATION_SECRET_KEY). Nothing was sent - send the e-mail again from Client logins.', recipient: email };
    const mail = renderTemporaryAccessEmail({ name, businessName, loginEmail: email, password, loginUrl: `${s.appUrl}/client/login` });
    // a password: never copied to anyone (CREDENTIALS), sent once per job
    return fromResult(await sendEmail(s, { email, name }, mail, undefined,
      { category: 'CREDENTIALS', application: 'CLIENT_PORTAL', template: 'client-temporary-password', idempotencyKey: `automation-job:${job.id}`, context: { customerId: c.id } }),
      email, `Sign-in e-mail (temporary password) sent to ${maskEmail(email)}`);
  }
  let link: string;
  try {
    link = await new AuthAdminRepository().passwordLink(email, `${s.appUrl}/client/set-password`);
  } catch {
    return { outcome: 'RETRY', detail: 'Could not make the set-password link.', recipient: email };
  }
  const mail = renderClientPasswordEmail({ name, businessName, loginEmail: email, link, kind: 'WELCOME' });
  // a one-time link, made afresh on every attempt (so no idempotency key: the content differs each time); never copied to anyone
  return fromResult(await sendEmail(s, { email, name }, mail, undefined,
    { category: 'CREDENTIALS', application: 'CLIENT_PORTAL', template: 'client-set-password', context: { customerId: c.id } }),
    email, `Set-password e-mail sent to ${maskEmail(email)}`);
}

/**
 * The password the Meta Verifier set on the customer's WhatsApp panel, e-mailed to the customer's own address on the record (read now, so a
 * corrected address is used). Sent once per request: a missing password, an invalid address or a failure is recorded and never reported as
 * sent. The password is decrypted here and goes into this e-mail only.
 */
async function processPanelCredentialsMail(s: AutomationSettings, job: ClaimedJob): Promise<Outcome> {
  const c = job.customer;
  const email = (c.email || '').trim().toLowerCase();
  if (job.channel !== 'EMAIL') return { outcome: 'SKIPPED', detail: 'The panel login is sent by e-mail only' };
  if (!EMAIL_RE.test(email)) return { outcome: 'FAILED', detail: 'The customer has no valid e-mail address on the record - nothing sent. Ask Accounts to correct it, then set the password again.' };
  const name = c.name?.trim() || 'Customer';
  const x = job.context;
  if (s.mode !== 'live') return { outcome: 'SKIPPED', detail: `Dry run - not sent: ${x.serviceName || 'WhatsApp'} panel login e-mail to ${maskEmail(email)}`, recipient: email };
  if (s.testRecipients && !s.testRecipients.emails.has(email)) {
    return { outcome: 'SKIPPED', detail: `Test mode - ${maskEmail(email)} is not a test recipient`, recipient: email };
  }
  const password = decryptSecret(job.secret, s.secretKey);
  if (!password) return { outcome: 'FAILED', detail: 'The panel password could not be read (check AUTOMATION_SECRET_KEY). Nothing was sent - set the password again.', recipient: email };
  // Our panel link for this service: the address saved for it, else the department's panel. Never the free-text "panel" note.
  let panelUrl: string | null = null;
  try {
    const { data } = await getServiceClient().from('customer_services').select('panel_url').eq('customer_id', c.id).eq('service_code', x.service).maybeSingle();
    const saved = (data as { panel_url?: string | null } | null)?.panel_url;
    panelUrl = saved && checkPanelUrl(saved).ok ? saved : null;
  } catch { /* fall back below */ }
  panelUrl ||= PANEL_URLS[c.departmentSlug] || null;
  const mail = renderPanelCredentialsEmail({
    name,
    businessName: c.company?.trim() || name,
    serviceName: x.serviceName || 'WhatsApp',
    panelUrl,
    account: x.account || '',
    password
  });
  // the panel password: never copied to anyone (CREDENTIALS), sent once per job
  return fromResult(await sendEmail(s, { email, name }, mail, undefined,
    { category: 'CREDENTIALS', template: 'panel-credentials', idempotencyKey: `automation-job:${job.id}`, context: { customerId: c.id } }),
    email, `${x.serviceName || 'WhatsApp'} panel login e-mail sent to ${maskEmail(email)}`);
}

/**
 * The Client Panel URL the Meta Verifier saved, e-mailed to the customer's address on the record (read now). One job per link; the address in the
 * job is the one that was approved when the button was pressed. Contains no password or token - the customer signs in with the password they
 * were given. An invalid address, a dry run or a failure is recorded and never reported as sent.
 */
async function processPanelLinkMail(s: AutomationSettings, job: ClaimedJob): Promise<Outcome> {
  const c = job.customer;
  const email = (c.email || '').trim().toLowerCase();
  if (job.channel !== 'EMAIL') return { outcome: 'SKIPPED', detail: 'The panel link is sent by e-mail only' };
  if (!EMAIL_RE.test(email)) return { outcome: 'FAILED', detail: 'The customer has no valid e-mail address on the record - nothing sent. Ask Accounts to correct it, then send the panel link again.' };
  const x = job.context;
  const checked = checkPanelUrl(x.panelUrl);
  if (!checked.ok || !checked.url) return { outcome: 'FAILED', detail: 'The saved panel URL is not a valid HTTPS address - nothing sent. Save a correct URL and send again.', recipient: email };
  const name = c.name?.trim() || 'Customer';
  if (s.mode !== 'live') return { outcome: 'SKIPPED', detail: `Dry run - not sent: ${x.serviceName || 'panel'} link e-mail to ${maskEmail(email)}`, recipient: email };
  if (s.testRecipients && !s.testRecipients.emails.has(email)) {
    return { outcome: 'SKIPPED', detail: `Test mode - ${maskEmail(email)} is not a test recipient`, recipient: email };
  }
  const mail = renderPanelLinkEmail({ name, businessName: c.company?.trim() || name, serviceName: x.serviceName || 'WhatsApp', panel: x.panel, panelUrl: checked.url, account: x.account });
  return fromResult(await sendEmail(s, { email, name }, mail, undefined,
    { category: 'META_VERIFICATION', template: 'panel-link', idempotencyKey: `automation-job:${job.id}`, context: { customerId: c.id, workflow: 'PANEL_LINK' } }),
    email, `${x.serviceName || 'Panel'} link e-mail sent to ${maskEmail(email)}`);
}

interface SubscriptionMailData {
  serviceName: string;
  plan: string | null;
  durationLabel: string | null;
  startedOn: string;
  expiresOn: string;
  messageCredits: number | null;
  panel: string | null;
  panelUrl: string | null;
  panelAccount: string | null;
  hasLogin: boolean;
  mustSetPassword: boolean;
}

/**
 * The panel activation e-mail: plan, duration, the CONFIRMED start date, the expiry date the database calculated, the message limit and a secure way
 * in (a one-time set-password link while the customer has not chosen a password; never a password). The figures are read at the moment of sending, so
 * a corrected date is what the customer gets. A failure or a dry run is recorded on the job and can be retried from the subscription.
 */
async function processSubscriptionActivatedMail(s: AutomationSettings, job: ClaimedJob): Promise<Outcome> {
  const c = job.customer;
  const email = (c.email || '').trim().toLowerCase();
  if (job.channel !== 'EMAIL') return { outcome: 'SKIPPED', detail: 'The panel activation message is sent by e-mail only' };
  if (!EMAIL_RE.test(email)) return { outcome: 'FAILED', detail: 'The customer has no valid e-mail address on the record - nothing sent. Ask Accounts to correct it, then send it again.' };
  const name = c.name?.trim() || 'Customer';
  const x = job.context;
  const { data, error } = await getServiceClient().rpc('subscription_mail_data', { p_customer: c.id, p_service: x.service, p_cycle: Number(x.cycle) });
  const m = (data ?? null) as SubscriptionMailData | null;
  if (error || !m) return { outcome: 'FAILED', detail: 'The subscription could not be read - nothing sent. Send it again from the subscription.', recipient: email };
  if (s.mode !== 'live') return { outcome: 'SKIPPED', detail: `Dry run - not sent: ${m.serviceName} activation e-mail to ${maskEmail(email)}`, recipient: email };
  if (s.testRecipients && !s.testRecipients.emails.has(email)) {
    return { outcome: 'SKIPPED', detail: `Test mode - ${maskEmail(email)} is not a test recipient`, recipient: email };
  }
  let link: string | null = null;
  if (m.hasLogin && m.mustSetPassword) {
    try {
      link = await new AuthAdminRepository().passwordLink(email, `${s.appUrl}/client/set-password`);
    } catch {
      return { outcome: 'RETRY', detail: 'Could not make the set-password link.', recipient: email };
    }
  }
  const panelUrl = m.panelUrl && checkPanelUrl(m.panelUrl).ok ? m.panelUrl : null;
  const mail = renderSubscriptionActivatedEmail({
    name,
    businessName: c.company?.trim() || name,
    serviceName: m.serviceName,
    plan: m.plan,
    durationLabel: m.durationLabel,
    startedOn: m.startedOn,
    expiresOn: m.expiresOn,
    messageCredits: m.messageCredits,
    panel: m.panel,
    panelUrl,
    panelAccount: m.panelAccount,
    loginEmail: c.loginEmail || email,
    loginUrl: `${s.appUrl}/client/login`,
    setPasswordLink: link
  });
  return fromResult(await sendEmail(s, { email, name }, mail, undefined,
    { category: 'CLIENT_ONBOARDING', priority: 'HIGH', template: 'subscription-activated', idempotencyKey: `automation-job:${job.id}`, context: { customerId: job.customer.id, workflow: 'SUBSCRIPTION_ACTIVATED' } }),
    email, `${m.serviceName} activation e-mail sent to ${maskEmail(email)}`);
}

/** Decide and (in live mode) send one job. Never throws. */
export async function processJob(staffSettings: AutomationSettings, job: ClaimedJob): Promise<Outcome> {
  // every e-mail of this queue is addressed to a client: the client-facing sender (EMAIL_FROM_CLIENT) when it is set
  const s = clientEmailSettings(staffSettings);
  if (job.stage === 'ACCOUNTS_PAYMENT') return processAccountsMail(s, job);
  if (job.stage === 'PANEL_CREDENTIALS') return processPanelCredentialsMail(s, job);
  if (job.stage === 'PANEL_LINK') return processPanelLinkMail(s, job);
  if (job.stage === 'SUBSCRIPTION_ACTIVATED') return processSubscriptionActivatedMail(s, job);
  const c = job.customer;
  const name = c.name?.trim() || 'Customer';
  const phone10 = cleanPhone(c.whatsapp);
  const live = s.mode === 'live';

  if (job.channel === 'EMAIL') {
    if (job.stage === 'ACCOUNT_CREATED') return processAccountCreatedMail(s, job);
    const email = (c.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { outcome: 'SKIPPED', detail: 'Invalid client email – nothing sent' };
    if (s.requireValidWhatsapp && !phone10) return { outcome: 'SKIPPED', detail: 'NOT sent – WhatsApp Number is missing or invalid.' };
    if (job.stage === 'WEBSITE_READY' && !websiteOf(c.website)) {
      return { outcome: 'SKIPPED', detail: 'NOT sent – the customer has no website link yet' };
    }
    // the customer's own Client Panel URL (saved by the Meta Verifier) comes first; the department's sign-in page is the fallback
    const panelUrl = (c.panelUrl && checkPanelUrl(c.panelUrl).ok ? c.panelUrl : '') || PANEL_URLS[c.departmentSlug] || '';
    if (job.stage === 'COMPLETED' && !panelUrl) {
      return { outcome: 'SKIPPED', detail: `NOT sent – no panel URL for department "${c.department}"` };
    }
    const mail = renderEmail(job.stage, {
      name,
      email,
      department: c.department,
      panelUrl,
      userId: c.loginEmail || email,
      hasLogin: !!c.loginEmail,
      websiteCreated: job.context?.from === 'WEBSITE_PENDING',
      website: websiteOf(c.website)
    });
    const note = '';
    if (!live) return { outcome: 'SKIPPED', detail: `Dry run – not sent: "${mail.subject}" to ${maskEmail(email)}${note}`, recipient: email };
    if (s.testRecipients && !s.testRecipients.emails.has(email)) {
      return { outcome: 'SKIPPED', detail: `Test mode – ${maskEmail(email)} is not a test recipient`, recipient: email };
    }
    return fromResult(await sendEmail(s, { email, name }, mail, undefined, {
      category: job.stage === 'META_VERIFICATION' ? 'META_VERIFICATION' : 'CLIENT_ONBOARDING', template: `stage-${job.stage.toLowerCase()}`,
      idempotencyKey: `automation-job:${job.id}`, context: { customerId: c.id, workflow: job.stage }
    }), email, `${STAGE_LABEL[job.stage]} email sent${note}`);
  }

  // WhatsApp
  if (!phone10) return { outcome: 'SKIPPED', detail: 'WhatsApp not sent – WhatsApp Number is missing or invalid.' };
  if (job.stage === 'WEBSITE_READY' && !websiteOf(c.website)) {
    return { outcome: 'SKIPPED', detail: 'WhatsApp not sent – the customer has no website link yet' };
  }
  const full = '91' + phone10;
  const status = whatsappStatus(job.stage);
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
    event_key: ['crm', c.id, status.toLowerCase(), full].join('|'),
    stage_code: job.stage,
    // the customer's own panel address travels with the "Status Completed" message (an added field; templates that do not use it ignore it)
    ...(job.stage === 'COMPLETED' && c.panelUrl && checkPanelUrl(c.panelUrl).ok ? { panel_url: c.panelUrl } : {})
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
    // one customer's messages go out in the order they were claimed (e.g. "website ready" before "Meta Verification"); different customers
    // in parallel. Before, the order only held by timing, which any extra step in sending (such as the e-mail record) could change.
    const groups = new Map<string, ClaimedJob[]>();
    for (const job of jobs) groups.set(job.customer.id, [...(groups.get(job.customer.id) ?? []), job]);
    const runInOrder = async (list: ClaimedJob[]) => { const out: Outcome['outcome'][] = []; for (const job of list) out.push(await runOne(job)); return out; };
    const runOne = async (job: ClaimedJob): Promise<Outcome['outcome']> => {
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
    };
    const outcomes = (await Promise.all([...groups.values()].map(runInOrder))).flat();
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
  // payments recorded in the customer's Accounts work also queue the Department Head e-mails: send them in the same breath
  await financeMailQuietly();
}
