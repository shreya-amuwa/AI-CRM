// Browser test of the Crocodial lead pipeline screens (20270304000100), at desktop and phone width: the Super Admin's panel (import switch with
// an in-app confirmation for Import, status mapping of unknown statuses, held leads and their actions, Reconcile now) and a lead page's
// "Crocodial activity" (calls credited to the real caller, ownership difference, stale data labelled; nothing shown for an unlinked lead).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Crocodial pipeline browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/crocodial_pipeline_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;


let calls = [];
let mode = 'PREVIEW';
const OVERVIEW = () => ({ departments: [{ departmentId: 'd1', name: 'M Pillar', enabled: true, leadImport: mode }], counts: { PENDING_CREATE: 4, AMBIGUOUS: 1, UNMAPPED_ASSIGNEE: 2, LINKED: 0 },
  ownershipDiffers: 0, externalLeads: 7, missingAtSource: 0, unknownStatuses: [{ status: 'hot lead', leads: 3 }], mappings: [{ status: 'won', disposition: 'CONVERTED' }],
  unmappedAssignees: [{ externalId: 599, name: 'Nobody Mapped', leads: 2 }], reconcile: { last_run_at: '2027-03-04T05:00:00Z', last_ok_at: null, last_error: null, processed_last_run: 7, created_last_run: 0, updated_last_run: 0, duration_ms_last_run: 120, pending: 0 },
  resources: [{ resource: 'leads', lastOkAt: '2027-03-04T05:00:00Z', lastRunAt: '2027-03-04T05:00:00Z', lastError: null, rowsLastRun: 7, inProgress: false }], recentRuns: [] });
const LINKS = { total: 1, items: [{ id: 'k1', externalLeadId: 9005, status: 'AMBIGUOUS', reason: 'Several CRM records of this department have the same phone number or e-mail.', assignmentMode: 'EXTERNAL', importSource: null,
  name: 'Twin Lead', company: null, phone: '+919770000005', externalStatus: 'hot lead', disposition: null, externalOwner: 'one', mappedOwner: 'CR Sachin', customerId: null, crmOwner: null, department: 'M Pillar',
  candidates: [{ id: 'cu1', name: 'Twin One', lifecycle: 'LEAD', owner: 'CR Other' }, { id: 'cu2', name: 'Twin Two', lifecycle: 'LEAD', owner: 'CR Other' }], lastReconciledAt: null, externalUpdatedAt: null }] };
const ACTIVITY = { linked: true, externalLeadId: 9001, status: 'LINKED', reason: null, assignmentMode: 'CRM_OVERRIDE', externalStatus: 'Won', disposition: 'CONVERTED', externalOwner: 'two',
  externalOwnerProfile: 'CR Supriya', crmOwner: 'CR Other', ownershipDiffers: true, missingAtSource: false, lastSyncAt: '2020-01-01T00:00:00Z', lastReconciledAt: null,
  calls: { total: 2, outgoing: 1, incoming: 1, missed: 0, connected: 1, talkSeconds: 150, lastCallAt: '2027-03-04T05:00:00Z' },
  callHistory: [{ at: '2027-03-04T05:00:00Z', type: 'outgoing', connected: true, seconds: 120, by: 'CR Other Seller' }], remarks: [{ at: '2027-03-04T05:00:00Z', text: 'Asked for a demo', by: 'CR Supriya' }],
  followups: [], ownerHistory: [{ observedAt: '2027-03-04T05:00:00Z', owner: 'CR Supriya' }] };
const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
function api(req, res, body) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/^\/api\/v1/, '');
  calls.push({ method: req.method, path: p, body, query: Object.fromEntries(u.searchParams) });
  if (p === '/crocodial/connections/c1/reconcile' && req.method === 'GET') return ok(res, OVERVIEW());
  if (p === '/crocodial/connections/c1/reconcile' && req.method === 'POST') return ok(res, { batches: 1, processed: 7, created: 4, updated: 0, held: 3, failed: 0, pending: 0, enabled: true });
  if (p === '/crocodial/connections/c1/lead-links') return ok(res, LINKS);
  if (p === '/crocodial/connections/c1/lead-import') { mode = body.mode; return ok(res, { mode: body.mode }); }
  if (p === '/crocodial/connections/c1/status-mappings') return ok(res, { status: body.status, disposition: body.disposition });
  if (p === '/crocodial/lead-links/k1/resolve') return ok(res, { id: 'k1', status: 'LINKED' });
  if (p === '/crocodial/lead-activity/linked') return ok(res, ACTIVITY);
  if (p === '/crocodial/lead-activity/plain') return ok(res, { linked: false });
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: `no fake for ${req.method} ${p}` } }));
}
const srv = createServer((req, res) => {
  if (req.url.startsWith('/api/v1/')) {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => api(req, res, raw ? JSON.parse(raw) : undefined));
    return;
  }
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };

let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.dismiss(); });
    calls = []; mode = 'PREVIEW';
    await page.goto(base);
    await page.evaluate(() => window.mountPipeline());
    await page.getByRole('button', { name: /Leads in the CRM pipeline/ }).click();
    await page.getByLabel('Lead import for M Pillar').waitFor();
    check(await page.getByLabel('Lead import for M Pillar').inputValue() === 'PREVIEW', `${label}: the department's import mode is shown`);
    await page.getByLabel('Lead import for M Pillar').selectOption('IMPORT');
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).first().waitFor();
    check(await page.getByText(/4 would be created/).isVisible(), `${label}: switching to Import asks first (in-app), with the preview counts`);
    await page.getByRole('button', { name: 'Start importing' }).click();
    await page.getByText(/Lead import for M Pillar: import/).waitFor();
    check(calls.some(c => c.path === '/crocodial/connections/c1/lead-import' && c.body.mode === 'IMPORT' && c.body.departmentId === 'd1'), `${label}: then sends the department and the mode`);
    await page.getByText(/Status mapping \(1 mapped, 1 unknown\)/).click();
    await page.getByLabel('CRM disposition for hot lead').selectOption('INTERESTED');
    await page.getByText(/“hot lead” mapped/).waitFor();
    check(calls.some(c => c.path === '/crocodial/connections/c1/status-mappings' && c.body.status === 'hot lead' && c.body.disposition === 'INTERESTED'), `${label}: an unknown status is mapped`);
    await page.getByLabel('Leads', { exact: false }).locator('xpath=self::select').or(page.locator('select').last()).selectOption('AMBIGUOUS');
    await page.getByTestId('croc-lead-links').waitFor();
    check(await page.getByText('Twin Lead').isVisible() && await page.getByText(/Twin One/).isVisible(), `${label}: a held lead shows its candidates`);
    await page.getByRole('button', { name: 'Link to this' }).first().click();
    await page.getByText('Linked.', { exact: true }).waitFor();
    check(calls.some(c => c.path === '/crocodial/lead-links/k1/resolve' && c.body.action === 'LINK' && c.body.customerId === 'cu1'), `${label}: linking sends the chosen record`);
    await page.getByRole('button', { name: /Reconcile now/ }).click();
    await page.getByText(/Reconciled 7: 4 created/).waitFor();
    check(true, `${label}: Reconcile now reports what it did`);

    await page.goto(base);
    await page.evaluate(() => window.mountLead('linked'));
    await page.getByTestId('croc-lead-activity').waitFor();
    const card = await page.getByTestId('croc-lead-activity').innerText();
    check(/may be stale/.test(card) && /Ownership differs: Crocodial assigns it to CR Supriya; the CRM owner is CR Other \(changed in the CRM, kept\)/.test(card), `${label}: the lead page shows the ownership difference and stale data`, card);
    await page.getByText(/Call history/).click();
    check(/by CR Other Seller/.test(await page.getByTestId('croc-lead-activity').innerText()), `${label}: a call is credited to the person who made it`);
    await page.goto(base);
    await page.evaluate(() => window.mountLead('plain'));
    await page.waitForTimeout(300);
    check(!(await page.getByTestId('croc-lead-activity').count()), `${label}: nothing is shown for a lead not linked to Crocodial`);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(wide <= 1 && errors.length === 0, `${label}: no sideways scrolling, no script errors, no browser dialogs`, errors);
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== ${passed} CROCODIAL PIPELINE BROWSER CHECKS PASSED ===`);
