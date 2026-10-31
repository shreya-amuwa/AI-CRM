// Top Performers & Rankings: the Department Head's screen (top 3 / top 5, the complete ranking, individual cards, Team Leads, monthly recognition
// that only the Department Head approves, comparisons, methodology), rankings that follow the records, and the read-only company views of an
// Operations Head and the Super Admin. Real browsers against the local stack (Postgres + PostgREST + gateway + the web app).
// No credentials live in this file: staff passwords come from E2E_PASSWORDS (made up by the runner) and the Operations Head made here gets a
// password made up at run time. See supabase/tests/e2e/README.md for how to run it.
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
const fail = async m => { await current?.screenshot({ path: `${OUT}/toppers-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(0, 4)) : ''); process.exit(1); };
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
const NAV = 'Top Performers & Rankings';
const openToppers = async (p, testId = 'top-performers-page') => { await menuItem(p, NAV).click(); await wait(p, `[data-testid="${testId}"]`, `the ${NAV} page did not open`); };
const navLabels = async p => (await p.locator('nav button').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
const closeDetail = async p => {
  await p.keyboard.press('Escape');
  await p.waitForSelector('[data-testid="performer-detail"]', { state: 'detached', timeout: 3000 }).catch(async () => { await p.getByRole('button', { name: /close/i }).first().click(); });
};
const num = t => Number(String(t).replace(/[^0-9.\-]/g, ''));

// ------------------------------------------------------------------ fixture: last month's real records
const sa = await idOf('root@amuwa.com');
const [{ pm }] = await q(`select to_char(date_trunc('month', private.hr_today()::timestamp - interval '1 month'), 'YYYY-MM-DD') as pm`);
const pmMonth = pm.slice(0, 7);
const dhId = await idOf('dh@amuwa.com');
const wab = (await q(`select id from departments where slug = 'wabastore'`))[0].id;
const task = (email, title, due, status, doneDay, prio = 'MEDIUM') => q(
  `insert into public.work_tasks (department_id, team_id, title, priority, due_date, assigned_by, assignee_id, status, progress, completed_at, created_at)
   select p.department_id, p.team_id, $2, $8, ($3::date + $4::int), $5, p.id, $6, case when $6 = 'COMPLETED' then 100 else 0 end,
          case when $7::int is null then null else (($3::date + $7::int)::timestamp + interval '1 day 4 hours') at time zone 'Asia/Kolkata' end,
          (($3::date + 1)::timestamp + interval '4 hours') at time zone 'Asia/Kolkata'
     from public.profiles p where p.email = $1`, [email, title, pm, due, dhId, status, doneDay, prio]);
const report = (email, status, days = 31) => q(
  `insert into public.work_reports (kind, author_id, author_name, department_id, team_id, title, report_date, period_type, period_start, period_end, content, status, submitted_at, reviewed_at, reviewed_by)
   select case p.role when 'TEAM_HEAD' then 'TEAM_LEAD' else 'MEMBER' end, p.id, p.full_name, p.department_id, p.team_id, 'Month report', $2::date + 27, 'CUSTOM', $2::date, $2::date + $4::int, '{"workCompleted":"work"}', $3, now(), now(), $5
     from public.profiles p where p.email = $1`, [email, pm, status, days, dhId]);
for (let i = 1; i <= 5; i++) await task('rahul@amuwa.com', `Rahul task ${i}`, 9 + i, 'COMPLETED', 7 + i, i <= 2 ? 'HIGH' : 'MEDIUM');
for (let i = 1; i <= 5; i++) await task('neha@amuwa.com', `Neha task ${i}`, 9 + i, i <= 2 ? 'COMPLETED' : 'IN_PROGRESS', i <= 2 ? 7 + i : null);
for (let i = 1; i <= 4; i++) await task('tm.delivery@amuwa.com', `Mohan task ${i}`, 9 + i, 'COMPLETED', 7 + i);
for (let i = 1; i <= 2; i++) await task('tm2.delivery@amuwa.com', `Rina task ${i}`, 9 + i, 'COMPLETED', 7 + i);
for (let i = 1; i <= 2; i++) await task('lead@amuwa.com', `Lead task ${i}`, 18 + i, 'COMPLETED', 17 + i);
for (let i = 1; i <= 2; i++) await task('tl.delivery@amuwa.com', `Dina task ${i}`, 18 + i, 'COMPLETED', 17 + i);
await report('rahul@amuwa.com', 'APPROVED'); await report('tm.delivery@amuwa.com', 'APPROVED'); await report('neha@amuwa.com', 'SUBMITTED');
await report('lead@amuwa.com', 'APPROVED'); await report('tl.delivery@amuwa.com', 'APPROVED', 14);
ok(`fixture: last month's (${pmMonth}) tasks and reports were entered as real records`);

// an Operations Head who manages Wabastore (home department: a department of their own)
const [{ id: opsHome }] = await q(`insert into departments (slug, name) values ('ops-home', 'Operations Home') returning id`);
const OPS = 'ops.toppers@amuwa.com';
PASSWORDS[OPS] = secret();
const ops = await api(sa, 'POST', '/users', { email: OPS, fullName: 'Olive Ops', password: PASSWORDS[OPS], role: 'DEPARTMENT_HEAD', departmentId: opsHome, operationsHead: true });
await api(sa, 'POST', `/operations/heads/${ops.id}/scope`, { departmentIds: [wab], primaryDepartmentIds: [wab] });
ok('fixture: an Operations Head who manages Wabastore');

// ------------------------------------------------------------------ 1. the Department Head
const dh = await login('dh@amuwa.com');
const labels = await navLabels(dh);
await expect(labels.some(l => l === NAV), `the Department Head's sidebar has "${NAV}"`);
await openToppers(dh);
await dh.getByTestId('month-picker').fill(pmMonth);
await wait(dh, '[data-testid="top-cards"]', 'the top performers did not load for last month');
await dh.screenshot({ path: `${OUT}/toppers-1-department.png`, fullPage: true });
const cards = await dh.locator('[data-testid="top-cards"] [data-testid="performer-card"]').allInnerTexts();
await expect(cards.length === 3, 'Top 3 performers are shown as cards', cards.length);
const firstScore = num(await dh.locator('[data-testid="top-cards"] [data-testid="performer-score"]').first().innerText());
await expect(/#1/.test(cards[0]) && /Rahul Mehta|Mohan Member/.test(cards[0]) && firstScore > 80, 'rank 1 is a member who finished everything on time, with name, designation, score, completed tasks and productivity', cards[0]);
await expect(/Completed/.test(cards[0]) && /Productivity/.test(cards[0]) && /Score/.test(cards[0]), 'the card shows score, completed tasks and productivity');
await dh.getByRole('tab', { name: 'Top 5' }).click();
const top5 = await dh.locator('[data-testid="top-cards"] [data-testid="performer-card"]').count();
await expect(top5 === 3, 'Top 5 shows every ranked employee when fewer than five are ranked (three here: two have too little data)', top5);
const kpi = await dh.getByTestId('kpi-ranked').innerText();
await expect(/5 of 7/.test(kpi), 'the summary says five of seven people (three employees and two Team Leads) are ranked', kpi);
// the complete ranking: ranked first, the person with too little data last and not ranked
const rows = await dh.locator('[data-testid="ranking-row"]').allInnerTexts();
await expect(rows.length === 5 && rows.slice(3).every(r => /Insufficient Data/.test(r)) && rows.slice(3).some(r => /Rina Rao/.test(r)), 'the complete ranking lists five employees; Rina Rao and one more are "Insufficient Data" and come last, not ranked', rows);
await expect(rows.slice(0, 3).every((r, i) => r.includes(`#${i + 1}`)), 'the others hold ranks 1 to 3');
// the individual card: measures, report status, evaluation (written from the figures: no AI key here)
await dh.locator('[data-testid="top-cards"] [data-testid="performer-card"]').first().getByRole('button', { name: /Open the full card/ }).click();
await wait(dh, '[data-testid="performer-detail"]', 'the individual card did not open');
await dh.waitForFunction(() => /Why this score/.test(document.querySelector('[data-testid="performer-evaluation"]')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => fail('the evaluation was not written'));
const detail = await dh.getByTestId('performer-detail').innerText();
await expect(/Task completion/.test(detail) && /Deadlines met/.test(detail) && /Approved reports/.test(detail) && /Report coverage/.test(detail) && /How the score was made/.test(detail), 'the card shows the measures behind the score, task and report figures');
await expect(/Evaluation from the figures/.test(await dh.getByTestId('performer-evaluation').innerText()), 'with no AI key the evaluation is written from the figures and says so');
await dh.screenshot({ path: `${OUT}/toppers-2-card.png` });
await closeDetail(dh);
// the person with insufficient data
await dh.getByRole('button', { name: 'Open the card of Rina Rao' }).click();
await wait(dh, '[data-testid="performer-detail"]', 'the card of the unranked person did not open');
await expect(/Insufficient Data/.test(await dh.getByTestId('performer-detail').innerText()), 'an employee with too little data is shown as Insufficient Data, with the reason');
await closeDetail(dh);

// Team Leads compared
await dh.getByRole('tab', { name: /^Team Leads/ }).click();
await wait(dh, '[data-testid="lead-cards"]', 'the Team Leads did not show');
const leads = await dh.locator('[data-testid="lead-cards"] [data-testid="performer-card"]').allInnerTexts();
await expect(leads.length === 2 && leads.some(l => /Lead Person/.test(l)) && leads.some(l => /Dina Delivery/.test(l)) && leads.every(l => /#[12]/.test(l)), 'the two Team Leads are compared, each with a rank', leads);

// monthly recognition: recommended, not official, approved only by the Department Head
await dh.getByRole('tab', { name: /^Monthly recognition/ }).click();
await wait(dh, '[data-testid="recognition-item"]', 'no recommendation showed');
const items = await dh.locator('[data-testid="recognition-item"]').evaluateAll(els => els.map(e => ({ status: e.getAttribute('data-status'), award: e.getAttribute('data-award') })));
await expect(items.length >= 4 && items.every(i => i.status === 'RECOMMENDED') && items.some(i => i.award === 'EMPLOYEE_OF_MONTH') && items.some(i => i.award === 'BEST_TEAM_LEAD'), 'the recommendations are not official: Employee of the Month, the top three, Best Team Lead and more', items);
await dh.screenshot({ path: `${OUT}/toppers-3-recognition.png`, fullPage: true });
const eomItem = dh.locator('[data-testid="recognition-item"][data-award="EMPLOYEE_OF_MONTH"]');
await eomItem.getByTestId('reject-recognition').click();
await dh.getByTestId('decision-confirm').click();
await wait(dh, '[role="alert"]', 'a rejection without a reason should say so');
await expect(/reason/i.test(await dh.locator('[role="alert"]').first().innerText()), 'a rejection needs a reason');
await dh.getByRole('button', { name: 'Cancel' }).click();
await eomItem.getByTestId('approve-recognition').click();
await dh.getByTestId('decision-note').fill('Well deserved');
await dh.getByTestId('decision-confirm').click();
await dh.waitForFunction(() => document.querySelector('[data-testid="recognition-item"][data-award="EMPLOYEE_OF_MONTH"]')?.getAttribute('data-status') === 'APPROVED', null, { timeout: 20000 }).catch(() => fail('the approved award did not become official on screen'));
const [rec] = await q(`select status, decided_by, decision_note from performer_recognitions where award_type = 'EMPLOYEE_OF_MONTH' and period_start = $1::date`, [pm]);
await expect(rec.status === 'APPROVED' && rec.decided_by === dhId && rec.decision_note === 'Well deserved', 'the Department Head\'s approval is stored with who decided and why', rec);
const others = await q(`select count(*)::int n from performer_recognitions where status <> 'RECOMMENDED' and period_start = $1::date`, [pm]);
await expect(others[0].n === 1, 'only that one award became official');
await expect((await q(`select count(*)::int n from notifications where type = 'RECOGNITION_APPROVED'`))[0].n === 1, 'and the winner was told');
await dh.getByRole('tab', { name: /^Monthly comparison/ }).click();
await wait(dh, '[data-testid="trend-bars"]', 'the monthly comparison did not show');
ok('the monthly comparison shows');
await dh.getByRole('tab', { name: /^How scores work/ }).click();
await wait(dh, '[data-testid="methodology-rules"]', 'the methodology did not show');
await expect(/Only APPROVED reports count/.test(await dh.getByTestId('methodology-rules').innerText()), 'the methodology states that only approved reports count');
await dh.getByRole('tab', { name: /^AI insights/ }).click();
await wait(dh, '[data-testid="insights"]', 'the insights did not show');
ok('the insights show');

// rankings follow the records: Neha finishes her open tasks on time
const beforeScore = num(await (async () => { await dh.getByRole('tab', { name: /^Complete ranking/ }).click(); return dh.locator('[data-testid="ranking-row"]', { hasText: 'Neha Shah' }).locator('td').nth(2).innerText(); })());
await q(`update public.work_tasks set status = 'COMPLETED', progress = 100, completed_at = ((($1::date + 12)::timestamp) + interval '8 hours') at time zone 'Asia/Kolkata'
          where assignee_id = (select id from profiles where email = 'neha@amuwa.com') and status <> 'COMPLETED'`, [pm]);
await dh.getByRole('button', { name: 'Refresh' }).click();
await dh.waitForFunction(b => { const row = [...document.querySelectorAll('[data-testid="ranking-row"]')].find(r => r.textContent.includes('Neha Shah')); return row && parseFloat(row.querySelectorAll('td')[2].textContent) > b; }, beforeScore, { timeout: 20000 })
  .catch(() => fail('Neha\'s score did not rise after her tasks were completed'));
ok(`the ranking follows the records: Neha's score rose from ${beforeScore} after her open tasks were completed`);
await dh.ctx.close();

// ------------------------------------------------------------------ 2. who else sees it
const lead = await login('lead@amuwa.com');
await expect(!(await navLabels(lead)).some(l => l === NAV), 'a Team Lead has no Top Performers & Rankings page');
await lead.ctx.close();
const rahul = await login('rahul@amuwa.com');
await expect(!(await navLabels(rahul)).some(l => l === NAV), 'nor does a Team Member');
const denied = await call(as(await idOf('rahul@amuwa.com')), 'GET', `/top-performers/department?month=${pmMonth}`);
await expect(denied.status === 403, 'and the API refuses them');
await rahul.ctx.close();

// ------------------------------------------------------------------ 3. the Operations Head: company view, read only
const oh = await login(OPS, undefined, 'text=Choose a department');
// an Operations Head looks after several departments: they pick one to work in, here their own
await oh.locator('section, article, div').filter({ hasText: /^Operations Home/ }).getByText('Open dashboard').first().click().catch(async () => { await oh.getByText('Open dashboard').first().click(); });
await wait(oh, 'nav button', 'the Operations Head dashboard did not open');
await openToppers(oh, 'company-performers');
await oh.getByTestId('month-picker').fill(pmMonth);
await wait(oh, '[data-testid="company-top-employees"] [data-testid="performer-card"]', 'the departments did not load for last month');
const deptRows = await oh.locator('[data-testid="department-row"]').allInnerTexts();
await expect(deptRows.length === 1 && /Wabastore/.test(deptRows[0]), 'the Operations Head compares only the departments they manage', deptRows);
await expect(await oh.locator('[data-testid="company-top-employees"] [data-testid="performer-card"]').count() === 3, 'and sees the top employees across them');
await oh.screenshot({ path: `${OUT}/toppers-4-operations.png`, fullPage: true });
await oh.getByRole('button', { name: 'Open Wabastore' }).click();
await wait(oh, '[data-testid="top-performers-page"]', 'the department did not open');
await oh.getByRole('tab', { name: /^Monthly recognition/ }).click();
await wait(oh, '[data-testid="recognition-item"]', 'the recognition did not show');
await expect(await oh.getByTestId('approve-recognition').count() === 0 && await oh.getByTestId('reject-recognition').count() === 0, 'an Operations Head cannot approve or reject recognition');
const official = await oh.locator('[data-testid="recognition-item"][data-status="APPROVED"]').count();
await expect(official === 1, 'but sees the official award the Department Head approved');
await oh.ctx.close();

// ------------------------------------------------------------------ 4. the Super Admin
// the Super Admin of the seed has no password (token only), so the company view is checked through the same API the screen calls
const saView = await call(as(sa), 'GET', `/top-performers/company?month=${pmMonth}`);
await expect(saView.status === 200 && saView.data.departments.some(d => d.name === 'Wabastore') && saView.data.topEmployees.length >= 3, 'the Super Admin\'s company view lists every department and the top employees across them');
const saDept = await call(as(sa), 'GET', `/top-performers/department?month=${pmMonth}&departmentId=${wab}`);
await expect(saDept.status === 200 && saDept.data.canDecide === false, 'the Super Admin can open any department, read only');
const saDecide = await call(as(sa), 'POST', `/top-performers/recognitions/${saDept.data.recognitions.find(r => r.status === 'RECOMMENDED').id}/decision`, { decision: 'APPROVE' });
await expect(saDecide.status === 403, 'and cannot approve recognition');

// ------------------------------------------------------------------ 5. phone width
const phone = await login('dh@amuwa.com', { width: 390, height: 820 }, 'button[aria-label="Toggle menu"]');
await phone.getByRole('button', { name: 'Toggle menu' }).click();
await new Promise(r => setTimeout(r, 400));
await menuItem(phone, NAV).click();
await wait(phone, '[data-testid="top-performers-page"]', 'the page did not open on a phone');
await phone.getByTestId('month-picker').fill(pmMonth);
await wait(phone, '[data-testid="top-cards"]', 'the cards did not load on a phone');
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await expect(overflow <= 1, 'on a phone the page does not scroll sideways', overflow);
await phone.screenshot({ path: `${OUT}/toppers-5-phone.png`, fullPage: true });
await phone.ctx.close();

await expect(errors.length === 0, 'no console or page errors were raised', errors.slice(0, 3));
console.log(`ALL ${step} TOP PERFORMER CHECKS PASSED`);
await db.end();
await browser.close();
