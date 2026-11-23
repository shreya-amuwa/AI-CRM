// Type only: nodemailer itself is loaded in sendSmtp, when a message is really sent through SMTP (it is slow to load, so it is kept out of every start of the API).
import type nodemailer from 'nodemailer';
import type { AutomationSettings } from './config.js';
import { buildMime, formatMailbox, smtpSendRaw, SmtpError, socketConnector } from './smtpSocket.js';
import { signRequest } from '../storage/sigv4.js';
import type { RenderedEmail } from './templates.js';
import { classifyResend, classifySes, classifySmtp, classifyThrown, type Classified } from '../email/classify.js';
import { providerRoute, PROVIDER_LABEL, type ProviderName } from '../email/routing.js';
import { defaultLedger, LedgerRefusal, SENSITIVE_CATEGORIES, type BeginAnswer, type EmailApplication, type EmailCategory, type EmailContext,
  type EmailPriority, type FinishRequest, type Ledger } from '../email/ledger.js';

/** A file sent with an e-mail (a generated invoice PDF). */
export interface MailAttachment {
  filename: string;
  content: Uint8Array;
  contentType: string;
}
const b64 = (a: MailAttachment) => Buffer.from(a.content).toString('base64');

/** What a provider call ended in. `retry` = worth trying again later (timeout, 5xx, 429). */
export interface SendResult {
  ok: boolean;
  retry: boolean;
  code: number | null;
  ref: string | null;
  detail: string;
  /** which provider took it (or was tried last) */
  provider?: ProviderName | null;
  /** the classified reason when it was not taken (server/email/classify.ts) */
  errorCategory?: string | null;
  /** the provider may have taken it (a timeout): the queue must not send it through another provider */
  unknownAcceptance?: boolean;
}

const TIMEOUT_MS = 15_000;

type PostResult = { status: number; text: string; retryAfter: string | null; daily?: string | null; monthly?: string | null };
async function post(url: string, headers: Record<string, string>, body: unknown): Promise<PostResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  // Resend reports the account's quota use on every answer (the daily header only on the free plan); kept as reported
  return { status: res.status, text: (await res.text()).slice(0, 1000), retryAfter: res.headers.get('retry-after'),
           daily: res.headers.get('x-resend-daily-quota'), monthly: res.headers.get('x-resend-monthly-quota') };
}

/**
 * Resend accepts a limited number of API requests a second per account (10 by default today; older accounts had 5 or 2). The
 * automations send their e-mails one after another, so calls from this server instance are spaced to RESEND_MAX_PER_SECOND (default 5)
 * instead of being refused; when Resend still answers 429 (a lower account limit, or another instance sending at the same moment) the
 * call waits as asked, at most RESEND_MAX_WAIT_MS, and is tried once more.
 * Anything still refused stays queued for the next run, as before.
 */
const RESEND_MAX_WAIT_MS = 5_000;
let resendNextSlot = 0;

function resendGapMs(): number {
  const n = Number(process.env.RESEND_MAX_PER_SECOND);
  return Math.ceil(1000 / (Number.isFinite(n) && n >= 1 && n <= 100 ? n : 5));
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function resendPost(url: string, headers: Record<string, string>, body: unknown): Promise<PostResult> {
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    const wait = Math.max(0, resendNextSlot - now);
    resendNextSlot = Math.max(now, resendNextSlot) + resendGapMs();
    if (wait) await sleep(wait);
    const r = await post(url, headers, body);
    // a daily / monthly quota answer does not change by waiting a second: only a rate limit is tried again
    if (r.status !== 429 || attempt >= 1 || /quota/i.test(r.text)) return r;
    const asked = Number(r.retryAfter) * 1000;
    const pause = Number.isFinite(asked) && asked > 0 ? asked : 1000;
    if (pause > RESEND_MAX_WAIT_MS) return r;
    await sleep(pause);
  }
}

function result(status: number, text: string, ref: string | null): SendResult {
  const ok = status >= 200 && status < 300;
  const retry = !ok && (status >= 500 || status === 429 || status === 408);
  let message = '';
  if (!ok) {
    try {
      const j = JSON.parse(text);
      message = String(j?.message || j?.error?.message || j?.error || '').slice(0, 200);
    } catch {
      message = text.slice(0, 200);
    }
  }
  return { ok, retry, code: status, ref, detail: ok ? `HTTP ${status}` : `HTTP ${status}${message ? `: ${message}` : ''}` };
}

function networkFailure(err: unknown): SendResult {
  const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
  return { ok: false, retry: true, code: null, ref: null, detail: timeout ? 'The provider did not answer in time.' : 'Could not reach the provider.' };
}

/**
 * SMTP through nodemailer, e.g. the meta@amuwa.com Google Workspace mailbox
 * (smtp.gmail.com, an app password). Temporary failures (4xx, network) are retried.
 */
async function sendSmtp(s: AutomationSettings, to: { email: string; name: string }, mail: RenderedEmail, attachments?: MailAttachment[]): Promise<SendResult> {
  const smtp = s.email.smtp;
  if (!smtp) return { ok: false, retry: false, code: null, ref: null, detail: 'SMTP is not configured.' };
  // On Cloudflare Workers (a TCP connector registered by worker/entry.ts) nodemailer cannot run: the CRM's own SMTP client is used.
  if (socketConnector()) return sendSmtpSocket(s, to, mail, attachments);
  let transport: ReturnType<typeof nodemailer.createTransport>;
  try {
    const { default: nodemailerModule } = await import('nodemailer');
    transport = nodemailerModule.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.user, pass: smtp.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000
    });
  } catch (err) {
    // On Cloudflare Workers SMTP is unavailable (worker/stubs/nodemailer.ts): a setup problem, so the message waits for a retry.
    return { ok: false, retry: true, code: null, ref: null, detail: String((err as Error)?.message ?? 'SMTP is not available.').slice(0, 200) };
  }
  try {
    const info = await transport.sendMail({
      from: { name: s.email.fromName, address: s.email.fromEmail },
      to: { name: to.name, address: to.email },
      replyTo: s.email.replyTo,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(attachments?.length ? { attachments: attachments.map(a => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })) } : {}),
      ...(s.email.cc.length ? { cc: s.email.cc } : {}),
      ...(s.email.bcc.length ? { bcc: s.email.bcc } : {})
    });
    const rejected = [...(info.rejected ?? [])];
    if (rejected.length) return { ok: false, retry: false, code: null, ref: null, detail: 'The mail server rejected the recipient address.' };
    return { ok: true, retry: false, code: 250, ref: info.messageId ?? null, detail: 'SMTP 250' };
  } catch (err) {
    const e = err as { responseCode?: number; code?: string; message?: string };
    const code = typeof e.responseCode === 'number' ? e.responseCode : null;
    // 5xx = refused for good, except 535 (wrong mailbox / app password): that is our setup, so keep
    // the message and retry; fixing the password in the settings then recovers it. 4xx / network: temporary.
    const permanent = code !== null && code >= 500 && code !== 535 && e.code !== 'EAUTH';
    const detail =
      code === 535 || e.code === 'EAUTH'
        ? 'SMTP sign-in failed: check the mailbox and its app password.'
        : `SMTP error${code ? ` ${code}` : e.code ? ` ${e.code}` : ''}: ${String(e.message ?? '').slice(0, 160)}`;
    return { ok: false, retry: !permanent, code, ref: null, detail };
  } finally {
    transport.close();
  }
}

/** SMTP over the Worker's TCP sockets (server/automations/smtpSocket.ts); same results and retry rules as the nodemailer path. */
async function sendSmtpSocket(s: AutomationSettings, to: { email: string; name: string }, mail: RenderedEmail, attachments?: MailAttachment[]): Promise<SendResult> {
  const smtp = s.email.smtp!;
  try {
    const message = buildMime({
      from: { name: s.email.fromName, email: s.email.fromEmail },
      to,
      cc: s.email.cc,
      replyTo: s.email.replyTo,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      attachments
    });
    const id = /^Message-ID: (.+)$/m.exec(message)?.[1] ?? null;
    await smtpSendRaw(smtp, { from: s.email.fromEmail, recipients: [to.email, ...s.email.cc, ...s.email.bcc] }, message);
    return { ok: true, retry: false, code: 250, ref: id, detail: 'SMTP 250' };
  } catch (err) {
    const code = err instanceof SmtpError ? err.code : null;
    const permanent = code !== null && code >= 500 && code !== 535 && code !== 530 && code !== 534;
    const detail =
      code === 535 || code === 534 || code === 530
        ? 'SMTP sign-in failed: check the mailbox and its app password.'
        : `SMTP error${code ? ` ${code}` : ''}: ${String((err as Error)?.message ?? '').slice(0, 160)}`;
    return { ok: false, retry: !permanent, code, ref: null, detail };
  }
}

/**
 * Provider routing and failover (server/email/routing.ts, docs/EMAIL_MANAGEMENT.md). The providers are tried in the configured order
 * (now: Resend, then the SMTP mailbox; after AWS approves SES, e.g. SES, Resend, SMTP). The next provider is tried only after a DEFINITE
 * refusal that is about the provider, not the e-mail (quota, rate limit, keys, an unverified domain, the SES sandbox, a suspended account,
 * a provider error, no connection): never after an ambiguous timeout (the first provider may have sent it, and a second copy must not go
 * out), never for an invalid or suppressed recipient, refused content or an attachment too large. After a quota answer the provider is
 * skipped for a while (here, and for every Worker instance through email_provider_state).
 */
const PAUSE_MS = 15 * 60_000;
const pausedUntil: Record<'resend' | 'ses', number> = { resend: 0, ses: 0 };

/** Tests only: forget a quota pause. */
export function resetResendPause(): void {
  pausedUntil.resend = 0;
  pausedUntil.ses = 0;
}

/**
 * The mailbox can only send as itself or its Gmail "Send mail as" aliases (SMTP_SEND_AS). An e-mail meant to come from another address
 * (e.g. auth@amuwa.com) goes out from the mailbox instead, with replies still going where the original e-mail said.
 */
function backupSettings(s: AutomationSettings): AutomationSettings {
  const smtp = s.email.smtp;
  if (!smtp) return s;
  const from = s.email.fromEmail.toLowerCase();
  if (from === smtp.user.toLowerCase() || (s.email.smtpSendAs ?? []).includes(from)) return s;
  return { ...s, email: { ...s.email, fromEmail: smtp.user, replyTo: s.email.replyTo || s.email.fromEmail } };
}

type ApiAttempt = { ok: boolean; res: SendResult; fallback: boolean; quota: boolean; cls?: Classified; usage?: { daily?: string | null; monthly?: string | null } };

/** What a send is about; every field optional, so existing callers keep working unchanged. */
export interface EmailOptions {
  category?: EmailCategory;
  application?: EmailApplication;
  /** the template's name, for the log (never its content) */
  template?: string;
  priority?: EmailPriority;
  /**
   * One key per business event (e.g. "decision-email:<id>"): the same event is never e-mailed twice, whichever Worker instance retries it.
   * Also sent to Resend as Idempotency-Key.
   */
  idempotencyKey?: string;
  /** carries a one-time link, a code or a password: never a copy to anyone. AUTH and CREDENTIALS are always sensitive. */
  sensitive?: boolean;
  /** extra copies asked for by this e-mail (refused for sensitive e-mail) */
  cc?: string[];
  bcc?: string[];
  /** the record the e-mail is about: used to resolve CC / BCC rules from the live assignments and to show the e-mail to the right people */
  context?: EmailContext;
  /** tests only */
  ledger?: Ledger | null;
}

const FAILOVER_LABEL: Record<ProviderName, string> = { smtp: 'the SMTP mailbox', ses: 'Amazon SES', resend: 'Resend', brevo: 'Brevo' };

async function attemptWith(p: ProviderName, s: AutomationSettings, to: { email: string; name: string; display?: boolean }, mail: RenderedEmail,
  attachments: MailAttachment[] | undefined, idempotencyKey: string | undefined, asBackup: boolean): Promise<ApiAttempt> {
  if (p === 'resend') return sendResend(s, s.email.apiKey!, to, mail, attachments, idempotencyKey);
  if (p === 'ses') return sendSes(s, to, mail, attachments);
  if (p === 'brevo') {
    const res = await sendBrevo(s, s.email.apiKey!, to, mail, attachments);
    return { ok: res.ok, res, fallback: false, quota: false };
  }
  const res = await sendSmtp(asBackup ? backupSettings(s) : s, to, mail, attachments);
  const cls = res.ok ? undefined : classifySmtp(res.code);
  return { ok: res.ok, res, fallback: !!cls?.failover, quota: false, cls };
}

/**
 * Sends one e-mail through the configured providers, in order, with the shared record around it (email_send_begin / email_send_finish):
 * one send per business event, the category's sender, the CC / BCC rules, the suppression list and the provider quotas. Authentication and
 * credential e-mails never get a copy: the deployment's EMAIL_CC / EMAIL_BCC are dropped, and an explicit copy is refused.
 */
export async function sendEmail(s: AutomationSettings, to: { email: string; name: string; /** Resend / SES: send as "Name <address>" so the recipient's mail app shows the name. */ display?: boolean }, mail: RenderedEmail, attachments?: MailAttachment[], opts: EmailOptions = {}): Promise<SendResult> {
  const category: EmailCategory = opts.category ?? 'GENERAL';
  const sensitive = opts.sensitive === true || SENSITIVE_CATEGORIES.has(category);
  if (sensitive && ((opts.cc?.length ?? 0) > 0 || (opts.bcc?.length ?? 0) > 0)) {
    return { ok: false, retry: false, code: null, ref: null, detail: 'Authentication and credential e-mails cannot have CC or BCC recipients.', errorCategory: 'INVALID_CONTENT' };
  }
  const route = providerRoute(s);
  if (!route.order.length) return { ok: false, retry: false, code: null, ref: null, detail: 'Email sending is not configured.', errorCategory: 'NOT_CONFIGURED' };

  const ledger = opts.ledger === undefined ? defaultLedger() : opts.ledger;
  const requested = { cc: sensitive ? [] : [...s.email.cc, ...(opts.cc ?? [])], bcc: sensitive ? [] : [...s.email.bcc, ...(opts.bcc ?? [])] };
  let plan: BeginAnswer = { logId: null, duplicate: null, cc: requested.cc, bcc: requested.bcc, suppressed: [], sender: null, providers: null };
  if (ledger) {
    try {
      plan = await ledger.begin({
        idempotencyKey: opts.idempotencyKey, application: opts.application ?? 'CRM', category, template: opts.template,
        priority: opts.priority ?? (sensitive ? 'CRITICAL' : 'NORMAL'), sensitive, to: to.email, cc: requested.cc, bcc: requested.bcc,
        senderEmail: s.email.fromEmail, providers: route.order, context: opts.context ?? {}
      });
    } catch (err) {
      if (err instanceof LedgerRefusal) return { ok: false, retry: false, code: null, ref: null, detail: err.message, errorCategory: 'INVALID_CONTENT' };
      throw err;
    }
  }
  if (plan.duplicate === 'ACCEPTED') {
    return { ok: true, retry: false, code: null, ref: plan.duplicateRef ?? null, detail: 'Already sent for this event (not sent again).', provider: plan.duplicateProvider ?? null };
  }
  if (plan.duplicate === 'IN_PROGRESS') {
    return { ok: false, retry: true, code: null, ref: null, detail: 'This e-mail is being sent by another run right now.', errorCategory: 'IN_PROGRESS' };
  }
  const finish = async (r: Omit<FinishRequest, 'logId'>) => { if (ledger && plan.logId) await ledger.finish({ ...r, logId: plan.logId }); };
  if (plan.suppressed.includes(to.email.trim().toLowerCase())) {
    await finish({ status: 'SUPPRESSED', attempts: [], errorCategory: 'SUPPRESSED' });
    return { ok: false, retry: false, code: null, ref: null, detail: 'Not sent: the address is on the suppression list (an earlier hard bounce or complaint).', errorCategory: 'SUPPRESSED' };
  }

  // the providers to try: the deployment's route, in the Super Admin's order when the database gave one, without those paused or out of quota
  let order: ProviderName[] = plan.providers ? plan.providers.map(x => x.provider).filter(p => route.order.includes(p)) : route.order;
  const refused = new Map((plan.providers ?? []).filter(x => !x.allowed).map(x => [x.provider, x.reason ?? 'PAUSED']));
  if (plan.duplicate === 'UNKNOWN_ACCEPTANCE') {
    // the provider may already have sent it: only the same provider may be asked again, and only Resend can recognise the repeat
    const same = plan.duplicateProvider;
    if (same !== 'resend' || !opts.idempotencyKey || !route.order.includes('resend')) {
      await finish({ status: 'UNKNOWN_ACCEPTANCE', attempts: [], errorCategory: 'TIMEOUT' });
      return { ok: false, retry: false, code: null, ref: null, unknownAcceptance: true, errorCategory: 'TIMEOUT',
               detail: 'The provider may already have sent this e-mail (it did not answer in time). Not sent again automatically: check Email Management before sending it again.' };
    }
    order = ['resend'];
    refused.delete('resend');
  }

  const sender = plan.sender;
  const base: AutomationSettings = { ...s, email: { ...s.email, cc: plan.cc, bcc: plan.bcc,
    ...(sender ? { fromEmail: sender.email, fromName: sender.name, replyTo: sender.replyTo || s.email.replyTo } : {}) } };
  const attempts: FinishRequest['attempts'] = [];
  const tried: { p: ProviderName; a: ApiAttempt }[] = [];
  let usage: FinishRequest['usage'];
  const notes: string[] = [];
  if (route.intended && route.intended !== route.order[0] && order[0] === route.order[0]) notes.push(`${PROVIDER_LABEL[route.intended]} is not set up`);

  for (const p of order) {
    const pausedHere = (p === 'resend' || p === 'ses') && Date.now() < pausedUntil[p];
    if (refused.has(p) || pausedHere) {
      notes.push(`${PROVIDER_LABEL[p]} sending limit reached earlier`);
      continue;
    }
    const startedAt = Date.now();
    const a = await attemptWith(p, base, to, mail, attachments, opts.idempotencyKey, tried.length > 0 || p !== route.order[0] || notes.length > 0);
    tried.push({ p, a });
    if (p === 'resend' && a.usage && (a.usage.daily || a.usage.monthly)) usage = { provider: 'resend', ...a.usage };
    const cls = a.cls;
    attempts.push({ provider: p, outcome: a.ok ? 'ACCEPTED' : cls?.outcome ?? (a.res.retry ? 'RETRYABLE' : 'REJECTED'), category: cls?.category ?? null,
                    status: a.res.code, ref: a.res.ref, ms: Date.now() - startedAt });
    if (a.ok) break;
    if (a.quota && (p === 'resend' || p === 'ses')) pausedUntil[p] = Date.now() + PAUSE_MS;
    if (!a.fallback) break;
  }

  const last = tried[tried.length - 1];
  if (!last) {
    // every provider is paused or out of quota (normal e-mail also keeps the last few for sign-in codes): it waits for the next run
    await finish({ status: 'RETRY_PENDING', attempts, errorCategory: [...refused.values()][0] ?? 'QUOTA_DAILY', usage });
    return { ok: false, retry: true, code: null, ref: null, errorCategory: [...refused.values()][0] ?? 'QUOTA_DAILY',
             detail: `No provider can send right now (${notes.join('; ') || 'paused'}). It waits for the next run.` };
  }
  const fallbackUsed = last.p !== route.intended && (tried.length > 1 || notes.length > 0);
  let result: SendResult;
  if (last.a.ok) {
    const why = [...notes, ...tried.slice(0, -1).map(t => `${PROVIDER_LABEL[t.p]} ${t.a.res.detail}`)].join('; ');
    result = fallbackUsed && why
      ? { ...last.a.res, detail: `Sent through ${FAILOVER_LABEL[last.p]} (fallback): ${why}; ${last.a.res.detail}`.slice(0, 400) }
      : last.a.res;
  } else if (tried.length === 1 && !notes.length) {
    result = last.a.res;
  } else if (tried.length === 1) {
    result = { ...last.a.res, detail: `${last.p === 'smtp' ? 'SMTP fallback failed' : `${PROVIDER_LABEL[last.p]} failed`}: ${notes.join('; ')}; ${last.a.res.detail}`.slice(0, 400) };
  } else {
    const label = (t: { p: ProviderName }, i: number) => (i === 0 ? PROVIDER_LABEL[t.p] : t.p === 'smtp' ? 'SMTP fallback:' : `${PROVIDER_LABEL[t.p]} fallback:`);
    result = { ...last.a.res, retry: tried.some(t => t.a.res.retry), detail: tried.map((t, i) => `${label(t, i)} ${t.a.res.detail}`).join('; ').slice(0, 400) };
  }
  const unknown = last.a.cls?.outcome === 'UNKNOWN_ACCEPTANCE';
  result = { ...result, provider: last.p, errorCategory: last.a.ok ? null : last.a.cls?.category ?? null, unknownAcceptance: unknown || undefined };
  await finish({
    status: last.a.ok ? 'ACCEPTED' : unknown ? 'UNKNOWN_ACCEPTANCE' : result.retry ? 'RETRY_PENDING' : 'FAILED',
    provider: last.p, providerMessageId: last.a.ok ? last.a.res.ref : null, fallbackUsed: last.a.ok && fallbackUsed,
    errorCategory: result.errorCategory, attempts, usage
  });
  return result;
}

// ---------------------------------------------------------------------------
// AWS SES (API v2, SigV4-signed HTTPS; no SDK)
// ---------------------------------------------------------------------------
/**
 * Calls are spaced to SES_MAX_PER_SECOND (default 10; a new account's sandbox allows 1, production starts at 14) so the automations'
 * back-to-back e-mails are not throttled; a 429 is waited out (at most SES_MAX_WAIT_MS) and tried once more.
 */
const SES_MAX_WAIT_MS = 5_000;
let sesNextSlot = 0;

function sesGapMs(): number {
  const n = Number(process.env.SES_MAX_PER_SECOND);
  return Math.ceil(1000 / (Number.isFinite(n) && n >= 1 && n <= 500 ? n : 10));
}

/** AWS error messages can quote addresses: they are removed before a detail is stored or logged. */
const noAddresses = (t: string) => t.replace(/[^\s@<>"',;:]+@[^\s@<>"',;:]+/g, '[address]');

async function sesPost(s: AutomationSettings, body: string): Promise<{ status: number; text: string; error: string }> {
  const ses = s.email.ses!;
  const base = s.email.apiBaseUrl ?? `https://email.${ses.region}.amazonaws.com`;
  const url = `${base.replace(/\/+$/, '')}/v2/email/outbound-emails`;
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    const wait = Math.max(0, sesNextSlot - now);
    sesNextSlot = Math.max(now, sesNextSlot) + sesGapMs();
    if (wait) await sleep(wait);
    const headers = signRequest({
      method: 'POST', url, service: 'ses', region: ses.region, accessKeyId: ses.accessKeyId, secretAccessKey: ses.secretAccessKey,
      headers: { 'content-type': 'application/json' }, body
    });
    delete headers.host; // set by fetch itself (and refused as a request header by some runtimes)
    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = (await res.text()).slice(0, 1000);
    const error = (res.headers.get('x-amzn-errortype') || '').split(':')[0];
    const tooMany = res.status === 429 && !/quota/i.test(text);
    if (!tooMany || attempt >= 1) return { status: res.status, text, error };
    const asked = Number(res.headers.get('retry-after')) * 1000;
    const pause = Number.isFinite(asked) && asked > 0 ? asked : 1000;
    if (pause > SES_MAX_WAIT_MS) return { status: res.status, text, error };
    await sleep(pause);
  }
}

async function sendSes(s: AutomationSettings, to: { email: string; name: string; display?: boolean }, mail: RenderedEmail, attachments?: MailAttachment[]): Promise<ApiAttempt> {
  let body: string;
  try {
    const e = s.email;
    body = JSON.stringify({
      FromEmailAddress: formatMailbox(e.fromName, e.fromEmail),
      Destination: {
        ToAddresses: [to.display ? formatMailbox(to.name, to.email) : formatMailbox('', to.email).replace(/^<|>$/g, '')],
        ...(e.cc.length ? { CcAddresses: e.cc } : {}),
        ...(e.bcc.length ? { BccAddresses: e.bcc } : {})
      },
      ...(e.replyTo ? { ReplyToAddresses: [e.replyTo] } : {}),
      Content: {
        Simple: {
          Subject: { Data: mail.subject.replace(/[\r\n]+/g, ' '), Charset: 'UTF-8' },
          Body: { Html: { Data: mail.html, Charset: 'UTF-8' }, Text: { Data: mail.text, Charset: 'UTF-8' } },
          ...(attachments?.length
            ? { Attachments: attachments.map(a => ({ FileName: a.filename, ContentType: a.contentType, ContentDisposition: 'ATTACHMENT', RawContent: b64(a) })) }
            : {})
        }
      },
      ...(e.ses?.configurationSet ? { ConfigurationSetName: e.ses.configurationSet } : {})
    });
  } catch (err) {
    // an address that is not valid: no provider would accept it
    return { ok: false, res: { ok: false, retry: false, code: null, ref: null, detail: String((err as Error)?.message ?? 'Invalid e-mail.').slice(0, 200) }, fallback: false, quota: false,
             cls: { category: 'INVALID_RECIPIENT', failover: false, retry: false, outcome: 'REJECTED' } };
  }
  let r: { status: number; text: string; error: string };
  try {
    r = await sesPost(s, body);
  } catch (err) {
    // A timeout may mean SES sent it after all: no second copy (UNKNOWN_ACCEPTANCE). A refused connection means it did not.
    const cls = classifyThrown(err);
    return { ok: false, res: networkFailure(err), fallback: cls.failover, quota: false, cls };
  }
  let message = '';
  let ref: string | null = null;
  try {
    const j = JSON.parse(r.text);
    ref = j?.MessageId ?? null;
    message = String(j?.message ?? j?.Message ?? '');
  } catch {
    message = r.text;
  }
  if (r.status >= 200 && r.status < 300) return { ok: true, res: { ok: true, retry: false, code: r.status, ref, detail: `HTTP ${r.status}` }, fallback: false, quota: false };
  const name = r.error || (r.status === 429 ? 'TooManyRequestsException' : '');
  const quota = (r.status === 429 && /quota/i.test(message)) || name === 'SendingPausedException' || name === 'AccountSuspendedException';
  // SES did not send it. Content or request problems would be refused by the mailbox too; everything else (limits, paused account,
  // keys, a domain or sandbox recipient not verified, SES failing) is ours or SES's, not the e-mail's (server/email/classify.ts).
  const cls = classifySes(r.status, name, message);
  const detail = `HTTP ${r.status}${name ? ` ${name}` : ''}${message ? `: ${noAddresses(message).slice(0, 200)}` : ''}`;
  return { ok: false, res: { ok: false, retry: cls.retry, code: r.status, ref: null, detail }, fallback: cls.failover, quota, cls };
}

async function sendResend(
  s: AutomationSettings,
  apiKey: string,
  to: { email: string; name: string; display?: boolean },
  mail: RenderedEmail,
  attachments?: MailAttachment[],
  idempotencyKey?: string
): Promise<ApiAttempt> {
  try {
    // Idempotency-Key: Resend keeps it 24 hours and answers a repeat with the original result instead of sending again
    const headers: Record<string, string> = { authorization: `Bearer ${apiKey}`, ...(idempotencyKey ? { 'idempotency-key': idempotencyKey.slice(0, 256) } : {}) };
    const r = await resendPost(`${s.email.apiBaseUrl ?? 'https://api.resend.com'}/emails`.replace(/([^:]\/)\/+/g, '$1'), headers, {
      from: `${s.email.fromName} <${s.email.fromEmail}>`,
      to: [to.display && to.name && to.name !== to.email ? `${to.name} <${to.email}>` : to.email],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      ...(attachments?.length ? { attachments: attachments.map(a => ({ filename: a.filename, content: b64(a) })) } : {}),
      reply_to: s.email.replyTo,
      ...(s.email.cc.length ? { cc: s.email.cc } : {}),
      ...(s.email.bcc.length ? { bcc: s.email.bcc } : {})
    });
    let ref: string | null = null;
    let name = '';
    try {
      const j = JSON.parse(r.text);
      ref = j?.id ?? null;
      name = String(j?.name ?? '');
    } catch {
      /* not JSON */
    }
    const res = result(r.status, r.text, ref);
    const usage = { daily: r.daily ?? null, monthly: r.monthly ?? null };
    if (res.ok) return { ok: true, res, fallback: false, quota: false, usage };
    let message = '';
    try { message = String(JSON.parse(r.text)?.message ?? ''); } catch { message = r.text; }
    // Resend answered and did not send: quota / rate (429), key or domain refused (401 / 403), Resend failing (5xx) may go to the next
    // provider; an invalid recipient or content (422) would be refused by every provider (server/email/classify.ts)
    const cls = classifyResend(r.status, name, message);
    return { ok: false, res: { ...res, retry: cls.retry }, fallback: cls.failover, quota: cls.category === 'QUOTA_DAILY' || cls.category === 'QUOTA_MONTHLY', cls, usage };
  } catch (err) {
    // A timeout may mean Resend sent it after all: no second copy (UNKNOWN_ACCEPTANCE). A refused connection means it did not.
    const cls = classifyThrown(err);
    return { ok: false, res: networkFailure(err), fallback: cls.failover, quota: false, cls };
  }
}

async function sendBrevo(s: AutomationSettings, apiKey: string, to: { email: string; name: string }, mail: RenderedEmail, attachments?: MailAttachment[]): Promise<SendResult> {
  try {
    const r = await post(`${s.email.apiBaseUrl ?? 'https://api.brevo.com'}/v3/smtp/email`.replace(/([^:]\/)\/+/g, '$1'), { 'api-key': apiKey }, {
      sender: { name: s.email.fromName, email: s.email.fromEmail },
      to: [{ email: to.email, name: to.name }],
      subject: mail.subject,
      htmlContent: mail.html,
      textContent: mail.text,
      ...(attachments?.length ? { attachment: attachments.map(a => ({ name: a.filename, content: b64(a) })) } : {}),
      replyTo: { email: s.email.replyTo },
      ...(s.email.cc.length ? { cc: s.email.cc.map(email => ({ email })) } : {}),
      ...(s.email.bcc.length ? { bcc: s.email.bcc.map(email => ({ email })) } : {})
    });
    let ref: string | null = null;
    try {
      ref = JSON.parse(r.text)?.messageId ?? null;
    } catch {
      /* not JSON */
    }
    return result(r.status, r.text, ref);
  } catch (err) {
    return networkFailure(err);
  }
}

/** The payload the Apps Script posted to the WhatsApp Automation Builder webhook (same keys). */
export interface WhatsAppPayload {
  name: string;
  email: string;
  phone: string;
  department: string;
  website: string;
  whatsapp_number: string;
  status: string;
  source: string;
  automation: 'Client Onboarding';
  event_key: string;
  /** The stage's code (WEBSITE_PENDING, UNDER_REVIEW, META_VERIFICATION, COMPLETED, WEBSITE_READY): a fixed key the WhatsApp router can match exactly, instead of the display text in `status`. */
  stage_code: string;
}

export async function postWhatsApp(s: AutomationSettings, payload: WhatsAppPayload): Promise<SendResult> {
  if (!s.whatsapp.webhookUrl) return { ok: false, retry: false, code: null, ref: null, detail: 'The WhatsApp webhook is not configured.' };
  try {
    const r = await post(s.whatsapp.webhookUrl, {}, payload);
    const res = result(r.status, r.text, null);
    // Keep what the webhook answered: "accepted" only means it received the request, and what the
    // WhatsApp router did with it (for example no route for this status) is visible in its answer.
    const answer = r.text.replace(/\s+/g, ' ').trim().slice(0, 160);
    if (res.ok && answer) res.detail = `HTTP ${r.status}: ${answer}`;
    return res;
  } catch (err) {
    return networkFailure(err);
  }
}
