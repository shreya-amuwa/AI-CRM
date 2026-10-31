// Technical Consultant and Meta Verifier: two independent workflows on ONE customer, in real browsers against the local stack
// (Postgres + PostgREST + gateway + the web app). No credentials live in this file: staff passwords come from E2E_PASSWORDS (made up by
// the runner) and the Meta Verifier made here gets a password made up at run time. See supabase/tests/e2e/README.md.
import { chromium } from 'playwright-core';
import crypto from 'node:crypto';
import fs from 'node:fs';
import pg from 'pg';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const OUT = process.argv[2] || '.';
const TW = process.env.E2E_TAILWIND_FILE ? fs.readFileSync(process.env.E2E_TAILWIND_FILE) : null;
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const PASSWORDS = JSON.parse(process.env.E2E_PASSWORDS || '{}');
const pwOf = email => { if (!PASSWORDS[email]) throw new Error(`E2E_PASSWORDS has no password for ${email}`); return PASSWORDS[email]; };
const secret = () => `${crypto.randomBytes(9).toString('base64url')}-Aa1`;
const sign = p => { const e = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p }); return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`; };
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const idOf = async e => (await q('select id from public.profiles where email=$1', [e]))[0].id;
const call = async (token, method, path, body) => { const r = await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); const j = await r.json(); return { status: r.status, ...j }; };
const as = who => sign({ sub: who, role: 'authenticated' });
const api = async (who, method, path, body) => { const j = await call(as(who), method, path, body); if (!j.success) throw new Error(path + JSON.stringify(j)); return j.data; };

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
let step = 0; const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => { await current?.screenshot({ path: `${OUT}/workflow-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(0, 4)) : ''); process.exit(1); };
const expect = (c, m, detail) => (c ? ok(m) : fail(detail === undefined ? m : `${m} ${JSON.stringify(detail)}`));
process.on('uncaughtException', e => fail(`an unexpected error: ${String(e.message).split('\n').slice(0, 4).join(' | ')}`));
process.on('unhandledRejection', e => fail(`an unexpected error: ${String(e?.message ?? e).split('\n').slice(0, 4).join(' | ')}`));
const open = async (viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport });
  if (TW) await ctx.route(/cdn\.tailwindcss\.com/, r => r.fulfill({ body: TW, contentType: 'application/javascript' }));
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => m.type() === 'error' && !/Failed to load resource|fonts\.g|net::ERR/.test(m.text()) && errors.push('console: ' + m.text()));
  p.ctx = ctx;
  return p;
};
const login = async (email, viewport, ready = 'nav button') => {
  const p = await open(viewport);
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(pwOf(email));
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector(ready, { timeout: 25000, state: 'attached' }).catch(() => fail(`${email} did not reach a dashboard (${ready})`));
  return p;
};
const wait = async (p, sel, m, t = 20000) => { current = p; await p.waitForSelector(sel, { timeout: t }).catch(() => fail(m)); };
const menuItem = (p, label) => p.locator('nav button').filter({ has: p.locator('span', { hasText: new RegExp(`^${label}$`) }) }).first();
const openCustomer = async (p, name) => { await p.getByRole('button', { name: `Open ${name}` }).click(); await wait(p, '[data-testid="workflow-panel"]', `the workflow panel of ${name} did not show`); };
const chipText = (p, testId) => p.locator(`[data-testid="${testId}"] [data-testid$="-chip"]`).first().innerText();
const setStatus = async (p, track, label, note) => {
  await p.getByTestId(`${track}-select`).selectOption({ label });
  if (note) await p.getByTestId(`${track}-note`).fill(note);
  await p.getByTestId(`${track}-save`).click();
};
const waitChip = (p, track, text) => p.waitForFunction(([t, x]) => document.querySelector(`[data-testid="${t}"] [data-testid$="-chip"]`)?.textContent?.trim() === x, [track, text], { timeout: 20000 }).catch(() => fail(`the ${track} chip did not become "${text}"`));

// ------------------------------------------------------------------ fixture: a Meta Verifier, two customers Sales sent
const sa = await idOf('root@amuwa.com');
const rahul = await idOf('rahul@amuwa.com'), arun = await idOf('acc.member@amuwa.com');
const wab = (await q(`select id from departments where slug = 'wabastore'`))[0].id;
const support = (await q(`select id from teams where department_id = $1 and name = 'Support'`, [wab]))[0].id;
const MV = 'meta.flow@amuwa.com';
PASSWORDS[MV] = secret();
await api(sa, 'POST', '/users', { email: MV, fullName: 'Mira Verifier', password: PASSWORDS[MV], role: 'TEAM_MEMBER', teamId: support, metaVerifier: true });
const mk = async (name, company, phone, services, amount, email) => {
  const l = await api(rahul, 'POST', '/pipeline/leads', { name, company, phone, email, leadSource: 'Walk-in', services, notes: 'Wants to buy.' });
  await api(rahul, 'POST', `/pipeline/customers/${l.id}/send-to-accounts`, { amount });
  await api(arun, 'POST', `/pipeline/customers/${l.id}/accounts/order-gst`, { rate: 0 });
  await api(arun, 'POST', `/pipeline/customers/${l.id}/accounts/payments`, { type: 'PART', amount: amount / 2, method: 'CASH', verify: true });
  await api(arun, 'POST', `/pipeline/customers/${l.id}/accounts/payment-confirmed`, { note: 'ok' });
  await q(`update customer_onboarding set forwarded_to_support_at = now(), consultant_started_at = now(), stage = 'SETUP', sent_to_accounts_at = now(), accounts_confirmed_at = now() where customer_id = $1`, [l.id]);
  return l.id;
};
const tag = crypto.randomBytes(2).toString('hex');
const randomPhone = () => `+91 9${crypto.randomInt(0, 1e9).toString().padStart(9, '0').replace(/^(\d{4})(\d{5})$/, '$1 $2')}`;
const META = await mk('Meera Flow', `Flow Meta ${tag} Traders`, randomPhone(), ['WHATSAPP_API'], 40000, `meera.${tag}@flow.example.com`);
const TECH = await mk('Tarun Flow', `Flow Tech ${tag} Co`, randomPhone(), ['AI_CALLING'], 30000, `tarun.${tag}@flow.example.com`);
const META_NAME = `Flow Meta ${tag} Traders`, TECH_NAME = `Flow Tech ${tag} Co`;
ok('fixture: a Meta Verifier, a WhatsApp customer (Meta route) and an AI Calling customer (Technical route), both sent by Sales');

// ------------------------------------------------------------------ 1. the Technical Consultant sees both customers from the start
const tc = await login('consultant@amuwa.com');
await menuItem(tc, 'Onboarding Customers').click();
await wait(tc, `button[aria-label="Open ${META_NAME}"]`, 'the Meta customer is not in the Technical Consultant\'s Onboarding Customers');
await wait(tc, `button[aria-label="Open ${TECH_NAME}"]`, 'the other customer is not in the list');
ok('the Technical Consultant sees the Meta customer from the moment Sales sent it (not hidden until the hand-over) and the other customer');
await tc.waitForFunction(n => [...document.querySelectorAll('li')].find(li => li.textContent.includes(n))?.querySelector('[data-testid="tc-chip"]'), META_NAME, { timeout: 15000 }).catch(() => fail('the list shows no Technical Consultant status chip'));
const metaChipInTc = await tc.locator('li', { hasText: META_NAME }).locator('[data-testid="tc-chip"]').innerText();
await expect(/Verification/.test(metaChipInTc), 'each card carries the Technical Consultant status', metaChipInTc);
await tc.screenshot({ path: `${OUT}/workflow-1-consultant-list.png`, fullPage: true });
await openCustomer(tc, META_NAME);
const panel = await tc.getByTestId('workflow-panel').innerText();
await expect(/Technical Consultant/.test(panel) && /Meta Verifier/.test(panel) && /Onboarding/.test(panel), 'the customer page shows both statuses of the same customer');
await expect(await tc.getByTestId('meta-status-select').count() === 0 && await tc.getByTestId('tc-status-select').count() === 1, 'the Technical Consultant can change their own status but not the Meta Verifier\'s');
await setStatus(tc, 'tc-status', 'On Hold', '');
await wait(tc, '[data-testid="tc-status-error"]', 'On Hold without a reason should be refused');
await expect(/reason/i.test(await tc.getByTestId('tc-status-error').innerText()), 'On Hold needs a reason');
await setStatus(tc, 'tc-status', 'On Hold', 'Waiting for the customer to confirm the plan');
await waitChip(tc, 'tc-status', 'On Hold');
const metaBefore = await chipText(tc, 'meta-status');
await tc.getByTestId('workflow-history-toggle').click();
await expect(/On Hold/.test(await tc.getByTestId('workflow-history').innerText()), 'the change is in the history');
const [after1] = await q(`select w.tc_status, w.meta_status from customer_workflow_status w where w.customer_id = $1`, [META]);
await expect(after1.tc_status === 'ON_HOLD' && after1.meta_status !== null, 'the database holds both statuses on the same customer record', after1);
await tc.screenshot({ path: `${OUT}/workflow-2-consultant-detail.png`, fullPage: true });

// ------------------------------------------------------------------ 2. the Meta Verifier: their own status, the other one read only
const mv = await login(MV);
await menuItem(mv, 'Verification Customers').click();
await wait(mv, `button[aria-label="Open ${META_NAME}"]`, 'the Meta customer is not in the Meta Verifier\'s list');
await expect(await mv.locator(`button[aria-label="Open ${TECH_NAME}"]`).count() === 0, 'the Meta Verifier sees the Meta customer only');
await mv.waitForFunction(n => [...document.querySelectorAll('li')].find(li => li.textContent.includes(n))?.querySelector('[data-testid="meta-chip"]'), META_NAME, { timeout: 15000 }).catch(() => fail('the Meta list shows no Meta status chip'));
await openCustomer(mv, META_NAME);
await expect((await chipText(mv, 'tc-status')) === 'On Hold', 'the Meta Verifier sees the Technical Consultant\'s status (On Hold), read only');
await expect(await mv.getByTestId('tc-status-select').count() === 0 && await mv.getByTestId('meta-status-select').count() === 1, 'and can change only the Meta status');
await setStatus(mv, 'meta-status', 'Documents Pending', 'Address proof is blurred');
await waitChip(mv, 'meta-status', 'Documents Pending');
const [after2] = await q(`select w.tc_status, w.meta_status, o.meta_status as existing from customer_workflow_status w join customer_onboarding o on o.customer_id = w.customer_id where w.customer_id = $1`, [META]);
await expect(after2.meta_status === 'DOCUMENTS_PENDING' && after2.existing === 'DOCUMENTS_REQUIRED' && after2.tc_status === 'ON_HOLD', 'the Meta change went through the existing Meta verification and did not touch the Technical Consultant status', after2);
await mv.screenshot({ path: `${OUT}/workflow-3-meta-detail.png`, fullPage: true });
await mv.ctx.close();

// ------------------------------------------------------------------ 3. Meta onboarding completes: the customer stays with the Technical Consultant
await setStatus(tc, 'tc-status', 'Verification In Progress', 'Customer confirmed');
await waitChip(tc, 'tc-status', 'Verification In Progress');
await q(`update customer_onboarding set meta_status = 'COMPLETED', handover_stage = 'DEPARTMENT_HEAD', to_department_head_at = now() where customer_id = $1`, [META]);
await tc.evaluate(() => window.dispatchEvent(new Event('focus')));      // the screen reloads when the tab is focused again
await waitChip(tc, 'tc-status', 'Add-on Services Recommended');
await expect((await chipText(tc, 'meta-status')) === 'Onboarding Completed', 'Meta onboarding is Completed after the hand-over; the Technical Consultant status is Add-on Services Recommended, not Completed');
await menuItem(tc, 'Onboarding Customers').click();
await wait(tc, `button[aria-label="Open ${META_NAME}"]`, 'after the hand-over the Meta customer left the Technical Consultant\'s dashboard');
ok('the customer is still in the Technical Consultant\'s dashboard after Meta onboarding is completed');
const chipAfter = await tc.locator('li', { hasText: META_NAME }).locator('[data-testid="tc-chip"]').innerText();
await expect(chipAfter === 'Add-on Services Recommended', 'with the status Add-on Services Recommended', chipAfter);

// ------------------------------------------------------------------ 4. add-ons: purchase tracking and the completion rule
const tcId = await idOf('consultant@amuwa.com');
await api(tcId, 'POST', `/pipeline/customers/${META}/consultant/addons-required`, { required: true });
await api(tcId, 'POST', `/pipeline/customers/${META}/addon-request`, { items: [{ serviceCode: 'AI_CALLING', quantity: 1, unitPrice: 12000 }, { name: 'Custom setup', quantity: 1, unitPrice: 2000 }], submit: true });
await openCustomer(tc, META_NAME);
await waitChip(tc, 'tc-status', 'Waiting for Customer Purchase');
ok('the proposal is with Accounts and the customer: Waiting for Customer Purchase');
await setStatus(tc, 'tc-status', 'Completed', 'done');
await wait(tc, '[data-testid="tc-status-error"]', 'completing with an open add-on request should be refused');
await expect(/waiting|payment/i.test(await tc.getByTestId('tc-status-error').innerText()), 'the Technical Consultant cannot complete the customer while the purchase is open');
await expect((await chipText(tc, 'meta-status')) === 'Onboarding Completed', 'Meta onboarding stays Completed through the add-on process');
const salesView = await call(as(rahul), 'GET', `/pipeline/customers/${META}/workflow`);
await expect(salesView.status === 200 && !salesView.data.canSetTechnicalConsultant && !salesView.data.canSetMetaVerifier && salesView.data.technicalConsultant.status === 'WAITING_FOR_CUSTOMER_PURCHASE', 'Sales follows both statuses of its customer, read only');
await tc.ctx.close();

// ------------------------------------------------------------------ 5. the Technical route and the phone layout
const tc2 = await login('consultant@amuwa.com', { width: 390, height: 820 }, 'button[aria-label="Toggle menu"]');
await tc2.getByRole('button', { name: 'Toggle menu' }).click();
await new Promise(r => setTimeout(r, 400));
await menuItem(tc2, 'Onboarding Customers').click();
await wait(tc2, `button[aria-label="Open ${TECH_NAME}"]`, 'the Technical route customer is not in the list on a phone');
await openCustomer(tc2, TECH_NAME);
await expect(/not on the Meta Verifier route/.test(await tc2.getByTestId('meta-status').innerText()), 'a customer on the Technical route has no Meta status');
const overflow = await tc2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await expect(overflow <= 1, 'on a phone the page does not scroll sideways', overflow);
await tc2.screenshot({ path: `${OUT}/workflow-4-phone.png`, fullPage: true });
await tc2.ctx.close();

await expect(errors.length === 0, 'no console or page errors were raised', errors.slice(0, 3));
console.log(`ALL ${step} CONSULTANT / META WORKFLOW CHECKS PASSED`);
await db.end();
await browser.close();
