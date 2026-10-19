import type { SupabaseClient } from '@supabase/supabase-js';
import type { BusinessPerson, BusinessReport, BusinessTransactionsPage, InvoiceBusinessInfo } from '../../shared/contracts.js';
import type { BusinessReportQuery, BusinessTransactionsQuery, InvoiceBusinessTagInput } from '../../shared/validation.js';
import { unwrap } from './base.js';

/** Business reports: every call is a database function that checks the caller (the Accounts department and the Super Admin). */
export class BusinessReportRepository {
  constructor(private readonly db: SupabaseClient) {}

  private filters(q: BusinessReportQuery) {
    return {
      p_from: q.from ?? null,
      p_to: q.to ?? null,
      p_department: q.departmentId ?? null,
      p_division: q.division ?? null,
      p_employee: q.employeeId ?? null,
      p_type: q.type ?? null,
      p_status: q.status ?? null
    };
  }

  async report(q: BusinessReportQuery): Promise<BusinessReport> {
    return unwrap(await this.db.rpc('business_report', this.filters(q))) as BusinessReport;
  }

  async transactions(q: BusinessTransactionsQuery): Promise<BusinessTransactionsPage> {
    return unwrap(
      await this.db.rpc('business_report_transactions', { ...this.filters(q), p_search: q.search ?? null, p_page: q.page, p_page_size: q.pageSize })
    ) as BusinessTransactionsPage;
  }

  async people(): Promise<BusinessPerson[]> {
    return unwrap(await this.db.rpc('business_report_people')) as BusinessPerson[];
  }

  async invoiceBusiness(invoiceId: string): Promise<InvoiceBusinessInfo> {
    return unwrap(await this.db.rpc('accounts_invoice_business', { p_invoice: invoiceId })) as InvoiceBusinessInfo;
  }

  async tagInvoice(invoiceId: string, i: InvoiceBusinessTagInput): Promise<void> {
    unwrap(
      await this.db.rpc('accounts_tag_invoice_business', {
        p_invoice: invoiceId,
        p_kind: i.kind,
        p_service: i.serviceCode ?? null,
        p_invoice_request: i.invoiceRequestId ?? null,
        p_note: i.note ?? null
      })
    );
  }
}
