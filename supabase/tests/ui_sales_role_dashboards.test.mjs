// Browser test of the Sales Department Head role-wise sections (20270117000300): the Telecaller and Business Associate lists (figures, filters
// sent to the server, sort, pages, CSV export, empty state) and one person's dashboard (figures, daily / weekly / monthly, records, Crocodial only
// when connected), at desktop and phone width. The API is a fake: who is listed and every figure are decided by the database.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Sales role sections browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/sales_role_dashboards_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

// ---- the fake API -----------------------------------------------------------------------------------------------------------------------
const ASHA = '11111111-1111-4111-8111-111111111111';
const BINA = '22222222-2222-4222-8222-222222222222';
let state;
const reset = () => { state = { empty: false, calls: [] }; };
reset();
const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
const fail = (res, status, code, message) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: { code, message } })); };
const NULL_CALLS = { calls: null, connected: null, notConnected: null, connectRate: null, uniqueNumbers: null, talkSeconds: null };
const tcMetrics = (i) => (i === 1
  ? { crocodial: 'OFF', ...NULL_CALLS, leadsCreated: 0, convertedLeads: 0 }
  : { crocodial: 'ON', calls: i === 0 ? 120 : i, connected: i === 0 ? 60 : 0, notConnected: i === 0 ? 50 : i, connectRate: i === 0 ? 50 : 0, uniqueNumbers: i === 0 ? 80 : i,
      talkSeconds: i === 0 ? 3600 : 0, leadsCreated: i === 0 ? 4 : 0, convertedLeads: i === 0 ? 2 : 0 });
const baMetrics = { crocodial: 'OFF', ...NULL_CALLS, leadsAssigned: 5, demosScheduled: 3, demosCompleted: 2, demosCancelled: 1, demosUpcoming: 1, quotations: 2, dealsClosed: 1, dealValue: 125000 };
const row = (id, name, code, status, metrics) => ({ id, name, email: `${name.toLowerCase()}@x.in`, phone: '9800000000', employeeCode: code, status, teamId: 't', teamName: 'Sales A',
  teamLeadId: 'l1', teamLeadName: 'Lead Lata', metrics });
const ALL = {
  TELECALLER: Array.from({ length: 30 }, (_, i) => row(i === 0 ? ASHA : `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, i === 0 ? 'Asha' : `Caller ${i}`, `EMP-${1000 + i}`,
    i === 2 ? 'SUSPENDED' : 'ACTIVE', tcMetrics(i))),
  BUSINESS_ASSOCIATE: [row(BINA, 'Bina', 'EMP-2000', 'ACTIVE', baMetrics)]
};
const daysBetween = (from, to) => { const out = []; for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; };
function list(role, q) {
  const s = (q.get('search') || '').toLowerCase(), page = Number(q.get('page') || 1), size = Number(q.get('pageSize') || 25);
  const hit = state.empty ? [] : ALL[role].filter(p => (!s || p.name.toLowerCase().includes(s) || p.employeeCode.toLowerCase().includes(s)) && (!q.get('status') || p.status === q.get('status')));
  return { role, from: q.get('from'), to: q.get('to'), total: hit.length, page, pageSize: size, teamLeads: [{ id: 'l1', name: 'Lead Lata' }], items: hit.slice((page - 1) * size, page * size) };
}
function person(role, id, q) {
  const p = ALL[role].find(x => x.id === id);
  const on = p.metrics.crocodial === 'ON';
  const days = daysBetween(q.get('from'), q.get('to'));
  const daily = days.map((day, i) => (role === 'TELECALLER'
    ? { day, calls: on ? (i % 2 ? 4 : 0) : null, connected: on ? (i % 2 ? 2 : 0) : null, leads: i === 0 ? 1 : 0, converted: 0 }
    : { day, assigned: 1, demos: 0, demosCompleted: 0, deals: 0 }));
  const calls = on ? [
    { id: 1, callAt: '2026-11-19T10:00:00+05:30', type: 'outgoing', connected: true, durationSeconds: 65, contactName: 'Ravi Patel', phone: 'XXXXXX1111', leadStatus: 'Interested' },
    { id: 2, callAt: '2026-11-19T09:00:00+05:30', type: 'outgoing', connected: false, durationSeconds: 0, contactName: 'Kiran', phone: 'XXXXXX2222', leadStatus: null },
    { id: 3, callAt: '2026-11-19T08:00:00+05:30', type: 'outgoing', connected: null, durationSeconds: null, contactName: null, phone: 'XXXXXX3333', leadStatus: null }] : [];
  const records = role === 'TELECALLER'
    ? { calls, leads: [{ id: 'l1', name: 'Meera Shah', company: null, stage: 'LEAD', leadStatus: 'INTERESTED', convertedTo: 'Bina', createdAt: '2026-11-18T10:00:00+05:30' }] }
    : { calls, contacts: [{ id: 'b1', name: 'Meera Shah', company: 'Shah Co', stage: 'DEMO_SCHEDULED', assignedAt: '2026-11-18T10:00:00+05:30', telecaller: 'Asha' }],
        demos: [], quotations: [{ id: 'q1', number: 'Q-1', revision: 2, client: 'Meera Shah', total: 50000, finalizedAt: '2026-11-19T10:00:00+05:30' }],
        deals: [{ id: 'l1', name: 'Meera Shah', company: 'Shah Co', stage: 'ONBOARDING', dealAmount: 125000, closedAt: '2026-11-19T10:00:00+05:30' }] };
  return { role, from: q.get('from'), to: q.get('to'), person: { ...p, joinedAt: '2026-01-05T10:00:00Z' }, metrics: p.metrics,
    crocodial: { state: p.metrics.crocodial, lastSyncAt: on ? '2026-11-20T10:00:00+05:30' : null, stale: false }, daily, records };
}
function api(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/^\/api\/v1/, '');
  state.calls.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization || null });
  const m = p.match(/^\/sales-head\/roles\/(telecaller|business-associate)\/people(?:\/([^/]+))?$/);
  if (m) {
    const role = m[1] === 'telecaller' ? 'TELECALLER' : 'BUSINESS_ASSOCIATE';
    if (!m[2]) return ok(res, list(role, u.searchParams));
    if (!ALL[role].some(x => x.id === m[2])) return fail(res, 404, 'NOT_FOUND', 'This person is not in your Sales teams.');
    return ok(res, person(role, m[2], u.searchParams));
  }
  fail(res, 404, 'NOT_FOUND', 'no fake');
}
const srv = createServer((req, res) => {
  if (req.url.startsWith('/api/v1/')) return api(req, res);
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
const last = p => [...state.calls].reverse().find(c => c.path === p);
const LIST = '/sales-head/roles/telecaller/people';
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport, timezoneId: 'Asia/Kolkata', acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    reset();
    await page.goto(base);
    await page.evaluate(() => window.mount('TELECALLER'));
    await page.getByTestId('role-list-TELECALLER').waitFor();
    await page.getByRole('heading', { name: 'Telecaller List' }).waitFor();
    await page.getByRole('button', { name: "Open Asha's dashboard" }).waitFor();
    check(last(LIST).auth === 'Bearer test-token' && last(LIST).query.pageSize === '25', `${label}: read with the head's session, 25 a page`, last(LIST));
    check((new Date(last(LIST).query.to) - new Date(last(LIST).query.from)) / 86400000 === 29, `${label}: the last 30 days by default`, last(LIST).query);
    const asha = page.getByRole('row', { name: /Asha/ });
    check(await asha.getByText('EMP-1000').isVisible() && await asha.getByText('Lead Lata').isVisible() && await asha.getByText('120', { exact: true }).isVisible()
      && await asha.getByText('1 h 0 min').isVisible(), `${label}: a row has the Employee ID, Team Lead and the Crocodial call figures`);
    const heads = (await page.locator('thead th').allTextContents()).map(t => t.trim());
    check(heads.join('|') === 'Name|Employee ID|Team Lead|Total callsCrocodial|ConnectedCrocodial|Not connectedCrocodial|Unique numbersCrocodial|Talk timeCrocodial|Leads created|Converted|Status',
      `${label}: the columns: the five Crocodial call figures (marked), then two CRM figures`, heads);
    check(await page.getByRole('row', { name: /Caller 1\b/ }).getByText('Not connected to Crocodial').isVisible(), `${label}: someone not connected to Crocodial: one cell saying so, no zeros`);
    check(await page.getByRole('row', { name: /Caller 2\b/ }).getByText('Suspended').isVisible(), `${label}: the account status`);
    check(await page.getByText('Page 1 of 2').isVisible(), `${label}: 30 people, two pages`);
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.getByText('Page 2 of 2').waitFor();
    check(last(LIST).query.page === '2', `${label}: the next page is asked from the server`);
    await page.getByLabel('Name or Employee ID', { exact: true }).fill('emp-1000');
    await page.waitForTimeout(700);
    check(last(LIST).query.search === 'emp-1000' && last(LIST).query.page === '1', `${label}: search by Employee ID, back to page 1`, last(LIST).query);
    await page.getByLabel('Name or Employee ID', { exact: true }).fill('');
    await page.getByLabel('Team Lead', { exact: true }).selectOption('l1');
    await page.getByLabel('Status', { exact: true }).selectOption('SUSPENDED');
    await page.getByLabel('Sort by', { exact: true }).selectOption('calls');
    await page.waitForTimeout(700);
    const q = last(LIST).query;
    check(q.teamLeadId === 'l1' && q.status === 'SUSPENDED' && q.sort === 'calls', `${label}: Team Lead, status and sort are sent to the server`, q);
    await page.getByLabel('Status', { exact: true }).selectOption('');
    await page.getByRole('button', { name: 'Last 7 days' }).click();
    await page.waitForTimeout(400);
    check((new Date(last(LIST).query.to) - new Date(last(LIST).query.from)) / 86400000 === 6, `${label}: the date range`);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
    const text = readFileSync(await download.path(), 'utf8');
    check(download.suggestedFilename().startsWith('Telecaller list ') && text.includes('Employee ID') && text.split('\r\n').length === 31 && last(LIST).query.pageSize === '500',
      `${label}: the CSV export has every matching row (asked in one go)`, download.suggestedFilename());
    check(errors.length === 0, `${label}: no script errors (list)`, errors);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: the page does not scroll sideways (the table scrolls in its box)`);

    // one Telecaller's dashboard
    await page.getByRole('button', { name: "Open Asha's dashboard" }).click();
    await page.getByTestId('role-person-TELECALLER').waitFor();
    check(last(`${LIST}/${ASHA}`) !== undefined && await page.getByRole('heading', { name: /Asha/ }).isVisible() && await page.getByText('EMP-1000').isVisible(), `${label}: the dashboard opens with their details`);
    check(await page.getByTestId('metric-calls').textContent() === '120' && await page.getByTestId('metric-notConnected').textContent() === '50'
      && await page.getByTestId('metric-uniqueNumbers').textContent() === '80' && await page.getByTestId('metric-connectRate').textContent() === '50%'
      && await page.getByTestId('metric-leadsCreated').textContent() === '4', `${label}: the Crocodial call figures and the CRM lead figures`);
    check(await page.getByText(/source: Crocodial, last synced/).isVisible() && await page.getByText(/source: CRM/).isVisible(), `${label}: each group says where it comes from`);
    check(!(await page.getByTestId('metric-totalCalls').count()) && !(await page.getByText('Contacts called').count()) && !(await page.getByText(/Reach rate|Follow-ups due/).count()),
      `${label}: no call counters made up from CRM fields`);
    const dayRows = await page.getByRole('table').first().locator('tbody tr').count();
    await page.getByRole('tab', { name: 'Weekly' }).click();
    const weekRows = await page.getByRole('table').first().locator('tbody tr').count();
    await page.getByRole('tab', { name: 'Monthly' }).click();
    const monthRows = await page.getByRole('table').first().locator('tbody tr').count();
    check(dayRows === 30 && weekRows >= 5 && weekRows <= 6 && monthRows >= 1 && monthRows <= 2, `${label}: daily, weekly and monthly`, { dayRows, weekRows, monthRows });
    const callsTable = page.getByRole('table').nth(1);
    check(await callsTable.getByRole('row', { name: /Ravi Patel/ }).getByText('Connected', { exact: true }).isVisible()
      && await callsTable.getByRole('row', { name: /Ravi Patel/ }).getByText('1 min 5 s').isVisible()
      && await callsTable.getByRole('row', { name: /Kiran/ }).getByText('Not connected', { exact: true }).isVisible()
      && await callsTable.getByRole('row', { name: /XXXXXX3333/ }).getByText('Not reported').isVisible(),
      `${label}: the Crocodial call log: status, duration; an empty "connected" is "not reported"`);
    check((await callsTable.locator('thead th').allTextContents()).join('|') === 'Date and time|Contact|Number|Type|Status|Duration', `${label}: the call fields shown are Crocodial's`);
    await page.getByRole('tab', { name: /Leads/ }).click();
    check(await page.getByRole('row', { name: /Meera Shah/ }).getByText('Bina').isVisible(), `${label}: the CRM leads, with to whom each was converted`);
    check(!(await page.getByRole('tab', { name: /Follow-ups/ }).count()), `${label}: no extra follow-up tab`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: the dashboard does not scroll sideways`);
    await page.getByRole('button', { name: /Back to Telecaller List/ }).click();
    await page.getByTestId('role-list-TELECALLER').waitFor();

    // a Telecaller not connected to Crocodial: no call figures at all
    await page.getByRole('button', { name: "Open Caller 1's dashboard" }).click();
    await page.getByTestId('croc-state').waitFor();
    check(await page.getByTestId('croc-state').getByText(/not connected to Crocodial/).isVisible() && !(await page.getByTestId('metric-calls').count())
      && !(await page.getByRole('tab', { name: 'Calls' }).count()), `${label}: not connected: said so, no call cards, no call log`);
    check(!(await page.getByRole('columnheader', { name: /Total calls/ }).count()), `${label}: ... and no call columns in the daily table`);

    // Business Associate
    reset();
    await page.goto(base);
    await page.evaluate(() => window.mount('BUSINESS_ASSOCIATE'));
    await page.getByRole('heading', { name: 'Business Associate List' }).waitFor();
    const bina = page.getByRole('row', { name: /Bina/ });
    await bina.waitFor();
    check(await bina.getByText(/1,25,000/).isVisible() && await bina.getByText('Not connected to Crocodial').isVisible(), `${label}: Business Associate figures, deal value in rupees`);
    await page.getByRole('button', { name: "Open Bina's dashboard" }).click();
    await page.getByTestId('role-person-BUSINESS_ASSOCIATE').waitFor();
    check(await page.getByTestId('metric-demosScheduled').textContent() === '3' && await page.getByTestId('metric-demosCompleted').textContent() === '2'
      && await page.getByTestId('metric-demosCancelled').textContent() === '1', `${label}: demos from the CRM schedule`);
    check(!(await page.getByText(/Clients met|Revenue received|Leads worked|Open contacts/).count()), `${label}: no invented or duplicate figures`);
    check(await page.getByRole('row', { name: /Meera Shah/ }).getByText('Asha').isVisible(), `${label}: leads with their Telecaller`);
    await page.getByRole('tab', { name: /Demos/ }).click();
    check(await page.getByText('No demos in this period.').isVisible(), `${label}: an empty record list says so`);
    await page.getByRole('tab', { name: /Quotations/ }).click();
    check(await page.getByText('Q-1 · rev 2').isVisible(), `${label}: a quotation once, at its latest revision`);
    await page.getByRole('tab', { name: /Deals/ }).click();
    check(await page.getByRole('row', { name: /Meera Shah/ }).getByText(/1,25,000/).isVisible(), `${label}: deals`);

    // nobody yet
    reset(); state.empty = true;
    await page.goto(base);
    await page.evaluate(() => window.mount('TELECALLER'));
    await page.getByText('No Telecallers in your Sales teams yet.').waitFor();
    check(await page.getByRole('button', { name: 'Export CSV' }).isDisabled(), `${label}: nobody: an empty state, nothing to export`);
    check(errors.length === 0, `${label}: no script errors`, errors);
    await ctx.close();
  }
  console.log(`=== ${passed} SALES ROLE SECTIONS BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
