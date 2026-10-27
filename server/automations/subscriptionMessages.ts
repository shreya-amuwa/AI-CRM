import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { automationSettings, COMPANY, liveChannels } from './config.js';
import { sendEmail } from './providers.js';
import { toText, type RenderedEmail } from './templates.js';

/**
 * Subscription expiry reminders by e-mail and WhatsApp (7, 3 and 1 day before a service expires), next to the reminder calls.
 *
 * Same split as the calls (subscriptionReminders.ts): the database decides what is due and re-checks eligibility when a reminder is
 * claimed (renewed, cancelled, opted out, no address / number, window closed); this module renders the wording and sends.
 *
 * AUTOMATION_MODE_SUB_EMAIL / AUTOMATION_MODE_SUB_WHATSAPP:
 *   off      nothing happens for that channel.
 *   dry_run  (default) the reminder is decided and logged as "would send"; nothing leaves the server.
 *   live     sent through the provider. The database only hands over a reminder whose wording a Super Admin has approved, and the
 *            provider must be configured (e-mail: EMAIL_PROVIDER + keys; WhatsApp: WABASTORE_WEBHOOK_URL). Otherwise live behaves like
 *            "off" and says so: nothing is sent.
 */
export type MessageChannel = 'EMAIL' | 'WHATSAPP';
export type MessageMode = 'off' | 'dry_run' | 'live';

/** What the database hands over for one message: only what is needed to write and address it. */
export interface ReminderMessage {
  id: string;
  channel: MessageChannel;
  attempts: number;
  stage: 7 | 3 | 1;
  expiryDate: string;
  daysLeft: number;
  /** An e-mail address, or +91 and the ten digit mobile number. */
  to: string;
  customerId: string;
  name: string;
  firstName: string;
  company: string | null;
  serviceCode: string;
  serviceName: string | null;
  planName: string | null;
  template: { subject: string | null; body: string; providerTemplate: string | null; approved: boolean };
}

export type MessageOutcome = { outcome: 'ACCEPTED' | 'RETRY' | 'FAILED' | 'SKIPPED'; detail: string; code?: number | null; ref?: string | null };

export interface ReminderMessageSender {
  send(msg: ReminderMessage): Promise<MessageOutcome>;
}

export interface MessageRunSummary {
  mode: MessageMode;
  claimed: number;
  dryRun: number;
  accepted: number;
  retrying: number;
  failed: number;
  skipped: number;
  note?: string;
  error?: string;
}

const MODE_VAR: Record<MessageChannel, string> = { EMAIL: 'AUTOMATION_MODE_SUB_EMAIL', WHATSAPP: 'AUTOMATION_MODE_SUB_WHATSAPP' };

export function messageMode(channel: MessageChannel, env: NodeJS.ProcessEnv = process.env): MessageMode {
  const v = (env[MODE_VAR[channel]] || 'dry_run').trim().toLowerCase();
  return v === 'live' || v === 'off' ? v : 'dry_run';
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const formatDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
};

/** The values a wording may use (the same names the database accepts when the wording is saved). */
export function placeholderValues(msg: ReminderMessage): Record<string, string> {
  return {
    name: msg.name,
    service: msg.serviceName || msg.serviceCode,
    expiryDate: formatDate(msg.expiryDate),
    daysLeft: String(msg.daysLeft),
    company: msg.company || COMPANY.senderName
  };
}

/** Replaces {{placeholder}}; an unknown name is left out rather than printed. `escape` is for HTML. */
export function fillTemplate(text: string, values: Record<string, string>, escape: (s: string) => string = s => s): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_]*)\s*\}\}/g, (_m, key: string) => escape(values[key] ?? ''));
}

/** The e-mail: the approved subject and body with the customer's values, HTML-escaped, in the same plain wrapper as the other e-mails. */
export function renderReminderEmail(msg: ReminderMessage): RenderedEmail {
  const values = placeholderValues(msg);
  const subject = fillTemplate(msg.template.subject ?? '', values).replace(/[\r\n]+/g, ' ').trim() || 'Your subscription is about to expire';
  const paragraphs = fillTemplate(msg.template.body, values, esc)
    .split(/\n{2,}/)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222">${paragraphs}</div>`;
  return { subject, html, text: toText(html) };
}

/** The WhatsApp message text (used when the provider takes free text; a template name is sent along when one is set). */
export function renderReminderWhatsApp(msg: ReminderMessage): string {
  return fillTemplate(msg.template.body, placeholderValues(msg)).trim();
}

const ten = (v: string) => v.replace(/\D/g, '').slice(-10);

/** The e-mail sender: the configured provider (SMTP, Resend or Brevo), with the staging allow-list. */
export function emailMessageSender(): ReminderMessageSender | null {
  const s = automationSettings();
  if (!liveChannels(s).includes('EMAIL')) return null;
  return {
    async send(msg) {
      if (s.testRecipients && !s.testRecipients.emails.has(msg.to.toLowerCase())) {
        return { outcome: 'SKIPPED', detail: 'Not sent: this address is not in AUTOMATION_TEST_RECIPIENTS.' };
      }
      const r = await sendEmail(s, { email: msg.to, name: msg.name }, renderReminderEmail(msg));
      if (r.ok) return { outcome: 'ACCEPTED', detail: r.detail, code: r.code, ref: r.ref };
      return { outcome: r.retry ? 'RETRY' : 'FAILED', detail: r.detail, code: r.code };
    }
  };
}

export interface WabastoreConfig {
  webhookUrl: string | null;
  apiKey: string | null;
  timeoutMs: number;
}

export function wabastoreConfig(env: NodeJS.ProcessEnv = process.env): WabastoreConfig {
  let url: string | null = null;
  const raw = env.WABASTORE_WEBHOOK_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) url = u.toString();
    } catch {
      /* not a URL */
    }
  }
  return { webhookUrl: url, apiKey: env.WABASTORE_API_KEY?.trim() || null, timeoutMs: Math.min(30_000, Math.max(2_000, Number(env.WABASTORE_TIMEOUT_MS) || 10_000)) };
}

/**
 * What is sent to Wabastore for one reminder. PROVISIONAL: the exact fields follow Wabastore's send API once its details are settled; until
 * then the payload carries everything either style needs (an approved template name with its variables, or the finished text).
 */
export function wabastorePayload(msg: ReminderMessage): Record<string, unknown> {
  const values = placeholderValues(msg);
  return {
    reference: `subscription-reminder:${msg.id}`,
    to: msg.to,
    template: msg.template.providerTemplate || null,
    variables: values,
    text: renderReminderWhatsApp(msg),
    language: 'en'
  };
}

export type WabastoreFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

/** The HTTP call to Wabastore, shared by every WhatsApp message the CRM sends through it (reminders, invoices). The reply is never stored: it can echo the message. */
export class WabastoreClient {
  constructor(
    private readonly cfg: WabastoreConfig,
    private readonly doFetch: WabastoreFetch = (url, init) => fetch(url, init)
  ) {}

  /** `to` is +91 and the ten digit number; the staging allow-list is applied here so no caller can forget it. */
  async post(to: string, body: Record<string, unknown>): Promise<MessageOutcome> {
    const url = this.cfg.webhookUrl;
    if (!url) return { outcome: 'FAILED', detail: 'WABASTORE_WEBHOOK_URL is not set (or is not an https address).' };
    if (!/^\+91[6-9]\d{9}$/.test(to)) return { outcome: 'FAILED', detail: 'The customer has no valid Indian mobile number, so nothing was sent.' };
    const tests = automationSettings().testRecipients;
    if (tests && !tests.phones.has(ten(to))) return { outcome: 'SKIPPED', detail: 'Not sent: this number is not in AUTOMATION_TEST_RECIPIENTS.' };

    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    if (this.cfg.apiKey) headers.authorization = `Bearer ${this.cfg.apiKey}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs);
    try {
      const res = await this.doFetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
      const text = (await res.text().catch(() => '')).slice(0, 2000);
      if (res.status >= 200 && res.status < 300) {
        let ref: string | null = null;
        try {
          const j = JSON.parse(text) as Record<string, unknown>;
          const v = j.id ?? j.message_id ?? j.messageId ?? (j.data as Record<string, unknown> | undefined)?.id;
          ref = typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 120) : null;
        } catch {
          /* not JSON */
        }
        return { outcome: 'ACCEPTED', detail: `Wabastore accepted the message (HTTP ${res.status}).`, code: res.status, ref };
      }
      // the reply can echo the message, so only its status is kept
      if (res.status === 408 || res.status === 429 || res.status >= 500) {
        return { outcome: 'RETRY', detail: `Wabastore is busy or unavailable (HTTP ${res.status}). It will be tried again.`, code: res.status };
      }
      return { outcome: 'FAILED', detail: `Wabastore refused the message (HTTP ${res.status}). Check the webhook address, key and template.`, code: res.status };
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      return { outcome: 'RETRY', detail: aborted ? `Wabastore did not answer within ${Math.round(this.cfg.timeoutMs / 1000)} seconds.` : 'Could not reach Wabastore.' };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class WabastoreSender implements ReminderMessageSender {
  private readonly client: WabastoreClient;
  constructor(cfg: WabastoreConfig, doFetch: WabastoreFetch = (url, init) => fetch(url, init)) {
    this.client = new WabastoreClient(cfg, doFetch);
  }

  send(msg: ReminderMessage): Promise<MessageOutcome> {
    return this.client.post(msg.to, wabastorePayload(msg));
  }
}

export function wabastoreSender(env: NodeJS.ProcessEnv = process.env): WabastoreSender | null {
  const cfg = wabastoreConfig(env);
  return cfg.webhookUrl ? new WabastoreSender(cfg) : null;
}

const maskTo = (to: string) => (to.includes('@') ? `${to.slice(0, 1)}***@${to.split('@')[1]}` : `${to.slice(0, 5)}XXXXXX${to.slice(-4)}`);

/** One channel's tick. Never throws (it runs inside the dispatch request, next to the other automations). */
export async function runSubscriptionMessages(
  channel: MessageChannel,
  opts: { db?: SupabaseClient; limit?: number; sender?: ReminderMessageSender | null; mode?: MessageMode } = {}
): Promise<MessageRunSummary> {
  const mode = opts.mode ?? messageMode(channel);
  const out: MessageRunSummary = { mode, claimed: 0, dryRun: 0, accepted: 0, retrying: 0, failed: 0, skipped: 0 };
  const label = channel === 'EMAIL' ? 'e-mail' : 'WhatsApp';
  if (mode === 'off') return { ...out, note: `Expiry reminders by ${label} are switched off (${MODE_VAR[channel]}=off).` };
  if (!opts.db && !hasServiceClient()) return { ...out, note: 'The server has no service key.' };
  if (mode === 'live' && !opts.sender) {
    const how = channel === 'EMAIL' ? 'set EMAIL_PROVIDER and its keys' : 'set WABASTORE_WEBHOOK_URL';
    return { ...out, mode: 'off', note: `Live ${label} reminders are not available: no provider is connected (${how}). Nothing was sent.` };
  }
  const db = opts.db ?? getServiceClient();
  try {
    // decide what is due today for this channel (idempotent: one row per customer, service, expiry date and stage)
    const sched = await db.rpc('sub_reminder_schedule', { p_today: null, p_channels: [channel] });
    if (sched.error) throw new Error(`sub_reminder_schedule: ${sched.error.message}`);
    const limit = opts.limit ?? 20;
    while (out.claimed < limit) {
      const claim = await db.rpc('sub_message_claim', { p_channel: channel, p_limit: Math.min(5, limit - out.claimed), p_mode: mode });
      if (claim.error) throw new Error(`sub_message_claim: ${claim.error.message}`);
      const batch = (claim.data as ReminderMessage[]) ?? [];
      if (batch.length === 0) break;
      for (const msg of batch) {
        out.claimed += 1;
        let result: MessageOutcome | { outcome: 'DRY_RUN'; detail: string; code?: null; ref?: null };
        if (mode !== 'live' || !opts.sender) {
          result = {
            outcome: 'DRY_RUN',
            detail: `Dry run - not sent: ${msg.serviceName ?? msg.serviceCode} expires ${msg.expiryDate} (${msg.daysLeft} day${msg.daysLeft === 1 ? '' : 's'}), ${maskTo(msg.to)}`
          };
        } else if (!msg.template.approved) {
          // the database never hands these over in live mode; this keeps the rule even if that changes
          result = { outcome: 'SKIPPED', detail: 'The wording is not approved yet, so nothing was sent.' };
        } else {
          try {
            result = await opts.sender.send(msg);
          } catch (err) {
            result = { outcome: 'RETRY', detail: `Could not reach the sending service (${(err as Error).name || 'error'}).` };
          }
        }
        const fin = await db.rpc('sub_message_finish', {
          p_reminder: msg.id, p_outcome: result.outcome, p_detail: result.detail, p_response_code: result.code ?? null, p_ref: result.ref ?? null
        });
        if (fin.error) throw new Error(`sub_message_finish: ${fin.error.message}`);
        const status = (fin.data as { status: string }).status;
        if (status === 'DRY_RUN') out.dryRun += 1;
        else if (status === 'ACCEPTED') out.accepted += 1;
        else if (status === 'RETRY') out.retrying += 1;
        else if (status === 'SKIPPED') out.skipped += 1;
        else out.failed += 1;
      }
    }
  } catch (err) {
    out.error = (err as Error)?.message ?? 'unknown';
    console.error(JSON.stringify({ level: 'error', msg: 'subscription message run failed', channel, error: out.error }));
  }
  return out;
}

/** Both channels, e-mail first. Each channel schedules and sends its own reminders. */
export async function runAllSubscriptionMessages(): Promise<{ email: MessageRunSummary; whatsapp: MessageRunSummary }> {
  const email = await runSubscriptionMessages('EMAIL', { sender: emailMessageSender() });
  const whatsapp = await runSubscriptionMessages('WHATSAPP', { sender: wabastoreSender() });
  return { email, whatsapp };
}
