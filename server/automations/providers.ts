import nodemailer from 'nodemailer';
import type { AutomationSettings } from './config.js';
import type { RenderedEmail } from './templates.js';

/** What a provider call ended in. `retry` = worth trying again later (timeout, 5xx, 429). */
export interface SendResult {
  ok: boolean;
  retry: boolean;
  code: number | null;
  ref: string | null;
  detail: string;
}

const TIMEOUT_MS = 15_000;

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  return { status: res.status, text: (await res.text()).slice(0, 1000) };
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
async function sendSmtp(s: AutomationSettings, to: { email: string; name: string }, mail: RenderedEmail): Promise<SendResult> {
  const smtp = s.email.smtp;
  if (!smtp) return { ok: false, retry: false, code: null, ref: null, detail: 'SMTP is not configured.' };
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000
  });
  try {
    const info = await transport.sendMail({
      from: { name: s.email.fromName, address: s.email.fromEmail },
      to: { name: to.name, address: to.email },
      replyTo: s.email.replyTo,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
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
export async function sendEmail(s: AutomationSettings, to: { email: string; name: string }, mail: RenderedEmail): Promise<SendResult> {
  const { provider, apiKey } = s.email;
  if (provider === 'smtp') return sendSmtp(s, to, mail);
  if (!provider || !apiKey) return { ok: false, retry: false, code: null, ref: null, detail: 'Email sending is not configured.' };
  try {
    if (provider === 'resend') {
      const r = await post(`${s.email.apiBaseUrl ?? 'https://api.resend.com'}/emails`.replace(/([^:]\/)\/+/g, '$1'), { authorization: `Bearer ${apiKey}` }, {
        from: `${s.email.fromName} <${s.email.fromEmail}>`,
        to: [to.email],
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
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
