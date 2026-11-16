// Browser test of the lead welcome WhatsApp (20270103000100): the settings page of the Super Admin / Sales Department Head (mode, template,
// variables in order, the approval rule, the latest messages) and a lead's status with "Send again", at desktop and phone width.
// The API is a fake in this test's server.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the lead WhatsApp browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/lead_whatsapp_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

// ---- the fake API -----------------------------------------------------------------------------------------------------------------------
const LEAD_OK = 'aaaaaaaa-0000-4000-8000-000000000001';
const LEAD_FAILED = 'aaaaaaaa-0000-4000-8000-000000000002';
const LEAD_NONE = 'aaaaaaaa-0000-4000-8000-000000000003';
const now = new Date().toISOString();
const msg = o => ({ id: 'm-' + o.customerId.slice(-1), customerId: o.customerId, leadName: 'Ravi Joshi', salesPerson: 'Priya Shah', recipient: '+91XXXXXX0123', status: 'READ', attempts: 1,
  nextAttemptAt: null, detail: null, acceptedAt: now, deliveredAt: now, failedAt: null, createdAt: now, events: [], ...o });
const state = {
  settings: { enabled: false, templateName: null, templateLanguage: 'en', templateApproved: false, variables: ['LEAD_NAME', 'SALES_PERSON_NAME'], updatedAt: now, updatedBy: null,
    counts: { queued: 0, sent: 3, failed: 1, skipped: 1, dryRun: 0 },
    recent: [msg({ customerId: LEAD_OK }), msg({ customerId: LEAD_FAILED, leadName: 'Sunita Rao', status: 'FAILED', detail: 'Wabastore refused the message (HTTP 400).' })],
    delivery: { mode: 'live', ready: true, note: 'Messages go through Wabastore.' } },
  failedStatus: 'FAILED',
  calls: []
};
const ok = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };

function api(req, res, body) {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/api\/v1/, '');
  state.calls.push({ method: req.method, path: p, body, auth: req.headers.authorization || null });
  if (p === '/sales/lead-whatsapp/settings' && req.method === 'GET') return ok(res, state.settings);
  if (p === '/sales/lead-whatsapp/settings' && req.method === 'POST') {
    const changed = body.templateName !== state.settings.templateName || body.variables.join() !== state.settings.variables.join();
    state.settings = { ...state.settings, ...body, templateApproved: body.templateApproved && !(state.settings.templateApproved && changed), updatedAt: new Date(Date.now() + 1000).toISOString(), updatedBy: 'Super Admin' };
    return ok(res, state.settings);
  }
  if (p === `/leads/${LEAD_OK}/whatsapp`) return ok(res, [msg({ customerId: LEAD_OK })]);
  if (p === `/leads/${LEAD_FAILED}/whatsapp` && req.method === 'GET') return ok(res, [msg({ customerId: LEAD_FAILED, status: state.failedStatus, detail: state.failedStatus === 'FAILED' ? 'NO_VALID_NUMBER: The lead has no valid WhatsApp or mobile number.' : null })]);
  if (p === `/leads/${LEAD_FAILED}/whatsapp/retry`) { state.failedStatus = 'ACCEPTED'; return ok(res, msg({ customerId: LEAD_FAILED, status: 'ACCEPTED', deliveredAt: null })); }
  if (p === `/leads/${LEAD_NONE}/whatsapp`) return ok(res, []);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: `No fake for ${req.method} ${p}` } }));
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
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
const lastCall = (method, p) => [...state.calls].reverse().find(c => c.method === method && c.path === p);
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    state.settings.enabled = false; state.settings.templateName = null; state.settings.templateApproved = false; state.settings.variables = ['LEAD_NAME', 'SALES_PERSON_NAME']; state.failedStatus = 'FAILED';
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base);
    await page.evaluate(() => window.mount());
    await page.getByRole('heading', { name: 'Lead Welcome WhatsApp' }).waitFor();
    check(await page.getByText('Switched off', { exact: true }).isVisible(), `${label}: switched off is shown`);
    check(await page.getByText(/3 sent · 0 waiting · 1 failed · 1 skipped/).isVisible(), `${label}: the counts are shown`);
    check(await page.getByText('Sunita Rao').isVisible() && await page.getByText('Wabastore refused the message (HTTP 400).').isVisible(), `${label}: the latest messages show a failure with its reason`);
    check(lastCall('GET', '/sales/lead-whatsapp/settings').auth === 'Bearer test-token', `${label}: read with the signed-in session`);
    check(await page.getByRole('checkbox', { name: /provider has approved/ }).isDisabled(), `${label}: approval needs a template name first`);

    await page.getByRole('checkbox', { name: /Send the welcome WhatsApp to new leads/ }).check();
    await page.getByLabel(/Template name/).fill('amuwa_services_intro');
    await page.getByRole('button', { name: 'Add a variable' }).click();
    await page.getByLabel('Variable 3', { exact: true }).selectOption('SALES_PERSON_PHONE');
    await page.getByRole('button', { name: 'Move variable 3 up' }).click();
    await page.getByRole('checkbox', { name: /provider has approved/ }).check();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await page.getByText('Settings saved.').waitFor();
    const saved = lastCall('POST', '/sales/lead-whatsapp/settings').body;
    check(saved.enabled && saved.templateName === 'amuwa_services_intro' && saved.templateApproved && saved.variables.join() === 'LEAD_NAME,SALES_PERSON_PHONE,SALES_PERSON_NAME',
      `${label}: on, the template, its approval and the variables in the chosen order are saved`, saved);
    check(await page.getByText('Live', { exact: true }).isVisible(), `${label}: now live`);

    // changing the approved template asks for the approval again
    await page.getByLabel(/Template name/).fill('amuwa_services_intro_v2');
    check(!(await page.getByRole('checkbox', { name: /provider has approved/ }).isChecked()) && await page.getByText(/you changed it/).isVisible(), `${label}: a changed template is not approved any more`);
    check(errors.length === 0, `${label}: no script errors on the settings page`, errors);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: nothing runs off the screen`);

    // a lead's status
    await page.goto(base);
    await page.evaluate(id => window.mountStatus(id), LEAD_OK);
    await page.getByRole('region', { name: 'Welcome WhatsApp' }).waitFor();
    check(await page.getByText('Read', { exact: true }).isVisible() && !(await page.getByRole('button', { name: /Send again/ }).count()), `${label}: a read message shows "Read" and no Send again`);
    await page.goto(base);
    await page.evaluate(id => window.mountStatus(id), LEAD_FAILED);
    await page.getByText('The lead has no valid WhatsApp or mobile number.').waitFor();
    check(await page.getByText('Failed', { exact: true }).isVisible(), `${label}: a failed message says why (without the code)`);
    await page.getByRole('button', { name: /Send again/ }).click();
    await page.getByText('Sent', { exact: true }).waitFor();
    check(lastCall('POST', `/leads/${LEAD_FAILED}/whatsapp/retry`), `${label}: Send again asks the server`);
    await page.goto(base);
    await page.evaluate(id => window.mountStatus(id), LEAD_NONE);
    await page.waitForTimeout(300);
    check(!(await page.getByRole('region', { name: 'Welcome WhatsApp' }).count()), `${label}: a lead without a welcome message shows nothing`);
    check(errors.length === 0, `${label}: no script errors`, errors);
    await ctx.close();
  }
  console.log(`=== ${passed} LEAD WHATSAPP BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
