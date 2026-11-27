// Browser test of the Support Recharges screen (20270228000200): the Panel Recharge and Message Recharge tabs (separate records, summaries and filters), the
// six summary cards, search / status / date / amount filters, pagination, the empty / loading-failure states, creating a recharge with its payment screenshot
// (type, size and content checks, the total, the double click), editing, viewing the screenshot through a short-lived link, the status change (only when the
// database offers it), a person who may not record, and the layout at phone and desktop width (no sideways scrolling, the dialog's buttons reachable).
// The server is a stand-in with synthetic data that follows the database's rules; the real rules are tested in supabase/tests/support_recharges_test.sql.
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
const mk = (i, kind, name, gst, non, status, ago, by = 'Meena Support') => ({
  id: `r-${kind}-${i}`, reference: `${kind === 'PANEL' ? 'PRC' : 'MRC'}-${String(i).padStart(5, '0')}`, kind, customerName: name, rechargeDate: daysAgo(ago), gstAmount: gst, gstDetails: gst ? '18% GST' : null,
  nonGstAmount: non, nonGstDetails: null, totalAmount: Math.round((gst + non) * 100) / 100, status, remarks: null, statusNote: null, statusAt: null, statusByName: null, createdById: by === 'Meena Support' ? 'me' : 'other',
  createdByName: by, teamName: 'Support A', createdAt: new Date(Date.now() - ago * 86400000).toISOString(), updatedAt: new Date().toISOString(),
  screenshot: { id: `f-${kind}-${i}`, name: `proof-${i}.png`, mime: 'image/png', size: 2048 }
});
const seed = () => {
  const rows = [];
  rows.push(mk(1, 'PANEL', 'Alpha Traders', 118, 500.5, 'PENDING', 1), mk(2, 'PANEL', 'Beta Stores 50% off', 1000, 0, 'COMPLETED', 4), mk(3, 'PANEL', 'Gamma Foods', 0, 250, 'VERIFIED', 8), mk(4, 'PANEL', 'Delta Agro', 59, 100, 'REJECTED', 12, 'Rohit Support'));
  for (let i = 5; i <= 27; i++) rows.push(mk(i, 'PANEL', `Bulk Customer ${i}`, 0, 100 + i, 'PENDING', 15 + i));
  rows.push(mk(1, 'MESSAGE', 'Omega Clinic', 0, 300, 'PENDING', 2), mk(2, 'MESSAGE', 'Sigma Salon', 36, 200, 'COMPLETED', 6));
  return rows;
};
const S = { role: 'MEMBER', rows: seed(), fail: false, calls: [], uploads: {}, names: {}, nextRef: 900, canCreate: true };
const canEdit = r => (S.role === 'SUPER_ADMIN' ? true : S.role === 'MEMBER' ? r.createdById === 'me' && ['PENDING', 'REJECTED'].includes(r.status) : r.status !== 'COMPLETED');
const nextStatuses = r => {
  if (S.role === 'MEMBER' || r.createdById === 'me' && S.role !== 'SUPER_ADMIN') return [];
  if (S.role === 'SUPER_ADMIN') return ['PENDING', 'VERIFIED', 'COMPLETED', 'REJECTED'].filter(x => x !== r.status);
  return { PENDING: ['VERIFIED', 'COMPLETED', 'REJECTED'], VERIFIED: ['COMPLETED', 'REJECTED', 'PENDING'], REJECTED: ['PENDING'], COMPLETED: [] }[r.status];
};
const view = r => ({ ...r, canEdit: canEdit(r), nextStatuses: nextStatuses(r) });
const visible = r => S.role === 'MEMBER' ? r.createdById === 'me' : true;
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
    const inScope = S.rows.filter(r => r.kind === q.kind && visible(r));
    const base = inScope.filter(r => (!q.search || r.customerName.toLowerCase().includes(q.search.toLowerCase())) && (!q.from || r.rechargeDate >= q.from) && (!q.to || r.rechargeDate <= q.to)
      && (q.min === undefined || r.totalAmount >= Number(q.min)) && (q.max === undefined || r.totalAmount <= Number(q.max)));
    const rows = base.filter(r => !q.status || r.status === q.status).sort((a, c) => c.rechargeDate.localeCompare(a.rechargeDate) || c.createdAt.localeCompare(a.createdAt));
    const limit = Number(q.limit ?? 20), offset = Number(q.offset ?? 0);
    const sum = (f, k) => Math.round(base.filter(f).reduce((s, r) => s + r[k], 0) * 100) / 100;
    return ok(res, { items: rows.slice(offset, offset + limit).map(view), total: rows.length, limit, offset, role: S.role, canCreate: S.canCreate,
      summary: { totalRecharges: base.length, totalAmount: sum(() => true, 'totalAmount'), totalGst: sum(() => true, 'gstAmount'), totalNonGst: sum(() => true, 'nonGstAmount'),
        pending: base.filter(r => r.status === 'PENDING').length, verified: base.filter(r => r.status === 'VERIFIED').length, completed: base.filter(r => r.status === 'COMPLETED').length, rejected: base.filter(r => r.status === 'REJECTED').length } });
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
    if (b.gstAmount + b.nonGstAmount <= 0) return bad(res, 'Enter the GST amount, the non-GST amount or both (the total must be above zero).');
    if (!b.screenshotId) return bad(res, 'Upload the screenshot of the payment.');
    const r = mk(S.nextRef++, b.kind, b.customerName, b.gstAmount, b.nonGstAmount, 'PENDING', 0);
    Object.assign(r, { gstDetails: b.gstDetails, nonGstDetails: b.nonGstDetails, remarks: b.remarks, rechargeDate: b.rechargeDate, screenshot: { id: b.screenshotId, name: 'x.png', mime: 'image/png', size: 2048 } });
    S.rows.push(r);
    return ok(res, view(r), 201);
  }
  if ((m = route.match(/^\/support\/recharges\/([^/]+)$/)) && req.method === 'GET') {
    const r = S.rows.find(x => x.id === m[1] && visible(x));
    return r ? ok(res, view(r)) : bad(res, 'Recharge not found.', 404, 'NOT_FOUND');
  }
  if ((m = route.match(/^\/support\/recharges\/([^/]+)\/update$/))) {
    const r = S.rows.find(x => x.id === m[1] && visible(x));
    if (!r) return bad(res, 'Recharge not found.', 404, 'NOT_FOUND');
    if (!canEdit(r)) return bad(res, 'This recharge can no longer be edited by you.', 403, 'FORBIDDEN');
    Object.assign(r, { customerName: b.customerName, gstAmount: b.gstAmount, nonGstAmount: b.nonGstAmount, totalAmount: Math.round((b.gstAmount + b.nonGstAmount) * 100) / 100, remarks: b.remarks, status: r.status === 'REJECTED' && r.createdById === 'me' ? 'PENDING' : r.status });
    return ok(res, view(r));
  }
  if ((m = route.match(/^\/support\/recharges\/([^/]+)\/status$/))) {
    const r = S.rows.find(x => x.id === m[1] && visible(x));
    if (!r) return bad(res, 'Recharge not found.', 404, 'NOT_FOUND');
    if (!nextStatuses(r).includes(b.status)) return bad(res, `You cannot move this recharge from ${r.status} to ${b.status}.`, 403, 'FORBIDDEN');
    if (b.status === 'REJECTED' && (b.note ?? '').length < 3) return bad(res, 'Say why the recharge is rejected.');
    Object.assign(r, { status: b.status, statusNote: b.note, statusByName: 'Lead Person', statusAt: new Date().toISOString() });
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
// the checks of a file happen asynchronously: wait for the message instead of guessing a time
const dialogSays = async (page, re) => { await page.waitForFunction(src => new RegExp(src).test(document.querySelector('[role="dialog"]')?.textContent ?? ''), re.source, { timeout: 5000 }).catch(() => undefined); return re.test(await text(page, '[role="dialog"]')); };
const noSideways = async (page, what) => check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${what}: no sideways scrolling`, await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
const reset = (role = 'MEMBER') => { S.nextRef = 900; S.role = role; S.rows = seed(); S.fail = false; S.calls.length = 0; S.canCreate = role !== 'SUPER_ADMIN'; };
const open = async (page, role) => { reset(role); await page.goto(base); await page.evaluate(() => window.mountRecharges()); await page.getByTestId('recharge-summary').waitFor(); await page.waitForFunction(() => !document.querySelector('[data-testid="stat-total"]')?.textContent?.includes('–')); };
const setFile = (page, name, mimeType, buffer) => page.getByTestId('recharge-file').setInputFiles({ name, mimeType, buffer });

try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 780 }]]) {
    const ctx = await browser.newContext({ viewport, timezoneId: 'Asia/Kolkata', hasTouch: label === 'phone', isMobile: label === 'phone' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await answerAppDialogs(page);
    const rows = () => page.locator(label === 'phone' ? '[data-testid="recharge-card"]' : '[data-testid="recharge-row"]');

    // ---- member: the Panel tab
    await open(page, 'MEMBER');
    check(await page.getByTestId('tab-PANEL').getAttribute('aria-selected') === 'true', `${label}: the Panel Recharge tab opens first`);
    check((await page.locator('[role="tab"]').allInnerTexts()).map(t => t.trim()).join('|') === 'Panel Recharge|Message Recharge', `${label}: two tabs`);
    check(lastList().query.kind === 'PANEL', `${label}: the list asks for Panel recharges only`);
    // 27 Panel recharges, 26 of them the member's own (r-PANEL-4 belongs to another person)
    check(await text(page, '[data-testid="stat-total"]') === 'Total recharges 26', `${label}: total recharges`, await text(page, '[data-testid="stat-total"]'));
    check(/Pending 24/.test(await text(page, '[data-testid="stat-pending"]')) && /Completed 1/.test(await text(page, '[data-testid="stat-completed"]')), `${label}: pending and completed`);
    check(/Total GST ₹1,118/.test(await text(page, '[data-testid="stat-gst"]')), `${label}: total GST`, await text(page, '[data-testid="stat-gst"]'));
    check(await rows().count() === 20, `${label}: the first page has 20 rows`);
    check(/Showing 1–20 of 26 recharges/.test(await text(page, 'body')), `${label}: the pager says 26 recharges`);
    check(!(await page.getByText('Recorded by').first().isVisible().catch(() => false)) || label === 'phone', `${label}: a member does not see a "recorded by" column`);
    await noSideways(page, `${label}: the list`);

    // ---- pagination
    await page.getByRole('button', { name: 'Next page' }).click(); await settle(page);
    check(lastList().query.offset === '20' && await rows().count() === 6, `${label}: page 2 asks for offset 20 and shows the last 6`, lastList().query);
    await page.getByRole('button', { name: 'Previous page' }).click(); await settle(page);

    // ---- filters
    await page.locator('#rc-f-search').fill('alpha'); await settle(page);
    check(lastList().query.search === 'alpha' && await rows().count() === 1 && /Alpha Traders/.test(await text(page, 'main, body')), `${label}: search by customer name`);
    check(await text(page, '[data-testid="stat-total"]') === 'Total recharges 1', `${label}: the cards follow the search`);
    await page.locator('#rc-f-search').fill('zzzz'); await settle(page);
    check(await page.getByTestId('recharge-empty').isVisible() && /No recharges match these filters/.test(await text(page, '[data-testid="recharge-empty"]')), `${label}: the empty state for a search with no match`);
    await page.getByRole('button', { name: 'Clear filters' }).click(); await settle(page);
    check(await page.locator('#rc-f-search').inputValue() === '' && await rows().count() === 20, `${label}: Clear filters`);
    await page.locator('#rc-f-status').selectOption('COMPLETED'); await settle(page);
    check(lastList().query.status === 'COMPLETED' && await rows().count() === 1, `${label}: status filter`);
    check(await text(page, '[data-testid="stat-total"]') === 'Total recharges 26', `${label}: the cards still show every status`);
    await page.locator('#rc-f-status').selectOption(''); await settle(page);
    await page.locator('#rc-f-min').fill('500'); await page.locator('#rc-f-max').fill('700'); await settle(page);
    check(lastList().query.min === '500' && lastList().query.max === '700' && await rows().count() === 1, `${label}: amount filter (only 618.50 is between 500 and 700)`, await rows().count());
    await page.locator('#rc-f-min').fill(''); await page.locator('#rc-f-max').fill(''); await settle(page);
    await page.locator('#rc-f-from').fill(daysAgo(5)); await settle(page);
    check(lastList().query.from === daysAgo(5) && await rows().count() === 2, `${label}: date from filter`, await rows().count());
    await page.locator('#rc-f-to').fill(daysAgo(2)); await settle(page);
    check(lastList().query.to === daysAgo(2) && await rows().count() === 1, `${label}: date from / to filter`, await rows().count());
    await page.getByRole('button', { name: 'Clear filters' }).click(); await settle(page);

    // ---- the Message tab is separate
    await page.locator('#rc-f-search').fill('alpha'); await settle(page);
    await page.getByTestId('tab-MESSAGE').click(); await settle(page);
    check(lastList().query.kind === 'MESSAGE' && await rows().count() === 2, `${label}: the Message tab lists Message recharges only`);
    check(await page.locator('#rc-f-search').inputValue() === '' , `${label}: the Message tab has its own filters`);
    check(await text(page, '[data-testid="stat-total"]') === 'Total recharges 2' && /Total non-GST ₹500/.test(await text(page, '[data-testid="stat-non-gst"]')), `${label}: the Message summary is its own`);
    check(!/Alpha Traders/.test(await text(page, '#rc-panel')), `${label}: no Panel record on the Message tab`);
    await page.getByTestId('tab-PANEL').click(); await settle(page);
    check(await page.locator('#rc-f-search').inputValue() === 'alpha', `${label}: the Panel tab kept its own filter`);
    await page.getByRole('button', { name: 'Clear filters' }).click(); await settle(page);

    // ---- a failed load, then a retry
    S.fail = true; await page.getByTestId('tab-MESSAGE').click(); await settle(page); await page.getByTestId('tab-PANEL').click(); await settle(page);
    await page.locator('#rc-f-search').fill('b'); await settle(page);
    check(await page.getByRole('alert').first().isVisible() && /could not be loaded/.test(await text(page, '[role="alert"]')), `${label}: a failed load shows an error`);
    S.fail = false; await page.getByRole('button', { name: 'Retry' }).click(); await settle(page);
    check(!(await page.getByRole('alert').count()) && await rows().count() > 0, `${label}: Retry loads the records`);
    await page.getByRole('button', { name: 'Clear filters' }).click(); await settle(page);

    // ---- the create form
    await page.getByRole('button', { name: /Create Panel Recharge/ }).click();
    await page.getByTestId('recharge-form').waitFor();
    check(await page.locator('[role="dialog"]').getAttribute('aria-modal') === 'true', `${label}: the form is a dialog`);
    const dlg = await page.locator('[role="dialog"]').boundingBox();
    check(dlg.width <= viewport.width + 0.5 && dlg.x >= -0.5 && dlg.y >= -0.5 && dlg.y + dlg.height <= viewport.height + 0.5, `${label}: the form fits inside the screen`, dlg);
    await noSideways(page, `${label}: the form`);
    await page.getByRole('button', { name: 'Create recharge' }).scrollIntoViewIfNeeded();
    check(await page.getByRole('button', { name: 'Create recharge' }).isVisible(), `${label}: the Create button is reachable by scrolling the form`);
    await page.getByRole('button', { name: 'Create recharge' }).click();
    check(/Enter the customer name/.test(await text(page, '[role="dialog"]')) && /Upload the screenshot/.test(await text(page, '[role="dialog"]')), `${label}: an empty form shows what is missing`);
    check(!S.calls.some(c => c.method === 'POST' && c.route === '/support/recharges'), `${label}: nothing is sent while the form is invalid`);
    await page.locator('#rc-gst').fill('abc!@#'); check(await page.locator('#rc-gst').inputValue() === '', `${label}: letters and symbols cannot be typed in an amount`);
    await page.locator('#rc-gst').fill('118.456'); check(await page.locator('#rc-gst').inputValue() === '118.45', `${label}: at most two decimals are kept`);
    await page.locator('#rc-gst').fill('118'); await page.locator('#rc-non').fill('500.50');
    check(/₹618\.50/.test(await text(page, '[data-testid="recharge-total"]')), `${label}: the total is GST + non-GST`, await text(page, '[data-testid="recharge-total"]'));
    await page.locator('#rc-name').fill('Zeta Mart');
    await setFile(page, 'proof.gif', 'image/gif', Buffer.from('GIF89a'));
    check(await dialogSays(page, /image \(PNG, JPEG or WebP\) or a PDF/), `${label}: a GIF is refused as proof`);
    await setFile(page, 'proof.png', 'image/png', Buffer.alloc(5 * 1024 * 1024 + 10, 1));
    check(await dialogSays(page, /larger than 5 MB/), `${label}: a file over 5 MB is refused`);
    await setFile(page, 'fake.png', 'image/png', Buffer.from('this is not a png'));
    check(await dialogSays(page, /not a real PNG/), `${label}: a text file renamed .png is refused`);
    check(!S.calls.some(c => c.route === '/support/recharge-uploads'), `${label}: refused files are never uploaded`);
    await setFile(page, 'proof.png', 'image/png', PNG);
    await page.getByRole('button', { name: /Replace screenshot/ }).waitFor();
    check(/proof\.png/.test(await text(page, '[role="dialog"]')) && Object.values(S.uploads).some(n => n === 1), `${label}: the screenshot is uploaded straight to storage (one PUT)`);
    await page.locator('#rc-rem').fill('paid by UPI');
    await page.getByRole('button', { name: 'Create recharge' }).dblclick();
    await page.getByTestId('recharge-notice').waitFor();
    const posts = S.calls.filter(c => c.method === 'POST' && c.route === '/support/recharges');
    check(posts.length === 1, `${label}: a double click creates one recharge`, posts.length);
    const sent = posts[0].body;
    check(sent.kind === 'PANEL' && sent.customerName === 'Zeta Mart' && sent.gstAmount === 118 && sent.nonGstAmount === 500.5 && sent.totalAmount === 618.5 && /^[0-9a-f-]{36}$/.test(sent.screenshotId) && sent.rechargeDate === daysAgo(0), `${label}: the request body`, sent);
    check(!('departmentId' in sent) && !('createdBy' in sent) && !('status' in sent), `${label}: the request names no department, owner or status`);
    check(/PRC-00900 was created/.test(await text(page, '[data-testid="recharge-notice"]')) && !(await page.locator('[role="dialog"]').count()), `${label}: success message, the form closes`);
    await settle(page);
    check(await text(page, '[data-testid="stat-total"]') === 'Total recharges 27', `${label}: the list and cards reload`);

    // ---- view the screenshot, edit, no status control for a member
    await page.locator('#rc-f-search').fill('zeta'); await settle(page);
    await rows().first().getByRole('button', { name: /View PRC-00900/ }).click();
    await page.getByTestId('recharge-detail').waitFor();
    await page.getByTestId('recharge-shot').waitFor();
    const src = await page.locator('[data-testid="recharge-shot"] img').getAttribute('src');
    check(/\/__img\//.test(src) && !/public/.test(src), `${label}: the screenshot comes through a link issued for it`, src);
    check(S.calls.some(c => /\/support\/recharge-files\/.+\/url/.test(c.route)), `${label}: the link was asked for when the screenshot was opened`);
    check(await page.getByRole('group', { name: 'Change the status' }).count() === 0, `${label}: a member has no status control`);
    await noSideways(page, `${label}: the detail`);
    const imgBox = await page.locator('[data-testid="recharge-shot"] img').boundingBox();
    check(imgBox.width <= viewport.width && imgBox.height <= viewport.height, `${label}: the screenshot preview fits the screen`, imgBox);
    await page.getByTestId('recharge-detail').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByTestId('recharge-form').waitFor();
    check(await page.locator('#rc-name').inputValue() === 'Zeta Mart' && await page.locator('#rc-gst').inputValue() === '118', `${label}: editing starts from the saved values`);
    await page.locator('#rc-name').fill('Zeta Mart Two');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByText(/PRC-00900 was updated/).waitFor();
    check(S.calls.some(c => /\/support\/recharges\/.+\/update$/.test(c.route)), `${label}: the edit is saved`);
    await page.locator('#rc-f-search').fill(''); await settle(page);
    // another person's record cannot be edited by a member
    await page.getByTestId('tab-PANEL').click();
    check(await page.getByRole('button', { name: /Edit PRC-00002/ }).count() === 0, `${label}: a member sees no Edit on a Completed recharge`);

    check(errors.length === 0, `${label}: no script errors`, errors);
    await ctx.close();

    // ---- team lead: sees everyone's, changes statuses
    const ctx2 = await browser.newContext({ viewport, timezoneId: 'Asia/Kolkata', hasTouch: label === 'phone', isMobile: label === 'phone' });
    const lead = await ctx2.newPage();
    await answerAppDialogs(lead);
    await open(lead, 'LEAD');
    check(await text(lead, '[data-testid="stat-total"]') === 'Total recharges 27', `${label}: a Team Lead sees the team's recharges`);
    check(/team’s recharges/.test(await text(lead, '[data-testid="recharges-page"]')), `${label}: the heading says whose records these are`);
    const leadRows = lead.locator(label === 'phone' ? '[data-testid="recharge-card"]' : '[data-testid="recharge-row"]');
    await lead.locator('#rc-f-search').fill('delta'); await lead.waitForTimeout(450);
    await leadRows.first().getByRole('button', { name: /View PRC-00004/ }).click();
    await lead.getByRole('group', { name: 'Change the status' }).waitFor();
    check((await lead.locator('select[aria-label="New status"] option').allInnerTexts()).join('|') === 'Choose…|Pending', `${label}: a Rejected recharge can only go back to Pending`);
    await lead.locator('select[aria-label="New status"]').selectOption('PENDING');
    await lead.getByRole('button', { name: 'Update status' }).click();
    await lead.waitForFunction(() => /Pending/.test(document.querySelector('[data-testid="recharge-detail"]')?.textContent ?? ''));
    check(S.rows.find(r => r.id === 'r-PANEL-4').status === 'PENDING', `${label}: the status is changed on the server`);
    await lead.locator('select[aria-label="New status"]').selectOption('REJECTED');
    await lead.getByRole('button', { name: 'Update status' }).click();
    await lead.getByRole('alert').waitFor();
    check(/Say why the recharge is rejected/.test(await text(lead, '[role="alert"]')), `${label}: rejecting without a reason shows the server's message`);
    await lead.locator('input[aria-label="Note"]').fill('amount does not match the bank');
    await lead.getByRole('button', { name: 'Update status' }).click();
    await lead.waitForFunction(() => /Rejected/.test(document.querySelector('[data-testid="recharge-detail"]')?.textContent ?? ''));
    check(S.rows.find(r => r.id === 'r-PANEL-4').statusNote === 'amount does not match the bank', `${label}: the reason is saved with the status`);
    await ctx2.close();

    // ---- Super Admin: reads and reviews, does not record
    const ctx3 = await browser.newContext({ viewport, timezoneId: 'Asia/Kolkata' });
    const sa = await ctx3.newPage();
    await answerAppDialogs(sa);
    await open(sa, 'SUPER_ADMIN');
    check(await sa.getByRole('button', { name: /Create/ }).count() === 0, `${label}: the Super Admin has no Create button`);
    await ctx3.close();
  }
  console.log(`\nRECHARGES BROWSER CHECKS PASSED (${passed})`);
} finally {
  await browser.close();
  srv.close();
}
