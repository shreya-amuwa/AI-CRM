// Welcome e-mail for a new employee, end to end in real browsers: HR submits, the Department Head approves, the account is active and the welcome e-mail is
// queued by the backend (HR sees Account: Active and the e-mail status, can resend), the employee opens the e-mailed one-time link, chooses their own
// password, lands on the dashboard of their role, signs in again with the new password, and the used link no longer works. No password is typed by anybody
// else and none is stored. (The mailbox is played by the test: it asks the local auth stand-in for the same recovery link the server puts in the e-mail.)
// Passwords are made up at run time. See supabase/tests/e2e/README.md for how to run it.
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
const fail = async m => { await current?.screenshot({ path: `${OUT}/welcome-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(0, 4)) : ''); process.exit(1); };
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

const GW = 'http://localhost:54400';
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// ------------------------------------------------------------------ fixture
const sa = await idOf('root@amuwa.com');
const wab = (await q(`select id from departments where slug = 'wabastore'`))[0].id;
const hrDept = (await q(`select id from departments where slug = 'hr'`))[0].id;
const hrTeam = (await q(`select id from teams where department_id = $1 order by created_at limit 1`, [hrDept]))[0].id;
const dhId = await idOf('dh@amuwa.com');
const HR_MEMBER = `hr.member.${tag}@amuwa.com`;
PASSWORDS[HR_MEMBER] = secret();
await api(sa, 'POST', '/users', { email: HR_MEMBER, fullName: 'Harsh Member', password: PASSWORDS[HR_MEMBER], role: 'TEAM_MEMBER', teamId: hrTeam });
const hrId = await idOf(HR_MEMBER);
const EMP = `rahul.sharma.${tag}@amuwa.com`;
const details = { designation: 'Team Member', joiningDate: '2026-01-05', dateOfBirth: '1992-05-06', bloodGroup: 'B+', contactNumber: '+91 91234 56789', emergencyContact: '+91 98765 43210' };
const req = await api(hrId, 'POST', '/employee-requests', { email: EMP, fullName: 'Rahul Sharma', role: 'TEAM_MEMBER', departmentId: wab, division: 'SALES', employeeCode: 'EMP-4242', details });
const [pending] = await q(`select (select count(*)::int from employee_welcome_emails w where w.employee_id = p.id) mails, p.status from profiles p where p.email = $1`, [EMP]);
await expect(pending.status === 'PENDING' && pending.mails === 0, 'a request that is only submitted: the account is pending and no welcome e-mail exists', pending);
const mailbox = async () => {
  // what the server puts in the e-mail: a one-time recovery link for the employee
  const r = await fetch(`${GW}/auth/v1/admin/generate_link`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${SVC}`, apikey: SVC }, body: JSON.stringify({ type: 'recovery', email: EMP, redirectTo: `${BASE}/set-password` }) });
  const j = await r.json();
  return `${BASE}/set-password?token_hash=${j.hashed_token}&type=recovery`;
};

// ------------------------------------------------------------------ the Department Head approves: the account is active, the e-mail is queued once
const dh = await login('dh@amuwa.com');
await api(dhId, 'POST', `/employee-requests/${req.id}/decide`, { approve: true });
const [active] = await q(`select p.status, count(w.id)::int mails, min(w.trigger_event) ev, min(w.status) st from profiles p left join employee_welcome_emails w on w.employee_id = p.id where p.email = $1 group by p.status`, [EMP]);
await expect(active.status === 'ACTIVE' && active.mails === 1 && active.ev === 'EMPLOYEE_REQUEST_APPROVED', 'approved: the account is active and exactly one welcome e-mail was queued by the backend', active);
await expect(['PENDING', 'DRY_RUN', 'SENT', 'RETRYING'].includes(active.st), 'with a real status (never a made-up success)', active);
await dh.ctx.close();

// ------------------------------------------------------------------ HR sees the account and the e-mail status, and can resend
const hr = await login(HR_MEMBER, undefined, 'button:has-text("Employee Requests")');
await menu(hr, 'Employee Requests');
await wait(hr, '[data-testid="welcome-status"]', 'HR does not see the welcome e-mail status');
const status = await hr.getByTestId('welcome-status').first().innerText();
await expect(/Account:\s*Active/.test(status) && /Welcome email:/.test(status), 'HR sees "Account: Active" and "Welcome email: <status>" for the employee', status);
await expect(!/token_hash|password:/i.test(await hr.evaluate(() => document.body.innerText)), 'and no password or link anywhere on the page');
await hr.screenshot({ path: `${OUT}/welcome-1-hr.png`, fullPage: true });
await q(`update employee_welcome_emails set sent_at = now() - interval '1 hour' where employee_id = (select id from profiles where email = $1)`, [EMP]);
const resend = hr.getByRole('button', { name: 'Resend welcome e-mail' }).first();
if (await resend.count()) {
  await resend.click();
  await hr.getByText(/queued again with a fresh secure link/).waitFor({ timeout: 15000 }).catch(() => fail('the resend was not accepted'));
  ok('HR resends the welcome e-mail (a fresh link is made when it is sent)');
} else ok('the e-mail is still in flight: no resend is offered (no accidental duplicate)');
await hr.ctx.close();

// ------------------------------------------------------------------ the employee: link -> own password -> own dashboard
const link = await mailbox();
const emp = await open();
current = emp;
await emp.goto(link);
await emp.getByRole('form', { name: 'Set your password' }).waitFor({ timeout: 20000 }).catch(() => fail('the set-password page did not open'));
const pageText = await emp.evaluate(() => document.body.innerText);
await expect(/Welcome! Set your password/.test(pageText) && !/Temporary password/i.test(pageText), 'the e-mailed link opens a page to choose their own password');
const NEWPW = secret();
const pw = emp.locator('input[type="password"]');
await pw.nth(0).fill('short');
await pw.nth(1).fill('short');
await emp.getByRole('button', { name: /Save password/ }).click();
await emp.getByText(/at least 10 characters/).first().waitFor({ timeout: 5000 }).catch(() => fail('a short password was not refused'));
await pw.nth(0).fill(NEWPW);
await pw.nth(1).fill(NEWPW + 'x');
await emp.getByRole('button', { name: /Save password/ }).click();
await emp.getByText(/not the same/).first().waitFor({ timeout: 5000 }).catch(() => fail('a mismatch was not refused'));
await pw.nth(1).fill(NEWPW);
await emp.getByRole('button', { name: /Save password/ }).click();
await emp.getByText(/Your password is saved/).waitFor({ timeout: 20000 }).catch(() => fail('the password was not saved'));
ok('the employee sets their own permanent password from the one-time link');
const [done] = await q(`select w.setup_completed_at is not null as done from employee_welcome_emails w join profiles p on p.id = w.employee_id where p.email = $1 order by w.created_at desc limit 1`, [EMP]);
await expect(done.done, 'the first-time setup is recorded in the backend');
await emp.getByRole('button', { name: 'Open my dashboard' }).click();
await emp.waitForSelector('nav button', { timeout: 30000 }).catch(() => fail('the employee did not reach a dashboard after setting the password: ' + emp.url()));
await expect(!/\/login/.test(emp.url()), 'they land in the CRM, signed in, not on the sign-in page', emp.url());
const nav = (await emp.locator('nav button').allInnerTexts()).join(' | ');
await expect(!/Employee Requests|Top Performers|Access Control/.test(nav), 'and see only the menu of their own role (no HR or management pages)', nav);
await emp.screenshot({ path: `${OUT}/welcome-2-employee-dashboard.png`, fullPage: true });
await emp.ctx.close();

// ------------------------------------------------------------------ the new password works, the link does not work twice
PASSWORDS[EMP] = NEWPW;
const again = await login(EMP);
await expect(!/\/login/.test(again.url()), 'signing in again with the email and the chosen password reaches the dashboard', again.url());
await again.ctx.close();
const reuse = await open();
current = reuse;
await reuse.goto(link);
await reuse.getByRole('form', { name: 'Set your password' }).waitFor({ timeout: 20000 });
await reuse.locator('input[type="password"]').nth(0).fill(secret() + 'z');
const same = await reuse.locator('input[type="password"]').nth(0).inputValue();
await reuse.locator('input[type="password"]').nth(1).fill(same);
await reuse.getByRole('button', { name: /Save password/ }).click();
await reuse.getByText(/This link has expired/).waitFor({ timeout: 20000 }).catch(() => fail('a used link was accepted a second time'));
ok('the used link no longer works (it is one-time)');
await reuse.ctx.close();
const [after] = await q(`select count(*)::int n from employee_welcome_emails w join profiles p on p.id = w.employee_id where p.email = $1`, [EMP]);
await expect(after.n === 1, 'still one welcome e-mail record for the employee', after);
const noTrace = await q(`select count(*)::int n from (select detail t from employee_welcome_email_attempts union all select body from notifications union all select metadata::text from audit_logs) x where t like '%token_hash%' or t like '%' || $1 || '%'`, [NEWPW]);
await expect(noTrace[0].n === 0, 'no link or password appears in the attempt records, notifications or audit log', noTrace);
const real = errors.filter(e => !/WebSocket|realtime/i.test(e));
await expect(real.length === 0, 'no browser errors', real.slice(0, 3));
await browser.close();
await db.end();
console.log(`ALL ${step} WELCOME E-MAIL CHECKS PASSED`);
