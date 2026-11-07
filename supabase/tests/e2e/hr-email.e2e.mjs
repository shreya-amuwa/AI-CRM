// HR e-mail automation runs on the backend only, checked in real browsers against the local stack (Postgres + PostgREST + gateway + the web app).
//   - the HR dashboard has no "Email Automation" page or controls anywhere in its menu
//   - the probation approval step (a person's decision, not an e-mail control) is on its own page and still works
//   - the server's scheduler (the Vercel Cron endpoint) queues and processes the birthday, anniversary and 7-day confirmation e-mails
//     with nobody signed in, once per occasion
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
  await current?.screenshot({ path: `${OUT}/hr-email-fail.png`, fullPage: true }).catch(() => {});
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



// ------------------------------------------------------------------ fixture: an HR Department Head and employees with dates
// Rahul: birthday and 3rd work anniversary today. Neha: joined six months minus seven days ago, so her confirmation reminder is due today.
const root = await idOf('root@amuwa.com');
const hrDept = (await api(root, 'GET', '/departments')).find(d => d.slug === 'hr');
const hrPw = crypto.randomBytes(9).toString('base64url') + '-Aa1';
await api(root, 'POST', '/users', { email: 'hr.head@amuwa.com', fullName: 'Payal HR', password: hrPw, role: 'DEPARTMENT_HEAD', departmentId: hrDept.id,
  details: { designation: 'HR Admin Head', joiningDate: '2026-01-05', dateOfBirth: '1990-05-06', bloodGroup: 'B+', contactNumber: '+91 91234 56789', emergencyContact: '+91 98765 43210' } });
PASSWORDS['hr.head@amuwa.com'] = hrPw;
const rahul = await idOf('rahul@amuwa.com'), neha = await idOf('neha@amuwa.com');
await q(`insert into employee_personal_details (profile_id, date_of_birth, joining_date) values
  ($1, (current_date - interval '30 years')::date, (current_date - interval '3 years')::date),
  ($2, ((current_date + 40) - interval '28 years')::date, ((current_date + 7) - interval '6 months')::date)
  on conflict (profile_id) do update set date_of_birth = excluded.date_of_birth, joining_date = excluded.joining_date`, [rahul, neha]);

// the scheduler, with nobody signed in: exactly what Vercel Cron calls at 09:00 India time
const DISPATCH = process.env.AUTOMATION_DISPATCH_SECRET;
const tick = () => fetch(BASE + '/api/v1/internal/automations/dispatch', { method: 'GET', headers: { authorization: `Bearer ${DISPATCH}` } });
await expect((await fetch(BASE + '/api/v1/internal/automations/dispatch')).status === 401, 'the scheduler endpoint refuses a call without the secret');
const first = await tick(); if (first.status !== 200) console.error(first.status, await first.text());
await expect(first.status === 200, 'the scheduler runs without anybody opening the dashboard');
const queued = async () => (await q(`select kind, payload ->> 'employeeName' as who, status from public.hr_email_events where kind in ('BIRTHDAY', 'ANNIVERSARY', 'PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR')`));
let rows = await queued();
await expect(rows.some(r => r.kind === 'BIRTHDAY' && r.who === 'Rahul Mehta') && rows.some(r => r.kind === 'ANNIVERSARY' && r.who === 'Rahul Mehta'),
  'the birthday and anniversary e-mails are queued from the real employee record (for 9:00 AM on the day)');
await expect(rows.some(r => r.kind === 'PROBATION_REMINDER_EMPLOYEE' && r.who === 'Neha Shah') && rows.some(r => r.kind === 'PROBATION_REMINDER_HR' && r.who === 'Neha Shah'),
  'the confirmation reminder is queued for the employee and for HR, 7 days before the six-month date');
const before = rows.length;
await tick();
await expect((await queued()).length === before, 'running the scheduler again queues no duplicates');

const p = await login('hr.head@amuwa.com', { width: 1440, height: 900 }, 'text=Probation Confirmations');
const nav = await p.locator('#app-sidebar').innerText();
await expect(!/Email Automation/i.test(nav), 'the HR side panel has no Email Automation entry');
await expect(!/Email Automation|Run the check now|Preview e-mail template/i.test(await p.locator('body').innerText()), 'no e-mail automation controls on the HR dashboard');
await p.locator('#app-sidebar').getByText('Probation Confirmations', { exact: true }).first().click();
await p.waitForSelector('section[aria-label="Probation confirmations"]', { timeout: 20000 }).catch(() => fail('the probation confirmations page did not appear'));
await p.waitForSelector('text=Neha Shah', { timeout: 20000 }).catch(() => fail('the employee in probation is not listed'));
const page = await text(p);
await expect(/Approve confirmation/.test(page), 'the HR Department Head can approve a confirmation');
await expect(!/Run the check now|Refresh|Email history|Dates to fix|Sent \(30 days\)/.test(page), 'the page has no e-mail run, refresh, history or counts');
await p.screenshot({ path: `${OUT}/hr-1-probation.png`, fullPage: true });
await p.getByRole('button', { name: 'Close', exact: true }).first().click();
await p.getByPlaceholder('e.g. confirmed earlier, on paper').fill('confirmed earlier, on paper');
await p.getByRole('button', { name: 'Close it' }).click();
await p.waitForSelector('text=was closed without e-mails', { timeout: 20000 }).catch(() => fail('closing a confirmation did not work'));
await expect(/Closed/.test(await text(p)), 'closing a confirmation is recorded');
// a phone: nothing overflows sideways
await p.setViewportSize({ width: 390, height: 800 });
await p.reload();
await p.waitForTimeout(3000);
await p.getByRole('button', { name: 'Toggle menu' }).click().catch(() => {}); await p.waitForTimeout(400);
await expect(!/Email Automation/i.test(await p.locator('body').innerText()), 'a phone: no Email Automation entry either');
await expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'a phone: the page does not scroll sideways');
await p.screenshot({ path: `${OUT}/hr-2-phone.png` });
console.log(`=== ALL HR EMAIL AUTOMATION (BACKEND ONLY) BROWSER TESTS PASSED (${step}) ===`);
await browser.close();
process.exit(0);
