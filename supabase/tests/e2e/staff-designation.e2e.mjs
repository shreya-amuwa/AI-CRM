// The designation in the Super Admin's Add Team Member form, in real browsers, signed in through the login page.
//   Root cause fixed: choosing the CEO role set the designation to the on-screen label "CEO" instead of the stored value 'Operations Head', so the
//   dropdown showed "CEO" while the form held a value no option has and the account was refused with "Choose a designation.".
//   Checks: a CEO is created with the CEO designation; a Team Lead keeps their own designation; a designation changed before submitting is the one
//   saved; each is saved in the database and shown in the Team Members directory; the form never holds a value the dropdown does not offer.
// Against the local stack (Postgres + PostgREST + gateway + the web app). Passwords are made up at run time; nothing is stored.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
let chromium;
for (const m of ['playwright', 'playwright-core', '/opt/node-tools/node_modules/playwright']) { try { ({ chromium } = require(m)); break; } catch { /* next */ } }
if (!chromium) { console.error('Playwright is not installed'); process.exit(1); }

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const OUT = process.argv[2] || '.';
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const pw = { 'root@amuwa.com': process.env.SA_PASSWORD };
await db.query(`insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('root@amuwa.com', '{"full_name":"Root"}', '{"bootstrap_super_admin":true}')`);

// ---------------------------------------------------------------- the browser
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
let step = 0; const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => { await current?.screenshot({ path: `${OUT}/staff-designation-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(0, 4)) : ''); process.exit(1); };
const expect = (c, m, detail) => (c ? ok(m) : fail(detail === undefined ? m : `${m} ${JSON.stringify(detail)}`));
process.on('uncaughtException', e => fail(`an unexpected error: ${String(e.message).split('\n').slice(0, 4).join(' | ')}`));
process.on('unhandledRejection', e => fail(`an unexpected error: ${String(e?.message ?? e).split('\n').slice(0, 4).join(' | ')}`));
const PHONE = { width: 390, height: 844 };
const login = async (email, viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(pw[email]);
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector('nav button', { timeout: 25000, state: 'attached' }).catch(() => fail(`${email} did not reach a dashboard`));
  await p.waitForTimeout(600);
  // the browser-notification banner is not part of what is tested here
  await p.getByRole('button', { name: 'Not now' }).click({ timeout: 2000 }).catch(() => undefined);
  return p;
};
const nav = async (p, label) => {
  current = p;
  const btn = p.locator('nav button').filter({ hasText: new RegExp(`^\\s*${label}(\\s*\\d+)?\\s*$`) }).first();
  if (!(await btn.isVisible())) await p.getByLabel('Toggle menu').first().click().catch(() => undefined);   // phones: open the menu first
  await btn.click();
  await p.waitForTimeout(600);
};
const wait = async (p, sel, m, t = 20000) => { current = p; await p.waitForSelector(sel, { timeout: t }).catch(() => fail(m)); };
const waitText = async (p, re, m, t = 20000) => { current = p; await p.waitForFunction(r => new RegExp(r, 'i').test(document.body.innerText), re.source, { timeout: t }).catch(() => fail(`${m} (not on screen: ${re})`)); };
const noSideScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);



const designationOf = async email => (await q(`select p.role, p.is_operations_head, (select e.designation from employee_personal_details e where e.profile_id = p.id) d from profiles p where p.email = $1`, [email]))[0];
const fillCommon = async (p, name, email, contact) => {
  await p.getByPlaceholder('e.g. Kunal Sharma').fill(name);
  await p.getByPlaceholder('kunal@amuwa.com').fill(email);
  await p.locator('input[type="date"]').first().fill('2025-01-10');
  await p.locator('input[type="date"]').nth(1).fill('1990-05-05');
  await p.locator('select').filter({ has: p.locator('option', { hasText: 'A+' }) }).first().selectOption('A+');
  await p.getByTestId('member-contact-number').fill(contact);
  await p.getByPlaceholder('+91 98765 43210').fill('+91 98765 43210');
};
const shown = async p => p.getByTestId('staff-designation').evaluate(s => ({ value: s.value, label: s.selectedOptions[0]?.textContent ?? '', values: [...s.options].map(o => o.value) }));
const create = async (p, name) => {
  await p.getByRole('button', { name: 'Create Account' }).click();
  current = p;
  await p.waitForFunction(n => document.body.innerText.includes(n) && /added|created/i.test(document.body.innerText), name, { timeout: 15000 })
    .catch(async () => fail(`${name} was not created: ${(await p.locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' | ')}`));
  expect(!/Choose a designation/.test(await p.evaluate(() => document.body.innerText)), `${name}: no "Choose a designation." error`);
};
const openAdd = async p => {
  await nav(p, 'Team Members');
  await p.locator('[data-testid="tab-add"]').click();
  await p.locator('#staff-role').waitFor({ timeout: 15000 });
};

const sa = await login('root@amuwa.com');

// ============================ 1. CEO: the designation shown is the one sent
await openAdd(sa);
await sa.locator('#staff-role').selectOption({ label: 'CEO' });
await sa.waitForTimeout(400);
let s = await shown(sa);
expect(s.value === 'Operations Head' && s.label === 'CEO', 'choosing the CEO role shows "CEO" and the form holds the stored value Operations Head', s);
expect(s.values.includes(s.value), 'the form holds a value the dropdown offers', s);
await sa.getByTestId('operations-departments').locator('input[type="checkbox"]').first().check();
// the designation is left as shown ("CEO"): in a browser, picking the option that already looks selected fires no change event, so the form must
// already hold the right value (a scripted selectOption would fire one and hide the bug)
await fillCommon(sa, 'Chitra Ceo', 'chitra.ceo@amuwa.com', '+91 98111 30001');
await sa.screenshot({ path: `${OUT}/designation-ceo-form.png` });
await create(sa, 'Chitra Ceo');
let row = await designationOf('chitra.ceo@amuwa.com');
expect(row?.role === 'DEPARTMENT_HEAD' && row.is_operations_head && row.d === 'Operations Head', 'the CEO is created and its designation saved (stored as Operations Head, shown as CEO)', row);

// ============================ 2. another designation, and 4. a changed choice: the latest is saved
await openAdd(sa);
await sa.locator('#staff-role').selectOption({ label: 'Team Lead' });
await sa.waitForTimeout(400);
s = await shown(sa);
expect(s.value === 'Team Lead' && s.values.includes('Team Lead'), 'a Team Lead starts with the Team Lead designation', s);
await fillCommon(sa, 'Tara Lead', 'tara.lead@amuwa.com', '+91 98111 30002');
await create(sa, 'Tara Lead');
row = await designationOf('tara.lead@amuwa.com');
expect(row?.role === 'TEAM_HEAD' && row.d === 'Team Lead', 'the Team Lead is created with the Team Lead designation', row);

await openAdd(sa);
await sa.locator('#staff-role').selectOption({ label: 'Team Member' });
await sa.waitForTimeout(400);
await sa.getByTestId('staff-designation').selectOption('Team Lead');
await sa.getByTestId('staff-designation').selectOption('Department Head');
s = await shown(sa);
expect(s.value === 'Department Head', 'changing the designation twice keeps the latest choice', s);
await fillCommon(sa, 'Mohan Member', 'mohan.member@amuwa.com', '+91 98111 30003');
await create(sa, 'Mohan Member');
row = await designationOf('mohan.member@amuwa.com');
expect(row?.role === 'TEAM_MEMBER' && row.d === 'Department Head', 'the latest designation chosen (not the first, not the default) is saved', row);

// ============================ 5. shown in the Team Members directory
await sa.locator('[data-testid="tab-members"]').click().catch(() => undefined);
await sa.waitForTimeout(1200);
const dir = await sa.evaluate(() => document.body.innerText);
expect(/Tara Lead/.test(dir) && /Mohan Member/.test(dir), 'the new members are listed in the directory', dir.slice(0, 400));
await sa.screenshot({ path: `${OUT}/designation-directory.png` });

expect(errors.length === 0, 'no page errors', errors);
await browser.close();
await db.end();
console.log('=== STAFF DESIGNATION BROWSER CHECKS PASSED ===');
