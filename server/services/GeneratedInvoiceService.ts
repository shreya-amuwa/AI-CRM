import type { ClientDocumentUrl, GeneratedInvoice, Invoice, InvoicePrefill, InvoiceRunResult, InvoiceStage, InvoiceStep } from '../../shared/contracts.js';
import { invoiceDate, rs, toPaise } from '../../shared/invoiceCalc.js';
import { generatedInvoiceIssueSchema, invoiceConfirmPaymentSchema, invoiceDeliverSchema, invoiceFileQuerySchema, invoicePrefillQuerySchema, uuidSchema } from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { sendInvoiceEmail } from '../invoices/mailer.js';
import { renderInvoicePdf, type InvoicePdfInput } from '../invoices/pdf.js';
import type { ClaimedStage, GeneratedInvoiceRepository } from '../repositories/GeneratedInvoiceRepository.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

const BUCKET = 'customer-documents';
const FILE_URL_TTL_SECONDS = 120;

/** What the service needs from the outside world, replaceable in tests. */
export interface InvoiceWork {
  render: typeof renderInvoicePdf;
  mail: typeof sendInvoiceEmail;
}

/** The stored location of a stage's PDF: one fixed object per invoice and stage (the database accepts no other). */
export const invoiceObjectPath = (customerId: string, invoiceId: string, stage: InvoiceStage) => `customers/${customerId}/invoices/${invoiceId}/${stage.toLowerCase()}.pdf`;
const fileNameOf = (number: string, stage: InvoiceStage) => `${number.replace(/[^A-Za-z0-9._-]+/g, '-')}-${stage === 'PAID' ? 'paid-invoice' : 'invoice'}.pdf`;

type Snapshot = GeneratedInvoice & { invoiceId: string; customerId: string; issuedAt: string; stage: InvoiceStage; recipientEmail: string | null; stored: ClaimedStage['invoice']['stored'] };

function toPdfInput(s: Snapshot): InvoicePdfInput {
  return {
    number: s.number,
    invoiceDate: s.invoiceDate,
    orderNumber: s.orderNumber,
    customer: {
      name: s.customer.name,
      businessName: s.customer.businessName,
      address: s.customer.address,
      contactPerson: s.customer.contactPerson,
      contactNumber: s.customer.contactNumber,
      gstin: s.customer.gstin,
      state: s.customer.state,
      stateCode: s.customer.stateCode
    },
    taxTreatment: s.taxTreatment,
    taxTreatmentOverridden: s.taxTreatmentOverridden,
    reverseCharge: s.reverseCharge,
    terms: s.terms,
    lines: s.lines,
    totals: s.totals,
    paymentSummary: s.paymentSummary,
    issuedAt: s.issuedAt
  };
}

/** A message safe to show Accounts: what we raised on purpose, never database or provider internals. */
const safeMessage = (e: unknown, fallback: string) => (e instanceof AppError ? e.message : fallback);

/**
 * The Accounts invoice workflow. Each document goes through the same steps, each one recorded in the database only after it
 * really happened, so any step can fail and be retried without repeating the others:
 *   claim the stage (one run at a time) -> draw the PDF from the stored snapshot -> store it -> record the reference
 *   -> e-mail it -> record the result.
 * Payment confirmation is its own database step: a failed PDF or e-mail never undoes it.
 */
export class GeneratedInvoiceService {
  constructor(
    private readonly repo: GeneratedInvoiceRepository,
    private readonly storage: StorageRepository,
    private readonly work: InvoiceWork = { render: renderInvoicePdf, mail: sendInvoiceEmail }
  ) {}

  prefill(customerId: unknown, query: unknown): Promise<InvoicePrefill> {
    const q = parse(invoicePrefillQuerySchema, query ?? {});
    return this.repo.prefill(parse(uuidSchema, customerId), q.purpose, q.addonRequestId);
  }

  /** Stage 1: persist the snapshot (once), then the unpaid PDF and its e-mail. A repeated request resumes instead of duplicating. */
  async issue(body: unknown): Promise<InvoiceRunResult & { created: boolean }> {
    const issued = await this.repo.issue(parse(generatedInvoiceIssueSchema, body));
    const first: InvoiceStep = { step: 'ISSUE', stage: null, status: 'DONE', message: issued.replayed ? 'This invoice was already issued; continuing where it stopped.' : null };
    const run = await this.runStage(issued.id, 'UNPAID');
    return { invoice: run.invoice, steps: [first, ...run.steps], created: !issued.replayed };
  }

  /**
   * Stage 2: confirm the payment (idempotent). A part payment is recorded and the invoice stays open with its balance; once the
   * balance is zero the invoice is marked paid and the paid PDF (with the PAID stamp) and its e-mail follow.
   */
  async confirmPayment(id: unknown, body: unknown): Promise<InvoiceRunResult> {
    const invoiceId = parse(uuidSchema, id);
    const confirmed = await this.repo.confirmPayment(invoiceId, parse(invoiceConfirmPaymentSchema, body));
    if (!confirmed.settled) {
      const balance = confirmed.generated?.paymentSummary?.balance;
      return {
        invoice: confirmed,
        steps: [{ step: 'PAYMENT', stage: null, status: 'DONE', message: `Part payment recorded.${balance !== undefined ? ` Balance left: Rs.${balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.` : ''} The paid invoice is made when the balance is zero.` }]
      };
    }
    const first: InvoiceStep = { step: 'PAYMENT', stage: null, status: 'DONE', message: confirmed.replayed ? 'The payment was already confirmed.' : null };
    const run = await this.runStage(invoiceId, 'PAID');
    return { invoice: run.invoice, steps: [first, ...run.steps] };
  }

  /** Retry what is left of a stage (a missing PDF, a missing e-mail). Nothing already done is repeated. */
  async deliver(id: unknown, body: unknown): Promise<InvoiceRunResult> {
    return this.runStage(parse(uuidSchema, id), parse(invoiceDeliverSchema, body).stage);
  }

  async fileUrl(id: unknown, query: unknown): Promise<ClientDocumentUrl> {
    const q = parse(invoiceFileQuerySchema, query ?? {});
    const f = await this.repo.file(parse(uuidSchema, id), q.stage, q.action === 'download' ? 'DOWNLOAD' : 'VIEW');
    if (!f) throw new AppError('NOT_FOUND', 'Invoice file not found.');
    const url = await this.storage.signedDownloadUrl(f.storage_bucket, f.storage_path, FILE_URL_TTL_SECONDS, q.action === 'download' ? f.original_file_name : undefined, f.storage_provider);
    return { url, expiresInSeconds: FILE_URL_TTL_SECONDS, fileName: f.original_file_name };
  }

  /** One stage's remaining work. Never throws for a failed PDF or e-mail: those are reported as steps (and recorded) so the invoice stays. */
  async runStage(invoiceId: string, stage: InvoiceStage): Promise<InvoiceRunResult> {
    const claim = await this.repo.claim(invoiceId, stage);
    if (!claim.claimed) {
      const invoice = await this.repo.detail(invoiceId);
      return claim.reason === 'DONE'
        ? { invoice, steps: [{ step: 'PDF', stage, status: 'DONE', message: 'Nothing left to do: the PDF is stored and the e-mail was sent.' }] }
        : { invoice, steps: [{ step: 'PDF', stage, status: 'BUSY', message: 'Another request is working on this invoice right now. Check again in a moment.' }] };
    }
    const snap = claim.invoice as unknown as Snapshot;
    const state = stage === 'UNPAID' ? snap.unpaid : snap.paid;
    const steps: InvoiceStep[] = [];
    let held = true;
    try {
      let pdf: Uint8Array | null = null;
      let stored = snap.stored;

      // ---- the PDF
      if (state.pdfStatus !== 'STORED' || !stored) {
        try {
          const rendered = await this.work.render(toPdfInput(snap), { stage });
          pdf = rendered.bytes;
          const path = invoiceObjectPath(snap.customerId, snap.invoiceId, stage);
          const file = await this.storage.storeGenerated(BUCKET, path, pdf, 'application/pdf');
          await this.repo.recordPdf(snap.invoiceId, stage, { provider: file.provider, bucket: BUCKET, path, reference: file.reference, etag: file.etag, size: file.size });
          stored = { provider: file.provider, bucket: BUCKET, path, sizeBytes: file.size, etag: file.etag };
          steps.push({ step: 'PDF', stage, status: 'DONE', message: null });
        } catch (e) {
          const message = safeMessage(e, 'The invoice PDF could not be created or stored.');
          if (!(e instanceof AppError)) console.error('[invoice] pdf step failed', { invoice: snap.invoiceId, stage, message: (e as Error)?.message });
          await this.repo.recordFailure(snap.invoiceId, stage, 'PDF', message).catch(err => console.error('[invoice] could not record the failure', (err as Error)?.message));
          held = false;
          steps.push({ step: 'PDF', stage, status: 'FAILED', message });
          return { invoice: await this.repo.detail(invoiceId), steps };
        }
      } else {
        steps.push({ step: 'PDF', stage, status: 'DONE', message: 'The PDF was already stored.' });
      }

      // ---- the e-mail (never "sent" unless the mail server accepted it)
      if (state.emailStatus !== 'SENT') {
        try {
          pdf ??= await this.storage.readStored(stored.provider, stored.bucket, stored.path);
          const total = rs(toPaise(String(snap.totals.total)) ?? Math.round(snap.totals.total * 100));
          const sent = await this.work.mail({
            stage,
            to: snap.recipientEmail,
            customerName: snap.customer.businessName || snap.customer.name,
            number: snap.number,
            invoiceDate: invoiceDate(snap.invoiceDate),
            total,
            pdf,
            fileName: fileNameOf(snap.number, stage)
          });
          try {
            await this.repo.recordEmail(snap.invoiceId, stage, { outcome: sent.outcome, to: sent.to, messageId: sent.messageId, detail: sent.outcome === 'SENT' ? null : sent.detail });
            held = false;
          } catch (err) {
            // the one window no retry logic can close: the message left, but the database did not hear about it
            console.error('[invoice] e-mail result could not be recorded', { invoice: snap.invoiceId, stage, sent: sent.outcome, message: (err as Error)?.message });
            steps.push({ step: 'EMAIL', stage, status: 'FAILED', message: sent.outcome === 'SENT' ? 'The e-mail was sent, but recording it failed. Check the customer\'s inbox before sending it again.' : sent.detail });
            return { invoice: await this.repo.detail(invoiceId), steps };
          }
          steps.push({ step: 'EMAIL', stage, status: sent.outcome === 'SENT' ? 'DONE' : sent.outcome === 'NOT_SENT' ? 'NOT_SENT' : 'FAILED', message: sent.outcome === 'SENT' ? null : sent.detail });
        } catch (e) {
          const message = safeMessage(e, 'The e-mail could not be sent.');
          if (!(e instanceof AppError)) console.error('[invoice] e-mail step failed', { invoice: snap.invoiceId, stage, message: (e as Error)?.message });
          await this.repo.recordFailure(snap.invoiceId, stage, 'EMAIL', message).catch(err => console.error('[invoice] could not record the failure', (err as Error)?.message));
          held = false;
          steps.push({ step: 'EMAIL', stage, status: 'FAILED', message });
        }
      } else {
        steps.push({ step: 'EMAIL', stage, status: 'DONE', message: 'The e-mail was already sent.' });
      }
      return { invoice: await this.repo.detail(invoiceId), steps };
    } finally {
      // a run that ended without recording its last step must not keep the stage locked for its full lease
      if (held) await this.repo.release(invoiceId, stage).catch(() => undefined);
    }
  }
}

export type { Invoice };
