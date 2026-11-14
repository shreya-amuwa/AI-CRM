// Type only: nodemailer itself is loaded in sendSmtp, when a message is really sent through SMTP (it is slow to load, so it is kept out of every start of the API).
import type nodemailer from 'nodemailer';
import type { AutomationSettings } from './config.js';
import { buildMime, formatMailbox, smtpSendRaw, SmtpError, socketConnector } from './smtpSocket.js';
import { signRequest } from '../storage/sigv4.js';
import type { RenderedEmail } from './templates.js';

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
}

const TIMEOUT_MS = 15_000;

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; text: string; retryAfter: string | null }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  return { status: res.status, text: (await res.text()).slice(0, 1000), retryAfter: res.headers.get('retry-after') };
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

async function resendPost(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; text: string; retryAfter: string | null }> {
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    const wait = Math.max(0, resendNextSlot - now);
    resendNextSlot = Math.max(now, resendNextSlot) + resendGapMs();
    if (wait) await sleep(wait);
    const r = await post(url, headers, body);
    if (r.status !== 429 || attempt >= 1) return r;
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
 * Resend -> SMTP fallback. With EMAIL_PROVIDER=resend and the SMTP_* mailbox (meta@amuwa.com) also set, an e-mail Resend does not
 * accept goes out through the mailbox instead, so clients still get it when the Resend plan's daily / monthly limit is reached, the
 * account is refused, or Resend is down. Not used when Resend's answer is unknown (a timeout: it may have sent the e-mail, and a second
 * copy must not go out) or the request itself is wrong (an invalid address: the mailbox would refuse it too); those stay queued and are
 * retried as before. After a quota answer Resend is skipped for RESEND_PAUSE_MS so the next e-mails do not wait for the same refusal.
 */
const PAUSE_MS = 15 * 60_000;
const pausedUntil: Record<'resend' | 'ses', number> = { resend: 0, ses: 0 };

/** Tests only: forget a quota pause. */
export function resetResendPause(): void {
  pausedUntil.resend = 0;
  pausedUntil.ses = 0;
}

function smtpFallbackOn(s: AutomationSettings): boolean {
  return (s.email.provider === 'resend' || s.email.provider === 'ses') && !!s.email.smtp && s.email.smtpFallback === true;
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

type ApiAttempt = { ok: boolean; res: SendResult; fallback: boolean; quota: boolean };

/**
 * Sends one email through the configured provider: SMTP (nodemailer, or sockets on Workers), AWS SES or Resend (each with the SMTP
 * mailbox as backup), or Brevo.
 */
export async function sendEmail(s: AutomationSettings, to: { email: string; name: string; /** Resend / SES: send as "Name <address>" so the recipient's mail app shows the name. */ display?: boolean }, mail: RenderedEmail, attachments?: MailAttachment[]): Promise<SendResult> {
  const { provider, apiKey } = s.email;
  if (provider === 'smtp') return sendSmtp(s, to, mail, attachments);
  if (provider === 'resend' || provider === 'ses') {
    const label = provider === 'ses' ? 'SES' : 'Resend';
    const ready = provider === 'ses' ? !!s.email.ses : !!apiKey;
    const attempt = (): Promise<ApiAttempt> => (provider === 'ses' ? sendSes(s, to, mail, attachments) : sendResend(s, apiKey!, to, mail, attachments));
    if (smtpFallbackOn(s)) {
      const why = !ready ? `${label} is not set up` : Date.now() < pausedUntil[provider] ? `${label} sending limit reached earlier` : null;
      if (why) return withFallbackNote(await sendSmtp(backupSettings(s), to, mail, attachments), why);
      const first = await attempt();
      if (first.ok || !first.fallback) return first.res;
      if (first.quota) pausedUntil[provider] = Date.now() + PAUSE_MS;
      const second = await sendSmtp(backupSettings(s), to, mail, attachments);
      if (second.ok) return withFallbackNote(second, `${label} ${first.res.detail}`);
      // both refused: keep it queued while either may recover
      return { ...second, retry: second.retry || first.res.retry, detail: `${label} ${first.res.detail}; SMTP fallback: ${second.detail}`.slice(0, 400) };
    }
    if (!ready) return { ok: false, retry: false, code: null, ref: null, detail: 'Email sending is not configured.' };
    return (await attempt()).res;
  }
  if (!provider || !apiKey) return { ok: false, retry: false, code: null, ref: null, detail: 'Email sending is not configured.' };
  return sendBrevo(s, apiKey, to, mail, attachments);
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
    return { ok: false, res: { ok: false, retry: false, code: null, ref: null, detail: String((err as Error)?.message ?? 'Invalid e-mail.').slice(0, 200) }, fallback: false, quota: false };
  }
  let r: { status: number; text: string; error: string };
  try {
    r = await sesPost(s, body);
  } catch (err) {
    // A timeout may mean SES sent it after all: no second copy. A refused connection means it did not.
    const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, res: networkFailure(err), fallback: !timeout, quota: false };
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
  // keys, a domain or sandbox recipient not verified, SES failing) is ours or SES's, not the e-mail's.
  const invalid = (name === 'BadRequestException' || name === 'MessageRejected') && !/not verified|not authori[sz]ed|identit/i.test(message);
  const fallback = !invalid;
  const detail = `HTTP ${r.status}${name ? ` ${name}` : ''}${message ? `: ${noAddresses(message).slice(0, 200)}` : ''}`;
  return { ok: false, res: { ok: false, retry: !invalid, code: r.status, ref: null, detail }, fallback, quota };
}

function withFallbackNote(r: SendResult, why: string): SendResult {
  return { ...r, detail: `${r.ok ? 'Sent through the SMTP mailbox (fallback)' : 'SMTP fallback failed'}: ${why}; ${r.detail}`.slice(0, 400) };
}

async function sendResend(
  s: AutomationSettings,
  apiKey: string,
  to: { email: string; name: string; display?: boolean },
  mail: RenderedEmail,
  attachments?: MailAttachment[]
): Promise<{ ok: boolean; res: SendResult; fallback: boolean; quota: boolean }> {
  try {
    const r = await resendPost(`${s.email.apiBaseUrl ?? 'https://api.resend.com'}/emails`.replace(/([^:]\/)\/+/g, '$1'), { authorization: `Bearer ${apiKey}` }, {
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
    // Resend answered and did not send: 429 (rate or daily / monthly quota), 401 / 403 (key or domain refused), 5xx (Resend failing).
    const fallback = !res.ok && (r.status === 429 || r.status === 401 || r.status === 403 || r.status >= 500);
    const quota = r.status === 429 && /quota/i.test(`${name} ${r.text}`);
    return { ok: res.ok, res, fallback, quota };
  } catch (err) {
    // A timeout may mean Resend sent it after all: no second copy. A refused connection means it did not.
    const timeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, res: networkFailure(err), fallback: !timeout, quota: false };
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
