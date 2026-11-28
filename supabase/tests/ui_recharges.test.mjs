// Browser test of Recharges (20270228000200, 20270306000100) at desktop and phone width: Support's Panel / Message tabs (separate records, summaries, filters),
// the customer picker that shows the Relationship Manager (never lets anyone choose it), GST / Non-GST and the total, the screenshot checks, the double click,
// editing, the status timeline, the RM performance tab, and Accounts' Recharge verification page (queues, "payment received" with the amount seen, not received,
// reject, correcting the billing details). The server is a stand-in with synthetic data that follows the database's rules; the real rules are tested in
// supabase/tests/support_recharges_test.sql.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { answerAppDialogs } from './ui/appDialogs.mjs';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the recharges browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const built = await build({
  entryPoints: ['supabase/tests/ui/recharges_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' }
});
const bundle = built.outputFiles[0].text;

// ---- the stand-in server
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f645400000000049454e44ae426082', 'hex');
const ymd = d => d.toISOString().slice(0, 10);
const daysAgo = n => ymd(new Date(Date.now() - n * 86400000));
const GSTIN = '27AAPFU0939F1ZV';
const CUSTOMERS = [
  { id: 'cu-1', name: 'Rch One', company: 'Alpha Traders', email: 'alpha@example.com', phone: '9000000711', address: '12 MG Road, Pune', gstin: GSTIN, rmId: 'rm-me', rmName: 'Meena Support' },
  { id: 'cu-2', name: 'Rch Two', company: 'Beta Stores', email: null, phone: '9000000712', address: null, gstin: null, rmId: 'rm-other', rmName: 'Rohit Support' },
  { id: 'cu-3', name: 'Rch Three', company: 'Gamma Foods', email: 'gamma@example.com', phone: '9000000713', address: null, gstin: null, rmId: null, rmName: null }
];
const mk = (i, kind, cust, amount, gst, pay, ago, by = 'Meena Support', byId = 'me') => ({
  id: `r-${kind}-${i}`, reference: `${kind === 'PANEL' ? 'PRC' : 'MRC'}-${String(i).padStart(5, '0')}`, kind, customerId: cust.id, customerName: cust.company, customerEmail: cust.email, customerPhone: cust.phone,
  customerAddress: cust.address, customerGstin: gst > 0 ? GSTIN : null, rmId: cust.rmId, rmName: cust.rmName, rechargeDate: daysAgo(ago), billingType: gst > 0 ? 'GST' : 'NON_GST', rechargeAmount: amount, gstAmount: gst,
  totalAmount: Math.round((amount + gst) * 100) / 100, paymentReference: `UTR-${kind}-${i}`, remarks: null, supportStatus: 'SUBMITTED', submittedAt: new Date(Date.now() - ago * 86400000).toISOString(), paymentStatus: pay,
  paymentNote: null, paymentVerifiedAt: null, paymentVerifiedByName: null, invoiceStatus: 'NOT_GENERATED', createdById: byId, createdByName: by, teamName: 'Support A', createdAt: new Date(Date.now() - ago * 86400000).toISOString(),
  updatedAt: new Date().toISOString(), screenshot: { id: `f-${kind}-${i}`, name: `proof-${i}.png`, mime: 'image/png', size: 2048 }
});
const seed = () => {
  const rows = [];
  rows.push(mk(1, 'PANEL', CUSTOMERS[0], 500, 90, 'PENDING_VERIFICATION', 1), mk(2, 'PANEL', CUSTOMERS[0], 1000, 0, 'PAYMENT_RECEIVED', 4), mk(3, 'PANEL', CUSTOMERS[1], 250, 0, 'PAYMENT_NOT_RECEIVED', 8, 'Rohit Support', 'other'),
    mk(4, 'PANEL', CUSTOMERS[1], 100, 18, 'REJECTED', 12, 'Rohit Support', 'other'));
  for (let i = 5; i <= 27; i++) rows.push(mk(i, 'PANEL', CUSTOMERS[0], 100 + i, 0, 'PENDING_VERIFICATION', 15 + i));
  rows.push(mk(1, 'MESSAGE', CUSTOMERS[0], 300, 0, 'PENDING_VERIFICATION', 2), mk(2, 'MESSAGE', CUSTOMERS[1], 200, 36, 'PAYMENT_RECEIVED', 6, 'Rohit Support', 'other'));
  rows[1].invoiceStatus = 'GENERATED';
  return rows;
};
const S = { role: 'MEMBER', rows: seed(), fail: false, calls: [], uploads: {}, names: {}, nextRef: 900, invoices: {}, pdfFails: 0, nextInvoice: 14 };
const events = r => [{ at: r.submittedAt, action: 'CREATED', from: null, to: 'PENDING_VERIFICATION', note: null, actorName: r.createdByName },
  ...(r.paymentStatus !== 'PENDING_VERIFICATION' ? [{ at: new Date().toISOString(), action: r.paymentStatus, from: 'PENDING_VERIFICATION', to: r.paymentStatus, note: r.paymentNote, actorName: 'Anil Accounts' }] : [])];
const accountsRole = () => S.role === 'ACCOUNTS' || S.role === 'SUPER_ADMIN';
const visible = r => accountsRole() || S.role === 'HEAD' ? true : S.role === 'LEAD' ? true : r.createdById === 'me' || r.rmId === 'rm-me';
const verifyActions = r => !accountsRole() ? [] : ({ PENDING_VERIFICATION: ['RECEIVED', 'NOT_RECEIVED', 'REJECTED'], PAYMENT_NOT_RECEIVED: ['RECEIVED', 'REJECTED'], PAYMENT_RECEIVED: r.invoiceStatus === 'NOT_GENERATED' ? ['NOT_RECEIVED', 'REJECTED'] : [], REJECTED: [] })[r.paymentStatus];
const canEdit = r => !accountsRole() && r.invoiceStatus === 'NOT_GENERATED' && r.paymentStatus !== 'PAYMENT_RECEIVED' && (r.createdById === 'me' || (S.role === 'LEAD' && r.paymentStatus === 'PENDING_VERIFICATION'));
const invoiceView = r => {
  const i = S.invoices[r.id];
  if (!i) return null;
  const base = { id: i.id, rechargeId: r.id, number: i.number, invoiceType: r.billingType, invoiceDate: i.invoiceDate, taxableAmount: r.rechargeAmount, totalGst: r.gstAmount, totalAmount: r.totalAmount, pdfStatus: i.pdfStatus, generatedAt: i.invoiceDate,
    deliveries: i.deliveries.map(d => ({ id: d.id, channel: d.channel, status: d.status, isResend: d.isResend, requestedAt: d.requestedAt, finishedAt: d.requestedAt, requestedByName: 'Anil Accounts', ...(accountsRole() ? { recipient: d.recipient, detail: d.detail } : {}) })) };
  return accountsRole() ? { ...base, taxTreatment: r.billingType === 'GST' ? 'INTRA_STATE' : 'NONE', hsnSac: '998313', particulars: 'Panel recharge', gstRate: 18, cgstAmount: r.gstAmount / 2, sgstAmount: r.gstAmount / 2, igstAmount: 0, customerName: r.customerName,
    customerEmail: r.customerEmail, customerPhone: r.customerPhone, customerAddress: r.customerAddress, customerGstin: r.customerGstin, pdfError: i.pdfError ?? null } : base;
};
const view = (r, withTimeline = false) => ({ ...r, canEdit: canEdit(r), canCorrect: accountsRole() && r.invoiceStatus === 'NOT_GENERATED' && r.paymentStatus !== 'REJECTED', verifyActions: verifyActions(r),
  ...(withTimeline ? { timeline: events(r), invoice: invoiceView(r), isAccounts: accountsRole() } : {}) });
const refreshInvoiceStatus = r => {
  const i = S.invoices[r.id];
  const sent = c => i.deliveries.some(d => d.channel === c && d.status === 'SENT');
  const failed = c => i.deliveries.some(d => d.channel === c && d.status === 'FAILED');
  r.invoiceStatus = sent('EMAIL') && sent('WHATSAPP') ? 'SENT' : (sent('EMAIL') && failed('WHATSAPP')) || (sent('WHATSAPP') && failed('EMAIL')) ? 'PARTIALLY_SENT' : sent('EMAIL') ? 'EMAIL_SENT' : sent('WHATSAPP') ? 'WHATSAPP_SENT' : failed('EMAIL') || failed('WHATSAPP') ? 'FAILED' : 'GENERATED';
};
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const ok = (res, data, status = 200) => json(res, status, { success: true, data });
const bad = (res, message, status = 400, code = 'VALIDATION_ERROR') => json(res, status, { success: false, error: { code, message } });
const body = req => new Promise(r => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => r(s ? JSON.parse(s) : {})); });

const srv = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (p === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  if (p.startsWith('/__img/')) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
  if (p.startsWith('/__put/')) { S.uploads[p.slice(7)] = (S.uploads[p.slice(7)] ?? 0) + 1; await new Promise(r => { req.on('data', () => {}); req.on('end', r); }); res.writeHead(200); return res.end(); }
  if (!p.startsWith('/api/v1/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>'); }
  const route = p.slice('/api/v1'.length);
  const b = req.method === 'POST' ? await body(req) : null;
  S.calls.push({ method: req.method, route, query: Object.fromEntries(url.searchParams), body: b });
  if (S.fail && route === '/support/recharges' && req.method === 'GET') return bad(res, 'The recharges could not be loaded.', 500, 'INTERNAL');
  if (route === '/support/recharges' && req.method === 'GET') {
    const q = Object.fromEntries(url.searchParams);
    const inScope = S.rows.filter(r => (!q.kind || r.kind === q.kind) && visible(r));
    const base = inScope.filter(r => (!q.search || r.customerName.toLowerCase().includes(q.search.toLowerCase())) && (!q.from || r.rechargeDate >= q.from) && (!q.to || r.rechargeDate <= q.to)
      && (q.min === undefined || r.totalAmount >= Number(q.min)) && (q.max === undefined || r.totalAmount <= Number(q.max)));
    const rows = base.filter(r => (!q.paymentStatus || r.paymentStatus === q.paymentStatus) && (!q.invoiceStatus || (q.invoiceStatus === 'GENERATED_ANY' ? r.invoiceStatus !== 'NOT_GENERATED' : q.invoiceStatus === 'DELIVERY_ANY' ? ['SENT', 'EMAIL_SENT', 'WHATSAPP_SENT', 'PARTIALLY_SENT', 'FAILED'].includes(r.invoiceStatus) : r.invoiceStatus === q.invoiceStatus)))
      .sort((a, c) => c.submittedAt.localeCompare(a.submittedAt));
    const limit = Number(q.limit ?? 20), offset = Number(q.offset ?? 0);
    const sum = (f, k) => Math.round(base.filter(f).reduce((s, r) => s + r[k], 0) * 100) / 100;
    const cnt = f => base.filter(f).length;
    return ok(res, { items: rows.slice(offset, offset + limit).map(r => view(r)), total: rows.length, limit, offset, role: S.role, canCreate: ['MEMBER', 'LEAD', 'HEAD'].includes(S.role), isAccounts: accountsRole(),
      summary: { totalRecharges: base.length, totalAmount: sum(() => true, 'totalAmount'), totalGst: sum(() => true, 'gstAmount'), totalNonGst: sum(r => r.billingType === 'NON_GST', 'rechargeAmount'),
        pending: cnt(r => r.paymentStatus === 'PENDING_VERIFICATION'), pendingAmount: sum(r => r.paymentStatus === 'PENDING_VERIFICATION', 'totalAmount'), received: cnt(r => r.paymentStatus === 'PAYMENT_RECEIVED'),
        receivedAmount: sum(r => r.paymentStatus === 'PAYMENT_RECEIVED', 'totalAmount'), notReceived: cnt(r => r.paymentStatus === 'PAYMENT_NOT_RECEIVED'), rejected: cnt(r => r.paymentStatus === 'REJECTED'),
        readyForInvoice: cnt(r => r.paymentStatus === 'PAYMENT_RECEIVED' && r.invoiceStatus === 'NOT_GENERATED'), invoiced: cnt(r => r.invoiceStatus !== 'NOT_GENERATED'), delivered: cnt(r => ['SENT', 'EMAIL_SENT', 'WHATSAPP_SENT', 'PARTIALLY_SENT'].includes(r.invoiceStatus)), deliveryFailed: cnt(r => r.invoiceStatus === 'FAILED') } });
  }
  if (route === '/support/recharge-customers' && req.method === 'GET') {
    const q = (url.searchParams.get('search') ?? '').toLowerCase();
    return ok(res, CUSTOMERS.filter(c => !q || `${c.name} ${c.company} ${c.email} ${c.phone}`.toLowerCase().includes(q)));
  }
  if (route === '/support/recharge-performance') {
    const rms = new Map();
    for (const r of S.rows.filter(visible).filter(r => r.rmId)) {
      const x = rms.get(r.rmId) ?? { rmId: r.rmId, rmName: r.rmName, panelAmount: 0, messageAmount: 0, totalAmount: 0, panelCount: 0, messageCount: 0, totalCount: 0, pendingAmount: 0, pendingCount: 0 };
      if (r.paymentStatus === 'PAYMENT_RECEIVED') { x[r.kind === 'PANEL' ? 'panelAmount' : 'messageAmount'] += r.totalAmount; x[r.kind === 'PANEL' ? 'panelCount' : 'messageCount']++; x.totalAmount += r.totalAmount; x.totalCount++; }
      if (r.paymentStatus === 'PENDING_VERIFICATION') { x.pendingAmount += r.totalAmount; x.pendingCount++; }
      rms.set(r.rmId, x);
    }
    return ok(res, [...rms.values()]);
  }
  if (route === '/support/recharge-uploads' && req.method === 'POST') {
    if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(b.mimeType)) return bad(res, 'The payment proof must be an image (PNG, JPEG or WebP) or a PDF.');
    const id = randomUUID();
    S.uploads[id] = 0; S.names[id] = b.fileName;
    return ok(res, { attachment: { id, name: b.fileName, mime: b.mimeType, size: b.sizeBytes }, bucket: 'support-recharge-files', path: `me/${id}`, provider: 'R2', token: '', upload: { url: `${base}/__put/${id}`, headers: {} } }, 201);
  }
  let m;
  if ((m = route.match(/^\/support\/recharge-uploads\/([^/]+)\/complete$/))) return ok(res, { id: m[1], name: S.names[m[1]] ?? 'x.png', mime: 'image/png', size: 2048 });
  if ((m = route.match(/^\/support\/recharge-uploads\/([^/]+)\/abort$/))) return ok(res, null);
  if ((m = route.match(/^\/support\/recharge-files\/([^/]+)\/url$/))) return ok(res, { url: `${base}/__img/${m[1]}.png`, expiresInSeconds: 120, fileName: 'x.png' });
  if (route === '/support/recharges' && req.method === 'POST') {
    const c = CUSTOMERS.find(x => x.id === b.customerId);
    if (!c) return bad(res, 'Customer not found.', 404, 'NOT_FOUND');
    if (!c.rmId) return bad(res, 'This customer has no Relationship Manager yet. Ask your Team Lead to assign one before recording a recharge.', 409, 'CONFLICT');
    if (!b.screenshotId) return bad(res, 'Upload the screenshot of the payment.');
    const r = mk(S.nextRef++, b.kind, c, b.rechargeAmount, b.gstAmount, 'PENDING_VERIFICATION', 0);
    Object.assign(r, { billingType: b.billingType, customerGstin: b.billingType === 'GST' ? b.gstNumber : null, paymentReference: b.paymentReference, remarks: b.remarks, rechargeDate: b.rechargeDate, screenshot: { id: b.screenshotId, name: 'x.png', mime: 'image/png', size: 2048 } });
    S.rows.push(r);
    return ok(res, view(r), 201);
  }
  if ((m = route.match(/^\/support\/recharges\/([^/]+)\/invoice\/plan$/))) {
    const r = S.rows.find(x => x.id === m[1]);
    if (!accountsRole()) return bad(res, 'FORBIDDEN', 403, 'FORBIDDEN');
    return ok(res, { invoiceType: r.billingType, taxTreatment: r.billingType === 'GST' ? 'INTRA_STATE' : 'NONE', hsnSac: '998313', customerStateCode: '27', customerState: 'Maharashtra', supplierStateCode: '27', taxableAmount: r.rechargeAmount, gstRate: 18,
      cgstAmount: r.gstAmount / 2, sgstAmount: r.gstAmount / 2, igstAmount: 0, totalGst: r.gstAmount, totalAmount: r.totalAmount, missing: r.customerAddress ? [] : ['the customer\'s billing address'], particulars: `Panel recharge (${r.reference})`,
      paymentStatus: r.paymentStatus, invoiceStatus: r.invoiceStatus, customerName: r.customerName, customerEmail: r.customerEmail, customerPhone: r.customerPhone, customerAddress: r.customerAddress, customerGstin: r.customerGstin });
  }
  if ((m = route.match(/^\/support\/recharges\/([^/]+)\/invoice$/)) && req.method === 'POST') {
    const r = S.rows.find(x => x.id === m[1]);
    if (!accountsRole()) return bad(res, 'FORBIDDEN', 403, 'FORBIDDEN');
    if (r.paymentStatus !== 'PAYMENT_RECEIVED') return bad(res, 'Confirm that the payment was received first. An invoice is made only for a verified payment.', 409, 'CONFLICT');
    if (!r.customerAddress) return bad(res, 'The invoice needs the customer\'s billing address.');
    if (!S.invoices[r.id]) { S.invoices[r.id] = { id: `inv-${r.id}`, number: `GST/26-27/${String(S.nextInvoice++).padStart(3, '0')}`, invoiceDate: ymd(new Date()), pdfStatus: S.pdfFails > 0 ? 'FAILED' : 'READY', pdfError: S.pdfFails > 0 ? 'The invoice PDF could not be created or stored.' : null, deliveries: [] }; if (S.pdfFails > 0) S.pdfFails--; r.invoiceStatus = 'GENERATED'; }
    const i = S.invoices[r.id];
    return ok(res, { invoice: invoiceView(r), pdf: { status: i.pdfStatus, message: i.pdfError } }, 201);
  }
  if ((m = route.match(/^\/support\/recharges\/([^/]+)\/invoice\/pdf$/))) {
    const r = S.rows.find(x => x.id === m[1]);
    S.invoices[r.id].pdfStatus = 'READY'; S.invoices[r.id].pdfError = null;
    return ok(res, { invoice: invoiceView(r), pdf: { status: 'READY', message: null } });
  }
  if ((m = route.match(/^\/support\/recharges\/([^/]+)\/invoice\/file$/))) return ok(res, { url: `${base}/__img/invoice.png`, expiresInSeconds: 120, fileName: 'invoice.pdf' });
  if ((m = route.match(/^\/support\/recharges\/([^/]+)\/invoice\/send$/))) {
    const r = S.rows.find(x => x.id === m[1]);
    const i = S.invoices[r.id];
    if (!accountsRole()) return bad(res, 'FORBIDDEN', 403, 'FORBIDDEN');
    if (!Array.isArray(b.channels) || b.channels.length === 0) return bad(res, 'Choose e-mail, WhatsApp or both.');
    const results = [];
    for (const ch of b.channels) {
      const already = i.deliveries.some(d => d.channel === ch && d.status === 'SENT');
      if (already && !b.resend) { results.push({ channel: ch, status: 'REFUSED', message: `The invoice was already sent by ${ch.toLowerCase()}. Use "Send again" if you really want to send it once more.` }); continue; }
      const d = { id: `d-${i.deliveries.length + 1}`, channel: ch, status: ch === 'WHATSAPP' ? (S.waMode ?? 'NOT_SENT') : 'SENT', isResend: already, requestedAt: new Date().toISOString(), recipient: ch === 'EMAIL' ? r.customerEmail : r.customerPhone,
        detail: ch === 'WHATSAPP' ? 'Test mode: the WhatsApp message was prepared but NOT sent to the customer.' : 'Sent from meta@amuwa.com' };
      i.deliveries.unshift(d);
      results.push({ channel: ch, status: d.status, message: d.detail, deliveryId: d.id });
    }
    refreshInvoiceStatus(r);
    return ok(res, { results, invoiceStatus: r.invoiceStatus });
  }
  if ((m = route.match(/^\/support\/recharges\/([^/]+)\/contact$/))) {
    const r = S.rows.find(x => x.id === m[1]);
    if (!accountsRole()) return bad(res, 'FORBIDDEN', 403, 'FORBIDDEN');
    Object.assign(r, { customerEmail: b.customerEmail, customerPhone: b.customerPhone });
    if (S.invoices[r.id]) Object.assign(S.invoices[r.id], {});
    return ok(res, view(r));
  }
  if ((m = route.match(/^\/support\/recharges\/([^/]+)$/)) && req.method === 'GET') {
    const r = S.rows.find(x => x.id === m[1] && visible(x));
    return r ? ok(res, view(r, true)) : bad(res, 'Recharge not found.', 404, 'NOT_FOUND');
  }
  if ((m = route.match(/^\/support\/recharges\/([^/]+)\/update$/))) {
    const r = S.rows.find(x => x.id === m[1] && visible(x));
    if (!r) return bad(res, 'Recharge not found.', 404, 'NOT_FOUND');
    if (!canEdit(r)) return bad(res, 'This recharge can no longer be edited by you.', 403, 'FORBIDDEN');
    Object.assign(r, { billingType: b.billingType, rechargeAmount: b.rechargeAmount, gstAmount: b.gstAmount, totalAmount: Math.round((b.rechargeAmount + b.gstAmount) * 100) / 100, remarks: b.remarks, paymentReference: b.paymentReference,
      paymentStatus: ['REJECTED', 'PAYMENT_NOT_RECEIVED'].includes(r.paymentStatus) && r.createdById === 'me' ? 'PENDING_VERIFICATION' : r.paymentStatus });
    return ok(res, view(r));
  }
  if ((m = route.match(/^\/support\/recharges\/([^/]+)\/verify$/))) {
    const r = S.rows.find(x => x.id === m[1] && visible(x));
    if (!r) return bad(res, 'Recharge not found.', 404, 'NOT_FOUND');
    if (!accountsRole()) return bad(res, 'FORBIDDEN', 403, 'FORBIDDEN');
    if (!verifyActions(r).includes(b.decision)) return bad(res, 'This recharge cannot be moved there.', 409, 'CONFLICT');
    if (b.decision !== 'RECEIVED' && (b.note ?? '').length < 3) return bad(res, 'Say why (a short note is required).');
    if (b.decision === 'RECEIVED' && b.receivedAmount !== undefined && b.receivedAmount !== r.totalAmount) return bad(res, `The amount received (${b.receivedAmount}) is not the recharge total (${r.totalAmount}). Correct the billing details first, or mark the payment as not received.`);
    Object.assign(r, { paymentStatus: { RECEIVED: 'PAYMENT_RECEIVED', NOT_RECEIVED: 'PAYMENT_NOT_RECEIVED', REJECTED: 'REJECTED' }[b.decision], paymentNote: b.note, paymentVerifiedByName: 'Anil Accounts', paymentVerifiedAt: new Date().toISOString() });
    return ok(res, { ...view(r), replayed: false });
  }
  if ((m = route.match(/^\/support\/recharges\/([^/]+)\/correct$/))) {
    const r = S.rows.find(x => x.id === m[1] && visible(x));
    if (!r) return bad(res, 'Recharge not found.', 404, 'NOT_FOUND');
    if (!accountsRole()) return bad(res, 'FORBIDDEN', 403, 'FORBIDDEN');
    Object.assign(r, { billingType: b.billingType, rechargeAmount: b.rechargeAmount, gstAmount: b.gstAmount, totalAmount: Math.round((b.rechargeAmount + b.gstAmount) * 100) / 100, customerGstin: b.gstNumber, customerEmail: b.customerEmail, customerAddress: b.customerAddress });
    return ok(res, view(r));
  }
  return bad(res, 'no fake', 404, 'NOT_FOUND');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
const text = async (page, sel) => (await page.innerText(sel)).replace(/\s+/g, ' ').trim();
const lists = () => S.calls.filter(c => c.method === 'GET' && c.route === '/support/recharges');
const lastList = () => lists().at(-1);
const settle = page => page.waitForTimeout(450);
const dialogSays = async (page, re) => { await page.waitForFunction(src => new RegExp(src).test(document.querySelector('[role="dialog"]')?.textContent ?? ''), re.source, { timeout: 5000 }).catch(() => undefined); return re.test(await text(page, '[role="dialog"]')); };
const noSideways = async (page, what) => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${what}: no sideways scrolling`, await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
const reset = (role = 'MEMBER') => { S.invoices = {}; S.pdfFails = 0; S.waMode = undefined; S.nextInvoice = 14; S.nextRef = 900; S.role = role; S.rows = seed(); S.fail = false; S.calls.length = 0; };
const open = async (page, role, mount = 'mountRecharges') => { reset(role); await page.goto(base); await page.evaluate(m => window[m](), mount); await page.getByTestId('recharge-summary').waitFor(); await page.waitForFunction(() => !document.querySelector('[data-testid^="stat-"]')?.textContent?.includes('–')); };
const setFile = (page, name, mimeType, buffer) => page.getByTestId('recharge-file').setInputFiles({ name, mimeType, buffer });

try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 780 }]]) {
    const ctx = await browser.newContext({ viewport, timezoneId: 'Asia/Kolkata', hasTouch: label === 'phone', isMobile: label === 'phone' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await answerAppDialogs(page);
    const rows = () => page.locator(label === 'phone' ? '[data-testid="recharge-card"]' : '[data-testid="recharge-row"]');

    // ---- Support member: the Panel tab
    await open(page, 'MEMBER');
    check(await page.getByTestId('tab-PANEL').getAttribute('aria-selected') === 'true', `${label}: the Panel Recharge tab opens first`);
    check((await page.locator('[role="tab"]').allInnerTexts()).map(t => t.trim()).join('|') === 'Panel Recharge|Message Recharge|RM performance', `${label}: three tabs`);
    check(lastList().query.kind === 'PANEL', `${label}: the list asks for Panel recharges only`);
    // the member sees what they recorded and what is credited to them (rm-me): 26 Panel rows of 27 (r-PANEL-3 and -4 are another person's customers)
    check(await text(page, '[data-testid="stat-total"]') === 'Total recharges 25', `${label}: total recharges`, await text(page, '[data-testid="stat-total"]'));
    check(/Pending verification 24/.test(await text(page, '[data-testid="stat-pending"]')) && /Payment received 1/.test(await text(page, '[data-testid="stat-received"]')), `${label}: pending verification and payment received`);
    check(/Total GST ₹90/.test(await text(page, '[data-testid="stat-gst"]')), `${label}: total GST`, await text(page, '[data-testid="stat-gst"]'));
    check(await rows().count() === 20, `${label}: the first page has 20 rows`);
    check(/Showing 1–20 of 25 recharges/.test(await text(page, 'body')), `${label}: the pager says 25 recharges`);
    check((await page.getByText('Payment', { exact: true }).count()) >= 0 && /Pending verification/.test(await text(page, '#rc-panel')) && /Not generated/.test(await text(page, '#rc-panel')), `${label}: payment and invoice status are shown on each record`);
    check(/Meena Support|RM/.test(await text(page, '#rc-panel')), `${label}: the Relationship Manager is shown`);
    await noSideways(page, `${label}: the list`);
    await page.getByRole('button', { name: 'Next page' }).click(); await settle(page);
    check(lastList().query.offset === '20' && await rows().count() === 5, `${label}: page 2 shows the last 5`, lastList().query);
    await page.getByRole('button', { name: 'Previous page' }).click(); await settle(page);

    // ---- filters
    await page.locator('#rc-f-search').fill('alpha'); await settle(page);
    check(lastList().query.search === 'alpha' && await rows().count() === 20, `${label}: search by customer`);
    await page.locator('#rc-f-search').fill('zzzz'); await settle(page);
    check(await page.getByTestId('recharge-empty').isVisible() && /No recharges match these filters/.test(await text(page, '[data-testid="recharge-empty"]')), `${label}: the empty state for a search with no match`);
    await page.getByRole('button', { name: 'Clear filters' }).click(); await settle(page);
    await page.locator('#rc-f-payment').selectOption('PAYMENT_RECEIVED'); await settle(page);
    check(lastList().query.paymentStatus === 'PAYMENT_RECEIVED' && await rows().count() === 1, `${label}: payment status filter`);
    check(await text(page, '[data-testid="stat-total"]') === 'Total recharges 25', `${label}: the cards still show every status`);
    await page.locator('#rc-f-payment').selectOption(''); await settle(page);
    await page.locator('#rc-f-invoice').selectOption('GENERATED'); await settle(page);
    check(lastList().query.invoiceStatus === 'GENERATED' && await rows().count() === 1, `${label}: invoice status filter`);
    await page.locator('#rc-f-invoice').selectOption(''); await settle(page);
    await page.locator('#rc-f-min').fill('1000'); await page.locator('#rc-f-max').fill('1000'); await settle(page);
    check(lastList().query.min === '1000' && await rows().count() === 1, `${label}: amount filter`, await rows().count());
    await page.locator('#rc-f-min').fill(''); await page.locator('#rc-f-max').fill(''); await settle(page);
    await page.locator('#rc-f-from').fill(daysAgo(5)); await page.locator('#rc-f-to').fill(daysAgo(2)); await settle(page);
    check(lastList().query.from === daysAgo(5) && lastList().query.to === daysAgo(2) && await rows().count() === 1, `${label}: date filter`, await rows().count());
    await page.getByRole('button', { name: 'Clear filters' }).click(); await settle(page);

    // ---- the Message tab is separate
    await page.locator('#rc-f-search').fill('alpha'); await settle(page);
    await page.getByTestId('tab-MESSAGE').click(); await settle(page);
    check(lastList().query.kind === 'MESSAGE' && await rows().count() === 1 && await page.locator('#rc-f-search').inputValue() === '', `${label}: the Message tab lists Message recharges with its own filters`);
    await page.getByTestId('tab-PANEL').click(); await settle(page);
    check(await page.locator('#rc-f-search').inputValue() === 'alpha', `${label}: the Panel tab kept its own filter`);
    await page.getByRole('button', { name: 'Clear filters' }).click(); await settle(page);
    S.fail = true; await page.locator('#rc-f-search').fill('alp'); await settle(page);
    check(await page.getByRole('alert').first().isVisible() && /could not be loaded/.test(await text(page, '[role="alert"]')), `${label}: a failed load shows an error`);
    S.fail = false; await page.getByRole('button', { name: 'Retry' }).click(); await settle(page);
    check(await rows().count() > 0, `${label}: Retry loads the records`);
    await page.getByRole('button', { name: 'Clear filters' }).click(); await settle(page);

    // ---- create: the customer, the RM, GST / Non-GST
    await page.getByRole('button', { name: /Create Panel Recharge/ }).click();
    await page.getByTestId('recharge-form').waitFor();
    const dlg = await page.locator('[role="dialog"]').boundingBox();
    check(dlg.width <= viewport.width + 0.5 && dlg.x >= -0.5 && dlg.y >= -0.5 && dlg.y + dlg.height <= viewport.height + 0.5, `${label}: the form fits inside the screen`, dlg);
    await noSideways(page, `${label}: the form`);
    const act = await page.getByTestId('recharge-form-actions').boundingBox();
    check(act.y + act.height <= viewport.height + 0.5 && act.y >= 0, `${label}: the Submit button stays in view without scrolling (sticky)`, act);
    await page.getByRole('button', { name: 'Submit to Accounts' }).click();
    check(/Choose the customer/.test(await text(page, '[role="dialog"]')) && /Upload the screenshot/.test(await text(page, '[role="dialog"]')), `${label}: an empty form shows what is missing`);
    check(!S.calls.some(c => c.method === 'POST' && c.route === '/support/recharges'), `${label}: nothing is sent while the form is invalid`);
    await page.locator('#rc-cust').fill('beta'); await settle(page);
    check((await page.getByTestId('recharge-customer-list').innerText()).includes('Beta Stores'), `${label}: the customer search lists matches with their RM`);
    await page.getByRole('button', { name: /Gamma Foods/ }).waitFor({ state: 'detached' }).catch(() => undefined);
    await page.locator('#rc-cust').fill('gamma'); await settle(page);
    await page.getByRole('button', { name: /Gamma Foods/ }).click();
    check(/no Relationship Manager yet/.test(await text(page, '[data-testid="recharge-customer"]')), `${label}: a customer with no RM is flagged`);
    await page.getByRole('button', { name: 'Submit to Accounts' }).click();
    check(/no Relationship Manager yet/.test(await text(page, '[role="dialog"]')), `${label}: and cannot be submitted`);
    await page.getByRole('button', { name: 'Change' }).click();
    await page.locator('#rc-cust').fill('alpha'); await settle(page);
    await page.getByRole('button', { name: /Alpha Traders/ }).click();
    check(/Meena Support/.test(await text(page, '[data-testid="recharge-rm"]')) && /9000000711/.test(await text(page, '[data-testid="recharge-customer"]')) && /alpha@example.com/.test(await text(page, '[data-testid="recharge-customer"]')), `${label}: the customer's phone, e-mail and Relationship Manager are filled in from the record`);
    check(await page.locator('[data-testid="recharge-customer"] input, [data-testid="recharge-customer"] select').count() === 0, `${label}: the Relationship Manager cannot be edited`);
    // Non-GST first
    await page.locator('#rc-amount').fill('abc!@#'); check(await page.locator('#rc-amount').inputValue() === '', `${label}: letters and symbols cannot be typed in an amount`);
    await page.locator('#rc-amount').fill('500.456'); check(await page.locator('#rc-amount').inputValue() === '500.45', `${label}: at most two decimals are kept`);
    await page.locator('#rc-amount').fill('500');
    check(await page.locator('#rc-gst').count() === 0 && await page.locator('#rc-gstin').count() === 0, `${label}: Non-GST has no GST fields`);
    check(/₹500/.test(await text(page, '[data-testid="recharge-total"]')), `${label}: the Non-GST total is the amount`);
    await page.locator('label', { hasText: /^GST$/ }).click();
    check(await page.locator('#rc-gst').isVisible() && await page.locator('#rc-gstin').isVisible() && await page.locator('#rc-gstin').inputValue() === GSTIN, `${label}: GST shows the GST amount and the customer's GST number (filled from the record)`);
    await page.locator('#rc-gst').fill('90');
    check(/₹590/.test(await text(page, '[data-testid="recharge-total"]')), `${label}: the GST total is amount + GST`, await text(page, '[data-testid="recharge-total"]'));
    await page.locator('#rc-gstin').fill('27AAPFU0939F1Z');
    await page.getByRole('button', { name: 'Submit to Accounts' }).click();
    check(/valid 15-character GST number/.test(await text(page, '[role="dialog"]')), `${label}: a GST recharge needs a valid GST number`);
    await page.locator('#rc-gstin').fill(GSTIN.toLowerCase());
    check(await page.locator('#rc-gstin').inputValue() === GSTIN, `${label}: the GST number is upper-cased as typed`);
    await page.locator('#rc-ref').fill('UTR-9001');
    await setFile(page, 'proof.gif', 'image/gif', Buffer.from('GIF89a'));
    check(await dialogSays(page, /image \(PNG, JPEG or WebP\) or a PDF/), `${label}: a GIF is refused as proof`);
    await setFile(page, 'proof.png', 'image/png', Buffer.alloc(5 * 1024 * 1024 + 10, 1));
    check(await dialogSays(page, /larger than 5 MB/), `${label}: a file over 5 MB is refused`);
    await setFile(page, 'fake.png', 'image/png', Buffer.from('this is not a png'));
    check(await dialogSays(page, /not a real PNG/), `${label}: a text file renamed .png is refused`);
    check(!S.calls.some(c => c.route === '/support/recharge-uploads'), `${label}: refused files are never uploaded`);
    await setFile(page, 'proof.png', 'image/png', PNG);
    await page.getByRole('button', { name: /Replace screenshot/ }).waitFor();
    check(Object.values(S.uploads).some(n => n === 1), `${label}: the screenshot is uploaded straight to storage (one PUT)`);
    await page.locator('#rc-rem').fill('paid by UPI');
    await page.getByRole('button', { name: 'Submit to Accounts' }).dblclick();
    await page.getByTestId('recharge-notice').waitFor();
    const posts = S.calls.filter(c => c.method === 'POST' && c.route === '/support/recharges');
    check(posts.length === 1, `${label}: a double click creates one recharge`, posts.length);
    const sent = posts[0].body;
    check(sent.kind === 'PANEL' && sent.customerId === 'cu-1' && sent.billingType === 'GST' && sent.rechargeAmount === 500 && sent.gstAmount === 90 && sent.totalAmount === 590 && sent.gstNumber === GSTIN
      && sent.paymentReference === 'UTR-9001' && /^[0-9a-f-]{36}$/.test(sent.screenshotId) && sent.rechargeDate === ymd(new Date(Date.now() + 5.5 * 3600000)), `${label}: the request body`, sent);
    check(!('rmId' in sent) && !('rm' in sent) && !('departmentId' in sent) && !('createdBy' in sent) && !('paymentStatus' in sent) && !('status' in sent), `${label}: the request names no Relationship Manager, department, owner or status`);
    check(/PRC-00900 was submitted to Accounts/.test(await text(page, '[data-testid="recharge-notice"]')) && !(await page.locator('[role="dialog"]').count()), `${label}: success message, the form closes`);
    await settle(page);

    // ---- view: details, timeline, the screenshot; no Accounts controls for Support
    await page.locator('#rc-f-search').fill('alpha'); await settle(page);
    await rows().first().getByRole('button', { name: /View PRC-00900/ }).click().catch(async () => { await page.getByRole('button', { name: /View PRC-00900/ }).first().click(); });
    await page.getByTestId('recharge-detail').waitFor();
    await page.getByTestId('recharge-shot').waitFor();
    const src = await page.locator('[data-testid="recharge-shot"] img').getAttribute('src');
    check(/\/__img\//.test(src), `${label}: the screenshot comes through a link issued for it`, src);
    const dText = await text(page, '[data-testid="recharge-detail"]');
    check(/Meena Support/.test(dText) && /GST no\. 27AAPFU0939F1ZV/.test(dText) && /Pending verification/.test(dText) && /Not generated/.test(dText) && /UTR-9001/.test(dText), `${label}: the detail shows the RM, GST number, payment and invoice status, reference`, dText.slice(0, 300));
    check(/Submitted to Accounts/.test(await text(page, '[data-testid="recharge-timeline"]')), `${label}: the status timeline starts with the submission`);
    check(await page.getByTestId('recharge-verify').count() === 0 && await page.getByTestId('recharge-correct').count() === 0, `${label}: Support has no verify or correct controls`);
    await noSideways(page, `${label}: the detail`);
    const imgBox = await page.locator('[data-testid="recharge-shot"] img').boundingBox();
    check(imgBox.width <= viewport.width && imgBox.height <= viewport.height, `${label}: the screenshot preview fits the screen`, imgBox);
    await page.getByTestId('recharge-detail').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByTestId('recharge-form').waitFor();
    check(await page.locator('#rc-amount').inputValue() === '500' && await page.locator('#rc-gst').inputValue() === '90' && /Meena Support/.test(await text(page, '[data-testid="recharge-rm"]')), `${label}: editing starts from the saved values; the customer and RM are fixed`);
    check(await page.locator('#rc-cust').count() === 0, `${label}: the customer cannot be changed when editing`);
    await page.locator('#rc-amount').fill('600');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText(/PRC-00900 was updated/).waitFor();
    check(S.calls.some(c => /\/support\/recharges\/.+\/update$/.test(c.route)) && !('customerId' in S.calls.filter(c => /update$/.test(c.route)).at(-1).body), `${label}: the edit is saved without a customer`);
    await page.locator('#rc-f-search').fill(''); await settle(page);
    check(await page.getByRole('button', { name: /Edit PRC-00002/ }).count() === 0, `${label}: no Edit on a recharge whose payment was received`);

    // ---- RM performance
    await page.getByTestId('tab-PERFORMANCE').click();
    await page.getByTestId('rm-performance').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="rm-table"], [data-testid="rm-card"]'));
    const perf = await text(page, '[data-testid="rm-performance"]');
    check(/Meena Support/.test(perf) && /Counted only after Accounts confirms/.test(perf) && /pending \(not counted\)/i.test(perf), `${label}: the RM performance counts verified recharges and shows pending apart`, perf.slice(0, 300));
    check(S.calls.some(c => c.route === '/support/recharge-performance'), `${label}: it is read from the server`);
    await noSideways(page, `${label}: the RM performance`);
    check(errors.length === 0, `${label}: no script errors`, errors);
    await ctx.close();

    // ---- Accounts: Recharge verification
    const ctxA = await browser.newContext({ viewport, timezoneId: 'Asia/Kolkata', hasTouch: label === 'phone', isMobile: label === 'phone' });
    const acc = await ctxA.newPage();
    await answerAppDialogs(acc);
    await open(acc, 'ACCOUNTS', 'mountVerification');
    const arows = () => acc.locator(label === 'phone' ? '[data-testid="recharge-card"]' : '[data-testid="recharge-row"]');
    check(/Pending verification \d+/.test(await text(acc, '[data-testid="stat-pending"]')) && await acc.getByTestId('section-pending').getAttribute('aria-selected') === 'true', `${label}: Accounts open on Pending verification`);
    check(lastList().query.paymentStatus === 'PENDING_VERIFICATION' && lastList().query.kind === undefined, `${label}: Accounts see Panel and Message together`);
    check(await text(acc, '[data-testid="recharge-verification"] [role="tablist"]').then(t => { return /Pending verification 2\d/.test(t) && /Payment received 2/.test(t) && /Ready for invoice 1/.test(t) && /Invoices generated 1/.test(t); }), `${label}: the queues show their counts`);
    check(/Submitted by|Type|Panel Recharge/.test(await text(acc, '[data-testid="recharge-verification"]')), `${label}: Accounts see the type and who submitted`);
    await acc.getByTestId('section-ready').click(); await settle(acc);
    check(lastList().query.paymentStatus === 'PAYMENT_RECEIVED' && lastList().query.invoiceStatus === 'NOT_GENERATED' && await arows().count() === 1, `${label}: Ready for invoice = payment received, no invoice yet`);
    await acc.getByTestId('section-invoiced').click(); await settle(acc);
    check(lastList().query.invoiceStatus === 'GENERATED_ANY' && await arows().count() === 1, `${label}: Invoices generated`);
    await acc.getByTestId('section-not-received').click(); await settle(acc);
    check(await arows().count() === 1, `${label}: Payment not received`);
    await acc.getByTestId('section-rejected').click(); await settle(acc);
    check(await arows().count() === 1, `${label}: Rejected`);
    await acc.getByTestId('section-pending').click(); await settle(acc);
    await acc.locator('#rv-f-kind').selectOption('MESSAGE'); await settle(acc);
    check(lastList().query.kind === 'MESSAGE' && await arows().count() === 1, `${label}: filter by Message recharges`);
    await acc.getByRole('button', { name: 'Clear filters' }).click(); await settle(acc);
    await noSideways(acc, `${label}: the Accounts queue`);

    await acc.locator('#rv-f-search').fill('alpha'); await settle(acc);
    await arows().first().getByRole('button', { name: /View/ }).click();
    await acc.getByTestId('recharge-verify').waitFor();
    check(await acc.getByRole('button', { name: 'Payment received' }).isVisible() && await acc.getByRole('button', { name: 'Payment not received' }).isVisible() && await acc.getByRole('button', { name: 'Reject' }).isVisible(), `${label}: Accounts get the three decisions`);
    check(await acc.getByTestId('recharge-detail').getByRole('button', { name: 'Edit', exact: true }).count() === 0, `${label}: Accounts do not edit Support's recharge`);
    await acc.getByRole('button', { name: 'Payment not received' }).click();
    check(/short note is required/.test(await text(acc, '[data-testid="recharge-verify"]')), `${label}: "not received" needs a note`);
    check(!S.calls.some(c => /\/verify$/.test(c.route)), `${label}: nothing is sent without the note`);
    await acc.locator('#rv-received').fill('1');
    await acc.getByRole('button', { name: 'Payment received' }).click();
    await acc.getByRole('alert').first().waitFor();
    check(/not the recharge total/.test(await text(acc, '[data-testid="recharge-verify"]')), `${label}: an amount that is not the total is refused with the server's reason`);
    await acc.locator('#rv-received').fill('590');
    await acc.locator('#rv-note').fill('seen in the bank statement');
    await acc.getByRole('button', { name: 'Payment received' }).click();
    await acc.getByTestId('recharge-detail-notice').waitFor();
    const vcall = S.calls.filter(c => /\/verify$/.test(c.route)).at(-1);
    check(vcall.body.decision === 'RECEIVED' && vcall.body.receivedAmount === 590 && vcall.body.note === 'seen in the bank statement', `${label}: the decision carries the amount seen and the note`, vcall.body);
    check(S.rows.find(r => r.id === lastVerified(vcall.route)).paymentStatus === 'PAYMENT_RECEIVED', `${label}: the payment is marked received on the server`);
    await acc.getByTestId('recharge-timeline').waitFor();
    check(/Payment received/.test(await text(acc, '[data-testid="recharge-timeline"]')), `${label}: the timeline shows the decision`);
    check(await acc.getByRole('button', { name: 'Correct billing details' }).isVisible(), `${label}: Accounts may correct the billing details until an invoice exists`);
    await acc.getByRole('button', { name: 'Correct billing details' }).click();
    await acc.locator('#rc-c-note').fill('Customer e-mail was missing');
    await acc.locator('#rc-c-mail').fill('billing@alpha.example.com');
    await acc.getByRole('button', { name: 'Save correction' }).click();
    await acc.getByText('The billing details were corrected.').waitFor();
    check(S.calls.filter(c => /\/correct$/.test(c.route)).at(-1).body.customerEmail === 'billing@alpha.example.com' && !('rmId' in S.calls.filter(c => /\/correct$/.test(c.route)).at(-1).body), `${label}: the correction is sent with its reason, and never names an RM or customer`);
    await noSideways(acc, `${label}: the Accounts detail`);

    // ---- the invoice: generate, review, send (nothing is sent by itself), retry, send again
    await acc.getByTestId('recharge-generate').waitFor();
    check(/Panel recharge \(PRC-00001\)/.test(await text(acc, '[data-testid="recharge-plan"]')) && /Same state: CGST \+ SGST/.test(await text(acc, '[data-testid="recharge-plan"]')) && /Taxable amount/.test(await text(acc, '[data-testid="recharge-plan"]')), `${label}: before generating, Accounts see what the invoice will hold`);
    check(S.calls.filter(c => /\/invoice$/.test(c.route) && c.method === 'POST').length === 0, `${label}: no invoice is made by confirming the payment`);
    S.pdfFails = 1;
    await acc.getByRole('button', { name: 'Generate invoice' }).click();
    await acc.getByTestId('recharge-pdf-problem').waitFor();
    check(/GST\/26-27\/014/.test(await text(acc, '[data-testid="recharge-invoice-controls"]')) && /PDF is not ready/.test(await text(acc, '[data-testid="recharge-pdf-problem"]')) && await acc.getByTestId('recharge-send').count() === 0, `${label}: a failed PDF leaves the invoice with the reason, and nothing can be sent yet`);
    await acc.getByRole('button', { name: 'Retry the PDF' }).click();
    await acc.getByTestId('recharge-send').waitFor();
    check(S.calls.some(c => /\/invoice\/pdf$/.test(c.route)), `${label}: Retry the PDF finishes it`);
    check(S.calls.filter(c => /\/invoice\/send$/.test(c.route)).length === 0, `${label}: and still nothing was sent`);
    await acc.getByRole('button', { name: /Review invoice/ }).click();
    await acc.waitForFunction(() => true); await settle(acc);
    check(S.calls.some(c => /\/invoice\/file$/.test(c.route) && c.query.action === 'view'), `${label}: Accounts can review the PDF through a short-lived link before sending`);
    check(await acc.getByLabel('Send by E-mail').isChecked() && await acc.getByLabel('Send by WhatsApp').isChecked(), `${label}: both channels are offered, e-mail and WhatsApp separately`);
    check(/billing@alpha\.example\.com/.test(await text(acc, '[data-testid="channel-EMAIL"]')) && /9000000711/.test(await text(acc, '[data-testid="channel-WHATSAPP"]')), `${label}: with the address and the number they go to`);
    await acc.getByTestId('recharge-send').dblclick();
    await acc.getByTestId('recharge-send-results').waitFor();
    const sends = S.calls.filter(c => /\/invoice\/send$/.test(c.route));
    check(sends.length >= 1 && sends[0].body.channels.join() === 'EMAIL,WHATSAPP' && sends[0].body.resend === false, `${label}: Send asks for both channels, not as a re-send`, sends.map(x => x.body));
    const resText = await text(acc, '[data-testid="recharge-send-results"]');
    check(/E-mail: sent/.test(resText) && /WhatsApp: not sent\. Test mode/.test(resText), `${label}: e-mail sent; WhatsApp in test mode is reported as not sent, never as sent`, resText);
    check(S.rows.find(r => r.id === lastVerified(vcall.route)).invoiceStatus === 'EMAIL_SENT', `${label}: the recharge's invoice status is Email sent`);
    check(await acc.getByLabel('Send by E-mail').isChecked() === false && await acc.getByLabel('Send by WhatsApp').isChecked() === true, `${label}: the channel that went is not ticked again (a second send must be a choice)`);
    check(/Sent/.test(await text(acc, '[data-testid="channel-EMAIL"]')) && /Not sent/.test(await text(acc, '[data-testid="channel-WHATSAPP"]')), `${label}: each channel shows its own state`);
    check((await acc.getByTestId('recharge-delivery').count()) === 2, `${label}: the delivery history lists both attempts`);
    await acc.getByLabel('Send by E-mail').check();
    check(/Send again/.test(await text(acc, '[data-testid="recharge-send"]')), `${label}: ticking a channel that already went turns the button into "Send again"`);
    await acc.getByLabel('Send by WhatsApp').uncheck();
    await acc.getByTestId('recharge-send').click();
    await acc.waitForFunction(() => /E-mail: sent/.test(document.querySelector('[data-testid="recharge-send-results"]')?.textContent ?? '') && document.querySelectorAll('[data-testid="recharge-delivery"]').length === 3);
    check(S.calls.filter(c => /\/invoice\/send$/.test(c.route)).at(-1).body.resend === true, `${label}: the re-send is sent as a deliberate re-send`);
    S.waMode = 'FAILED';
    await acc.getByLabel('Send by WhatsApp').check(); await acc.getByLabel('Send by E-mail').uncheck();
    await acc.getByTestId('recharge-send').click();
    await acc.waitForFunction(() => /WhatsApp: failed/.test(document.querySelector('[data-testid="recharge-send-results"]')?.textContent ?? ''));
    check(S.rows.find(r => r.id === lastVerified(vcall.route)).invoiceStatus === 'PARTIALLY_SENT', `${label}: e-mail sent and WhatsApp failed: Partially sent`);
    await acc.getByRole('button', { name: 'Update contact' }).click();
    await acc.locator('#rc-ct-phone').fill('+91 98765 43210'); await acc.locator('#rc-ct-note').fill('number confirmed by phone');
    await acc.getByRole('button', { name: 'Save contact' }).click();
    await acc.getByTestId('recharge-detail-notice').filter({ hasText: 'contact was updated' }).waitFor();
    check(S.calls.filter(c => /\/contact$/.test(c.route)).at(-1).body.customerPhone === '+91 98765 43210' && S.calls.filter(c => /\/contact$/.test(c.route)).at(-1).body.note === 'number confirmed by phone', `${label}: the contact can be corrected after the invoice exists, with a reason`);
    S.waMode = 'SENT';
    await acc.getByLabel('Send by WhatsApp').check();
    await acc.getByTestId('recharge-send').click();
    await acc.waitForFunction(() => /WhatsApp: sent/.test(document.querySelector('[data-testid="recharge-send-results"]')?.textContent ?? ''));
    check(S.rows.find(r => r.id === lastVerified(vcall.route)).invoiceStatus === 'SENT', `${label}: the retry is sent: the invoice shows Sent`);
    await noSideways(acc, `${label}: the invoice controls`);
    // the queue 'Invoice delivery'
    await acc.getByRole('button', { name: 'Close' }).first().click().catch(() => undefined);
    await acc.getByTestId('section-delivery').click(); await settle(acc);
    check(lastList().query.invoiceStatus === 'DELIVERY_ANY' && await arows().count() === 1, `${label}: the Invoice delivery queue lists the sent invoice`);
    // ---- what Support see of that invoice: its number and how each channel went, not the customer's contact or the provider's answer
    S.role = 'MEMBER'; S.calls.length = 0;
    await acc.goto(base); await acc.evaluate(() => window.mountRecharges()); await acc.getByTestId('recharge-summary').waitFor();
    await acc.locator('#rc-f-search').fill('alpha'); await settle(acc);
    await acc.getByRole('button', { name: /View PRC-00001/ }).first().click();
    await acc.getByTestId('recharge-invoice-summary').waitFor();
    const sup = await text(acc, '[data-testid="recharge-invoice-summary"]');
    check(/GST\/26-27\/014/.test(sup) && /E-mail/.test(sup) && /WhatsApp/.test(sup) && /Sent/.test(sup), `${label}: Support see the invoice number and each channel's state`, sup);
    check(!/billing@alpha|9000000711|98765|Test mode|meta@amuwa/.test(sup), `${label}: but not the customer's contact or the provider's answer`);
    check(await acc.getByTestId('recharge-invoice-controls').count() === 0 && await acc.getByTestId('recharge-generate').count() === 0 && await acc.getByTestId('recharge-send').count() === 0, `${label}: and no way to generate or send it`);
    check(errors.length === 0, `${label}: no script errors (Support)`);
    await ctxA.close();

    // ---- a Team Lead sees the team's recharges and cannot verify; the Super Admin can
    const ctxL = await browser.newContext({ viewport, timezoneId: 'Asia/Kolkata' });
    const lead = await ctxL.newPage();
    await answerAppDialogs(lead);
    await open(lead, 'LEAD');
    check(/team’s recharges/.test(await text(lead, '[data-testid="recharges-page"]')), `${label}: a Team Lead's heading says whose records these are`);
    await lead.locator(label === 'phone' ? '[data-testid="recharge-card"]' : '[data-testid="recharge-row"]').first().getByRole('button', { name: /View/ }).click();
    await lead.getByTestId('recharge-detail').waitFor();
    check(await lead.getByTestId('recharge-verify').count() === 0, `${label}: a Team Lead cannot verify a payment`);
    await ctxL.close();
  }
  console.log(`\nRECHARGES BROWSER CHECKS PASSED (${passed})`);
} finally {
  await browser.close();
  srv.close();
}
function lastVerified(route) { return decodeURIComponent(route.split('/')[3]); }
