/**
 * The invoice e-mail is addressed to the customer's CONTACT NAME (a person), while the PDF keeps the legal business name: the greeting,
 * the recipient's display name, the fallbacks, HTML escaping and header safety. Sent through a local mock of the mail provider - nothing leaves
 * this machine. Run: npm run test:unit
 */
import http from 'node:http';
import { automationSettings } from '../../server/automations/config.js';
import { recipientName, renderInvoiceEmail, safeDisplayName, sendInvoiceEmail } from '../../server/invoices/mailer.js';
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

const sent: any[] = [];
const provider = http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    sent.push(JSON.parse(raw));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: `msg-${sent.length}` }));
  });
});
await new Promise<void>(r => provider.listen(0, r));
const base = `http://127.0.0.1:${(provider.address() as any).port}`;
Object.assign(process.env, { AUTOMATION_MODE: 'live', EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 're_test', EMAIL_API_BASE_URL: base, EMAIL_FROM: 'Amuwa <meta@amuwa.com>' });
const settings = automationSettings();
const pdf = (await renderInvoicePdf(sampleInvoice(1), { stage: 'UNPAID' })).bytes;
const input = { stage: 'UNPAID' as const, number: 'INV-2026-00022', invoiceDate: '16 Oct 2026', total: 'Rs.11,800.00', fileName: 'INV-2026-00022-invoice.pdf', pdf };

console.log('--- the greeting and the recipient are the contact person, not the business');
{
  const m = renderInvoiceEmail({ ...input, customerName: 'Zita Ayurveda Private Limited', contactName: 'Ashish' });
  check(m.html.includes('<p>Dear Ashish,</p>') && m.text.startsWith('Dear Ashish,'), 'the greeting is "Dear Ashish," in the HTML and the plain text');
  check(!m.html.includes('Zita Ayurveda') && !m.text.includes('Zita Ayurveda'), 'the business name is not used to greet a person');
  check(m.subject === 'Invoice INV-2026-00022 from Amuwa Corporation', 'the subject is unchanged');
  const paid = renderInvoiceEmail({ ...input, stage: 'PAID', customerName: 'Zita Ayurveda Private Limited', contactName: 'Ashish' });
  check(paid.html.includes('<p>Dear Ashish,</p>') && /Payment received/.test(paid.subject), 'the paid invoice e-mail greets the same person');
  const r = await sendInvoiceEmail({ ...input, to: 'ashish@zita.example', customerName: 'Zita Ayurveda Private Limited', contactName: 'Ashish' }, settings);
  check(r.outcome === 'SENT' && sent.length === 1 && sent[0].to[0] === 'Ashish <ashish@zita.example>', 'the recipient shows the person\'s name with the address', sent[0]?.to);
  check(sent[0].html.includes('Dear Ashish,') && sent[0].attachments?.length === 1, 'and the e-mail carries the greeting and the PDF');
}

console.log('--- the PDF keeps the legal business name');
{
  const inv = sampleInvoice(1);
  check(inv.customer.businessName === 'Zita Ayurveda', 'the invoice data carries the business name');
  const { execFileSync, spawnSync } = await import('node:child_process');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  if (spawnSync('pdftotext', ['-v'], { stdio: 'ignore' }).error === undefined) {
    const d = mkdtempSync(join(tmpdir(), 'inv-mail-'));
    writeFileSync(join(d, 'a.pdf'), pdf);
    const t = execFileSync('pdftotext', ['-raw', join(d, 'a.pdf'), '-'], { encoding: 'utf8' });
    check(/Name: Zita Ayurveda/.test(t), 'the PDF still names the business (Name: Zita Ayurveda)');
  }
}

console.log('--- fallbacks');
check(recipientName({ contactName: null, customerName: 'Zita Ayurveda' }) === 'Zita Ayurveda', 'no contact name: the customer name is used');
check(recipientName({ contactName: '   ', customerName: 'Zita Ayurveda' }) === 'Zita Ayurveda', 'a blank contact name counts as none');
check(recipientName({ contactName: undefined, customerName: '' }) === 'Customer', 'nothing known: "Customer"');
check(recipientName({ contactName: '<>', customerName: '' }) === 'Customer', 'a name that is only unsafe characters falls back too');
check(renderInvoiceEmail({ ...input, customerName: '', contactName: null }).html.includes('<p>Dear Customer,</p>'), 'the e-mail still reads well with no name at all');

console.log('--- escaping and header safety');
{
  const evil = 'Ashish <script>alert(1)</script> & "Co"\r\nBcc: attacker@evil.example';
  const m = renderInvoiceEmail({ ...input, customerName: 'x', contactName: evil });
  check(!m.html.includes('<script>') && !/\r|\n(?=Bcc)/.test(m.html), 'markup in a name is escaped / removed');
  check(!/[\r\n]/.test(recipientName({ contactName: evil, customerName: 'x' })), 'a name can never contain a line break (no extra mail headers)');
  check(safeDisplayName('Ashish Kumar') === 'Ashish Kumar' && safeDisplayName("D'Souza & Sons") === "D'Souza & Sons", 'ordinary names, apostrophes and ampersands are kept');
  check(safeDisplayName('a, b <c@d>') === 'a b cd', 'commas, brackets and @ are dropped from the display name');
  check((safeDisplayName('x'.repeat(500)) ?? '').length === 80, 'a very long name is cut to 80 characters');
  check(safeDisplayName('प्रिया शर्मा') === 'प्रिया शर्मा', 'non-Latin names are kept');
  const before = sent.length;
  await sendInvoiceEmail({ ...input, to: 'ashish@zita.example', customerName: 'x', contactName: evil }, settings);
  check(sent.length === before + 1 && !/[\r\n]/.test(sent[before].to[0]) && sent[before].to.length === 1, 'the provider gets one recipient with a clean display name', sent[before]?.to);
}

console.log('--- nothing is sent without an address or outside live mode');
{
  const before = sent.length;
  const r1 = await sendInvoiceEmail({ ...input, to: null, customerName: 'x', contactName: 'Ashish' }, settings);
  const r2 = await sendInvoiceEmail({ ...input, to: 'ashish@zita.example', customerName: 'x', contactName: 'Ashish' }, { ...settings, mode: 'dry_run' });
  check(r1.outcome === 'NOT_SENT' && r2.outcome === 'NOT_SENT' && sent.length === before, 'no address / dry run: NOT_SENT and nothing reaches the provider');
}

provider.close();
console.log(`=== ${passed} INVOICE E-MAIL CHECKS PASSED ===`);
