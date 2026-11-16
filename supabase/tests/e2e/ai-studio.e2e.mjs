// AI Studio in real browsers: the Department Head, two Team Leads and two Team Members of the department, signed in at the same time.
//   Head adds a project and a Team Lead form offers the projects from the database (with Add Project)
//   Team Lead gives a task -> Team Member updates progress and completes it -> the Team Lead sees it
//   Team Member submits the daily report -> Team Lead approves -> Department Head approves -> Approved (history visible)
//   Another Team Lead sees nothing of it; a phone-sized window does not scroll sideways.
// Against the local stack (Postgres + PostgREST + gateway + the web app). Passwords are made up at run time; nothing is stored.
import crypto from 'node:crypto';
import pg from 'pg';

let chromium;
try { ({ chromium } = await import('playwright')); } catch { ({ chromium } = await import('playwright-core')); }

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const OUT = process.argv[2] || '.';
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const secret = () => `${crypto.randomBytes(9).toString('base64url')}-Aa1`;
const sign = p => { const e = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p }); return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`; };
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const call = async (token, method, path, body) => { const r = await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
const as = who => sign({ sub: who, role: 'authenticated' });
const api = async (who, method, path, body) => { const j = await call(as(who), method, path, body); if (!j.success) throw new Error(path + JSON.stringify(j)); return j.data; };

const pw = { 'root@amuwa.com': process.env.SA_PASSWORD };
const mkpw = e => (pw[e] = secret());
const { rows: [sa] } = await db.query(`insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('root@amuwa.com', '{"full_name":"Root"}', '{"bootstrap_super_admin":true}') returning id`);
const ai = (await api(sa.id, 'GET', '/departments')).find(d => d.slug === 'ai-studio');
const team = (await api(sa.id, 'GET', `/teams?departmentId=${ai.id}`))[0];
const projects = await api(sa.id, 'GET', '/ai-studio/projects').catch(() => []); // the Super Admin lists them as well
const head = await api(sa.id, 'POST', '/users', { email: 'ai.head@amuwa.com', fullName: 'Hari Head', password: mkpw('ai.head@amuwa.com'), role: 'DEPARTMENT_HEAD', departmentId: ai.id });
const byName = Object.fromEntries(projects.map(p => [p.name, p.id]));
const tl1 = await api(head.id, 'POST', '/users', { email: 'ai.tl1@amuwa.com', fullName: 'Lata Lead', password: mkpw('ai.tl1@amuwa.com'), role: 'TEAM_HEAD', teamId: team.id, aiStudioProjectIds: [byName['AI CRM'], byName['AI Website']] });
const tl2 = await api(head.id, 'POST', '/users', { email: 'ai.tl2@amuwa.com', fullName: 'Leela Lead', password: mkpw('ai.tl2@amuwa.com'), role: 'TEAM_HEAD', teamId: team.id, aiStudioProjectIds: [byName['AIQR']] });
const m1 = await api(tl1.id, 'POST', '/users', { email: 'ai.m1@amuwa.com', fullName: 'Mohan Member', password: mkpw('ai.m1@amuwa.com'), role: 'TEAM_MEMBER', teamId: team.id, aiStudioProjectIds: [byName['AI CRM']] });
const m2 = await api(tl2.id, 'POST', '/users', { email: 'ai.m2@amuwa.com', fullName: 'Meena Member', password: mkpw('ai.m2@amuwa.com'), role: 'TEAM_MEMBER', teamId: team.id, aiStudioProjectIds: [byName['AIQR']] });

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM, args: ['--no-sandbox'] } : {});
let step = 0; const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => { await current?.screenshot({ path: `${OUT}/ai-studio-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(0, 4)) : ''); process.exit(1); };
const expect = (c, m, detail) => (c ? ok(m) : fail(detail === undefined ? m : `${m} ${JSON.stringify(detail)}`));
process.on('uncaughtException', e => fail(`an unexpected error: ${String(e.message).split('\n').slice(0, 4).join(' | ')}`));
process.on('unhandledRejection', e => fail(`an unexpected error: ${String(e?.message ?? e).split('\n').slice(0, 4).join(' | ')}`));
const open = async (viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => m.type() === 'error' && !/Failed to load resource|fonts\.g|net::ERR/.test(m.text()) && errors.push('console: ' + m.text()));
  p.ctx = ctx;
  return p;
};
const login = async (email, viewport) => {
  const p = await open(viewport);
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(pw[email]);
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector('nav button', { timeout: 25000, state: 'attached' }).catch(() => fail(`${email} did not reach a dashboard`));
  return p;
};
const text = p => p.evaluate(() => document.body.innerText);
const nav = async (p, label) => { current = p; await p.locator('nav button').filter({ hasText: new RegExp(`^\\s*${label}(\\s*\\d+)?\\s*$`) }).first().click(); await p.waitForTimeout(400); };
const navLabels = p => p.locator('nav button').evaluateAll(els => els.map(e => e.innerText.replace(/\s+\d+$/, '').trim()));
const wait = async (p, sel, m, t = 20000) => { current = p; await p.waitForSelector(sel, { timeout: t }).catch(() => fail(m)); };
const waitText = async (p, re, m, t = 20000) => { current = p; await p.waitForFunction(r => new RegExp(r, 'i').test(document.body.innerText), re.source, { timeout: t }).catch(() => fail(`${m} (not on screen: ${re})`)); };
const noSideScroll = p => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

// ---------------------------------------------------------------- Department Head
const dh = await login('ai.head@amuwa.com');
await waitText(dh, /AI Studio Overview/, 'the Head lands on the AI Studio overview');
ok('the Department Head lands on the AI Studio dashboard');
const headNav = await navLabels(dh);
expect(headNav.slice(0, 7).join('|') === 'Attendance|Meeting Request|Overview|Project Management|Tasks|Team Management|Daily Reports', 'the Head menu: Attendance, Meeting Request, Overview, Project Management, Tasks, Team Management, Daily Reports', headNav);
expect(['Raise an Issue', 'Chat', 'Notification Center'].every(l => headNav.includes(l)), 'and the shared Raise an Issue, Chat and Notification Center sections', headNav);
const overview = await text(dh);
expect(/5/.test(overview) && /Project-wise progress/.test(overview), 'the overview shows the department counts and project-wise progress');
const emp = (await q(`select count(*)::int n from profiles where department_id = $1 and status = 'ACTIVE'`, [ai.id]))[0].n;
expect(emp === 5 && (await dh.locator('[data-testid="stat-ai-studio-employees"]').count()) === 0 ? true : emp === 5, 'the head count in the database is five (head, two leads, two members)');
await dh.screenshot({ path: `${OUT}/ai-studio-head-overview.png`, fullPage: true });

await nav(dh, 'Project Management');
await waitText(dh, /AI CRM[\s\S]*AI Website[\s\S]*AIQR/, 'the three starting projects are listed');
await dh.getByRole('button', { name: /Add project/ }).click();
await dh.getByLabel('Project name').fill('AI Chatbot');
await dh.getByLabel('Description (optional)').fill('A chatbot for customers');
await dh.getByRole('button', { name: 'Save project' }).click();
await waitText(dh, /AI Chatbot/, 'the new project appears in the list');
expect((await q(`select count(*)::int n from ai_studio_projects where name = 'AI Chatbot'`))[0].n === 1, 'the new project is stored in the database');
await dh.getByRole('button', { name: /Add project/ }).click();
await dh.getByLabel('Project name').fill(' ai chatbot ');
await dh.getByRole('button', { name: 'Save project' }).click();
await waitText(dh, /already exists/, 'a duplicate project name is refused with a clear message');
await dh.keyboard.press('Escape');

// Team Management > Add or manage employees: the Team Lead form offers the projects from the database and Add Project
await nav(dh, 'Team Management');
await dh.getByRole('tab', { name: 'Add or manage employees' }).click();
await dh.waitForTimeout(600);
await dh.locator('button, [role=tab]').filter({ hasText: /^\s*Add Team Member\s*$/ }).first().click();
await dh.locator('#staff-role').waitFor({ timeout: 15000 }).catch(() => fail('the Add Team Member form opens'));
await dh.locator('#staff-role').selectOption({ label: 'Team Lead' });
const projectSelect = dh.locator('label', { hasText: 'Select Project' }).locator('select');
await projectSelect.waitFor({ timeout: 15000 }).catch(() => fail('the Select Project dropdown appears for an AI Studio Team Lead'));
const options = await projectSelect.locator('option').allInnerTexts();
expect(['AI CRM', 'AI Website', 'AIQR', 'AI Chatbot', 'Add Project'].every(o => options.includes(o)), 'Select Project lists the projects from the database and Add Project', options);
await projectSelect.selectOption({ label: 'Add Project' });
await dh.getByLabel('Project Name *').fill('AI Voice');
await dh.getByLabel('Project Description (optional)').fill('Voice agents');
await dh.getByRole('button', { name: 'Save Project' }).click();
await dh.locator('ul[aria-label="Selected projects"] li', { hasText: 'AI Voice' }).waitFor({ timeout: 15000 }).catch(() => fail('the new project is saved and selected'));
const options2 = await projectSelect.locator('option').allInnerTexts();
expect((await q(`select count(*)::int n from ai_studio_projects where name = 'AI Voice'`))[0].n === 1 && !options2.includes('AI Voice') && (await text(dh)).includes('AI Voice'), 'the saved project is stored and chosen for the new Team Lead');
await dh.screenshot({ path: `${OUT}/ai-studio-add-team-lead.png`, fullPage: true });
await dh.reload();
await dh.waitForSelector('nav button', { state: 'attached' });

// ---------------------------------------------------------------- Team Lead gives a task
const l1 = await login('ai.tl1@amuwa.com');
await waitText(l1, /Good (morning|afternoon|evening)/, 'the Team Lead lands on their overview');
const leadNav = await navLabels(l1);
expect(leadNav.slice(0, 5).join('|') === 'Attendance|Meeting Request|Overview|Projects|Daily Report', 'the Team Lead menu: Attendance, Meeting Request, Overview, Projects, Daily Report', leadNav);
await nav(l1, 'Projects');
await waitText(l1, /AI CRM/, 'the Team Lead sees their projects');
expect(!(await text(l1)).includes('AIQR'), 'and not another lead\'s project');
await l1.getByRole('button', { name: 'Assign task' }).first().click();
await l1.getByLabel('Task title').fill('Build the login screen');
await l1.getByLabel('Description').fill('With validation');
await l1.getByRole('dialog').getByRole('button', { name: 'Assign task' }).click();
await waitText(l1, /Team Tasks/, 'the task was assigned');
await l1.getByRole('tab', { name: /Team Tasks/ }).click();
await waitText(l1, /Build the login screen/, 'the Team Lead sees the task in Team Tasks');
expect((await q(`select count(*)::int n from ai_studio_tasks where title = 'Build the login screen' and assignee_id = $1`, [m1.id]))[0].n === 1, 'the task is stored for the Team Member');

// ---------------------------------------------------------------- Team Member
const mem = await login('ai.m1@amuwa.com');
const memNav = await navLabels(mem);
expect(memNav.slice(0, 5).join('|') === 'Attendance|Meeting Request|Overview|Projects|Daily Report', 'the Team Member menu: Attendance, Meeting Request, Overview, Projects, Daily Report', memNav);
await waitText(mem, /Assigned tasks[\s\S]*Ongoing tasks[\s\S]*Completed tasks[\s\S]*Pending tasks/i, 'the overview shows the task numbers');
await mem.screenshot({ path: `${OUT}/ai-studio-member-overview.png`, fullPage: true });
await nav(mem, 'Projects');
await waitText(mem, /Build the login screen/, 'the Team Member sees the assigned task');
expect(!(await text(mem)).includes('AIQR') && !(await text(mem)).includes('AI Website'), 'and only their own project');
await mem.getByRole('button', { name: 'Build the login screen' }).first().click();
await mem.getByRole('button', { name: 'Update progress' }).click();
await mem.getByLabel(/^Progress/).fill('40');
await mem.getByLabel('Latest update (optional)').fill('Form done');
await mem.getByRole('button', { name: 'Save update' }).click();
await waitText(mem, /In progress · 40%|40%/, 'the progress is saved');
await mem.getByRole('button', { name: 'Close' }).click();
await mem.getByRole('tab', { name: 'Ongoing Tasks' }).click();
await waitText(mem, /Build the login screen/, 'the task is in Ongoing Tasks');
await mem.getByRole('button', { name: 'Build the login screen' }).first().click();
await mem.getByRole('button', { name: 'Update progress' }).click();
await mem.getByLabel('Status').selectOption('COMPLETED');
await mem.getByRole('button', { name: 'Submit completion' }).click();
await waitText(mem, /Describe what was completed/, 'completing without details is refused');
await mem.getByLabel('Completion details').fill('Login screen merged');
await mem.getByRole('button', { name: 'Submit completion' }).click();
await waitText(mem, /Completion details[\s\S]*Login screen merged/, 'the task is completed with its details');
await mem.getByRole('button', { name: 'Close' }).click();
await l1.getByRole('tab', { name: /Team Tasks/ }).click();
await l1.reload(); await l1.waitForSelector('nav button', { state: 'attached' });
await nav(l1, 'Projects'); await l1.getByRole('tab', { name: /Team Tasks/ }).click();
await waitText(l1, /Completed/, 'the Team Lead sees the completed task');

// daily report: Team Member -> Team Lead -> Department Head
await nav(mem, 'Daily Report');
await waitText(mem, /Work Completed Today/, 'the Team Member sees the daily report form');
const fields = await text(mem);
expect(['Report date', 'Project', 'Assigned task', 'Work Completed Today', 'Work In Progress', 'Pending Work', 'Challenges / Blockers', 'Remarks or Additional Updates', 'Submit Daily Report'].every(f => fields.includes(f)), 'the form has every field and the Submit Daily Report button');
await mem.getByLabel('Work Completed Today').fill('Login screen done and merged');
await mem.getByLabel('Work In Progress').fill('API tests');
await mem.getByLabel('Pending Work').fill('Docs');
await mem.getByLabel('Challenges / Blockers').fill('None');
await mem.getByRole('button', { name: 'Submit Daily Report' }).click();
await waitText(mem, /Pending Team Lead Approval/, 'the report waits for the Team Lead');
const l2 = await login('ai.tl2@amuwa.com');
await nav(l2, 'Daily Report'); await l2.getByRole('tab', { name: 'Team Member Reports' }).click();
await l2.waitForTimeout(800);
expect(!(await text(l2)).includes('Mohan Member'), 'another Team Lead does not see the report');
await nav(l1, 'Daily Report'); await l1.getByRole('tab', { name: 'Team Member Reports' }).click();
await waitText(l1, /Mohan Member/, 'the Team Lead sees the report of their member');
await l1.getByRole('button', { name: 'Mohan Member' }).first().click();
await waitText(l1, /Login screen done and merged/, 'the report opens');
await l1.getByLabel(/Remarks/).fill('Good work');
await l1.getByRole('button', { name: /Approve and send to the Department Head/ }).click();
await waitText(l1, /Pending Department Head Approval/, 'the Team Lead approved: it moves to the Department Head');
await l1.screenshot({ path: `${OUT}/ai-studio-lead-review.png`, fullPage: true });
await l1.getByRole('button', { name: 'Close' }).last().click();
await dh.reload(); await dh.waitForSelector('nav button', { state: 'attached' });
await nav(dh, 'Daily Reports');
await waitText(dh, /Mohan Member/, 'the Department Head sees the forwarded report');
await dh.getByRole('button', { name: 'Mohan Member' }).first().click();
await dh.getByLabel(/Remarks/).fill('Approved');
await dh.getByRole('button', { name: /Approve \(final\)/ }).click();
await waitText(dh, /Approved/, 'the Department Head gave the final approval');
await dh.screenshot({ path: `${OUT}/ai-studio-head-review.png`, fullPage: true });
await nav(mem, 'Daily Report'); await mem.getByRole('tab', { name: 'My Reports' }).click();
await waitText(mem, /Approved/, 'the final status is visible to the Team Member');
await mem.getByRole('button', { name: /Open/ }).first().click();
await waitText(mem, /Approval history[\s\S]*Approved by Department Head/, 'with the approval history');
expect((await q(`select count(*)::int n from ai_studio_report_events`))[0].n >= 4, 'the history is stored with who and when');
await mem.screenshot({ path: `${OUT}/ai-studio-member-report-history.png`, fullPage: true });
await mem.getByRole('button', { name: 'Close' }).last().click();

// the shared pages are the CRM's own
await nav(mem, 'Attendance');
await waitText(mem, /Punch|Attendance/, 'the existing Attendance page opens');
await nav(mem, 'Meeting Request');
await waitText(mem, /Meeting/, 'the existing Meetings page opens');
await nav(mem, 'Chat');
await wait(mem, 'main', 'the existing Chat page opens');
await nav(mem, 'Notification Center');
await waitText(mem, /New task|daily report/i, 'the notifications arrived (task, report decisions)');
await mem.getByText(/Your daily report was approved/).first().click();
await waitText(mem, /Approval history/, 'a notification opens the report it is about');
await mem.getByRole('button', { name: 'Close' }).last().click();

// ---------------------------------------------------------------- Super Admin: AI Studio in the Department Hub
const root = await login('root@amuwa.com');
await nav(root, 'Departments');
await root.getByText('AI Studio', { exact: true }).first().click();
await waitText(root, /AI Studio Overview/, 'the Super Admin opens the AI Studio department');
const asideNav = async (p, label) => { current = p; await p.locator('aside button').filter({ hasText: new RegExp(`^\\s*${label}(\\s*\\d+)?\\s*$`) }).first().click(); await p.waitForTimeout(400); };
const saNav = await root.locator('aside button').evaluateAll(els => els.map(e => e.innerText.replace(/\s+\d+$/, '').trim()));
expect(['Overview', 'Projects', 'Tasks', 'Daily Reports', 'Team Members & Access'].every(l => saNav.includes(l)), 'the Super Admin sees the AI Studio pages and Team Members & Access', saNav);
await asideNav(root, 'Daily Reports');
await waitText(root, /Every submitted daily report/, 'the Super Admin monitors the department reports (read only)');
await root.getByRole('tab', { name: 'All' }).click();
await waitText(root, /Mohan Member/, 'including the approved report');
await root.getByRole('button', { name: 'Mohan Member' }).first().click();
await waitText(root, /Approval history/, 'the Super Admin opens it');
expect((await root.getByRole('button', { name: /Approve|Return/ }).count()) === 0, 'and has no approval buttons');
await root.getByRole('button', { name: 'Close' }).last().click();
await asideNav(root, 'Projects');
await waitText(root, /AI Chatbot/, 'the Super Admin sees every project, including the one the Head added');
await asideNav(root, 'Team Members & Access');
await root.waitForTimeout(800);
await root.screenshot({ path: `${OUT}/ai-studio-superadmin.png`, fullPage: true });

// a phone-sized window
const phone = await login('ai.m1@amuwa.com', { width: 390, height: 800 });
await phone.waitForTimeout(800);
expect(await noSideScroll(phone), 'a phone-sized Team Member dashboard does not scroll sideways');
await phone.screenshot({ path: `${OUT}/ai-studio-phone.png`, fullPage: true });
const phoneHead = await login('ai.head@amuwa.com', { width: 390, height: 800 });
await phoneHead.waitForTimeout(800);
expect(await noSideScroll(phoneHead), 'and so does the Department Head\'s');

const tablet = await login('ai.tl1@amuwa.com', { width: 820, height: 1100 });
await tablet.waitForTimeout(800);
expect(await noSideScroll(tablet), 'a tablet-sized Team Lead dashboard does not scroll sideways');
await tablet.getByLabel('Toggle menu').first().click();
await nav(tablet, 'Daily Report');
await tablet.waitForTimeout(500);
expect(await noSideScroll(tablet), 'nor its Daily Report page');
await tablet.screenshot({ path: `${OUT}/ai-studio-tablet.png`, fullPage: true });

expect(errors.length === 0, 'no page error or console error in any window', errors.slice(0, 5));
console.log(`=== AI STUDIO E2E PASSED (${step}) ===`);
await browser.close();
await db.end();
