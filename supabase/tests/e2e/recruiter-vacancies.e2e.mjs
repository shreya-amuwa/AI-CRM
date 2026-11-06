// The HR Recruiter dashboard in a real browser (migration 20261227000200): the sidebar sections (Work / Recruitment / Management, collapsible), creating,
// editing and changing the status of a vacancy, the Department filter (real departments, filtering by department, a genuine empty result), the data
// surviving a reload, and an HR Assistant still landing on the HR dashboard. Local stack only; passwords are made up per run.
// See supabase/tests/e2e/README.md (run-recruiter-vacancies.sh).
import { chromium } from 'playwright-core';
import crypto from 'node:crypto';
import pg from 'pg';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const GATEWAY = process.env.E2E_GATEWAY || 'http://localhost:54400';
const OUT = process.argv[2] || '.';
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
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
  await current?.screenshot({ path: `${OUT}/recruiter-fail.png`, fullPage: true }).catch(() => {});
  console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(-5)) : '');
  await browser.close();
  process.exit(1);
};
const expect = async (c, m, extra) => (c ? ok(m) : fail(m + (extra === undefined ? '' : ' ' + JSON.stringify(extra))));
const until = async (fn, ms = 15000) => { for (const t = Date.now(); Date.now() - t < ms;) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 250)); } return null; };
process.on('unhandledRejection', e => fail(`an unexpected error: ${String(e?.message ?? e).split('\n').slice(0, 4).join(' | ')}`));

// ------------------------------------------------------------------ fixture: an HR Recruiter and an HR Assistant (made through the real API)
const sa = await idOf('root@amuwa.com');
const hr = (await q(`select id from departments where slug = 'hr'`))[0].id;
let hrTeam = (await q(`select id from teams where department_id = $1 order by created_at limit 1`, [hr]))[0]?.id;
if (!hrTeam) hrTeam = (await q(`insert into teams (department_id, name, division) values ($1, 'General', 'GENERAL') returning id`, [hr]))[0].id;
const tag = crypto.randomBytes(3).toString('hex');
const details = d => ({ designation: d, joiningDate: '2025-01-10', dateOfBirth: '1995-05-05', bloodGroup: 'A+', contactNumber: '+91 98111 22222', emergencyContact: '+91 98765 43210' });
const mk = async (email, name, designation) => {
  const r = await call(sa, 'POST', '/users', { email, fullName: name, role: 'TEAM_MEMBER', teamId: hrTeam, details: details(designation) });
  if (!r.success) await fail(`fixture ${email}: ${JSON.stringify(r.error)}`);
  return r.data.id;
};
const REC = `simran.${tag}@amuwa.com`, ASST = `asst.${tag}@amuwa.com`;
await mk(REC, 'Simran Recruiter', 'HR Recruiter');
await mk(ASST, 'Asha Assistant', 'HR Assistant');
await expect((await q(`select hr_sub_role from profiles where email = $1`, [REC]))[0].hr_sub_role === 'HR_RECRUITER', 'fixture: an HR Recruiter (designation HR Recruiter)');
const departments = (await q(`select id, name from departments where facet_of is null order by name`));

const signIn = async email => {
  const pw = secret();
  await fetch(GATEWAY + '/auth/v1/user', { method: 'PUT', headers: { authorization: `Bearer ${sign({ sub: await idOf(email), role: 'authenticated' })}`, apikey: process.env.SUPABASE_ANON_KEY || '', 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.ctx = ctx;
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(pw);
  await p.locator('form button[type="submit"]').click();
  return p;
};

// ------------------------------------------------------------------ 1. sidebar
const p = await signIn(REC);
await p.waitForURL(/\/hr-recruiter\/dashboard\//, { timeout: 25000 }).catch(() => fail('the Recruiter did not reach the recruiter dashboard'));
const nav = p.getByRole('navigation', { name: /HR Recruiter navigation pages/ });
await nav.waitFor({ timeout: 15000 });
for (const label of ['Work', 'Recruitment', 'Management']) {
  await expect(await nav.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).count() === 1, `sidebar: a "${label}" section heading`);
}
const sectionOf = async label => nav.evaluate((n, l) => [...n.children].find(g => g.querySelector('button[aria-expanded]')?.textContent?.trim().toLowerCase() === l.toLowerCase())?.innerText ?? '', label);
await expect(/Dashboard/.test(await sectionOf('Work')) && /Call Management/.test(await sectionOf('Work')) && /Interview Management/.test(await sectionOf('Work')), 'Work: Dashboard, Call Management (calls and follow-ups), Interview Management');
const rec = await sectionOf('Recruitment');
await expect(['Vacancies', 'Candidate Applications', 'Candidate Pipeline', 'Assessment & Test Results', 'Selection & Rejection'].every(x => rec.includes(x)), 'Recruitment: Vacancies, Applications, Pipeline, Assessments, Selection & Rejection', rec);
await expect(/Recruitment Reports/.test(await sectionOf('Management')) && /Settings/.test(await sectionOf('Management')), 'Management: Recruitment Reports, Settings');
const mgmt = nav.getByRole('button', { name: /^Management$/i });
await mgmt.click();
await expect((await mgmt.getAttribute('aria-expanded')) === 'false' && !(await nav.getByRole('button', { name: 'Recruitment Reports' }).isVisible()), 'collapsing Management hides its pages');
await mgmt.click();
await expect((await nav.getByRole('button', { name: 'Recruitment Reports' }).isVisible()), 'expanding it shows them again');
await p.screenshot({ path: `${OUT}/recruiter-1-sidebar.png` });

// ------------------------------------------------------------------ 2. Department filter on the dashboard: the real departments
const dashDept = p.locator('#rf-dept');
await dashDept.waitFor({ timeout: 15000 });
await until(async () => (await dashDept.locator('option').count()) > 1);
const dashOpts = (await dashDept.locator('option').allInnerTexts()).slice(1);
await expect(JSON.stringify(dashOpts) === JSON.stringify(departments.map(d => d.name)), 'dashboard Department filter: every department of the company (none before any vacancy existed)', dashOpts);

// ------------------------------------------------------------------ 3. create and publish a vacancy
await nav.getByRole('button', { name: 'Vacancies' }).click();
await p.getByRole('button', { name: '+ Add Vacancy' }).waitFor({ timeout: 15000 });
const vDept = p.getByTestId('vacancy-department-filter');
await until(async () => (await vDept.locator('option').count()) > 1);
await expect((await vDept.locator('option').count()) === departments.length + 1, 'Vacancies page: the Department filter lists every department');
await p.getByRole('button', { name: '+ Add Vacancy' }).click();
const form = p.getByRole('form', { name: 'Add vacancy' });
await form.waitFor({ timeout: 10000 });
const accounts = departments.find(d => /account/i.test(d.name));
const TITLE = `Accounts Executive ${tag}`;
await form.getByLabel('Job title / designation *').fill(TITLE);
await form.getByLabel('Department *').selectOption(accounts.id);
await form.getByLabel('Number of openings *').fill('2');
await form.getByLabel('Employment type *').selectOption('FULL_TIME');
await form.getByLabel('Job location *').fill('Pune office');
await form.getByLabel('Work mode').selectOption('HYBRID');
const deadline = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
await form.getByLabel('Application deadline').fill(deadline);
await form.getByLabel('Job description *').fill('Keeps the accounts of the company accurate and on time.');
await form.getByLabel('Responsibilities').fill('Ledgers, GST returns, vendor payments');
await form.getByLabel('Required skills').fill('Tally, Excel');
await form.getByLabel('Qualifications').fill('B.Com');
await form.getByLabel('Experience required').fill('1-3 years');
await p.screenshot({ path: `${OUT}/recruiter-2-add-form.png`, fullPage: true });
await form.getByRole('button', { name: 'Publish vacancy' }).click();
const row = await until(async () => (await q(`select j.id, j.vacancy_status, j.published, j.openings, j.work_mode, j.responsibilities, p.department_id, j.responsible_id = (select id from profiles where email = $2) mine
                                               from career_postings j join hr_positions p on p.id = j.position_id where j.title = $1`, [TITLE, REC]))[0]);
if (!row) await fail(`the vacancy was not saved (${(await p.locator('[role="alert"]').allInnerTexts()).join(' | ')})`);
await expect(row.vacancy_status === 'OPEN' && row.published && row.openings === 2 && row.work_mode === 'HYBRID' && row.department_id === accounts.id && row.mine,
  'saved in the database: open, published, 2 openings, Accounts, hybrid, the Recruiter is responsible', row);
await p.getByRole('heading', { name: TITLE }).waitFor({ timeout: 10000 }).catch(() => fail('the new vacancy did not open'));
ok('the new vacancy opens straight after publishing');

// ------------------------------------------------------------------ 4. edit and status
await p.getByRole('button', { name: 'Edit vacancy' }).click();
const edit = p.getByRole('form', { name: 'Edit vacancy' });
await edit.getByLabel('Number of openings *').fill('3');
await edit.getByRole('button', { name: 'Save changes' }).click();
await expect(!!(await until(async () => (await q(`select openings from career_postings where id = $1`, [row.id]))[0].openings === 3)), 'edited: 3 openings saved');
await until(async () => /Openings\s*3/.test(await p.locator('main').innerText()));
await p.getByRole('button', { name: 'Change status' }).click();
const statusSel = p.getByLabel('New status');
const statusOpts = (await statusSel.locator('option').allInnerTexts()).map(t => t.trim());
await expect(['On hold', 'Closed', 'Filled'].every(s => statusOpts.some(o => o.toLowerCase() === s.toLowerCase())) && !statusOpts.some(o => /draft/i.test(o)), 'the Recruiter can choose On hold, Closed and Filled (not Draft)', statusOpts);
await statusSel.selectOption('ON_HOLD');
await p.getByRole('button', { name: 'Update status' }).click();
await expect(!!(await until(async () => (await q(`select vacancy_status from career_postings where id = $1`, [row.id]))[0].vacancy_status === 'ON_HOLD')), 'status changed to On hold');
await p.getByRole('button', { name: 'Change status' }).click();
await p.getByLabel('New status').selectOption('CLOSED');
await p.getByRole('button', { name: 'Update status' }).click();
await until(async () => (await q(`select vacancy_status from career_postings where id = $1`, [row.id]))[0].vacancy_status === 'CLOSED');
await p.getByRole('button', { name: 'Change status' }).click();
await p.getByLabel('New status').selectOption('OPEN');
await p.getByRole('button', { name: 'Update status' }).click();
await expect(!!(await until(async () => (await q(`select vacancy_status from career_postings where id = $1`, [row.id]))[0].vacancy_status === 'OPEN')), 'closed and reopened by the Recruiter');
await p.screenshot({ path: `${OUT}/recruiter-3-detail.png`, fullPage: true });

// ------------------------------------------------------------------ 4b. the redesigned detail page: metrics, sections, candidates
await p.reload();
await p.getByRole('heading', { name: TITLE }).waitFor({ timeout: 20000 });
const main = p.locator('main');
const metrics = await main.locator('dl[aria-label="Vacancy figures"] dt').allInnerTexts();
await expect(JSON.stringify(metrics.map(t => t.trim().toLowerCase())) === JSON.stringify(['openings', 'selected', 'remaining', 'posted', 'closes']), 'five metric cards: Openings, Selected, Remaining, Posted, Closes', metrics);
const fig = async label => (await main.locator('dl[aria-label="Vacancy figures"] div', { has: p.locator('dt', { hasText: new RegExp(`^${label}$`, 'i') }) }).locator('dd').innerText()).trim();
await expect((await fig('Openings')) === '3' && (await fig('Selected')) === '0' && (await fig('Remaining')) === '3', 'the figures come from the vacancy (3 openings, 0 selected, 3 remaining)');
await expect(/Breadcrumb/.test(await p.getByRole('navigation', { name: 'Breadcrumb' }).getAttribute('aria-label')) && /Vacancy Details/.test(await p.getByRole('navigation', { name: 'Breadcrumb' }).innerText()), 'breadcrumb: HR Department > Recruitment > Vacancy Details');
const text = await main.innerText();
await expect(['JOB DESCRIPTION', 'RESPONSIBILITIES', 'REQUIREMENTS BEFORE SELECTION', 'QUALIFICATIONS', 'REQUIRED SKILLS', 'EXPERIENCE', 'ADDITIONAL INFORMATION'].every(h => text.toUpperCase().includes(h)), 'the information sections are shown');
await expect((await main.locator('li', { hasText: /^Tally$/ }).count()) === 1 && (await main.locator('li', { hasText: /^Excel$/ }).count()) === 1, 'skills are shown as chips (Tally, Excel)');
await expect((await p.getByTestId('candidates-empty').count()) === 1 && /No Candidates Yet/.test(text), 'no candidates yet: the empty state, not an empty box');

// a candidate applies through the portal's own database function (the same one the Candidate Portal calls)
const cand = (await q(`insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ($1, now(), '{"candidate_portal":true}') returning id`, [`cand.${tag}@example.com`]))[0].id;
const c = await db.connect();
try {
  await c.query('begin');
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: cand, role: 'authenticated' })]);
  await c.query(`select public.career_profile($1::jsonb)`, [JSON.stringify({ name: 'Neha Applicant', phone: '9847650399', city: 'Pune', state: 'Maharashtra', education: 'B.Com', experience: '1 year', skills: 'Tally', bio: '', version: 1 })]);
  await c.query('commit');
  await c.query(`insert into career_files (id, applicant_id, file_name, size_bytes, status, storage_provider, storage_path) values (gen_random_uuid(), $1::uuid, 'resume.pdf', 1000, 'READY', 'SUPABASE', $1::text || '/r.pdf')`, [cand]);
  await c.query('begin');
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: cand, role: 'authenticated' })]);
  await c.query(`select public.career_apply($1::uuid, (select id from career_files where applicant_id = $2::uuid limit 1))`, [row.id, cand]);
  await c.query('commit');
} catch (e) { await c.query('rollback').catch(() => {}); await fail(`the test application could not be made: ${e.message}`); } finally { c.release(); }
await p.reload();
await p.getByRole('heading', { name: TITLE }).waitFor({ timeout: 20000 });
await expect(!!(await until(async () => (await main.locator('table tbody tr', { hasText: 'Neha Applicant' }).count()) === 1)), 'the application appears in the candidates table');
await expect((await main.locator('h2', { hasText: 'Candidates' }).innerText()).includes('1'), 'the Candidates heading shows the real count (1)');
const rowText = await main.locator('table tbody tr', { hasText: 'Neha Applicant' }).innerText();
await expect(/9847650399/.test(rowText) && /Not invited/.test(rowText) && /New Application|Initial Screening/.test(rowText), 'the row shows contact, assessment and stage', rowText);
await p.getByLabel('Search candidates').fill('nobody-matches-this');
await expect(!!(await until(async () => (await main.getByText('No candidates match these filters').count()) === 1)), 'a search with no match says so (database filter)');
await main.getByRole('button', { name: 'Clear filters' }).click();
await expect(!!(await until(async () => (await main.locator('table tbody tr', { hasText: 'Neha Applicant' }).count()) === 1)), 'clearing the filters shows the candidate again');
await p.screenshot({ path: `${OUT}/recruiter-5-detail-candidates.png`, fullPage: true });

// responsive: no horizontal page scroll on phone, tablet and desktop widths
for (const [w, h, name] of [[390, 844, 'phone'], [820, 1180, 'tablet'], [1280, 800, 'laptop'], [1920, 1080, 'wide']]) {
  await p.setViewportSize({ width: w, height: h });
  await p.waitForTimeout(400);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await expect(over <= 1, `${name} (${w}px): no horizontal scroll`, over);
  if (name === 'phone') await expect((await main.locator('ul[aria-label^="Candidates of"] li').count()) === 1, 'phone: candidates as compact cards');
  await p.screenshot({ path: `${OUT}/recruiter-6-detail-${name}.png`, fullPage: true });
}
await p.setViewportSize({ width: 1440, height: 900 });
await main.getByRole('button', { name: 'View profile of Neha Applicant' }).click();
await expect(!!(await until(async () => /\/applications\/[0-9a-f-]{36}/.test(p.url()))), 'View opens the candidate profile');
await p.goBack();
await p.getByRole('heading', { name: TITLE }).waitFor({ timeout: 20000 }).catch(() => undefined);
await nav.getByRole('button', { name: 'Vacancies' }).click();

// ------------------------------------------------------------------ 5. department filter on the list, empty state, reload
// (already back on the Vacancies list through the sidebar)
await vDept.waitFor();
await until(async () => (await vDept.locator('option').count()) > 1);
await vDept.selectOption(accounts.id);
await expect(!!(await until(async () => (await p.getByText(TITLE).count()) > 0)), 'filtering by Accounts shows the vacancy');
const other = departments.find(d => d.id !== accounts.id && !/account/i.test(d.name));
await vDept.selectOption(other.id);
await expect(!!(await until(async () => (await p.getByText('No vacancies match these filters').count()) > 0 && (await p.getByText(TITLE).count()) === 0)), `filtering by ${other.name} hides it and says nothing matches`);
await vDept.selectOption('');
await expect(!!(await until(async () => (await p.getByText(TITLE).count()) > 0)), 'All departments shows it again');
await p.screenshot({ path: `${OUT}/recruiter-4-list.png`, fullPage: true });
await p.reload();
await expect(!!(await until(async () => (await p.getByText(TITLE).count()) > 0, 20000)), 'after a reload the vacancy is still listed (stored in the database)');
await nav.getByRole('button', { name: 'Dashboard' }).click();
await p.locator('#rf-dept').waitFor();
await until(async () => (await p.locator('#rf-dept option').count()) > 1);
await p.locator('#rf-dept').selectOption(accounts.id);
await expect(!!(await until(async () => /1\s*Open vacancies|Open vacancies/.test(await p.locator('main').innerText()))), 'the dashboard filters by department without an error');
await expect(errors.length === 0, 'no page errors', errors);
await p.ctx.close();

// ------------------------------------------------------------------ 6. other HR roles unchanged
const a = await signIn(ASST);
await a.waitForSelector('text=Human Resources', { timeout: 25000 }).catch(() => fail('the HR Assistant did not reach a dashboard'));
await a.waitForTimeout(1000);
await expect(!a.url().includes('/hr-recruiter/'), 'an HR Assistant still opens the HR dashboard, not the recruiter one', a.url());
const aCreate = await call(await idOf(ASST), 'POST', '/recruiter/vacancies', { title: 'Nope', departmentId: accounts.id, openings: 1, description: 'Should never be saved by an assistant.', employmentType: 'FULL_TIME', location: 'X' });
await expect(aCreate.status === 403, 'an HR Assistant cannot use the recruiter vacancy endpoint', aCreate);
await a.ctx.close();

console.log(`\nRECRUITER VACANCY BROWSER CHECKS PASSED (${step})`);
await browser.close();
await db.end();
