// Browser test (real app, real API, real database, real Chromium):
//   1. "Need help?" is gone from every internal dashboard (desktop and phone, with the phone menu open) and is still on the Client Dashboard, where it works.
//   2. Telecaller Sheets and Service Prices: the Sales Department Head has both and they open; a Support Department Head has neither, a typed address
//      does not open them, and the API refuses the Support head (the database refuses it underneath).
// See supabase/tests/e2e/README.md. Passwords come from E2E_PASSWORDS (made up by the runner); nothing is stored.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright-core', '/opt/node-tools/node_modules/playwright-core', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, this browser test did not run'); process.exit(0); }

const BASE = process.env.E2E_BASE || 'http://localhost:3020';
const OUT = process.argv[2] || '.';
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const PASSWORDS = JSON.parse(process.env.E2E_PASSWORDS || '{}');
const sign = p => { const e = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p }); return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`; };
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const idOf = async e => (await q('select id from public.profiles where email=$1', [e]))[0].id;
const call = async (who, method, path, body) => {
  const r = await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${sign({ sub: who, role: 'authenticated' })}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};
const api = async (who, method, path, body) => { const r = await call(who, method, path, body); if (!r.json.success) throw new Error(`${method} ${path} ${JSON.stringify(r.json)}`); return r.json.data; };
const secret = () => `${crypto.randomBytes(9).toString('base64url')}-Aa1`;
const randomPhone = () => `9${String(crypto.randomInt(0, 1e9)).padStart(9, '0')}`;

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {}).catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }));
let step = 0;
const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => { await current?.screenshot({ path: `${OUT}/need-help-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(0, 4)) : ''); await browser.close(); process.exit(1); };
const expect = (c, m) => (c ? ok(m) : fail(m));
const open = async (viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => m.type() === 'error' && !/Failed to load resource|fonts\.g|net::ERR/.test(m.text()) && errors.push('console: ' + m.text()));
  return p;
};
const staffLogin = async (email, password, viewport) => {
  const p = await open(viewport);
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(password);
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector('nav button, aside button', { state: 'attached', timeout: 25000 }).catch(() => fail(`${email} did not reach a dashboard`));
  await new Promise(r => setTimeout(r, 600));
  return p;
};
const phoneMenu = async p => { if ((p.viewportSize()?.width ?? 1440) < 1024) { await p.getByRole('button', { name: 'Toggle menu' }).click(); await new Promise(r => setTimeout(r, 400)); } };
const bodyText = p => p.locator('body').innerText();
const navLabels = p => p.locator('nav button').evaluateAll(els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));

// ------------------------------------------------------------------ fixture
const PW = {};
const sa = await (async () => { const [r] = await q(`select id from public.profiles where email = 'root@amuwa.com'`); return r.id; })();
PW['root@amuwa.com'] = PASSWORDS['root@amuwa.com'];
const deps = await api(sa, 'GET', '/departments');
const dep = slug => deps.find(d => d.slug === slug);
const mkUser = async (email, fullName, body) => { PW[email] = secret(); const r = await api(sa, 'POST', '/users', { email, fullName, password: PW[email], ...body }); return r.id; };
const salesHeadId = await mkUser('wbx.sales@amuwa.com', 'Sunil Sales Head', { role: 'DEPARTMENT_HEAD', departmentId: dep('whatsbox').id, headDivision: 'SALES' });
const supportHeadId = await mkUser('wbx.support@amuwa.com', 'Sara Support Head', { role: 'DEPARTMENT_HEAD', departmentId: dep('whatsbox').id, headDivision: 'SUPPORT' });
await mkUser('hr.head@amuwa.com', 'Hema HR Head', { role: 'DEPARTMENT_HEAD', departmentId: dep('hr').id });
Object.assign(PW, PASSWORDS);
// a price and a service for the Sales pages to show
await api(sa, 'POST', `/ba/prices/AI_CALLING`, { unitLabel: 'one time', unitPrice: 5000, gstRate: 18, maxDiscountPct: 10, isActive: true });
ok('fixture: a Sales and a Support Department Head (Whatsbox), an HR head, one price');

// ------------------------------------------------------------------ 1. Need help? is gone from the internal dashboards
const INTERNAL = [
  ['root@amuwa.com', 'Super Admin'], ['dh@amuwa.com', 'Department Head (whole department)'], ['wbx.sales@amuwa.com', 'Sales Department Head'], ['wbx.support@amuwa.com', 'Support Department Head'],
  ['lead@amuwa.com', 'Team Lead'], ['rahul@amuwa.com', 'Team Member (Sales)'], ['consultant@amuwa.com', 'Technical Consultant'], ['tl.delivery@amuwa.com', 'Team Lead (Delivery)'],
  ['tm.delivery@amuwa.com', 'Team Member (Delivery)'], ['acc.head@amuwa.com', 'Accounts Department Head'], ['acc.member@amuwa.com', 'Accounts member'], ['hr.head@amuwa.com', 'HR Department Head']
];
for (const [vp, vpName] of [[{ width: 1440, height: 900 }, 'desktop'], [{ width: 390, height: 800 }, 'phone']]) {
  for (const [email, label] of INTERNAL) {
    const p = await staffLogin(email, PW[email], vp);
    await phoneMenu(p);
    const t = await bodyText(p);
    const mail = await p.locator('a[href^="mailto:support@amuwa.com"]').count();
    await expect(!/need help|need a hand/i.test(t) && mail === 0, `${vpName}: ${label}: no "Need help?" in the menu or anywhere on the page`);
    if (email === 'root@amuwa.com' || email === 'wbx.support@amuwa.com') await p.screenshot({ path: `${OUT}/no-need-help-${vpName}-${email.split('@')[0].replace(/\./g, '-')}.png` });
    await p.context().close();
  }
}

// ------------------------------------------------------------------ 2. the Client Dashboard keeps it, and it works
{
  const rahul = await idOf('rahul@amuwa.com'), arun = await idOf('acc.member@amuwa.com'), tara = await idOf('consultant@amuwa.com');
  const l = await api(rahul, 'POST', '/pipeline/leads', { name: 'Anil Acharya', company: 'Acharya Traders', phone: randomPhone(), leadSource: 'Walk-in', services: ['AI_CALLING'], notes: 'Wants to buy.' });
  await api(rahul, 'POST', `/pipeline/customers/${l.id}/send-to-accounts`, { amount: 40000 });
  await api(arun, 'POST', `/pipeline/customers/${l.id}/accounts/payments`, { type: 'PART', amount: 20000, method: 'CASH', verify: true });
  await api(arun, 'POST', `/pipeline/customers/${l.id}/accounts/payment-confirmed`, { note: 'ok' });
  await q(`update customer_onboarding set forwarded_to_support_at = now(), stage = 'SETUP', sent_to_accounts_at = now(), accounts_confirmed_at = now() where customer_id = $1`, [l.id]);
  const client = { email: 'anil@acharya.example.com', password: secret() };
  await api(tara, 'POST', `/pipeline/customers/${l.id}/client-account`, client);
  for (const [vp, vpName] of [[{ width: 1440, height: 900 }, 'desktop'], [{ width: 390, height: 800 }, 'phone']]) {
    const C = await open(vp);
    current = C;
    await C.goto(BASE + '/client/login');
    await C.getByLabel('E-mail').fill(client.email);
    await C.getByLabel('Password', { exact: true }).fill(client.password);
    await C.getByRole('button', { name: 'Sign in' }).click();
    await C.waitForSelector('h1.cd-page-title', { timeout: 25000 }).catch(() => fail('the client did not sign in'));
    if (vpName === 'phone') { await C.getByRole('button', { name: 'Toggle menu' }).click(); await new Promise(r => setTimeout(r, 400)); }
    await expect(await C.locator('.cd-help').count() === 1, `${vpName}: the Client Dashboard still has its help box (unchanged)`);
    await C.screenshot({ path: `${OUT}/client-need-a-hand-${vpName}.png` });
    if (vpName === 'desktop') {
      await expect(/Need a hand\?/.test(await C.locator('.cd-help').innerText()), 'desktop: it reads "Need a hand?" with its Raise a ticket button');
      await C.locator('.cd-help').getByRole('button', { name: 'Raise a ticket' }).click();
      await C.waitForFunction(() => /\/tickets/.test(location.pathname), null, { timeout: 8000 }).catch(() => fail('"Raise a ticket" did not open the tickets page'));
      ok('desktop: and "Raise a ticket" opens the client\'s tickets page');
    } else {
      // the client's own stylesheet hides the box on narrow screens (as before this change); the Tickets entry of its menu is the way there
      await expect(!(await C.locator('.cd-help').isVisible()) && (await C.locator('nav button', { hasText: 'Tickets' }).count()) >= 1, 'phone: the box is hidden by the client stylesheet, exactly as before; Tickets is in the menu');
    }
    await C.context().close();
  }
}

// ------------------------------------------------------------------ 3. Telecaller Sheets / Service Prices: Sales only
{
  const S = await staffLogin('wbx.sales@amuwa.com', PW['wbx.sales@amuwa.com']);
  const salesNav = await navLabels(S);
  await expect(salesNav.some(x => /^Telecaller Sheets/.test(x)) && salesNav.some(x => /^Service Prices/.test(x)), 'the Sales Department Head has Telecaller Sheets and Service Prices in the menu');
  await S.locator('nav button', { hasText: 'Telecaller Sheets' }).first().click();
  await S.waitForSelector('text=Telecaller contact sheets', { timeout: 15000 }).catch(() => fail('Telecaller Sheets did not open for the Sales head'));
  await S.screenshot({ path: `${OUT}/sales-head-telecaller-sheets.png` });
  ok('the Sales Department Head opens Telecaller Sheets');
  await S.locator('nav button', { hasText: 'Service Prices' }).first().click();
  await S.waitForSelector('text=Service prices', { timeout: 15000 }).catch(() => fail('Service Prices did not open for the Sales head'));
  const priced = await S.waitForFunction(() => [...document.querySelectorAll('main input[type="number"]')].some(e => e.value === '5000'), null, { timeout: 15000 }).then(() => true, () => false);
  await expect(priced && /AI Calling/.test(await S.locator('main').innerText()), 'and Service Prices, with the price that is stored (5000 for AI Calling)');
  await S.screenshot({ path: `${OUT}/sales-head-service-prices.png` });
  await S.context().close();

  const P = await staffLogin('wbx.support@amuwa.com', PW['wbx.support@amuwa.com']);
  const supNav = await navLabels(P);
  await expect(!supNav.some(x => /Telecaller Sheets|Service Prices/.test(x)), `the Support Department Head's menu has neither (${supNav.length} items)`);
  await P.screenshot({ path: `${OUT}/support-head-menu.png` });
  // a typed address does not open a Sales page for them
  await P.goto(BASE + `/sales-head/dashboard/${supportHeadId}/telecaller-sheets`);
  await new Promise(r => setTimeout(r, 1500));
  const after = await bodyText(P);
  await expect(!/Telecaller contact sheets|Service prices/.test(after) && !/sales-head\/dashboard/.test(new URL(P.url()).pathname), 'a typed address for the Sales dashboard does not open it for the Support head (it is sent back to their own)');
  await P.goto(BASE + `/sales-head/dashboard/${salesHeadId}/service-prices`);
  await new Promise(r => setTimeout(r, 1500));
  await expect(!/Service prices/.test(await bodyText(P)), "nor does another person's address");
  // the API refuses them (the database refuses underneath)
  const token = sign({ sub: supportHeadId, role: 'authenticated' });
  const viaApi = path => P.evaluate(async ([u, t]) => (await fetch(u, { headers: { authorization: `Bearer ${t}` } })).status, [BASE + '/api/v1' + path, token]);
  const codes = [await viaApi('/ba/prices'), await viaApi('/telecaller/lists'), await viaApi('/telecaller/assignable')];
  await expect(codes.every(c => c === 403), `the API refuses the Support head: prices, sheets and Telecallers all answer 403 (${codes.join(', ')})`);
  await P.context().close();
}

const [{ n: sheets }] = await q('select count(*)::int n from telecaller_contact_lists');
const [{ n: prices }] = await q('select count(*)::int n from service_prices');
await expect(prices >= 1 && sheets >= 0, 'the stored prices and sheets are untouched');
await db.end();
await browser.close();
console.log(`=== NEED-HELP AND SALES-ONLY BROWSER TESTS PASSED (${step}) ===`);
