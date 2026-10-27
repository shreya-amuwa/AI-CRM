/**
 * The paid invoice by WhatsApp (server/invoices/whatsapp.ts): the request to Wabastore carries the persisted figures and a SHORT-LIVED link
 * (never stored or logged), outcomes are recorded as they happened, dry run sends nothing and makes no link, live needs the approved template,
 * and a provider's delivery words are normalised. A stub database and a stub storage stand in: nothing real is sent.
 */
import {
  WabastoreInvoiceSender, invoiceLinkTtlSeconds, invoicePdfName, invoiceWhatsAppMode, invoiceWhatsAppPayload, normalizeProviderStatus, runInvoiceWhatsApp,
  type InvoiceWhatsAppJob, type InvoiceWhatsAppSender
} from '../../server/invoices/whatsapp.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const job = (over: Partial<InvoiceWhatsAppJob> = {}): InvoiceWhatsAppJob => ({
  id: 'd-1', attempts: 1, invoiceId: 'inv-1', customerId: 'c-1', number: 'INV/2026/0042', invoiceDate: '2026-10-27', total: 11800.5, customerName: 'Joshi Sweets', to: '+919820000123',
  file: { provider: 'R2', bucket: 'customer-documents', path: 'customers/c-1/invoices/inv-1/paid.pdf', sizeBytes: 40000, etag: 'e' },
  template: { name: 'invoice_paid', language: 'en', approved: true }, ...over
});

// modes and the link's lifetime
check(invoiceWhatsAppMode({} as any) === 'dry_run' && invoiceWhatsAppMode({ AUTOMATION_MODE_INVOICE_WHATSAPP: 'live' } as any) === 'live' && invoiceWhatsAppMode({ AUTOMATION_MODE_INVOICE_WHATSAPP: 'x' } as any) === 'dry_run', 'the default mode is dry run; an unknown value is never live');
check(invoiceLinkTtlSeconds({} as any) === 900 && invoiceLinkTtlSeconds({ INVOICE_WHATSAPP_LINK_TTL_SECONDS: '5' } as any) === 900 && invoiceLinkTtlSeconds({ INVOICE_WHATSAPP_LINK_TTL_SECONDS: '99999' } as any) === 3600
  && invoiceLinkTtlSeconds({ INVOICE_WHATSAPP_LINK_TTL_SECONDS: '300' } as any) === 300, 'the link lives 15 minutes by default, 2 minutes to 1 hour at most');
check(invoicePdfName('INV/2026/0042') === 'INV-2026-0042-paid-invoice.pdf', 'the file name is safe');

// the request
const p = invoiceWhatsAppPayload(job(), 'https://files.example.test/signed?x=1') as any;
check(p.to === '+919820000123' && p.template === 'invoice_paid' && p.language === 'en' && p.reference === 'invoice-whatsapp:d-1', 'the payload names the number, the approved template and a reference', p);
check(p.variables.invoiceNumber === 'INV/2026/0042' && p.variables.customerName === 'Joshi Sweets' && /^Rs\.\s?11,800\.50$/.test(p.variables.amount), 'the amount is the persisted total, formatted', p.variables);
check(p.document.url === 'https://files.example.test/signed?x=1' && p.document.mimeType === 'application/pdf' && p.document.filename === 'INV-2026-0042-paid-invoice.pdf', 'the invoice is a PDF document behind the short-lived link');
check(!JSON.stringify(p).includes('customer-documents') && !JSON.stringify(p).includes('customers/c-1'), 'the permanent storage path is never in the request');

// the sender (Wabastore)
let hit: any = null;
const okFetch = async (_u: string, init: any) => ((hit = JSON.parse(init.body)), { status: 200, text: async () => '{"id":"wamid.INV1"}' });
const sender = new WabastoreInvoiceSender(okFetch as any, { WABASTORE_WEBHOOK_URL: 'https://api.wabastore.example/send' } as any);
const sent = await sender.send(job(), 'https://l.example.test/x');
check(sent.outcome === 'ACCEPTED' && sent.ref === 'wamid.INV1' && hit.document.url === 'https://l.example.test/x', 'a 2xx is accepted, with the provider\'s reference');
check((await new WabastoreInvoiceSender((async () => ({ status: 503, text: async () => '' })) as any, { WABASTORE_WEBHOOK_URL: 'https://a.example/s' } as any).send(job(), 'x')).outcome === 'RETRY', '503 is retried');
const refused = await new WabastoreInvoiceSender((async () => ({ status: 400, text: async () => '{"echo":"https://l.example.test/x INV/2026/0042"}' })) as any, { WABASTORE_WEBHOOK_URL: 'https://a.example/s' } as any).send(job(), 'https://l.example.test/x');
check(refused.outcome === 'FAILED' && !refused.detail.includes('l.example.test') && !refused.detail.includes('INV/2026'), 'a refusal is not retried, and its reply (which may echo the link) is not kept', refused);
check((await new WabastoreInvoiceSender(okFetch as any, { WABASTORE_WEBHOOK_URL: 'https://a.example/s' } as any).send(job({ to: '+9112345' }), 'x')).outcome === 'FAILED', 'a bad number never reaches the provider');

// the driver
function stubDb(batches: InvoiceWhatsAppJob[][]) {
  const finished: any[] = [];
  const claims: any[] = [];
  const db: any = {
    rpc: async (fn: string, args: any) => {
      if (fn === 'invoice_whatsapp_claim') { claims.push(args); return { data: batches.shift() ?? [], error: null }; }
      if (fn === 'invoice_whatsapp_finish') { finished.push(args); return { data: { status: args.p_outcome }, error: null }; }
      return { data: null, error: { message: 'unexpected ' + fn } };
    }
  };
  return { db, finished, claims };
}
const links: any[] = [];
const storage = { signedDownloadUrl: async (...a: any[]) => (links.push(a), 'https://signed.example.test/abc?sig=SECRET') } as any;
{
  const s = stubDb([[job()]]);
  const sd: InvoiceWhatsAppSender = { send: async () => { throw new Error('must not send'); } };
  links.length = 0;
  const r = await runInvoiceWhatsApp(storage, { db: s.db, mode: 'dry_run', sender: sd });
  check(r.dryRun === 1 && s.finished[0].p_outcome === 'DRY_RUN' && links.length === 0, 'dry run: logged, nothing sent, and no link is even made', r);
  check(/^Dry run - not sent/.test(s.finished[0].p_detail) && !s.finished[0].p_detail.includes('9820000123'), 'the dry-run note masks the number');
}
{
  const s = stubDb([[job()]]);
  links.length = 0;
  let given = '';
  const r = await runInvoiceWhatsApp(storage, { db: s.db, mode: 'live', dispatchId: 'd-1', sender: { send: async (_j, link) => ((given = link), { outcome: 'ACCEPTED', detail: 'ok', code: 200, ref: 'wamid.X' }) } });
  check(r.accepted === 1 && s.finished[0].p_ref === 'wamid.X' && s.claims[0].p_dispatch === 'd-1', 'live: accepted, with the provider reference; the clicked dispatch is the one claimed', r);
  check(links.length === 1 && links[0][0] === 'customer-documents' && links[0][1].endsWith('paid.pdf') && links[0][2] === 900 && links[0][3] === 'INV-2026-0042-paid-invoice.pdf' && links[0][4] === 'R2', 'the link is short-lived (15 minutes), for the stored paid PDF', links[0]);
  check(given.includes('signed.example.test') && !JSON.stringify(s.finished).includes('signed.example.test') && !JSON.stringify(s.finished).includes('SECRET'), 'the link reaches the provider only: it is not recorded');
}
{
  const outcomes = ['ACCEPTED', 'RETRY', 'FAILED', 'SKIPPED'] as const;
  let n = 0;
  const s = stubDb([[job({ id: 'a' }), job({ id: 'b' }), job({ id: 'c' }), job({ id: 'd' })]]);
  const r = await runInvoiceWhatsApp(storage, { db: s.db, mode: 'live', sender: { send: async () => ({ outcome: outcomes[n++], detail: 'x' }) } });
  check(r.accepted === 1 && r.retrying === 1 && r.failed === 1 && r.skipped === 1, 'live: every outcome is recorded', r);
}
{
  const s = stubDb([[job({ template: { name: null, language: 'en', approved: false } })]]);
  let sent = false;
  const r = await runInvoiceWhatsApp(storage, { db: s.db, mode: 'live', sender: { send: async () => ((sent = true), { outcome: 'ACCEPTED', detail: '' }) } });
  check(!sent && r.skipped === 1, 'live: an unapproved template is never sent, even if it reaches the driver');
}
{
  const s = stubDb([[job()]]);
  const r = await runInvoiceWhatsApp({ signedDownloadUrl: async () => { throw new Error('storage down'); } } as any, { db: s.db, mode: 'live', sender: { send: async () => ({ outcome: 'ACCEPTED', detail: '' }) } });
  check(r.retrying === 1 && s.finished[0].p_outcome === 'RETRY', 'a storage failure leads to a retry, not a crash and not a send');
}
{
  const s = stubDb([[job()]]);
  const r = await runInvoiceWhatsApp(storage, { db: s.db, mode: 'live', sender: null });
  check(r.mode === 'off' && s.claims.length === 0 && /WABASTORE_WEBHOOK_URL/.test(r.note ?? ''), 'live without a provider: nothing claimed or sent, and it says why');
  const off = await runInvoiceWhatsApp(storage, { db: s.db, mode: 'off' });
  check(off.claimed === 0 && s.claims.length === 0, 'off: nothing happens');
  const e = await runInvoiceWhatsApp(storage, { db: { rpc: async () => ({ data: null, error: { message: 'db down' } }) } as any, mode: 'dry_run' });
  check(e.error?.includes('db down'), 'a database error is reported, not thrown');
}

// the provider's delivery words
check(normalizeProviderStatus('Delivered') === 'DELIVERED' && normalizeProviderStatus('read') === 'READ' && normalizeProviderStatus('seen') === 'READ' && normalizeProviderStatus('failed') === 'FAILED' && normalizeProviderStatus('undelivered') === 'FAILED', 'delivered / read / failed are recognised');
check(normalizeProviderStatus('sent') === null && normalizeProviderStatus('queued') === null && normalizeProviderStatus(undefined) === null, 'anything else is not news');
console.log(`\n${passed} checks passed`);
