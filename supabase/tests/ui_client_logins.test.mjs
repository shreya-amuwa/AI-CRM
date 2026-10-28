// Browser test of Accounts > Client Logins: the queue (customer, ID, order, e-mail, status, time, result), the actions and what they send,
// and the layout on phone / tablet / desktop. Real React component + the app's real stylesheet (npm run build first); the API is a small
// in-page stand-in that follows the real contract. Skipped, loudly, when Playwright, Chromium or dist/ are missing.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Client Logins browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const cssFile = existsSync(cssDir) ? readdirSync(cssDir).find(f => /^index-.*\.css$/.test(f)) : null;
if (!cssFile) { console.log('SKIPPED - dist/ is not built (npm run build), the Client Logins browser test did not run'); process.exit(0); }
const css = readFileSync(path.join(cssDir, cssFile), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'cl-ui-'));
const out = path.join(work, 'bundle.js');
execFileSync('npx', ['esbuild', 'supabase/tests/ui/client_logins_harness.tsx', '--bundle', '--format=iife', '--platform=browser', `--outfile=${out}`, '--define:import.meta.env={}', '--jsx=automatic', '--log-level=error'], { stdio: 'inherit' });
const bundle = readFileSync(out, 'utf8');

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }

const apiScript = () => {
  const row = (over) => ({
    customerId: 'c1', code: 'CUS-00001', name: 'Asha Rao', company: 'Rao Traders', email: 'asha@rao.example', emailProblem: null,
    order: { services: ['WhatsApp API + Blue Tick'], dealAmount: 12000, verified: 6000, balance: 6000, paymentStatus: 'PARTIALLY_PAID' },
    journey: 'TECHNICAL', status: 'NOT_STARTED', attempts: 0, lastError: null, requestedAt: null, updatedAt: '2026-10-20T10:00:00Z', createdAt: null, createdBy: null,
    loginEmail: null, notification: null, can: { create: true, fixEmail: true, resend: false }, ...over
  });
  const rows = [
    row({ customerId: 'c1' }),
    row({ customerId: 'c2', code: 'CUS-00002', name: 'No Mail', company: 'No Mail Co', email: null, emailProblem: 'MISSING', can: { create: false, fixEmail: true, resend: false } }),
    row({ customerId: 'c3', code: 'CUS-00003', name: 'Failed One', company: 'Failed Co', email: 'f@x.example', status: 'FAILED', attempts: 2, lastError: 'The sign-in service did not answer.' }),
    row({ customerId: 'c4', code: 'CUS-00004', name: 'Done One', company: 'Done Co', email: 'd@x.example', status: 'CREATED', createdAt: '2026-10-21T09:30:00Z', createdBy: 'Accounts Member', loginEmail: 'd@x.example',
      notification: { email: { status: 'FAILED', detail: 'HTTP 550 mailbox unavailable', sentAt: null, attempts: 5 }, whatsapp: { status: 'SENT', detail: null, sentAt: '2026-10-21T09:31:00Z', attempts: 1 } },
      can: { create: false, fixEmail: false, resend: true } })
  ];
  window.__calls = [];
  window.__bodies = [];
  const json = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (url, init = {}) => {
    const u = new URL(url, 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    window.__calls.push(`${method} ${u.pathname}${u.search}`);
    if (method !== 'GET') window.__bodies.push({ path: u.pathname, body: init.body ? JSON.parse(init.body) : null });
    if (u.pathname === '/api/v1/pipeline/accounts/client-logins') {
      const st = u.searchParams.get('status') || 'ALL';
      const items = rows.filter(r => st === 'ALL' || r.status === st);
      const counts = { ALL: rows.length, NOT_STARTED: 2, PENDING: 0, FAILED: 1, CREATED: 1 };
      return json({ items, total: items.length, page: 1, pageSize: 20, counts });
    }
    if (/\/accounts\/client-login$/.test(u.pathname) && method === 'POST') { rows.find(r => u.pathname.includes(r.customerId)).status = 'CREATED'; return json({ email: 'x', status: 'CREATED' }, 201); }
    if (/\/accounts\/customer-email$/.test(u.pathname) && method === 'POST') {
      const b = JSON.parse(init.body);
      const r = rows.find(x => u.pathname.includes(x.customerId));
      r.email = b.email; r.emailProblem = null; r.can.create = true;
      return json(null);
    }
    if (/\/accounts\/account-email\/resend$/.test(u.pathname)) return json(null);
    return json({ code: 'NOT_FOUND', message: 'no' }, 404);
  };
};

const open = async (vp) => {
  const page = await browser.newPage({ viewport: vp });
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div>`);
  await page.evaluate(apiScript);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.mount());
  page.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 300)));
  await page.waitForSelector('[data-testid="client-login-row"]', { timeout: 5000 });
  return page;
};

{
  const page = await open({ width: 1280, height: 900 });
  const rows = await page.$$eval('[data-testid="client-login-row"]', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check(rows.length === 4, 'every customer with a verified payment is listed', rows);
  check(/CUS-00001/.test(rows[0]) && /WhatsApp API \+ Blue Tick/.test(rows[0]) && /asha@rao\.example/.test(rows[0]) && /To create/.test(rows[0]), 'a row shows the customer, its ID, the order, the e-mail on the record and the status');
  check(/No e-mail on the customer record/.test(rows[1]) && /none/.test(rows[1]), 'a missing e-mail is called out');
  check(await page.isDisabled('[data-testid="client-login-row"]:nth-child(2) >> text=Create login'), 'and the login cannot be created until it is fixed');
  check(/The sign-in service did not answer/.test(rows[2]) && /2 attempts/.test(rows[2]) && /Try again/.test(rows[2]), 'a failure keeps its reason and offers a retry');
  check(/Created/.test(rows[3]) && /Accounts Member/.test(rows[3]) && /could not be sent/.test(rows[3]) && /HTTP 550/.test(rows[3]) && /sent/.test(rows[3]), 'a created login shows who made it, and the state of its e-mail and WhatsApp (a failed one with its reason)');
  check(await page.isVisible('text=Send e-mail again'), 'a delivered or failed e-mail can be sent again');
  check(!(await page.locator('input[type="password"]').count()), 'there is no password field anywhere');
  // create: the request carries no e-mail and no password
  await page.click('[data-testid="client-login-row"]:nth-child(1) >> text=Create login');
  await page.waitForSelector('[role="status"]:has-text("client login was created")');
  const created = await page.evaluate(() => window.__bodies.find(b => /client-login$/.test(b.path)));
  check(created && JSON.stringify(created.body) === '{}', 'creating a login sends nothing but the customer in the address: no e-mail, no password', created);
  // fix the e-mail with a reason
  await page.click('[data-testid="client-login-row"]:nth-child(2) >> text=Correct e-mail');
  await page.waitForSelector('#fix-email');
  check(await page.isDisabled('text=Save the e-mail'), 'saving needs a valid e-mail and a reason');
  await page.fill('#fix-email', 'fixed@nomail.example');
  await page.fill('#fix-reason', 'Customer confirmed on a call');
  await page.click('text=Save the e-mail');
  await page.waitForSelector('[role="status"]:has-text("corrected")');
  const fixed = await page.evaluate(() => window.__bodies.find(b => /customer-email$/.test(b.path)));
  check(fixed && fixed.body.email === 'fixed@nomail.example' && fixed.body.reason === 'Customer confirmed on a call', 'the correction is sent with its reason', fixed);
  // resend
  await page.click('text=Send e-mail again');
  await page.waitForSelector('[role="status"]:has-text("queued again")');
  check(true, 'the e-mail can be queued again');
  // tabs filter
  await page.click('role=tab[name=/Failed/]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="client-login-row"]').length === 1);
  check(true, 'the Failed tab lists only the failures');
  await page.close();
}
for (const [name, vp] of [['phone', { width: 360, height: 740 }], ['tablet', { width: 768, height: 1024 }], ['desktop', { width: 1440, height: 900 }]]) {
  const page = await open(vp);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check(m.sw <= m.iw, `${name}: the page does not scroll sideways`, m);
  const buttons = await page.$$eval('[data-testid="client-login-row"] button', bs => bs.map(b => { const r = b.getBoundingClientRect(); return r.right <= innerWidth + 1 && r.left >= -1; }));
  check(buttons.every(Boolean), `${name}: every action stays on screen`);
  await page.close();
}
await browser.close();
console.log(`=== CLIENT LOGINS BROWSER TESTS PASSED (${passed}) ===`);
