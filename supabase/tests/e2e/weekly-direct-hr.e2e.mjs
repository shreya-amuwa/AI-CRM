// Weekly department report in real browsers: with an Operations Head it is submitted to them; with none the Department Head sends it
// straight to HR. Two departments: one with an Operations Head, one without. Passwords are made up at run time (none live in this file);
// the Super Admin's comes from E2E_PASSWORDS. See supabase/tests/e2e/README.md.
import { chromium } from 'playwright-core';
import crypto from 'node:crypto';
import pg from 'pg';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const OUT = process.argv[2] || '.';
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const secret = () => `${crypto.randomBytes(9).toString('base64url')}-Aa1`;
const sign = p => { const e = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p }); return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`; };
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const as = who => sign({ sub: who, role: 'authenticated' });
const call = async (who, method, path, body) => (await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${as(who)}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
const api = async (who, method, path, body) => { const j = await call(who, method, path, body); if (!j.success) throw new Error(path + JSON.stringify(j)); return j.data; };

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
let step = 0; const ok = m => console.log(`ok ${++step} - ${m}`);
let current;
const fail = async m => { await current?.screenshot({ path: `${OUT}/weekly-direct-hr-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m); await browser.close().catch(() => {}); process.exit(1); };
const expect = (c, m, detail) => (c ? ok(m) : fail(detail === undefined ? m : `${m} ${JSON.stringify(detail)}`));
process.on('uncaughtException', e => fail(`an unexpected error: ${String(e.message).split('\n').slice(0, 4).join(' | ')}`));
process.on('unhandledRejection', e => fail(`an unexpected error: ${String(e?.message ?? e).split('\n').slice(0, 4).join(' | ')}`));

// ------------------------------------------------------------------ fixture: two departments, one with an Operations Head
const sa = (await q(`select id from public.profiles where email = 'root@amuwa.com'`))[0].id;
const mkDept = async (slug, name) => {
  const id = (await q(`insert into public.departments (slug, name) values ($1, $2) returning id`, [slug, name]))[0].id;
  await q(`insert into public.teams (department_id, name, division) values ($1, 'Sales', 'SALES')`, [id]);
  return id;
};
const withOh = await mkDept('wde-with', 'WDE With Operations Head');
const noOh = await mkDept('wde-none', 'WDE Unassigned');
const home = await mkDept('wde-home', 'WDE Home');
const hrTeam = (await q(`insert into public.teams (department_id, name, division) select id, 'WDE HR', 'GENERAL' from public.departments where slug = 'hr' returning id`))[0].id;
const accounts = {};
const mk = async (key, body) => {
  const password = secret();
  const email = `wde.${key}@amuwa.com`;
  const data = await api(sa, 'POST', '/users', { email, fullName: `WDE ${key}`, password, ...body });
  accounts[key] = { id: data.id, email, password };
  return data.id;
};
const ohId = await mk('oh', { role: 'DEPARTMENT_HEAD', departmentId: home, operationsHead: true });
await mk('dhwith', { role: 'DEPARTMENT_HEAD', departmentId: withOh });
await mk('dhnone', { role: 'DEPARTMENT_HEAD', departmentId: noOh });
const hrId = await mk('hr', { role: 'TEAM_MEMBER', teamId: hrTeam, details: { designation: 'HR Assistant', joiningDate: '2026-01-05', dateOfBirth: '1992-05-06', bloodGroup: 'B+', contactNumber: '+91 91234 56772', emergencyContact: '+91 98765 43272' } });
await api(sa, 'POST', `/operations/heads/${ohId}/scope`, { departmentIds: [withOh], primaryDepartmentIds: [withOh] });
await q(`update public.profiles set created_at = now() - interval '90 days', approved_at = now() - interval '90 days' where email like 'wde.%'`);
ok('fixture: one department has an Operations Head, the other none');

const login = async (key, ready = 'nav button') => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(accounts[key].email);
  await p.locator('input[type="password"]').first().fill(accounts[key].password);
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector(ready, { timeout: 25000, state: 'attached' }).catch(() => fail(`${key} did not reach a dashboard`));
  return p;
};
const openWeekly = async p => {
  current = p;
  await p.locator('nav button').filter({ hasText: /^\s*(Daily )?Reports(\s*\d+)?\s*$/ }).first().click();
  await p.waitForSelector('[data-testid="reports-workspace"]', { timeout: 20000 }).catch(() => fail('the Reports page did not open'));
  await p.getByRole('tab', { name: /Weekly Department Report/ }).click();
  await p.getByRole('form', { name: 'Weekly report' }).waitFor({ timeout: 20000 }).catch(() => fail('the weekly report form did not open'));
};

// ------------------------------------------------------------------ a department WITH an Operations Head: unchanged
let p = await login('dhwith');
await openWeekly(p);
expect(await p.locator('[data-testid="weekly-routing-issue"]').count() === 0, 'with an Operations Head: no "goes directly to HR" note');
expect(await p.getByRole('button', { name: 'Submit to CEO' }).count() > 0 && await p.getByRole('button', { name: 'Send to HR' }).count() === 0, 'with an Operations Head: the button says Submit to CEO');
await p.close();

// ------------------------------------------------------------------ a department WITHOUT one: straight to HR
p = await login('dhnone');
await openWeekly(p);
const note = await p.locator('[data-testid="weekly-routing-issue"]').innerText().catch(() => '');
expect(/WDE Unassigned/.test(note) && /directly to HR/.test(note), 'without an Operations Head: the head is told the week goes directly to HR', note);
expect(await p.getByRole('button', { name: 'Send to HR' }).count() > 0, 'without an Operations Head: the button says Send to HR');
await p.getByLabel('Weekly report title').fill('Weekly report without an Operations Head');
await p.getByLabel('Remarks / Department summary').fill('Steady week.');
await p.getByRole('button', { name: 'Send to HR' }).first().click();
await p.waitForFunction(() => /sent directly to HR/i.test(document.body.innerText), null, { timeout: 20000 }).catch(() => fail('the page did not confirm the week was sent directly to HR'));
ok('without an Operations Head: the page confirms the week was sent directly to HR');
await p.close();

// ------------------------------------------------------------------ the database and HR
const pk = (await q(`select status, oh_reviewer_id, sent_to_hr_at from public.work_report_packages where department_id = $1`, [noOh]))[0];
expect(pk && pk.status === 'SENT_TO_HR' && pk.oh_reviewer_id === null && pk.sent_to_hr_at, 'the week is SENT_TO_HR with no Operations Head decision invented', pk);
const wk = (await q(`select period_start::text d from public.work_report_packages where department_id = $1`, [noOh]))[0].d;
const ov = await api(hrId, 'GET', `/hr-reviews/overview?weekStart=${wk}`);
expect(ov.departments.some(d => d.name === 'WDE Unassigned'), 'HR sees the department for review', ov.departments.map(d => d.name));
const withPk = await q(`select count(*)::int n from public.work_report_packages where department_id = $1`, [withOh]);
expect(withPk[0].n === 0, 'the department with an Operations Head sent nothing to HR');
console.log(`ALL ${step} WEEKLY DIRECT-TO-HR BROWSER CHECKS PASSED`);
await browser.close();
await db.end();
