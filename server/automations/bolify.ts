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

// ---------------------------------------------------------------------------------------------------------------------------------
// The BolifyAI calling API (POST https://api.bolifyai.com/api/v1/playground/call, header x-api-key)
// ---------------------------------------------------------------------------------------------------------------------------------
/**
 * Settings (server environment / Cloudflare Worker secrets only; never VITE_ / NEXT_PUBLIC_, never in the database, never returned by an API):
 *   BOLIFY_API_KEY        secret. Sent only as the "x-api-key" header. Never logged, never in an error or a record.
 *   BOLIFY_API_URL        optional, default https://api.bolifyai.com/api/v1/playground/call (https only; http only for localhost, for tests).
 *   BOLIFY_ASSISTANT_ID   optional, default the panel recharge assistant.
 *   BOLIFY_DIALER_ID      optional, default the company dialer.
 *   BOLIFY_PHONE_FORMAT, BOLIFY_TIMEOUT_MS and AUTOMATION_TEST_RECIPIENTS as above.
 * It is used when BOLIFY_API_KEY is set and BOLIFY_WEBHOOK_URL is not (a configured webhook keeps working exactly as before).
 *
 * What a reply means:
 *   2xx (and the body does not say success: false)  ACCEPTED = BolifyAI took the request. It does NOT mean the call was answered.
 *   429 or 503                                      RETRY: BolifyAI said it did not take the request; tried again later (3 attempts at most).
 *   a timeout, a lost connection, any other 5xx     FAILED and NOT retried: the request may have reached BolifyAI and a call may be on its way,
 *                                                   so a retry could call the customer twice. Staff see it as failed with that reason.
 *   any other 4xx, or success: false                FAILED: refused (key, ids or number). Not retried.
 * Each request carries "Idempotency-Key: <reminder id>", so a provider that supports it can drop a repeat.
 */
export const BOLIFY_DEFAULT_API_URL = 'https://api.bolifyai.com/api/v1/playground/call';
export const BOLIFY_DEFAULT_ASSISTANT_ID = '567eaefd-bc8f-42c2-8bff-c1d1ac2f97ba';
export const BOLIFY_DEFAULT_DIALER_ID = 'c19c9cff-d96d-48b7-b163-1c62be020e6d';

export interface BolifyApiConfig {
  apiUrl: string | null;
  apiKey: string | null;
  assistantId: string;
  dialerId: string;
  phoneFormat: BolifyConfig['phoneFormat'];
  timeoutMs: number;
}

const ID_RX = /^[A-Za-z0-9-]{8,64}$/;

function safeUrl(raw: string | undefined, fallback: string | null): string | null {
  const v = raw?.trim() || fallback;
  if (!v) return null;
  try {
    const u = new URL(v);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return u.protocol === 'https:' || (u.protocol === 'http:' && local) ? u.toString() : null;
  } catch {
    return null;
  }
}

export function bolifyApiConfig(env: NodeJS.ProcessEnv = process.env): BolifyApiConfig {
  const base = bolifyConfig(env);
  const assistant = env.BOLIFY_ASSISTANT_ID?.trim();
  const dialer = env.BOLIFY_DIALER_ID?.trim();
  return {
    apiUrl: safeUrl(env.BOLIFY_API_URL, BOLIFY_DEFAULT_API_URL),
    apiKey: env.BOLIFY_API_KEY?.trim() || null,
    assistantId: assistant && ID_RX.test(assistant) ? assistant : BOLIFY_DEFAULT_ASSISTANT_ID,
    dialerId: dialer && ID_RX.test(dialer) ? dialer : BOLIFY_DEFAULT_DIALER_ID,
    phoneFormat: base.phoneFormat,
    timeoutMs: base.timeoutMs
  };
}

const DATE_FMT = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** 2026-11-20 -> "20 Nov 2026" (a calendar date, so it is formatted as UTC and can never shift by a day). */
export function bolifyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : DATE_FMT.format(d);
}

/** The body of the calling API for one reminder. Only what the call needs: name, number, e-mail and what the call is about. */
export function bolifyApiPayload(
  call: Pick<ReminderCall, 'firstName' | 'lastName' | 'company' | 'phone' | 'email' | 'serviceName' | 'serviceCode' | 'expiryDate' | 'daysLeft'>,
  cfg: Pick<BolifyApiConfig, 'assistantId' | 'dialerId' | 'phoneFormat'>
) {
  const first = (call.firstName ?? '').trim() || (call.company ?? '').trim();
  const service = call.serviceName ?? call.serviceCode;
  return {
    first_name: first,
    last_name: (call.firstName ?? '').trim() ? (call.lastName ?? '').trim() : '',
    email: (call.email ?? '').trim(),
    phone_number: [bolifyPhone(call.phone, cfg.phoneFormat)],
    assistant_id: cfg.assistantId,
    dialer_id: cfg.dialerId,
    description: `Panel recharge reminder: ${service} expires on ${bolifyDate(call.expiryDate)} (${call.daysLeft} day${call.daysLeft === 1 ? '' : 's'} left).`
  };
}

/** What BolifyAI answered, without anything that could be a secret or a full phone number. */
export interface BolifyResponseSummary {
  httpStatus: number;
  success?: boolean;
  message?: string;
  callId?: string;
}

function summarize(status: number, text: string, secret: string | null): BolifyResponseSummary {
  const out: BolifyResponseSummary = { httpStatus: status };
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (typeof j.success === 'boolean') out.success = j.success;
    else if (typeof j.status === 'string' && /^(success|ok|error|failed)$/i.test(j.status)) out.success = /^(success|ok)$/i.test(j.status);
    const m = [j.message, j.msg, j.error, j.detail].find(v => typeof v === 'string' && v.trim()) as string | undefined;
    // a reply can echo the request: the key and long numbers (phone numbers) never reach the record
    if (m) out.message = (secret ? m.split(secret).join('[key]') : m).replace(/\d{6,}/g, '[number]').slice(0, 300);
  } catch {
    /* not JSON */
  }
  const id = callIdOf(text);
  if (id) out.callId = id;
  return out;
}

type SendResult = { outcome: 'ACCEPTED' | 'RETRY' | 'FAILED' | 'SKIPPED'; detail: string; code?: number | null; callId?: string | null; response?: BolifyResponseSummary | null };

export class BolifyApiSender implements ReminderCallSender {
  constructor(
    private readonly cfg: BolifyApiConfig,
    private readonly doFetch: BolifyFetch = (url, init) => fetch(url, init)
  ) {}

  async place(call: ReminderCall): Promise<SendResult> {
    return this.post(bolifyApiPayload(call, this.cfg), call.phone, call.id);
  }

  /** One customer, on demand (the Technical Consultant's AI Calling automation). */
  async callCustomer(c: { name: string; company?: string | null; phone: string | null; whatsapp?: string | null; email?: string | null; city?: string | null }, services: string[]) {
    const phone = bolifyPhone(c.phone, this.cfg.phoneFormat) || bolifyPhone(c.whatsapp, this.cfg.phoneFormat);
    const [first, ...rest] = (c.name || c.company || '').trim().split(/\s+/);
    const body = {
      first_name: first ?? '', last_name: rest.join(' '), email: (c.email ?? '').trim(), phone_number: [phone],
      assistant_id: this.cfg.assistantId, dialer_id: this.cfg.dialerId, description: services.length ? `About: ${services.join(', ')}` : ''
    };
    return this.post(body, phone, null);
  }

  private async post(body: ReturnType<typeof bolifyApiPayload>, phoneForCheck: unknown, reference: string | null): Promise<SendResult> {
    const url = this.cfg.apiUrl;
    if (!url || !this.cfg.apiKey) return { outcome: 'FAILED', detail: 'BolifyAI is not configured on the server (BOLIFY_API_KEY).' };
    const ten = cleanIndianMobile(body.phone_number[0]);
    if (!ten || !cleanIndianMobile(phoneForCheck)) {
      return { outcome: 'FAILED', detail: 'The customer has no valid Indian mobile number, so nobody was called.' };
    }
    if (!body.first_name) return { outcome: 'FAILED', detail: 'The customer has no name, so the call was not placed.' };

    // staging safety: only the listed numbers are called
    const tests = automationSettings().testRecipients;
    if (tests && !tests.phones.has(ten)) {
      return { outcome: 'SKIPPED', detail: 'Not called: this number is not in AUTOMATION_TEST_RECIPIENTS.' };
    }

    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': this.cfg.apiKey };
    if (reference) headers['idempotency-key'] = reference;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs);
    let res: { status: number; text(): Promise<string> };
    try {
      res = await this.doFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      return {
        outcome: 'FAILED',
        detail: aborted
          ? `BolifyAI did not answer within ${Math.round(this.cfg.timeoutMs / 1000)} seconds. The call may or may not have been placed, so it is not retried automatically (no duplicate call).`
          : 'The connection to BolifyAI was lost. The call may or may not have been placed, so it is not retried automatically (no duplicate call).',
        response: null
      };
    } finally {
      clearTimeout(timer);
    }
    const text = (await res.text().catch(() => '')).slice(0, 4000);
    const response = summarize(res.status, text, this.cfg.apiKey);
    if (res.status >= 200 && res.status < 300) {
      if (response.success === false) {
        return { outcome: 'FAILED', detail: `BolifyAI refused the call${response.message ? `: ${response.message}` : '.'}`, code: res.status, response };
      }
      return { outcome: 'ACCEPTED', detail: `BolifyAI accepted the call request (HTTP ${res.status}).`, code: res.status, callId: response.callId ?? null, response };
    }
    if (res.status === 429 || res.status === 503) {
      return { outcome: 'RETRY', detail: `BolifyAI is busy (HTTP ${res.status}) and did not take the request. It will be tried again.`, code: res.status, response };
    }
    if (res.status >= 500) {
      return { outcome: 'FAILED', detail: `BolifyAI had an error (HTTP ${res.status}). Not retried automatically, in case the call was placed.`, code: res.status, response };
    }
    const hint = res.status === 401 || res.status === 403 ? ' Check BOLIFY_API_KEY.' : res.status === 400 || res.status === 422 ? ' Check the number and the assistant / dialer ids.' : '';
    return { outcome: 'FAILED', detail: `BolifyAI refused the request (HTTP ${res.status}).${hint}`, code: res.status, response };
  }
}

/**
 * The sender for live calls, or null when BolifyAI is not configured (live then stays refused and nobody is called).
 * BOLIFY_WEBHOOK_URL set: the webhook (unchanged). Otherwise BOLIFY_API_KEY set: the BolifyAI calling API.
 */
export function bolifySender(env: NodeJS.ProcessEnv = process.env): BolifyWebhookSender | BolifyApiSender | null {
  const cfg = bolifyConfig(env);
  if (cfg.webhookUrl) return new BolifyWebhookSender(cfg);
  const api = bolifyApiConfig(env);
  return api.apiKey && api.apiUrl ? new BolifyApiSender(api) : null;
}

/**
 * A call result posted by BolifyAI (POST /api/v1/internal/bolify/call-status). Provisional field names until BolifyAI confirms its callback:
 * the call id in call_id / callId / id (or data.*), the status in status / call_status / outcome, the length in duration / duration_seconds.
 * Returns null when there is no call id; outcome null when the status is one that does not end a call (queued, ringing ...).
 */
export function bolifyCallResult(raw: unknown): { callId: string; outcome: 'COMPLETED' | 'NOT_ANSWERED' | 'BUSY' | 'FAILED' | null; durationSeconds: number | null; detail: string | null } | null {
  if (!raw || typeof raw !== 'object') return null;
  const top = raw as Record<string, unknown>;
  const j = { ...(top.data && typeof top.data === 'object' ? (top.data as Record<string, unknown>) : {}), ...top };
  const id = [j.call_id, j.callId, j.id].find(v => (typeof v === 'string' && v.trim()) || typeof v === 'number');
  if (id === undefined) return null;
  const callId = String(id).trim().slice(0, 200);
  const st = String(j.status ?? j.call_status ?? j.outcome ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const outcome =
    ['completed', 'answered', 'ended', 'success', 'connected'].includes(st) ? 'COMPLETED'
    : ['no_answer', 'not_answered', 'unanswered', 'missed'].includes(st) ? 'NOT_ANSWERED'
    : st === 'busy' ? 'BUSY'
    : ['failed', 'error', 'cancelled', 'canceled', 'rejected', 'invalid_number'].includes(st) ? 'FAILED'
    : null;
  const d = Number(j.duration ?? j.duration_seconds ?? j.call_duration);
  const durationSeconds = Number.isFinite(d) && d >= 0 && d <= 86400 ? Math.round(d) : null;
  const detail = typeof j.detail === 'string' ? j.detail.replace(/\d{6,}/g, '[number]').slice(0, 200) : null;
  return { callId, outcome, durationSeconds, detail };
}
