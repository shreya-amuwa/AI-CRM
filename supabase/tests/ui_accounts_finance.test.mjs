// Browser test of the two new Accounts / Meta Verifier screens: the expense form with department rows (running total, remaining amount, what is
// sent) and the Client Panel URL box (HTTPS-only validation, saving sends nothing, the link is sent on purpose, a changed URL is sendable again).
// Real React components + the app's real stylesheet (npm run build first); the API is a small in-page stand-in that follows the real contract.
// Skipped, loudly, when Playwright, Chromium or dist/ are missing.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Accounts finance browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const cssFile = existsSync(cssDir) ? readdirSync(cssDir).find(f => /^index-.*\.css$/.test(f)) : null;
if (!cssFile) { console.log('SKIPPED - dist/ is not built (npm run build), the Accounts finance browser test did not run'); process.exit(0); }
const css = readFileSync(path.join(cssDir, cssFile), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'af-ui-'));
const out = path.join(work, 'bundle.js');
execFileSync('npx', ['esbuild', 'supabase/tests/ui/accounts_finance_harness.tsx', '--bundle', '--format=iife', '--platform=browser', `--outfile=${out}`, '--define:import.meta.env={}', '--jsx=automatic', '--log-level=error'], { stdio: 'inherit' });
const bundle = readFileSync(out, 'utf8');

const D1 = '00000000-0000-4000-8000-000000000001';
const D2 = '00000000-0000-4000-8000-000000000002';
let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }

const apiScript = () => {
  // the app runs on HTTPS where crypto.randomUUID exists; this test page is not a secure context
  if (!crypto.randomUUID) crypto.randomUUID = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
  window.__bodies = [];
  const json = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }), { status, headers: { 'Content-Type': 'application/json' } });
  const depts = [['00000000-0000-4000-8000-000000000001', 'Wabastore', 'wabastore'], ['00000000-0000-4000-8000-000000000002', 'Whatsbox', 'whatsbox'], ['00000000-0000-4000-8000-000000000003', 'Design Studio', 'design-studio']].map(([id, name, slug]) => ({ id, name, slug, description: '' }));
  const svc = { code: 'WHATSAPP_API', name: 'WhatsApp API', platform: 'Main Panel', panelAccount: 'asha@rao.example', panelUrl: null, link: null, credentials: null };
  const details = () => ({ canEdit: true, services: [JSON.parse(JSON.stringify(svc))], customerEmail: 'asha@rao.example', dashboardLogin: null });
  window.__svc = svc;
  window.fetch = async (url, init = {}) => {
    const u = new URL(url, 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : null;
    if (method !== 'GET') window.__bodies.push({ method, path: u.pathname, body });
    if (u.pathname === '/api/v1/departments') return json(depts);
    if (u.pathname === '/api/v1/accounts/finance/expenses' && method === 'GET') return json({ items: [], total: 0, page: 1, pageSize: 15, sum: 0, pending: 0, categories: ['Rent'] });
    if (u.pathname === '/api/v1/accounts/finance/expenses' && method === 'POST') return json({ id: 'e1' }, 201);
    if (u.pathname.endsWith('/verification/panel-details') && method === 'GET') return json(details());
    if (u.pathname.endsWith('/panel-details/WHATSAPP_API/url') && method === 'PATCH') {
      svc.panelUrl = body.url || null;
      if (svc.link) svc.link = { ...svc.link, current: svc.link.url === svc.panelUrl };
      return json(details());
    }
    if (u.pathname.endsWith('/panel-details/WHATSAPP_API/link') && method === 'POST') {
      svc.link = { sentAt: '2026-10-29T10:00:00Z', sentBy: 'Meta Verifier', current: true, url: svc.panelUrl, email: { status: window.__mailStatus || 'QUEUED', detail: null, sentAt: null, to: 'asha@rao.example' } };
      return json({ ...details(), link: { queued: true, replayed: false } });
    }
    return json({ code: 'NOT_FOUND', message: 'no' }, 404);
  };
};

const open = async (vp, mount, waitFor) => {
  const page = await browser.newPage({ viewport: vp });
  page.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 300)));
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div>`);
  await page.evaluate(apiScript);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(m => window[m](), mount);
  await page.waitForSelector(waitFor, { timeout: 5000 });
  return page;
};

// ---- the expense form -----------------------------------------------------------------------------------------------------------------
{
  const page = await open({ width: 1280, height: 900 }, 'mountExpenses', 'text=Add expense');
  await page.click('button:has-text("Add expense")');
  await page.waitForSelector('[data-testid="expense-allocations"]');
  check((await page.locator('[data-testid="expense-allocation-row"]').count()) === 0 && !(await page.isVisible('[data-testid="expense-allocation-total"]')), 'with no department rows the expense is company-wide (no running total shown)');
  await page.fill('#exp-amount', '1000');
  await page.fill('#exp-desc', 'Shared tooling');
  await page.fill('#exp-cat', 'Software');
  await page.click('text=Allocate to departments');
  check((await page.locator('[data-testid="expense-allocation-row"]').count()) === 1, 'a department row is added');
  const first = await page.inputValue('[aria-label="Amount for row 1 (₹)"]');
  check(first === '1000', 'the first row is pre-filled with the whole remaining amount', first);
  await page.selectOption('[aria-label="Department for row 1"]', D1);
  await page.fill('[aria-label="Amount for row 1 (₹)"]', '600');
  check(/Allocated ₹?\s?600/.test(await page.innerText('[data-testid="expense-allocation-total"]')) && /still to allocate/.test(await page.innerText('[data-testid="expense-allocation-total"]')) && /400/.test(await page.innerText('[data-testid="expense-allocation-total"]')), 'the running total shows what is allocated and what remains');
  check(await page.isDisabled('button:has-text("Add expense") >> nth=-1'), 'saving is blocked until the rows add up');
  await page.click('text=Add another department');
  check((await page.inputValue('[aria-label="Amount for row 2 (₹)"]')) === '400', 'the next row is pre-filled with the remainder');
  const disabled = await page.$$eval('[aria-label="Department for row 2"] option', os => os.filter(o => o.disabled).map(o => o.value));
  check(disabled.length === 1 && disabled[0] === D1, 'a department already used cannot be chosen twice');
  await page.selectOption('[aria-label="Department for row 2"]', D2);
  check(/fully allocated/.test(await page.innerText('[data-testid="expense-allocation-total"]')), 'when the rows add up it says fully allocated');
  await page.fill('[aria-label="Amount for row 2 (₹)"]', '450');
  check(/over by/.test(await page.innerText('[data-testid="expense-allocation-total"]')) && await page.isDisabled('button:has-text("Add expense") >> nth=-1'), 'over-allocating is shown and blocked');
  await page.fill('[aria-label="Amount for row 2 (₹)"]', '400');
  await page.click('button[type="submit"]:has-text("Add expense")');
  await page.waitForFunction(() => window.__bodies.some(b => /finance\/expenses$/.test(b.path)), null, { timeout: 4000 }).catch(async () => { console.log('FORM TEXT:', (await page.innerText('form')).replace(/\s+/g, ' ').slice(0, 800)); throw new Error('the form did not send'); });
  const sent = await page.evaluate(() => window.__bodies.find(b => /finance\/expenses$/.test(b.path)).body);
  check(sent.amount === 1000 && sent.allocations.length === 2 && sent.allocations[0].departmentId === D1 && sent.allocations[0].amount === 600 && sent.allocations[1].amount === 400 && typeof sent.requestId === 'string' && !('departmentId' in sent && sent.departmentId),
    'one request carries the expense once, its department parts and a request id (a retry cannot save it twice)', sent);
  await page.close();
}

// ---- the Client Panel URL --------------------------------------------------------------------------------------------------------------
{
  const page = await open({ width: 1024, height: 900 }, 'mountPanel', '[aria-label="Client panel URL for WhatsApp API"]');
  const box = '[aria-label="Client panel URL for WhatsApp API"]';
  const input = `${box} input[type="url"]`;
  check(!(await page.isVisible(`${box} >> text=E-mail the panel link`)), 'nothing can be sent before a URL is saved');
  await page.fill(input, 'http://panel.example.com/login');
  check(/must start with https/.test(await page.innerText(box)) && await page.isDisabled(`${box} >> button:has-text("Save the URL")`), 'http:// is refused on the page, with the reason');
  await page.fill(input, 'https://user:pw@panel.example.com/');
  check(/user name or password/.test(await page.innerText(box)), 'a user name and password in the address are refused');
  await page.fill(input, 'https://panel.example.com/login?token=abc');
  check(/password, key or token/.test(await page.innerText(box)), 'a token in the link is refused');
  await page.fill(input, 'https://localhost/login');
  check(/public web address/.test(await page.innerText(box)), 'localhost is refused');
  await page.fill(input, 'HTTPS://Panel.Example.com/login');
  check(!(await page.isDisabled(`${box} >> button:has-text("Save the URL")`)), 'a valid https address can be saved');
  await page.click(`${box} >> button:has-text("Save the URL")`);
  // the result of saving is a success toast (docs/APP_FEEDBACK_SYSTEM.md); the box itself still says "Not sent" (checked below)
  await page.waitForSelector('[data-testid="toast-success"] >> text=Nothing was sent to the customer yet');
  const saved = await page.evaluate(() => window.__bodies.find(b => /\/url$/.test(b.path)));
  check(saved.method === 'PATCH' && saved.body.url === 'https://panel.example.com/login', 'the cleaned URL is what is saved (host in lower case)', saved);
  check(!(await page.evaluate(() => window.__bodies.some(b => /\/link$/.test(b.path)))), 'saving sent no e-mail');
  check(/Not sent/.test(await page.innerText(box)) && await page.isVisible(`${box} >> text=E-mail the panel link`), 'the box says "Not sent" and offers to e-mail the link');
  await page.click(`${box} >> button:has-text("E-mail the panel link")`);
  await page.waitForSelector('[data-testid="toast-success"] >> text=on its way');
  const link = await page.evaluate(() => window.__bodies.filter(b => /\/link$/.test(b.path)));
  check(link.length === 1 && link[0].body.resend === false && /^[0-9a-f-]{36}$/.test(link[0].body.requestId), 'one send request with a request id', link);
  check(/waiting to be sent/.test(await page.innerText(box)) && await page.isDisabled(`${box} >> button:has-text("E-mail the panel link")`), 'while it waits the button is off - no second click can send it again');
  await page.evaluate(() => { window.__svc.link.email.status = 'SENT'; });
  await page.evaluate(() => window.dispatchEvent(new Event('crm:pipeline-changed')));
  await page.click(`${box} >> text=Open`).catch(() => undefined);
  await page.close();
}
{
  const page = await open({ width: 1024, height: 900 }, 'mountPanel', '[aria-label="Client panel URL for WhatsApp API"]');
  const box = '[aria-label="Client panel URL for WhatsApp API"]';
  const input = `${box} input[type="url"]`;
  await page.evaluate(() => { window.__mailStatus = 'SENT'; });
  await page.fill(input, 'https://panel.example.com/login');
  await page.click(`${box} >> button:has-text("Save the URL")`);
  await page.waitForSelector(`${box} >> button:has-text("E-mail the panel link")`);
  await page.click(`${box} >> button:has-text("E-mail the panel link")`);
  await page.waitForSelector(`${box} >> button:has-text("Send again")`);
  check(/E-mail sent/.test(await page.innerText(box)), 'a sent link says "E-mail sent" and the only action left is "Send again" (on purpose)');
  await page.fill(input, 'https://panel2.example.com/login');
  await page.click(`${box} >> button:has-text("Save the URL")`);
  await page.waitForSelector(`${box} >> text=URL changed since it was sent`);
  check(await page.isVisible(`${box} >> button:has-text("E-mail the new link")`), 'after a change the new address can be sent, and the box says the customer still has the earlier one');
  await page.fill(input, '');
  check(await page.isVisible(`${box} >> button:has-text("Remove the URL")`), 'an empty value offers to remove the URL');
  await page.close();
}
for (const [name, vp] of [['phone', { width: 360, height: 740 }], ['tablet', { width: 768, height: 1024 }]]) {
  const page = await open(vp, 'mountPanel', '[aria-label="Client panel URL for WhatsApp API"]');
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check(m.sw <= m.iw, `${name}: the panel URL box does not scroll sideways`, m);
  await page.close();
  const p2 = await open(vp, 'mountExpenses', 'text=Add expense');
  await p2.click('button:has-text("Add expense")');
  await p2.waitForSelector('[data-testid="expense-allocations"]');
  await p2.click('text=Allocate to departments');
  const m2 = await p2.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check(m2.sw <= m2.iw, `${name}: the expense form with department rows does not scroll sideways`, m2);
  await p2.close();
}
await browser.close();
console.log(`=== ACCOUNTS FINANCE BROWSER TESTS PASSED (${passed}) ===`);
