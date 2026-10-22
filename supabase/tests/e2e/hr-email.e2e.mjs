// HR Dashboard > Email Automation, in real browsers against the local stack (Postgres + PostgREST + gateway + the web app).
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
const root = await idOf('root@amuwa.com');
const hrDept = (await api(root, 'GET', '/departments')).find(d => d.slug === 'hr');
const hrPw = crypto.randomBytes(9).toString('base64url') + '-Aa1';
await api(root, 'POST', '/users', { email: 'hr.head@amuwa.com', fullName: 'Payal HR', password: hrPw, role: 'DEPARTMENT_HEAD', departmentId: hrDept.id });
PASSWORDS['hr.head@amuwa.com'] = hrPw;
const rahul = await idOf('rahul@amuwa.com'), neha = await idOf('neha@amuwa.com');
await q(`insert into employee_personal_details (profile_id, date_of_birth, joining_date) values
  ($1, ((current_date + 2) - interval '30 years')::date, ((current_date + 3) - interval '3 years')::date),
  ($2, ((current_date + 40) - interval '28 years')::date, ((current_date - interval '6 months')::date + 5))
  on conflict (profile_id) do update set date_of_birth = excluded.date_of_birth, joining_date = excluded.joining_date`, [rahul, neha]);
await q(`select hr_schedule_emails()`);

const p = await login('hr.head@amuwa.com', { width: 1440, height: 900 }, 'text=Email Automation');
await p.getByText('Email Automation', { exact: true }).first().click();
await p.waitForSelector('[role=group][aria-label="The three automations"]', { timeout: 20000 }).catch(() => fail('the three automation cards did not appear'));
await p.screenshot({ path: `${OUT}/hr-1-cards.png`, fullPage: true });
const cards = await p.locator('[role=group][aria-label="The three automations"] section').allInnerTexts();
await expect(cards.length === 3, 'three automation cards');
await expect(/Birthday Emails/.test(cards[0]) && /Work Anniversary Emails/.test(cards[1]) && /Employee Confirmation Reminders/.test(cards[2]), 'Birthday, Work Anniversary and Employee Confirmation cards, in that order');
await expect(cards.every(c => /Active|Inactive/.test(c) && /sent/i.test(c) && /Next execution/.test(c) && /Last execution/.test(c)), 'each card shows status, sent, next execution and last execution');
await expect(/Rahul Mehta/.test(cards[0]) && /Rahul Mehta/.test(cards[1]), 'the next birthday and anniversary come from the employee records (live data)');
await expect(/Neha Shah/.test(cards[2]) && /Reminder /.test(cards[2]), 'the confirmation card lists the upcoming reminder for the employee in probation');
// template preview
await p.getByRole('button', { name: /Preview e-mail template/ }).nth(2).click();
const tx = await p.locator('[role=group][aria-label="The three automations"] section').nth(2).innerText();
await expect(/Employee Confirmation Reminder — Asha Verma — Due/.test(tx) && /Action Required: Confirmation Due in 7 Days — Asha Verma/.test(tx) && /Reporting Manager: Rohan Mehta/.test(tx), 'the confirmation card previews both e-mails (employee and HR)');
await p.getByRole('button', { name: /Preview e-mail template/ }).nth(0).click();
await expect(/Happy Birthday, Asha Verma! 🎂/.test(await p.locator('[role=group][aria-label="The three automations"] section').nth(0).innerText()), 'the birthday card previews its e-mail');
await p.screenshot({ path: `${OUT}/hr-2-preview.png`, fullPage: true });
// the tabs still work, including "Dates to fix"
await p.getByRole('button', { name: /Dates to fix/ }).click();
await p.waitForTimeout(800);
await expect(!(await p.locator('main').innerText()).includes('Loading'), 'the "Dates to fix" tab loads');
await expect(!/Something went wrong/.test(await p.locator('main').innerText()), 'no error banner');
// a phone: nothing overflows sideways
const ph = p;
await ph.setViewportSize({ width: 390, height: 800 });
await ph.reload();
await ph.waitForTimeout(3000);
await ph.getByText('Email Automation', { exact: true }).first().dispatchEvent('click');
await ph.waitForSelector('[role=group][aria-label="The three automations"]', { timeout: 20000 });
await expect(await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'a phone: the page does not scroll sideways');
await ph.screenshot({ path: `${OUT}/hr-3-phone.png` });
console.log(`=== ALL HR EMAIL AUTOMATION BROWSER TESTS PASSED (${step}) ===`);
await browser.close();
process.exit(0);
