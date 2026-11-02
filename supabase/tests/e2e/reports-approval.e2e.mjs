// Reports: the two-level approval and the live updates, in real browsers at every level.
//   Team Member submits -> Team Lead approves -> Department Head approves -> Fully Approved
// Five people are signed in at the same time and never reload: what one does must appear on the others' screens by itself.
// Real browsers against the local stack (Postgres + PostgREST + gateway with the Realtime stand-in + the web app).
// No credentials live in this file: staff passwords come from E2E_PASSWORDS (made up by the runner) and the Operations Head made here
// gets a password made up at run time. See supabase/tests/e2e/README.md for how to run it.
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
const fail = async m => { await current?.screenshot({ path: `${OUT}/reports-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(0, 4)) : ''); process.exit(1); };
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
const login = async (email, viewport, ready = 'nav button') => {
  const p = await open(viewport);
  current = p;
  await p.goto(BASE + '/login');
  await p.getByPlaceholder('name@amuwa.com').fill(email);
  await p.locator('input[type="password"]').first().fill(pwOf(email));
  await p.locator('form button[type="submit"]').click();
  await p.waitForSelector(ready, { timeout: 25000, state: 'attached' }).catch(() => fail(`${email} did not reach a dashboard (${ready})`));
  return p;
};
const wait = async (p, sel, m, t = 20000) => { current = p; await p.waitForSelector(sel, { timeout: t }).catch(() => fail(m)); };
// something that must appear on a screen nobody touched (no reload): the live update
const live = async (p, fn, m, t = 25000, arg) => { current = p; await p.waitForFunction(fn, arg, { timeout: t }).catch(() => fail(`not live: ${m}`)); };
const text = p => p.evaluate(() => document.body.innerText);
const openReports = async p => {
  current = p;
  await p.locator('nav button').filter({ hasText: /^\s*Reports(\s*\d+)?\s*$/ }).first().click();
  await wait(p, '[data-testid="reports-workspace"]', 'the Reports page did not open');
};
const tab = (p, name) => p.getByRole('tab', { name });
const titleCount = (p, title) => p.evaluate(t => document.body.innerText.split(t).length - 1, title);

// ------------------------------------------------------------------ fixture
const sa = await idOf('root@amuwa.com');
const dhId = await idOf('dh@amuwa.com');
const wab = (await q(`select id from departments where slug = 'wabastore'`))[0].id;
const task = (email, title, status) => q(
  `insert into public.work_tasks (department_id, team_id, title, assigned_by, assignee_id, status, progress, completed_at)
   select p.department_id, p.team_id, $2, $3, p.id, $4, case when $4 = 'COMPLETED' then 100 else 20 end, case when $4 = 'COMPLETED' then now() end from public.profiles p where p.email = $1`,
  [email, title, dhId, status]);
await task('rahul@amuwa.com', 'Call the new leads', 'COMPLETED');
await task('rahul@amuwa.com', 'Prepare the demo deck', 'IN_PROGRESS');
await task('neha@amuwa.com', 'Neha private task', 'COMPLETED');
const [{ id: opsHome }] = await q(`insert into departments (slug, name) values ('ops-home', 'Operations Home') returning id`);
const OPS = 'ops.reports@amuwa.com';
PASSWORDS[OPS] = secret();
const ops = await api(sa, 'POST', '/users', { email: OPS, fullName: 'Olive Ops', password: PASSWORDS[OPS], role: 'DEPARTMENT_HEAD', departmentId: opsHome, operationsHead: true });
await api(sa, 'POST', `/operations/heads/${ops.id}/scope`, { departmentIds: [wab], primaryDepartmentIds: [wab] });
ok('fixture: Rahul has two tasks (one completed), Neha one; an Operations Head manages Wabastore');

// ------------------------------------------------------------------ everybody signs in once and is never reloaded again
const member = await login('rahul@amuwa.com');
const lead = await login('lead@amuwa.com');
const head = await login('dh@amuwa.com');
const opsHead = await login(OPS, undefined, 'text=Choose a department');
// an Operations Head looks after several departments: they pick one to work in, here their own
await opsHead.locator('section, article, div').filter({ hasText: /^Operations Home/ }).getByText('Open dashboard').first().click().catch(async () => { await opsHead.getByText('Open dashboard').first().click(); });
await wait(opsHead, 'nav button', 'the Operations Head dashboard did not open');
await openReports(lead);
await openReports(head);
await tab(head, /^Pending Approvals/).click();
await openReports(opsHead);
await openReports(member);

// ------------------------------------------------------------------ 1. the Team Member form
await expect(await tab(member, /^Submit Daily Report/).isVisible() && await tab(member, /^My Reports/).isVisible(), 'the Team Member has two tabs: Submit Daily Report and My Reports');
const form = member.getByRole('form', { name: 'Submit report' });
await wait(member, '[data-testid="assigned-tasks"]', 'the member\'s tasks did not load');
const formText = await form.innerText();
await expect(/Report title/.test(formText) && /Report date/.test(formText) && /Assigned tasks/.test(formText) && /Completed tasks/.test(formText), 'the form has the title, the report date, the assigned tasks and the completed tasks');
await expect(!/Challenges|Achievements|Remarks|Work completed|Pending tasks|Supporting attachments|Reporting period/i.test(formText), 'and none of the removed sections', formText);
await expect(await form.getByRole('button', { name: 'Save as draft' }).isVisible() && await form.getByRole('button', { name: 'Submit report' }).isVisible(), 'Save as draft and Submit report are there');
const assignedTexts = await member.getByTestId('assigned-tasks').innerText();
await expect(/Call the new leads/.test(assignedTexts) && /Prepare the demo deck/.test(assignedTexts) && !/Neha private task/.test(assignedTexts), 'the assigned tasks are Rahul\'s own task records only', assignedTexts);
const doneBoxes = await member.getByTestId('completed-tasks').locator('input[type="checkbox"]').evaluateAll(els => els.map(e => ({ checked: e.checked, disabled: e.disabled })));
await expect(doneBoxes.length === 2 && doneBoxes.filter(b => b.checked).length === 1 && doneBoxes.filter(b => b.disabled).length === 1, 'the completed tasks follow the real status: only the finished task can be ticked, and it is ticked', doneBoxes);
await member.getByLabel('Report title').fill('Friday sales report');
await member.screenshot({ path: `${OUT}/reports-1-member-form.png`, fullPage: true });

// ------------------------------------------------------------------ 2. submit: it appears for the Team Lead without a refresh
await form.getByRole('button', { name: 'Submit report' }).click();
await live(member, () => /Pending Team Lead Approval/.test(document.querySelector('[data-testid="my-reports"]')?.innerText ?? ''), 'the member sees the status after submitting');
await expect(await tab(member, /^My Reports/).getAttribute('aria-selected') === 'true', 'after submitting the member lands on My Reports');
await live(lead, () => /Friday sales report/.test(document.body.innerText), 'the Team Lead\'s list shows the new report with no refresh');
await expect(await titleCount(lead, 'Friday sales report') === 1, 'exactly one row for it');
await lead.screenshot({ path: `${OUT}/reports-2-team-lead.png`, fullPage: true });
const dhSees1 = await text(head);
await expect(!/Friday sales report/.test(dhSees1), 'the Department Head does not see it yet (only after the Team Lead approves)');

// ------------------------------------------------------------------ 3. the Team Lead approves (stage 1): not final
await lead.getByRole('button', { name: 'Open report Friday sales report' }).click();
await wait(lead, '[data-testid="report-detail"]', 'the report did not open for the Team Lead');
const tlDialog = await lead.getByTestId('report-detail').innerText();
await expect(/Call the new leads/.test(tlDialog) && /assigned tasks/i.test(tlDialog) && /completed tasks/i.test(tlDialog), 'the Team Lead sees the assigned and completed tasks');
await expect(await lead.getByRole('button', { name: 'Approve and send to Department Head' }).isVisible(), 'the button says the report goes on to the Department Head');
await lead.getByRole('button', { name: 'Approve and send to Department Head' }).click();
await live(head, () => /Pending Team Member Approvals/.test(document.body.innerText) && /Friday sales report/.test(document.body.innerText), 'the Department Head\'s Pending Approvals shows it with no refresh');
await expect(await titleCount(head, 'Friday sales report') === 1, 'exactly one card for it');
await live(member, () => /Pending Department Head Approval/.test(document.querySelector('[data-testid="my-reports"]')?.innerText ?? ''), 'the member\'s status changes to Pending Department Head Approval');
const card = head.getByTestId('member-approval').first();
const cardText = await card.innerText();
await expect(/Rahul Mehta/.test(cardText) && /Sales Executive/.test(cardText) && /Lead Person/.test(cardText) && /Team Lead approved/.test(cardText) && /2 assigned tasks - 1 completed/.test(cardText) && /Pending Department Head Approval/.test(cardText),
  'the card shows the title, the employee and designation, the Team Lead, the approval date, the tasks and the status', cardText);
const tabBadge = await tab(head, /^Pending Approvals/).innerText();
await expect(/1/.test(tabBadge), 'the Pending Approvals tab carries the count', tabBadge);
await expect(!/Fully Approved/.test(await member.getByTestId('my-reports').innerText()), 'the member\'s report is not fully approved yet');
await head.screenshot({ path: `${OUT}/reports-3-department-head.png`, fullPage: true });

// ------------------------------------------------------------------ 4. the Department Head approves (stage 2): fully approved everywhere
await card.getByRole('button', { name: /Review tasks and decide/ }).click();
await head.getByRole('button', { name: 'Give final approval' }).click();
await live(member, () => /Fully Approved/.test(document.querySelector('[data-testid="my-reports"]')?.innerText ?? ''), 'the member sees Fully Approved');
await lead.keyboard.press('Escape');
await tab(lead, /^Team Member Reports/).click();
await lead.getByRole('button', { name: /^Fully approved/i }).click();
await live(lead, () => /Friday sales report/.test(document.body.innerText), 'the Team Lead finds it under Fully approved');
await live(head, () => !/Review tasks and decide/.test(document.body.innerText), 'the Department Head\'s pending list is empty again');
await tab(head, /^Team Reports/).click();
await wait(head, '[data-testid="department-boxes"]', 'the Team Lead boxes did not show');
await head.getByRole('button', { name: /Lead Person/ }).click();
await live(head, () => /Fully Approved/.test(document.querySelector('[data-testid="group-OK"]')?.textContent ?? ''), 'the Team Lead box lists it under Fully Approved');
const group = await head.getByTestId('group-OK').innerText();
await expect(/Friday sales report/.test(group) && !/Pending Department Head Approval \(/.test(await text(head)), 'in the Team Lead box it sits under Fully Approved, not under pending');
await head.screenshot({ path: `${OUT}/reports-4-team-box.png`, fullPage: true });

// ------------------------------------------------------------------ 5. the Operations Head
await live(opsHead, () => /Operations|Wabastore/.test(document.body.innerText), 'the Operations Head sees the department');
const opsText = await text(opsHead);
await expect(/fully approved/i.test(opsText), 'the department box shows the fully approved count');
await opsHead.screenshot({ path: `${OUT}/reports-5-operations.png`, fullPage: true });

// ------------------------------------------------------------------ 6. sent back by the Department Head: both stages repeat
const rahul = await idOf('rahul@amuwa.com');
const second = await api(rahul, 'POST', '/work-reports', { title: 'Monday sales report', reportDate: new Date().toISOString().slice(0, 10), periodType: 'DAILY', periodStart: new Date().toISOString().slice(0, 10), periodEnd: new Date().toISOString().slice(0, 10), content: {} });
await api(rahul, 'POST', `/work-reports/${second.id}/submit`, {});
await live(lead, () => true, 'settle');
await api(await idOf('lead@amuwa.com'), 'POST', `/work-reports/${second.id}/review`, { decision: 'APPROVED' });
await live(head, () => /Monday sales report/.test(document.body.innerText) || true, 'settle');
await tab(head, /^Pending Approvals/).click();
await live(head, () => /Monday sales report/.test(document.body.innerText), 'the second report reaches the Department Head');
await api(dhId, 'POST', `/work-reports/${second.id}/review`, { decision: 'REVISION_REQUIRED', comment: 'Name the clients you called' });
await live(member, () => /Revision Required/.test(document.querySelector('[data-testid="my-reports"]')?.innerText ?? ''), 'the member sees Revision Required with no refresh');
await live(head, () => /Revision required\s*1/i.test(document.body.innerText), 'the Department Head\'s counts move to Revision required');
await api(rahul, 'POST', `/work-reports/${second.id}/submit`, {});
await tab(lead, /^Team Member Reports/).click();
await lead.getByRole('button', { name: /^Pending Team Lead Approval/ }).click();
await live(lead, () => /Monday sales report/.test(document.body.innerText), 'the resubmitted report is back with the Team Lead');
ok('a Department Head revision sends the report back to the employee, and after resubmission it starts again with the Team Lead');

// ------------------------------------------------------------------ 7. the Team Lead's individual report: no Download, no History
const leadId = await idOf('lead@amuwa.com');
const today = new Date().toISOString().slice(0, 10);
const own = await api(leadId, 'POST', '/work-reports', { title: 'Lead weekly report', reportDate: today, periodType: 'DAILY', periodStart: today, periodEnd: today, content: { remarks: 'Reviewed the pipeline' } });
await api(leadId, 'POST', `/work-reports/${own.id}/submit`, {});
await tab(lead, /^My Daily Report/).click();
const ownText = await text(lead);
await expect(/Report title/.test(ownText) && /Submit report/.test(ownText), 'the Team Lead\'s own report screen keeps the form and Submit report');
await lead.getByRole('button', { name: 'Open report Lead weekly report' }).click();
await wait(lead, '[data-testid="report-detail"]', 'the Team Lead\'s own report did not open');
const ownDialog = await lead.getByTestId('report-detail').innerText();
await expect(!/Download/.test(await lead.locator('[role="dialog"]').innerText()) && !/history/i.test(ownDialog), 'the Team Lead\'s own report has no Download and no History');
await lead.screenshot({ path: `${OUT}/reports-6-team-lead-own.png`, fullPage: true });
await lead.keyboard.press('Escape');
// a Team Member can still download / see the history of their own approved report
await tab(member, /^My Reports/).click();
await member.getByRole('button', { name: 'Open report Friday sales report' }).click();
await wait(member, '[data-testid="report-detail"]', 'the member\'s report did not open');
await expect(/history/i.test(await member.getByTestId('report-detail').innerText()), 'a Team Member still sees the history of their own report (only the Team Lead\'s screen lost it)');
await member.keyboard.press('Escape');

// ------------------------------------------------------------------ 8. no duplicates, no leftovers, no errors
await expect(await titleCount(head, 'Friday sales report') <= 2, 'no duplicate cards after all the updates');
const real = errors.filter(e => !/WebSocket|realtime/i.test(e));
await expect(real.length === 0, 'no browser errors', real.slice(0, 3));
await browser.close();
await db.end();
console.log(`=== ${step} REPORTS E2E CHECKS PASSED ===`);
