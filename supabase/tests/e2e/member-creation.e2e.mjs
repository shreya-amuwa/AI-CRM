// Who adds a team member, and how: a Team Lead adds one to their own team at once (with a Sales role for a Sales team), while an employee HR adds
// waits for the Department Head's decision. Real browsers against the local stack (Postgres + PostgREST + gateway + the web app).
// No credentials live in this file: staff passwords come from E2E_PASSWORDS (made up by the runner); the accounts made here get passwords made up at run time.
// See supabase/tests/e2e/README.md for how to run it.
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
const fail = async m => { await current?.screenshot({ path: `${OUT}/members-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(0, 4)) : ''); process.exit(1); };
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
const loginWith = async (email, password, viewport, ready = 'nav button') => {
  const p = await open(viewport);
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(password);
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector(ready, { timeout: 25000, state: 'attached' }).catch(() => fail(`${email} did not reach a dashboard (${ready})`));
  return p;
};
const login = (email, viewport, ready) => loginWith(email, pwOf(email), viewport, ready);
const wait = async (p, sel, m, t = 15000) => { current = p; await p.waitForSelector(sel, { timeout: t }).catch(() => fail(m)); };
const menuItem = (p, label) => p.locator('nav button').filter({ has: p.locator('span', { hasText: new RegExp(`^${label}$`) }) }).first();
const menu = async (p, label) => {
  const dash = menuItem(p, label);
  if (await dash.count()) await dash.click(); else await p.getByRole('button', { name: label, exact: true }).first().click();
};
const tag = crypto.randomBytes(3).toString('hex');

// ------------------------------------------------------------------ fixture
const sa = await idOf('root@amuwa.com');
const wab = (await q(`select id from departments where slug = 'wabastore'`))[0].id;
const salesTeam = (await q(`select id from teams where department_id = $1 and name = 'Sales'`, [wab]))[0].id;
const supportTeam = (await q(`select id from teams where department_id = $1 and name = 'Support'`, [wab]))[0].id;
const hrDept = (await q(`select id from departments where slug = 'hr'`))[0].id;
const hrTeam = (await q(`select id from teams where department_id = $1 order by created_at limit 1`, [hrDept]))[0].id;
const HR_MEMBER = `hr.member.${tag}@amuwa.com`;
PASSWORDS[HR_MEMBER] = secret();
await api(sa, 'POST', '/users', { email: HR_MEMBER, fullName: 'Harsh Member', password: PASSWORDS[HR_MEMBER], role: 'TEAM_MEMBER', teamId: hrTeam });
ok('fixture: an HR Team Member exists');

// ------------------------------------------------------------------ 1. the Team Lead adds team members, with Sales roles
const lead = await login('lead@amuwa.com');
await menu(lead, 'Team Members & Access');
await lead.locator('[data-testid="tab-add"]').click();
await lead.locator('#staff-role').waitFor({ timeout: 15000 });
const leadRoles = await lead.locator('#staff-role option').allInnerTexts();
await expect(leadRoles.length === 1 && /Team Member/i.test(leadRoles[0]), 'a Team Lead can only choose Team Member (no Department Head, Team Lead or Super Admin)', leadRoles);
const assoc = await lead.getByTestId('lead-association').innerText();
await expect(/Wabastore/.test(assoc) && /Sales/.test(assoc) && /Lead Person/.test(assoc) && /no approval/i.test(assoc), 'the form shows the department, the team and the Team Lead the member reports to', assoc);
await expect((await lead.locator('#staff-sales-role').count()) === 1, 'the Sales role dropdown shows for a Team Lead of a Sales team');
const opts = await lead.locator('#staff-sales-role option').allInnerTexts();
await expect(['Telecaller', 'Business Associate', 'Influencer', 'Visit Sales', 'Business Partner'].every(o => opts.includes(o)), 'it offers the five Sales roles', opts);
await expect((await lead.locator('select').filter({ has: lead.locator('option', { hasText: 'Operations Head' }) }).count()) === 1, 'the form shows the designation dropdown');

const created = {};
const addMember = async (p, name, email, salesRole) => {
  const pw = secret();
  PASSWORDS[email] = pw;
  if (salesRole) await p.locator('#staff-sales-role').selectOption(salesRole);
  await p.getByPlaceholder('e.g. Kunal Sharma').fill(name);
  await p.getByPlaceholder('kunal@amuwa.com').fill(email);
  await expect((await p.getByPlaceholder('min. 10 characters').count()) === 0 && (await p.locator('input[type="password"]').count()) === 0, 'the Add Member form has no password field (the employee chooses their own from the welcome e-mail)');
  await p.locator('input[type="date"]').first().fill('2025-01-10');
  await p.locator('input[type="date"]').nth(1).fill('1995-05-05');
  await p.locator('select').filter({ has: p.locator('option', { hasText: 'A+' }) }).first().selectOption('A+');
  await p.getByTestId('member-contact-number').fill('+91 98111 22222');
  await p.getByPlaceholder('+91 98765 43210').fill('+91 98765 43210');
  await p.getByRole('button', { name: /Create|Add team member|Add member/i }).last().click();
  await p.getByText(`Team Member Added Successfully: ${name}`).first().waitFor({ timeout: 15000 }).catch(() => fail(`${name} was not added`));
  // what the welcome e-mail's link does for the employee: they choose their own password (nobody else ever knows one)
  await api(await idOf(email), 'POST', '/me/password', { password: pw });
};
const rows = [
  ['Tele Lead', `tele.${tag}@amuwa.com`, 'TELECALLER', 'telecaller'],
  ['Biz Lead', `biz.${tag}@amuwa.com`, 'BUSINESS_ASSOCIATE', 'business-associate'],
  ['Influ Lead', `influ.${tag}@amuwa.com`, 'INFLUENCER', 'sales-influencer'],
  ['Visit Lead', `visit.${tag}@amuwa.com`, 'VISIT_SALES', 'sales-visit-sales'],
  ['Partner Lead', `partner.${tag}@amuwa.com`, 'BUSINESS_PARTNER', 'sales-business-partner'],
  ['Plain Lead', `plain.${tag}@amuwa.com`, '', 'sales-member']
];
for (const [name, email, role] of rows) {
  await addMember(lead, name, email, role);
  const [pr] = await q(`select p.status, p.role, p.team_id, p.department_id, p.sales_sub_role, p.default_dashboard, (select count(*)::int from approval_requests r where r.subject_user_id = p.id) approvals from profiles p where p.email = $1`, [email]);
  created[email] = pr;
  await expect(pr && pr.status === 'ACTIVE' && pr.role === 'TEAM_MEMBER' && pr.team_id === salesTeam && pr.department_id === wab && (pr.sales_sub_role ?? '') === role && pr.approvals === 0, `${name}: active at once, in the Team Lead's Sales team, role ${role || 'none'}, and no approval request`, pr);
  await lead.screenshot({ path: `${OUT}/members-1-${role || 'plain'}.png` });
}
const dash = Object.fromEntries(rows.map(([, e, , d]) => [e, d]));
for (const [email, d] of Object.entries(dash)) await expect(created[email].default_dashboard === d, `${email} opens the ${d} dashboard`, created[email].default_dashboard);

await lead.locator('[data-testid="tab-members"]').click();
await lead.getByTestId('member-search').fill(tag);
await lead.getByText('Tele Lead').first().waitFor({ timeout: 15000 }).catch(() => fail('the new member is not in the Team Members list'));
ok('the new members show in the Team Members directory straight away');

// the new member signs in at once (no approval)
const tele = await login(`tele.${tag}@amuwa.com`);
await tele.waitForFunction(() => /\/telecaller\/dashboard\//.test(location.pathname), null, { timeout: 20000 }).catch(() => fail('the new Telecaller did not land on the Telecaller dashboard: ' + tele.url()));
ok('the Telecaller added by the Team Lead signs in at once and lands on the Telecaller dashboard');
await tele.ctx.close();

// a Team Lead cannot do more through the API either
const leadId = await idOf('lead@amuwa.com');
const bad = async (m, body) => { const r = await call(as(leadId), 'POST', '/users', { password: secret(), fullName: 'Nope', ...body }); await expect(r.status >= 400 && !r.success, `API: a Team Lead cannot ${m}`, r); };
await bad('create a Department Head', { email: `x1.${tag}@amuwa.com`, role: 'DEPARTMENT_HEAD', departmentId: wab });
await bad('create a Team Lead', { email: `x2.${tag}@amuwa.com`, role: 'TEAM_HEAD', teamId: salesTeam });
await bad('create a Super Admin', { email: `x3.${tag}@amuwa.com`, role: 'SUPER_ADMIN' });
await bad('add to another team', { email: `x4.${tag}@amuwa.com`, role: 'TEAM_MEMBER', teamId: supportTeam });
await lead.ctx.close();

// ------------------------------------------------------------------ 2. HR submits: waits for the Department Head
const hr = await login(HR_MEMBER, undefined, 'button:has-text("Employee Requests")');
await menu(hr, 'Employee Requests');
const form = hr.getByRole('form', { name: 'Employee request' });
await form.waitFor({ timeout: 15000 }).catch(() => fail('the HR request form did not open'));
await expect(/Department Head approves|approval first/i.test(await form.innerText()), 'the HR form says the employee needs approval first');
const submitFor = async (p, name, email, role = 'Team Member') => {
  const f = p.getByRole('form', { name: 'Employee request' });
  const pw = secret();
  PASSWORDS[email] = pw;
  await f.locator('select').nth(0).selectOption({ label: role });
  await f.locator('select').nth(1).selectOption({ label: 'Wabastore' });
  await f.locator('input').nth(0).fill(name);
  await f.locator('input[type="email"]').fill(email);
  await expect((await f.locator('input[type="password"]').count()) === 0, 'the HR form has no password field');
  await f.locator('input[type="date"]').nth(0).fill('2025-02-01');
  await f.locator('input[type="date"]').nth(1).fill('1996-06-06');
  await f.locator('select').filter({ has: p.locator('option', { hasText: 'A+' }) }).first().selectOption('A+');
  await f.getByPlaceholder('+91 98765 43210').first().fill('+91 98765 00001');
  await f.getByPlaceholder('+91 98765 43210').nth(1).fill('+91 98765 00002');
  await f.getByRole('button', { name: 'Send for approval' }).click();
  await p.getByTestId('submitted-for-approval').waitFor({ timeout: 15000 }).catch(() => fail(`${name} was not submitted`));
};
const OK_EMAIL = `hr.ok.${tag}@amuwa.com`, NO_EMAIL = `hr.no.${tag}@amuwa.com`;
await submitFor(hr, 'Hira Approved', OK_EMAIL);
const submitted = await hr.getByTestId('submitted-for-approval').innerText();
await expect(/Employee Submitted for Department Head Approval/.test(submitted), 'HR sees "Employee Submitted for Department Head Approval"', submitted);
await hr.screenshot({ path: `${OUT}/members-2-hr-submitted.png`, fullPage: true });
await submitFor(hr, 'Hira Rejected', NO_EMAIL);
const [pend] = await q(`select p.status, p.team_id, r.status rs, r.source, r.approver_kind from profiles p join approval_requests r on r.subject_user_id = p.id where p.email = $1`, [OK_EMAIL]);
await expect(pend && pend.status === 'PENDING' && pend.rs === 'PENDING' && pend.source === 'HR', 'the HR employee is PENDING with a pending request from HR', pend);
await hr.getByText('Hira Approved').first().waitFor({ timeout: 15000 }).catch(() => fail('the request is not under "Requests you sent"'));
ok('HR sees the request and its status under "Requests you sent"');
// no login before approval
const gw = await fetch('http://localhost:54400/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: process.env.SUPABASE_ANON_KEY || '', 'content-type': 'application/json' }, body: JSON.stringify({ email: OK_EMAIL, password: PASSWORDS[OK_EMAIL] }) });
const gwBody = await gw.json().catch(() => ({}));
const [ban] = await q(`select coalesce(raw_app_meta_data->>'banned', 'none') b from auth.users where email = $1`, [OK_EMAIL]);
await expect(!gwBody.access_token || ban.b !== 'none', 'the pending employee cannot sign in before approval', { status: gw.status, banned: ban.b });
await hr.ctx.close();

// HR cannot add directly through the user endpoint
const hrId = await idOf(HR_MEMBER);
const direct = await call(as(hrId), 'POST', '/users', { email: `hr.direct.${tag}@amuwa.com`, fullName: 'Sneaky', password: secret(), role: 'TEAM_MEMBER', teamId: salesTeam });
await expect(direct.status >= 400 && !direct.success, 'API: HR cannot skip the approval by creating the account directly', direct);

// ------------------------------------------------------------------ 3. the Department Head decides
const dh = await login('dh@amuwa.com');
await menu(dh, 'Team Members & Access');
await dh.locator('[data-testid="tab-approvals"]').click();
await dh.locator('li').filter({ hasText: 'Hira Approved' }).first().waitFor({ timeout: 30000 }).catch(() => fail('the Department Head does not see the request'));
await dh.screenshot({ path: `${OUT}/members-3-dh-approvals.png`, fullPage: true });
const card = name => dh.locator('li').filter({ hasText: name });
// approve
await card('Hira Approved').getByRole('button', { name: 'Approve', exact: true }).click();
const dlg = dh.getByRole('dialog');
await dlg.waitFor({ timeout: 10000 }).catch(() => fail('the decision dialog did not open'));
await dlg.getByRole('button', { name: 'Approve', exact: true }).click();
await dlg.waitFor({ state: 'detached', timeout: 15000 }).catch(() => fail('the approval dialog did not close'));
const [appr] = await q(`select p.status, r.status rs, r.decided_by, r.decided_at from profiles p join approval_requests r on r.subject_user_id = p.id where p.email = $1`, [OK_EMAIL]);
await expect(appr.status === 'ACTIVE' && appr.rs === 'APPROVED' && appr.decided_by === (await idOf('dh@amuwa.com')) && appr.decided_at, 'approving makes the employee ACTIVE and records who decided and when', appr);
// reject (a reason is required)
await card('Hira Rejected').getByRole('button', { name: 'Reject', exact: true }).click();
const dlg2 = dh.getByRole('dialog');
await dlg2.waitFor({ timeout: 10000 }).catch(() => fail('the decision dialog did not open for the rejection'));
await dlg2.getByRole('button', { name: 'Reject', exact: true }).click();
await expect((await q(`select status from profiles where email = $1`, [NO_EMAIL]))[0].status === 'PENDING', 'rejecting without a reason does nothing');
await dlg2.locator('textarea').fill('Documents are incomplete.');
await dlg2.getByRole('button', { name: 'Reject', exact: true }).click();
await dlg2.waitFor({ state: 'detached', timeout: 15000 }).catch(() => fail('the rejection dialog did not close'));
const [rej] = await q(`select p.status, r.status rs, r.decision_note, r.decided_by from profiles p join approval_requests r on r.subject_user_id = p.id where p.email = $1`, [NO_EMAIL]);
await expect(rej.status !== 'ACTIVE' && rej.rs === 'REJECTED' && /incomplete/.test(rej.decision_note ?? '') && rej.decided_by, 'rejecting keeps the account inactive, with the reason and who decided', rej);
await dh.ctx.close();

const [okBan] = await q(`select coalesce(raw_app_meta_data->>'banned', 'none') b from auth.users where email = $1`, [OK_EMAIL]);
await expect(okBan.b === 'none', 'the approved employee is no longer blocked from signing in', okBan);
const [noBan] = await q(`select coalesce(raw_app_meta_data->>'banned', 'none') b from auth.users where email = $1`, [NO_EMAIL]);
await expect(noBan.b !== 'none', 'the rejected employee stays blocked from signing in', noBan);

// HR sees the outcome
const hr2 = await login(HR_MEMBER, undefined, 'button:has-text("Employee Requests")');
await menu(hr2, 'Employee Requests');
await hr2.getByText('Hira Rejected').first().waitFor({ timeout: 15000 }).catch(() => fail('HR does not see the rejected request'));
const hrText = await hr2.locator('main').innerText();
await expect(/Approved/.test(hrText) && /Rejected/i.test(hrText), 'HR sees Approved and Rejected statuses on the requests', hrText.slice(0, 300));
await hr2.screenshot({ path: `${OUT}/members-4-hr-statuses.png`, fullPage: true });
await hr2.ctx.close();

console.log(`ALL ${step} MEMBER CREATION CHECKS PASSED`);
await db.end();
await browser.close();
