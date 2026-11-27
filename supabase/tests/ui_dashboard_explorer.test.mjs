// Browser test of Dashboard Explorer (docs/DASHBOARD_EXPLORER.md), real Chromium:
//  - the real Explorer page (list, filters, preview toolbar, viewports, switching, Reset, Suggest Improvement, exit, Browser Back) with a recording
//    API stub (supabase/tests/ui/dashboard_explorer_harness.tsx);
//  - the REAL built preview bundle (dist/dashboard-preview, built here when missing) served with the Worker's preview headers
//    (worker/securityHeaders.ts PREVIEW_HEADERS) - the same sandbox and CSP as production;
//  - isolation: the frame makes no request except its own files, cannot fetch / XHR / WebSocket / beacon, cannot read the parent's storage;
//    a simulated action changes only the demonstration data and the server sees nothing;
//  - coverage: every registry position renders its dashboard without a page error.
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Dashboard Explorer browser test did not run'); process.exit(0); }

let passed = 0;
const check = (cond, label, extra) => {
  if (!cond) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra).slice(0, 1500)); process.exit(1); }
  passed++;
  console.log(`ok - ${label}`);
};

// ---- the preview bundle (the real one) and the Explorer harness ------------------------------------------------------------------
if (!existsSync('dist/dashboard-preview/index.html')) execSync('npx vite build -c vite.preview.config.ts', { stdio: 'ignore' });
const work = mkdtempSync(path.join(tmpdir(), 'dx-ui-'));
await build({ entryPoints: ['worker/securityHeaders.ts'], bundle: true, format: 'esm', platform: 'node', outfile: path.join(work, 'headers.mjs'), logLevel: 'error' });
await build({ entryPoints: ['shared/dashboardExplorer.ts'], bundle: true, format: 'esm', platform: 'node', outfile: path.join(work, 'registry.mjs'), logLevel: 'error' });
const { PREVIEW_HEADERS } = await import(path.join(work, 'headers.mjs'));
const { DASHBOARD_REGISTRY } = await import(path.join(work, 'registry.mjs'));
await build({
  entryPoints: ['supabase/tests/ui/dashboard_explorer_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: path.join(work, 'app.js'),
  define: { 'import.meta.env': '{}' }, jsx: 'automatic', logLevel: 'error', loader: { '.css': 'empty' },
  plugins: [{ name: 'stubs', setup(b) {
    // the API client, however it is imported ('../../lib/api/client' or './client' from inside src/lib/api)
    b.onResolve({ filter: /(^|\/)client$/ }, a => (/lib\/api\/client$/.test(a.path) || (a.path === './client' && /src[\\/]lib[\\/]api/.test(a.importer))
      ? { path: path.resolve('supabase/tests/ui/dashboard_explorer_api_stub.ts') } : undefined));
    b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: path.resolve('supabase/tests/ui/meeting_presence_supabase_stub.ts') }));
    b.onResolve({ filter: /\/context\/AuthContext$/ }, () => ({ path: path.resolve('supabase/tests/ui/chat_extras_auth_stub.ts') }));
  } }]
});
// the main stylesheet (Tailwind, the largest file), as the CRM page has it
const css = readdirSync('dist/dashboard-preview/assets').filter(f => f.endsWith('.css')).sort((a, b) => statSync(`dist/dashboard-preview/assets/${b}`).size - statSync(`dist/dashboard-preview/assets/${a}`).size)[0];
const harness = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/dashboard-preview/assets/${css}"></head>
<body><div id="root"></div><script>localStorage.setItem('sb-project-auth-token', 'MANAGING-DIRECTOR-SESSION');</script><script src="/__app.js"></script></body></html>`;

// ---- the server: the Explorer page (the CRM), the preview frame with the production preview headers, and a log of every request ----------
const hits = [];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  hits.push(u.pathname);
  if (u.pathname === '/' || u.pathname === '/__explorer') { res.setHeader('Content-Type', 'text/html'); res.end(harness); return; }
  if (u.pathname === '/__app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(path.join(work, 'app.js'))); return; }
  if (u.pathname.startsWith('/dashboard-preview')) {
    for (const [k, v] of Object.entries(PREVIEW_HEADERS)) res.setHeader(k, v);
    let file = path.join('dist', u.pathname);
    if (u.pathname === '/dashboard-preview' || u.pathname === '/dashboard-preview/') file = 'dist/dashboard-preview/index.html';
    if (!existsSync(file) || statSync(file).isDirectory()) { res.statusCode = 404; res.end('nf'); return; }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
    return;
  }
  res.statusCode = 404; res.end('not here');
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
// allowed: the harness, the preview's own files and public static images / fonts (the shell's logo); anything else - the API, PostgREST,
// Realtime, Storage, auth - would be a request the preview must never make
const staticFile = p => /^\/[\w./-]+\.(png|svg|ico|webp|jpg|jpeg|woff2?)$/.test(p) && !/^\/(api|rest|realtime|storage|auth|functions)\//.test(p);
const forbidden = () => hits.filter(p => !(p === '/' || p === '/__explorer' || p === '/__app.js' || p.startsWith('/dashboard-preview/') || staticFile(p)));

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  const frameRequests = [];
  page.on('request', r => { if (r.frame() !== page.mainFrame()) frameRequests.push(r.url()); });
  await page.goto(`${base}/__explorer`);
  const apiCalls = () => page.evaluate(() => window.__api);
  const frame = () => page.frames().find(f => f !== page.mainFrame() && f.url().includes('/'));
  const frameText = async () => (await frame()?.evaluate(() => document.body.innerText).catch(() => '')) ?? '';
  const waitFrameText = async (re, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await frameText())) return true; await page.waitForTimeout(150); } return false; };

  // ---- the list -----------------------------------------------------------------------------------------------------------------
  await page.getByRole('heading', { name: 'Dashboard Explorer' }).waitFor();
  check(await page.getByTestId('dashboard-card').count() === DASHBOARD_REGISTRY.length, `every registry position is listed (${DASHBOARD_REGISTRY.length})`);
  await page.getByPlaceholder('Search by position or module').fill('telecaller');
  check(await page.getByTestId('dashboard-card').count() === 1, 'search narrows the list to the matching position');
  await page.getByPlaceholder('Search by position or module').fill('');
  await page.getByLabel('Dashboard category').selectOption('HR');
  check(await page.getByTestId('dashboard-card').count() === 4, 'the category filter shows the HR positions');
  await page.getByLabel('Dashboard category').selectOption('');
  await page.locator('section[aria-label="Dashboard improvement requests"]').getByText(/None yet/).waitFor();
  check(true, 'pending improvement requests: none yet');

  // ---- open a preview -------------------------------------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Open dashboard preview: Support Department Head' }).click();
  const toolbar = page.getByTestId('preview-toolbar');
  await toolbar.waitFor();
  const tb = await toolbar.innerText();
  check(/PREVIEW MODE — Support Department Head/.test(tb) && /Data: Demonstration only/.test(tb) && /M Pillar Corporation/.test(tb), 'the toolbar names the position, the department and that the data is demonstration only', tb);
  check((await apiCalls()).some(c => c.path === '/dashboard-explorer/sessions' && c.body.dashboardId === 'support-department-head' && c.body.department === 'mpillar'), 'the preview start is sent for the audit (the Managing Director\'s own action)');
  check(await waitFrameText(/Team Attendance/), 'the real Support Department Head dashboard renders in the frame');
  const sandbox = await page.getByTestId('preview-frame').getAttribute('sandbox');
  check(sandbox === 'allow-scripts allow-forms', 'the frame is sandboxed without allow-same-origin', sandbox);

  // ---- isolation ------------------------------------------------------------------------------------------------------------------
  const f = frame();
  check(await f.evaluate(() => self.origin) === 'null', 'the frame runs in an opaque origin');
  check(await f.evaluate(() => localStorage.getItem('sb-project-auth-token')) === null, 'the frame cannot read the Managing Director\'s stored session');
  const attempts = await f.evaluate(async () => {
    const out = {};
    try { await fetch('/api/v1/me'); out.fetch = 'sent'; } catch { out.fetch = 'blocked'; }
    try { new WebSocket('wss://project.supabase.co/realtime/v1'); out.ws = 'sent'; } catch { out.ws = 'blocked'; }
    try { const x = new XMLHttpRequest(); x.open('GET', '/rest/v1/profiles'); x.send(); out.xhr = 'sent'; } catch { out.xhr = 'blocked'; }
    out.beacon = navigator.sendBeacon('/api/v1/attendance') ? 'sent' : 'blocked';
    out.sw = 'serviceWorker' in navigator ? 'present' : 'absent';
    return out;
  });
  check(Object.values(attempts).every(v => v === 'blocked' || v === 'absent'), 'fetch, WebSocket, XHR, beacon are refused and there is no service worker', attempts);
  await page.waitForTimeout(400);
  check(forbidden().length === 0, 'the server received no API, PostgREST, Realtime or Storage request', forbidden());
  const odd = frameRequests.filter(u => !(new URL(u).pathname.startsWith('/dashboard-preview/') || staticFile(new URL(u).pathname) || /fonts\.(googleapis|gstatic)\.com/.test(u)));
  check(odd.length === 0, 'the frame loaded only its own files and public images', odd);

  // ---- viewports ------------------------------------------------------------------------------------------------------------------
  await page.getByRole('button', { name: /Mobile/ }).click();
  await page.waitForTimeout(300);
  const mw = await frame().evaluate(() => ({ w: window.innerWidth, m: matchMedia('(max-width: 640px)').matches }));
  check(mw.w === 390 && mw.m, 'Mobile: the frame really is 390 px wide and the media queries follow', mw);
  await page.getByRole('button', { name: /Tablet/ }).click();
  await page.waitForTimeout(300);
  check(await frame().evaluate(() => window.innerWidth === 820 && !matchMedia('(max-width: 640px)').matches && matchMedia('(max-width: 1023px)').matches), 'Tablet: 820 px');
  await page.getByRole('button', { name: /Desktop/ }).click();

  // ---- switch position: the real Support Team Lead, then a simulated action and Reset ----------------------------------------------
  await page.getByLabel('Switch position').selectOption('support-team-lead');
  check(await waitFrameText(/Team Leader Dashboard/), 'switching the position opens the Support Team Lead dashboard');
  check((await apiCalls()).some(c => c.path === '/dashboard-explorer/sessions/end'), 'the previous preview\'s end is sent for the audit');
  check((await toolbar.innerText()).includes('PREVIEW MODE — Support Team Lead'), 'the toolbar follows');
  const before = hits.length;
  await frame().getByRole('button', { name: 'Add Customer' }).first().click();
  await frame().getByLabel('Customer full name').fill('Preview Test Customer');
  await frame().getByLabel('Phone number').fill('+91 91234 56789');
  await frame().getByRole('dialog').getByRole('button', { name: 'Add customer', exact: true }).click();
  await page.getByText('Demo action completed. No live CRM data has been changed.').first().waitFor({ timeout: 8000 });
  check(true, 'a simulated Add Customer says "Demo action completed. No live CRM data has been changed."');
  check(await waitFrameText(/Preview Test Customer was added/), 'the Team Lead sees "Preview Test Customer was added" (the demonstration data changed)');
  check(hits.slice(before).every(p => p.startsWith('/dashboard-preview/') || staticFile(p)), 'and nothing reached the server', hits.slice(before));
  await page.getByRole('button', { name: 'Reset demo data' }).click();
  let cleared = false;
  for (let i = 0; i < 80 && !cleared; i++) { await page.waitForTimeout(150); const t = await frameText(); cleared = /Team Leader Dashboard/.test(t) && !t.includes('Preview Test Customer'); }
  check(cleared, 'Reset demo data throws the simulated change away');

  // ---- Suggest Improvement --------------------------------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Suggest improvement' }).click();
  const dialog = page.getByRole('dialog', { name: 'Suggest an improvement' });
  await dialog.waitFor();
  check((await dialog.innerText()).includes('Support Team Lead'), 'the form shows the captured position');
  await dialog.getByRole('button', { name: 'Send to the Development Team' }).click();
  check(await dialog.getByText('Give the improvement a title').count() > 0, 'an empty title is refused in the form');
  await dialog.getByLabel('Improvement title').fill('Show overdue tickets at the top');
  await dialog.getByLabel('Detailed description').fill('Display pending escalations and overdue tickets above the statistics.');
  await dialog.getByLabel('Priority').selectOption('HIGH');
  await dialog.getByRole('button', { name: 'Send to the Development Team' }).dblclick();
  await page.getByText(/Sent to the CRM Development Team as BUG-2026-00042/).first().waitFor();
  const sent = (await apiCalls()).filter(c => c.path === '/dashboard-explorer/improvements' && c.method === 'POST');
  check(sent.length === 1, 'a double click sends one request', sent.length);
  check(sent[0].body.dashboardId === 'support-team-lead' && sent[0].body.department === 'mpillar' && sent[0].body.viewport === 'desktop' && sent[0].body.priority === 'HIGH'
        && /\/support-lead\/dashboard\//.test(sent[0].body.page) && sent[0].body.clientRequestId.length >= 8, 'the request carries the position, department, page, viewport and a request id', sent[0].body);

  // ---- exit and Browser Back -----------------------------------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Back to Managing Director' }).click();
  await page.getByRole('heading', { name: 'Dashboard Explorer' }).waitFor();
  check(await page.getByTestId('preview-toolbar').count() === 0 && await page.getByTestId('preview-frame').count() === 0, 'Back to Managing Director closes the preview');
  await page.locator('section[aria-label="Dashboard improvement requests"]').getByText('Show overdue tickets at the top').waitFor();
  check((await page.locator('section[aria-label="Dashboard improvement requests"]').innerText()).includes('Submitted'), 'the request is listed with its status (Submitted)');
  check(await page.evaluate(() => localStorage.getItem('sb-project-auth-token')) === 'MANAGING-DIRECTOR-SESSION', 'the Managing Director\'s own session is unchanged');
  await page.getByRole('button', { name: 'Open dashboard preview: Telecaller' }).click();
  await page.getByTestId('preview-toolbar').waitFor();
  await page.goBack();
  await page.waitForTimeout(400);
  check(await page.getByTestId('preview-toolbar').count() === 0, 'Browser Back closes the preview too');

  // ---- a refused start (not the Managing Director, or access revoked) -----------------------------------------------------------
  await page.evaluate(() => { window.__refuse = true; });
  await page.getByRole('button', { name: 'Open dashboard preview: CEO – Sales' }).click();
  await page.getByText('The preview could not start').waitFor();
  check(await page.getByTestId('preview-frame').count() === 0, 'when the server refuses the preview, no frame opens');
  await page.evaluate(() => { window.__refuse = false; });
  await page.getByRole('button', { name: 'Back to Managing Director' }).click();

  // ---- the preview address opened directly: sandboxed, with a notice -------------------------------------------------------------
  const direct = await browser.newPage();
  await direct.goto(`${base}/dashboard-preview/`);
  await direct.getByText('This page opens only inside Dashboard Explorer').waitFor();
  check(await direct.evaluate(() => { try { return window.localStorage.getItem('x') === null ? 'memory' : 'real'; } catch { return 'blocked'; } }) !== 'real', 'opened directly, the preview page shows a notice and has no real storage');
  await direct.close();

  // ---- every position renders its dashboard ------------------------------------------------------------------------------------
  const cov = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const covErrors = [];
  cov.on('pageerror', e => covErrors.push(String(e.message)));
  const failures = [];
  for (const e of DASHBOARD_REGISTRY) {
    covErrors.length = 0;
    await cov.goto(`${base}/__explorer`);
    await cov.getByRole('button', { name: `Open dashboard preview: ${e.position}` }).click();
    await cov.getByTestId('preview-frame').waitFor();
    const fr = () => cov.frames().find(x => x !== cov.mainFrame());
    let text = '';
    for (let i = 0; i < 60; i++) {
      text = (await fr()?.evaluate(() => document.body.innerText).catch(() => '')) ?? '';
      if (text.length > 150 && !/Loading|Preparing/.test(text.slice(0, 40))) break;
      await cov.waitForTimeout(150);
    }
    const expect = e.availability === 'NO_DASHBOARD_YET' ? /not set up yet/ : e.id === 'ceo-multi' ? /Choose a department/ : /Attendance/;
    if (!expect.test(text) || covErrors.length) failures.push({ id: e.id, errors: covErrors.slice(0, 2), text: text.slice(0, 120) });
  }
  check(failures.length === 0, `all ${DASHBOARD_REGISTRY.length} positions render their dashboard (or the production notice page) without a page error`, failures);
  check(forbidden().length === 0, 'after every preview, the server still received no API, database or storage request', forbidden());
  check(errors.length === 0, 'no page error on the Explorer page', errors);
  await cov.close();
} finally {
  await browser.close();
  server.close();
}
console.log(`=== ${passed} DASHBOARD EXPLORER BROWSER CHECKS PASSED ===`);
