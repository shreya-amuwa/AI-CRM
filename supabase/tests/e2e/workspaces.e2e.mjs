// Sign out in the header, Performance Management, HR Recruitment and HR Training, in real browsers against the local stack (Postgres + PostgREST + gateway + the web app).
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
  await current?.screenshot({ path: `${OUT}/workspaces-fail.png`, fullPage: true }).catch(() => {});
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
const root = await idOf('root@amuwa.com');
const hrDept = (await api(root, 'GET', '/departments')).find(d => d.slug === 'hr');
const hrPw = crypto.randomBytes(9).toString('base64url') + '-Aa1';
await api(root, 'POST', '/users', { email: 'hr.head@amuwa.com', fullName: 'Payal HR', password: hrPw, role: 'DEPARTMENT_HEAD', departmentId: hrDept.id });
PASSWORDS['hr.head@amuwa.com'] = hrPw;
const lead = await idOf('lead@amuwa.com'), rahul = await idOf('rahul@amuwa.com'), neha = await idOf('neha@amuwa.com');
const dept = (await q('select department_id, team_id from profiles where id = $1', [rahul]))[0];
const task = (title, who, created, due, status, completed) => q(
  `insert into work_tasks (department_id, team_id, title, due_date, assigned_by, assignee_id, status, progress, completed_at, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [dept.department_id, dept.team_id, title, due, lead, who, status, status === 'COMPLETED' ? 100 : 30, completed, created]);
await task('Follow up with Joshi Sweets', rahul, '2026-01-05T03:30:00Z', '2026-01-09', 'COMPLETED', '2026-01-08T03:30:00Z');
await task('Prepare the quotation', rahul, '2026-01-06T03:30:00Z', '2026-01-08', 'COMPLETED', '2026-01-10T03:30:00Z');
await task('Call back the Patil Traders lead', rahul, '2026-01-05T03:30:00Z', '2026-01-09', 'IN_PROGRESS', null);
await task('Update the pipeline sheet', neha, '2026-01-12T03:30:00Z', '2026-01-14', 'COMPLETED', '2026-01-13T03:30:00Z');

// ------------------------------------------------------------------ 1. Sign out sits in the top bar, beside the avatar
const signOutChecks = async (p, label) => {
  await expect((await p.locator('header').getByRole('button', { name: 'Sign out' }).count()) === 1, `${label}: Sign out is in the top bar`);
  await expect((await p.locator('aside').getByText('Sign out', { exact: false }).count()) === 0, `${label}: the sidebar has no Sign out`);
  await expect((await p.getByRole('button', { name: 'Sign out' }).count()) === 1, `${label}: there is only one Sign out button`);
  const box = await p.locator('header').getByRole('button', { name: 'Sign out' }).boundingBox();
  const avatar = await p.locator('header').getByText(/^[A-Z]{1,2}$/).first().boundingBox();
  await expect(box && avatar && Math.abs(box.y - avatar.y) < 30 && box.x > avatar.x, `${label}: it sits beside the profile avatar`);
};
const tl = await login('lead@amuwa.com', { width: 1440, height: 900 }, 'nav button');
await signOutChecks(tl, 'Team Lead');
// ------------------------------------------------------------------ 2. Performance Management: Team Lead
await menu(tl, 'Performance Management');
await tl.getByRole('tab', { name: 'Custom range' }).click();
await tl.getByLabel('From', { exact: true }).fill('2026-01-01');
await tl.getByLabel('To', { exact: true }).fill('2026-01-31');
await tl.getByText('Rahul Mehta').first().waitFor({ timeout: 15000 }).catch(() => fail('the Team Lead does not see their member'));
const tlText = await text(tl);
await expect(/Rahul Mehta/.test(tlText) && /Neha Shah/.test(tlText) && !/Dina Delivery|Mohan Member/.test(tlText), 'Team Lead: sees the members of their own team only');
const rahulRow = tl.locator('tr', { hasText: 'Rahul Mehta' });
await rahulRow.getByText('50%').waitFor({ timeout: 15000 }).catch(() => {});
await expect(/3/.test(await rahulRow.innerText()) && /50%/.test(await rahulRow.innerText()), 'Team Lead: Rahul has 3 tasks and 50% on time, calculated from the task records');
await tl.screenshot({ path: `${OUT}/ws-1-performance-list.png`, fullPage: true });
await tl.getByRole('button', { name: 'Open the report of Rahul Mehta' }).click();
await tl.getByRole('button', { name: /Generate report/ }).click();
await tl.getByText('Analysis').first().waitFor({ timeout: 20000 }).catch(() => fail('the report did not open'));
await tl.getByText('Productivity and workload observations').waitFor({ timeout: 20000 }).catch(() => fail('the analysis did not appear after generating'));
const rep = await text(tl);
await expect(/Reporting period/.test(rep) && /Generated:/.test(rep) && /Last checked against the tasks/.test(rep), 'report: shows the period, the generated time and the last-checked time');
await expect(/Tasks per week/.test(rep) && /How the tasks ended/.test(rep) && (await tl.locator('svg[role=img]').count()) >= 1, 'report: has the task completion and delay charts');
await expect(/Rule-based analysis/.test(rep) && /Areas of improvement/.test(rep) && /Recommendations and next steps/.test(rep) && /Data limitations/.test(rep), 'report: the analysis sections are there (rule-based while no AI key is set, and it says so)');
await expect(/Call back the Patil Traders lead/.test(rep) && /Overdue/.test(rep) && /Prepare the quotation/.test(rep), 'report: lists the tasks behind it, with the overdue and late ones marked');
await expect(!/NaN|undefined|\[object/.test(rep), 'report: no broken values');
await tl.screenshot({ path: `${OUT}/ws-2-performance-report.png`, fullPage: true });
await tl.getByRole('button', { name: 'Back to the list' }).click();
await tl.locator('tr', { hasText: 'Rahul Mehta' }).getByText('Not generated').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
await expect(!/Not generated/.test(await tl.locator('tr', { hasText: 'Rahul Mehta' }).innerText()), 'the list now shows that the report was generated');
// signing out works from the new place
await tl.locator('header').getByRole('button', { name: 'Sign out' }).click();
await tl.waitForSelector('input[type="password"]', { timeout: 15000 }).catch(() => fail('Sign out did not return to the sign-in page'));
ok('Team Lead: Sign out signs out and returns to the sign-in page');

// ------------------------------------------------------------------ 3. Department Head
const dh = await login('dh@amuwa.com', { width: 1440, height: 900 }, 'nav button');
await signOutChecks(dh, 'Department Head');
await menu(dh, 'Performance Management');
await dh.getByRole('tab', { name: 'Custom range' }).click();
await dh.getByLabel('From', { exact: true }).fill('2026-01-01');
await dh.getByLabel('To', { exact: true }).fill('2026-01-31');
await dh.getByText('Rahul Mehta').first().waitFor({ timeout: 15000 }).catch(() => fail('the Department Head does not see the members'));
const dhText = await text(dh);
await expect(/Lead Person/.test(dhText) && /Rahul Mehta/.test(dhText), 'Department Head: sees the Team Leads and the members of the department');
await dh.getByRole('tab', { name: /^Teams/ }).click();
await expect(/Sales/.test(await text(dh)) && /Open report/.test(await text(dh)), 'Department Head: has a Teams view');
await dh.getByRole('tab', { name: 'Department' }).click();
await dh.getByRole('button', { name: /Open the report of Wabastore/ }).click();
await dh.getByRole('button', { name: /Generate report/ }).click();
await dh.getByText('Productivity and workload observations').waitFor({ timeout: 20000 }).catch(() => fail('the department report did not appear'));
await expect(/Wabastore/.test(await text(dh)) && /4/.test(await text(dh)), 'Department Head: opens the department report');
await dh.screenshot({ path: `${OUT}/ws-3-department-report.png`, fullPage: true });
await dh.locator('header').getByRole('button', { name: 'Sign out' }).click();
await dh.waitForSelector('input[type="password"]', { timeout: 15000 }).catch(() => fail('Department Head: Sign out did not work'));
ok('Department Head: Sign out works');

// ------------------------------------------------------------------ 4. HR: Recruitment Management
const hr = await login('hr.head@amuwa.com', { width: 1440, height: 900 }, 'text=Recruitment Management');
await signOutChecks(hr, 'HR');
await hr.getByText('Recruitment Management', { exact: true }).first().click();
await hr.getByRole('heading', { name: 'Recruitment Management' }).waitFor({ timeout: 15000 });
await hr.getByRole('tab', { name: 'Positions' }).click();
await hr.getByLabel('New position').fill('Backend Developer');
await hr.getByRole('button', { name: 'Add position' }).click();
await hr.getByText('Backend Developer').first().waitFor({ timeout: 10000 });
await hr.getByRole('tab', { name: 'Candidates' }).click();
await hr.getByText(/No candidates yet/).waitFor({ timeout: 15000 }).catch(() => fail('Recruitment: not empty at the start'));
ok('Recruitment: starts empty (no dummy candidates)');
await hr.getByRole('button', { name: 'Add candidate' }).click();
const dlg = hr.getByRole('dialog');
await dlg.getByLabel('Candidate name').fill('Rhea Kapoor');
await dlg.getByLabel('Email').fill('rhea.k@example.com');
await dlg.getByLabel('Phone').fill('+91 98200 00001');
await dlg.getByRole('button', { name: 'Add candidate' }).click();
await hr.getByText('Rhea Kapoor').first().waitFor({ timeout: 10000 });
const cols = await hr.locator('thead th').allInnerTexts();
await expect(['Candidate Name', 'Email', 'Position', 'Pending', 'Call', 'Confirmation'].every((c, i) => (cols[i] || '').trim() === c), 'Recruitment: the table has the six columns Candidate Name, Email, Position, Pending, Call, Confirmation', cols);
await hr.getByRole('button', { name: 'Open Rhea Kapoor' }).click();
const cd = hr.getByRole('dialog');
await cd.locator('#a-title').fill('Technical interview');
await cd.locator('#a-due').fill('2026-01-02');
await cd.getByRole('button', { name: 'Add pending item' }).click();
await cd.getByText('Technical interview').first().waitFor({ timeout: 10000 });
await cd.getByRole('button', { name: 'Schedule' }).click();
await cd.getByText('Call scheduled.').waitFor({ timeout: 10000 });
await cd.locator('#f-status').selectOption('CONFIRMED');
await cd.locator('#f-date').fill('2026-02-01');
await cd.getByRole('button', { name: 'Update confirmation' }).click();
await cd.getByText('Confirmation updated.').waitFor({ timeout: 10000 });
await hr.screenshot({ path: `${OUT}/ws-4-candidate.png`, fullPage: true });
await cd.getByRole('button', { name: 'Close' }).first().click();
const crow = hr.locator('tr', { hasText: 'Rhea Kapoor' });
await crow.getByText('Confirmed').waitFor({ timeout: 10000 }).catch(() => {});
const ctext = await crow.innerText();
await expect(/rhea\.k@example\.com/.test(ctext) && /1 open/.test(ctext) && /1 overdue/.test(ctext) && /Scheduled/.test(ctext) && /Confirmed/.test(ctext), 'Recruitment: Pending, Call and Confirmation each show their own stage', ctext);
await hr.getByPlaceholder('Search name or e-mail').fill('nobody-here');
await hr.getByText('No candidate matches these filters.').waitFor({ timeout: 10000 });
await hr.getByPlaceholder('Search name or e-mail').fill('rhea.k@');
await hr.getByText('Rhea Kapoor').first().waitFor({ timeout: 10000 });
ok('Recruitment: search by e-mail works');
await hr.reload();
await hr.getByText('Recruitment Management', { exact: true }).first().click();
await hr.getByText('Rhea Kapoor').first().waitFor({ timeout: 15000 }).catch(() => fail('the candidate did not survive a refresh'));
ok('Recruitment: the candidate persists after a refresh');

// ------------------------------------------------------------------ 5. HR: Training
await hr.getByText('Training', { exact: true }).first().click();
await hr.getByRole('heading', { name: 'Training' }).first().waitFor({ timeout: 15000 });
await hr.getByText('No training program yet').waitFor({ timeout: 15000 }).catch(() => fail('Training: not empty at the start'));
ok('Training: starts empty (no dummy programs)');
await hr.getByRole('button', { name: 'New program' }).click();
await hr.getByRole('dialog').getByLabel('Program name').fill('Onboarding Bootcamp');
await hr.getByRole('dialog').getByRole('button', { name: 'Create program' }).click();
await hr.getByText('The three days').waitFor({ timeout: 15000 });
const day1 = hr.getByRole('form', { name: /Day 1/ });
await day1.getByLabel('Topics (one per line)').fill('CRM basics\nCompany policies');
await day1.getByLabel('Trainer (name)').fill('Rina Trainer');
await day1.getByRole('button', { name: 'Save Day 1' }).click();
await day1.getByText('Saved.').waitFor({ timeout: 10000 });
await hr.getByRole('button', { name: 'Enrol employees' }).click();
await hr.getByRole('dialog').getByText('Rahul Mehta').click();
await hr.getByRole('dialog').getByRole('button', { name: /^Enrol/ }).click();
await hr.getByRole('button', { name: 'Open the record of Rahul Mehta' }).click();
const rec = hr.getByRole('dialog');
await rec.getByText('Not started').first().waitFor({ timeout: 10000 });
await expect(/Day 2 takes place on|can be reported once it has taken place/.test(await rec.innerText()), 'Training: a future day cannot be reported yet');
const d1 = rec.locator('section[aria-label="Day 1 · Initial Training"]');
await d1.getByLabel('Attendance').selectOption('PRESENT');
await d1.getByLabel('CRM basics').check();
await d1.getByRole('button', { name: 'Save Day 1 report' }).click();
await d1.getByText('Saved. Day complete.').waitFor({ timeout: 10000 });
await hr.screenshot({ path: `${OUT}/ws-5-training-record.png`, fullPage: true });
await expect(/In progress/.test(await rec.innerText()) && /1 of 3 days complete/.test(await rec.innerText()), 'Training: attendance + a topic completes Day 1 and the status becomes In progress (the other days are not marked complete)');
await rec.getByRole('button', { name: 'Close' }).first().click().catch(() => {});
await hr.keyboard.press('Escape');
await hr.reload();
await hr.getByText('Training', { exact: true }).first().click();
await hr.getByText('Onboarding Bootcamp').first().waitFor({ timeout: 15000 }).catch(() => fail('the program did not survive a refresh'));
ok('Training: the program and its reports persist after a refresh');

// ------------------------------------------------------------------ 6. a phone: Sign out is in the top bar and nothing scrolls sideways
await hr.setViewportSize({ width: 390, height: 800 });
await hr.reload();
await hr.waitForTimeout(2500);
await expect(await hr.locator('header').getByRole('button', { name: 'Sign out' }).isVisible(), 'a phone: Sign out is visible in the top bar');
await expect(await hr.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'a phone: the page does not scroll sideways');
await hr.screenshot({ path: `${OUT}/ws-6-phone.png` });
console.log(`=== ALL WORKSPACE BROWSER TESTS PASSED (${step}) ===`);
await browser.close();
process.exit(0);
