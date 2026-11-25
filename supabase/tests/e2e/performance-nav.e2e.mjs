// Performance Management in the side panels, in real browsers, signed in through the login page (migrations 20270213000100 and 20270214000100).
// For AI Studio, International and Reseller (and the Sales Team Lead's dashboard as a control):
//   Team Lead: "Performance Management" is its own side-panel entry (not a tab of Daily Report); it opens the page with their team members from the database;
//              they open a member, see the member's tasks and daily reports, edit and approve a waiting report, and approve the member's performance with a rating;
//              the direct address of the page works after a reload.
//   Department Head: the entry is there; the page shows the department's Team Leads and their members; they approve the Team Lead's performance with a rating.
//   Team Member: no Performance Management / My Performance entry; the direct address opens their Overview; the API refuses them (403).
//   Daily Report(s) stays where it was, with its tabs.
// Against the local stack (Postgres + PostgREST + gateway + the web app). Passwords are made up at run time; nothing is stored.
import crypto from 'node:crypto';
import pg from 'pg';

import { createRequire } from 'node:module';

// Playwright: the project's, else a machine-wide install (as the browser unit tests find it)
const require = createRequire(import.meta.url);
let chromium;
for (const m of ['playwright', 'playwright-core', '/opt/node-tools/node_modules/playwright']) { try { ({ chromium } = require(m)); break; } catch { /* next */ } }
if (!chromium) { try { ({ chromium } = await import('playwright')); } catch { console.error('Playwright is not installed'); process.exit(1); } }

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

const pw = { 'root@amuwa.com': process.env.SA_PASSWORD };
const mkpw = e => (pw[e] = secret());
const { rows: [sa] } = await db.query(`insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('root@amuwa.com', '{"full_name":"Root"}', '{"bootstrap_super_admin":true}') returning id`);
const departments = await api(sa.id, 'GET', '/departments');
const dept = slug => { const d = departments.find(x => x.slug === slug); if (!d) throw new Error(`no department ${slug}`); return d; };
const teamsOf = async d => api(sa.id, 'GET', `/teams?departmentId=${d.id}`);

// ---------------------------------------------------------------- the people, through the existing employee flow
const people = {};
const mk = async (key, by, body) => { mkpw(body.email); people[key] = { ...(await api(by, 'POST', '/users', { ...body, password: pw[body.email] })), email: body.email, name: body.fullName }; return people[key]; };
// AI Studio: a Department Head, a Team Lead and their Team Member (on a project)
const ai = dept('ai-studio');
const aiTeam = (await teamsOf(ai))[0];
const projects = Object.fromEntries((await api(sa.id, 'GET', '/ai-studio/projects')).map(p => [p.name, p.id]));
await mk('aiHead', sa.id, { email: 'ai.head@amuwa.com', fullName: 'Asha Head', role: 'DEPARTMENT_HEAD', departmentId: ai.id });
await mk('aiLead', sa.id, { email: 'ai.lead@amuwa.com', fullName: 'Arjun Lead', role: 'TEAM_HEAD', teamId: aiTeam.id, aiStudioProjectIds: [projects['AI CRM']] });
await mk('aiMember', people.aiLead.id, { email: 'ai.member@amuwa.com', fullName: 'Amit Member', role: 'TEAM_MEMBER', teamId: aiTeam.id, aiStudioProjectIds: [projects['AI CRM']] });
// International and Reseller: a Department Head, one Team Lead and their Team Member each
for (const [slug, tag, name] of [['international', 'intl', 'Ishan'], ['reseller', 'res', 'Rhea']]) {
  const d = dept(slug);
  const t = (await teamsOf(d))[0];
  await mk(`${tag}Head`, sa.id, { email: `${tag}.head@amuwa.com`, fullName: `${name} Head`, role: 'DEPARTMENT_HEAD', departmentId: d.id });
  await mk(`${tag}Lead`, sa.id, { email: `${tag}.lead@amuwa.com`, fullName: `${name} Lead`, role: 'TEAM_HEAD', teamId: t.id });
  await mk(`${tag}Member`, sa.id, { email: `${tag}.member@amuwa.com`, fullName: `${name} Member`, role: 'TEAM_MEMBER', teamId: t.id });
  await q(`update public.profiles set manager_id = $1 where id = $2`, [people[`${tag}Lead`].id, people[`${tag}Member`].id]);
  people[`${tag}Dept`] = d; people[`${tag}Team`] = t;
}
// a Sales Team Lead (the general Team Lead dashboard), as a control
const wab = dept('wabastore');
await mk('salesLead', sa.id, { email: 'sales.lead@amuwa.com', fullName: 'Sana Sales', role: 'TEAM_HEAD', teamId: (await teamsOf(wab)).find(t => t.name === 'Sales').id });

// ---------------------------------------------------------------- the work: a task and a daily report waiting for each Team Lead
const aiTask = await api(people.aiLead.id, 'POST', '/ai-studio/tasks', { projectId: projects['AI CRM'], assigneeId: people.aiMember.id, title: 'Build the login screen', dueDate: today });
const aiReport = await api(people.aiMember.id, 'POST', '/ai-studio/reports', { projectId: projects['AI CRM'], taskId: aiTask.id, reportDate: today, workCompleted: 'Built the login form layout', pendingWork: 'Error messages', submit: true });
for (const tag of ['intl', 'res']) {
  const [task] = await q(`insert into public.work_tasks (department_id, team_id, title, assigned_by, assignee_id, due_date) values ($1, $2, 'Call the new resellers', $3, $4, current_date + 3) returning id`,
    [people[`${tag}Dept`].id, people[`${tag}Team`].id, people[`${tag}Lead`].id, people[`${tag}Member`].id]);
  await api(people[`${tag}Member`].id, 'POST', '/task-reports', { taskId: task.id, reportDate: today, workCompleted: 'Called the first five resellers', progress: 40, pendingWork: 'Five more calls' });
}

// ---------------------------------------------------------------- the browser
const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
let step = 0; const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => { await current?.screenshot({ path: `${OUT}/performance-nav-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(0, 4)) : ''); process.exit(1); };
const expect = (c, m, detail) => (c ? ok(m) : fail(detail === undefined ? m : `${m} ${JSON.stringify(detail)}`));
process.on('uncaughtException', e => fail(`an unexpected error: ${String(e.message).split('\n').slice(0, 4).join(' | ')}`));
process.on('unhandledRejection', e => fail(`an unexpected error: ${String(e?.message ?? e).split('\n').slice(0, 4).join(' | ')}`));
const login = async email => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(pw[email]);
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector('nav button', { timeout: 25000, state: 'attached' }).catch(() => fail(`${email} did not reach a dashboard`));
  await p.waitForTimeout(600);
  return p;
};
const navLabels = p => p.locator('nav button').evaluateAll(els => els.map(e => e.innerText.replace(/\s+\d+$/, '').trim()));
const nav = async (p, label) => { current = p; await p.locator('nav button').filter({ hasText: new RegExp(`^\\s*${label}(\\s*\\d+)?\\s*$`) }).first().click(); await p.waitForTimeout(500); };
const waitText = async (p, re, m, t = 20000) => { current = p; await p.waitForFunction(r => new RegExp(r, 'i').test(document.body.innerText), re.source, { timeout: t }).catch(() => fail(`${m} (not on screen: ${re})`)); };
const wait = async (p, sel, m, t = 20000) => { current = p; await p.waitForSelector(sel, { timeout: t }).catch(() => fail(m)); };

const DEPTS = [
  { tag: 'ai', label: 'AI Studio', daily: /^Daily Reports?$/, base: id => `/ai-studio/dashboard/${id}`, ai: true },
  { tag: 'intl', label: 'International', daily: /^Daily Reports$/, base: id => `/unified/dashboard/${id}` },
  { tag: 'res', label: 'Reseller', daily: /^Daily Reports$/, base: id => `/unified/dashboard/${id}` }
];

for (const D of DEPTS) {
  const lead = people[`${D.tag}Lead`], head = people[`${D.tag}Head`], member = people[`${D.tag}Member`];
  // ======================= Team Lead
  const tl = await login(lead.email);
  let labels = await navLabels(tl);
  expect(labels.includes('Performance Management'), `${D.label} Team Lead: "Performance Management" is in the side panel`, labels);
  expect(labels.some(l => D.daily.test(l)), `${D.label} Team Lead: Daily Report(s) is still there, as its own entry`, labels);
  await tl.screenshot({ path: `${OUT}/${D.tag}-team-lead-sidebar.png` });
  await nav(tl, 'Performance Management');
  await wait(tl, '[data-testid="performance-approvals"]', `${D.label} Team Lead: Performance Management opens its page`);
  await waitText(tl, new RegExp(member.name), `${D.label} Team Lead: their Team Member is listed (from the database)`);
  expect(new URL(tl.url()).pathname === `${D.base(lead.id)}/performance`, `${D.label} Team Lead: the address is ${D.base('<id>')}/performance`, tl.url());
  // the direct address works after a reload
  await tl.reload();
  await wait(tl, '[data-testid="people-row"]', `${D.label} Team Lead: the direct address opens Performance Management after a reload`);
  // open the member: their tasks and daily reports
  await tl.getByTestId('people-row').filter({ hasText: member.name }).getByRole('button', { name: /Review|Details/ }).click();
  await wait(tl, '[data-testid="person-tasks"]', `${D.label} Team Lead: opening the member shows their assigned tasks`);
  const tasksText = await tl.getByTestId('person-tasks').innerText();
  expect(D.ai ? /Build the login screen/.test(tasksText) && /AI CRM/.test(tasksText) : /Call the new resellers/.test(tasksText), `${D.label} Team Lead: the member's real task is shown`, tasksText);
  if (D.ai) {
    // AI Studio's own daily report: open it, edit it, approve it
    await wait(tl, '[data-testid="person-ai-reports"] table', 'AI Studio Team Lead: the member\'s daily reports are listed');
    await tl.getByTestId('person-ai-reports').getByRole('button', { name: 'Open' }).first().click();
    await tl.getByRole('button', { name: 'Edit report' }).click();
    await wait(tl, '[data-testid="ai-report-lead-edit"]', 'AI Studio Team Lead: Edit report opens the correction form');
    await tl.locator('#ai-le-workCompleted').fill('Built the login form layout and the password field');
    await tl.locator('#ai-le-reason').fill('Added the password field you also finished');
    await tl.getByRole('button', { name: 'Save changes' }).click();
    await waitText(tl, /Edited by the Team Lead/, 'AI Studio Team Lead: the edit is saved and shown in the approval history');
    const [edited] = await q(`select work_completed, status from ai_studio_daily_reports where id = $1`, [aiReport.id]);
    expect(edited.work_completed === 'Built the login form layout and the password field' && edited.status === 'PENDING_TL_APPROVAL', 'AI Studio Team Lead: the database holds the corrected report, still waiting for the Team Lead', edited);
    await tl.getByRole('button', { name: 'Approve and send to the Department Head' }).click();
    await tl.waitForTimeout(800);
    expect((await q(`select status from ai_studio_daily_reports where id = $1`, [aiReport.id]))[0].status === 'PENDING_DH_APPROVAL', 'AI Studio Team Lead: the report is approved (sent to the Department Head)');
    await tl.keyboard.press('Escape');
    await tl.getByRole('button', { name: 'Close' }).last().click().catch(() => undefined);
  } else {
    await wait(tl, '[data-testid="person-work"] [data-testid="task-report-row"]', `${D.label} Team Lead: the member's daily report is listed`);
    await tl.getByTestId('person-work').getByRole('button', { name: 'Review' }).first().click();
    await tl.getByRole('button', { name: 'Edit report' }).click();
    await tl.locator('input[id^="tre-progress-"]').fill('50');
    await tl.locator('input[id^="tre-reason-"]').fill('Six calls were made, not five');
    await tl.getByRole('button', { name: 'Save changes' }).click();
    await waitText(tl, /Your changes are saved/, `${D.label} Team Lead: the report edit is saved`);
    await tl.getByTestId('task-report-review').locator('..').getByRole('button', { name: 'Approve', exact: true }).click();
    await tl.waitForTimeout(800);
    expect((await q(`select status, progress from task_daily_reports where author_id = $1`, [member.id]))[0].status === 'APPROVED', `${D.label} Team Lead: the edited report is approved`);
  }
  // evaluate the member: reload the figures, then approve with a rating
  await tl.reload();
  await wait(tl, '[data-testid="people-row"]', `${D.label} Team Lead: the page reloads`);
  await tl.getByTestId('people-row').filter({ hasText: member.name }).getByRole('button', { name: 'Review' }).click();
  await wait(tl, '[data-testid="record-review"]', `${D.label} Team Lead: the member's performance can be reviewed`);
  await tl.getByTestId('record-rating').first().selectOption('4');
  await tl.fill('textarea[id^="rr-"]', 'Good progress on the assigned task');
  await tl.getByTestId('record-review').getByRole('button', { name: 'Approve', exact: true }).click();
  await tl.waitForTimeout(800);
  const [rec] = await q(`select status, rating, reviewed_by from performance_records where subject_id = $1 order by refreshed_at desc limit 1`, [member.id]);
  expect(rec?.status === 'APPROVED' && rec.rating === 4 && rec.reviewed_by === lead.id, `${D.label} Team Lead: the member's performance is approved with a rating of 4, by the Team Lead`, rec);
  await waitText(tl, /Rating 4\/5/, `${D.label} Team Lead: the rating is shown`);
  await tl.getByRole('button', { name: 'Evaluation history' }).first().click();
  await wait(tl, '[data-testid="person-history"]', `${D.label} Team Lead: the member's evaluation history opens`);
  await tl.screenshot({ path: `${OUT}/${D.tag}-team-lead-performance.png`, fullPage: true });
  // Daily Report still works
  await nav(tl, labels.find(l => D.daily.test(l)));
  await tl.waitForTimeout(800);
  expect(!(await tl.getByTestId('performance-approvals').count()), `${D.label} Team Lead: Daily Report(s) still opens its own page`);
  await tl.context().close();

  // ======================= Department Head
  const dh = await login(head.email);
  labels = await navLabels(dh);
  expect(labels.includes('Performance Management'), `${D.label} Department Head: "Performance Management" is in the side panel`, labels);
  await nav(dh, 'Performance Management');
  await wait(dh, '[data-testid="leads-table"]', `${D.label} Department Head: Performance Management opens the department view`);
  const deptText = await dh.getByTestId('performance-approvals').innerText();
  expect(new RegExp(lead.name).test(deptText) && /Department tasks/.test(deptText), `${D.label} Department Head: department analytics and the Team Lead are shown`, deptText.slice(0, 400));
  await dh.getByTestId('lead-row').filter({ hasText: lead.name }).getByRole('button', { name: /Review|Open/ }).click();
  await wait(dh, '[data-testid="people-table"]', `${D.label} Department Head: opening the Team Lead shows their team`);
  const teamText = await dh.getByTestId('people-table').innerText();
  expect(new RegExp(member.name).test(teamText) && /Rating 4\/5/.test(teamText) && await dh.getByTestId('people-table').getByRole('button', { name: 'Review' }).count() === 0,
    `${D.label} Department Head: the member with the Team Lead's decision (rating 4), read only`, teamText);
  await dh.getByTestId('record-rating').first().selectOption('5');
  await dh.getByTestId('record-review').getByRole('button', { name: 'Approve', exact: true }).click();
  await dh.waitForTimeout(800);
  const [lrec] = await q(`select status, rating, reviewed_by from performance_records where subject_id = $1 order by refreshed_at desc limit 1`, [lead.id]);
  expect(lrec?.status === 'APPROVED' && lrec.rating === 5 && lrec.reviewed_by === head.id, `${D.label} Department Head: approves the Team Lead's performance with a rating of 5`, lrec);
  await dh.screenshot({ path: `${OUT}/${D.tag}-department-head-performance.png`, fullPage: true });
  await dh.context().close();

  // ======================= Team Member
  const tm = await login(member.email);
  labels = await navLabels(tm);
  expect(!labels.some(l => /performance/i.test(l)), `${D.label} Team Member: no Performance Management or My Performance in the side panel`, labels);
  await tm.goto(BASE + `${D.base(member.id)}/performance`);
  await tm.waitForTimeout(1500);
  expect(!(await tm.getByTestId('performance-approvals').count()), `${D.label} Team Member: the direct address does not open Performance Management`);
  const r = await call(member.id, 'GET', `/performance-approval/overview?start=${today}&end=${today}`);
  expect(r.status === 403, `${D.label} Team Member: the API refuses them (403)`, r.status);
  await tm.screenshot({ path: `${OUT}/${D.tag}-team-member-sidebar.png` });
  await tm.context().close();
}

// the general (Sales) Team Lead dashboard keeps its entry
const sl = await login(people.salesLead.email);
expect((await navLabels(sl)).includes('Performance Management'), 'Sales Team Lead: Performance Management is in the side panel');
await nav(sl, 'Performance Management');
await wait(sl, '[data-testid="performance-approvals"]', 'Sales Team Lead: it opens the page');
await sl.context().close();

expect(!errors.some(e => e.startsWith('pageerror')), 'no page errors', errors);
console.log(`=== PERFORMANCE MANAGEMENT SIDE PANEL E2E PASSED (${step}) ===`);
await browser.close();
await db.end();
