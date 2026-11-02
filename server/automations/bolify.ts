import type { ReminderCall, ReminderCallSender } from './subscriptionReminders.js';
import { automationSettings } from './config.js';
import { cleanIndianMobile } from '../../shared/contactValidation.js';

/**
 * BolifyAI. Two ways to start a call, chosen by what is configured:
 *
 *  1. THE API (use this): POST https://api.bolifyai.com/api/v1/playground/call with the key in "x-api-key" and
 *       { first_name, last_name, email, phone_number: ["+91..."], assistant_id, dialer_id, description }
 *     exactly the call the Google Sheet script (onBolifySheetEdit) already makes. Needs BOLIFY_API_KEY, BOLIFY_ASSISTANT_ID and BOLIFY_DIALER_ID.
 *  2. A WEBHOOK (older): BOLIFY_WEBHOOK_URL, the five fields name / phone / email / service / location, optional Bearer key.
 *
 * What follows describes the webhook; the API shares everything else (what a reply means, staging allow-list, retries).
 *
 * Starts an AI call from a webhook. The Google Sheet script posted { name, phone, email, service, location } as JSON to that
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
  /** The BolifyAI API (preferred): set when the key, the assistant and the dialer are all configured. */
  api: { url: string; assistantId: string; dialerId: string } | null;
  webhookUrl: string | null;
  apiKey: string | null;
  includeContext: boolean;
  phoneFormat: 'e164' | '91' | '10';
  timeoutMs: number;
}

/** BolifyAI's call endpoint (the one the Google Sheet script uses). */
export const BOLIFY_API_URL = 'https://api.bolifyai.com/api/v1/playground/call';

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
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const assistantId = (env.BOLIFY_ASSISTANT_ID || '').trim();
  const dialerId = (env.BOLIFY_DIALER_ID || '').trim();
  let apiUrl = BOLIFY_API_URL;
  const customUrl = (env.BOLIFY_API_URL || '').trim();
  if (customUrl) {
    try {
      const u = new URL(customUrl);
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      apiUrl = u.protocol === 'https:' || (u.protocol === 'http:' && local) ? u.toString() : '';
    } catch {
      apiUrl = '';
    }
  }
  const key = env.BOLIFY_API_KEY?.trim() || null;
  return {
    api: key && apiUrl && uuid.test(assistantId) && uuid.test(dialerId) ? { url: apiUrl, assistantId, dialerId } : null,
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

/**
 * The request the BolifyAI API takes (the body of the sheet script's UrlFetchApp call). The sheet needed a last name, so a customer with only
 * one name is sent "-" rather than an empty string. `description` is what the call is about; it is empty unless BOLIFY_INCLUDE_CONTEXT=true,
 * which is how the sheet sent it.
 */
export function bolifyApiPayload(
  p: { firstName: string; lastName: string; email: string | null; phone: string; description: string },
  api: { assistantId: string; dialerId: string },
  includeContext: boolean
) {
  return {
    first_name: p.firstName.trim() || '-',
    last_name: p.lastName.trim() || '-',
    email: p.email ?? '',
    phone_number: [p.phone],
    assistant_id: api.assistantId,
    dialer_id: api.dialerId,
    description: includeContext ? p.description.slice(0, 1000) : ''
  };
}

/** What a reminder call is about, in one sentence the agent can say. */
export function reminderDescription(call: ReminderCall): string {
  const when = call.daysLeft === 1 ? 'tomorrow' : `in ${call.daysLeft} days`;
  const plan = call.planName ? ` (${call.planName} plan)` : '';
  return `Reminder: ${call.serviceName ?? call.serviceCode}${plan}${call.company ? ` for ${call.company}` : ''} expires on ${call.expiryDate}, ${when}. Reference ${call.id}.`;
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
    if (this.cfg.api) {
      const phone = bolifyPhone(call.phone, this.cfg.phoneFormat);
      return this.send(
        this.cfg.api.url, { 'x-api-key': this.cfg.apiKey ?? '' },
        bolifyApiPayload({ firstName: call.firstName || call.company || '', lastName: call.lastName, email: call.email, phone, description: reminderDescription(call) }, this.cfg.api, this.cfg.includeContext),
        phone, call.phone
      );
    }
    return this.postWebhook(bolifyPayload(call, this.cfg.includeContext, this.cfg.phoneFormat), call.phone);
  }

  /** One customer, on demand (the Technical Consultant's AI Calling automation). */
  async callCustomer(c: { name: string; company?: string | null; phone: string | null; whatsapp?: string | null; email?: string | null; city?: string | null }, services: string[]) {
    const phone = bolifyPhone(c.phone, this.cfg.phoneFormat) || bolifyPhone(c.whatsapp, this.cfg.phoneFormat);
    if (this.cfg.api) {
      const full = (c.name || c.company || '').trim();
      const first = full.split(/\s+/)[0] ?? '';
      return this.send(
        this.cfg.api.url, { 'x-api-key': this.cfg.apiKey ?? '' },
        bolifyApiPayload({ firstName: first, lastName: full.slice(first.length), email: c.email ?? '', phone, description: services.length ? `Services: ${services.join(', ')}` : '' }, this.cfg.api, this.cfg.includeContext),
        phone, phone
      );
    }
    return this.postWebhook({ name: (c.name || c.company || '').trim(), phone, email: c.email ?? '', service: services.join(', '), location: c.city ?? '' }, phone);
  }

  private async postWebhook(body: Record<string, string | number | null>, phoneForCheck: unknown) {
    const url = this.cfg.webhookUrl;
    if (!url) return { outcome: 'FAILED' as const, detail: 'BOLIFY_WEBHOOK_URL is not set (or is not an https address).' };
    const headers: Record<string, string> = {};
    if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;
    return this.send(url, headers, body, String(body.phone ?? ''), phoneForCheck);
  }

  /** The one place a request leaves the server. */
  private async send(url: string, extraHeaders: Record<string, string>, body: unknown, phone: string, phoneForCheck: unknown) {
    if (!cleanIndianMobile(phone) || !cleanIndianMobile(phoneForCheck)) {
      return { outcome: 'FAILED' as const, detail: 'The customer has no valid Indian mobile number, so nobody was called.' };
    }

    // staging safety: only the listed numbers are called
    const tests = automationSettings().testRecipients;
    if (tests && !tests.phones.has(cleanIndianMobile(phone))) {
      return { outcome: 'SKIPPED' as const, detail: 'Not called: this number is not in AUTOMATION_TEST_RECIPIENTS.' };
    }

    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json', ...extraHeaders };
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
      return { outcome: 'FAILED' as const, detail: `BolifyAI refused the request (HTTP ${res.status}). Check the ${this.cfg.api ? 'API key, assistant and dialer' : 'webhook address and key'}.`, code: res.status };
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      return { outcome: 'RETRY' as const, detail: aborted ? `BolifyAI did not answer within ${Math.round(this.cfg.timeoutMs / 1000)} seconds.` : 'Could not reach BolifyAI.' };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The sender for live calls, or null when nothing is configured (live then stays refused and nobody is called). */
export function bolifySender(env: NodeJS.ProcessEnv = process.env): BolifyWebhookSender | null {
  const cfg = bolifyConfig(env);
  return cfg.api || cfg.webhookUrl ? new BolifyWebhookSender(cfg) : null;
}
