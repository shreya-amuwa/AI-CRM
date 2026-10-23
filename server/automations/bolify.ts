import type { ReminderCall, ReminderCallSender } from './subscriptionReminders.js';
import { automationSettings } from './config.js';
import { cleanIndianMobile } from '../../shared/contactValidation.js';

/**
 * BolifyAI: starts an AI call from a webhook. The Google Sheet script posted { name, phone, email, service, location } as JSON to that
 * webhook and treated any 2xx as "sent"; the CRM sends the same five fields, so the BolifyAI agent behind the webhook needs no change.
 *
 * Settings (server environment only; never in the database, never in browser code):
 *   BOLIFY_WEBHOOK_URL       the webhook that starts a call (https; http only for localhost, for tests). Without it nothing can be called.
 *   BOLIFY_API_KEY           optional. When set it is sent as "Authorization: Bearer <key>" (use only if the webhook asks for one).
 *   BOLIFY_PHONE_FORMAT      optional: "e164" (default, +919876543210), "91" (919876543210) or "10" (9876543210): how the number is written.
 *   BOLIFY_INCLUDE_CONTEXT   optional, "true" adds what the call is about (expiry_date, days_left, reminder_stage, plan, company, reference).
 *                            Off by default so the request is exactly what the sheet sent.
 *   BOLIFY_TIMEOUT_MS        optional, default 10000.
 *   AUTOMATION_TEST_RECIPIENTS  when set, only those phone numbers are called (the other reminders are skipped, not sent).
 *
 * What a response means: 2xx = BolifyAI accepted the request (it does NOT mean the call happened or was answered); 408, 429 and 5xx
 * and network errors = try again later; any other 4xx = the request itself was refused (not retried).
 */
export interface BolifyConfig {
  webhookUrl: string | null;
  apiKey: string | null;
  includeContext: boolean;
  phoneFormat: 'e164' | '91' | '10';
  timeoutMs: number;
}

export function bolifyConfig(env: NodeJS.ProcessEnv = process.env): BolifyConfig {
  let url: string | null = null;
  const raw = env.BOLIFY_WEBHOOK_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) url = u.toString();
    } catch {
      url = null;
    }
  }
  const t = Number(env.BOLIFY_TIMEOUT_MS);
  return {
    webhookUrl: url,
    apiKey: env.BOLIFY_API_KEY?.trim() || null,
    includeContext: (env.BOLIFY_INCLUDE_CONTEXT || '').trim().toLowerCase() === 'true',
    phoneFormat: (['91', '10'] as const).find(f => f === (env.BOLIFY_PHONE_FORMAT || '').trim()) ?? 'e164',
    timeoutMs: Number.isFinite(t) && t >= 1000 && t <= 60_000 ? t : 10_000
  };
}

/** The number written the way the webhook expects it. Anything that is not an Indian mobile number gives ''. */
export function bolifyPhone(raw: unknown, format: BolifyConfig['phoneFormat'] = 'e164'): string {
  const ten = cleanIndianMobile(raw);
  if (!ten) return '';
  return format === '10' ? ten : format === '91' ? `91${ten}` : `+91${ten}`;
}

/** The request body: the five fields of the sheet script (name, phone, email, service, location). */
export function bolifyPayload(call: ReminderCall, includeContext = false, phoneFormat: BolifyConfig['phoneFormat'] = 'e164'): Record<string, string | number | null> {
  const name = [call.firstName, call.lastName].map(s => (s ?? '').trim()).filter(Boolean).join(' ') || call.company || '';
  const body: Record<string, string | number | null> = {
    name,
    phone: bolifyPhone(call.phone, phoneFormat),
    email: call.email ?? '',
    service: call.serviceName ?? call.serviceCode,
    location: call.location ?? ''
  };
  if (includeContext) {
    body.company = call.company ?? '';
    body.plan = call.planName ?? '';
    body.expiry_date = call.expiryDate;
    body.days_left = call.daysLeft;
    body.reminder_stage = call.stage;
    // one reference per reminder: a retry carries the same one, so BolifyAI can recognise it
    body.reference = call.id;
  }
  return body;
}

/** Looks for a call id in the usual places of a JSON reply; null when there is none (the sheet script never had one). */
function callIdOf(text: string): string | null {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    const d = (j.data && typeof j.data === 'object' ? (j.data as Record<string, unknown>) : {}) as Record<string, unknown>;
    for (const v of [j.call_id, j.callId, j.id, j.uuid, d.call_id, d.callId, d.id]) {
      if ((typeof v === 'string' && v) || typeof v === 'number') return String(v).slice(0, 200);
    }
  } catch {
    /* not JSON: a plain "ok" is fine */
  }
  return null;
}

export type BolifyFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

export class BolifyWebhookSender implements ReminderCallSender {
  constructor(
    private readonly cfg: BolifyConfig,
    private readonly doFetch: BolifyFetch = (url, init) => fetch(url, init)
  ) {}

  async place(call: ReminderCall) {
    return this.post(bolifyPayload(call, this.cfg.includeContext, this.cfg.phoneFormat), call.phone);
  }

  /** One customer, on demand (the Technical Consultant's AI Calling automation): same five fields as the sheet script. */
  async callCustomer(c: { name: string; company?: string | null; phone: string | null; whatsapp?: string | null; email?: string | null; city?: string | null }, services: string[]) {
    const phone = bolifyPhone(c.phone, this.cfg.phoneFormat) || bolifyPhone(c.whatsapp, this.cfg.phoneFormat);
    return this.post({ name: (c.name || c.company || '').trim(), phone, email: c.email ?? '', service: services.join(', '), location: c.city ?? '' }, phone);
  }

  private async post(body: Record<string, string | number | null>, phoneForCheck: unknown) {
    const url = this.cfg.webhookUrl;
    if (!url) return { outcome: 'FAILED' as const, detail: 'BOLIFY_WEBHOOK_URL is not set (or is not an https address).' };
    if (!cleanIndianMobile(body.phone) || !cleanIndianMobile(phoneForCheck)) {
      return { outcome: 'FAILED' as const, detail: 'The customer has no valid Indian mobile number, so nobody was called.' };
    }

    // staging safety: only the listed numbers are called
    const tests = automationSettings().testRecipients;
    if (tests && !tests.phones.has(cleanIndianMobile(body.phone))) {
      return { outcome: 'SKIPPED' as const, detail: 'Not called: this number is not in AUTOMATION_TEST_RECIPIENTS.' };
    }

    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs);
    try {
      const res = await this.doFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
      const text = (await res.text().catch(() => '')).slice(0, 2000);
      if (res.status >= 200 && res.status < 300) {
        return { outcome: 'ACCEPTED' as const, detail: `BolifyAI accepted the request (HTTP ${res.status}).`, code: res.status, callId: callIdOf(text) };
      }
      // the reply can echo the request, so it is not stored; only its status
      if (res.status === 408 || res.status === 429 || res.status >= 500) {
        return { outcome: 'RETRY' as const, detail: `BolifyAI is busy or unavailable (HTTP ${res.status}). It will be tried again.`, code: res.status };
      }
      return { outcome: 'FAILED' as const, detail: `BolifyAI refused the request (HTTP ${res.status}). Check the webhook address and key.`, code: res.status };
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      return { outcome: 'RETRY' as const, detail: aborted ? `BolifyAI did not answer within ${Math.round(this.cfg.timeoutMs / 1000)} seconds.` : 'Could not reach BolifyAI.' };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The sender for live calls, or null when no webhook is configured (live then stays refused and nobody is called). */
export function bolifySender(env: NodeJS.ProcessEnv = process.env): BolifyWebhookSender | null {
  const cfg = bolifyConfig(env);
  return cfg.webhookUrl ? new BolifyWebhookSender(cfg) : null;
}
