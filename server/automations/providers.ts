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

/** Sends one email through the configured transactional provider (Resend or Brevo). */
export async function sendEmail(s: AutomationSettings, to: { email: string; name: string }, mail: RenderedEmail): Promise<SendResult> {
  const { provider, apiKey } = s.email;
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
    return result(r.status, r.text, null);
  } catch (err) {
    return networkFailure(err);
  }
}
