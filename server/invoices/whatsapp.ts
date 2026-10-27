import type { SupabaseClient } from '@supabase/supabase-js';
import { invoiceDate, rs, toPaise } from '../../shared/invoiceCalc.js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { WabastoreClient, wabastoreConfig, type MessageOutcome, type WabastoreFetch } from '../automations/subscriptionMessages.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

/**
 * The paid invoice by WhatsApp (through Wabastore). The database decides and records (invoice_whatsapp_* functions: one dispatch per invoice
 * and number, retries, history); this module only sends what the database hands over.
 *
 * AUTOMATION_MODE_INVOICE_WHATSAPP:
 *   off      nothing is processed.
 *   dry_run  (default) a dispatch is decided and logged as "would send"; nothing leaves the server and no link is made.
 *   live     sent through Wabastore, but only when the invoice WhatsApp settings say the template is approved. Without WABASTORE_WEBHOOK_URL
 *            live behaves like off and says so.
 *
 * The invoice reaches the customer as a document the provider fetches from a SHORT-LIVED signed link (default 15 minutes, never stored, never
 * logged, never in the dispatch history). The permanent storage address of a confidential invoice is never exposed. All figures come from
 * the persisted invoice, handed over by the database; nothing is recalculated here.
 */
export type InvoiceWhatsAppMode = 'off' | 'dry_run' | 'live';

export function invoiceWhatsAppMode(env: NodeJS.ProcessEnv = process.env): InvoiceWhatsAppMode {
  const v = (env.AUTOMATION_MODE_INVOICE_WHATSAPP || 'dry_run').trim().toLowerCase();
  return v === 'live' || v === 'off' ? v : 'dry_run';
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
}

export class WabastoreInvoiceSender implements InvoiceWhatsAppSender {
  private readonly client: WabastoreClient;
  constructor(doFetch?: WabastoreFetch, env: NodeJS.ProcessEnv = process.env) {
    this.client = new WabastoreClient(wabastoreConfig(env), doFetch);
  }
  send(job: InvoiceWhatsAppJob, link: string): Promise<MessageOutcome> {
    return this.client.post(job.to, invoiceWhatsAppPayload(job, link));
  }
}

export function invoiceWhatsAppSender(env: NodeJS.ProcessEnv = process.env): InvoiceWhatsAppSender | null {
  return wabastoreConfig(env).webhookUrl ? new WabastoreInvoiceSender(undefined, env) : null;
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
    return { ...out, mode: 'off', note: 'Live invoice WhatsApp is not available: no provider is connected (set WABASTORE_WEBHOOK_URL). Nothing was sent.' };
  }
  const db = opts.db ?? getServiceClient();
  try {
    const limit = opts.limit ?? 10;
    while (out.claimed < limit) {
      const claim = await db.rpc('invoice_whatsapp_claim', { p_limit: Math.min(5, limit - out.claimed), p_mode: mode, p_dispatch: opts.dispatchId ?? null });
      if (claim.error) throw new Error(`invoice_whatsapp_claim: ${claim.error.message}`);
      const jobs = (claim.data as InvoiceWhatsAppJob[]) ?? [];
      if (jobs.length === 0) break;
      for (const job of jobs) {
        out.claimed += 1;
        let result: Result;
        if (mode !== 'live' || !sender) {
          result = { outcome: 'DRY_RUN', detail: `Dry run - not sent: paid invoice ${job.number} to ${job.to.slice(0, 5)}XXXXXX${job.to.slice(-4)}` };
        } else if (!job.template.approved || !job.template.name) {
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
