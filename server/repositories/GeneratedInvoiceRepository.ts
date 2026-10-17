import type { SupabaseClient } from '@supabase/supabase-js';
import type { Invoice, InvoicePrefill, InvoiceStage } from '../../shared/contracts.js';
import type { GeneratedInvoiceIssueInput } from '../../shared/validation.js';
import { unwrap } from './base.js';

/** What a claimed stage hands the worker: the snapshot to draw the PDF from, and where an earlier run already stored it. */
export interface ClaimedStage {
  claimed: boolean;
  /** BUSY: another run holds the stage. DONE: the PDF is stored and the e-mail was sent. */
  reason: 'BUSY' | 'DONE' | null;
  invoice: Record<string, unknown> & {
    invoiceId: string;
    recipientEmail: string | null;
    stored: { provider: 'SUPABASE' | 'R2'; bucket: string; path: string; sizeBytes: number; etag: string | null } | null;
  };
}

/**
 * Generated invoices (Accounts). Every call is a database function that checks the caller's role itself; nothing writes the
 * invoice tables directly. Storage references are recorded only through accounts_invoice_record_pdf, after the upload.
 */
export class GeneratedInvoiceRepository {
  constructor(private readonly db: SupabaseClient) {}

  async prefill(customerId: string, purpose: string, addonRequestId?: string): Promise<InvoicePrefill> {
    return unwrap(await this.db.rpc('accounts_invoice_prefill', { p_customer: customerId, p_purpose: purpose, p_addon_request: addonRequestId ?? null })) as InvoicePrefill;
  }

  async issue(input: GeneratedInvoiceIssueInput): Promise<Invoice & { replayed: boolean }> {
    const { requestId, ...payload } = input;
    return unwrap(await this.db.rpc('accounts_issue_invoice', { p_request: requestId, p_payload: payload })) as Invoice & { replayed: boolean };
  }

  async claim(invoiceId: string, stage: InvoiceStage): Promise<ClaimedStage> {
    return unwrap(await this.db.rpc('accounts_invoice_claim', { p_invoice: invoiceId, p_stage: stage })) as ClaimedStage;
  }
  async release(invoiceId: string, stage: InvoiceStage): Promise<void> {
    unwrap(await this.db.rpc('accounts_invoice_release', { p_invoice: invoiceId, p_stage: stage }));
  }
  async recordPdf(invoiceId: string, stage: InvoiceStage, f: { provider: string; bucket: string; path: string; reference: string; etag: string | null; size: number }): Promise<Invoice> {
    return unwrap(
      await this.db.rpc('accounts_invoice_record_pdf', {
        p_invoice: invoiceId, p_stage: stage, p_provider: f.provider, p_bucket: f.bucket, p_path: f.path, p_ref: f.reference, p_etag: f.etag, p_size: f.size
      })
    ) as Invoice;
  }
  async recordEmail(invoiceId: string, stage: InvoiceStage, r: { outcome: 'SENT' | 'NOT_SENT' | 'FAILED'; to: string | null; messageId: string | null; detail: string | null }): Promise<Invoice> {
    return unwrap(
      await this.db.rpc('accounts_invoice_record_email', { p_invoice: invoiceId, p_stage: stage, p_outcome: r.outcome, p_to: r.to, p_message_id: r.messageId, p_detail: r.detail })
    ) as Invoice;
  }
  async recordFailure(invoiceId: string, stage: InvoiceStage, step: 'PDF' | 'EMAIL', error: string): Promise<Invoice> {
    return unwrap(await this.db.rpc('accounts_invoice_record_failure', { p_invoice: invoiceId, p_stage: stage, p_step: step, p_error: error })) as Invoice;
  }

  async confirmPayment(invoiceId: string, p: { method: string; reference?: string | null; note?: string | null; paidOn?: string | null }): Promise<Invoice & { replayed: boolean }> {
    return unwrap(
      await this.db.rpc('accounts_confirm_invoice_payment', {
        p_invoice: invoiceId, p_method: p.method, p_reference: p.reference ?? null, p_note: p.note ?? null, p_paid_on: p.paidOn ?? null
      })
    ) as Invoice & { replayed: boolean };
  }

  /** One invoice the caller may read (the existing function, which now includes the generated snapshot). */
  async detail(invoiceId: string): Promise<Invoice> {
    return unwrap(await this.db.rpc('invoice_detail', { p_invoice: invoiceId })) as Invoice;
  }

  /** Where a stored PDF lives, for anyone who may read the invoice (audited). */
  async file(invoiceId: string, stage: InvoiceStage, action: 'VIEW' | 'DOWNLOAD') {
    const rows = unwrap(await this.db.rpc('invoice_file_access', { p_invoice: invoiceId, p_stage: stage, p_action: action })) as {
      storage_provider: 'SUPABASE' | 'R2'; storage_bucket: string; storage_path: string; original_file_name: string; mime_type: string;
    }[];
    return rows[0];
  }
}
