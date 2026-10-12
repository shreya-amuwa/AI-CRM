import type { SupabaseClient } from '@supabase/supabase-js';
import type { AddonRequest, AddonRequestPage, Invoice, InvoiceCustomer, InvoicePage } from '../../shared/contracts.js';
import type { PricedLineInput } from '../../shared/validation.js';
import { unwrap } from './base.js';

const lines = (items: PricedLineInput[]) =>
  items.map(i => ({
    serviceCode: i.serviceCode ?? null,
    name: i.name ?? null,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    discount: i.discount,
    taxPercent: i.taxPercent
  }));

/**
 * Add-on requests (Technical Consultant -> Accounts) and invoices. Every call is a
 * database function that checks the caller's role and scope itself.
 */
export class AddonInvoiceRepository {
  constructor(private readonly db: SupabaseClient) {}

  // --- Technical Consultant / everyone who may see the customer ---
  async customerRequest(customerId: string): Promise<AddonRequest | null> {
    return (unwrap(await this.db.rpc('customer_addon_request', { p_customer: customerId })) as AddonRequest | null) ?? null;
  }
  async saveRequest(customerId: string, b: { items: PricedLineInput[]; notes?: string | null; submit?: boolean; expectedVersion?: number }): Promise<AddonRequest> {
    return unwrap(
      await this.db.rpc('consultant_save_addon_request', {
        p_customer: customerId,
        p_items: lines(b.items),
        p_notes: b.notes ?? null,
        p_submit: !!b.submit,
        p_expected_version: b.expectedVersion ?? null
      })
    ) as AddonRequest;
  }
  async startDocuments(customerId: string): Promise<AddonRequest> {
    return unwrap(await this.db.rpc('consultant_start_addon_documents', { p_customer: customerId })) as AddonRequest;
  }
  async complete(customerId: string): Promise<AddonRequest> {
    return unwrap(await this.db.rpc('consultant_complete_addons', { p_customer: customerId })) as AddonRequest;
  }
  async customerInvoices(customerId: string): Promise<Invoice[]> {
    return unwrap(await this.db.rpc('customer_invoices', { p_customer: customerId })) as Invoice[];
  }
  async visibleInvoices(q: { search?: string; status?: string; page: number; pageSize: number }): Promise<InvoicePage> {
    return unwrap(
      await this.db.rpc('visible_invoices', { p_search: q.search ?? null, p_status: q.status ?? null, p_page: q.page, p_page_size: q.pageSize })
    ) as InvoicePage;
  }

  // --- Accounts ---
  async requests(q: { status?: string; search?: string; consultant?: string; from?: string; to?: string; page: number; pageSize: number }): Promise<AddonRequestPage> {
    return unwrap(
      await this.db.rpc('accounts_addon_requests', {
        p_status: q.status ?? null,
        p_search: q.search ?? null,
        p_consultant: q.consultant ?? null,
        p_from: q.from ?? null,
        p_to: q.to ?? null,
        p_page: q.page,
        p_page_size: q.pageSize
      })
    ) as AddonRequestPage;
  }
  async request(id: string): Promise<AddonRequest> {
    return unwrap(await this.db.rpc('accounts_addon_request', { p_request: id })) as AddonRequest;
  }
  async decide(id: string, d: { decision: string; note?: string | null; expectedVersion?: number }): Promise<AddonRequest> {
    return unwrap(
      await this.db.rpc('accounts_decide_addon_request', { p_request: id, p_decision: d.decision, p_note: d.note ?? null, p_expected_version: d.expectedVersion ?? null })
    ) as AddonRequest;
  }
  async recordPayment(
    id: string,
    p: { amount: number; method: string; reference?: string | null; paidAt?: string | null; note?: string | null; verify?: boolean }
  ): Promise<AddonRequest> {
    return unwrap(
      await this.db.rpc('accounts_record_addon_payment', {
        p_request: id,
        p_amount: p.amount,
        p_method: p.method,
        p_reference: p.reference ?? null,
        p_paid_at: p.paidAt ?? null,
        p_note: p.note ?? null,
        p_verify: !!p.verify
      })
    ) as AddonRequest;
  }
  async decidePayment(paymentId: string, d: { decision: string; reason?: string | null }): Promise<AddonRequest> {
    return unwrap(await this.db.rpc('accounts_decide_addon_payment', { p_payment: paymentId, p_decision: d.decision, p_reason: d.reason ?? null })) as AddonRequest;
  }
  async confirmPayment(id: string, note: string | null): Promise<AddonRequest> {
    return unwrap(await this.db.rpc('accounts_confirm_addon_payment', { p_request: id, p_note: note })) as AddonRequest;
  }
  async invoices(q: { search?: string; kind?: string; status?: string; page: number; pageSize: number }): Promise<InvoicePage> {
    return unwrap(
      await this.db.rpc('accounts_invoices', { p_search: q.search ?? null, p_kind: q.kind ?? null, p_status: q.status ?? null, p_page: q.page, p_page_size: q.pageSize })
    ) as InvoicePage;
  }
  async setInvoiceStatus(id: string, status: string): Promise<Invoice> {
    return unwrap(await this.db.rpc('accounts_set_invoice_status', { p_invoice: id, p_status: status })) as Invoice;
  }
  async updateInvoiceDetails(id: string, d: { issueDate?: string | null; dueDate?: string | null; amount?: number | null; reference?: string | null; note?: string | null }): Promise<Invoice> {
    return unwrap(
      await this.db.rpc('accounts_update_uploaded_invoice', {
        p_invoice: id,
        p_issue_date: d.issueDate ?? null,
        p_due_date: d.dueDate ?? null,
        p_amount: d.amount ?? null,
        p_reference: d.reference ?? null,
        p_note: d.note ?? null
      })
    ) as Invoice;
  }
  async invoiceCustomers(search?: string): Promise<InvoiceCustomer[]> {
    return unwrap(await this.db.rpc('accounts_invoice_customers', { p_search: search ?? null })) as InvoiceCustomer[];
  }
}
