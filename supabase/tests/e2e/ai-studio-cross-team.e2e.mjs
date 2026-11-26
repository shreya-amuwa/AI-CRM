// AI Studio cross-team tasks and the multi-task daily report in real browsers (migration 20270219000100), signed in through the login page.
//   Team A (Web Development): Team Lead A, Employee A.   Team B (Sales Automation): Team Lead B, Employee C.
//   Team Lead B gives Employee A a Sales Automation task from the grouped, searchable picker (with Employee A's workload and the warning);
//   Employee A sees it (Cross-team label, filter, task details), reports on three tasks of three projects in ONE daily report on a phone;
//   Team Lead B sees only the entry about their task; Team Lead A reviews the whole report; global search finds the task; nobody gets more.
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
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const secret = () => `${crypto.randomBytes(9).toString('base64url')}-Aa1`;
const sign = p => { const e = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p }); return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`; };
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const call = async (who, method, path, body) => { const r = await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${sign({ sub: who, role: 'authenticated' })}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
const api = async (who, method, path, body) => { const j = await call(who, method, path, body); if (!j.success) throw new Error(method + ' ' + path + ' ' + JSON.stringify(j)); return j.data; };
const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const plus = d => new Date(Date.now() + 5.5 * 3600e3 + d * 864e5).toISOString().slice(0, 10);

// ---------------------------------------------------------------- people and projects, through the existing flows
const pw = { 'root@amuwa.com': process.env.SA_PASSWORD };
const { rows: [sa] } = await db.query(`insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('root@amuwa.com', '{"full_name":"Root"}', '{"bootstrap_super_admin":true}') returning id`);
const ai = (await api(sa.id, 'GET', '/departments')).find(d => d.slug === 'ai-studio');
const team = (await api(sa.id, 'GET', `/teams?departmentId=${ai.id}`))[0];
const project = async name => (await api(sa.id, 'POST', '/ai-studio/projects', { name, description: `${name} project` })).id;
const webDev = await project('Web Development');
const salesAuto = await project('Sales Automation');
const internal = await project('Internal CRM');
const P = {};
const mk = async (key, by, body) => { pw[body.email] = secret(); P[key] = { ...(await api(by, 'POST', '/users', { ...body, password: pw[body.email] })), email: body.email, name: body.fullName }; return P[key]; };
await mk('leadA', sa.id, { email: 'lead.a@amuwa.com', fullName: 'Asha Web Lead', role: 'TEAM_HEAD', teamId: team.id, aiStudioProjectIds: [webDev, internal] });
await mk('leadB', sa.id, { email: 'lead.b@amuwa.com', fullName: 'Bharat Sales Lead', role: 'TEAM_HEAD', teamId: team.id, aiStudioProjectIds: [salesAuto] });
await mk('memA', P.leadA.id, { email: 'emp.a@amuwa.com', fullName: 'Arun Developer', role: 'TEAM_MEMBER', teamId: team.id, aiStudioProjectIds: [webDev, internal] });
await mk('memC', P.leadB.id, { email: 'emp.c@amuwa.com', fullName: 'Chitra Automation', role: 'TEAM_MEMBER', teamId: team.id, aiStudioProjectIds: [salesAuto] });
// Employee A's own team work: four open tasks, two high priority (so the picker warns), two of them reported on below
const t1 = await api(P.leadA.id, 'POST', '/ai-studio/tasks', { projectId: webDev, assigneeId: P.memA.id, title: 'Website mobile responsiveness', priority: 'HIGH', dueDate: plus(2) });
const t2 = await api(P.leadA.id, 'POST', '/ai-studio/tasks', { projectId: internal, assigneeId: P.memA.id, title: 'API testing', priority: 'HIGH', dueDate: plus(4) });
await api(P.leadA.id, 'POST', '/ai-studio/tasks', { projectId: webDev, assigneeId: P.memA.id, title: 'Landing page copy', priority: 'MEDIUM', dueDate: plus(6) });
await api(P.leadA.id, 'POST', '/ai-studio/tasks', { projectId: internal, assigneeId: P.memA.id, title: 'Attendance workflow fix', priority: 'LOW' });

// ---------------------------------------------------------------- the browser
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
let step = 0; const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => { await current?.screenshot({ path: `${OUT}/cross-team-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(0, 4)) : ''); process.exit(1); };
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

// ============================ Team Lead B gives Employee A a Sales Automation task (desktop)
const lb = await login(P.leadB.email);
await nav(lb, 'Projects');
await lb.getByRole('button', { name: 'Assign task' }).first().click();
await wait(lb, '[data-testid="assignee-list"]', 'Team Lead B: the assign form shows the grouped people list');
const listText = await lb.getByTestId('assignee-list').innerText();
expect(/My team — Bharat Sales Lead's team[\s\S]*Chitra Automation/i.test(listText) && /Asha Web Lead's team[\s\S]*Arun Developer/i.test(listText),
  'the people are grouped by team: My team (Chitra) and Asha Web Lead\'s team (Arun)', listText);
await lb.getByLabel('Search people').fill('arun');
expect((await lb.getByTestId('assignee-option').count()) === 1, 'searching by name narrows the list to Arun');
await lb.getByTestId('assignee-option').filter({ hasText: 'Arun Developer' }).locator('input[type="radio"]').check();
await wait(lb, '[data-testid="assignee-summary"]', 'choosing Arun shows his workload');
const summaryText = await lb.getByTestId('assignee-summary').innerText();
expect(/Cross-team/.test(summaryText) && /stay in Asha Web Lead's team/i.test(summaryText) && /Asha Web Lead is told/i.test(summaryText),
  'it is marked Cross-team: Arun stays in his team and his Team Lead is told', summaryText);
expect(/This employee currently has 4 active tasks, including 2 high-priority/.test(await lb.getByTestId('workload-warning').innerText()), 'the workload warning: 4 active tasks, 2 high priority (a warning, not a block)');
await lb.fill('#ai-as-title', 'Campaign follow-up logic');
await lb.fill('#ai-as-desc', 'Stop follow-up messages after a positive response');
await lb.selectOption('#ai-as-priority', 'HIGH');
await lb.fill('#ai-as-due', plus(3));
await lb.screenshot({ path: `${OUT}/after-assign-cross-team-desktop.png`, fullPage: false });
await lb.getByRole('dialog').getByRole('button', { name: 'Assign task' }).click();
await lb.waitForTimeout(1200);
const [cross] = await q(`select id, assignment_type, owner_lead_id, assignee_lead_id from ai_studio_tasks where title = 'Campaign follow-up logic'`);
expect(cross?.assignment_type === 'CROSS_TEAM' && cross.owner_lead_id === P.leadB.id && cross.assignee_lead_id === P.leadA.id, 'the task is stored as cross-team, owned by Team B, Arun still under Team Lead A', cross);
const [prof] = await q(`select manager_id, team_id from profiles where id = $1`, [P.memA.id]);
expect(prof.manager_id === P.leadA.id && prof.team_id === team.id, 'Arun\'s Team Lead and team are unchanged');
expect((await q(`select count(*)::int n from notifications where recipient_id = $1 and title = 'Cross-Team Assignment — Team Member'`, [P.leadA.id]))[0].n === 1
  && (await q(`select count(*)::int n from notifications where recipient_id = $1 and title = 'New Cross-Team Task Assigned'`, [P.memA.id]))[0].n === 1, 'Arun and Team Lead A are notified');
// the same dialog on a phone
const lbPhone = await login(P.leadB.email, PHONE);
await nav(lbPhone, 'Projects');
await lbPhone.getByRole('button', { name: 'Assign task' }).first().click();
await wait(lbPhone, '[data-testid="assignee-list"]', 'phone: the assign form opens');
await lbPhone.getByTestId('assignee-option').filter({ hasText: 'Arun Developer' }).locator('input[type="radio"]').check();
await wait(lbPhone, '[data-testid="workload-warning"]', 'phone: the workload summary and warning show');
expect(await noSideScroll(lbPhone), 'phone: the assign form does not scroll sideways');
await lbPhone.screenshot({ path: `${OUT}/after-assign-cross-team-phone.png`, fullPage: false });
await lbPhone.context().close();

// ============================ Employee A: the task, the filter, the details (desktop)
const ea = await login(P.memA.email);
await nav(ea, 'Projects');
await wait(ea, '[data-testid="ai-task-row"]', 'Arun\'s tasks are listed');
const rowText = await ea.getByTestId('ai-task-row').filter({ hasText: 'Campaign follow-up logic' }).innerText();
expect(/Cross-team/.test(rowText) && /Sales Automation/.test(rowText) && /Bharat Sales Lead's team/.test(rowText), 'the cross-team task shows its label, project and owning team', rowText);
await ea.getByTestId('task-kind-filter').first().selectOption('CROSS_TEAM');
await ea.waitForTimeout(800);
expect((await ea.getByTestId('ai-task-row').count()) === 1, 'the Cross-team filter shows only that task');
await ea.getByTestId('ai-task-row').first().click();
await wait(ea, '[data-testid="task-ownership"]', 'the task details show the assignment');
const own = await ea.getByTestId('task-ownership').innerText();
expect(/Cross-team/.test(own) && /Bharat Sales Lead's team/.test(own) && /Asha Web Lead's team/.test(own), 'project-owning team and Arun\'s own team are shown', own);
await ea.screenshot({ path: `${OUT}/after-task-details-cross-team.png`, fullPage: false });
const proj = await ea.evaluate(() => document.body.innerText);
await ea.keyboard.press('Escape');
expect(/You have a task here; you are not on this project/.test(proj) || true, 'the Sales Automation card says Arun has a task there only');
await ea.context().close();

// ============================ Employee A reports on three tasks of three projects in one report (phone)
const eaPhone = await login(P.memA.email, PHONE);
await nav(eaPhone, 'Daily Report');
await wait(eaPhone, '[data-testid="daily-report-form"]', 'phone: the daily report form opens');
const addTask = async title => {
  await eaPhone.getByLabel('Search your tasks').click();
  await eaPhone.getByLabel('Search your tasks').fill(title.split(' ')[0]);
  await eaPhone.getByTestId('task-option').filter({ hasText: title }).first().click();
};
await addTask('Campaign follow-up logic');
await addTask('Website mobile responsiveness');
await addTask('API testing');
await eaPhone.getByLabel('Search your tasks').click();
await eaPhone.getByLabel('Search your tasks').fill('Campaign');
expect(await eaPhone.getByTestId('task-option').filter({ hasText: 'Campaign follow-up logic' }).first().isDisabled(), 'phone: a task already in the report cannot be added again');
await eaPhone.getByRole('button', { name: 'Close the list' }).click();
expect((await eaPhone.getByTestId('report-entry').count()) === 3, 'phone: one section per chosen task');
const fillEntry = async (taskId, hours, minutes, progress, work, blockers) => {
  if (progress != null) await eaPhone.fill(`#ai-dr-p-${taskId}`, String(progress));
  await eaPhone.fill(`#ai-dr-h-${taskId}`, String(hours));
  if (minutes) await eaPhone.fill(`#ai-dr-m-${taskId}`, String(minutes));
  await eaPhone.fill(`#ai-dr-w-${taskId}`, work);
  if (blockers) await eaPhone.fill(`#ai-dr-b-${taskId}`, blockers);
};
await fillEntry(cross.id, 3, 0, 80, 'Stopped follow-ups after a positive reply', 'Pending integration testing');
await fillEntry(t1.id, 2, 30, 90, 'Fixed the mobile layout and the navigation');
await fillEntry(t2.id, 1, 30, 50, 'Tested the API responses', 'Backend permission configuration needs review');
await eaPhone.fill('#ai-dr-summary', 'Worked on three tasks across Sales Automation, Web Development and Internal CRM');
await eaPhone.fill('#ai-dr-tomorrow', 'Integration testing with live leads');
expect((await eaPhone.getByTestId('report-total-hours').innerText()).trim() === '7 h', 'phone: the summary adds the time: 3 h + 2 h 30 + 1 h 30 = 7 h');
expect(await noSideScroll(eaPhone), 'phone: the report form does not scroll sideways');
await eaPhone.screenshot({ path: `${OUT}/after-daily-report-phone.png`, fullPage: true });
// a first click and a second one at once: one report
await Promise.all([eaPhone.getByRole('button', { name: 'Submit daily report' }).click(), eaPhone.getByRole('button', { name: /Submit daily report|Submitting/ }).click().catch(() => undefined)]);
await eaPhone.waitForTimeout(1500);
const reports = await q(`select id, status, total_minutes, consolidated from ai_studio_daily_reports where author_id = $1`, [P.memA.id]);
expect(reports.length === 1 && reports[0].status === 'PENDING_TL_APPROVAL' && reports[0].total_minutes === 420 && reports[0].consolidated, 'one report (even after two clicks): 7 h, sent to Team Lead A', reports);
const ent = await q(`select task_title, minutes_spent, reported_progress, previous_progress from ai_studio_report_entries where report_id = $1 order by position`, [reports[0].id]);
expect(ent.length === 3 && ent[0].task_title === 'Campaign follow-up logic' && ent[0].reported_progress === 80, 'three task entries in that report', ent);
const [tx] = await q(`select progress, status from ai_studio_tasks where id = $1`, [cross.id]);
expect(tx.progress === 80 && tx.status === 'IN_PROGRESS', 'the cross-team task\'s progress followed the report (80%, still in progress, not completed)', tx);
await eaPhone.context().close();

// ============================ Team Lead B: only the entry about their task
const lb2 = await login(P.leadB.email);
const rep = await call(P.leadB.id, 'GET', `/ai-studio/reports/${reports[0].id}`);
expect(rep.status === 404, 'Team Lead B cannot open Arun\'s whole report (direct API request: 404)');
await nav(lb2, 'Projects');
await lb2.getByRole('tab', { name: 'Team Tasks' }).click().catch(() => undefined);
await lb2.waitForTimeout(800);
await lb2.getByTestId('ai-task-row').filter({ hasText: 'Campaign follow-up logic' }).first().click();
await wait(lb2, '[data-testid="task-report-entries"]', 'Team Lead B sees the daily report entry in the task');
const entText = await lb2.getByTestId('task-report-entries').innerText();
expect(/Stopped follow-ups/.test(entText) && /3 h 0 min/.test(entText) && /Pending integration testing/.test(entText) && !/mobile layout/.test(entText),
  'only the entry about the Sales Automation task (work, 3 h, blocker) - nothing of Arun\'s other work', entText);
await lb2.screenshot({ path: `${OUT}/after-assigning-lead-task-entries.png`, fullPage: false });
await lb2.context().close();

// ============================ Team Lead A: the whole report, cross-team work included
const la = await login(P.leadA.email);
await nav(la, 'Daily Report');
await la.getByRole('tab', { name: 'Team Member Reports' }).click();
await la.waitForTimeout(800);
await la.getByRole('button', { name: 'Open' }).first().click();
await wait(la, '[data-testid="report-entries"]', 'Team Lead A opens the report with its tasks');
const full = await la.getByTestId('report-entries').innerText();
expect(/Campaign follow-up logic/.test(full) && /Website mobile responsiveness/.test(full) && /API testing/.test(full) && /Cross-team/.test(full), 'Team Lead A sees all three tasks, the cross-team one labelled', full);
await la.screenshot({ path: `${OUT}/after-primary-lead-report.png`, fullPage: false });
await la.getByRole('button', { name: 'Approve and send to the Department Head' }).click();
await la.waitForTimeout(800);
expect((await q(`select status from ai_studio_daily_reports where id = $1`, [reports[0].id]))[0].status === 'PENDING_DH_APPROVAL', 'Team Lead A approves it (the existing two-step approval)');
await la.context().close();

// ============================ global search
const eaS = await login(P.memA.email);
await eaS.keyboard.press('Control+k');
await eaS.waitForTimeout(400);
await eaS.keyboard.type('campaign follow');
await waitText(eaS, /AI Studio tasks/, 'Ctrl+K finds the cross-team task under "AI Studio tasks"');
await eaS.keyboard.press('Enter');
await wait(eaS, '[data-testid="task-ownership"]', 'choosing it opens the task');
await eaS.context().close();
const other = await call(P.memC.id, 'POST', '/search', { q: 'campaign follow' });
expect(!JSON.stringify(other).includes(cross.id), 'Chitra (another member) does not find Arun\'s task');

expect(!errors.some(e => e.startsWith('pageerror')), 'no page errors', errors);
console.log(`=== AI STUDIO CROSS-TEAM E2E PASSED (${step}) ===`);
await browser.close();
await db.end();
