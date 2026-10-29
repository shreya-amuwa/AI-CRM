/**
 * The invoice workflow service with stand-ins for the database, storage and mail server: the ORDER of the steps, what is
 * recorded when, and that every failure can be retried without repeating what already worked. (The database rules
 * themselves - leases, immutability, who may call what - are covered by invoices_test.sql and the API tests.)
 * Run: npm run test:unit
 */
import { createHash } from 'node:crypto';
import { AppError } from '../../server/http/errors.js';
import { GeneratedInvoiceService, invoiceObjectPath } from '../../server/services/GeneratedInvoiceService.js';
import type { GeneratedInvoiceRepository } from '../../server/repositories/GeneratedInvoiceRepository.js';
import type { StorageRepository } from '../../server/repositories/StorageRepository.js';
import { renderInvoicePdf } from '../../server/invoices/pdf.js';
import { sampleInvoice } from './invoice_fixtures.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

const INVOICE_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const snapshot = sampleInvoice(3);

/** Just enough of the database's behaviour for the service: a lease, per-stage state, and a log of every call. */
class FakeRepo {
  calls: string[] = [];
  lease: Record<string, boolean> = {};
  state: Record<string, { pdf: 'PENDING' | 'STORED' | 'FAILED'; email: 'PENDING' | 'SENT' | 'FAILED' | 'NOT_SENT'; stored: null | { provider: 'R2'; bucket: string; path: string; sizeBytes: number; etag: string | null } }> = {
    UNPAID: { pdf: 'PENDING', email: 'PENDING', stored: null },
    PAID: { pdf: 'PENDING', email: 'PENDING', stored: null }
  };
  recordPdfFails = 0;
  recordEmailFails = 0;
  records: { pdf: { stage: string; path: string; size: number; ref: string }[]; email: { stage: string; outcome: string }[] } = { pdf: [], email: [] };

  async issue() {
    this.calls.push('issue');
    return { id: INVOICE_ID, replayed: false };
  }
  /** What the next confirmation returns: settled (the balance is zero) or a part payment. */
  settled = true;
  async confirmPayment() {
    this.calls.push('confirmPayment');
    return this.settled
      ? { id: INVOICE_ID, replayed: false, settled: true }
      : { id: INVOICE_ID, replayed: false, settled: false, generated: { paymentSummary: { balance: 6800 } } };
  }
  async claim(_id: string, stage: string) {
    this.calls.push(`claim:${stage}`);
    const s = this.state[stage];
    const invoice = (() => ({
      ...snapshot,
      invoiceId: INVOICE_ID, customerId: CUSTOMER_ID, issuedAt: '2026-10-16T09:30:00Z', stage, recipientEmail: 'priya@example.com', stored: s.stored,
      unpaid: { pdfStatus: this.state.UNPAID.pdf, emailStatus: this.state.UNPAID.email }, paid: { pdfStatus: this.state.PAID.pdf, emailStatus: this.state.PAID.email }
    }))();
    if (s.pdf === 'STORED' && s.email === 'SENT') return { claimed: false, reason: 'DONE', invoice };
    if (this.lease[stage]) return { claimed: false, reason: 'BUSY', invoice };
    this.lease[stage] = true;
    return { claimed: true, reason: null, invoice };
  }
  async release(_id: string, stage: string) {
    this.calls.push(`release:${stage}`);
    this.lease[stage] = false;
  }
  async recordPdf(_id: string, stage: string, f: { provider: 'R2'; bucket: string; path: string; reference: string; etag: string | null; size: number }) {
    this.calls.push(`recordPdf:${stage}`);
    if (this.recordPdfFails > 0) {
      this.recordPdfFails--;
      throw new AppError('SERVICE_UNAVAILABLE', 'The database is not reachable.');
    }
    const s = this.state[stage];
    if (s.pdf !== 'STORED') {
      s.pdf = 'STORED';
      s.stored = { provider: f.provider, bucket: f.bucket, path: f.path, sizeBytes: f.size, etag: f.etag };
      this.records.pdf.push({ stage, path: f.path, size: f.size, ref: f.reference });
    }
    return this.detail();
  }
  async recordEmail(_id: string, stage: string, r: { outcome: 'SENT' | 'NOT_SENT' | 'FAILED' }) {
    this.calls.push(`recordEmail:${stage}:${r.outcome}`);
    if (this.recordEmailFails > 0) {
      this.recordEmailFails--;
      throw new AppError('SERVICE_UNAVAILABLE', 'The database is not reachable.');
    }
    this.lease[stage] = false;
    if (this.state[stage].email !== 'SENT') {
      this.state[stage].email = r.outcome;
      this.records.email.push({ stage, outcome: r.outcome });
    }
    return this.detail();
  }
  async recordFailure(_id: string, stage: string, step: string, error: string) {
    this.calls.push(`recordFailure:${stage}:${step}:${error}`);
    this.lease[stage] = false;
    if (step === 'PDF' && this.state[stage].pdf !== 'STORED') this.state[stage].pdf = 'FAILED';
    if (step === 'EMAIL' && this.state[stage].email !== 'SENT') this.state[stage].email = 'FAILED';
    return this.detail();
  }
  async detail() {
    return { id: INVOICE_ID, number: snapshot.number } as never;
  }
}

class FakeStorage {
  objects = new Map<string, Uint8Array>();
  puts: string[] = [];
  reads: string[] = [];
  failPut = 0;
  async storeGenerated(bucket: string, path: string, bytes: Uint8Array) {
    if (this.failPut > 0) {
      this.failPut--;
      throw new AppError('SERVICE_UNAVAILABLE', 'File storage is not available right now. Please try again.');
    }
    this.puts.push(path);
    this.objects.set(`${bucket}/${path}`, bytes);
    return { provider: 'R2' as const, reference: `r2://files/${bucket}/${path}`, etag: sha(bytes).slice(0, 32), size: bytes.length };
  }
  async readStored(_provider: unknown, bucket: string, path: string) {
    this.reads.push(path);
    const b = this.objects.get(`${bucket}/${path}`);
    if (!b) throw new AppError('NOT_FOUND', 'The stored file was not found.');
    return b;
  }
}

function setup(mail: (i: { stage: string; pdf: Uint8Array; to: string | null }) => Promise<{ outcome: 'SENT' | 'NOT_SENT' | 'FAILED'; detail: string; messageId: string | null; to: string | null }>) {
  const repo = new FakeRepo();
  const storage = new FakeStorage();
  const renders: string[] = [];
  const mails: { stage: string; bytes: string; to: string | null; fileName: string; contactName?: string | null; customerName?: string }[] = [];
  const service = new GeneratedInvoiceService(repo as unknown as GeneratedInvoiceRepository, storage as unknown as StorageRepository, {
    render: async (inv, o) => {
      renders.push(o.stage);
      return renderInvoicePdf(inv, o);
    },
    mail: (async (i: Parameters<typeof mail>[0] & { fileName: string; contactName?: string | null; customerName?: string }) => {
      mails.push({ stage: i.stage, bytes: sha(i.pdf), to: i.to, fileName: i.fileName, contactName: i.contactName, customerName: i.customerName });
      return mail(i);
    }) as never
  });
  return { repo, storage, renders, mails, service };
}
const sentOk = async (i: { to: string | null }) => ({ outcome: 'SENT' as const, detail: 'ok', messageId: '<m@x>', to: i.to });

// ---------------------------------------------------------------------------
console.log('--- 1. The normal run: every step in order, each recorded only after it happened');
{
  const t = setup(sentOk);
  const r = await t.service.runStage(INVOICE_ID, 'UNPAID');
  check(r.steps.map(s => `${s.step}:${s.status}`).join() === 'PDF:DONE,EMAIL:DONE', 'PDF then e-mail, both done', r.steps);
  check(t.repo.calls.join() === 'claim:UNPAID,recordPdf:UNPAID,recordEmail:UNPAID:SENT', 'claim -> store reference -> e-mail result, nothing else', t.repo.calls);
  const path = invoiceObjectPath(CUSTOMER_ID, INVOICE_ID, 'UNPAID');
  check(t.storage.puts.join() === path && path === `customers/${CUSTOMER_ID}/invoices/${INVOICE_ID}/unpaid.pdf`, 'the file goes to the one fixed object of this invoice and stage');
  const stored = t.storage.objects.get(`customer-documents/${path}`)!;
  check(stored.length < 500000 && sha(stored) === t.mails[0].bytes, 'the e-mail carries exactly the stored file, which is below 500,000 bytes');
  check(t.repo.records.pdf[0].size === stored.length && t.repo.records.pdf[0].ref.endsWith(`customer-documents/${path}`), 'the recorded reference and size are those of the stored object');
  check(t.mails[0].fileName === 'INV-2026-00022-invoice.pdf' && t.mails[0].to === 'priya@example.com', 'the attachment is named after the invoice and goes to the customer');
  check(t.mails[0].contactName === snapshot.customer.contactPerson && t.mails[0].customerName === snapshot.customer.businessName, 'the e-mail is given the contact person to greet (the business name stays the fallback)');
  check(!t.repo.lease.UNPAID, 'the stage is not left locked');
}

console.log('--- 2. The upload fails: nothing is recorded as stored, nothing is e-mailed, the retry finishes the job');
{
  const t = setup(sentOk);
  t.storage.failPut = 1;
  const r = await t.service.runStage(INVOICE_ID, 'UNPAID');
  check(r.steps.length === 1 && r.steps[0].step === 'PDF' && r.steps[0].status === 'FAILED' && /File storage is not available/.test(r.steps[0].message ?? ''), 'a clear failed PDF step', r.steps);
  check(t.repo.records.pdf.length === 0 && t.mails.length === 0, 'no reference recorded, no e-mail sent');
  check(t.repo.calls.some(c => c.startsWith('recordFailure:UNPAID:PDF')) && !t.repo.lease.UNPAID && t.repo.state.UNPAID.pdf === 'FAILED', 'the failure is recorded and the stage is free for a retry');
  const again = await t.service.deliver(INVOICE_ID, { stage: 'UNPAID' });
  check(again.steps.map(s => `${s.step}:${s.status}`).join() === 'PDF:DONE,EMAIL:DONE' && t.repo.records.pdf.length === 1 && t.mails.length === 1, 'the retry stores the file and sends the e-mail, once each');
  check(t.repo.calls.filter(c => c.startsWith('issue')).length === 0, 'a retry never issues a second invoice');
}

console.log('--- 3. The reference cannot be saved (database hiccup) after the upload');
{
  const t = setup(sentOk);
  t.repo.recordPdfFails = 1;
  const r = await t.service.runStage(INVOICE_ID, 'UNPAID');
  check(r.steps[0].status === 'FAILED' && t.mails.length === 0 && t.repo.state.UNPAID.pdf === 'FAILED', 'reported as failed, not e-mailed, not marked stored');
  const first = [...t.storage.objects.values()][0];
  const again = await t.service.deliver(INVOICE_ID, { stage: 'UNPAID' });
  check(again.steps.map(s => `${s.step}:${s.status}`).join() === 'PDF:DONE,EMAIL:DONE', 'the retry completes');
  const second = [...t.storage.objects.values()][0];
  check(t.storage.objects.size === 1 && sha(first) === sha(second), 'the retry re-draws the identical file at the same object (no second, different file)');
  check(t.repo.records.pdf.length === 1 && t.mails.length === 1, 'one stored reference, one e-mail');
}

console.log('--- 4. The e-mail fails: the PDF stays stored and is not drawn again; the retry only sends');
{
  let calls = 0;
  const t = setup(async i => (++calls === 1 ? { outcome: 'FAILED' as const, detail: 'SMTP sign-in failed: check the mailbox and its app password.', messageId: null, to: i.to } : sentOk(i)));
  const r = await t.service.runStage(INVOICE_ID, 'UNPAID');
  check(r.steps.map(s => `${s.step}:${s.status}`).join() === 'PDF:DONE,EMAIL:FAILED' && /SMTP sign-in failed/.test(r.steps[1].message ?? ''), 'PDF done, e-mail failed with the reason', r.steps);
  check(t.repo.state.UNPAID.pdf === 'STORED' && t.repo.state.UNPAID.email === 'FAILED', 'the database says: stored, e-mail failed (never "sent")');
  const rendersBefore = t.renders.length;
  const again = await t.service.deliver(INVOICE_ID, { stage: 'UNPAID' });
  check(t.renders.length === rendersBefore && t.storage.puts.length === 1, 'the retry does not draw or upload the PDF again');
  check(t.storage.reads.length === 1 && again.steps.map(s => `${s.step}:${s.status}`).join() === 'PDF:DONE,EMAIL:DONE', 'it reads the stored file back and e-mails that');
  check(t.mails.length === 2 && t.mails[0].bytes === t.mails[1].bytes && t.repo.state.UNPAID.email === 'SENT', 'the same bytes, and now (only now) the e-mail is SENT');
}

console.log('--- 5. Nothing sent on purpose (dry run, no address): not marked sent, can be sent later');
{
  let live = false;
  const t = setup(async i => (live ? sentOk(i) : { outcome: 'NOT_SENT' as const, detail: 'Dry run: nothing is sent while AUTOMATION_MODE is not "live".', messageId: null, to: i.to }));
  const r = await t.service.runStage(INVOICE_ID, 'UNPAID');
  check(r.steps[1].status === 'NOT_SENT' && /Dry run/.test(r.steps[1].message ?? '') && t.repo.state.UNPAID.email === 'NOT_SENT', 'NOT_SENT with the reason, and the database does not say SENT');
  live = true;
  const again = await t.service.deliver(INVOICE_ID, { stage: 'UNPAID' });
  check(again.steps[1].status === 'DONE' && t.repo.state.UNPAID.email === 'SENT' && t.storage.puts.length === 1, 'once e-mail is live the retry sends it (the PDF is not redone)');
}

console.log('--- 6. Double click / repeated request: the second does nothing');
{
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const t = setup(async i => {
    await gate;
    return sentOk(i);
  });
  const first = t.service.runStage(INVOICE_ID, 'UNPAID');
  await new Promise(r => setTimeout(r, 30));
  const second = await t.service.runStage(INVOICE_ID, 'UNPAID');
  check(second.steps.length === 1 && second.steps[0].status === 'BUSY', 'the second request gets BUSY', second.steps);
  release();
  const done = await first;
  check(done.steps.map(s => s.status).join() === 'DONE,DONE', 'the first request completes normally');
  check(t.renders.length === 1 && t.storage.puts.length === 1 && t.mails.length === 1, 'one render, one upload, one e-mail in total');
  const third = await t.service.runStage(INVOICE_ID, 'UNPAID');
  check(third.steps.length === 1 && third.steps[0].status === 'DONE' && /Nothing left to do/.test(third.steps[0].message ?? '') && t.mails.length === 1, 'a request after completion repeats nothing');
}

console.log('--- 7. The paid stage: a second, separate document');
{
  const t = setup(sentOk);
  await t.service.runStage(INVOICE_ID, 'UNPAID');
  const unpaidBytes = [...t.storage.objects.entries()].find(([k]) => k.endsWith('/unpaid.pdf'))![1];
  const r = await t.service.confirmPayment(INVOICE_ID, { method: 'UPI', reference: 'TXN1' });
  check(r.steps.map(s => `${s.step}:${s.status}`).join() === 'PAYMENT:DONE,PDF:DONE,EMAIL:DONE', 'payment, then the paid PDF, then its e-mail');
  check(t.storage.objects.size === 2 && [...t.storage.objects.keys()].some(k => k.endsWith('/paid.pdf')), 'the paid file is a second object; the unpaid one is untouched');
  const paidBytes = [...t.storage.objects.entries()].find(([k]) => k.endsWith('/paid.pdf'))![1];
  check(sha(paidBytes) !== sha(unpaidBytes) && sha([...t.storage.objects.entries()].find(([k]) => k.endsWith('/unpaid.pdf'))![1]) === sha(unpaidBytes), 'different bytes, and the unpaid file did not change');
  check(t.renders.join() === 'UNPAID,PAID' && t.repo.records.pdf.map(p => p.stage).join() === 'UNPAID,PAID' && new Set(t.repo.records.pdf.map(p => p.ref)).size === 2, 'separate references per stage');
  check(t.repo.records.pdf.every(p => p.size < 500000), 'both PDFs are below 500,000 bytes');
  check(t.repo.calls.filter(c => c === 'issue').length === 0, 'confirming the payment never issues an invoice');
}
{
  // the payment is confirmed first and stays confirmed whatever happens to the paid PDF or its e-mail
  const t = setup(sentOk);
  await t.service.runStage(INVOICE_ID, 'UNPAID');
  t.storage.failPut = 1;
  const r = await t.service.confirmPayment(INVOICE_ID, { method: 'CASH' });
  check(r.steps[0].step === 'PAYMENT' && r.steps[0].status === 'DONE' && r.steps[1].status === 'FAILED', 'a failed paid PDF is reported, the payment stays confirmed');
  const retry = await t.service.confirmPayment(INVOICE_ID, { method: 'CASH' });
  check(retry.steps.map(s => `${s.step}:${s.status}`).join() === 'PAYMENT:DONE,PDF:DONE,EMAIL:DONE' && t.repo.calls.filter(c => c === 'confirmPayment').length === 2, 'clicking again finishes the paid stage (the payment confirmation itself is idempotent in the database)');

  // a part payment: recorded, and no paid invoice, PDF or e-mail is made until the balance is zero
  const part = setup(sentOk);
  part.repo.settled = false;
  const pr = await part.service.confirmPayment(INVOICE_ID, { method: 'UPI', reference: 'P1', amount: '5000' });
  check(pr.steps.length === 1 && pr.steps[0].step === 'PAYMENT' && /Part payment recorded/.test(pr.steps[0].message ?? '') && /6,800\.00/.test(pr.steps[0].message ?? '')
    && !part.repo.calls.some(c => c.startsWith('claim')) && part.mails.length === 0, 'a part payment is recorded and nothing else happens: no claim, no PDF, no e-mail');
}

console.log('--- 8. Nothing that was already done is repeated');
{
  const t = setup(sentOk);
  await t.service.runStage(INVOICE_ID, 'UNPAID');
  await t.service.runStage(INVOICE_ID, 'UNPAID');
  await t.service.deliver(INVOICE_ID, { stage: 'UNPAID' });
  check(t.renders.length === 1 && t.storage.puts.length === 1 && t.mails.length === 1 && t.repo.records.pdf.length === 1 && t.repo.records.email.length === 1, 'any number of retries after success: still one PDF and one e-mail');
}

console.log('--- 9. The e-mail left but the database could not be told');
{
  const t = setup(sentOk);
  t.repo.recordEmailFails = 1;
  const r = await t.service.runStage(INVOICE_ID, 'UNPAID');
  check(r.steps[1].status === 'FAILED' && /was sent, but recording it failed/.test(r.steps[1].message ?? ''), 'the message says so honestly (check the inbox before sending again)', r.steps);
}

console.log('--- 10. Errors shown to Accounts never carry internals');
{
  const repo = new FakeRepo();
  const storage = new FakeStorage();
  const service = new GeneratedInvoiceService(repo as unknown as GeneratedInvoiceRepository, storage as unknown as StorageRepository, {
    render: async () => {
      throw new Error('connect ECONNREFUSED postgres://user:secret@db.internal:5432/crm');
    },
    mail: sentOk as never
  });
  const r = await service.runStage(INVOICE_ID, 'UNPAID');
  check(r.steps[0].status === 'FAILED' && !/secret|postgres|ECONNREFUSED/.test(JSON.stringify(r)) && /could not be created or stored/.test(r.steps[0].message ?? ''), 'a generic message; the details are only in the server log');
}

console.log(`=== ALL INVOICE DELIVERY TESTS PASSED (${passed}) ===`);
