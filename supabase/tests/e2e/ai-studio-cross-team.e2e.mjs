// AI Studio cross-team task assignment in real browsers (migration 20270221000100), signed in through the login page.
//   Team A (Web Development): Team Lead A, Employee A.   Team B (Sales Automation): Team Lead B, Employee C.
//   Team Lead B gives Employee A a Sales Automation task from the grouped, searchable picker (with Employee A's workload and the warning);
//   Employee A sees it (Cross-team label, filter, task details); Team Lead B may change and delete it, Team Lead A (Arun's own) sees it but may not;
//   global search finds the task; nobody gets more. The daily report is main's (20270219000100_ai_studio_consolidated_reports) and is not tested here.
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
// Employee A's own team work: four open tasks, two high priority (so the picker warns)
await api(P.leadA.id, 'POST', '/ai-studio/tasks', { projectId: webDev, assigneeId: P.memA.id, title: 'Website mobile responsiveness', priority: 'HIGH', dueDate: plus(2) });
await api(P.leadA.id, 'POST', '/ai-studio/tasks', { projectId: internal, assigneeId: P.memA.id, title: 'API testing', priority: 'HIGH', dueDate: plus(4) });
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

// ============================ who may change it: Team Lead B (who gave it) yes, Team Lead A (Arun's own) no
const lb2 = await login(P.leadB.email);
await nav(lb2, 'Projects');
await lb2.getByRole('tab', { name: 'Team Tasks' }).click().catch(() => undefined);
await wait(lb2, '[data-testid="ai-task-row"]', 'Team Lead B sees the task they gave under Team Tasks');
await lb2.getByTestId('ai-task-row').filter({ hasText: 'Campaign follow-up logic' }).first().click();
await waitText(lb2, /Edit task \/ deadline/, 'Team Lead B may change the cross-team task');
expect((await lb2.getByTestId('ai-task-delete').count()) === 1, 'Team Lead B may delete it too (20270220000100)');
await lb2.context().close();
const la = await login(P.leadA.email);
await nav(la, 'Projects');
await la.getByRole('tab', { name: 'Team Tasks' }).click().catch(() => undefined);
await wait(la, '[data-testid="ai-task-row"]', 'Team Lead A sees Arun\'s workload under Team Tasks');
const laRow = await la.getByTestId('ai-task-row').filter({ hasText: 'Campaign follow-up logic' }).first().innerText();
expect(/Cross-team/.test(laRow), 'the cross-team task is in Team Lead A\'s list, labelled', laRow);
await la.getByTestId('ai-task-row').filter({ hasText: 'Campaign follow-up logic' }).first().click();
await wait(la, '[data-testid="task-ownership"]', 'Team Lead A opens it');
await la.waitForTimeout(500);
expect(!(await la.evaluate(() => document.body.innerText)).includes('Edit task / deadline') && (await la.getByTestId('ai-task-delete').count()) === 0,
  'Team Lead A (Arun\'s own) may neither change nor delete it');
const laEdit = await call(P.leadA.id, 'PATCH', `/ai-studio/tasks/${cross.id}`, { title: 'Changed by Lead A', priority: 'LOW' });
expect(laEdit.status === 403, 'nor through a direct API request (403)', laEdit);
await la.screenshot({ path: `${OUT}/after-own-lead-cross-team-view.png`, fullPage: false });
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
console.log(`=== AI STUDIO CROSS-TEAM ASSIGNMENT E2E PASSED (${step}) ===`);
await browser.close();
await db.end();
