// Deleting assigned tasks in real browsers (migration 20270220000100), signed in through the login page.
//   Task module (Wabastore Support): the Team Lead deletes a task they gave from "Assign Task"; the Department Head deletes a task they gave from their
//   "Assign Task" page; the Team Member opens their task and finds no Delete option. AI Studio: the employee finds no Delete option; the Team Lead deletes a
//   task they assigned; the Department Head deletes another. Each delete asks for confirmation naming the task, then the task leaves the list at once and
//   the assignee is told. A Team Member's direct API call is refused.
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
const plus = d => new Date(Date.now() + 5.5 * 3600e3 + d * 864e5).toISOString().slice(0, 10);

// ---------------------------------------------------------------- people, through the existing flows
const pw = { 'root@amuwa.com': process.env.SA_PASSWORD };
const { rows: [sa] } = await db.query(`insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('root@amuwa.com', '{"full_name":"Root"}', '{"bootstrap_super_admin":true}') returning id`);
const depts = await api(sa.id, 'GET', '/departments');
const wab = depts.find(d => d.slug === 'wabastore');
const ai = depts.find(d => d.slug === 'ai-studio');
const support = (await api(sa.id, 'GET', `/teams?departmentId=${wab.id}`)).find(t => t.name === 'Support');
const aiTeam = (await api(sa.id, 'GET', `/teams?departmentId=${ai.id}`))[0];
const P = {};
const mk = async (key, by, body) => { pw[body.email] = secret(); P[key] = { ...(await api(by, 'POST', '/users', { ...body, password: pw[body.email] })), email: body.email, name: body.fullName }; return P[key]; };
await mk('dh', sa.id, { email: 'support.head@amuwa.com', fullName: 'Deepa Support Head', role: 'DEPARTMENT_HEAD', departmentId: wab.id, headDivision: 'SUPPORT' });
await mk('tl', sa.id, { email: 'support.lead@amuwa.com', fullName: 'Tarun Support Lead', role: 'TEAM_HEAD', teamId: support.id });
await mk('mem', P.tl.id, { email: 'support.member@amuwa.com', fullName: 'Meera Support', role: 'TEAM_MEMBER', teamId: support.id });
const project = (await api(sa.id, 'POST', '/ai-studio/projects', { name: 'Client Portal', description: 'Client Portal project' })).id;
await mk('aiDh', sa.id, { email: 'ai.head@amuwa.com', fullName: 'Anil Studio Head', role: 'DEPARTMENT_HEAD', departmentId: ai.id });
await mk('aiLead', sa.id, { email: 'ai.lead@amuwa.com', fullName: 'Lata Studio Lead', role: 'TEAM_HEAD', teamId: aiTeam.id, aiStudioProjectIds: [project] });
await mk('aiMem', P.aiLead.id, { email: 'ai.member@amuwa.com', fullName: 'Ravi Developer', role: 'TEAM_MEMBER', teamId: aiTeam.id, aiStudioProjectIds: [project] });

// Task module tasks (the Support side of Wabastore)
const task = async (title, by, to) => (await q(`insert into work_tasks (department_id, team_id, title, description, assigned_by, assignee_id, due_date, priority)
  values ($1, $2, $3, 'Created for the deletion test', $4, $5, $6, 'MEDIUM') returning id`, [wab.id, support.id, title, by, to, plus(3)]))[0].id;
const tLead = await task('Update the FAQ page', P.tl.id, P.mem.id);
const tKeep = await task('Call back pending clients', P.tl.id, P.mem.id);
const tHead = await task('Prepare the monthly support report', P.dh.id, P.tl.id);
// AI Studio tasks, through the API
const a1 = await api(P.aiLead.id, 'POST', '/ai-studio/tasks', { projectId: project, assigneeId: P.aiMem.id, title: 'Login page redesign', priority: 'HIGH', dueDate: plus(2) });
const a2 = await api(P.aiLead.id, 'POST', '/ai-studio/tasks', { projectId: project, assigneeId: P.aiMem.id, title: 'Payment page testing', priority: 'MEDIUM', dueDate: plus(4) });

// ---------------------------------------------------------------- the browser
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
let step = 0; const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => { await current?.screenshot({ path: `${OUT}/task-deletion-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(0, 4)) : ''); process.exit(1); };
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


const openCard = async (p, id, m) => { await wait(p, `[data-task-card="${id}"]`, m); await p.locator(`[data-task-card="${id}"]`).first().click(); await wait(p, '[data-testid="task-workspace"]', `${m}: the task workspace opens`); };
const confirmDelete = async (p, title, label) => {
  await wait(p, '[data-testid="app-dialog-layer"]', 'the delete confirmation opens');
  const dialog = await p.getByTestId('app-dialog-layer').innerText();
  expect(/Delete this (task|assignment)\?/.test(dialog) && dialog.includes(title) && /cannot be undone/i.test(dialog), `the confirmation names "${title}" and warns it cannot be undone`, dialog);
  return dialog;
};

// ============================ Task module: the Team Member sees no Delete option and the API refuses them
const m = await login(P.mem.email);
await nav(m, 'My Assigned Tasks');
await openCard(m, tKeep, 'the Team Member sees their task');
await waitText(m, /Task overview/, 'the workspace loads');
await m.waitForTimeout(1200);
expect((await m.getByTestId('task-delete').count()) === 0, 'the Team Member has no Delete option on their own task');
await m.screenshot({ path: `${OUT}/member-no-delete.png` });
const refused = await call(P.mem.id, 'DELETE', `/work-tasks/${tKeep}`);
expect(refused.status === 403, 'a Team Member\'s direct API call is rejected (403)', refused);
await m.context().close();

// ============================ Task module: the Team Lead deletes a task they gave
const l = await login(P.tl.email);
await nav(l, 'Assign Task');
await openCard(l, tLead, 'the Team Lead sees the task they gave');
await wait(l, '[data-testid="task-delete"]', 'the Team Lead has the Delete option on a task they gave');
await l.getByTestId('task-delete').click();
const d1 = await confirmDelete(l, 'Update the FAQ page');
expect(/Meera Support/.test(d1), 'the confirmation names the assignee', d1);
await l.screenshot({ path: `${OUT}/team-lead-confirm-delete.png` });
// cancel first: nothing happens
await l.getByTestId('app-dialog-layer').getByRole('button', { name: 'Keep task' }).click();
await l.waitForTimeout(400);
expect((await q(`select count(*)::int n from work_tasks where id = $1`, [tLead]))[0].n === 1 && (await l.getByTestId('task-workspace').count()) === 1, 'cancelling keeps the task and the workspace');
await l.getByTestId('task-delete').click();
await confirmDelete(l, 'Update the FAQ page');
await l.getByTestId('app-dialog-layer').getByRole('button', { name: 'Delete task' }).click();
await wait(l, '[data-testid="toast-success"]', 'a success message is shown');
expect(/Task deleted: Update the FAQ page/.test(await l.getByTestId('toast-success').first().innerText()), 'the success message names the task');
current = l; await l.waitForFunction(id => !document.querySelector(`[data-task-card="${id}"]`) && !document.querySelector('[data-testid="task-workspace"]'), tLead, { timeout: 10000 }).catch(() => fail('the task left the list at once'));
ok('the workspace closed and the task left the Team Lead\'s list at once');
expect(await l.locator(`[data-task-card="${tKeep}"]`).count() > 0, 'the other task is still listed');
await l.screenshot({ path: `${OUT}/team-lead-after-delete.png` });
expect((await q(`select count(*)::int n from work_tasks where id = $1`, [tLead]))[0].n === 0, 'the task is gone from the database');
expect((await q(`select count(*)::int n from notifications where recipient_id = $1 and type = 'TASK_DELETED'`, [P.mem.id]))[0].n === 1, 'the assignee is told');
// the Team Lead cannot delete a task given to them
await l.context().close();

// ============================ Task module: the Department Head deletes a task they gave (Assign Task page)
const h = await login(P.dh.email);
await nav(h, 'Assign Task');
await openCard(h, tHead, 'the Department Head sees the task they gave');
await wait(h, '[data-testid="task-delete"]', 'the Department Head has the Delete option');
await h.getByTestId('task-delete').click();
await confirmDelete(h, 'Prepare the monthly support report');
await h.getByTestId('app-dialog-layer').getByRole('button', { name: 'Delete task' }).click();
await wait(h, '[data-testid="toast-success"]', 'the Department Head sees the success message');
current = h; await h.waitForFunction(id => !document.querySelector(`[data-task-card="${id}"]`), tHead, { timeout: 10000 }).catch(() => fail('the task left the head\'s list'));
ok('the task left the Department Head\'s list at once');
expect((await q(`select count(*)::int n from work_tasks where id = $1`, [tHead]))[0].n === 0, 'the head\'s task is gone from the database');
await h.context().close();

// ============================ AI Studio: the employee cannot, the Team Lead and the Department Head can
const am = await login(P.aiMem.email);
await nav(am, 'Projects');
await wait(am, '[data-testid="ai-task-row"]', 'the AI Studio employee sees their tasks');
await am.getByTestId('ai-task-row').filter({ hasText: 'Login page redesign' }).first().click();
await waitText(am, /Progress/, 'the AI Studio task opens');
await am.waitForTimeout(600);
expect((await am.getByTestId('ai-task-delete').count()) === 0, 'the AI Studio employee has no Delete option');
const aiRefused = await call(P.aiMem.id, 'DELETE', `/ai-studio/tasks/${a1.id}`);
expect(aiRefused.status === 403, 'the AI Studio employee\'s direct API call is rejected (403)', aiRefused);
await am.context().close();

const al = await login(P.aiLead.email);
await nav(al, 'Projects');
await al.getByRole('tab', { name: 'Team Tasks' }).click();   // the tasks a Team Lead gave are under Team Tasks
await wait(al, '[data-testid="ai-task-row"]', 'the AI Studio Team Lead sees the tasks they gave');
await al.getByTestId('ai-task-row').filter({ hasText: 'Login page redesign' }).first().click();
await wait(al, '[data-testid="ai-task-delete"]', 'the AI Studio Team Lead has the Delete option');
await al.getByTestId('ai-task-delete').click();
await confirmDelete(al, 'Login page redesign');
await al.screenshot({ path: `${OUT}/ai-studio-confirm-delete.png` });
await al.getByTestId('app-dialog-layer').getByRole('button', { name: 'Delete task' }).click();
await wait(al, '[data-testid="toast-success"]', 'the AI Studio Team Lead sees the success message');
current = al; await al.waitForFunction(() => ![...document.querySelectorAll('[data-testid="ai-task-row"]')].some(r => r.textContent.includes('Login page redesign')), null, { timeout: 10000 }).catch(() => fail('the AI Studio task left the list'));
ok('the AI Studio task left the Team Lead\'s list at once');
expect((await q(`select count(*)::int n from ai_studio_tasks where id = $1`, [a1.id]))[0].n === 0, 'the AI Studio task is gone from the database');
await al.context().close();

const ah = await login(P.aiDh.email);
await nav(ah, 'Tasks');
await ah.getByRole('tab', { name: 'Team Tasks' }).click({ timeout: 3000 }).catch(() => undefined);
await wait(ah, '[data-testid="ai-task-row"]', 'the AI Studio Department Head sees the department\'s tasks');
await ah.getByTestId('ai-task-row').filter({ hasText: 'Payment page testing' }).first().click();
await wait(ah, '[data-testid="ai-task-delete"]', 'the AI Studio Department Head has the Delete option on a Team Lead\'s task');
await ah.getByTestId('ai-task-delete').click();
await confirmDelete(ah, 'Payment page testing');
await ah.getByTestId('app-dialog-layer').getByRole('button', { name: 'Delete task' }).click();
await wait(ah, '[data-testid="toast-success"]', 'the AI Studio Department Head sees the success message');
expect((await q(`select count(*)::int n from ai_studio_tasks where id = $1`, [a2.id]))[0].n === 0, 'the Department Head\'s delete removed the task');
expect((await q(`select count(*)::int n from notifications where recipient_id = $1 and type = 'AI_STUDIO_TASK_DELETED'`, [P.aiMem.id]))[0].n === 2, 'the employee is told about both');
await ah.context().close();

expect(errors.length === 0, 'no page errors', errors);
await browser.close();
await db.end();
console.log('=== TASK DELETION BROWSER CHECKS PASSED ===');
