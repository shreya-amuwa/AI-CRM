import nodemailer from 'nodemailer';
import type { AutomationSettings } from './config.js';
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
  let transport: ReturnType<typeof nodemailer.createTransport>;
  try {
    transport = nodemailer.createTransport({
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

/** Sends one email through the configured provider: SMTP (nodemailer), Resend or Brevo. */
export async function sendEmail(s: AutomationSettings, to: { email: string; name: string; /** Resend only: send as "Name <address>" so the recipient's mail app shows the name. */ display?: boolean }, mail: RenderedEmail, attachments?: MailAttachment[]): Promise<SendResult> {
  const { provider, apiKey } = s.email;
  if (provider === 'smtp') return sendSmtp(s, to, mail, attachments);
  if (!provider || !apiKey) return { ok: false, retry: false, code: null, ref: null, detail: 'Email sending is not configured.' };
  try {
    if (provider === 'resend') {
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
      try {
        ref = JSON.parse(r.text)?.id ?? null;
      } catch {
        /* not JSON */
      }
      return result(r.status, r.text, ref);
    }
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
