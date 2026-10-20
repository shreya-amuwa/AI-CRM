import type { BusinessOrdersPage, BusinessPerson, BusinessReport, BusinessTransactionsPage, InvoiceBusinessInfo } from '../../shared/contracts.js';
import { businessOrdersQuerySchema, businessReportQuerySchema, businessTransactionsQuerySchema, invoiceBusinessTagSchema, uuidSchema } from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { BusinessReportRepository } from '../repositories/BusinessReportRepository.js';

/** Sales and Support business, by department and employee, for Accounts, from the real payment records (see docs/BUSINESS_REPORTING.md). */
export class BusinessReportService {
  constructor(private readonly repo: BusinessReportRepository) {}

  report(query: unknown): Promise<BusinessReport> {
    return this.repo.report(parse(businessReportQuerySchema, query ?? {}));
  }

  transactions(query: unknown): Promise<BusinessTransactionsPage> {
    return this.repo.transactions(parse(businessTransactionsQuerySchema, query ?? {}));
  }

  orders(query: unknown): Promise<BusinessOrdersPage> {
    return this.repo.orders(parse(businessOrdersQuerySchema, query ?? {}));
  }

  people(): Promise<BusinessPerson[]> {
    return this.repo.people();
  }

  invoiceBusiness(id: string): Promise<InvoiceBusinessInfo> {
    return this.repo.invoiceBusiness(parse(uuidSchema, id));
  }

  async tagInvoice(id: string, body: unknown): Promise<void> {
    await this.repo.tagInvoice(parse(uuidSchema, id), parse(invoiceBusinessTagSchema, body));
  }
}
