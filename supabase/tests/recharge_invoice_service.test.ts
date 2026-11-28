// The recharge invoice service (server/services/RechargeInvoiceService.ts) with the database, the storage, the PDF drawing, the e-mail and the WhatsApp provider all replaced by
// fakes: nothing real is e-mailed or sent on WhatsApp. It checks the order of the steps, what is recorded after each, that a channel is SENT only when the provider accepted it,
// that a refusal of one channel does not stop the other, and that no send happens by accident.
import { AppError } from '../../server/http/errors.js';
import { RechargeInvoiceService, type RechargeInvoiceWork } from '../../server/services/RechargeInvoiceService.js';

let passed = 0;
const check = (cond: boolean, name: string, extra?: unknown) => {
  if (!cond) { console.error('not ok -', name, extra ?? ''); process.exit(1); }
  passed++;
  console.log('ok -', name);
};
const RID = '11111111-1111-4111-8111-111111111111';
const IID = '22222222-2222-4222-8222-222222222222';

const snapshot = (over: Record<string, unknown> = {}) => ({
  invoiceId: IID, rechargeId: RID, customerId: 'c1', number: 'GST/26-27/014', invoiceType: 'GST', invoiceDate: '2026-11-28', orderNumber: 'Panel recharge PRC-00001 · Alpha',
  customer: { name: 'Alpha', businessName: 'Alpha', address: '12 MG Road, Pune', contactPerson: null, contactNumber: '+919876543210', gstin: '27AAPFU0939F1ZV', state: 'Maharashtra', stateCode: '27' }, recipientEmail: 'a@example.com',
  taxTreatment: 'INTRA_STATE', taxTreatmentOverridden: false, reverseCharge: false, terms: 'Paid in full.',
  lines: [{ position: 1, particulars: 'Panel recharge (PRC-00001)', hsnSac: '998313', taxRate: 18, quantity: '1 Nos', baseAmount: 500, gstAmount: 90, totalAmount: 590 }],
  totals: { subtotal: 500, cgstAmount: 45, sgstAmount: 45, igstAmount: 0, totalGst: 90, total: 590, inWords: 'Five Hundred Ninety Only/-', breakdown: [{ rate: 18, base: 500, gst: 90, cgst: 45, sgst: 45, igst: 0 }] },
  paymentSummary: { total: 590, confirmed: 590, balance: 0, state: 'FULLY_PAID', payments: [{ amount: 590 }] }, issuedAt: '2026-11-28T08:00:00Z', pdfStatus: 'PENDING', stored: null, ...over
});

/** an in-memory stand-in for the repository: it refuses what the database refuses */
class FakeRepo {
  calls: string[] = [];
  snap: any = snapshot();
  pdf: 'PENDING' | 'READY' | 'FAILED' = 'PENDING';
  inflight = new Set<string>();
  sent = new Set<string>();
  deliveries: { id: string; channel: string; status: string; detail: string; ref: string | null; resend: boolean }[] = [];
  generateError: AppError | null = null;
  settings = { enabled: true, templateName: 'paid_invoice', templateLanguage: 'en', templateApproved: true };
  invoiceStatus = 'GENERATED';
  invoiceGet = async (_id: string) => { this.calls.push('invoiceGet'); return { id: IID, rechargeId: RID, number: 'GST/26-27/014', pdfStatus: this.pdf, deliveries: [] } as any; };
  invoiceGenerate = async (_id: string, _p: unknown) => { this.calls.push('invoiceGenerate'); if (this.generateError) throw this.generateError; return { id: IID, rechargeId: RID, number: 'GST/26-27/014', pdfStatus: 'PENDING', deliveries: [] } as any; };
  invoicePrefill = async () => ({ missing: [] } as any);
  invoiceSnapshot = async () => ({ ...this.snap, pdfStatus: this.pdf, stored: this.pdf === 'READY' ? { provider: 'R2', bucket: 'recharge-invoices', path: `invoices/${IID}/invoice.pdf`, sizeBytes: 100, etag: 'e' } : null });
  recordPdf = async (id: string, f: any) => { this.calls.push(`recordPdf:${f.bucket}:${f.path}`); this.pdf = 'READY'; void id; };
  recordPdfFailure = async (_id: string, e: string) => { this.calls.push(`recordPdfFailure:${e}`); this.pdf = 'FAILED'; };
  invoiceFile = async () => ({ provider: 'R2' as const, bucket: 'recharge-invoices', path: `invoices/${IID}/invoice.pdf`, number: 'GST/26-27/014' });
  setContact = async (_id: string, email: string | null, phone: string | null, note: string) => { this.calls.push(`contact:${email}:${phone}:${note}`); return {} as any; };
  whatsappSettings = async () => this.settings;
  deliveryBegin = async (_id: string, channel: string, resend: boolean) => {
    this.calls.push(`begin:${channel}:${resend}`);
    if (this.pdf !== 'READY') throw new AppError('CONFLICT', 'The invoice PDF is not ready yet. Retry the PDF first.');
    if (this.inflight.has(channel)) throw new AppError('CONFLICT', `This invoice is already being sent by ${channel.toLowerCase()} right now.`);
    if (this.sent.has(channel) && !resend) throw new AppError('CONFLICT', `The invoice was already sent by ${channel.toLowerCase()}. Use "Send again".`);
    if (channel === 'WHATSAPP' && !this.snap.customer.contactNumber) throw new AppError('VALIDATION_ERROR', 'The customer has no valid Indian mobile number.');
    const id = `del-${this.deliveries.length + 1}`;
    this.inflight.add(channel);
    this.deliveries.push({ id, channel, status: 'SENDING', detail: '', ref: null, resend: this.sent.has(channel) });
    return { deliveryId: id, channel: channel as 'EMAIL' | 'WHATSAPP', to: channel === 'EMAIL' ? 'a@example.com' : '+919876543210', isResend: this.sent.has(channel), invoiceId: IID, number: 'GST/26-27/014', invoiceDate: '2026-11-28', total: 590,
      customerName: 'Alpha', customerId: 'c1', file: { provider: 'R2' as const, bucket: 'recharge-invoices', path: `invoices/${IID}/invoice.pdf`, sizeBytes: 100, etag: 'e' } };
  };
  deliveryFinish = async (id: string, outcome: 'SENT' | 'NOT_SENT' | 'FAILED', detail: string, ref: string | null) => {
    this.calls.push(`finish:${outcome}`);
    const d = this.deliveries.find(x => x.id === id)!;
    d.status = outcome; d.detail = detail; d.ref = ref; this.inflight.delete(d.channel);
    if (outcome === 'SENT') this.sent.add(d.channel);
    this.invoiceStatus = this.sent.size === 2 ? 'SENT' : this.sent.has('EMAIL') ? 'EMAIL_SENT' : this.sent.has('WHATSAPP') ? 'WHATSAPP_SENT' : outcome === 'FAILED' ? 'FAILED' : 'GENERATED';
    return { id, channel: d.channel, status: outcome, invoiceStatus: this.invoiceStatus, replayed: false } as any;
  };
}
class FakeStorage {
  stored: { bucket: string; path: string; size: number }[] = [];
  links: { bucket: string; path: string; ttl: number; name?: string }[] = [];
  failStore = false;
  storeGenerated = async (bucket: string, path: string, bytes: Uint8Array) => {
    if (this.failStore) throw new Error('storage is down (secret-endpoint.internal)');
    this.stored.push({ bucket, path, size: bytes.length });
    return { provider: 'R2' as const, reference: `r2://x/${bucket}/${path}`, etag: 'etag', size: bytes.length };
  };
  readStored = async () => new Uint8Array([37, 80, 68, 70]);
  signedDownloadUrl = async (bucket: string, path: string, ttl: number, name?: string) => { this.links.push({ bucket, path, ttl, name }); return `https://signed.example/${path}?t=1`; };
}
const mkWork = () => {
  const w = {
    rendered: [] as any[], mails: [] as any[], sends: [] as { job: any; link: string }[], mode: 'live' as 'off' | 'dry_run' | 'live', provider: 'WABASTORE' as 'WABASTORE' | 'BUILDER' | null,
    renderError: null as Error | null, mailOutcome: { outcome: 'SENT', detail: 'Sent from meta@amuwa.com', messageId: 'msg-1', to: 'a@example.com' } as any,
    waOutcome: { outcome: 'ACCEPTED', detail: 'The WhatsApp webhook accepted the invoice (HTTP 200).', ref: 'wa-1' } as any, senderThrows: false
  };
  const work: RechargeInvoiceWork = {
    render: (async (inv: any, opts: any) => { if (w.renderError) throw w.renderError; w.rendered.push({ inv, opts }); return { bytes: new Uint8Array(1234), pages: 1 } as any; }) as any,
    mail: (async (i: any) => { w.mails.push(i); return w.mailOutcome; }) as any,
    whatsappMode: () => w.mode,
    whatsappSender: () => (w.provider ? { provider: w.provider, send: async (job: any, link: string) => { if (w.senderThrows) throw new Error('socket hang up wa.example'); w.sends.push({ job, link }); return w.waOutcome; } } as any : null)
  };
  return { w, work };
};
const setup = () => { const repo = new FakeRepo(); const storage = new FakeStorage(); const { w, work } = mkWork(); const svc = new RechargeInvoiceService(repo as any, storage as any, work); return { repo, storage, w, svc }; };
const refused = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };

// ---- generate: the invoice, then its PDF, stored privately
{
  const { repo, storage, w, svc } = setup();
  const r = await svc.generate(RID, {});
  check(r.pdf.status === 'READY' && repo.calls[0] === 'invoiceGenerate' && repo.calls.includes(`recordPdf:recharge-invoices:invoices/${IID}/invoice.pdf`), 'generate: the invoice is made first, then the PDF is stored in its own place and recorded');
  check(storage.stored.length === 1 && storage.stored[0].bucket === 'recharge-invoices' && storage.stored[0].path === `invoices/${IID}/invoice.pdf`, 'the PDF goes to the private recharge-invoices bucket under a fixed path');
  check(w.rendered.length === 1 && w.rendered[0].opts.stage === 'PAID' && w.rendered[0].inv.number === 'GST/26-27/014' && w.rendered[0].inv.totals.total === 590 && w.rendered[0].inv.lines[0].baseAmount === 500, 'the PDF is drawn (PAID) from the database snapshot: number, lines and totals as stored');
  check(w.rendered[0].inv.invoiceDate === '2026-11-28' && w.rendered[0].inv.customer.gstin === '27AAPFU0939F1ZV', 'with the customer and the invoice date from the snapshot');
  const again = await svc.generate(RID, {});
  check(again.pdf.status === 'READY' && w.rendered.length === 1 && storage.stored.length === 1, 'generating again does not draw or store a second PDF');
}
{
  const { repo, svc } = setup();
  repo.generateError = new AppError('CONFLICT', 'Confirm that the payment was received first. An invoice is made only for a verified payment.');
  const e = await refused(svc.generate(RID, {}));
  check(e?.code === 'CONFLICT' && /verified payment/.test(e.message) && !repo.calls.includes('recordPdf'), 'a refusal by the database (payment not verified) is passed on and nothing is drawn');
  check((await refused(svc.generate('not-a-uuid', {})))?.code === 'VALIDATION_ERROR' && (await refused(svc.generate(RID, { hsnSac: '12' })))?.code === 'VALIDATION_ERROR' && (await refused(svc.generate(RID, { amount: 5 })))?.code === 'VALIDATION_ERROR'
    && (await refused(svc.generate(RID, { taxTreatment: 'NONE' })))?.code === 'VALIDATION_ERROR', 'a bad id, HSN, an amount sent by the browser or a bad tax treatment are refused before the database');
}
{
  const { repo, storage, w, svc } = setup();
  w.renderError = new Error('pdf-lib exploded at /srv/secret/path');
  const r = await svc.generate(RID, {});
  check(r.pdf.status === 'FAILED' && repo.calls.some(c => c.startsWith('recordPdfFailure:')) && !/secret|exploded/.test(r.pdf.message ?? ''), 'a PDF failure is recorded, the invoice stays, and the message shows no internals');
  w.renderError = null;
  const retry = await svc.retryPdf(RID);
  check(retry.pdf.status === 'READY' && storage.stored.length === 1, 'retrying the PDF finishes it');
  storage.failStore = true; repo.pdf = 'PENDING';
  const r2 = await svc.retryPdf(RID);
  check(r2.pdf.status === 'FAILED' && !/secret-endpoint/.test(r2.pdf.message ?? ''), 'a storage failure is recorded without the storage address');
}
// ---- review: a short-lived link
{
  const { storage, svc } = setup();
  const v = await svc.fileUrl(RID, {});
  check(v.expiresInSeconds === 120 && storage.links[0].ttl === 120 && storage.links[0].name === undefined && storage.links[0].bucket === 'recharge-invoices', 'review: a 2-minute link, viewed in the browser');
  const d = await svc.fileUrl(RID, { action: 'download' });
  check(storage.links[1].name === 'GST-26-27-014-paid-invoice.pdf' && d.fileName === 'GST-26-27-014-paid-invoice.pdf', 'download: the file gets a safe name');
}
// ---- e-mail
{
  const { repo, w, svc } = setup(); repo.pdf = 'READY';
  const r = await svc.send(RID, { channels: ['EMAIL'] });
  check(r.results.length === 1 && r.results[0].status === 'SENT' && r.invoiceStatus === 'EMAIL_SENT' && w.mails.length === 1, 'e-mail: sent once, the invoice becomes Email sent');
  check(w.mails[0].to === 'a@example.com' && w.mails[0].stage === 'PAID' && w.mails[0].number === 'GST/26-27/014' && w.mails[0].fileName === 'GST-26-27-014-paid-invoice.pdf' && w.mails[0].pdf.length === 4
    && w.mails[0].total.includes('590') && w.mails[0].customerName === 'Alpha', 'the e-mail goes to the customer address with the invoice number, the total and the PDF attached');
  check(repo.calls.join(',').includes('begin:EMAIL:false,finish:SENT'), 'booked before sending, recorded after');
  const again = await svc.send(RID, { channels: ['EMAIL'] });
  check(again.results[0].status === 'REFUSED' && /already sent/.test(again.results[0].message) && w.mails.length === 1, 'sending again by accident is refused: no second e-mail');
  const re = await svc.send(RID, { channels: ['EMAIL'], resend: true });
  check(re.results[0].status === 'SENT' && w.mails.length === 2 && repo.deliveries[1].resend, '"send again" sends it on purpose and is recorded as a re-send');
}
{
  const { repo, w, svc } = setup(); repo.pdf = 'READY';
  w.mailOutcome = { outcome: 'NOT_SENT', detail: 'Dry run: nothing is sent while AUTOMATION_MODE is not "live".', messageId: null, to: 'a@example.com' };
  const r = await svc.send(RID, { channels: ['EMAIL'] });
  check(r.results[0].status === 'NOT_SENT' && repo.invoiceStatus === 'GENERATED', 'a test-mode e-mail is recorded as NOT_SENT: the invoice is not reported as sent');
  w.mailOutcome = { outcome: 'FAILED', detail: 'The mail server refused the message (550).', messageId: null, to: 'a@example.com' };
  const f = await svc.send(RID, { channels: ['EMAIL'] });
  check(f.results[0].status === 'FAILED' && /550/.test(f.results[0].message) && repo.invoiceStatus === 'FAILED', 'a failed e-mail is recorded with the reason and the invoice shows Failed');
  w.mailOutcome = { outcome: 'SENT', detail: 'ok', messageId: 'm2', to: 'a@example.com' };
  const retry = await svc.send(RID, { channels: ['EMAIL'] });
  check(retry.results[0].status === 'SENT' && retry.invoiceStatus === 'EMAIL_SENT', 'a failed e-mail can be retried (no "send again" needed: it never went)');
}
{
  const { repo, w, svc } = setup(); repo.pdf = 'READY';
  repo.inflight.add('EMAIL');
  const r = await svc.send(RID, { channels: ['EMAIL'] });
  check(r.results[0].status === 'REFUSED' && /already being sent/.test(r.results[0].message) && w.mails.length === 0, 'a second click while a send is in progress is refused (no duplicate e-mail)');
  repo.inflight.clear(); repo.pdf = 'PENDING';
  const n = await svc.send(RID, { channels: ['EMAIL', 'WHATSAPP'] });
  check(n.results.every(x => x.status === 'REFUSED') && w.mails.length === 0 && w.sends.length === 0, 'nothing is sent while the PDF is not ready');
}
// ---- WhatsApp
{
  const { repo, storage, w, svc } = setup(); repo.pdf = 'READY';
  const r = await svc.send(RID, { channels: ['WHATSAPP'] });
  check(r.results[0].status === 'SENT' && r.invoiceStatus === 'WHATSAPP_SENT' && w.sends.length === 1, 'WhatsApp: accepted by the provider is recorded as sent');
  check(w.sends[0].job.to === '+919876543210' && w.sends[0].job.number === 'GST/26-27/014' && w.sends[0].job.template.name === 'paid_invoice' && w.sends[0].link.startsWith('https://signed.example/')
    && storage.links.at(-1)!.ttl >= 120 && storage.links.at(-1)!.name === 'GST-26-27-014-paid-invoice.pdf', 'the provider gets the number, the template and a short-lived link to the private PDF (never a permanent address)');
  check(!JSON.stringify(r).includes('signed.example'), 'the link is not returned to the browser');
  const again = await svc.send(RID, { channels: ['WHATSAPP'] });
  check(again.results[0].status === 'REFUSED' && w.sends.length === 1, 'a second WhatsApp send by accident is refused');
}
{
  const { repo, w, svc } = setup(); repo.pdf = 'READY';
  w.mode = 'dry_run';
  const dry = await svc.send(RID, { channels: ['WHATSAPP'] });
  check(dry.results[0].status === 'NOT_SENT' && /Test mode/.test(dry.results[0].message) && w.sends.length === 0 && repo.invoiceStatus === 'GENERATED', 'test mode: prepared, not sent, never reported as sent');
  w.mode = 'off';
  check((await svc.send(RID, { channels: ['WHATSAPP'] })).results[0].status === 'NOT_SENT' && w.sends.length === 0, 'switched off: nothing is sent');
  w.mode = 'live'; w.provider = null;
  check((await svc.send(RID, { channels: ['WHATSAPP'] })).results[0].status === 'NOT_SENT' && w.sends.length === 0, 'no WhatsApp service connected: nothing is sent');
  w.provider = 'WABASTORE'; repo.settings.enabled = false;
  check((await svc.send(RID, { channels: ['WHATSAPP'] })).results[0].message.includes('switched off in the Accounts settings') && w.sends.length === 0, 'switched off in the Accounts settings: nothing is sent');
  repo.settings.enabled = true; repo.settings.templateApproved = false;
  check((await svc.send(RID, { channels: ['WHATSAPP'] })).results[0].status === 'NOT_SENT' && w.sends.length === 0, 'an unapproved template (Wabastore) blocks the send');
  w.provider = 'BUILDER';
  check((await svc.send(RID, { channels: ['WHATSAPP'] })).results[0].status === 'SENT' && w.sends.length === 1, 'the builder keeps its own templates: the approval flag does not apply');
}
{
  const { repo, w, svc } = setup(); repo.pdf = 'READY';
  w.waOutcome = { outcome: 'RETRY', detail: 'The WhatsApp webhook is busy or unavailable (HTTP 503).' };
  const retry = await svc.send(RID, { channels: ['WHATSAPP'] });
  check(retry.results[0].status === 'FAILED' && repo.invoiceStatus === 'FAILED', 'a provider that is busy: recorded as failed (Accounts retry), nothing marked sent');
  w.waOutcome = { outcome: 'FAILED', detail: 'The WhatsApp webhook refused the invoice (HTTP 400).' };
  check((await svc.send(RID, { channels: ['WHATSAPP'] })).results[0].status === 'FAILED', 'a refusal by the provider: failed');
  w.waOutcome = { outcome: 'SKIPPED', detail: 'Not sent: this number is not in AUTOMATION_TEST_RECIPIENTS.' };
  check((await svc.send(RID, { channels: ['WHATSAPP'] })).results[0].status === 'NOT_SENT', 'a number outside the test recipients: not sent');
  w.senderThrows = true;
  const crash = await svc.send(RID, { channels: ['WHATSAPP'] });
  check(crash.results[0].status === 'FAILED' && !/wa\.example|hang up/.test(crash.results[0].message), 'a provider that crashes is recorded as failed, without its internals; nothing throws');
  check(!repo.inflight.has('WHATSAPP'), 'and the channel is free for a retry');
  w.senderThrows = false; w.waOutcome = { outcome: 'ACCEPTED', detail: 'accepted', ref: 'wa-9' };
  check((await svc.send(RID, { channels: ['WHATSAPP'] })).results[0].status === 'SENT', 'the retry after the failures is sent');
}
// ---- both channels, one refused
{
  const { repo, w, svc } = setup(); repo.pdf = 'READY'; repo.snap = snapshot({ customer: { ...snapshot().customer, contactNumber: null } });
  const r = await svc.send(RID, { channels: ['EMAIL', 'WHATSAPP'] });
  check(r.results[0].channel === 'EMAIL' && r.results[0].status === 'SENT' && r.results[1].status === 'REFUSED' && /mobile number/.test(r.results[1].message) && w.mails.length === 1 && w.sends.length === 0, 'both channels: the one without a number is refused, the other is still sent');
  repo.snap = snapshot();
  const both = await svc.send(RID, { channels: ['EMAIL', 'WHATSAPP'], resend: false });
  check(both.results[0].status === 'REFUSED' && both.results[1].status === 'SENT' && both.invoiceStatus === 'SENT', 'then WhatsApp alone goes and the invoice shows Sent (both channels delivered)');
}
// ---- input
{
  const { repo, svc } = setup(); repo.pdf = 'READY';
  const bad = [{}, { channels: [] }, { channels: ['SMS'] }, { channels: ['EMAIL', 'EMAIL'] }, { channels: ['EMAIL'], to: 'x@y.z' }, { channels: ['EMAIL'], resend: 'yes' }, { channels: ['EMAIL'], total: 1 }];
  for (const b of bad) check((await refused(svc.send(RID, b)))?.code === 'VALIDATION_ERROR', `refused before the database: ${JSON.stringify(b)}`);
  check(repo.calls.filter(c => c.startsWith('begin')).length === 0, 'none of them booked a send');
  check((await refused(svc.setContact(RID, { customerEmail: 'nope', note: 'fix' })))?.code === 'VALIDATION_ERROR' && (await refused(svc.setContact(RID, { customerPhone: '9', note: 'x' })))?.code === 'VALIDATION_ERROR'
    && (await refused(svc.setContact(RID, { customerEmail: 'a@b.co', note: 'fix', rmId: 'x' })))?.code === 'VALIDATION_ERROR', 'a contact correction needs a valid e-mail, a reason, and nothing else');
  await svc.setContact(RID, { customerEmail: 'New@Example.com', customerPhone: '+91 98765 43210', note: 'confirmed by phone' });
  check(repo.calls.includes('contact:new@example.com:+91 98765 43210:confirmed by phone'), 'a contact correction reaches the database cleaned');
}
console.log(`=== ${passed} RECHARGE INVOICE SERVICE CHECKS PASSED ===`);
