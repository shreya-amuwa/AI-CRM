// GST of the order and Record payment, in real browsers against the local stack (Postgres + PostgREST + gateway + the web app).
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

// ------------------------------------------------------------------ fixtures: two leads sent to Accounts with an agreed amount BEFORE GST
const rahul = await idOf('rahul@amuwa.com');
const lead = (await api(rahul, 'POST', '/pipeline/leads', { name: 'Meera Joshi', company: 'Joshi Sweets', phone: '+91 98200 11111', leadSource: 'Walk-in', services: ['AI_CALLING'], notes: 'Wants to buy.' })).id;
await api(rahul, 'POST', `/pipeline/customers/${lead}/send-to-accounts`, { amount: 120000 });
const small = (await api(rahul, 'POST', '/pipeline/leads', { name: 'Tiny Order', company: 'Tiny Traders', phone: '+91 98200 22222', leadSource: 'Walk-in', services: ['AI_CALLING'], notes: 'Wants to buy.' })).id;
await api(rahul, 'POST', `/pipeline/customers/${small}/send-to-accounts`, { amount: 14 });

const acc = await login('acc.member@amuwa.com', { width: 1440, height: 900 }, 'nav button');
await menu(acc, 'Confirmation');
await acc.getByText('Joshi Sweets').first().click();
const card = acc.getByTestId('order-gst');
await card.waitFor({ timeout: 10000 });
await acc.screenshot({ path: `${OUT}/gst-1-before-choice.png`, fullPage: true });
const c0 = await card.innerText();
await expect(/Sales agreed ₹1,20,000 before GST/.test(c0), 'the GST card says Sales agreed 1,20,000 before GST');
await expect(/Final payable amount not calculated yet/.test(c0), 'and that the final payable is not calculated until a rate is chosen');
await expect(await acc.getByRole('button', { name: 'Record payment' }).first().isDisabled(), 'Record payment is not available before the rate is chosen');
await expect((await acc.getByTestId('order-gst-rate').inputValue()) === '', 'no rate is pre-selected (never a silent 18%)');
const options = await acc.getByTestId('order-gst-rate').locator('option').allInnerTexts();
await expect(options.some(o => /18% GST/.test(o)) && options.some(o => /5% GST/.test(o)), 'the rates come from the configured list: ' + options.join(' | '));

// Accounts chooses 18%
await acc.getByTestId('order-gst-rate').selectOption('18');
await acc.getByTestId('order-gst-payable').waitFor({ timeout: 10000 });
const c1 = await card.innerText();
await expect(/GST \(18%\)\s*₹21,600/.test(c1) && /Total payable \(including GST\)\s*₹1,41,600/.test(c1), 'GST 21,600 and total payable 1,41,600 are shown');
const o1 = (await q('select order_gst_rate, deal_amount, agreed_amount from customers where id = $1', [lead]))[0];
await expect(Number(o1.order_gst_rate) === 18 && Number(o1.deal_amount) === 141600 && Number(o1.agreed_amount) === 120000, 'saved in the database: rate 18, payable 1,41,600, the agreed 1,20,000 untouched');
await acc.screenshot({ path: `${OUT}/gst-2-chosen.png`, fullPage: true });

// a part payment: plain money received, no GST field in the form
await acc.getByRole('button', { name: 'Record payment' }).first().click();
const d = acc.getByRole('dialog', { name: 'Record payment' });
await d.waitFor({ timeout: 10000 });
const t0 = await d.innerText();
await expect(!(await d.locator('#pay-gst').count()), 'the payment form has no GST field any more');
await expect(/Agreed amount \(before GST\)\s*₹1,20,000/.test(t0) && /GST \(18%\)\s*₹21,600/.test(t0) && /Total payable \(including GST\)\s*₹1,41,600/.test(t0) && /Still to receive\s*₹1,41,600/.test(t0), 'the form shows the agreed amount, the GST, the payable including GST and what is still to receive');
await d.locator('#pay-amount').fill('60000');
await d.locator('#pay-ref').fill('GST-E2E-1');
await d.screenshot({ path: `${OUT}/gst-3-part-form.png` });
await d.getByRole('button', { name: 'Record payment' }).click();
await d.waitFor({ state: 'detached', timeout: 15000 }).catch(() => fail('the dialog did not close after recording'));
const pay = (await q('select amount, taxable_amount, gst_rate, gst_amount, status from customer_payments where customer_id = $1', [lead]))[0];
await expect(Number(pay.amount) === 60000 && pay.taxable_amount === null && pay.gst_amount === null && pay.status === 'PENDING', 'recorded: exactly 60,000 received (no GST on the payment), pending');
const o2 = (await q('select deal_amount from customers where id = $1', [lead]))[0];
await expect(Number(o2.deal_amount) === 141600, 'the payment did not change the payable');
await acc.waitForTimeout(800);
await expect(await acc.getByTestId('order-gst-rate').isDisabled(), 'the rate is locked once a payment exists');

// a full payment: the whole outstanding amount including GST, filled in and read-only
await acc.getByRole('button', { name: 'Record payment' }).first().click();
const d2 = acc.getByRole('dialog', { name: 'Record payment' });
await d2.getByLabel('Full payment').check();
await expect((await d2.locator('#pay-amount').inputValue()) === '81600', 'a full payment fills what is outstanding including GST (81,600)');
await expect(await d2.locator('#pay-amount').evaluate(e => e.readOnly), 'and the amount cannot be typed over');
await d2.locator('#pay-ref').fill('GST-E2E-2');
await d2.getByLabel(/I have received this money and verified it/).check();
await d2.screenshot({ path: `${OUT}/gst-4-full-form.png` });
await d2.getByRole('button', { name: 'Record & verify' }).click();
await d2.waitFor({ state: 'detached', timeout: 15000 }).catch(() => fail('the second dialog did not close'));
const c = (await q('select deal_amount, amount_received, amount_verified from customers where id = $1', [lead]))[0];
await expect(Number(c.deal_amount) === 141600 && Number(c.amount_received) === 141600 && Number(c.amount_verified) === 81600, 'the order is fully recorded: 1,41,600 payable, only the verified 81,600 counts as verified');

// the small example: 14 + 18% = 16.52 -> payable 17 in whole rupees
await acc.goto(BASE + '/');
await menu(acc, 'Confirmation');
await acc.getByText('Tiny Traders').first().click();
await acc.getByTestId('order-gst').waitFor({ timeout: 10000 });
await acc.getByTestId('order-gst-rate').selectOption('18');
await acc.getByTestId('order-gst-payable').waitFor({ timeout: 10000 });
const t14 = await acc.getByTestId('order-gst').innerText();
await expect(/Agreed amount \(before GST\)\s*₹14/.test(t14) && /GST \(18%\)\s*₹2\.52/.test(t14) && /Rounded to whole rupees\s*₹0\.48/.test(t14) && /Total payable \(including GST\)\s*₹17/.test(t14), '14 + 18%: GST 2.52, rounded to whole rupees, payable 17');
await acc.screenshot({ path: `${OUT}/gst-5-fourteen.png`, fullPage: true });
await acc.getByRole('button', { name: 'Record payment' }).first().click();
const d3 = acc.getByRole('dialog', { name: 'Record payment' });
const t3 = await d3.innerText();
await expect(/Total payable \(including GST\)\s*₹17/.test(t3) && /Still to receive\s*₹17/.test(t3), 'the form shows payable 17 and still to receive 17 (no contradictory figures)');
await d3.locator('#pay-amount').fill('16.52');
await d3.locator('#pay-ref').fill('GST-E2E-3');
await d3.getByRole('button', { name: 'Record payment' }).click();
await expect(/whole rupees/i.test(await d3.innerText()), '16.52 is refused: whole rupees only');
await expect((await q('select count(*)::int n from customer_payments where customer_id = $1', [small]))[0].n === 0, 'nothing was recorded');
await d3.getByLabel('Full payment').check();
await expect((await d3.locator('#pay-amount').inputValue()) === '17', 'Full payment uses 17');
await d3.getByLabel(/I have received this money and verified it/).check();
await d3.getByRole('button', { name: 'Record & verify' }).click();
await d3.waitFor({ state: 'detached', timeout: 15000 }).catch(() => fail('the dialog for the 14 order did not close'));
const c14 = (await q('select deal_amount, amount_verified, payment_status from customers where id = $1', [small]))[0];
await expect(Number(c14.deal_amount) === 17 && Number(c14.amount_verified) === 17 && c14.payment_status === 'FULLY_PAID', 'the order of 14 is fully paid with 17');

// ------------------------------------------------------------------ a paid invoice for each payment: 14 + 18% = payable 17, paid as 10 (part) and 7 (full)
const split = (await api(rahul, 'POST', '/pipeline/leads', { name: 'Ashish Split', company: 'Ashish Traders', email: 'ashish.split@example.com', phone: '+91 98200 33333', address: 'Shop 4, MG Road, Pune 411001, Maharashtra', leadSource: 'Walk-in', services: ['AI_CALLING'], notes: 'Pays in two parts.' })).id;
await api(rahul, 'POST', `/pipeline/customers/${split}/send-to-accounts`, { amount: 14 });
await acc.goto(BASE + '/');
await menu(acc, 'Confirmation');
await acc.getByText('Ashish Traders').first().click();
await acc.getByTestId('order-gst-rate').selectOption('18');
await acc.getByTestId('order-gst-payable').waitFor({ timeout: 10000 });
await acc.getByRole('button', { name: 'Record payment' }).first().click();
const d4 = acc.getByRole('dialog', { name: 'Record payment' });
await d4.locator('#pay-amount').fill('10');
await d4.locator('#pay-ref').fill('SPLIT-1');
await expect(await d4.getByLabel(/Make the paid invoice for this payment/).count() === 0, 'the invoice box appears only once the payment is verified');
await d4.getByLabel(/I have received this money and verified it/).check();
await expect(await d4.getByLabel(/Make the paid invoice for this payment/).isChecked(), 'and it is ticked by default');
await acc.screenshot({ path: `${OUT}/gst-7-invoice-box.png`, fullPage: true });
await d4.getByRole('button', { name: 'Record & verify' }).click();
await d4.waitFor({ state: 'detached', timeout: 20000 }).catch(() => fail('the dialog for the first part payment did not close'));
await acc.getByText(/Paid invoice INV-/).first().waitFor({ timeout: 20000 }).catch(() => fail('the first payment shows no invoice'));
await acc.getByRole('button', { name: 'Record payment' }).first().click();
const d5 = acc.getByRole('dialog', { name: 'Record payment' });
await d5.getByLabel('Full payment').check();
await expect((await d5.locator('#pay-amount').inputValue()) === '7', 'the full payment is the 7 still to receive');
await d5.locator('#pay-ref').fill('SPLIT-2');
await d5.getByLabel(/I have received this money and verified it/).check();
await d5.getByRole('button', { name: 'Record & verify' }).click();
await d5.waitFor({ state: 'detached', timeout: 20000 }).catch(() => fail('the dialog for the second payment did not close'));
await acc.waitForFunction(() => (document.body.innerText.match(/Paid invoice INV-/g) || []).length >= 2, null, { timeout: 20000 }).catch(() => fail('the second payment shows no invoice of its own'));
const inv2 = await q('select count(*)::int n, count(distinct invoice_id)::int d from payment_invoices where customer_id = $1', [split]);
await expect(inv2[0].n === 2 && inv2[0].d === 2, 'two payments, two different paid invoices');
const sums = (await q('select sum(total_amount)::numeric s from generated_invoices where customer_id = $1', [split]))[0];
await expect(Number(sums.s) <= 17 && Number(sums.s) >= 16.5, 'together the invoices are worth what was received (not more than 17)');
await acc.getByRole('list', { name: 'Payment history' }).scrollIntoViewIfNeeded();
await acc.screenshot({ path: `${OUT}/gst-8-two-invoices.png`, fullPage: true });

// phone-sized
const ph = await login('acc.member@amuwa.com', { width: 390, height: 800 }, 'main');
await menu(ph, 'Confirmation');
await ph.getByText('Joshi Sweets').first().click();
await ph.getByTestId('order-gst').waitFor({ timeout: 10000 });
const overflow = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await expect(overflow <= 1, `nothing overflows sideways on a phone (${overflow}px)`);
await ph.screenshot({ path: `${OUT}/gst-6-phone.png`, fullPage: true });

await expect(errors.length === 0, 'no console or page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
console.log(`=== ALL PAYMENT GST BROWSER TESTS PASSED (${step}) ===`);
await browser.close();
await db.end();
