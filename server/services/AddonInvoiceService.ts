import type { AddonRequest, AddonRequestPage, Invoice, InvoiceCustomer, InvoicePage } from '../../shared/contracts.js';
import {
  addonDecisionSchema,
  addonInvoiceSchema,
  addonPaymentDecisionSchema,
  addonPaymentSchema,
  addonRequestSaveSchema,
  addonRequestsQuerySchema,
  invoiceCreateSchema,
  invoiceDetailsSchema,
  invoiceCustomersQuerySchema,
  invoicesQuerySchema,
  invoiceStatusSchema,
  noteBodySchema,
  uuidSchema
} from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { AddonInvoiceRepository } from '../repositories/AddonInvoiceRepository.js';

/** Add-on requests (consultant -> Accounts), add-on payments, and invoices issued by Accounts. */
export class AddonInvoiceService {
  constructor(private readonly repo: AddonInvoiceRepository) {}

  customerRequest(id: unknown): Promise<AddonRequest | null> {
    return this.repo.customerRequest(parse(uuidSchema, id));
  }
  saveRequest(id: unknown, body: unknown): Promise<AddonRequest> {
    return this.repo.saveRequest(parse(uuidSchema, id), parse(addonRequestSaveSchema, body));
  }
  startDocuments(id: unknown): Promise<AddonRequest> {
    return this.repo.startDocuments(parse(uuidSchema, id));
  }
  complete(id: unknown): Promise<AddonRequest> {
    return this.repo.complete(parse(uuidSchema, id));
  }
  customerInvoices(id: unknown): Promise<Invoice[]> {
    return this.repo.customerInvoices(parse(uuidSchema, id));
  }
  visibleInvoices(query: unknown): Promise<InvoicePage> {
    const q = parse(invoicesQuerySchema, query ?? {});
    return this.repo.visibleInvoices({ search: q.search, status: q.status, page: q.page, pageSize: q.pageSize });
  }

  requests(query: unknown): Promise<AddonRequestPage> {
    return this.repo.requests(parse(addonRequestsQuerySchema, query ?? {}));
  }
  request(id: unknown): Promise<AddonRequest> {
    return this.repo.request(parse(uuidSchema, id));
  }
  decide(id: unknown, body: unknown): Promise<AddonRequest> {
    return this.repo.decide(parse(uuidSchema, id), parse(addonDecisionSchema, body));
  }
  generateInvoice(id: unknown, body: unknown): Promise<AddonRequest> {
    return this.repo.generateInvoice(parse(uuidSchema, id), parse(addonInvoiceSchema, body ?? {}));
  }
  recordPayment(id: unknown, body: unknown): Promise<AddonRequest> {
    return this.repo.recordPayment(parse(uuidSchema, id), parse(addonPaymentSchema, body));
  }
  decidePayment(paymentId: unknown, body: unknown): Promise<AddonRequest> {
    return this.repo.decidePayment(parse(uuidSchema, paymentId), parse(addonPaymentDecisionSchema, body));
  }
  confirmPayment(id: unknown, body: unknown): Promise<AddonRequest> {
    return this.repo.confirmPayment(parse(uuidSchema, id), parse(noteBodySchema, body ?? {}).note ?? null);
  }
  invoices(query: unknown): Promise<InvoicePage> {
    return this.repo.invoices(parse(invoicesQuerySchema, query ?? {}));
  }
  createInvoice(body: unknown): Promise<Invoice> {
    return this.repo.createInvoice(parse(invoiceCreateSchema, body));
  }
  setInvoiceStatus(id: unknown, body: unknown): Promise<Invoice> {
    return this.repo.setInvoiceStatus(parse(uuidSchema, id), parse(invoiceStatusSchema, body).status);
  }
  updateInvoiceDetails(id: unknown, body: unknown): Promise<Invoice> {
    return this.repo.updateInvoiceDetails(parse(uuidSchema, id), parse(invoiceDetailsSchema, body));
  }
  invoiceCustomers(query: unknown): Promise<InvoiceCustomer[]> {
    return this.repo.invoiceCustomers(parse(invoiceCustomersQuerySchema, query ?? {}).search);
  }
}
