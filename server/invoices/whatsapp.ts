import type { SupabaseClient } from '@supabase/supabase-js';
import { invoiceDate, rs, toPaise } from '../../shared/invoiceCalc.js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { automationSettings } from '../automations/config.js';
import { WabastoreClient, wabastoreConfig, type MessageOutcome, type WabastoreFetch } from '../automations/subscriptionMessages.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

/**
 * The paid invoice by WhatsApp (through Wabastore). The database decides and records (invoice_whatsapp_* functions: one dispatch per invoice
 * and number, retries, history); this module only sends what the database hands over.
 *
 * AUTOMATION_MODE_INVOICE_WHATSAPP (when it is not set, AUTOMATION_MODE - the one switch the onboarding messages use - decides):
 *   off      nothing is processed.
 *   dry_run  (default) a dispatch is decided and logged as "would send"; nothing leaves the server and no link is made.
 *   live     sent. Two ways, the first one that is set up wins:
 *              WABASTORE_WEBHOOK_URL  Wabastore's send API, and only when the invoice WhatsApp settings say the template is approved;
 *              WHATSAPP_WEBHOOK_URL   the WhatsApp Automation Builder webhook the onboarding messages already use: the invoice arrives there as a
 *                                     "Paid Invoice" event (see builderInvoicePayload) and the template is the one chosen in the builder.
 *            With neither, live behaves like off and says so.
 *
 * The invoice reaches the customer as a document the provider fetches from a SHORT-LIVED signed link (default 15 minutes, never stored, never
 * logged, never in the dispatch history). The permanent storage address of a confidential invoice is never exposed. All figures come from
 * the persisted invoice, handed over by the database; nothing is recalculated here.
 */
export type InvoiceWhatsAppMode = 'off' | 'dry_run' | 'live';

export function invoiceWhatsAppMode(env: NodeJS.ProcessEnv = process.env): InvoiceWhatsAppMode {
  const v = (env.AUTOMATION_MODE_INVOICE_WHATSAPP || env.AUTOMATION_MODE || 'dry_run').trim().toLowerCase();
  return v === 'live' || v === 'off' ? v : 'dry_run';
}

/** Where a live message goes. */
export type InvoiceWhatsAppProvider = 'WABASTORE' | 'BUILDER';
export function invoiceWhatsAppProvider(env: NodeJS.ProcessEnv = process.env): InvoiceWhatsAppProvider | null {
  if (wabastoreConfig(env).webhookUrl) return 'WABASTORE';
  return automationSettings().whatsapp.webhookUrl ? 'BUILDER' : null;
}

/** What this server does with a paid invoice's WhatsApp message right now, in words for Accounts (shown on the invoice and in the settings). */
export function invoiceWhatsAppDelivery(env: NodeJS.ProcessEnv = process.env): { mode: InvoiceWhatsAppMode; provider: InvoiceWhatsAppProvider | null; ready: boolean; note: string } {
  const mode = invoiceWhatsAppMode(env);
  const provider = invoiceWhatsAppProvider(env);
  if (mode === 'off') return { mode, provider, ready: false, note: 'The server has invoice WhatsApp switched off (AUTOMATION_MODE_INVOICE_WHATSAPP or AUTOMATION_MODE is "off"). Nothing is sent.' };
  if (mode === 'dry_run') return { mode, provider, ready: false, note: 'The server is in test mode: messages are prepared and logged but NOT sent to customers. Set AUTOMATION_MODE=live (or AUTOMATION_MODE_INVOICE_WHATSAPP=live) to send.' };
  if (!provider) return { mode, provider, ready: false, note: 'No WhatsApp service is connected on the server: set WHATSAPP_WEBHOOK_URL (the onboarding WhatsApp webhook) or WABASTORE_WEBHOOK_URL. Nothing is sent.' };
  return { mode, provider, ready: true, note: provider === 'BUILDER' ? 'Messages go through the WhatsApp Automation Builder webhook.' : 'Messages go through Wabastore.' };
}

/** How long the provider has to fetch the PDF: 2 to 60 minutes (default 15). */
export function invoiceLinkTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.INVOICE_WHATSAPP_LINK_TTL_SECONDS);
  return Number.isFinite(n) && n >= 120 ? Math.min(3600, Math.floor(n)) : 900;
}

/** What the database hands over for one dispatch. */
export interface InvoiceWhatsAppJob {
  id: string;
  attempts: number;
  invoiceId: string;
  customerId: string;
  number: string;
  invoiceDate: string;
  total: number | string;
  customerName: string;
  to: string;
  file: { provider: 'SUPABASE' | 'R2' | null; bucket: string; path: string; sizeBytes: number; etag: string | null };
  template: { name: string | null; language: string; approved: boolean };
}

export interface InvoiceWhatsAppRunSummary {
  mode: InvoiceWhatsAppMode;
  claimed: number;
  dryRun: number;
  accepted: number;
  retrying: number;
  failed: number;
  skipped: number;
  note?: string;
  error?: string;
}

export const invoicePdfName = (number: string) => `${number.replace(/[^A-Za-z0-9._-]+/g, '-')}-paid-invoice.pdf`;

/**
 * The request to Wabastore. PROVISIONAL until Wabastore's send API is settled: it carries an approved template with its variables and the invoice
 * as a document (a short-lived link). The variables are the persisted values, formatted for reading.
 */
export function invoiceWhatsAppPayload(job: InvoiceWhatsAppJob, link: string): Record<string, unknown> {
  const amount = rs(toPaise(String(job.total)) ?? Math.round(Number(job.total) * 100));
  return {
    reference: `invoice-whatsapp:${job.id}`,
    to: job.to,
    template: job.template.name,
    language: job.template.language,
    variables: { customerName: job.customerName || 'Customer', invoiceNumber: job.number, amount, invoiceDate: invoiceDate(job.invoiceDate) },
    document: { url: link, filename: invoicePdfName(job.number), mimeType: 'application/pdf' }
  };
}

export interface InvoiceWhatsAppSender {
  send(job: InvoiceWhatsAppJob, link: string): Promise<MessageOutcome>;
  /** BUILDER: the template lives in the builder, so the settings' template rule does not apply. */
  readonly provider?: InvoiceWhatsAppProvider;
}

/**
 * The paid invoice as an event for the WhatsApp Automation Builder webhook: the same keys the onboarding events carry (so the router reads it the
 * same way) with a fixed `stage_code` to route on, plus the invoice. `invoice_pdf_url` and `pdf_invoice_link` are the short-lived link; `number` is the 10-digit mobile number. In the builder: add a route whose
 * condition is `stage_code` equals `INVOICE_PAID` and send the invoice template (with the document) from it. Use a new event_key for every test.
 */
export function builderInvoicePayload(job: InvoiceWhatsAppJob, link: string): Record<string, unknown> {
  const amount = rs(toPaise(String(job.total)) ?? Math.round(Number(job.total) * 100));
  const ten = job.to.replace(/\D/g, '').slice(-10);
  return {
    name: job.customerName || 'Customer',
    email: '',
    phone: `91${ten}`,
    department: '',
    website: '',
    whatsapp_number: `91${ten}`,
    // the fields the invoice panel reads: the customer's 10-digit mobile number and the short-lived PDF link (the same link as invoice_pdf_url)
    number: ten,
    pdf_invoice_link: link,
    status: 'Paid Invoice',
    stage_code: 'INVOICE_PAID',
    source: automationSettings().whatsapp.source,
    automation: 'Paid Invoice',
    event_key: `invoice|${job.id}|${job.attempts}`,
    invoice_number: job.number,
    invoice_amount: amount,
    invoice_date: invoiceDate(job.invoiceDate),
    invoice_pdf_url: link,
    invoice_filename: invoicePdfName(job.number)
  };
}

export class BuilderInvoiceSender implements InvoiceWhatsAppSender {
  readonly provider = 'BUILDER' as const;
  constructor(private readonly doFetch: WabastoreFetch = (url, init) => fetch(url, init)) {}
  async send(job: InvoiceWhatsAppJob, link: string): Promise<MessageOutcome> {
    const s = automationSettings();
    const url = s.whatsapp.webhookUrl;
    if (!url) return { outcome: 'FAILED', detail: 'WHATSAPP_WEBHOOK_URL is not set (or is not an https address).' };
    if (!/^\+91[6-9]\d{9}$/.test(job.to)) return { outcome: 'FAILED', detail: 'The customer has no valid Indian mobile number, so nothing was sent.' };
    if (s.testRecipients && !s.testRecipients.phones.has(job.to.slice(-10))) return { outcome: 'SKIPPED', detail: 'Not sent: this number is not in AUTOMATION_TEST_RECIPIENTS.' };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const res = await this.doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(builderInvoicePayload(job, link)), signal: ctl.signal });
      await res.text().catch(() => '');
      // the reply can echo the payload (and so the link): only the status is kept
      if (res.status >= 200 && res.status < 300) return { outcome: 'ACCEPTED', detail: `The WhatsApp webhook accepted the invoice (HTTP ${res.status}). Whether the builder's route sent it is shown in the builder.`, code: res.status, ref: null };
      if (res.status === 408 || res.status === 429 || res.status >= 500) return { outcome: 'RETRY', detail: `The WhatsApp webhook is busy or unavailable (HTTP ${res.status}). It will be tried again.`, code: res.status };
      return { outcome: 'FAILED', detail: `The WhatsApp webhook refused the invoice (HTTP ${res.status}). Check WHATSAPP_WEBHOOK_URL.`, code: res.status };
    } catch (err) {
      return { outcome: 'RETRY', detail: (err as Error)?.name === 'AbortError' ? 'The WhatsApp webhook did not answer within 15 seconds.' : 'Could not reach the WhatsApp webhook.' };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class WabastoreInvoiceSender implements InvoiceWhatsAppSender {
  readonly provider = 'WABASTORE' as const;
  private readonly client: WabastoreClient;
  constructor(doFetch?: WabastoreFetch, env: NodeJS.ProcessEnv = process.env) {
    this.client = new WabastoreClient(wabastoreConfig(env), doFetch);
  }
  send(job: InvoiceWhatsAppJob, link: string): Promise<MessageOutcome> {
    return this.client.post(job.to, invoiceWhatsAppPayload(job, link));
  }
}

export function invoiceWhatsAppSender(env: NodeJS.ProcessEnv = process.env): InvoiceWhatsAppSender | null {
  const p = invoiceWhatsAppProvider(env);
  return p === 'WABASTORE' ? new WabastoreInvoiceSender(undefined, env) : p === 'BUILDER' ? new BuilderInvoiceSender() : null;
}

type Result = MessageOutcome | { outcome: 'DRY_RUN'; detail: string; code?: null; ref?: null };

/**
 * Claim and send due dispatches. `dispatchId` limits the run to the one a click just requested. Never throws (it runs inside a request, next to
 * other work).
 */
export async function runInvoiceWhatsApp(
  storage: Pick<StorageRepository, 'signedDownloadUrl'>,
  opts: { db?: SupabaseClient; dispatchId?: string; limit?: number; sender?: InvoiceWhatsAppSender | null; mode?: InvoiceWhatsAppMode } = {}
): Promise<InvoiceWhatsAppRunSummary> {
  const mode = opts.mode ?? invoiceWhatsAppMode();
  const out: InvoiceWhatsAppRunSummary = { mode, claimed: 0, dryRun: 0, accepted: 0, retrying: 0, failed: 0, skipped: 0 };
  if (mode === 'off') return { ...out, note: 'Invoice WhatsApp is switched off (AUTOMATION_MODE_INVOICE_WHATSAPP=off).' };
  if (!opts.db && !hasServiceClient()) return { ...out, note: 'The server has no service key.' };
  const sender = opts.sender === undefined ? invoiceWhatsAppSender() : opts.sender;
  if (mode === 'live' && !sender) {
    return { ...out, mode: 'off', note: 'Live invoice WhatsApp is not available: no WhatsApp service is connected (set WHATSAPP_WEBHOOK_URL or WABASTORE_WEBHOOK_URL). Nothing was sent.' };
  }
  const db = opts.db ?? getServiceClient();
  try {
    const limit = opts.limit ?? 10;
    while (out.claimed < limit) {
      // the builder keeps its templates itself: its live mode has no "approved template" rule
      const claimMode = mode === 'live' && sender?.provider === 'BUILDER' ? 'live_hook' : mode;
      const claim = await db.rpc('invoice_whatsapp_claim', { p_limit: Math.min(5, limit - out.claimed), p_mode: claimMode, p_dispatch: opts.dispatchId ?? null });
      if (claim.error) throw new Error(`invoice_whatsapp_claim: ${claim.error.message}`);
      const jobs = (claim.data as InvoiceWhatsAppJob[]) ?? [];
      if (jobs.length === 0) break;
      for (const job of jobs) {
        out.claimed += 1;
        let result: Result;
        if (mode !== 'live' || !sender) {
          result = { outcome: 'DRY_RUN', detail: `Dry run - not sent: paid invoice ${job.number} to ${job.to.slice(0, 5)}XXXXXX${job.to.slice(-4)}` };
        } else if (sender.provider !== 'BUILDER' && (!job.template.approved || !job.template.name)) {
          result = { outcome: 'SKIPPED', detail: 'The template is not approved, so nothing was sent.' };
        } else {
          try {
            // a short-lived link, made now, handed to the provider and forgotten: it is not stored, logged or returned to anyone
            const link = await storage.signedDownloadUrl(job.file.bucket, job.file.path, invoiceLinkTtlSeconds(), invoicePdfName(job.number), job.file.provider);
            result = await sender.send(job, link);
          } catch (err) {
            result = { outcome: 'RETRY', detail: `Could not prepare or send the message (${(err as Error).name || 'error'}).` };
          }
        }
        const fin = await db.rpc('invoice_whatsapp_finish', { p_dispatch: job.id, p_outcome: result.outcome, p_detail: result.detail, p_response_code: result.code ?? null, p_ref: result.ref ?? null });
        if (fin.error) throw new Error(`invoice_whatsapp_finish: ${fin.error.message}`);
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
    console.error(JSON.stringify({ level: 'error', msg: 'invoice whatsapp run failed', error: out.error }));
  }
  return out;
}

/** The provider's delivery report (ACCEPTED -> DELIVERED -> READ, or FAILED), matched by the message reference. */
export async function applyDeliveryReport(ref: string, status: string, detail: string | null, db: SupabaseClient = getServiceClient()): Promise<{ matched: boolean }> {
  const r = await db.rpc('invoice_whatsapp_status_update', { p_ref: ref, p_status: status.toUpperCase(), p_detail: detail });
  if (r.error) throw new Error(`invoice_whatsapp_status_update: ${r.error.message}`);
  return { matched: Boolean((r.data as { matched: boolean }).matched) };
}

/** The provider's words for a message's progress, as the three states the CRM records; anything else (sent, queued ...) is not news. */
export function normalizeProviderStatus(raw: unknown): 'DELIVERED' | 'READ' | 'FAILED' | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'delivered') return 'DELIVERED';
  if (v === 'read' || v === 'seen') return 'READ';
  if (v === 'failed' || v === 'undelivered' || v === 'error' || v === 'rejected') return 'FAILED';
  return null;
}
