// Raise an Issue (Team Member, Team Lead, Department Head: one page, one workflow) and HR's two sections (Employee Issues, Meeting Requests),
// real browsers against the local stack (Postgres + PostgREST + gateway + the web app). No credentials live in this file: staff passwords come
// from E2E_PASSWORDS (made up by the runner) and the two HR accounts made here get passwords made up at run time.
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
const fail = async m => { await current?.screenshot({ path: `${OUT}/issues-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m, errors.length ? JSON.stringify(errors.slice(0, 4)) : ''); process.exit(1); };
const expect = (c, m) => (c ? ok(m) : fail(m));
process.on('uncaughtException', e => fail(`an unexpected error: ${String(e.message).split('\n').slice(0, 4).join(' | ')}`));
process.on('unhandledRejection', e => fail(`an unexpected error: ${String(e?.message ?? e).split('\n').slice(0, 4).join(' | ')}`));
const open = async (viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
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
const wait = async (p, sel, m, t = 12000) => { current = p; await p.waitForSelector(sel, { timeout: t }).catch(() => fail(m)); };
const gone = async (p, sel, m, t = 12000) => { current = p; await p.waitForSelector(sel, { state: 'detached', timeout: t }).catch(() => fail(m)); };
const narrow = p => (p.viewportSize()?.width ?? 1440) < 1024;
const menuItem = (p, label) => p.locator('nav button').filter({ has: p.locator('span', { hasText: new RegExp(`^${label}$`) }) }).first();
const menu = async (p, label) => {
  if (narrow(p)) { await p.getByRole('button', { name: 'Toggle menu' }).click(); await new Promise(r => setTimeout(r, 400)); }
  // the dashboards' own menus are buttons inside <nav>; the HR department's menu is a plain list of buttons
  const dash = menuItem(p, label);
  if (await dash.count()) await dash.click(); else await p.getByRole('button', { name: label, exact: true }).first().click();
};
const navLabels = async p => (await p.locator('button').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
const openRaise = async p => { await menu(p, 'Raise an Issue'); await wait(p, '[data-testid="raise-issue-page"]', 'the Raise an Issue page did not open'); };

// narrows a table by search text and opens the one row whose text contains `needle` (waits for the debounced search to apply)
const openRow = async (p, searchTestId, rowTestId, openTestId, text, needle) => {
  await p.getByTestId(searchTestId).fill(text);
  await p.waitForFunction(([row, n]) => { const rows = [...document.querySelectorAll(`[data-testid="${row}"]`)]; return rows.length === 1 && rows[0].innerText.includes(n); }, [rowTestId, needle], { timeout: 10000 }).catch(() => fail(`the table did not narrow to ${needle}`));
  await p.getByTestId(openTestId).click();
};
const overflow = p => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const tag = crypto.randomBytes(3).toString('hex');
const day = n => { const d = new Date(Date.now() + n * 86400e3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n% e2e issue file\n'), Buffer.alloc(1500, 0x20), Buffer.from('\n%%EOF\n')]);
fs.writeFileSync('/tmp/issue-slip.pdf', PDF);

// ------------------------------------------------------------------ fixture: two HR accounts (the seed has none)
const sa = await idOf('root@amuwa.com');
const hrDept = (await q(`select id from departments where slug = 'hr'`))[0].id;
const hrTeam = (await q(`select id from teams where department_id = $1 order by created_at limit 1`, [hrDept]))[0].id;
const HR_HEAD = 'hr.head.issues@amuwa.com', HR_MEMBER = 'hr.member.issues@amuwa.com';
PASSWORDS[HR_HEAD] = secret(); PASSWORDS[HR_MEMBER] = secret();
await api(sa, 'POST', '/users', { email: HR_HEAD, fullName: 'Hema Head', password: PASSWORDS[HR_HEAD], role: 'DEPARTMENT_HEAD', departmentId: hrDept });
await api(sa, 'POST', '/users', { email: HR_MEMBER, fullName: 'Harsh Member', password: PASSWORDS[HR_MEMBER], role: 'TEAM_MEMBER', teamId: hrTeam });
const hrMemberId = await idOf(HR_MEMBER);
ok('HR accounts exist (an HR Department Head and an HR Team Member)');

// ------------------------------------------------------------------ 1. the Team Member: Raise an Issue
const TM = await login('rahul@amuwa.com');
let labels = await navLabels(TM);
await expect(labels.some(l => /^Raise an Issue$/.test(l)), 'a Team Member has "Raise an Issue" in the sidebar');
await expect(!labels.some(l => /Employee Issues|Meeting Requests/.test(l)), 'and no HR section');
await openRaise(TM);
await expect((await TM.getByTestId('case-type').locator('option').allInnerTexts()).join('|') === 'Raise an Issue|Meeting Request', 'the selector at the top offers Raise an Issue and Meeting Request');
await TM.waitForFunction(() => /Rahul Mehta/.test(document.querySelector('[data-testid="my-details"]')?.innerText ?? ''), null, { timeout: 10000 }).catch(() => fail('the employee details did not load'));
const det = await TM.getByTestId('my-details').innerText();
await expect(/Rahul Mehta/.test(det) && /Sales Executive/.test(det) && /Wabastore/i.test(det) && !/EMP-|Employee ID/i.test(det), 'the employee\'s name, department and designation are shown from the profile (not typed), and no employee ID');
await expect(await TM.locator('#issue-title').count() === 1 && await TM.locator('input[name="employee"], #employee-name').count() === 0, 'the issue form asks nothing the profile already knows');
// the whole form: the fields of the specification
const cats = await TM.locator('#issue-category option').allInnerTexts();
await expect(JSON.stringify(cats.slice(1)) === JSON.stringify(['Workplace Issue', 'HR or Policy Concern', 'Attendance or Leave', 'Salary or Payroll', 'Team or Management Concern', 'Technical or System Issue', 'Workplace Facilities', 'Other']), 'the issue categories are the eight of the specification', cats);
await expect((await TM.locator('#issue-priority option').allInnerTexts()).join('|') === 'Low|Medium|High|Urgent', 'priorities: Low, Medium, High, Urgent');
await expect(await TM.getByText('Preferred Resolution or Additional Comments (optional)').count() === 1 && await TM.getByText('Attachment (optional)').count() === 1, 'optional resolution / comments and attachment fields exist');
// validation
await TM.getByTestId('submit-issue').click();
await wait(TM, '#issue-title-error', 'empty submit should show field errors');
await expect(await TM.locator('#issue-category-error').count() === 1 && await TM.locator('#issue-description-error').count() === 1, 'submitting an empty form shows what is missing, and sends nothing');
await expect((await q(`select count(*)::int n from employee_issues`))[0].n === 0, 'nothing was saved by the empty submit');
// a file with a disallowed type is refused in the browser
fs.writeFileSync('/tmp/issue-bad.exe', 'MZ not allowed');
await TM.locator('input[type="file"]').setInputFiles('/tmp/issue-bad.exe');
await wait(TM, '.tf-error', 'a .exe attachment should be refused');
ok('an executable cannot be attached (refused before upload)');
await TM.locator('#issue-title').fill(`Air conditioning ${tag}`);
await TM.locator('#issue-category').selectOption('FACILITIES');
await TM.locator('#issue-priority').selectOption('HIGH');
await TM.locator('#issue-description').fill('The air conditioning on our floor has not worked for a week.');
await TM.locator('#issue-resolution').fill('Please send a technician.');
await TM.locator('input[type="file"]').setInputFiles('/tmp/issue-slip.pdf');
await wait(TM, '.tf-staged li:not(.busy)', 'the PDF did not finish uploading');
await TM.screenshot({ path: `${OUT}/issues-1-form-desktop.png`, fullPage: true });
await TM.getByTestId('submit-issue').click();
await wait(TM, '[data-testid="submitted-banner"]', 'the submit confirmation did not show');
const ref1 = (await TM.getByTestId('submitted-reference').innerText()).trim();
await expect(/^ISS-\d{4}-\d{5}$/.test(ref1), `a confirmation with the reference number (${ref1})`);
await wait(TM, `[data-testid="my-case-row"]:has-text("${ref1}")`, 'the issue is not in the history');
ok('the issue appears in the employee\'s own history');
const row1 = (await q(`select * from employee_issues where issue_reference = $1`, [ref1]))[0];
await expect(row1 && row1.status === 'NEW' && row1.priority === 'HIGH' && row1.employee_name === 'Rahul Mehta' && /^EMP-/.test(row1.employee_code) && row1.designation === 'Sales Executive', 'the database holds it with the employee\'s details from the profile and status New', row1);
await expect((await q(`select count(*)::int n from employee_issue_attachments where issue_id = $1 and status = 'READY'`, [row1.id]))[0].n === 1, 'with its attachment (private bucket)');
await TM.reload();
await openRaise(TM);
await wait(TM, `[data-testid="my-case-row"]:has-text("${ref1}")`, 'after a reload the issue is still in the history');
ok('and it is still there after a reload');

// ------------------------------------------------------------------ 2. the same page: Meeting Request
await TM.getByTestId('case-type').selectOption('MEETING');
await wait(TM, '[data-testid="meeting-form"]', 'the meeting form did not appear');
await expect(await TM.locator('[data-testid="issue-form"]').count() === 0, 'the selector switches the form on the same page (the issue form is gone)');
await expect((await TM.locator('#meeting-category option').allInnerTexts()).slice(1).join('|') === 'HR Concern|Workplace Issue|Attendance or Leave|Salary or Payroll|Management Discussion|Personal or Confidential Concern|Other', 'meeting categories are the seven of the specification');
await expect((await TM.locator('#meeting-mode option').allInnerTexts()).slice(1).join('|') === 'In Person|Online', 'meeting modes: In Person or Online');
await TM.getByTestId('submit-meeting').click();
await wait(TM, '#meeting-subject-error', 'an empty meeting request should show errors');
await expect(await TM.locator('#meeting-date-error').count() === 1 && await TM.locator('#meeting-time-error').count() === 1 && await TM.locator('#meeting-mode-error').count() === 1, 'an empty meeting request shows what is missing');
await TM.locator('#meeting-subject').fill(`Leave balance ${tag}`);
await TM.locator('#meeting-category').selectOption('ATTENDANCE_LEAVE');
await TM.locator('#meeting-mode').selectOption('IN_PERSON');
await TM.locator('#meeting-date').fill(day(3));
await TM.locator('#meeting-time').fill('10:30');
await TM.locator('#meeting-description').fill('I would like to understand my leave balance for this year.');
await TM.getByTestId('submit-meeting').click();
await wait(TM, '[data-testid="submitted-banner"]', 'the meeting confirmation did not show');
const mref1 = (await TM.getByTestId('submitted-reference').innerText()).trim();
await expect(/^MTG-\d{4}-\d{5}$/.test(mref1) && /HR will review/.test(await TM.getByTestId('submitted-banner').innerText()), `a confirmation with the meeting reference (${mref1}), saying HR must confirm`);
await wait(TM, `[data-testid="my-case-row"]:has-text("${mref1}")`, 'the meeting request is not in the history');
await expect(/Pending/.test(await TM.locator(`[data-testid="my-case-row"]:has-text("${mref1}")`).innerText()), 'it is Pending (a request is not a confirmed meeting)');
const mrow1 = (await q(`select * from employee_meeting_requests where meeting_reference = $1`, [mref1]))[0];
await expect(mrow1.status === 'PENDING' && mrow1.confirmed_date === null && mrow1.employee_name === 'Rahul Mehta', 'the database holds it as Pending with no confirmed date');
await TM.screenshot({ path: `${OUT}/issues-2-meeting-desktop.png`, fullPage: true });

// ------------------------------------------------------------------ 3. the Team Lead and the Department Head use the same page
const TL = await login('lead@amuwa.com');
labels = await navLabels(TL);
await expect(labels.some(l => /^Raise an Issue$/.test(l)), 'a Team Lead has "Raise an Issue" in the sidebar');
await openRaise(TL);
await expect((await TL.getByTestId('case-type').locator('option').allInnerTexts()).join('|') === 'Raise an Issue|Meeting Request', 'the Team Lead has the same selector');
await TL.locator('#issue-title').fill(`Payroll amount ${tag}`);
await TL.locator('#issue-category').selectOption('SALARY_PAYROLL');
await TL.locator('#issue-priority').selectOption('URGENT');
await TL.locator('#issue-description').fill('My last salary slip does not match my attendance record.');
await TL.getByTestId('submit-issue').click();
await wait(TL, '[data-testid="submitted-banner"]', 'the Team Lead\'s confirmation did not show');
const ref2 = (await TL.getByTestId('submitted-reference').innerText()).trim();
await TL.getByTestId('case-type').selectOption('MEETING');
await TL.locator('#meeting-subject').fill(`Team workload ${tag}`);
await TL.locator('#meeting-category').selectOption('MANAGEMENT');
await TL.locator('#meeting-mode').selectOption('ONLINE');
await TL.locator('#meeting-date').fill(day(5));
await TL.locator('#meeting-time').fill('15:00');
await TL.locator('#meeting-description').fill('I need to discuss the workload of my team with HR.');
await TL.getByTestId('submit-meeting').click();
await wait(TL, '[data-testid="submitted-banner"]', 'the Team Lead\'s meeting confirmation did not show');
const mref2 = (await TL.getByTestId('submitted-reference').innerText()).trim();
ok(`the Team Lead raised an issue (${ref2}) and requested a meeting (${mref2})`);

const DH = await login('dh@amuwa.com');
labels = await navLabels(DH);
await expect(labels.some(l => /^Raise an Issue$/.test(l)), 'a Department Head has "Raise an Issue" in the sidebar');
await openRaise(DH);
await expect((await DH.getByTestId('case-type').locator('option').allInnerTexts()).join('|') === 'Raise an Issue|Meeting Request', 'the Department Head has the same selector');
await DH.locator('#issue-title').fill(`Meeting room booking ${tag}`);
await DH.locator('#issue-category').selectOption('FACILITIES');
await DH.locator('#issue-description').fill('We cannot book the meeting room for client calls.');
await DH.getByTestId('submit-issue').click();
await wait(DH, '[data-testid="submitted-banner"]', 'the Department Head\'s confirmation did not show');
const ref3 = (await DH.getByTestId('submitted-reference').innerText()).trim();
await DH.getByTestId('case-type').selectOption('MEETING');
await DH.locator('#meeting-subject').fill(`Confidential matter ${tag}`);
await DH.locator('#meeting-category').selectOption('PERSONAL_CONFIDENTIAL');
await DH.locator('#meeting-mode').selectOption('IN_PERSON');
await DH.locator('#meeting-date').fill(day(2));
await DH.locator('#meeting-time').fill('11:00');
await DH.locator('#meeting-description').fill('A confidential matter that I would like to discuss in person.');
await DH.getByTestId('submit-meeting').click();
await wait(DH, '[data-testid="submitted-banner"]', 'the Department Head\'s meeting confirmation did not show');
const mref3 = (await DH.getByTestId('submitted-reference').innerText()).trim();
ok(`the Department Head raised an issue (${ref3}) and requested a meeting (${mref3})`);
await expect((await q(`select count(*)::int n from employee_issues`))[0].n === 3 && (await q(`select count(*)::int n from employee_meeting_requests`))[0].n === 3, 'three issues and three meeting requests are stored, one pair per role');

// ------------------------------------------------------------------ 4. HR: two separate sidebar sections
const HR = await login(HR_HEAD, undefined, 'button:has-text("Employee Issues")');
labels = await navLabels(HR);
await expect(labels.includes('Employee Issues') && labels.includes('Meeting Requests') && labels.indexOf('Employee Issues') !== labels.indexOf('Meeting Requests'), 'the HR sidebar has two separate items: Employee Issues and Meeting Requests');
await expect(!labels.some(l => /^Raise an Issue$/.test(l)), 'and no Raise an Issue item (HR works the cases)');
await menu(HR, 'Employee Issues');
await wait(HR, '[data-testid="employee-issues-page"]', 'the Employee Issues page did not open');
await wait(HR, '[data-testid="issue-row"]', 'the issue table is empty');
const stat = async (p, label) => Number((await p.getByTestId(`stat-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`).locator('div').nth(1).innerText()).replace(/[^0-9]/g, ''));
await expect(await stat(HR, 'Total Issues') === 3 && await stat(HR, 'New Issues') === 3 && await stat(HR, 'In Progress') === 0 && await stat(HR, 'Resolved') === 0 && await stat(HR, 'Urgent Issues') === 1, 'the summary cards count the database: 3 issues, 3 new, 0 in progress, 0 resolved, 1 urgent');
await expect((await HR.getByTestId('issue-row').count()) === 3, 'the table lists the issues of all three roles');
const tableText = (await HR.getByTestId('issues-table').innerText()).toLowerCase();
await expect(['reference', 'employee', 'department', 'designation', 'issue', 'category', 'priority', 'submitted', 'assigned hr', 'status', 'action'].every(h => tableText.includes(h)) && /rahul mehta/.test(tableText) && /lead person/.test(tableText) && /dev head/.test(tableText), 'the table has the columns of the specification and the three employees');
await expect(/sales executive/.test(tableText) && /team lead/.test(tableText) && /department head/.test(tableText), 'with their designations');
await HR.screenshot({ path: `${OUT}/issues-3-hr-issues.png`, fullPage: true });
// filters and search
await HR.getByTestId('issue-search').fill('Rahul');
await HR.waitForFunction(() => document.querySelectorAll('[data-testid="issue-row"]').length === 1 && /Rahul Mehta/.test(document.querySelector('[data-testid="issue-row"]').innerText), null, { timeout: 10000 }).catch(() => fail('search by employee name did not narrow the table'));
ok('search by employee name narrows the table');
await HR.getByTestId('issue-search').fill(ref2);
await HR.waitForFunction(r => document.querySelectorAll('[data-testid="issue-row"]').length === 1 && document.querySelector('[data-testid="issue-row"]').innerText.includes(r), ref2, { timeout: 10000 }).catch(() => fail('search by reference did not narrow the table'));
ok('search by issue reference works');
await HR.getByTestId('issue-search').fill('');
await HR.getByTestId('filter-priority').selectOption('URGENT');
await HR.waitForFunction(() => document.querySelectorAll('[data-testid="issue-row"]').length === 1, null, { timeout: 10000 }).catch(() => fail('the priority filter did not narrow the table'));
ok('the priority filter works');
await HR.getByTestId('filter-priority').selectOption('');
await HR.getByTestId('filter-category').selectOption('FACILITIES');
await HR.waitForFunction(() => document.querySelectorAll('[data-testid="issue-row"]').length === 2, null, { timeout: 10000 }).catch(() => fail('the category filter did not narrow the table'));
ok('the category filter works');
await HR.getByTestId('filter-category').selectOption('');
await HR.getByTestId('tab-IN_PROGRESS').click();
await wait(HR, '[data-testid="issues-empty"]', 'the In Progress tab should be empty');
ok('the In Progress tab is empty (nothing is in progress yet) and says so');
await HR.getByTestId('tab-ALL').click();
await HR.getByTestId('filter-from').fill(day(1));
await wait(HR, '[data-testid="issues-empty"]', 'a date range after today should match nothing');
ok('the date range filter works');
await HR.getByTestId('filter-from').fill('');
await wait(HR, '[data-testid="issue-row"]', 'clearing the filters should bring the rows back');

// open the Team Member's issue: details, attachment, assign, respond, note
await openRow(HR, 'issue-search', 'issue-row', 'open-issue', 'Air conditioning', ref1);
await wait(HR, '[data-testid="hr-issue-detail"]', 'the issue detail did not open');
await expect(/air conditioning on our floor/.test(await HR.getByTestId('issue-description').innerText()) && /Rahul Mehta/.test(await HR.getByTestId('hr-issue-detail').innerText()), 'HR sees the full description and the employee\'s details');
await expect(await HR.getByRole('button', { name: /Open issue-slip\.pdf/ }).count() === 1 || await HR.locator('.tf-files li').count() === 1, 'HR sees the attachment');
await HR.getByTestId('assign-select').selectOption(hrMemberId);
await HR.getByTestId('assign-button').click();
await HR.waitForFunction(() => /In Progress/.test(document.querySelector('[data-testid="hr-issue-detail"]')?.innerText ?? ''), null, { timeout: 10000 }).catch(() => fail('assigning should open the issue (In Progress)'));
ok('HR assigns the issue to an HR team member (it becomes In Progress)');
await HR.getByTestId('note-text').fill('INTERNAL-NOTE check the maintenance contract first');
await HR.getByTestId('add-note').click();
await wait(HR, '[data-kind="NOTE"]', 'the internal note is not in the history');
await expect(/HR only/.test(await HR.locator('[data-kind="NOTE"]').innerText()), 'the internal note is in the history, marked HR only');
await HR.getByTestId('response-text').fill('Which floor are you on, and since when exactly?');
await HR.getByTestId('request-info').click();
await HR.waitForFunction(() => /Awaiting Employee Response/.test(document.querySelector('[data-testid="hr-issue-detail"]')?.innerText ?? ''), null, { timeout: 10000 }).catch(() => fail('requesting information should wait for the employee'));
ok('HR asks the employee for more information (Awaiting Employee Response)');
await HR.screenshot({ path: `${OUT}/issues-4-hr-issue-detail.png`, fullPage: true });
await HR.getByRole('button', { name: 'Close' }).last().click();
await expect(await stat(HR, 'In Progress') === 0 && (await q(`select status from employee_issues where id = $1`, [row1.id]))[0].status === 'AWAITING_EMPLOYEE', 'the database holds the new status');

// ------------------------------------------------------------------ 5. the employee sees HR's response, not the internal note, and replies
await TM.reload();
await openRaise(TM);
await TM.locator(`[data-testid="my-case-row"]:has-text("${ref1}")`).click();
await wait(TM, '[data-testid="issue-detail"]', 'the employee\'s issue detail did not open');
const mine = await TM.getByTestId('issue-detail').innerText();
await expect(/Waiting for your reply/.test(mine) && /Which floor are you on/.test(mine) && /Harsh Member/.test(mine), 'the employee sees the status, HR\'s response and who handles it');
await expect(!/INTERNAL-NOTE|maintenance contract/.test(mine), 'but never the internal note');
await TM.screenshot({ path: `${OUT}/issues-5-employee-issue-detail.png`, fullPage: true });
await TM.locator('#issue-reply').fill('Third floor, since Monday morning.');
await TM.getByTestId('send-reply').click();
await TM.waitForFunction(() => /Third floor/.test(document.querySelector('[data-testid="issue-detail"]')?.innerText ?? ''), null, { timeout: 10000 }).catch(() => fail('the reply is not in the history'));
await expect((await q(`select status from employee_issues where id = $1`, [row1.id]))[0].status === 'IN_PROGRESS', 'the employee\'s reply puts the issue back In Progress');
await TM.getByRole('button', { name: 'Close' }).first().click();
// notifications reached the right people
await expect((await q(`select count(*)::int n from notifications where type = 'EMPLOYEE_ISSUE_UPDATED' and recipient_id = $1`, [await idOf('rahul@amuwa.com')]))[0].n >= 2, 'the employee was notified of HR\'s updates (in the notification centre)');
await expect((await q(`select count(*)::int n from notifications where type = 'EMPLOYEE_ISSUE_SUBMITTED' and recipient_id = $1`, [await idOf(HR_HEAD)]))[0].n === 3, 'HR was notified of each submission once');

// resolve with a confirmation, then close
await openRow(HR, 'issue-search', 'issue-row', 'open-issue', 'Air conditioning', ref1);
await wait(HR, '[data-testid="hr-issue-detail"]', 'reopening the issue failed');
await HR.getByTestId('status-select').selectOption('RESOLVED');
await HR.locator('#status-message').fill('A technician fixed it today.');
await HR.getByTestId('status-button').click();
await wait(HR, '[data-testid="confirm-status"]', 'resolving should ask for a confirmation');
await HR.getByTestId('confirm-status').click();
await HR.waitForFunction(() => /Resolved/.test(document.querySelector('[data-testid="hr-issue-detail"]')?.innerText ?? ''), null, { timeout: 10000 }).catch(() => fail('the issue should be Resolved'));
ok('HR resolves the issue after a confirmation');
await HR.getByTestId('status-select').selectOption('CLOSED');
await HR.getByTestId('status-button').click();
await wait(HR, '[data-testid="confirm-status"]', 'closing should ask for a confirmation');
await HR.getByRole('button', { name: 'Not yet' }).click();
await expect((await q(`select status from employee_issues where id = $1`, [row1.id]))[0].status === 'RESOLVED', 'declining the confirmation changes nothing');
await HR.getByTestId('status-button').click();
await HR.getByTestId('confirm-status').click();
await HR.waitForFunction(() => /Closed/.test(document.querySelector('[data-testid="hr-issue-detail"]')?.innerText ?? ''), null, { timeout: 10000 }).catch(() => fail('the issue should be Closed'));
await expect(await HR.getByTestId('response-text').isDisabled() && await HR.getByTestId('status-select').isDisabled(), 'a closed issue cannot be changed or answered');
await HR.getByRole('button', { name: 'Close' }).last().click();
await TM.reload();
await openRaise(TM);
await TM.locator(`[data-testid="my-case-row"]:has-text("${ref1}")`).click();
await wait(TM, '[data-testid="issue-detail"]', 'the employee\'s issue detail did not reopen');
await expect(/Closed/.test(await TM.getByTestId('issue-detail').innerText()) && /A technician fixed it today/.test(await TM.getByTestId('hr-response').innerText()) && await TM.locator('#issue-reply').count() === 0, 'the employee sees it closed with HR\'s last response, and no reply box');
await TM.getByRole('button', { name: 'Close' }).first().click();

// ------------------------------------------------------------------ 6. HR: Meeting Requests
await menu(HR, 'Meeting Requests');
await wait(HR, '[data-testid="meeting-requests-page"]', 'the Meeting Requests page did not open');
await wait(HR, '[data-testid="meeting-row"]', 'the meeting table is empty');
await expect(await stat(HR, 'Total Requests') === 3 && await stat(HR, 'Pending Approval') === 3 && await stat(HR, 'Approved / Scheduled') === 0 && await stat(HR, 'Completed') === 0 && await stat(HR, 'Declined or Cancelled') === 0, 'the meeting cards count the database: 3 requests, all pending');
const mtext = (await HR.getByTestId('meetings-table').innerText()).toLowerCase();
await expect(['reference', 'employee', 'department', 'subject', 'category', 'preferred date', 'preferred time', 'mode', 'requested', 'assigned hr', 'status', 'action'].every(h => mtext.includes(h)) && /rahul mehta/.test(mtext) && /lead person/.test(mtext) && /dev head/.test(mtext), 'the table has the columns of the specification and the requests of the three roles');
await HR.screenshot({ path: `${OUT}/issues-6-hr-meetings.png`, fullPage: true });
await HR.getByTestId('meeting-search').fill(mref1);
await HR.waitForFunction(() => document.querySelectorAll('[data-testid="meeting-row"]').length === 1, null, { timeout: 10000 }).catch(() => fail('search by meeting reference did not narrow the table'));
ok('search by meeting reference works');
await HR.getByTestId('meeting-search').fill('');
await HR.getByTestId('filter-category').selectOption('PERSONAL_CONFIDENTIAL');
await HR.waitForFunction(() => document.querySelectorAll('[data-testid="meeting-row"]').length === 1, null, { timeout: 10000 }).catch(() => fail('the meeting category filter did not narrow the table'));
ok('the meeting category filter works');
await HR.getByTestId('filter-category').selectOption('');
// approve the Team Member's request with a link
await openRow(HR, 'meeting-search', 'meeting-row', 'open-meeting', mref1, mref1);
await wait(HR, '[data-testid="hr-meeting-detail"]', 'the meeting detail did not open');
await HR.getByTestId('assign-select').selectOption(hrMemberId);
await HR.getByTestId('assign-button').click();
await HR.waitForFunction(() => /Harsh Member/.test(document.querySelector('[data-testid="hr-meeting-detail"]')?.innerText ?? '') || document.querySelector('[data-testid="assign-button"]')?.disabled, null, { timeout: 10000 });
await HR.getByTestId('action-select').selectOption('APPROVE');
await HR.locator('#m-date').fill(day(4));
await HR.locator('#m-time').fill('14:00');
await HR.locator('#m-mode').selectOption('ONLINE');
await HR.locator('#m-link').fill('http://insecure.example.com');
await HR.getByTestId('perform-action').click();
await wait(HR, '[role="alert"]:has-text("https")', 'a non-https meeting link should be refused');
ok('a meeting link that is not https is refused');
await HR.locator('#m-link').fill('https://meet.example.com/room-7');
await HR.locator('#m-instructions').fill('Join five minutes early.');
await HR.locator('#m-message').fill('See you then.');
await HR.getByTestId('perform-action').click();
await wait(HR, '[data-testid="confirmed-details"]', 'the confirmed meeting block did not show');
await expect(/Online/.test(await HR.getByTestId('confirmed-details').innerText()) && /2:00 pm/.test(await HR.getByTestId('confirmed-details').innerText()), 'HR approves and schedules the meeting (date, time, mode, link, instructions)');
await HR.getByRole('button', { name: 'Close' }).last().click();
await expect((await q(`select status, confirmed_date::text d, to_char(confirmed_time, 'HH24:MI') t, meeting_link from employee_meeting_requests where id = $1`, [mrow1.id]))[0].status === 'SCHEDULED', 'the database holds it as Scheduled');
await expect(await stat(HR, 'Approved / Scheduled') === 1 && await stat(HR, 'Pending Approval') === 2, 'the cards follow');
// decline the Team Lead's request (with a reason, after a confirmation)
await openRow(HR, 'meeting-search', 'meeting-row', 'open-meeting', mref2, mref2);
await wait(HR, '[data-testid="hr-meeting-detail"]', 'the Team Lead\'s meeting detail did not open');
await HR.getByTestId('action-select').selectOption('DECLINE');
await expect(await HR.getByTestId('perform-action').isDisabled(), 'declining needs a reason (the button stays disabled)');
await HR.getByTestId('reason-input').fill('Please talk to your Department Head first.');
await HR.getByTestId('perform-action').click();
await wait(HR, '[data-testid="confirm-action"]', 'declining should ask for a confirmation');
await HR.getByTestId('confirm-action').click();
await HR.waitForFunction(() => /Declined/.test(document.querySelector('[data-testid="hr-meeting-detail"]')?.innerText ?? ''), null, { timeout: 10000 }).catch(() => fail('the request should be Declined'));
ok('HR declines a request with a reason, after a confirmation');
await HR.getByRole('button', { name: 'Close' }).last().click();
// propose another time to the Department Head
await openRow(HR, 'meeting-search', 'meeting-row', 'open-meeting', mref3, mref3);
await wait(HR, '[data-testid="hr-meeting-detail"]', 'the Department Head\'s meeting detail did not open');
await HR.getByTestId('action-select').selectOption('PROPOSE');
await HR.locator('#m-date').fill(day(6));
await HR.locator('#m-time').fill('16:00');
await HR.locator('#m-location').fill('Room 2');
await HR.getByTestId('perform-action').click();
await HR.waitForFunction(() => /Another time proposed/.test(document.querySelector('[data-testid="hr-meeting-detail"]')?.innerText ?? ''), null, { timeout: 10000 }).catch(() => fail('the request should show a proposed alternative'));
ok('HR proposes another time');
await HR.getByRole('button', { name: 'Close' }).last().click();
await HR.getByTestId('meeting-search').fill('');

// ------------------------------------------------------------------ 7. the employees see the outcome
await TM.reload();
await openRaise(TM);
await TM.getByTestId('case-type').selectOption('MEETING');
await TM.locator(`[data-testid="my-case-row"]:has-text("${mref1}")`).click();
await wait(TM, '[data-testid="confirmed-details"]', 'the employee does not see the confirmed meeting');
const conf = await TM.getByTestId('confirmed-details').innerText();
await expect(/2:00 pm/.test(conf) && /Online/.test(conf) && /Join/.test(conf) && /Join five minutes early/.test(conf), 'the employee sees the confirmed date, time, mode, link and instructions');
await expect(await TM.locator('a[href="https://meet.example.com/room-7"]').count() === 1 && /See you then/.test(await TM.getByTestId('hr-response').innerText()), 'the link is clickable and HR\'s response is shown');
await TM.screenshot({ path: `${OUT}/issues-7-employee-meeting.png`, fullPage: true });
await TM.getByRole('button', { name: 'Close' }).first().click();

await TL.reload();
await openRaise(TL);
await TL.getByTestId('case-type').selectOption('MEETING');
await TL.locator(`[data-testid="my-case-row"]:has-text("${mref2}")`).click();
await wait(TL, '[data-testid="meeting-detail"]', 'the Team Lead\'s meeting detail did not open');
await expect(/Declined/.test(await TL.getByTestId('meeting-detail').innerText()) && /Please talk to your Department Head first/.test(await TL.getByTestId('hr-response').innerText()), 'the Team Lead sees it declined, with HR\'s reason');
await TL.getByRole('button', { name: 'Close' }).first().click();

await DH.reload();
await openRaise(DH);
await DH.getByTestId('case-type').selectOption('MEETING');
await DH.locator(`[data-testid="my-case-row"]:has-text("${mref3}")`).click();
await wait(DH, '[data-testid="alternative"]', 'the Department Head does not see the proposed time');
await expect(/4:00 pm/.test(await DH.getByTestId('alternative').innerText()) && /Room 2/.test(await DH.getByTestId('alternative').innerText()), 'the Department Head sees the proposed time and place');
await DH.getByTestId('accept-alternative').click();
await wait(DH, '[data-testid="confirmed-details"]', 'accepting the proposal should schedule the meeting');
await expect(/4:00 pm/.test(await DH.getByTestId('confirmed-details').innerText()), 'accepting it schedules the meeting at that time');
await DH.getByRole('button', { name: 'Close' }).first().click();
// withdraw: a confirmation first
await DH.locator(`[data-testid="my-case-row"]:has-text("${mref3}")`).click();
await DH.getByTestId('cancel-meeting').click();
await wait(DH, '[data-testid="confirm-cancel-meeting"]', 'cancelling should ask for a confirmation');
await DH.getByRole('button', { name: 'Keep it' }).click();
await expect((await q(`select status from employee_meeting_requests where meeting_reference = $1`, [mref3]))[0].status === 'SCHEDULED', 'declining the confirmation keeps the meeting');
await DH.getByRole('button', { name: 'Close' }).first().click();

// ------------------------------------------------------------------ 8. access: the employee has no HR section, the HR pages are not reachable by an employee
await expect(!(await navLabels(DH)).some(l => /Employee Issues|Meeting Requests/.test(l)), 'a Department Head has no HR sections');
const denied = await call(as(await idOf('rahul@amuwa.com')), 'GET', '/hr/issues');
await expect(denied.status === 403, 'an employee asking the HR list directly is refused (403)');
const other = await call(as(await idOf('lead@amuwa.com')), 'GET', `/employee/issues/${row1.id}`);
await expect(other.status === 404, 'an employee opening a colleague\'s issue by id gets nothing (404)');

// ------------------------------------------------------------------ 9. other layouts
const phone = await login('rahul@amuwa.com', { width: 390, height: 820 });
await openRaise(phone);
await expect(await overflow(phone) <= 1, `Raise an Issue fits a phone with no sideways scrolling (${await overflow(phone)}px)`);
await phone.screenshot({ path: `${OUT}/issues-8-phone.png`, fullPage: true });
await phone.getByTestId('case-type').selectOption('MEETING');
await expect(await overflow(phone) <= 1, 'and so does the meeting form');
await phone.context().close();
const tablet = await login('rahul@amuwa.com', { width: 820, height: 1100 });
await openRaise(tablet);
await expect(await overflow(tablet) <= 1, `Raise an Issue fits a tablet (${await overflow(tablet)}px)`);
await tablet.screenshot({ path: `${OUT}/issues-9-tablet.png`, fullPage: true });
await tablet.context().close();
const hrPhone = await login(HR_HEAD, { width: 390, height: 820 }, 'button[aria-label="Toggle menu"]');
await menu(hrPhone, 'Employee Issues');
await wait(hrPhone, '[data-testid="employee-issues-page"]', 'Employee Issues did not open on a phone');
await wait(hrPhone, '[data-testid="issue-row"]', 'the issue table is empty on a phone');
await expect(await overflow(hrPhone) <= 1, `Employee Issues fits a phone: the table scrolls inside its own box (${await overflow(hrPhone)}px page overflow)`);
await hrPhone.screenshot({ path: `${OUT}/issues-10-hr-phone.png`, fullPage: true });
await hrPhone.context().close();

await expect(errors.length === 0, 'no page errors or console errors in any browser');
console.log(`=== ${step} EMPLOYEE ISSUE BROWSER CHECKS PASSED ===`);
await browser.close();
await db.end();
