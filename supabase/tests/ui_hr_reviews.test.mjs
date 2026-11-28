// Browser test of the confirmation / internship review screens (docs/hr-dashboard-upgrade.md), at desktop and phone width: HR's list with
// clickable cards and filters, a review with the Department Head's report, HR's decision (in-app confirmation, the request sent), the Department
// Head's queue and evaluation form (draft, submit). The components are the real ones; the API is a fake.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the HR reviews browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/hr_reviews_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

const ID = '11111111-1111-1111-1111-111111111111';
const person = (id, name) => ({ id, name, active: true });
const baseRow = () => ({
  id: ID, cycleType: 'PROBATION', profileId: 'p1', employeeName: 'Asha Verma', employeeCode: 'EMP-0042', departmentId: 'd1', department: 'Wabastore',
  designation: 'Telecaller', employmentType: 'Full-Time', joiningDate: '2026-09-14', periodMonths: 6, originalEnd: '2027-03-14', dueDate: '2027-03-14', daysLeft: 4,
  round: 1, status: 'PENDING', overall: 'IN_REVIEW', reviewStarted: true, configIssue: null,
  dh: { reviewer: person('h1', 'Ravi Head'), status: 'SUBMITTED' }, ceo: { reviewer: person('c1', 'Kiran CEO'), status: 'NOT_STARTED' },
  hr: { reviewer: person('r1', 'Payal HR'), status: 'NOT_STARTED' }, decision: null, decidedAt: null, holdNextReview: null, extensionCount: 0
});
let mode = 'hr';
let calls = [];
let row;
let evals;
function detail() {
  return {
    ...row, myRole: mode === 'hr' ? 'HR' : 'DH', isHr: mode === 'hr', canDecide: mode === 'hr' && (row.status === 'PENDING' || row.status === 'ON_HOLD'), canDecideException: mode === 'hr',
    canReassign: mode === 'hr',
    employee: { name: row.employeeName, code: row.employeeCode, email: null, department: row.department, designation: row.designation, employmentType: row.employmentType,
      joiningDate: row.joiningDate, periodMonths: 6, originalEnd: row.originalEnd, currentEnd: row.dueDate, team: 'Sales', salesSubRole: 'TELECALLER' },
    attendance: { from: '2026-09-14', to: '2027-03-10', workingDays: 120, presentDays: 112, halfDays: 2, absentDays: 3, approvedLeaveDays: 5, lateArrivals: 7, earlyDepartures: 1,
      missingPunchOut: 1, discrepancies: 1, netMinutes: 51000, breakMinutes: 4800 },
    work: null, evaluations: evals, extensions: [], decisions: [], assignments: [], reminders: [{ kind: 'REVIEW_FIRST', to: 'Ravi Head', role: 'DH', status: 'FAILED', error: 'SMTP error 550', sentAt: null, sendAfter: '2027-03-04T04:30:00Z' }],
    meetings: [], confirmationEmail: null, hrPeople: [{ id: 'h1', name: 'Ravi Head', role: 'DEPARTMENT_HEAD' }, { id: 'h2', name: 'Meena Head', role: 'DEPARTMENT_HEAD' }]
  };
}
const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
const fail = (res, status, code, message) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: { code, message } })); };
function api(req, res, body) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/^\/api\/v1/, '');
  calls.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), body });
  if (p === '/hr/reviews' && req.method === 'GET') {
    const q = Object.fromEntries(u.searchParams);
    const rows = q.pendingRole === 'DH' ? [] : [row];
    return ok(res, { today: '2027-03-10', canManage: true, departments: [{ id: 'd1', name: 'Wabastore' }], rows,
      cards: { upcoming: 3, due10: 2, due4: 1, pendingDh: 0, pendingCeo: 1, pendingHr: 0, overdue: 0, confirmed: 5, extended: 1, internshipsUpcoming: 0, configIssues: 0 } });
  }
  if (p === '/hr/reviews/mine') return ok(res, { today: '2027-03-10', rows: [{ ...row, myRole: 'DH', myStatus: evals.find(e => e.role === 'DH')?.status ?? 'NOT_STARTED', attendance: detail().attendance }] });
  if (p === `/hr/reviews/${ID}` && req.method === 'GET') return ok(res, detail());
  if (p === `/hr/reviews/${ID}/evaluation`) {
    const e = { id: 'e-dh', round: 1, role: 'DH', reviewer: person('h1', 'Ravi Head'), status: body.submit ? 'SUBMITTED' : 'DRAFT', ratings: body.ratings, answers: body.answers,
      recommendation: body.recommendation, submittedAt: body.submit ? '2027-03-10T06:00:00Z' : null, version: body.submit ? 1 : 0, returnedReason: null, returnedAt: null, returnedBy: null, updatedAt: '2027-03-10T06:00:00Z', versions: body.submit ? 1 : 0 };
    evals = [e, ...evals.filter(x => x.role !== 'DH')];
    row = { ...row, dh: { ...row.dh, status: e.status } };
    return ok(res, detail());
  }
  if (p === `/hr/reviews/${ID}/decide`) {
    if (body.decision === 'CONFIRM' && !body.exceptional) return fail(res, 409, 'CONFLICT', 'The Department Head and CEO reports are both needed before the final decision.');
    row = { ...row, status: 'ON_HOLD', overall: 'ON_HOLD', decision: 'HOLD' };
    return ok(res, detail());
  }
  fail(res, 404, 'NOT_FOUND', `no fake for ${req.method} ${p}`);
}
const srv = createServer((req, res) => {
  if (req.url.startsWith('/api/v1/')) {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => api(req, res, raw ? JSON.parse(raw) : undefined));
    return;
  }
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.dismiss(); });

    // ---- HR
    mode = 'hr'; calls = []; row = baseRow();
    evals = [{ id: 'e-dh', round: 1, role: 'DH', reviewer: person('h1', 'Ravi Head'), status: 'SUBMITTED', ratings: { calling: 4, work_quality: null }, answers: { strengths: 'Very consistent caller', recommendationReason: 'Ready' },
      recommendation: 'CONFIRM', submittedAt: '2027-03-06T06:00:00Z', version: 1, returnedReason: null, returnedAt: null, returnedBy: null, updatedAt: '2027-03-06T06:00:00Z', versions: 1 }];
    await page.goto(base);
    await page.evaluate(() => window.mountHr('PROBATION'));
    await page.getByTestId('review-cards').waitFor();
    check(/Due within 4 days\s*1/.test(await page.getByTestId('review-cards').innerText()), `${label}: the summary cards show the counts`);
    await page.getByTestId('card-pending-dh').click();
    await page.getByText('No confirmations match these filters.').waitFor();
    check(calls.some(c => c.path === '/hr/reviews' && c.query.pendingRole === 'DH' && c.query.type === 'PROBATION'), `${label}: a card filters the list on the server`, calls.at(-1));
    await page.getByTestId('card-pending-dh').click();
    const openBtn = label === 'phone' ? page.getByTestId('review-list-mobile').getByRole('button').first() : page.getByRole('button', { name: 'View details' });
    await openBtn.click();
    await page.getByTestId('review-detail').waitFor();
    const reports = await page.getByTestId('review-reports').innerText();
    check(/Ravi Head/.test(reports) && /Very consistent caller/.test(reports) && /Calling performance/.test(reports) && /Not applicable/.test(reports),
      `${label}: HR reads the Department Head's report, with the Telecaller criteria and "not applicable"`, reports);
    check(/112/.test(await page.getByTestId('review-attendance').innerText()), `${label}: the attendance summary is shown`);
    check(/No task records for this period/.test(await page.getByTestId('review-detail').innerText()), `${label}: missing task data is not shown as zero`);
    check(/some failed/.test(await page.getByTestId('review-history').innerText()), `${label}: a failed reminder is flagged in the history`);
    // the decision: refused without the CEO report, then put on hold
    await page.getByTestId('decision-select').selectOption('CONFIRM');
    await page.getByTestId('decision-reason').fill('The Department Head recommends confirmation');
    await page.getByRole('button', { name: 'Record decision' }).click();
    await page.getByRole('dialog').filter({ hasText: 'Confirm employee: Asha Verma?' }).getByRole('button', { name: 'Confirm employee' }).click();
    await page.getByText('The Department Head and CEO reports are both needed before the final decision.').first().waitFor();
    check(calls.some(c => c.path.endsWith('/decide') && c.body.decision === 'CONFIRM' && c.body.reason.startsWith('The Department Head')), `${label}: the decision request carries the decision and the reason`);
    await page.getByTestId('decision-select').selectOption('HOLD');
    await page.locator('input[type="date"]').last().fill('2027-04-01');
    await page.getByRole('button', { name: 'Record decision' }).click();
    await page.getByRole('dialog').filter({ hasText: 'Keep decision on hold' }).getByRole('button', { name: 'Keep decision on hold' }).click();
    await page.getByText('Decision recorded: Keep decision on hold.').first().waitFor();
    const hold = calls.filter(c => c.path.endsWith('/decide')).at(-1);
    check(hold.body.decision === 'HOLD' && hold.body.nextReviewDate === '2027-04-01', `${label}: on hold sends the next review date`, hold.body);
    check(/On hold/.test(await page.getByTestId('review-detail').innerText()), `${label}: the review now shows "On hold" (and can still be decided later)`);
    const wideHr = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(wideHr <= 1, `${label}: no sideways scrolling (HR)`, wideHr);

    // ---- the Department Head
    mode = 'dh'; calls = []; row = { ...baseRow(), dh: { reviewer: person('h1', 'Ravi Head'), status: 'NOT_STARTED' } }; evals = [];
    await page.goto(base);
    await page.evaluate(() => window.mountMine());
    await page.getByTestId('my-reviews').waitFor();
    check(/112\/120 days present/.test(await page.getByTestId('my-reviews').innerText()), `${label}: the queue shows the attendance line`);
    await page.getByRole('button', { name: 'Submit review' }).click();
    await page.getByTestId('review-form').waitFor();
    await page.locator('#rate-calling').selectOption('4');
    await page.locator('#rate-work_quality').selectOption('na');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await page.getByText('Draft saved. It is not submitted yet.').first().waitFor();
    check(calls.some(c => c.path.endsWith('/evaluation') && c.body.submit === false && c.body.ratings.calling === 4 && c.body.ratings.work_quality === null && c.body.role === 'DH'),
      `${label}: a draft is saved with the ratings ("not applicable" is null)`);
    await page.getByRole('radio', { name: 'Recommend confirmation', exact: true }).check();
    await page.getByRole('button', { name: 'Submit evaluation' }).click();
    await page.getByRole('dialog').filter({ hasText: 'Submit your Department Head evaluation?' }).getByRole('button', { name: 'Submit evaluation' }).click();
    await page.getByText('Evaluation submitted to HR.').first().waitFor();
    check(calls.some(c => c.path.endsWith('/evaluation') && c.body.submit === true && c.body.recommendation === 'CONFIRM'), `${label}: submitting sends the recommendation`);
    check(await page.getByTestId('review-form').count() === 0, `${label}: after submitting the form is closed (no silent change)`);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(wide <= 1, `${label}: no sideways scrolling`, wide);
    check(errors.length === 0, `${label}: no script errors and no browser dialogs`, errors);
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== ${passed} HR REVIEW BROWSER CHECKS PASSED ===`);
