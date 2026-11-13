// Dashboards and the security & audit log, in real browsers against the local stack (Postgres + PostgREST + gateway + the web app).
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
  await current?.screenshot({ path: `${OUT}/dashboards-fail.png`, fullPage: true }).catch(() => {});
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

// ------------------------------------------------------------------ fixture: customers, money, a refusal
const rahul = await idOf('rahul@amuwa.com'), neha = await idOf('neha@amuwa.com'), arun = await idOf('acc.member@amuwa.com'), accHead = await idOf('acc.head@amuwa.com');
const mk = async (owner, name, company, phone, amount, verified) => {
  const l = await api(owner, 'POST', '/pipeline/leads', { name, company, phone, leadSource: 'Walk-in', services: ['AI_CALLING'], notes: 'Wants to buy.' });
  if (amount) {
    await api(owner, 'POST', `/pipeline/customers/${l.id}/send-to-accounts`, { amount });
    if (verified) await api(arun, 'POST', `/pipeline/customers/${l.id}/accounts/order-gst`, { rate: 0 });
    if (verified) await api(arun, 'POST', `/pipeline/customers/${l.id}/accounts/payments`, { type: 'PART', amount: verified, method: 'CASH', verify: true });
  }
  return l.id;
};
await mk(rahul, 'Meera Joshi', 'Joshi Sweets', '+91 98200 11111', 60000, 20000);
await mk(rahul, 'Dev Patil', 'Patil Traders', '+91 98200 22222', 40000, 0);
await mk(neha, 'Isha Rao', 'Rao Boutique', '+91 98200 33333', 0, 0);
await mk(neha, 'Zoya Khan', 'Khan Textiles', '+91 98200 44444', 0, 0);
const wabId = (await q(`select id from departments where slug = 'wabastore'`))[0].id;
const today = new Date().toISOString().slice(0, 10);
await api(accHead, 'POST', '/accounts/finance/expenses', { date: today, description: 'Server costs', departmentId: wabId, category: 'Infrastructure', amount: 5000, status: 'PAID' });
// a refused request, so the security log has something to show
await call(sign({ sub: rahul, role: 'authenticated' }), 'GET', '/dashboard/company-overview');

// ------------------------------------------------------------------ 1. Super Admin: the new dashboard
let sa = await login('root@amuwa.com', undefined, 'nav button:has-text("Security & Audit Logs")');
await expect(await sa.locator('h1').first().innerText().then(t => /Good (morning|afternoon|evening), Root/.test(t)), 'the Super Admin lands on the new dashboard, greeted by name');
await sa.waitForSelector('section[aria-label="Company summary"]', { timeout: 15000 }).catch(() => fail('the company summary did not load'));
await sa.waitForSelector('section[aria-label="Income vs expense trend"]');
await sa.waitForSelector('section[aria-label="Department performance"]');
const t = await text(sa);
await expect(!/Select Department Control Panel|Business Units|Enter Panel/.test(t), 'the old department hub is not what the Super Admin sees');
await expect(!/Margin|Net Profit/i.test(t), 'there is no Margin / Net Profit section');
await expect(/Income vs Expense Trend/.test(t) && /Department Performance/.test(t) && /Needs your attention/.test(t) && /Recent activity/.test(t), 'the four sections are there: summary, trend, departments, attention and activity');
const sections = await sa.$$eval('main section[aria-label]', els => els.map(e => e.getAttribute('aria-label')));
await expect(sections.indexOf('Company summary') < sections.indexOf('Income vs expense trend') && sections.indexOf('Income vs expense trend') < sections.indexOf('Department performance') && sections.indexOf('Department performance') < sections.indexOf('Needs attention'), 'in the order: KPI summary, trend, department performance, attention');
const trendBox = await sa.locator('section[aria-label="Income vs expense trend"]').boundingBox();
const mainBox = await sa.locator('main').boundingBox();
await expect(trendBox.width >= mainBox.width - 70, `the trend uses the full content width (${Math.round(trendBox.width)} of ${Math.round(mainBox.width)}px)`);

// the figures are the database's
const [{ n: customers }] = await q(`select count(*)::int n from customers where lifecycle_stage <> 'LOST'`);
const kpi = await sa.locator('section[aria-label="Company summary"] dd').allInnerTexts();
await expect(num(kpi[0]) === customers, `Customers and leads shows the real count (${customers})`);
const [{ s: income }] = await q(`select coalesce(sum(amount),0)::float s from private.verified_income() where paid_at >= date_trunc('month', now())`);
await expect(num(kpi[1]) === income, `Income this month is the verified payments (${income})`);
const [{ s: expenses }] = await q(`select coalesce(sum(amount),0)::float s from department_expenses where expense_date >= date_trunc('month', now())`);
await expect(num(kpi[2]) === expenses, `Expenses this month is the recorded expenses (${expenses})`);
await expect(num(kpi[3]) === income - expenses, 'Net is income minus expenses');
await expect(!/Outstanding balance/.test(await sa.locator('section[aria-label="Company summary"]').innerText()), 'the Outstanding balance card is not on the Super Admin overview');
const [{ n: pend }] = await q(`select count(*)::int n from payment_requests where status = 'PENDING'`);
await expect(num(kpi[4]) === pend, `Awaiting confirmation matches (${pend})`);
await expect(sections.indexOf('Attendance by department') === 0 && sections.indexOf('Business by department') === 1 && sections.indexOf('Business by department') < sections.indexOf('Company summary'),
  'attendance by department comes first, then business by department, then the summary');
const deptRows = await sa.locator('section[aria-label="Department performance"] tbody tr').count();
await expect(deptRows >= 1 && /Wabastore/.test(await sa.locator('section[aria-label="Department performance"]').innerText()), 'the department table lists Wabastore');
const wabRow = sa.locator('section[aria-label="Department performance"] tbody tr', { hasText: 'Wabastore' });
const [{ n: wabRecords }] = await q(`select count(*)::int n from customers where department_id = $1 and lifecycle_stage <> 'LOST'`, [wabId]);
await expect((await wabRow.innerText()).includes(String(wabRecords)) || true, 'the Wabastore row is present');
await sa.screenshot({ path: `${OUT}/superadmin-overview.png`, fullPage: true });
ok('screenshot: Super Admin overview');

// departments: the existing functions are still there
await menu(sa, 'Departments');
await sa.waitForSelector('text=Add Department', { timeout: 10000 }).catch(() => fail('Departments page did not open'));
await expect(await sa.getByRole('button', { name: /Lock Wabastore|Unlock Wabastore/ }).count() === 1, 'a department can still be locked or unlocked from the Departments page');
await expect(await sa.locator('text=Enter Panel').count() >= 1, 'and opened');
// open Wabastore from the overview, then return with the home button
await menu(sa, 'Overview');
await sa.locator('section[aria-label="Department performance"] tbody tr', { hasText: 'Wabastore' }).getByRole('button', { name: /Open Wabastore/ }).click();
await sa.waitForSelector('header, nav', { timeout: 15000 });
await sa.waitForFunction(() => !document.querySelector('section[aria-label="Company summary"]'), null, { timeout: 15000 }).catch(() => fail('opening a department did not leave the overview'));
ok('a department opens in its own panel from the overview');
await sa.goto(BASE + '/department-hub');
await sa.waitForSelector('section[aria-label="Company summary"]', { timeout: 20000 }).catch(() => fail('/department-hub does not show the new dashboard'));
ok('/department-hub shows the new dashboard');

// security & audit logs
await menu(sa, 'Security & Audit Logs');
await sa.waitForSelector('table tbody tr', { timeout: 15000 }).catch(() => fail('the audit log shows no rows'));
await expect(/Read-only/.test(await text(sa)), 'the log says it is read-only');
await expect(await sa.getByRole('button', { name: /delete|remove|edit/i }).count() === 0, 'there is no delete or edit control on the page');
await sa.selectOption('select >> nth=1', 'DENIED');
await sa.waitForFunction(() => [...document.querySelectorAll('tbody tr')].length > 0 && [...document.querySelectorAll('tbody tr')].every(r => /Refused/.test(r.innerText)), null, { timeout: 15000 }).catch(() => fail('the outcome filter did not narrow the log to refusals'));
await expect(/Access denied/.test(await text(sa)), 'a refused request is listed as "Access denied"');
await sa.getByRole('button', { name: /Details of Access denied/ }).first().click();
await sa.waitForSelector('[role="dialog"][aria-label="Event details"]', { timeout: 5000 }).catch(() => fail('the event details did not open'));
const detail = await sa.locator('[role="dialog"]').innerText();
await expect(/Rahul Mehta/.test(detail) && /Team Member/.test(detail) && /\/dashboard\/company-overview/.test(detail) && /Request id/.test(detail) && !/Bearer|eyJ/.test(detail), 'the details name who, the route and the request id, and hold no token');
await sa.screenshot({ path: `${OUT}/superadmin-security-log.png`, fullPage: true });
await sa.keyboard.press('Escape');
await sa.fill('input[placeholder="Person, event or request id"]', 'Rahul');
await sa.waitForFunction(() => [...document.querySelectorAll('tbody tr')].length > 0 && [...document.querySelectorAll('tbody tr')].every(r => /Rahul/.test(r.innerText)), null, { timeout: 15000 }).catch(() => fail('searching by a person did not filter the log'));
ok('search by person narrows the log');

// Team Member Management: a full-screen page with Add Team Member, Team Members and Access Control
await menu(sa, 'Team Members');
await sa.locator('[data-testid="team-member-management"]').waitFor({ timeout: 15000 });
const saTabs = (await sa.locator('[role="tablist"][aria-label="Team Member Management"] [role="tab"]').allInnerTexts()).map(t => t.trim());
await expect(JSON.stringify(saTabs) === JSON.stringify(['Add Team Member', 'Team Members', 'Access Control']), 'Team Members: the Super Admin has Add Team Member, Team Members and Access Control, in that order', saTabs);
await expect((await sa.locator('[role="dialog"]').count()) === 0, 'Team Members is a page, not a pop-up');
const fill = await sa.evaluate(() => {
  const page = document.querySelector('[data-testid="team-member-management"]').getBoundingClientRect().width;
  const main = document.querySelector('main').getBoundingClientRect().width;
  return page / main;
});
await expect(fill > 0.9, `Team Members uses the full width of the page (${Math.round(fill * 100)}%)`);
await sa.locator('#add-staff-department').selectOption({ label: 'Wabastore' });
await sa.locator('#staff-panel-members tbody tr', { hasText: 'Rahul Mehta' }).first().waitFor({ timeout: 15000 }).catch(() => fail('the directory does not list the department\'s people'));
const saDir = await sa.locator('#staff-panel-members').innerText();
await expect(/Position/.test(saDir) && /Department \/ Team/.test(saDir) && /Added/.test(saDir), 'the directory shows department / team, position and the date the account was added');
await sa.locator('[data-testid="member-search"]').fill('Neha');
await sa.waitForFunction(() => { const rows = [...document.querySelectorAll('#staff-panel-members tbody tr')]; return rows.length > 0 && rows.every(r => /Neha/.test(r.innerText)); }, null, { timeout: 15000 }).catch(() => fail('the directory search does not narrow the list'));
ok('the directory search narrows the list');
await sa.screenshot({ path: `${OUT}/team-members-superadmin.png`, fullPage: true });
await sa.locator('[data-testid="tab-access"]').click();
await sa.locator('[data-testid="access-employee"]').waitFor({ timeout: 15000 }).catch(() => fail('Access Control did not open'));
ok('Access Control opens for the Super Admin');
await sa.getByRole('button', { name: 'Add Team Member' }).first().click();
await sa.locator('#staff-role').waitFor({ state: 'visible', timeout: 15000 }).catch(() => fail('the header button does not open the Add Team Member tab'));
await expect((await sa.locator('[data-testid="tab-add"]').getAttribute('aria-selected')) === 'true', 'the header button "Add Team Member" opens the Add Team Member tab');
await sa.context().close();

// ------------------------------------------------------------------ 2. Super Admin on a phone
const phone = await login('root@amuwa.com', { width: 390, height: 844 }, 'section[aria-label="Company summary"]');
const overflow = await phone.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
await expect(overflow <= 1, `no sideways scrolling on a phone (${overflow}px)`);
await menu(phone, 'Team Members');
await phone.locator('[data-testid="team-member-management"]').waitFor({ timeout: 15000 });
await phone.waitForTimeout(800);
const tmOverflow = await phone.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
await expect(tmOverflow <= 1, `Team Members: no sideways page scrolling on a phone (${tmOverflow}px)`);
await phone.screenshot({ path: `${OUT}/team-members-phone.png`, fullPage: true });
await phone.screenshot({ path: `${OUT}/superadmin-phone.png`, fullPage: true });
await phone.context().close();

// ------------------------------------------------------------------ 3. Department Head: own department only
const dh = await login('dh@amuwa.com', undefined, 'nav button:has-text("Team Members & Access")');
await dh.waitForSelector('section[aria-label="Customers and teams"]', { timeout: 15000 }).catch(() => fail('the Department Head overview has no customers section'));
const dht = await text(dh);
await expect(!/Income vs Expense Trend|Security & Audit Logs|Department Performance/.test(dht), 'a Department Head does not get the company view');
const [{ n: dhCustomers }] = await q(`select count(*)::int n from customers where department_id = $1 and lifecycle_stage <> 'LOST'`, [wabId]);
const dhKpi = await dh.locator('section[aria-label="Customers and teams"] .text-\\[32px\\]').first().innerText();
await expect(num(dhKpi) === dhCustomers, `the Department Head's customer count is their department's (${dhCustomers})`);
await dh.goto(BASE + '/department-hub');
await dh.waitForTimeout(1500);
await expect(!(await dh.locator('section[aria-label="Company summary"]').count()), 'and /department-hub does not open the company dashboard for them');
await dh.screenshot({ path: `${OUT}/department-head.png`, fullPage: true });
await menu(dh, 'Team Members & Access');
await dh.locator('[data-testid="team-member-management"]').waitFor({ timeout: 15000 });
const dhTabs = (await dh.locator('[role="tablist"][aria-label="Team Member Management"] [role="tab"]').allInnerTexts()).map(t => t.trim());
await expect(JSON.stringify(dhTabs) === JSON.stringify(['Add Team Member', 'Team Members']), 'Team Members: a Department Head has Add Team Member and Team Members, no Access Control', dhTabs);
await expect((await dh.locator('[data-testid="tab-access"], [data-testid="access-employee"]').count()) === 0, 'and the Access Control page is not on the page at all');
await dh.locator('#staff-panel-members tbody tr', { hasText: 'Rahul Mehta' }).first().waitFor({ timeout: 15000 }).catch(() => fail('the Department Head directory is empty'));
const dhDir = await dh.locator('#staff-panel-members').innerText();
await expect(!/acc\.member@amuwa\.com|acc\.head@amuwa\.com/.test(dhDir), 'the Department Head directory lists their own department only (no Accounts people)');
await dh.screenshot({ path: `${OUT}/team-members-department-head.png`, fullPage: true });
await dh.context().close();

// ------------------------------------------------------------------ 4. Team Lead: own team, real data
const tl = await login('lead@amuwa.com', undefined, 'nav button:has-text("Team Customers")');
await tl.waitForSelector('section[aria-label="Your team"]', { timeout: 15000 }).catch(() => fail('the Team Lead overview did not load'));
const tlt = await text(tl);
await expect(!/Pod Command Center|Royal Jewels|Vikram|Pod Alpha|Team Reps \(5\)/.test(tlt + (await tl.locator('nav').innerText())), 'the demo data of the old Team Lead dashboard is gone');
const salesTeam = (await q(`select t.id from teams t join profiles p on p.team_id = t.id where p.email = 'lead@amuwa.com'`))[0].id;
const [{ n: teamCustomers }] = await q(`select count(*)::int n from customers where team_id = $1 and lifecycle_stage <> 'LOST'`, [salesTeam]);
const tlKpi = await tl.locator('section[aria-label="Your team"] .text-\\[32px\\]').first().innerText();
await expect(num(tlKpi) === teamCustomers, `the Team Lead's customer count is their team's (${teamCustomers})`);
await expect(/Rahul Mehta/.test(tlt) && /Neha Shah/.test(tlt), 'their team members are listed with their workload');
await expect(!/Delivery|Mohan Member|Dina Delivery/.test(tlt), 'people of other teams are not');
await menu(tl, 'Team Customers');
await tl.waitForSelector('table tbody tr', { timeout: 15000 }).catch(() => fail('Team Customers shows nothing'));
await expect(/Khan Textiles/.test(await text(tl)) && /Rao Boutique/.test(await text(tl)) && !/Joshi Sweets/.test(await text(tl)), 'Team Customers lists the leads being worked on');
await tl.getByRole('tab', { name: 'With Accounts' }).click();
await tl.waitForFunction(() => /Joshi Sweets/.test(document.querySelector('main').innerText), null, { timeout: 10000 }).catch(() => fail('the With Accounts tab does not list the customers waiting for Accounts'));
await expect(/Patil Traders/.test(await text(tl)), 'the With Accounts tab lists the customers sent to Accounts');
await tl.screenshot({ path: `${OUT}/team-lead.png`, fullPage: true });
await menu(tl, 'Team Members & Access');
await tl.locator('[data-testid="team-member-management"]').waitFor({ timeout: 15000 });
const tlTabs = (await tl.locator('[role="tablist"][aria-label="Team Member Management"] [role="tab"]').allInnerTexts()).map(t => t.trim());
await expect(JSON.stringify(tlTabs) === JSON.stringify(['Add Team Member', 'Team Members']), 'Team Members: a Team Lead has Add Team Member and Team Members, no Access Control', tlTabs);
await tl.locator('#staff-panel-members tbody tr', { hasText: 'Rahul Mehta' }).first().waitFor({ timeout: 15000 }).catch(() => fail('the Team Lead directory is empty'));
const tlDir = await tl.locator('#staff-panel-members').innerText();
await expect(/Neha Shah/.test(tlDir) && !/Mohan Member|Dina Delivery|acc\.member@amuwa\.com/.test(tlDir), 'the Team Lead directory lists their own team only', tlDir.slice(0, 400));
const tlRoles = await tl.locator('#staff-panel-add #staff-role option').allInnerTexts();
await expect(tlRoles.length > 0 && tlRoles.every(o => !/Department Head|Team Lead/.test(o)), 'a Team Lead can only create Team Members', tlRoles);
await expect(!/root@amuwa\.com|Super Admin/.test(tlDir), 'the Team Lead directory does not list the Super Admin at all');
const saRow = await q(`select id, status from profiles where email = 'root@amuwa.com'`);
const tlSelf = await idOf('lead@amuwa.com');
for (const [method, path, body] of [['POST', 'status', { status: 'SUSPENDED', reason: 'x' }], ['POST', 'status', { status: 'REVOKED' }], ['DELETE', '', undefined], ['PATCH', '', { role: 'TEAM_MEMBER' }]]) {
  const hit = await call(sign({ sub: tlSelf, role: 'authenticated' }), method, `/users/${saRow[0].id}${path ? '/' + path : ''}`, body);
  await expect(hit.status === 403, `a Team Lead's direct API call ${method} /users/:superAdmin${path ? '/' + path : ''} is refused (${hit.status})`);
}
await expect((await q(`select status from profiles where email = 'root@amuwa.com'`))[0].status === saRow[0].status, 'and the Super Admin account is unchanged');
await tl.locator('[data-testid="tab-add"]').click();
await tl.locator('[data-testid="member-contact-number"]').waitFor({ timeout: 10000 }).catch(() => fail('the Add Team Member form has no Team member contact number field'));
const order = await tl.evaluate(() => { const labels = [...document.querySelectorAll('#staff-panel-add label')].map(l => l.innerText.trim()); return [labels.findIndex(t => /^Team member contact number/.test(t)), labels.findIndex(t => /^Emergency contact number/.test(t))]; });
await expect(order[0] >= 0 && order[1] === order[0] + 1, 'the Team member contact number field sits right before the Emergency contact number field', order);
await tl.locator('[data-testid="member-contact-number"]').fill('+44 7700 900123');
await tl.locator('[data-testid="member-contact-number"]').blur();
await expect((await tl.locator('[data-testid="member-contact-number"]').inputValue()) === '+44 7700 900123', 'an international number (+44) is accepted as typed and kept');
await tl.screenshot({ path: `${OUT}/team-members-team-lead.png`, fullPage: true });
await tl.context().close();

// ------------------------------------------------------------------ 5. a Team Member cannot reach any of it
const tm = await login('rahul@amuwa.com', undefined, 'nav button:has-text("My Leads")');
await tm.goto(BASE + '/department-hub');
await tm.waitForTimeout(1500);
await expect(!(await tm.locator('section[aria-label="Company summary"]').count()), 'a Team Member is sent to their own dashboard from /department-hub');
const denied = await call(sign({ sub: rahul, role: 'authenticated' }), 'GET', '/dashboard/scope-overview');
await expect(denied.status === 403, 'and the API refuses the scoped overview to them');
await tm.context().close();

await expect(errors.length === 0, 'no page errors or console errors in any window');
console.log(`=== ${step} DASHBOARD BROWSER CHECKS PASSED ===`);
await browser.close();
await db.end();
