import type { ClientDocumentUrl, RechargeInvoice, RechargeInvoicePlan, RechargeSendResult, SupportRecharge } from '../../shared/contracts.js';
import { clientFileQuerySchema, rechargeContactSchema, rechargeInvoiceGenerateSchema, rechargeInvoiceSendSchema, uuidSchema } from '../../shared/validation.js';
import { rs, toPaise } from '../../shared/invoiceCalc.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { sendInvoiceEmail } from '../invoices/mailer.js';
import type { InvoicePdfInput, renderInvoicePdf } from '../invoices/pdf.js';
import { invoiceLinkTtlSeconds, invoicePdfName, invoiceWhatsAppMode, invoiceWhatsAppSender, type InvoiceWhatsAppJob, type InvoiceWhatsAppMode, type InvoiceWhatsAppSender } from '../invoices/whatsapp.js';
import type { SupportRechargeRepository } from '../repositories/SupportRechargeRepository.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

const BUCKET = 'recharge-invoices';
const FILE_URL_TTL_SECONDS = 120;
export const rechargeInvoicePath = (invoiceId: string) => `invoices/${invoiceId}/invoice.pdf`;

/** What the service needs from the outside world, replaceable in tests (nothing real is e-mailed or sent on WhatsApp by a test). */
export interface RechargeInvoiceWork {
  render: typeof renderInvoicePdf;
  mail: typeof sendInvoiceEmail;
  whatsappMode: () => InvoiceWhatsAppMode;
  whatsappSender: () => InvoiceWhatsAppSender | null;
}
const defaultWork = (): RechargeInvoiceWork => ({
  render: async (inv, opts) => (await import('../invoices/pdf.js')).renderInvoicePdf(inv, opts),
  mail: sendInvoiceEmail,
  whatsappMode: () => invoiceWhatsAppMode(),
  whatsappSender: () => invoiceWhatsAppSender()
});

/** A message safe to show Accounts: what we raised on purpose, never database or provider internals. */
const safeMessage = (e: unknown, fallback: string) => (e instanceof AppError ? e.message : fallback);

/** The PDF input is the stored snapshot the database returned, mapped as it is: nothing a browser sent goes into it. */
function toPdfInput(s: Record<string, any>): InvoicePdfInput {
  return {
    number: s.number, invoiceType: s.invoiceType, invoiceDate: String(s.invoiceDate).slice(0, 10), orderNumber: s.orderNumber,
    customer: { name: s.customer.name, businessName: s.customer.businessName, address: s.customer.address, contactPerson: s.customer.contactPerson, contactNumber: s.customer.contactNumber,
      gstin: s.customer.gstin, state: s.customer.state, stateCode: s.customer.stateCode },
    taxTreatment: s.taxTreatment, taxTreatmentOverridden: !!s.taxTreatmentOverridden, reverseCharge: !!s.reverseCharge, terms: s.terms,
    lines: (s.lines as any[]).map(l => ({ position: l.position, particulars: l.particulars, hsnSac: l.hsnSac, taxRate: Number(l.taxRate), quantity: l.quantity, baseAmount: Number(l.baseAmount),
      gstAmount: Number(l.gstAmount), totalAmount: Number(l.totalAmount) })),
    totals: { subtotal: Number(s.totals.subtotal), cgstAmount: Number(s.totals.cgstAmount), sgstAmount: Number(s.totals.sgstAmount), igstAmount: Number(s.totals.igstAmount), totalGst: Number(s.totals.totalGst),
      total: Number(s.totals.total), inWords: s.totals.inWords, breakdown: (s.totals.breakdown as any[]).map(b => ({ rate: Number(b.rate), base: Number(b.base), gst: Number(b.gst), cgst: Number(b.cgst), sgst: Number(b.sgst), igst: Number(b.igst) })) },
    paymentSummary: s.paymentSummary, issuedAt: s.issuedAt
  };
}

/**
 * The invoice of a verified recharge: made by the database (number, tax, total), drawn as a PDF from the stored snapshot, stored privately, reviewed by Accounts, and sent by e-mail and
 * WhatsApp only when an Accounts user presses Send. Every step is recorded in the database only after it really happened, so any step can fail and be retried without repeating the others.
 * A channel is SENT only when the provider accepted the message: a test-mode or switched-off server records NOT_SENT, never SENT.
 */
export class RechargeInvoiceService {
  constructor(
    private readonly repo: SupportRechargeRepository,
    private readonly storage: StorageRepository,
    private readonly work: RechargeInvoiceWork = defaultWork()
  ) {}

  async prefill(rechargeId: string, body: unknown): Promise<RechargeInvoicePlan> {
    return this.repo.invoicePrefill(parse(uuidSchema, rechargeId), parse(rechargeInvoiceGenerateSchema, body ?? {}));
  }

  async get(rechargeId: string): Promise<RechargeInvoice | null> { return this.repo.invoiceGet(parse(uuidSchema, rechargeId)); }

  /** Makes the invoice (once) and then its PDF. A failed PDF leaves the invoice in place with the reason; "retry the PDF" finishes it. */
  async generate(rechargeId: string, body: unknown): Promise<{ invoice: RechargeInvoice; pdf: { status: 'READY' | 'FAILED'; message: string | null } }> {
    const id = parse(uuidSchema, rechargeId);
    const made = await this.repo.invoiceGenerate(id, parse(rechargeInvoiceGenerateSchema, body ?? {}));
    const pdf = await this.ensurePdf(made.id);
    return { invoice: (await this.repo.invoiceGet(id)) ?? made, pdf };
  }

  async retryPdf(rechargeId: string): Promise<{ invoice: RechargeInvoice; pdf: { status: 'READY' | 'FAILED'; message: string | null } }> {
    const id = parse(uuidSchema, rechargeId);
    const inv = await this.repo.invoiceGet(id);
    if (!inv) throw new AppError('NOT_FOUND', 'There is no invoice for this recharge yet.');
    const pdf = await this.ensurePdf(inv.id);
    return { invoice: (await this.repo.invoiceGet(id)) ?? inv, pdf };
  }

  /** Draws and stores the PDF from the database's snapshot, once (an existing stored PDF is kept). */
  private async ensurePdf(invoiceId: string): Promise<{ status: 'READY' | 'FAILED'; message: string | null }> {
    const snap = await this.repo.invoiceSnapshot(invoiceId);
    if (snap.pdfStatus === 'READY' && snap.stored) return { status: 'READY', message: null };
    try {
      const rendered = await this.work.render(toPdfInput(snap), { stage: 'PAID' });
      const path = rechargeInvoicePath(invoiceId);
      const file = await this.storage.storeGenerated(BUCKET, path, rendered.bytes, 'application/pdf');
      await this.repo.recordPdf(invoiceId, { provider: file.provider, bucket: BUCKET, path, reference: file.reference, etag: file.etag, size: file.size });
      return { status: 'READY', message: null };
    } catch (e) {
      const message = safeMessage(e, 'The invoice PDF could not be created or stored.');
      if (!(e instanceof AppError)) console.error('[recharge invoice] pdf step failed', { invoice: invoiceId, message: (e as Error)?.message });
      await this.repo.recordPdfFailure(invoiceId, message).catch(err => console.error('[recharge invoice] could not record the failure', (err as Error)?.message));
      return { status: 'FAILED', message };
    }
  }

  /** A short-lived link to the stored PDF, for Accounts to review before sending (the database allowed it and wrote it to the audit log). */
  async fileUrl(rechargeId: string, query: unknown): Promise<ClientDocumentUrl> {
    const { action } = parse(clientFileQuerySchema, query ?? {});
    const inv = await this.repo.invoiceGet(parse(uuidSchema, rechargeId));
    if (!inv) throw new AppError('NOT_FOUND', 'There is no invoice for this recharge yet.');
    const f = await this.repo.invoiceFile(inv.id);
    const fileName = invoicePdfName(f.number);
    const url = await this.storage.signedDownloadUrl(f.bucket, f.path, FILE_URL_TTL_SECONDS, action === 'download' ? fileName : undefined, f.provider);
    return { url, expiresInSeconds: FILE_URL_TTL_SECONDS, fileName };
  }

  async setContact(rechargeId: string, body: unknown): Promise<SupportRecharge> {
    const b = parse(rechargeContactSchema, body);
    return this.repo.setContact(parse(uuidSchema, rechargeId), b.customerEmail || null, b.customerPhone || null, b.note);
  }

  /**
   * Sends the invoice by the chosen channels, one after the other. Each channel is booked in the database first (it refuses a second send, a send in progress, a missing PDF or a
   * missing address), then sent, then its outcome recorded. A refusal of one channel does not stop the other; nothing here throws for a provider's failure.
   */
  async send(rechargeId: string, body: unknown): Promise<{ results: RechargeSendResult[]; invoiceStatus: string | null }> {
    const id = parse(uuidSchema, rechargeId);
    const { channels, resend } = parse(rechargeInvoiceSendSchema, body);
    const results: RechargeSendResult[] = [];
    let invoiceStatus: string | null = null;
    for (const channel of channels) {
      let job: Awaited<ReturnType<SupportRechargeRepository['deliveryBegin']>>;
      try {
        job = await this.repo.deliveryBegin(id, channel, resend);
      } catch (e) {
        if (e instanceof AppError && (e.code === 'CONFLICT' || e.code === 'VALIDATION_ERROR')) { results.push({ channel, status: 'REFUSED', message: e.message }); continue; }
        throw e;
      }
      let outcome: { status: 'SENT' | 'NOT_SENT' | 'FAILED'; detail: string; ref: string | null };
      try {
        outcome = channel === 'EMAIL' ? await this.sendEmail(job) : await this.sendWhatsApp(job);
      } catch (e) {
        console.error('[recharge invoice] send crashed', { channel, message: (e as Error)?.message });
        outcome = { status: 'FAILED', detail: 'The invoice could not be sent (an unexpected error). Try again.', ref: null };
      }
      const fin = await this.repo.deliveryFinish(job.deliveryId, outcome.status, outcome.detail, outcome.ref);
      invoiceStatus = fin.invoiceStatus;
      results.push({ channel, status: outcome.status, message: outcome.detail, deliveryId: job.deliveryId, invoiceStatus: fin.invoiceStatus as RechargeSendResult['invoiceStatus'] });
    }
    return { results, invoiceStatus };
  }

  private async sendEmail(job: Awaited<ReturnType<SupportRechargeRepository['deliveryBegin']>>): Promise<{ status: 'SENT' | 'NOT_SENT' | 'FAILED'; detail: string; ref: string | null }> {
    const pdf = await this.storage.readStored(job.file.provider, job.file.bucket, job.file.path);
    const r = await this.work.mail({
      stage: 'PAID', to: job.to, customerName: job.customerName, number: job.number, invoiceDate: String(job.invoiceDate).slice(0, 10),
      total: rs(toPaise(String(job.total)) ?? Math.round(Number(job.total) * 100)), pdf, fileName: invoicePdfName(job.number), customerId: job.customerId
    });
    return { status: r.outcome, detail: r.detail, ref: r.messageId };
  }

  private async sendWhatsApp(job: Awaited<ReturnType<SupportRechargeRepository['deliveryBegin']>>): Promise<{ status: 'SENT' | 'NOT_SENT' | 'FAILED'; detail: string; ref: string | null }> {
    const settings = await this.repo.whatsappSettings();
    if (!settings.enabled) return { status: 'NOT_SENT', detail: 'WhatsApp invoices are switched off in the Accounts settings. Nothing was sent.', ref: null };
    const mode = this.work.whatsappMode();
    if (mode === 'off') return { status: 'NOT_SENT', detail: 'Invoice WhatsApp is switched off on the server. Nothing was sent.', ref: null };
    if (mode === 'dry_run') return { status: 'NOT_SENT', detail: 'Test mode: the WhatsApp message was prepared but NOT sent to the customer.', ref: null };
    const sender = this.work.whatsappSender();
    if (!sender) return { status: 'NOT_SENT', detail: 'No WhatsApp service is connected on the server. Nothing was sent.', ref: null };
    if (sender.provider !== 'BUILDER' && (!settings.templateApproved || !settings.templateName)) return { status: 'NOT_SENT', detail: 'The WhatsApp template is not approved, so nothing was sent.', ref: null };
    // a short-lived link, made now, handed to the provider and forgotten: it is not stored, logged or returned to anyone
    const link = await this.storage.signedDownloadUrl(job.file.bucket, job.file.path, invoiceLinkTtlSeconds(), invoicePdfName(job.number), job.file.provider);
    const wa: InvoiceWhatsAppJob = {
      id: job.deliveryId, attempts: 1, invoiceId: job.invoiceId, customerId: job.customerId ?? '', number: job.number, invoiceDate: String(job.invoiceDate).slice(0, 10), total: job.total,
      customerName: job.customerName, to: job.to, file: { provider: job.file.provider, bucket: job.file.bucket, path: job.file.path, sizeBytes: job.file.sizeBytes, etag: job.file.etag },
      template: { name: settings.templateName, language: settings.templateLanguage, approved: settings.templateApproved }
    };
    const r = await sender.send(wa, link);
    if (r.outcome === 'ACCEPTED') return { status: 'SENT', detail: r.detail, ref: r.ref ?? null };
    if (r.outcome === 'SKIPPED') return { status: 'NOT_SENT', detail: r.detail, ref: null };
    // RETRY and FAILED: nothing was delivered; Accounts retry from the screen
    return { status: 'FAILED', detail: r.detail, ref: null };
  }
}
