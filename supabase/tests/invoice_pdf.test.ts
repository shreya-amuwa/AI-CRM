/**
 * The invoice PDF generator: size limit, layout, multi-page tables, the PAID stamp, stationery and footer details,
 * long names, determinism. Text is read back with poppler's pdftotext and the pages are rendered with pdftoppm when those
 * tools exist (they do in this project's environment); set INVOICE_PDF_OUT=<dir> to keep the files and page images.
 * Run: npm run test:unit
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { INVOICE_GENERATED_PDF_LIMIT_BYTES } from '../../shared/contracts.js';
import { calculateInvoice } from '../../shared/invoiceCalc.js';
import { COMPANY_DETAILS, renderInvoicePdf, type LayoutBox } from '../../server/invoices/pdf.js';
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
const have = (cmd: string) => spawnSync(cmd, ['-v'], { stdio: 'ignore' }).error === undefined;
const HAS_TEXT = have('pdftotext');
const HAS_RENDER = have('pdftoppm');
const dir = mkdtempSync(join(tmpdir(), 'inv-pdf-'));
const keep = process.env.INVOICE_PDF_OUT;
if (keep) mkdirSync(keep, { recursive: true });

const text = (bytes: Uint8Array, name: string) => {
  const f = join(dir, `${name}.pdf`);
  writeFileSync(f, bytes);
  return execFileSync('pdftotext', ['-raw', f, '-'], { encoding: 'utf8' }).replace(/[ \t]+/g, ' ');
};
const flat = (s: string) => s.replace(/\s+/g, ' ');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

const overlap = (a: LayoutBox, b: LayoutBox) => a.page === b.page && a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
const BODY_KINDS: LayoutBox['kind'][] = ['title', 'customer', 'meta', 'tableHeading', 'row', 'total', 'bank', 'state', 'words', 'terms', 'summary', 'address', 'signatory'];

async function render(name: string, n: number, stage: 'UNPAID' | 'PAID', o: Parameters<typeof sampleInvoice>[1] = {}) {
  const r = await renderInvoicePdf(sampleInvoice(n, o), { stage });
  if (keep) writeFileSync(join(keep, `${name}.pdf`), r.bytes);
  if (HAS_RENDER) {
    writeFileSync(join(dir, `${name}.pdf`), r.bytes);
    execFileSync('pdftoppm', ['-r', '60', '-png', join(dir, `${name}.pdf`), join(keep ?? dir, name)]);
  }
  return r;
}

// ---------------------------------------------------------------------------
console.log('--- 1. Size limit, pages, determinism');
for (const n of [1, 2, 5, 10, 25, 50]) {
  for (const stage of ['UNPAID', 'PAID'] as const) {
    const r = await render(`n${n}-${stage.toLowerCase()}`, n, stage);
    check(r.bytes.length < INVOICE_GENERATED_PDF_LIMIT_BYTES, `${n} row(s), ${stage}: ${r.bytes.length} bytes is below the ${INVOICE_GENERATED_PDF_LIMIT_BYTES} byte limit`);
    const doc = await PDFDocument.load(r.bytes);
    check(doc.getPageCount() === r.pages && r.pages >= 1, `${n} row(s), ${stage}: a valid PDF with ${r.pages} A4 page(s)`);
    const { width, height } = doc.getPage(0).getSize();
    check(Math.abs(width - 595.28) < 0.1 && Math.abs(height - 841.89) < 0.1, 'A4 portrait');
  }
}
{
  const a = await renderInvoicePdf(sampleInvoice(7), { stage: 'UNPAID' });
  const b = await renderInvoicePdf(sampleInvoice(7), { stage: 'UNPAID' });
  check(sha(a.bytes) === sha(b.bytes), 'the same invoice always gives byte-identical PDFs (a retry cannot create a different file)');
  const c = await renderInvoicePdf(sampleInvoice(7), { stage: 'PAID' });
  check(sha(a.bytes) !== sha(c.bytes), 'the paid PDF differs from the unpaid one');
  const doc = await PDFDocument.load(c.bytes);
  check(doc.getTitle() === 'Invoice INV-2026-00022 (Paid)' && doc.getAuthor() === 'Amuwa Corporation', 'document properties carry the invoice number');
}
{
  // the size rule is enforced, not assumed: a PDF over the limit is re-drawn lean, and refused when it is still too big
  const full = await renderInvoicePdf(sampleInvoice(10), { stage: 'PAID' });
  const lean = await renderInvoicePdf(sampleInvoice(10), { stage: 'PAID', limitBytes: full.bytes.length });
  check(lean.bytes.length < full.bytes.length, `over the limit: re-drawn without pictures (${full.bytes.length} -> ${lean.bytes.length} bytes)`);
  let refused = false;
  try {
    await renderInvoicePdf(sampleInvoice(10), { stage: 'PAID', limitBytes: 1000 });
  } catch {
    refused = true;
  }
  check(refused, 'a PDF that cannot be made smaller than the limit is refused, never returned');
}

// ---------------------------------------------------------------------------
console.log('--- 2. Layout: no overlaps, clear of the footer, table headings repeat');
for (const [n, stage] of [[1, 'UNPAID'], [2, 'PAID'], [5, 'UNPAID'], [10, 'PAID'], [30, 'UNPAID']] as const) {
  const r = await renderInvoicePdf(sampleInvoice(n), { stage });
  const body = r.boxes.filter(b => BODY_KINDS.includes(b.kind));
  const footers = r.boxes.filter(b => b.kind === 'footer');
  const headers = r.boxes.filter(b => b.kind === 'header');
  check(footers.length === r.pages && headers.length === r.pages, `${n} row(s): the stationery header and footer are on all ${r.pages} page(s)`);
  let clash: [LayoutBox, LayoutBox] | null = null;
  for (let i = 0; i < body.length && !clash; i++) for (let j = i + 1; j < body.length; j++) if (overlap(body[i], body[j])) { clash = [body[i], body[j]]; break; }
  check(!clash, `${n} row(s), ${stage}: no two body blocks overlap`, clash);
  const footerTop = footers[0].y;
  const headerBottom = headers[0].y + headers[0].h;
  check(body.every(b => b.y + b.h <= footerTop - 4 + 0.01 && b.y >= headerBottom - 0.01 && b.x >= 0 && b.x + b.w <= 595.29), `${n} row(s): everything sits between the header and the footer, inside the page`);
  const rowPages = new Set(r.boxes.filter(b => b.kind === 'row').map(b => b.page));
  const headings = r.boxes.filter(b => b.kind === 'tableHeading');
  check([...rowPages].every(pg => headings.some(h => h.page === pg)), `${n} row(s): every page that has rows repeats the column headings`);
  const totals = r.boxes.filter(b => b.kind === 'total');
  const summary = r.boxes.filter(b => b.kind === 'summary');
  check(totals.length === 1 && summary.length === 1 && summary[0].page >= totals[0].page, `${n} row(s): the total row and the tax summary appear once, in order`);
  check(r.boxes.filter(b => b.kind === 'row').length === n, `${n} row(s): every service row is drawn`);
  if (n === 30) check(r.pages >= 3, 'thirty rows continue over several pages instead of shrinking');
}
{
  const unpaid = await renderInvoicePdf(sampleInvoice(2), { stage: 'UNPAID' });
  const paid = await renderInvoicePdf(sampleInvoice(2), { stage: 'PAID' });
  check(!unpaid.boxes.some(b => b.kind === 'stamp'), 'the unpaid invoice has no stamp at all');
  const stamp = paid.boxes.filter(b => b.kind === 'stamp');
  const sig = paid.boxes.find(b => b.kind === 'signatory')!;
  check(stamp.length === 1 && stamp[0].x >= sig.x && stamp[0].x + stamp[0].w <= sig.x + sig.w + 0.5 && stamp[0].y >= sig.y && stamp[0].y + stamp[0].h <= sig.y + sig.h, 'the PAID stamp sits inside the signatory area, bottom right');
  check(stamp[0].x > 595.28 / 2, 'and that area is on the right half of the page');
  check(!paid.boxes.filter(b => !['stamp', 'signatory'].includes(b.kind) && BODY_KINDS.includes(b.kind)).some(b => overlap(b, stamp[0])), 'the stamp covers no totals, address or other content');
}

// ---------------------------------------------------------------------------
if (HAS_TEXT) {
  console.log('--- 3. What the PDF says (read back with pdftotext)');
  const unpaid = flat(text((await renderInvoicePdf(sampleInvoice(2), { stage: 'UNPAID' })).bytes, 'two-unpaid'));
  const paid = flat(text((await renderInvoicePdf(sampleInvoice(2), { stage: 'PAID' })).bytes, 'two-paid'));
  check(!/\bPAID\b/.test(unpaid), 'the unpaid invoice never says PAID');
  check(/\bPAID\b/.test(paid), 'the paid invoice carries the PAID stamp text');
  const must: [string, RegExp][] = [
    ['the Invoice title', /\bInvoice\b/],
    ['Sr. No.', /Sr\. No\./], ['Particulars', /Particulars/], ['HSN/SAC', /HSN\/SAC/], ['Tax Rate', /Tax Rate/], ['Qty.', /Qty\./],
    ['Invoice Amount', /Invoice Amount/], ['Taxable Amount', /Taxable Amount/], ['Total With Tax', /Total With Tax/],
    ['invoice number', /INVOICE No\. INV-2026-00022/], ['the date as DD-MM-YYYY', /DATE 16-10-2026/], ['the customer GST number', /GST No\. 27AADFZ2948M1ZI/],
    ['contact person', /Contact person Kshitij Ved/], ['contact number', /Contact number 9819900201/], ['order number', /Order No\. Verbal/],
    ['customer name', /Name: Zita Ayurveda/], ['customer address', /Add: D\/1801, Pancham, Nanded City/], ['state', /State: MAHARASHTRA/], ['state code', /State Code: 27/],
    ['HSN/SAC 998313', /998313/], ['the rate', /18%/], ['quantities as typed', /1 Year/], ['quantity 30K Msg', /30K Msg/],
    ['line 1 base', /Rs\.10,000\.00/], ['line 1 GST', /Rs\.1,800\.00/], ['line 1 total', /Rs\.11,800\.00/], ['line 2 total', /Rs\.7,080\.00/],
    ['total row', /Total: Rs\.16,000\.00 Rs\.2,880\.00 Rs\.18,880\.00/],
    ['the summary', /Total Amount Before Tax/], ['CGST', /Add: CGST/], ['SGST', /Add: SGST/], ['9%', /9%/], ['CGST amount', /Rs\.1,440\.00/],
    ['Tax Amount GST', /Tax Amount GST/], ['Final Amount After Tax', /Final Amount After Tax/], ['final amount', /Rs\.18,880\.00/],
    ['reverse charge', /GST Payable on Reverse Charge/], ['amount in words', /Eighteen Thousand Eight Hundred Eighty Only\/-/],
    ['terms', /Terms & Conditions 100% Payment Against supply\./],
    ['account name', /Ac Name: Amuwa Corporation/], ['bank', /Bank Name: Bank of Baroda/], ['account number', /Account Number: 51450200000158/],
    ['IFSC', /IFSC Code: BARB0ULWRAI/], ['company GST', /GST No: 27BDCPK3585J3Z7/],
    ['company address', /1107, Shagun Insignia, Above Reliance Trendz, Sec 19 Ulwe, Navi Mumbai, Maharashtra/],
    ['phone 1', /\+91 9359 734 757/], ['phone 2', /\+91 9987 177 454/], ['support e-mail', /support@amuwa\.com/], ['www.amuwa.com', /www\.amuwa\.com/], ['www.aiqr.shop', /www\.aiqr\.shop/],
    ['toll free', /Toll Free No: 1800-843-0177/],
    ['sales department', /Business Sales Department 1107, Shagun Insignia, Sector 19, Above Reliance Trendz, Ulwe Navi Mumbai - Maharashtra India\./],
    ['support department', /Customer & Technical Support 607\/608, Shagun Insignia, Sector 19, Above Reliance Trendz, Ulwe Navi Mumbai - Maharashtra India\./],
    ['made with love', /Made with Love/], ['in India', /In India/], ['signatory', /Authorised Signatory/], ['page number', /Page 1 of 1/]
  ];
  for (const [what, re] of must) check(re.test(paid), `the paid invoice shows ${what}`, re.source);
  for (const [what, re] of must.filter(([w]) => !/PAID/.test(w))) check(re.test(unpaid), `the unpaid invoice shows ${what}`, re.source);
  check(!/Rs\.11,000(\.00)?\b/.test(paid) && !/Rs\.11,000(\.00)?\b/.test(unpaid), 'the sample\'s wrong Rs.11,000 never appears');
  check(!/—/.test(paid) && !/—/.test(unpaid), 'no em dash anywhere in the invoice text');
  check(!/Inter-state/.test(paid) && /Intra-state supply: CGST \+ SGST/.test(paid), 'the supply type is stated (intra-state)');
  check(!/Add: IGST/.test(paid), 'an intra-state invoice shows only CGST and SGST');

  const inter = flat(text((await renderInvoicePdf(sampleInvoice(2, { treatment: 'INTER_STATE' }), { stage: 'UNPAID' })).bytes, 'inter'));
  check(/Add: IGST/.test(inter) && /18%/.test(inter) && /Rs\.2,880\.00/.test(inter) && !/Add: CGST/.test(inter) && !/Add: SGST/.test(inter), 'an inter-state invoice shows only IGST (18%, Rs.2,880.00)');
  check(/Inter-state supply: IGST/.test(inter), 'and says inter-state');

  const many = flat(text((await renderInvoicePdf(sampleInvoice(10, { treatment: 'INTRA_STATE' }), { stage: 'UNPAID' })).bytes, 'many'));
  check(/Add: CGST @ 12%/.test(many) && /Add: CGST @ 18%/.test(many) && /Add: SGST @ 12%/.test(many), 'different tax rates get a row each (no single misleading rate)');
  check((many.match(/Sr\. No\./g) ?? []).length >= 2 && /Invoice INV-2026-00022 \(continued\)/.test(many), 'a continued page repeats the headings and says it continues');
  check(/Page 1 of 2/.test(many) && /Page 2 of 2/.test(many), 'every page is numbered');

  const longText = flat(text((await renderInvoicePdf(sampleInvoice(5, { long: true }), { stage: 'UNPAID' })).bytes, 'long'));
  check(/Zita Ayurveda & Wellness Private Limited, Unit 3/.test(longText), 'a long business name is shown in full');
  check(/Near Zensar Technologies IT Park, Opposite the Municipal Water Tank, Pune 411068, Maharashtra, India/.test(longText), 'a long address is shown in full (wrapped, not cut)');

  const odd = flat(text((await renderInvoicePdf(sampleInvoice(2, { devanagari: true, reverseCharge: true, terms: 'Line one\nLine two' }), { stage: 'UNPAID' })).bytes, 'odd'));
  check(/Sharma Opticals - "Prime"/.test(odd), 'typographic dashes and quotes are drawn as plain ones');
  check(/Line one Line two/.test(odd), 'terms with several lines are kept');
  check(/GST Payable on Reverse Charge Rs\.2,880\.00/.test(odd) || /Reverse Charge[^\n]*Rs\.2,880\.00/.test(odd), 'reverse charge shows the GST payable when it applies');
}

if (HAS_RENDER) {
  console.log('--- 4. The pages render to images');
  const r = await renderInvoicePdf(sampleInvoice(12), { stage: 'PAID' });
  const f = join(dir, 'render.pdf');
  writeFileSync(f, r.bytes);
  execFileSync('pdftoppm', ['-r', '40', '-png', f, join(dir, 'render')]);
  const pngs = readdirSync(dir).filter(x => /^render-\d+\.png$/.test(x));
  check(pngs.length === r.pages, `${r.pages} page image(s) rendered by poppler`);
  check(pngs.every(p => readFileSync(join(dir, p)).length > 3000), 'and none of them is blank');
}
// ---------------------------------------------------------------------------
console.log('--- 4. Payment status and the remaining balance');
{
  const base = sampleInvoice(2);
  const total = base.totals.total; // 18,880
  const part = { total, confirmed: 5000, balance: total - 5000, state: 'PARTIALLY_PAID' as const, payments: [{ amount: 5000 }] };
  const full = { total, confirmed: total, balance: 0, state: 'FULLY_PAID' as const, payments: [{ amount: 5000 }, { amount: total - 5000 }] };
  const none = { total, confirmed: 0, balance: total, state: 'UNPAID' as const, payments: [] };
  const a = await renderInvoicePdf({ ...base, paymentSummary: part }, { stage: 'UNPAID' });
  const b = await renderInvoicePdf({ ...base, paymentSummary: full }, { stage: 'PAID' });
  const c = await renderInvoicePdf({ ...base, paymentSummary: none }, { stage: 'UNPAID' });
  const many = await renderInvoicePdf({ ...sampleInvoice(30), paymentSummary: part }, { stage: 'UNPAID' });
  check([a, b, c, many].every(r => r.bytes.length < INVOICE_GENERATED_PDF_LIMIT_BYTES), `all stay below ${INVOICE_GENERATED_PDF_LIMIT_BYTES} bytes (${a.bytes.length}, ${b.bytes.length}, ${many.bytes.length})`);
  check(a.boxes.filter(x => x.kind === 'payment').length === 1 && b.boxes.filter(x => x.kind === 'payment').length === 1, 'one payment block on the page');
  const overlapping = (x: LayoutBox, y: LayoutBox) => x.page === y.page && x.x < y.x + y.w && y.x < x.x + x.w && x.y < y.y + y.h && y.y < x.y + x.h;
  check(!a.boxes.filter(x => x.kind === 'payment').some(p => a.boxes.some(o => o !== p && ['bank', 'state', 'words', 'terms', 'summary', 'address', 'signatory'].includes(o.kind) && overlapping(p, o))), 'the payment block overlaps no other block');
  check(a.pages === 1 && b.pages === 1, 'and still fits on the page');
  if (HAS_TEXT) {
    const ta = flat(text(a.bytes, 'bal-part'));
    check(/Invoice Total: Rs\.18,880\.00/.test(ta) && /Payments Received: Rs\.5,000\.00/.test(ta) && /Balance Outstanding: Rs\.13,880\.00/.test(ta) && /Payment Status: Partially Paid/.test(ta) && !/This Payment/.test(ta), 'part paid: total, received, balance and status are printed');
    const tb = flat(text(b.bytes, 'bal-paid'));
    check(/Payments Received: Rs\.18,880\.00/.test(tb) && /This Payment: Rs\.13,880\.00/.test(tb) && /Balance Outstanding: Rs\.0\.00/.test(tb) && /Payment Status: Fully Paid/.test(tb) && /\bPAID\b/.test(tb), 'paid: everything received, the current payment, zero balance, Fully Paid and the stamp');
    const tc = flat(text(c.bytes, 'bal-none'));
    check(/Payments Received: Rs\.0\.00/.test(tc) && /Balance Outstanding: Rs\.18,880\.00/.test(tc) && /Payment Status: Unpaid/.test(tc) && !/\bPAID\b/.test(tc), 'unpaid: nothing received, the whole total outstanding, no PAID stamp');
    const old = flat(text((await renderInvoicePdf(base, { stage: 'UNPAID' })).bytes, 'bal-absent'));
    check(!/Balance Outstanding/.test(old), 'a snapshot without payment information draws no payment block');
  }
  const again = await renderInvoicePdf({ ...base, paymentSummary: part }, { stage: 'UNPAID' });
  check(sha(again.bytes) === sha(a.bytes), 'the same invoice and payments give the same file (a retry stores the same bytes)');
}
// ---------------------------------------------------------------------------
console.log('--- 5. The whole order next to the invoice (an agreement of 1,20,000 before GST)');
{
  const calc = calculateInvoice([{ baseAmount: 60000, taxRate: 18 }], 'INTRA_STATE');
  if (!calc.ok) throw new Error('calc');
  const base = sampleInvoice(1);
  const inv = {
    ...base,
    lines: [{ ...base.lines[0], baseAmount: 60000, gstAmount: calc.lines[0].gstPaise / 100, totalAmount: calc.lines[0].totalPaise / 100 }],
    totals: { ...base.totals, subtotal: 60000, cgstAmount: 5400, sgstAmount: 5400, igstAmount: 0, totalGst: 10800, total: 70800, inWords: calc.words,
      breakdown: [{ rate: 18, base: 60000, gst: 10800, cgst: 5400, sgst: 5400, igst: 0 }] }
  };
  const orderPart = { totalPayable: 141600, confirmed: 60000, balance: 81600, state: 'PARTIALLY_PAID' as const };
  const inv1 = { total: 70800, confirmed: 60000, balance: 10800, state: 'PARTIALLY_PAID' as const, payments: [{ amount: 60000 }], order: orderPart };
  const inv2 = { total: 70800, confirmed: 0, balance: 70800, state: 'UNPAID' as const, payments: [], order: orderPart };
  const done = { total: 70800, confirmed: 70800, balance: 0, state: 'FULLY_PAID' as const, payments: [{ amount: 70800 }], order: { totalPayable: 141600, confirmed: 141600, balance: 0, state: 'FULLY_PAID' as const } };
  const paidInvOpenOrder = { total: 70800, confirmed: 70800, balance: 0, state: 'FULLY_PAID' as const, payments: [{ amount: 10800 }], order: { totalPayable: 141600, confirmed: 100000, balance: 41600, state: 'PARTIALLY_PAID' as const } };
  const a = await renderInvoicePdf({ ...inv, paymentSummary: inv1 }, { stage: 'UNPAID' });
  const b = await renderInvoicePdf({ ...inv, paymentSummary: inv2 }, { stage: 'UNPAID' });
  const c = await renderInvoicePdf({ ...inv, paymentSummary: done }, { stage: 'PAID' });
  const d = await renderInvoicePdf({ ...inv, paymentSummary: paidInvOpenOrder }, { stage: 'PAID' });
  check([a, b, c, d].every(r => r.bytes.length < INVOICE_GENERATED_PDF_LIMIT_BYTES && r.pages === 1), 'each stays one page and below the size limit');
  const overlapping = (x: LayoutBox, y: LayoutBox) => x.page === y.page && x.x < y.x + y.w && y.x < x.x + x.w && x.y < y.y + y.h && y.y < x.y + x.h;
  check([a, b, c, d].every(r => !r.boxes.filter(x => x.kind === 'payment').some(p => r.boxes.some(o => o !== p && ['bank', 'state', 'words', 'terms', 'summary', 'address', 'signatory'].includes(o.kind) && overlapping(p, o)))), 'the order block overlaps no other block');
  if (HAS_TEXT) {
    const ta = flat(text(a.bytes, 'ord-1'));
    check(/Current Invoice Total: Rs\.70,800\.00/.test(ta) && /Balance Due on this Invoice: Rs\.10,800\.00/.test(ta) && /Total Order Value \(incl\. GST\): Rs\.1,41,600\.00/.test(ta)
      && /Total Confirmed Payments: Rs\.60,000\.00/.test(ta) && /Total Order Balance Outstanding: Rs\.81,600\.00/.test(ta) && /Payment Status: Partially Paid/.test(ta) && !/\bPAID\b/.test(ta),
      'invoice 1: its own 10,800 is kept apart from the order balance 81,600; Partially Paid; no stamp');
    const tb = flat(text(b.bytes, 'ord-2'));
    check(/Balance Due on this Invoice: Rs\.70,800\.00/.test(tb) && /Total Order Balance Outstanding: Rs\.81,600\.00/.test(tb) && /Invoice Status: Unpaid/.test(tb), 'invoice 2: 70,800 on the invoice, the same 81,600 on the order');
    const tc = flat(text(c.bytes, 'ord-3'));
    check(/Total Order Balance Outstanding: Rs\.0\.00/.test(tc) && /Payment Status: Fully Paid/.test(tc) && /\bPAID\b/.test(tc), 'settled: order balance 0, Fully Paid, stamp');
    const td = flat(text(d.bytes, 'ord-4'));
    check(/Invoice Status: Fully Paid/.test(td) && /Total Order Balance Outstanding: Rs\.41,600\.00/.test(td) && /Payment Status: Partially Paid/.test(td) && /\bPAID\b/.test(td), 'a paid invoice of an order that still has a balance: stamp on the invoice, order Partially Paid with 41,600 left');
  }
  if (HAS_RENDER) {
    const f = join(dir, 'order.pdf');
    writeFileSync(f, a.bytes);
    execFileSync('pdftoppm', ['-r', '70', '-png', f, join(dir, 'order')]);
    if (process.env.KEEP_PDF_PNG) execFileSync('cp', [join(dir, 'order-1.png'), process.env.KEEP_PDF_PNG]);
  }
}
if (!HAS_TEXT || !HAS_RENDER) console.log(`NOTE: pdftotext=${HAS_TEXT} pdftoppm=${HAS_RENDER}: the text and render checks above were skipped`);
rmSync(dir, { recursive: true, force: true });
console.log(`=== ALL INVOICE PDF TESTS PASSED (${passed}) ===`);
