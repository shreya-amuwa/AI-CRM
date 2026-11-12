// Attendance first in every dashboard's menu, in a real browser against the local stack (run-attendance-nav.sh):
//   every role the test-account script makes (Department Heads, Operations Heads, Team Leads, Team Members, Telecaller, Business Associate,
//   Support, Technical Consultant, Meta Verifier, Accounts, HR Assistant, HR Recruiter, HR Admin Head) and the Super Admin signs in;
//   the first entry of their menu is Attendance; it opens the one Attendance page; the employee punches in and out with the browser's
//   location; the punches are stored for that employee only; the HR Admin Head sees everyone's day in the attendance register;
//   on a phone the entry is first in the drawer too. Passwords are made up by the runner; nothing is stored.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import pg from 'pg';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright-core', '/opt/node-tools/node_modules/playwright-core', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the attendance browser test did not run'); process.exit(0); }

const BASE = process.env.E2E_BASE, GW = process.env.E2E_GATEWAY;
const OUT = process.argv[2] || '.';
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const sign = p => {
  const e = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p });
  return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`;
};
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const idOf = async e => (await q('select id from public.profiles where email = $1', [e]))[0]?.id;
const call = async (who, method, path, body) => {
  const r = await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${sign({ sub: who, role: 'authenticated' })}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return r.json();
};

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
let step = 0, current;
const errors = [];
const ok = m => console.log(`ok ${++step} - ${m}`);
const fail = async m => {
  await current?.screenshot({ path: `${OUT}/attendance-nav-fail.png`, fullPage: true }).catch(() => {});
  console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(-5)) : '');
  await browser.close();
  process.exit(1);
};
const expect = async (c, m, extra) => (c ? ok(m) : fail(m + (extra === undefined ? '' : ' ' + JSON.stringify(extra))));
process.on('unhandledRejection', e => fail(`an unexpected error: ${String(e?.message ?? e).split('\n').slice(0, 4).join(' | ')}`));

// ------------------------------------------------------------------ the accounts: the script's list, an HR Recruiter, an HR Assistant
const rows = fs.readFileSync(process.env.LIST, 'utf8').split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| Who') && !l.startsWith('|---'))
  .map(l => l.split('|').slice(1, -1).map(c => c.trim())).map(([who, opens, email, password]) => ({ who, opens, email, password }))
  .filter(r => r.email !== '-' && r.password && r.password !== '-' && !/^Client/.test(r.who));
await expect(rows.some(r => r.who === 'HR Recruiter') && rows.some(r => r.who === 'HR Team Member') && rows.some(r => r.who === 'HR Department Head'), 'the accounts include an HR Assistant, an HR Recruiter and the HR Admin Head', rows.map(r => r.who));
await expect(rows.length >= 20, `${rows.length} employee logins to check`, rows.map(r => r.who));

// the browser grants its location (Pune), like an employee who allows it
const signIn = async (email, password, viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport, geolocation: { latitude: 18.5204, longitude: 73.8567, accuracy: 15 }, permissions: ['geolocation'] });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`${email} pageerror: ${e.message}`));
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(password);
  await p.locator('form button[type="submit"]').click();
  const entry = p.locator('aside button', { hasText: /^Attendance$/ }).first();
  const chooser = p.getByRole('heading', { name: 'Choose a department' });
  await Promise.race([entry.waitFor({ state: 'attached', timeout: 30000 }), chooser.waitFor({ timeout: 30000 })]).catch(() => {});
  // an Operations Head who looks after several departments first chooses one (that page has no menu); the dashboard then has it
  if (await chooser.isVisible().catch(() => false)) await p.getByText('Open dashboard').first().click();
  await entry.waitFor({ state: 'attached', timeout: 30000 }).catch(() => fail(`${email}: no Attendance entry in the menu`));
  return p;
};
/** The menu's entries in order: every button with a label in the side menu (icon-only buttons such as collapse/close have none; the
 *  Super Admin's "Department Hub" is the way back, not a page). */
const menuEntries = p => p.evaluate(() => Array.from(document.querySelector('aside')?.querySelectorAll('button') ?? [])
  .map(b => (b.innerText || '').trim().split('\n')[0].trim()).filter(t => t && !/^Department Hub/.test(t)));
const openAttendance = async p => {
  await p.locator('aside button', { hasText: /^Attendance$/ }).first().click();
  await p.getByRole('heading', { name: 'Attendance', exact: true }).waitFor({ timeout: 20000 }).catch(() => fail('Attendance did not open the Attendance page'));
};
const today = (await q(`select (now() at time zone 'Asia/Kolkata')::date::text as d`))[0].d;

// ------------------------------------------------------------------ every role: first entry, the page, punch in and out
const seen = new Map();
for (const r of rows) {
  const label = `${r.who} (${r.opens || 'dashboard'})`;
  const p = await signIn(r.email, r.password);
  const entries = await menuEntries(p);
  await expect(entries[0] === 'Attendance' && entries.filter(e => e === 'Attendance').length === 1, `${label}: Attendance is the first entry of the menu, once`, entries.slice(0, 4));
  const before = entries.slice(1);
  await openAttendance(p);
  await expect(JSON.stringify((await menuEntries(p)).slice(1)) === JSON.stringify(before), `${label}: the rest of the menu is unchanged`);
  const mineTab = p.getByRole('tab', { name: 'My attendance' });
  if (await mineTab.count()) await mineTab.click();
  const card = p.getByTestId('my-attendance');
  await card.waitFor({ timeout: 20000 }).catch(() => fail(`${label}: the own attendance card did not open`));
  await expect((await p.getByTestId('attendance-status').textContent()) === 'Not Punched In', `${label}: not punched in yet`);
  await p.getByTestId('punch-in').click();
  await p.getByText(/^Punched in at/).waitFor({ timeout: 20000 }).catch(() => fail(`${label}: Punch In did not finish`));
  await expect(await p.getByTestId('punch-out').isEnabled(), `${label}: punched in, Punch Out is available`);
  await p.getByTestId('punch-out').click();
  await p.waitForFunction(() => document.querySelector('[data-testid="punch-out-time"]')?.textContent?.includes('IST'), null, { timeout: 20000 }).catch(() => fail(`${label}: Punch Out did not finish`));
  const id = await idOf(r.email);
  const ev = await q(`select kind, location_status, recorded_by, latitude::float as lat from attendance_events where profile_id = $1 and attendance_date = $2 order by id`, [id, today]);
  await expect(ev.map(e => e.kind).join() === 'PUNCH_IN,PUNCH_OUT' && ev.every(e => e.location_status === 'CAPTURED' && Math.abs(e.lat - 18.5204) < 1e-4 && e.recorded_by === null),
    `${label}: one Punch In and one Punch Out are stored as their own, with the location`, ev);
  seen.set(id, (await q(`select full_name from profiles where id = $1`, [id]))[0].full_name);
  if (seen.size === 1) await p.screenshot({ path: `${OUT}/attendance-1-first-entry.png` });
  await p.context().close();
}
await expect(Number((await q(`select count(*) from attendance_events where attendance_date = $1 and profile_id <> all($2::uuid[])`, [today, [...seen.keys()]]))[0].count) === 0,
  'nobody else got a punch from these sign-ins (each punch is the signed-in employee\'s own)');

// ------------------------------------------------------------------ the Super Admin: Attendance first, the register of everyone
{
  const p = await signIn('root@amuwa.com', process.env.SA_PASSWORD);
  const entries = await menuEntries(p);
  await expect(entries[0] === 'Attendance', 'Super Admin: Attendance is the first entry of the menu', entries.slice(0, 4));
  await openAttendance(p);
  await p.getByTestId('hr-register').waitFor({ timeout: 20000 }).catch(() => fail('Super Admin: the attendance register did not open'));
  await expect(true, 'Super Admin: Attendance opens the register (the Super Admin does not punch, as before)');
  await p.context().close();
}

// ------------------------------------------------------------------ HR: today's register has every punch
{
  const head = rows.find(r => r.who === 'HR Department Head');
  const p = await signIn(head.email, head.password);
  await openAttendance(p);
  const reg = p.getByTestId('hr-register');
  await reg.waitFor({ timeout: 20000 }).catch(() => fail('HR Admin Head: the register did not open'));
  await p.waitForFunction(n => document.querySelectorAll('[data-testid="register-row"]').length >= n, seen.size, { timeout: 20000 }).catch(() => fail('the register does not list everyone who punched'));
  const text = await reg.innerText();
  const missing = [...seen.values()].filter(n => !text.includes(n));
  await expect(missing.length === 0, `HR Admin Head: the attendance register shows today's punches of all ${seen.size} employees`, missing);
  await p.screenshot({ path: `${OUT}/attendance-2-hr-register.png`, fullPage: true });
  await p.context().close();
}

// ------------------------------------------------------------------ a phone: first in the drawer, no sideways scrolling
for (const who of ['Sales Team Member', 'HR Team Member', 'Sales Department Head']) {
  const r = rows.find(x => x.who === who);
  if (!r) continue;
  const p = await signIn(r.email, r.password, { width: 390, height: 800 });
  await p.getByRole('button', { name: 'Toggle menu' }).first().click();
  await p.locator('aside button', { hasText: /^Attendance$/ }).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => fail(`${who} on a phone: Attendance is not visible in the open menu`));
  await expect((await menuEntries(p))[0] === 'Attendance', `${who} on a phone: Attendance is the first entry of the menu`);
  await openAttendance(p);
  await expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${who} on a phone: the Attendance page does not scroll sideways`);
  if (who === 'Sales Team Member') await p.screenshot({ path: `${OUT}/attendance-3-phone.png` });
  await p.context().close();
}

await expect(!errors.length, 'no page errors', errors);
console.log(`=== ALL ATTENDANCE NAVIGATION BROWSER TESTS PASSED (${step}) ===`);
await browser.close();
await db.end();
process.exit(0);
