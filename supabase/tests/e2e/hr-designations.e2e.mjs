// The Super Admin's Add Team Member form: the Role dropdown follows the department chosen at the top of the window. HR shows exactly HR Assistant,
// HR Recruiter and HR Admin Head (no generic role); Sales / other departments keep their own roles; switching departments clears a role that does not
// belong to the new one. Each HR designation is then created through the form, checked in the database and signed in to see the dashboard it opens.
// The API refuses a wrong department / designation pair whatever the browser sends. Real browser against the local stack; passwords are made up per run.
// See supabase/tests/e2e/README.md for how to run it (run-hr-designations.sh).
import { chromium } from 'playwright-core';
import crypto from 'node:crypto';
import pg from 'pg';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const GATEWAY = process.env.E2E_GATEWAY || 'http://localhost:54400';
const OUT = process.argv[2] || '.';
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const PASSWORDS = JSON.parse(process.env.E2E_PASSWORDS || '{}');
const secret = () => `${crypto.randomBytes(9).toString('base64url')}-Aa1`;
const sign = p => { const e = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p }); return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`; };
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const idOf = async e => (await q('select id from public.profiles where email=$1', [e]))[0]?.id;
const call = async (who, method, path, body) => { const r = await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${sign({ sub: who, role: 'authenticated' })}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); const j = await r.json(); return { status: r.status, ...j }; };

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
let step = 0;
const ok = m => console.log(`ok ${++step} - ${m}`);
const errors = [];
let current;
const fail = async m => {
  await current?.screenshot({ path: `${OUT}/hr-designations-fail.png`, fullPage: true }).catch(() => {});
  console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(-5)) : '');
  await browser.close();
  process.exit(1);
};
const expect = async (c, m, extra) => (c ? ok(m) : fail(m + (extra === undefined ? '' : ' ' + JSON.stringify(extra))));
const until = async (fn, ms = 20000) => { for (const t = Date.now(); Date.now() - t < ms;) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 250)); } return null; };
process.on('unhandledRejection', e => fail(`an unexpected error: ${String(e?.message ?? e).split('\n').slice(0, 4).join(' | ')}`));
const signIn = async (email, password) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.ctx = ctx;
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(password);
  await p.locator('form button[type="submit"]').click();
  return p;
};
const tag = crypto.randomBytes(3).toString('hex');

// ------------------------------------------------------------------ fixture
const sa = await idOf('root@amuwa.com');
const dept = async slug => (await q('select id, name from departments where slug = $1', [slug]))[0];
const HR = await dept('hr'), WAB = await dept('wabastore'), ACC = await dept('accounts');
const hrTeam = (await q('select id from teams where department_id = $1 order by created_at limit 1', [HR.id]))[0]?.id;
await expect(!!hrTeam, 'fixture: the HR department has a team');

// ------------------------------------------------------------------ 1. the dropdown follows the department
const sup = await signIn('root@amuwa.com', PASSWORDS['root@amuwa.com']);
await sup.waitForSelector('button:has-text("Add Team Member")', { timeout: 25000 }).catch(() => fail('the Super Admin did not reach the dashboard'));
await sup.getByRole('button', { name: 'Add Team Member' }).first().click();
await sup.locator('#add-staff-department').waitFor({ timeout: 15000 }).catch(() => fail('the department chooser of Add Team Member did not open'));
const roleOptions = async () => (await sup.locator('#staff-role option').allInnerTexts()).map(t => t.trim());
const roleValue = () => sup.locator('#staff-role').inputValue();
const pickDept = async slug => {
  await sup.locator('#add-staff-department').selectOption(slug);
  await sup.waitForFunction(s => document.querySelector('#add-staff-department')?.value === s && !!document.querySelector('#staff-role'), slug);
};

await pickDept('hr');
let opts = await roleOptions();
await expect(JSON.stringify(opts) === JSON.stringify(['HR Assistant', 'HR Recruiter', 'HR Admin Head']), 'HR Department: the Role dropdown shows exactly HR Assistant, HR Recruiter, HR Admin Head', opts);
await expect(!opts.some(o => /^(Team Member|Team Lead|Department Head|Operations Head)$/.test(o)), 'HR Department: no Team Member / Team Lead / Department Head / Operations Head');
const createLine = await sup.locator('text=you can create:').first().innerText();
await expect(/HR Assistant, HR Recruiter, HR Admin Head/.test(createLine) && !/Team Lead|Operations Head/.test(createLine), 'HR Department: the form header lists the HR designations only', createLine);
await sup.waitForTimeout(600); // let the form fade in before the screenshot
await sup.screenshot({ path: `${OUT}/hr-designations-1-hr.png`, fullPage: true });

await pickDept('wabastore');
opts = await roleOptions();
await expect(opts.includes('Team Member') && opts.includes('Team Lead') && opts.includes('Department Head') && !opts.some(o => o.startsWith('HR ')), 'Wabastore: its own roles, and no HR designation', opts);
await sup.locator('#staff-role').selectOption('TEAM_MEMBER');
const salesTeam = (await q(`select id from teams where department_id = $1 and division = 'SALES' order by created_at limit 1`, [WAB.id]))[0].id;
await sup.locator('select:has(option:text("Select team…"))').selectOption(salesTeam);
const salesOpts = (await sup.locator('#staff-sales-role option').allInnerTexts()).map(t => t.trim());
await expect(['Telecaller', 'Business Associate'].every(s => salesOpts.some(o => o.includes(s))), 'Sales team: the existing Sales roles are offered (Telecaller, Business Associate, ...)', salesOpts);
await sup.screenshot({ path: `${OUT}/hr-designations-2-sales.png`, fullPage: true });

// a choice made in HR does not survive a department change, and a choice made elsewhere does not come back into HR
await pickDept('hr');
await sup.locator('#staff-role').selectOption('HR Recruiter');
await pickDept('accounts');
opts = await roleOptions();
await expect(!opts.some(o => o.startsWith('HR ')) && ['TEAM_MEMBER', 'TEAM_HEAD', 'DEPARTMENT_HEAD'].includes(await roleValue()), 'HR -> Accounts: the dropdown changes at once and HR Recruiter is cleared', { opts, value: await roleValue() });
const designationOpts = (await sup.locator('select:has(option:text-is("Team Lead")):not(#staff-role)').first().locator('option').allInnerTexts()).map(t => t.trim());
await expect(!designationOpts.some(o => o.startsWith('HR ')), 'Accounts: the Designation list has no HR designation', designationOpts);
await sup.locator('#staff-role').selectOption('TEAM_HEAD');
await pickDept('hr');
await expect((await roleValue()) === 'HR Assistant', 'Accounts (Team Lead) -> HR: the Team Lead choice is cleared and HR starts at HR Assistant', await roleValue());

// ------------------------------------------------------------------ 2. create one employee per HR designation through the form
const create = async (designation, name, email) => {
  await pickDept('hr');
  await sup.locator('#staff-role').selectOption(designation);
  await sup.getByPlaceholder('e.g. Kunal Sharma').fill(name);
  await sup.getByPlaceholder('kunal@amuwa.com').fill(email);
  const teamSel = sup.locator('select:has(option:text("Select team…"))');
  if (await teamSel.count()) await teamSel.selectOption(hrTeam);
  await sup.locator('input[type="date"]').first().fill('2025-01-10');
  await sup.locator('input[type="date"]').nth(1).fill('1990-05-05');
  await sup.locator('select').filter({ has: sup.locator('option', { hasText: 'A+' }) }).first().selectOption('A+');
  await sup.getByTestId('member-contact-number').fill('+91 98111 22222');
  await sup.getByPlaceholder('+91 98765 43210').fill('+91 98765 43210');
  const willOpen = await sup.locator('text=Will open:').first().innerText();
  await sup.getByRole('button', { name: /Create|Add team member|Add member/i }).last().click();
  const row = await until(async () => (await q(
    `select p.id, p.role, p.hr_sub_role, p.is_operations_head, d.slug, e.designation
       from profiles p join departments d on d.id = p.department_id left join employee_personal_details e on e.profile_id = p.id
      where p.email = $1`, [email]))[0]);
  if (!row) await fail(`${designation} was not created (the form said: ${(await sup.locator('[role="alert"]').allInnerTexts()).join(' | ')})`);
  await sup.waitForSelector('text=Team Member Added Successfully', { timeout: 15000 }).catch(() => undefined);
  return { row, willOpen };
};

const ASSIST = `hr.assistant.${tag}@amuwa.com`, RECRUIT = `hr.recruiter.${tag}@amuwa.com`, HEAD = `hr.head.${tag}@amuwa.com`;
const a = await create('HR Assistant', 'Asha Assistant', ASSIST);
await expect(a.row.slug === 'hr' && a.row.role === 'TEAM_MEMBER' && a.row.designation === 'HR Assistant' && a.row.hr_sub_role === 'HR_ASSISTANT', 'HR Assistant saved: HR department, Team Member, designation HR Assistant', a.row);
const r = await create('HR Recruiter', 'Ravi Recruiter', RECRUIT);
await expect(r.row.slug === 'hr' && r.row.role === 'TEAM_MEMBER' && r.row.designation === 'HR Recruiter' && r.row.hr_sub_role === 'HR_RECRUITER', 'HR Recruiter saved: HR department, Team Member, designation HR Recruiter', r.row);
await expect(/Recruiter/.test(r.willOpen), 'the form said HR Recruiter opens the Recruiter dashboard', r.willOpen);
const h = await create('HR Admin Head', 'Hema Head', HEAD);
await expect(h.row.slug === 'hr' && h.row.role === 'DEPARTMENT_HEAD' && !h.row.is_operations_head && h.row.designation === 'HR Admin Head' && h.row.hr_sub_role === null, 'HR Admin Head saved: Department Head of HR, not an Operations Head, designation HR Admin Head', h.row);
await sup.ctx.close();

// ------------------------------------------------------------------ 3. the API refuses wrong pairs whatever the browser sends
const base = { joiningDate: '2025-01-10', dateOfBirth: '1990-05-05', bloodGroup: 'A+', contactNumber: '+91 98111 22222', emergencyContact: '+91 98765 43210' };
const bad = async (body, msg) => {
  const email = `bad.${crypto.randomBytes(3).toString('hex')}@amuwa.com`;
  const res = await call(sa, 'POST', '/users', { email, fullName: 'Wrong Pair', role: body.role, teamId: body.teamId, details: { designation: body.designation, ...base } });
  await expect(res.status >= 400 && !res.success && !(await idOf(email)), msg, { status: res.status, error: res.error });
};
const accTeam = (await q('select id from teams where department_id = $1 limit 1', [ACC.id]))[0].id;
await bad({ role: 'TEAM_MEMBER', teamId: hrTeam, designation: 'Team Member' }, 'API: a generic "Team Member" designation is refused for a new HR employee');
await bad({ role: 'TEAM_HEAD', teamId: hrTeam, designation: 'Team Lead' }, 'API: "Team Lead" is refused for a new HR employee');
await bad({ role: 'TEAM_MEMBER', teamId: accTeam, designation: 'HR Recruiter' }, 'API: HR Recruiter is refused for the Accounts department');
await bad({ role: 'TEAM_MEMBER', teamId: hrTeam, designation: 'HR Admin Head' }, 'API: HR Admin Head is refused for a Team Member');

// ------------------------------------------------------------------ 4. each signs in to the dashboard of their designation
const setPassword = async email => {
  const pw = secret();
  const id = await idOf(email);
  await fetch(GATEWAY + '/auth/v1/user', { method: 'PUT', headers: { authorization: `Bearer ${sign({ sub: id, role: 'authenticated' })}`, apikey: process.env.SUPABASE_ANON_KEY || '', 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  await q(`update profiles set status = 'ACTIVE' where email = $1 and status <> 'ACTIVE'`, [email]);
  return pw;
};
const landing = async (email, file) => {
  const p = await signIn(email, await setPassword(email));
  await p.waitForSelector('nav button, aside button', { timeout: 25000 }).catch(() => fail(`${email} did not reach a dashboard`));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  const out = { url: p.url(), text: await p.locator('body').innerText() };
  await p.ctx.close();
  return out;
};
const la = await landing(ASSIST, 'hr-designations-3-assistant.png');
await expect(!la.url.includes('/hr-recruiter/') && /HR/.test(la.text), 'HR Assistant opens the existing HR dashboard', la.url);
const lr = await landing(RECRUIT, 'hr-designations-4-recruiter.png');
await expect(lr.url.includes('/hr-recruiter/dashboard/'), 'HR Recruiter opens the HR Recruiter dashboard', lr.url);
const lh = await landing(HEAD, 'hr-designations-5-head.png');
await expect(!lh.url.includes('/hr-recruiter/') && !/Operations Dashboard/.test(lh.text) && !/Security & Audit Logs/.test(lh.text), 'HR Admin Head opens the HR Department Head dashboard, without Super Admin or Operations Head pages', lh.url);

console.log(`\nHR DESIGNATION FORM CHECKS PASSED (${step})`);
await browser.close();
await db.end();
