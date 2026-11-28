import type { SupabaseClient } from '@supabase/supabase-js';
import type { RechargeCustomer, RechargeDelivery, RechargeInvoice, RechargeInvoicePlan, RechargeRmPerformance, SupportRecharge, SupportRechargeList } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** A row of support_recharge_files as the upload / download functions return it. */
export interface RechargeFileRow {
  id: string;
  uploader_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  storage_bucket: string;
  storage_path: string;
  storage_provider: 'R2' | 'SUPABASE' | null;
}

/**
 * Support Recharges (20270228000200). Every call is a database function that decides from the caller's own login (Support staff only, and which
 * records); nothing here names a department, an owner or a storage path. The caller's own database client is used (row level security applies),
 * never the service key.
 */
export class SupportRechargeRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  list(q: { kind?: string; search?: string; paymentStatus?: string; invoiceStatus?: string; from?: string; to?: string; min?: number; max?: number; rm?: string; limit: number; offset: number }) {
    return this.rpc<SupportRechargeList>('recharge_list', {
      p_kind: q.kind || null, p_search: q.search || null, p_payment_status: q.paymentStatus || null, p_invoice_status: q.invoiceStatus || null, p_from: q.from || null, p_to: q.to || null,
      p_min: q.min ?? null, p_max: q.max ?? null, p_rm: q.rm || null, p_limit: q.limit, p_offset: q.offset
    });
  }
  get(id: string) { return this.rpc<SupportRecharge>('recharge_get', { p_id: id }); }
  create(p: Record<string, unknown>) { return this.rpc<SupportRecharge>('recharge_create', { p }); }
  update(id: string, p: Record<string, unknown>) { return this.rpc<SupportRecharge>('recharge_update', { p_id: id, p }); }
  customers(search?: string) { return this.rpc<RechargeCustomer[]>('recharge_customers', { p_search: search || null }); }
  customerContext(id: string) { return this.rpc<RechargeCustomer>('recharge_customer_context', { p_customer: id }); }
  performance(q: { from?: string; to?: string; rm?: string }) { return this.rpc<RechargeRmPerformance[]>('recharge_rm_performance', { p_from: q.from || null, p_to: q.to || null, p_rm: q.rm || null }); }
  // ---- Accounts: the payment is verified (or not) there, the billing details corrected there
  verify(id: string, decision: string, note: string | null, receivedAmount?: number) {
    return this.rpc<SupportRecharge & { replayed: boolean }>('recharge_verify_payment', { p_id: id, p_decision: decision, p_note: note, p_received_amount: receivedAmount ?? null });
  }
  correct(id: string, p: Record<string, unknown>) { return this.rpc<SupportRecharge>('recharge_accounts_correct', { p_id: id, p }); }

  // ---- the payment screenshot
  beginUpload(fileName: string, mime: string, size: number) { return this.rpc<RechargeFileRow>('recharge_begin_upload', { p_file_name: fileName, p_mime: mime, p_size: size }); }
  pendingUpload(id: string) { return this.rpc<RechargeFileRow>('recharge_pending_upload', { p_attachment: id }); }
  completeUpload(id: string, size: number, etag: string | null) {
    return this.rpc<{ id: string; name: string; mime: string; size: number }>('recharge_complete_upload', { p_attachment: id, p_size: size, p_etag: etag });
  }
  async abortUpload(id: string) { await this.rpc<null>('recharge_abort_upload', { p_attachment: id }); }
  attachmentFile(id: string) { return this.rpc<RechargeFileRow>('recharge_attachment_download', { p_attachment: id }); }

  // ---- the invoice and its delivery (Accounts only: the database checks)
  invoicePrefill(rechargeId: string, p: Record<string, unknown>) { return this.rpc<RechargeInvoicePlan>('recharge_invoice_prefill', { p_recharge: rechargeId, p }); }
  invoiceGenerate(rechargeId: string, p: Record<string, unknown>) { return this.rpc<RechargeInvoice>('recharge_invoice_generate', { p_recharge: rechargeId, p }); }
  invoiceGet(rechargeId: string) { return this.rpc<RechargeInvoice | null>('recharge_invoice_get', { p_recharge: rechargeId }); }
  invoiceSnapshot(invoiceId: string) { return this.rpc<Record<string, any>>('recharge_invoice_snapshot', { p_invoice: invoiceId }); }
  async recordPdf(invoiceId: string, f: { provider: string; bucket: string; path: string; reference: string; etag: string | null; size: number }) {
    await this.rpc<null>('recharge_invoice_record_pdf', { p_invoice: invoiceId, p_provider: f.provider, p_bucket: f.bucket, p_path: f.path, p_ref: f.reference, p_etag: f.etag, p_size: f.size });
  }
  async recordPdfFailure(invoiceId: string, error: string) { await this.rpc<null>('recharge_invoice_record_pdf_failure', { p_invoice: invoiceId, p_error: error }); }
  invoiceFile(invoiceId: string) { return this.rpc<{ provider: 'R2' | 'SUPABASE' | null; bucket: string; path: string; number: string }>('recharge_invoice_file', { p_invoice: invoiceId }); }
  setContact(rechargeId: string, email: string | null, phone: string | null, note: string) { return this.rpc<SupportRecharge>('recharge_set_contact', { p_recharge: rechargeId, p_email: email, p_phone: phone, p_note: note }); }
  deliveryBegin(rechargeId: string, channel: string, resend: boolean) {
    return this.rpc<{ deliveryId: string; channel: 'EMAIL' | 'WHATSAPP'; to: string; isResend: boolean; invoiceId: string; number: string; invoiceDate: string; total: number | string; customerName: string; customerId: string | null;
      file: { provider: 'R2' | 'SUPABASE' | null; bucket: string; path: string; sizeBytes: number; etag: string | null } }>('recharge_delivery_begin', { p_recharge: rechargeId, p_channel: channel, p_resend: resend });
  }
  deliveryFinish(deliveryId: string, outcome: 'SENT' | 'NOT_SENT' | 'FAILED', detail: string, ref: string | null) {
    return this.rpc<RechargeDelivery & { invoiceStatus: string; replayed: boolean }>('recharge_delivery_finish', { p_delivery: deliveryId, p_outcome: outcome, p_detail: detail, p_ref: ref });
  }
  whatsappSettings() { return this.rpc<{ enabled: boolean; templateName: string | null; templateLanguage: string; templateApproved: boolean }>('invoice_whatsapp_settings_get'); }
}
