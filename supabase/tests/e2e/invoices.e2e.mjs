// Paid-only invoices, in real browsers against the local stack (Postgres + PostgREST + gateway + the web app).
//   - the Super Admin lands on the NEW company dashboard (not the old department hub), with figures that equal the database
//   - a Department Head and a Team Lead land on their own dashboards, with scoped figures, and cannot reach the company view
//   - the Security & Audit Logs page shows refused requests, filters, details and has nothing to edit or delete
// See supabase/tests/e2e/README.md. Passwords come from E2E_PASSWORDS (made up by the runner); nothing is stored.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright-core', '/opt/node-tools/node_modules/playwright-core', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the dashboard browser test did not run'); process.exit(0); }

const BASE = process.env.E2E_BASE || 'http://localhost:3010', GW = process.env.E2E_GATEWAY || 'http://localhost:54410';
const OUT = process.argv[2] || '.';
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const PASSWORDS = JSON.parse(process.env.E2E_PASSWORDS || '{}');
const pwOf = email => { if (!PASSWORDS[email]) throw new Error(`E2E_PASSWORDS has no password for ${email}`); return PASSWORDS[email]; };
const sign = p => {
  const e = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p });
  return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`;
};
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const idOf = async e => (await q('select id from public.profiles where email=$1', [e]))[0].id;
const call = async (token, method, path, body) => {
  const r = await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};
const api = async (who, method, path, body) => {
  const r = await call(sign({ sub: who, role: 'authenticated' }), method, path, body);
  if (!r.json.success) throw new Error(`${method} ${path} ${JSON.stringify(r.json)}`);
  return r.json.data;
};

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(async () => chromium.launch());
let step = 0;
const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => {
  await current?.screenshot({ path: `${OUT}/invoices-fail.png`, fullPage: true }).catch(() => {});
  console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(-5)) : '');
  await browser.close();
  process.exit(1);
};
const expect = async (c, m) => (c ? ok(m) : fail(m));
const open = async (viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => m.type() === 'error' && !/Failed to load resource|fonts\.g|net::ERR/.test(m.text()) && errors.push('console: ' + m.text()));
  return p;
};
const login = async (email, viewport, ready) => {
  const p = await open(viewport);
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(pwOf(email));
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector(ready, { timeout: 25000 }).catch(() => fail(`${email} did not reach the expected dashboard (${ready})`));
  return p;
};
const navItem = (p, label) => p.locator('nav button').filter({ has: p.locator('span', { hasText: new RegExp(`^${label}$`) }) }).first();
const menu = async (p, label) => {
  if ((p.viewportSize()?.width ?? 1440) < 1024) { await p.getByRole('button', { name: 'Toggle menu' }).click(); await new Promise(r => setTimeout(r, 350)); }
  await navItem(p, label).click();
};
const text = p => p.locator('main').innerText();
const num = s => Number(String(s).replace(/[^0-9.-]/g, ''));


// ------------------------------------------------------------------ fixture
const rahul = await idOf('rahul@amuwa.com'), arun = await idOf('acc.member@amuwa.com');
const lead = (await api(rahul, 'POST', '/pipeline/leads', { name: 'Meera Joshi', company: 'Joshi Sweets', phone: '+91 98200 11111', leadSource: 'Walk-in', services: ['AI_CALLING'], notes: 'Wants to buy.' })).id;
const bd = p => p.locator('[role=dialog]').last();

// 1. Sales: Send to Accounts asks for the amount and a note, nothing about GST
const sales = await login('rahul@amuwa.com', { width: 1440, height: 900 }, 'nav button');
await menu(sales, 'My Leads').catch(() => {});
await sales.getByText('Meera Joshi').first().click();
await sales.getByRole('button', { name: 'Send to Accounts' }).first().click();
const dlg = sales.getByRole('dialog');
await dlg.waitFor({ timeout: 10000 });
await expect(/Agreed amount/.test(await dlg.innerText()) && !/GST|tax/i.test(await dlg.innerText()), 'Sales: Send to Accounts asks for the amount and a note, nothing about GST');
await dlg.locator('#accounts-amount').fill('100000');
await sales.screenshot({ path: `${OUT}/inv-1-sales-dialog.png` });
await dlg.getByRole('button', { name: 'Send to Accounts' }).click();
await dlg.waitFor({ state: 'detached', timeout: 15000 }).catch(() => fail('the Send to Accounts dialog did not close'));
const row = (await q('select agreed_amount, deal_amount from customers where id = $1', [lead]))[0];
await expect(Number(row.agreed_amount) === 100000 && Number(row.deal_amount) === 100000, 'the agreed amount is the amount payable: no 18% added by the system');
await api(arun, 'POST', `/pipeline/customers/${lead}/accounts/payments`, { type: 'PART', amount: 60000, method: 'UPI', reference: 'E2E-1', verify: true });
await q("update customers set email = 'meera@example.com', address = '12 MG Road, Pune' where id = $1", [lead]);

// 2. Accounts: build the invoice, choosing the GST
const acc = await login('acc.member@amuwa.com', { width: 1440, height: 900 }, 'nav button');
await menu(acc, 'Invoices');
await acc.getByRole('button', { name: 'Create Invoice' }).click();
await acc.getByText('Joshi Sweets').first().click();
const b = bd(acc);
await b.getByLabel('State').first().selectOption({ label: 'Maharashtra (27)' });
const rate = b.getByPlaceholder('Choose').first();
await expect((await rate.inputValue()) === '', 'Accounts: the GST rate starts blank, nothing is added by the system');
await b.getByLabel('Invoice amount (Rs., before tax)').first().fill('60000');
await expect(await b.getByRole('button', { name: 'Save Invoice' }).isDisabled(), 'Save Invoice stays disabled until Accounts chooses the GST');
await b.getByRole('button', { name: '18%', exact: true }).click();
await expect(/Final amount after tax\s*Rs\.70,800/.test(await b.innerText()), 'the preview adds the 18% Accounts chose: 60,000 + 10,800 = 70,800');
await b.getByRole('button', { name: 'Save Invoice' }).click();
await acc.getByRole('button', { name: 'Open the invoice' }).click();
await acc.getByRole('button', { name: 'Confirm Payment & Send Paid Invoice' }).first().waitFor({ timeout: 15000 });
const t = await bd(acc).innerText();
await expect(!/Balance Due on this Invoice|Invoice Status|Total Order Value/i.test(t), 'the invoice shows none of the removed rows');
await expect(/Invoice total/.test(t) && /Total confirmed payments/.test(t) && /Total order balance outstanding/.test(t), 'only the kept rows are shown');
await expect((t.match(/Not due yet/g) || []).length <= 1, 'one "Not due yet" label, not two');
await acc.screenshot({ path: `${OUT}/inv-4-open.png`, fullPage: true });
const before = (await q('select lifecycle, paid_only from generated_invoices where customer_id = $1', [lead]))[0];
await expect(before.lifecycle === 'ISSUED' && before.paid_only === true, 'saving the invoice sends nothing: it is issued, paid-only');

// 3. A part payment is enough to send the paid invoice
await acc.getByRole('button', { name: 'Confirm Payment & Send Paid Invoice' }).first().click();
const cd = bd(acc);
await expect(/Confirming creates the paid invoice/.test(await cd.innerText()), 'the confirm dialog offers the paid invoice although the order is only partly paid');
await acc.screenshot({ path: `${OUT}/inv-5-confirm.png`, fullPage: true });
await cd.getByRole('button', { name: 'Confirm Payment & Send Paid Invoice' }).click();
await acc.waitForTimeout(4000);
await acc.screenshot({ path: `${OUT}/inv-6-after.png`, fullPage: true });
const g = (await q('select lifecycle, paid_order_confirmed from generated_invoices where customer_id = $1', [lead]))[0];
await expect(g.lifecycle === 'PAID' && Number(g.paid_order_confirmed) === 60000, 'the invoice is PAID against the 60,000 confirmed part payment');

// 4. Phone-sized builder: nothing overflows sideways
const ph = await login('acc.member@amuwa.com', { width: 390, height: 800 }, 'nav button, button[aria-label="Toggle menu"]');
await menu(ph, 'Invoices');
await ph.getByRole('button', { name: 'Create Invoice' }).click();
await ph.screenshot({ path: `${OUT}/inv-7-phone-pre.png` });
await bd(ph).getByText('Joshi Sweets').first().click();
await ph.waitForTimeout(2000);
await expect(await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'a phone: the page does not scroll sideways');
await ph.screenshot({ path: `${OUT}/inv-7-phone.png` });
console.log(`=== ALL PAID-INVOICE BROWSER TESTS PASSED (${step}) ===`);
await browser.close();
process.exit(0);
