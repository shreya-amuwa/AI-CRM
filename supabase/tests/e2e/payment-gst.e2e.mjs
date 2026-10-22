// Record payment with GST, in real browsers against the local stack (Postgres + PostgREST + gateway + the web app).
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
  await current?.screenshot({ path: `${OUT}/payment-gst-fail.png`, fullPage: true }).catch(() => {});
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

// ------------------------------------------------------------------ fixture: a lead sent to Accounts with an agreed amount BEFORE GST
const rahul = await idOf('rahul@amuwa.com'), arun = await idOf('acc.member@amuwa.com');
const lead = (await api(rahul, 'POST', '/pipeline/leads', { name: 'Meera Joshi', company: 'Joshi Sweets', phone: '+91 98200 11111', leadSource: 'Walk-in', services: ['AI_CALLING'], notes: 'Wants to buy.' })).id;
await api(rahul, 'POST', `/pipeline/customers/${lead}/send-to-accounts`, { amount: 100000 });
const bd = p => p.locator('[role=dialog]').last();

const acc = await login('acc.member@amuwa.com', { width: 1440, height: 900 }, 'nav button');
await menu(acc, 'Confirmation');
await acc.getByText('Joshi Sweets').first().click();
await acc.getByRole('button', { name: 'Record payment' }).first().click();
const d = acc.getByRole('dialog', { name: 'Record payment' });
await d.waitFor({ timeout: 10000 });
await acc.screenshot({ path: `${OUT}/gst-1-form.png`, fullPage: true });
const t0 = await d.innerText();
await expect(/Amount before GST/.test(t0) && /GST/.test(t0), 'the form asks for the amount before GST and has a GST option');
await expect(/Agreed ₹1,00,000 before GST/.test(t0), 'it says the agreed amount is before GST');
await expect(!/Final amount received/.test(t0), 'no final amount is shown until there is an amount and a rate');

// choose nothing: the rate must be chosen
await d.locator('#pay-amount').fill('60000');
await d.locator('#pay-ref').fill('GST-E2E-1');
await d.getByRole('button', { name: 'Record payment' }).click();
await expect(/Choose the GST rate/.test(await d.innerText()), 'saving without choosing the GST rate (or No GST) is refused');

await d.locator('#pay-gst').selectOption('18');
const t1 = await d.innerText();
await expect(/Amount before GST\s*₹60,000/.test(t1) && /GST \(18%\)\s*₹10,800/.test(t1) && /Final amount received\s*₹70,800/.test(t1), 'the final amount is shown: 60,000 + GST 10,800 = 70,800');
await d.locator('#pay-gst').selectOption('5');
await expect(/Final amount received\s*₹63,000/.test(await d.innerText()), 'changing the rate updates it at once (5%: 63,000)');
await d.locator('#pay-gst').selectOption('18');
await acc.screenshot({ path: `${OUT}/gst-2-final.png`, fullPage: true });
await d.getByRole('button', { name: 'Record payment' }).click();
await d.waitFor({ state: 'detached', timeout: 15000 }).catch(() => fail('the dialog did not close after recording'));
const pay = (await q('select amount, taxable_amount, gst_rate, gst_amount, status from customer_payments where customer_id = $1', [lead]))[0];
await expect(Number(pay.amount) === 70800 && Number(pay.taxable_amount) === 60000 && Number(pay.gst_rate) === 18 && Number(pay.gst_amount) === 10800 && pay.status === 'PENDING', 'recorded: 70,800 received = 60,000 + 10,800 GST, pending');
await acc.waitForTimeout(800);
await expect(/₹60,000 \+ GST ₹10,800 \(18%\)/.test(await text(acc)), 'the payment history shows the split');
await acc.screenshot({ path: `${OUT}/gst-3-history.png`, fullPage: true });

// a full payment for the rest: 40,000 + 18% = 47,200
await acc.getByRole('button', { name: 'Record payment' }).first().click();
const d2 = acc.getByRole('dialog', { name: 'Record payment' });
await d2.getByLabel('Full payment').check();
await expect((await d2.locator('#pay-amount').inputValue()) === '40000', 'a full payment fills what is left before GST (40,000)');
await d2.locator('#pay-ref').fill('GST-E2E-2');
await d2.locator('#pay-gst').selectOption('18');
await expect(/Final amount received\s*₹47,200/.test(await d2.innerText()), 'and shows the final amount (47,200)');
await d2.getByLabel(/I have received this money and verified it/).check();
await d2.getByRole('button', { name: 'Record & verify' }).click();
await d2.waitFor({ state: 'detached', timeout: 15000 }).catch(() => fail('the second dialog did not close'));
const c = (await q('select deal_amount, amount_received, amount_verified from customers where id = $1', [lead]))[0];
await expect(Number(c.deal_amount) === 118000 && Number(c.amount_received) === 118000 && Number(c.amount_verified) === 47200, 'the order is settled: 1,18,000 payable (1,00,000 + 18,000 GST), only the verified 47,200 counts as verified');

// phone-sized
const ph = await login('acc.member@amuwa.com', { width: 390, height: 800 }, 'main');
await menu(ph, 'Confirmation');
await ph.getByText('Joshi Sweets').first().click();
const overflow = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await expect(overflow <= 1, `nothing overflows sideways on a phone (${overflow}px)`);
await ph.screenshot({ path: `${OUT}/gst-4-phone.png`, fullPage: true });

await expect(errors.length === 0, 'no console or page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
console.log(`=== ALL PAYMENT GST BROWSER TESTS PASSED (${step}) ===`);
await browser.close();
await db.end();
