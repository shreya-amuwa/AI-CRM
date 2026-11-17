// AI Studio in real browsers. The Super Admin IS the Department Head of AI Studio (no Department Head account exists):
//   the Super Admin dashboard keeps every entry it had and gains one, AI Studio, which opens AI Studio's own workspace
//   Super Admin adds a project, a Team Lead (Select Project with Add Project) and a Team Member (reporting Team Lead, project) from the workspace
//   Team Lead gives a task -> Team Member updates progress and completes it
//   Team Member submits the daily report -> Team Lead approves -> Super Admin approves (final) -> Approved, history visible to the Team Member
//   Another Team Lead sees nothing of it; attendance, meeting requests and chat open; phone and tablet widths do not scroll sideways.
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
const byName = Object.fromEntries((await api(sa.id, 'GET', '/ai-studio/projects')).map(p => [p.name, p.id]));
// two Team Leads and two Team Members, made by the Super Admin through the existing employee flow
const tl1 = await api(sa.id, 'POST', '/users', { email: 'ai.tl1@amuwa.com', fullName: 'Lata Lead', password: mkpw('ai.tl1@amuwa.com'), role: 'TEAM_HEAD', teamId: team.id, aiStudioProjectIds: [byName['AI CRM'], byName['AI Website']] });
const tl2 = await api(sa.id, 'POST', '/users', { email: 'ai.tl2@amuwa.com', fullName: 'Leela Lead', password: mkpw('ai.tl2@amuwa.com'), role: 'TEAM_HEAD', teamId: team.id, aiStudioProjectIds: [byName['AIQR']] });
const m1 = await api(tl1.id, 'POST', '/users', { email: 'ai.m1@amuwa.com', fullName: 'Mohan Member', password: mkpw('ai.m1@amuwa.com'), role: 'TEAM_MEMBER', teamId: team.id, aiStudioProjectIds: [byName['AI CRM']] });
const m2 = await api(tl2.id, 'POST', '/users', { email: 'ai.m2@amuwa.com', fullName: 'Meena Member', password: mkpw('ai.m2@amuwa.com'), role: 'TEAM_MEMBER', teamId: team.id, aiStudioProjectIds: [byName['AIQR']] });
// a Sales Team Lead and a Support Team Lead (both "Team Lead", in an existing department), to show their dashboards are not touched
const wab = (await api(sa.id, 'GET', '/departments')).find(d => d.slug === 'wabastore');
const wabTeams = await api(sa.id, 'GET', `/teams?departmentId=${wab.id}`);
await api(sa.id, 'POST', '/users', { email: 'sales.tl@amuwa.com', fullName: 'Sana Sales', password: mkpw('sales.tl@amuwa.com'), role: 'TEAM_HEAD', teamId: wabTeams.find(t => t.name === 'Sales').id });
await api(sa.id, 'POST', '/users', { email: 'support.tl@amuwa.com', fullName: 'Suri Support', password: mkpw('support.tl@amuwa.com'), role: 'TEAM_HEAD', teamId: wabTeams.find(t => t.name === 'Support').id });
// a Team Member made by the Super Admin before any Team Lead was chosen: a project, no Team Lead
const m4 = await api(sa.id, 'POST', '/users', { email: 'ai.m4@amuwa.com', fullName: 'Nikita NoLead', password: mkpw('ai.m4@amuwa.com'), role: 'TEAM_MEMBER', teamId: team.id, aiStudioProjectIds: [byName['AI CRM']] });

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

// ---------------------------------------------------------------- Super Admin: the existing dashboard, plus one entry
const root = await login('root@amuwa.com');
await waitText(root, /Good (morning|afternoon|evening), Root/, 'the Super Admin signs in exactly as before and lands on the same overview');
const EXISTING = ['Overview', 'Departments', 'Team Members', 'Department Income', 'Top Performers & Rankings', 'Reports & Performance', 'Business Reports', 'Security & Audit Logs', 'Lead Welcome WhatsApp', 'Chat', 'Notification Center'];
const saNav = await navLabels(root);
expect(EXISTING.every(l => saNav.includes(l)), 'every existing Super Admin entry is still there, with its name', saNav);
expect(saNav.filter(l => !EXISTING.includes(l) && !['Attendance', 'Meetings'].includes(l)).join('|') === 'AI Studio', 'and the only addition is AI Studio', saNav);
await root.screenshot({ path: `${OUT}/ai-studio-superadmin-dashboard.png`, fullPage: true });
await nav(root, 'AI Studio');
await waitText(root, /AI Studio Overview/, 'AI Studio opens its own management workspace');
const wsNav = await navLabels(root);
expect(['Attendance', 'Meeting Requests', 'Overview', 'Projects', 'Team Leads', 'Team Members', 'Tasks', 'Daily Reports', 'Chat', 'Notification Center'].every(l => wsNav.includes(l)), 'the workspace menu: Overview, Projects, Team Leads, Team Members, Tasks, Daily Reports, Attendance, Meeting Requests, Chat, Notifications', wsNav);
expect(!wsNav.includes('Departments') && !wsNav.includes('Security & Audit Logs'), 'it is a workspace of its own, not the Super Admin menu', wsNav);
expect(await root.getByRole('button', { name: /Back to Super Admin/ }).count() === 1, 'with a way back to the Super Admin dashboard');
const overview = await text(root);
expect(/AI Studio employees/.test(overview) && /Project-wise progress/.test(overview), 'the overview shows the department counts and project-wise progress');
expect((await q(`select count(*)::int n from profiles where department_id = $1 and status = 'ACTIVE'`, [ai.id]))[0].n === 5, 'five people in AI Studio (two Team Leads, three Team Members) and no Department Head');
await root.screenshot({ path: `${OUT}/ai-studio-workspace-overview.png`, fullPage: true });

// projects
await nav(root, 'Projects');
await waitText(root, /AI CRM[\s\S]*AI Website[\s\S]*AIQR/, 'the three starting projects are listed');
await root.getByRole('button', { name: /Add project/ }).click();
await root.getByLabel('Project name').fill('AI Chatbot');
await root.getByLabel('Description (optional)').fill('A chatbot for customers');
await root.getByRole('button', { name: 'Save project' }).click();
await waitText(root, /AI Chatbot/, 'the new project appears in the list');
expect((await q(`select count(*)::int n from ai_studio_projects where name = 'AI Chatbot'`))[0].n === 1, 'the new project is stored in the database');
await root.getByRole('button', { name: /Add project/ }).click();
await root.getByLabel('Project name').fill(' ai chatbot ');
await root.getByRole('button', { name: 'Save project' }).click();
await waitText(root, /already exists/, 'a duplicate project name is refused with a clear message');
await root.keyboard.press('Escape');

// Team Leads: the CRM's employee form, with the department and role fixed and Select Project
await nav(root, 'Team Leads');
await waitText(root, /Lata Lead[\s\S]*Leela Lead/, 'the Team Leads are listed with their projects');
await root.getByRole('button', { name: /Add Team Lead/ }).first().click();
await root.locator('#staff-role').waitFor({ timeout: 15000 }).catch(() => fail('the Add Team Lead form opens'));
expect((await root.locator('#staff-role').inputValue()) === 'Team Lead' && (await root.locator('#staff-role').getAttribute('readonly')) !== null, 'the role is fixed to Team Lead');
expect((await text(root)).includes('AI Studio'), 'and the department is AI Studio');
const projectSelect = root.locator('label', { hasText: 'Select Project' }).locator('select');
await projectSelect.waitFor({ timeout: 15000 }).catch(() => fail('the Select Project dropdown appears'));
await projectSelect.locator('option', { hasText: 'AI CRM' }).waitFor({ state: 'attached', timeout: 15000 }).catch(() => undefined);
const options = await projectSelect.locator('option').allInnerTexts();
expect(['AI CRM', 'AI Website', 'AIQR', 'AI Chatbot', 'Add Project'].every(o => options.includes(o)), 'Select Project lists the projects from the database and Add Project', options);
await projectSelect.selectOption({ label: 'Add Project' });
await root.getByLabel('Project Name *').fill('AI Voice');
await root.getByLabel('Project Description (optional)').fill('Voice agents');
await root.getByRole('button', { name: 'Save Project' }).click();
await root.locator('ul[aria-label="Selected projects"] li', { hasText: 'AI Voice' }).waitFor({ timeout: 15000 }).catch(() => fail('the new project is saved and selected'));
expect((await q(`select count(*)::int n from ai_studio_projects where name = 'AI Voice'`))[0].n === 1, 'the new project is stored and chosen for the new Team Lead');
await root.getByLabel(/Username/).fill('Tara Techlead');
await root.getByLabel(/Email \(used to sign in\)/).fill('ai.tl3@amuwa.com');
await root.getByLabel(/Joining date/).fill('2026-01-05');
await root.getByLabel(/Date of birth/).fill('1990-03-04');
await root.getByLabel(/Blood group/).selectOption({ index: 1 });
await root.getByLabel(/Team member contact number/).fill('+91 98765 43210');
await root.getByLabel(/Emergency contact number/).fill('+91 98765 43211');
await root.screenshot({ path: `${OUT}/ai-studio-add-team-lead.png`, fullPage: true });
await root.getByRole('button', { name: 'Create Account' }).click();
await waitText(root, /Tara Techlead|created|Account created/i, 'the Team Lead account is created');
const tl3 = (await q(`select p.id, p.role, p.status, p.default_dashboard, d.slug, (select count(*)::int from ai_studio_project_members m join ai_studio_projects pr on pr.id = m.project_id where m.profile_id = p.id and pr.name = 'AI Voice') voice from profiles p join departments d on d.id = p.department_id where p.email = 'ai.tl3@amuwa.com'`))[0];
expect(tl3 && tl3.role === 'TEAM_HEAD' && tl3.slug === 'ai-studio' && tl3.default_dashboard === 'ai-studio-lead' && tl3.voice === 1 && tl3.status === 'ACTIVE', 'the Team Lead is in AI Studio with the AI Studio Team Lead role, on the chosen project', tl3);

// Team Members: the Team Lead is optional; a project is chosen on its own
await nav(root, 'Team Members');
await waitText(root, /Meena Member[\s\S]*Mohan Member/, 'the Team Members are listed');
await waitText(root, /Nikita NoLead[\s\S]*Not Assigned/, 'a Team Member with no Team Lead shows as Not Assigned');
await root.getByRole('button', { name: /Add Team Member/ }).first().click();
await root.locator('#staff-role').waitFor({ timeout: 15000 }).catch(() => fail('the Add Team Member form opens'));
expect((await root.locator('#staff-role').inputValue()) === 'Team Member', 'the role is fixed to Team Member');
const leadSelect = root.locator('label', { hasText: 'Reporting Team Lead (optional)' }).locator('select');
await leadSelect.waitFor({ timeout: 15000 }).catch(() => fail('the optional reporting Team Lead dropdown appears'));
await leadSelect.locator('option', { hasText: 'Lata Lead' }).waitFor({ state: 'attached', timeout: 15000 }).catch(() => undefined);
const leadOptions = await leadSelect.locator('option').allInnerTexts();
expect(leadOptions[0] === 'No Team Lead yet' && leadOptions.slice(1).sort().join('|') === 'Lata Lead|Leela Lead|Tara Techlead', 'the dropdown is optional and lists only the active AI Studio Team Leads', leadOptions);
const memberProjects = root.locator('label', { hasText: 'Select Project' }).locator('select');
await memberProjects.locator('option', { hasText: 'AI CRM' }).waitFor({ state: 'attached', timeout: 15000 }).catch(() => undefined);
const mpOptions = await memberProjects.locator('option').allInnerTexts();
expect(['AI CRM', 'AI Website', 'AIQR', 'AI Chatbot', 'AI Voice'].every(o => mpOptions.includes(o)), 'every project is offered whether or not a Team Lead is chosen', mpOptions);
await memberProjects.selectOption({ label: 'AI Website' });
await root.getByLabel(/Username/).fill('Nikhil New');
await root.getByLabel(/Email \(used to sign in\)/).fill('ai.m3@amuwa.com');
await root.getByLabel(/Joining date/).fill('2026-01-06');
await root.getByLabel(/Date of birth/).fill('1995-05-06');
await root.getByLabel(/Blood group/).selectOption({ index: 1 });
await root.getByLabel(/Team member contact number/).fill('+91 98765 43212');
await root.getByLabel(/Emergency contact number/).fill('+91 98765 43213');
await root.getByRole('button', { name: 'Create Account' }).click();
await waitText(root, /Nikhil New|created|Account created/i, 'the Team Member is created without choosing a Team Lead');
const m3 = (await q(`select p.id, p.default_dashboard, p.manager_id, (select count(*)::int from ai_studio_project_members m join ai_studio_projects pr on pr.id = m.project_id where m.profile_id = p.id and pr.name = 'AI Website') web from profiles p where p.email = 'ai.m3@amuwa.com'`))[0];
expect(m3 && m3.default_dashboard === 'ai-studio-member' && m3.manager_id === null && m3.web === 1, 'they have the project, no Team Lead, and open the Team Member dashboard', m3);
await root.screenshot({ path: `${OUT}/ai-studio-add-team-member.png`, fullPage: true });

// the Team Member with no Team Lead logs in, sees their project and sends a report straight to the Super Admin
const noLead = await login('ai.m4@amuwa.com');
await nav(noLead, 'Projects');
await waitText(noLead, /AI CRM/, 'a Team Member with no Team Lead logs in and sees their project');
await nav(noLead, 'Daily Report');
await waitText(noLead, /no Team Lead assigned yet[\s\S]*straight to Root/, 'the report form says it goes straight to the Super Admin');
await noLead.getByLabel('Work Completed Today').fill('Set up the repository');
await noLead.getByRole('button', { name: 'Submit Daily Report' }).click();
await waitText(noLead, /Pending Department Head Approval/, 'the report is pending the Super Admin');
expect((await q(`select status, lead_id from ai_studio_daily_reports where author_id = $1`, [m4.id]))[0].status === 'PENDING_DH_APPROVAL', 'without a Team Lead the report reaches the Super Admin directly');
await root.reload(); await root.waitForSelector('nav button', { state: 'attached' });
await nav(root, 'AI Studio');
await nav(root, 'Daily Reports');
await waitText(root, /Nikita NoLead/, 'it is in the Super Admin\'s Daily Reports');

// Assign Team Lead: filter, select several, assign
await nav(root, 'Team Members');
await root.getByRole('tab', { name: /Not Assigned to Team Lead/ }).click();
await waitText(root, /Nikhil New/, 'the Not Assigned filter lists the Team Members without a Team Lead');
expect(!(await text(root)).includes('Mohan Member') && !(await text(root)).includes('Meena Member'), 'and none of the assigned ones');
await root.getByLabel('Select all listed Team Members').check();
await root.getByRole('button', { name: /Assign Team Lead \(2\)/ }).click();
await root.locator('#ai-al-lead').selectOption({ label: 'Lata Lead' });
await root.screenshot({ path: `${OUT}/ai-studio-assign-team-lead.png`, fullPage: true });
await root.getByRole('dialog').getByRole('button', { name: 'Assign Team Lead' }).click();
await waitText(root, /2 Team Members assigned to Lata Lead/, 'both Team Members are assigned to the Team Lead at once');
const assigned = await q(`select email, manager_id from profiles where email in ('ai.m3@amuwa.com', 'ai.m4@amuwa.com')`);
expect(assigned.length === 2 && assigned.every(r => r.manager_id === tl1.id), 'the assignment is stored for both');
await root.getByRole('tab', { name: /^Assigned to Team Lead/ }).click();
await waitText(root, /Nikhil New[\s\S]*Assigned[\s\S]*Lata Lead/, 'they now show as Assigned to Lata Lead');
expect((await q(`select status from ai_studio_daily_reports where author_id = $1`, [m4.id]))[0].status === 'PENDING_DH_APPROVAL', 'the report already sent keeps its route');

// ---------------------------------------------------------------- Team Lead gives a task
const l1 = await login('ai.tl1@amuwa.com');
await waitText(l1, /Good (morning|afternoon|evening)/, 'the Team Lead lands on their own overview');
const leadNav = await navLabels(l1);
expect(leadNav.slice(0, 5).join('|') === 'Attendance|Meeting Request|Overview|Projects|Daily Report', 'the Team Lead menu: Attendance, Meeting Request, Overview, Projects, Daily Report', leadNav);
const SALES_ONLY = ['My Leads', 'Team Customers', 'Field Visits', 'Performance Management', 'Team Members & Access', 'Reports', 'Assigned Tasks', 'Customers', 'Tickets'];
expect(!leadNav.some(l => SALES_ONLY.includes(l)), 'the AI Studio Team Lead gets none of the Sales / Support entries (My Leads, Team Customers, Field Visits, Performance Management ...)', leadNav);
await nav(l1, 'Projects');
await waitText(l1, /AI CRM/, 'the Team Lead sees their projects');
expect(!(await text(l1)).includes('AIQR'), 'and not another lead\'s project');
await l1.getByRole('button', { name: 'Assign task' }).first().click();
await l1.getByLabel('Task title').fill('Build the login screen');
await l1.getByLabel('Description').fill('With validation');
await l1.getByLabel(/^Team Member/).selectOption({ label: 'Mohan Member' }).catch(() => undefined);
await l1.getByRole('dialog').getByRole('button', { name: 'Assign task' }).click();
await waitText(l1, /Team Tasks/, 'the task was assigned');
await l1.getByRole('tab', { name: /Team Tasks/ }).click();
await waitText(l1, /Build the login screen/, 'the Team Lead sees the task in Team Tasks');
expect((await q(`select count(*)::int n from ai_studio_tasks where title = 'Build the login screen' and assignee_id = $1`, [m1.id]))[0].n === 1, 'the task is stored for the Team Member');

// the Team Lead sees the members assigned later, and the next report of one of them goes through the Team Lead
await l1.reload(); await l1.waitForSelector('nav button', { state: 'attached' });
const leadTeam = await api(tl1.id, 'GET', '/ai-studio/people');
expect(['ai.m3@amuwa.com', 'ai.m4@amuwa.com'].every(e => leadTeam.some(p => p.email === e)), 'the Team Lead\'s team now includes the members assigned later', leadTeam.map(p => p.email));
await noLead.reload(); await noLead.waitForSelector('nav button', { state: 'attached' });
await nav(noLead, 'Daily Report');
await waitText(noLead, /goes to Lata Lead for approval/, 'the form now says reports go to the Team Lead first');
await noLead.getByLabel('Report date').fill(new Date(Date.now() - 86400000).toISOString().slice(0, 10));
await noLead.getByLabel('Work Completed Today').fill('Added the CI pipeline');
await noLead.getByRole('button', { name: 'Submit Daily Report' }).click();
await waitText(noLead, /Pending Team Lead Approval/, 'a new report follows Team Member -> Team Lead');
await nav(l1, 'Daily Report');
expect((await l1.locator('[role=tablist][aria-label="Daily report views"] [role=tab]').allInnerTexts()).map(t => t.trim()).join('|') === 'My Daily Reports|Team Member Reports', 'the Team Lead\'s Daily Report has two views: My Daily Reports and Team Member Reports');
await l1.getByRole('tab', { name: 'Team Member Reports' }).click();
await waitText(l1, /Nikita NoLead/, 'the Team Lead sees it in Team Member Reports');

// ---------------------------------------------------------------- Team Member
const mem = await login('ai.m1@amuwa.com');
const memNav = await navLabels(mem);
expect(memNav.slice(0, 5).join('|') === 'Attendance|Meeting Request|Overview|Projects|Daily Report', 'the Team Member menu: Attendance, Meeting Request, Overview, Projects, Daily Report', memNav);
expect(JSON.stringify(memNav) === JSON.stringify(leadNav), 'the AI Studio Team Lead and Team Member have exactly the same sidebar', { leadNav, memNav });
expect(!memNav.some(l => SALES_ONLY.includes(l)), 'and neither has Sales-specific entries');
expect(!memNav.includes('Team Member Reports'), 'Team Member Reports is not a sidebar entry: it is a tab inside Daily Report');
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

// daily report: Team Member -> Team Lead -> Super Admin
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
await l1.reload(); await l1.waitForSelector('nav button', { state: 'attached' });
await nav(l1, 'Daily Report'); await l1.getByRole('tab', { name: 'Team Member Reports' }).click();
await waitText(l1, /Mohan Member/, 'the Team Lead sees the report of their member');
await l1.getByRole('button', { name: 'Mohan Member' }).first().click();
await waitText(l1, /Login screen done and merged/, 'the report opens');
await l1.getByLabel(/Remarks/).fill('Good work');
await l1.getByRole('button', { name: /Approve and send to the Department Head/ }).click();
await waitText(l1, /Pending Department Head Approval/, 'the Team Lead approved: it moves on for the final approval');
await l1.screenshot({ path: `${OUT}/ai-studio-lead-review.png`, fullPage: true });
await l1.getByRole('button', { name: 'Close' }).last().click();

// the Super Admin gives the final approval in the AI Studio workspace
await root.reload(); await root.waitForSelector('nav button', { state: 'attached' });
await nav(root, 'AI Studio');
await waitText(root, /AI Studio Overview/, 'the Super Admin opens AI Studio again');
await nav(root, 'Daily Reports');
await waitText(root, /Mohan Member/, 'the report approved by the Team Lead is in the Super Admin\'s AI Studio workspace');
await root.getByRole('button', { name: 'Mohan Member' }).first().click();
await waitText(root, /Login screen done and merged/, 'the Super Admin opens the report');
await root.getByLabel(/Remarks/).fill('Approved');
await root.getByRole('button', { name: /Approve \(final\)/ }).click();
await waitText(root, /Approved by Department Head/, 'the Super Admin gave the final approval');
expect((await q(`select status from ai_studio_daily_reports where author_id = $1`, [m1.id]))[0].status === 'APPROVED', 'the report is Approved in the database: no further stage');
await root.screenshot({ path: `${OUT}/ai-studio-superadmin-review.png`, fullPage: true });
await root.getByRole('button', { name: 'Close' }).last().click();
await nav(mem, 'Daily Report'); await mem.getByRole('tab', { name: 'My Reports' }).click();
await waitText(mem, /Approved/, 'the final status is visible to the Team Member');
await mem.getByRole('button', { name: /Open/ }).first().click();
await waitText(mem, /Approval history[\s\S]*Approved by Department Head/, 'with the approval history');
expect((await q(`select count(*)::int n from ai_studio_report_events`))[0].n >= 4, 'the history is stored with who and when');
await mem.screenshot({ path: `${OUT}/ai-studio-member-report-history.png`, fullPage: true });
await mem.getByRole('button', { name: 'Close' }).last().click();
await nav(l1, 'Daily Report'); await l1.getByRole('tab', { name: 'Team Member Reports' }).click();
await waitText(l1, /Approved/, 'and to the Team Lead');

// the shared pages are the CRM's own
await nav(mem, 'Attendance');
await waitText(mem, /Punch|Attendance/, 'the existing Attendance page opens for the Team Member');
await nav(mem, 'Meeting Request');
await waitText(mem, /Meeting/, 'the existing Meetings page opens');
await nav(mem, 'Chat');
await wait(mem, 'main', 'the existing Chat page opens');
await nav(mem, 'Notification Center');
await waitText(mem, /New task|daily report/i, 'the notifications arrived (task, report decisions)');
await mem.getByText(/Your daily report was approved/).first().click();
await waitText(mem, /Approval history/, 'a notification opens the report it is about');
await mem.getByRole('button', { name: 'Close' }).last().click();

// the Super Admin's workspace: attendance of AI Studio, meeting requests, chat, notifications; then back
await nav(root, 'Attendance');
await waitText(root, /Attendance register/, 'the Super Admin sees the attendance register');
expect(/AI Studio/.test(await root.locator('select').evaluateAll(els => els.map(e => e.options[e.selectedIndex]?.text).join('|'))), 'narrowed to AI Studio', await text(root));
await nav(root, 'Meeting Requests');
await waitText(root, /Meeting/, 'Meeting Requests opens');
await nav(root, 'Chat');
await wait(root, 'main', 'Chat opens');
await nav(root, 'Notification Center');
await waitText(root, /Notification Center/, 'Notifications open');
await root.getByRole('button', { name: /Back to Super Admin/ }).click();
await waitText(root, /Good (morning|afternoon|evening), Root/, 'Back to Super Admin returns to the unchanged Super Admin dashboard');
// the hub card opens the same workspace
await nav(root, 'Departments');
await root.locator('div.cursor-pointer').filter({ hasText: 'AI Studio' }).getByRole('button', { name: /Enter Panel/ }).first().click();
await waitText(root, /AI Studio Overview/, 'the AI Studio department card opens the same workspace');
await root.getByRole('button', { name: /Back to Super Admin/ }).click();

// Sales and Support Team Leads keep their own dashboards
const salesTl = await login('sales.tl@amuwa.com');
await waitText(salesTl, /Overview/, 'a Sales Team Lead signs in');
const salesNav = await navLabels(salesTl);
expect(['My Leads', 'Team Customers', 'Assigned Tasks', 'Performance Management', 'Field Visits', 'Team Members & Access'].every(l => salesNav.includes(l)) && !salesNav.includes('Projects') && !salesNav.includes('Daily Report'), 'the Sales Team Lead keeps the original Sales sidebar', salesNav);
const supportTl = await login('support.tl@amuwa.com');
await waitText(supportTl, /Dashboard/, 'a Support Team Lead signs in');
const supportNav = await navLabels(supportTl);
expect(['Customers', 'Tickets', 'Client Hand-overs', 'Assigned Tasks', 'Team Members & Access'].every(l => supportNav.includes(l)) && !supportNav.includes('Projects') && !supportNav.includes('Daily Report'), 'the Support Team Lead keeps the original Support sidebar', supportNav);
expect(JSON.stringify(salesNav) !== JSON.stringify(leadNav) && JSON.stringify(supportNav) !== JSON.stringify(leadNav), 'three different dashboards for three Team Leads');
expect(/\/team-lead\/dashboard\//.test(salesTl.url()) && /\/support-lead\/dashboard\//.test(supportTl.url()) && /\/ai-studio\/dashboard\//.test(l1.url()), 'each is at their own address');

// the same sidebar on a phone: open the menu, then read it
const phoneNav = async email => { const p = await login(email, { width: 390, height: 800 }); await p.getByLabel('Toggle menu').first().click(); await p.waitForTimeout(400); return navLabels(p); };
const phoneLead = await phoneNav('ai.tl1@amuwa.com');
const phoneMember = await phoneNav('ai.m1@amuwa.com');
expect(JSON.stringify(phoneLead) === JSON.stringify(phoneMember) && JSON.stringify(phoneLead) === JSON.stringify(leadNav), 'on a phone the AI Studio Team Lead and Team Member have the same sidebar, equal to the desktop one', { phoneLead, phoneMember });

// phone and tablet widths
const phone = await login('ai.m1@amuwa.com', { width: 390, height: 800 });
await phone.waitForTimeout(800);
expect(await noSideScroll(phone), 'a phone-sized Team Member dashboard does not scroll sideways');
await phone.screenshot({ path: `${OUT}/ai-studio-phone.png`, fullPage: true });
const phoneSa = await login('root@amuwa.com', { width: 390, height: 800 });
await phoneSa.getByLabel('Toggle menu').first().click();
await nav(phoneSa, 'AI Studio');
await phoneSa.waitForTimeout(800);
expect(await noSideScroll(phoneSa), 'and so does the AI Studio workspace');
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
