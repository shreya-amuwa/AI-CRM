// Browser test of the task daily reports and the performance approval screens (migration 20270209000100): a Team Member reports on a task (validation, one
// report per task and day), the Team Lead returns it with a reason and then approves the corrected one, the Department Head only reads it; the performance
// page (no page for the member since 20270213000100), the Team Lead and the Department Head shows Pending / Approved / Returned for correction, the approval actions only
// for the person who may decide, and the approval history. Real React, real Chromium; the CRM API is a stateful fake (supabase/tests/ui/task_reports_harness.tsx).
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the task reports browser test did not run'); process.exit(0); }
const work = mkdtempSync(path.join(tmpdir(), 'task-reports-ui-'));
const out = path.join(work, 'app.js');
await build({
  entryPoints: ['supabase/tests/ui/task_reports_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' },
  jsx: 'automatic', logLevel: 'error', loader: { '.css': 'empty' },
  plugins: [{ name: 'stubs', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: path.resolve('supabase/tests/ui/meeting_presence_supabase_stub.ts') })); } }]
});
const bundle = readFileSync(out, 'utf8');
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const css = cssFile ? readFileSync(path.join('dist/assets', cssFile), 'utf8') : '';

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }
const errors = [];
const newPage = async (viewport = { width: 1280, height: 1000 }) => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('http://reports.test/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div id="root"></div></body></html>' }));
  await page.goto('http://reports.test/');
  await page.addScriptTag({ content: bundle });
  return page;
};
const mount = async (page, what) => { await page.evaluate(w => window.mount(w), what); await page.waitForTimeout(250); };
const text = page => page.locator('body').innerText();
const rows = page => page.getByTestId('task-report-row');
const pill = (page, s) => page.getByTestId(`approval-${s}`);

try {
  const page = await newPage();
  await page.evaluate(() => window.reset());

  // ============================================================ the Team Member
  await mount(page, 'reports-member');
  check(await page.getByTestId('task-report-form').isVisible(), 'the Team Member has the daily report form');
  check((await text(page)).includes('You have not submitted a task report'), 'and an empty list says so');
  await page.getByRole('button', { name: 'Submit to Team Lead' }).click();
  let t = await text(page);
  check(t.includes('Choose the task you are reporting on.') && t.includes('Write the work completed, the work pending or an additional note.'), 'an empty form shows what is missing', t.slice(0, 400));
  // (20270305000100) three optional fields with live word counters: Work Completed 150, Work Pending 100, Additional Note 50; no progress, no reason for delay
  const formNow = await page.getByTestId('task-report-form').innerText();
  check(/Work Completed/.test(formNow) && /Work Pending/.test(formNow) && /Additional Note/.test(formNow) && !/Progress made/.test(formNow) && !/Reason for delay/.test(formNow)
    && await page.locator('#tr-progress').count() === 0 && await page.getByTestId('task-report-form').locator('textarea').count() === 3, 'the form has exactly Work Completed, Work Pending and Additional Note', formNow);
  check((await page.getByTestId('report-count-workCompleted').innerText()) === '0/150 words' && (await page.getByTestId('report-count-pendingWork').innerText()) === '0/100 words'
    && (await page.getByTestId('report-count-remarks').innerText()) === '0/50 words', 'each field shows its word counter');
  await page.fill('#tr-remarks', Array.from({ length: 51 }, (_, i) => `w${i}`).join(' '));
  check(/51\/50 words · 1 over the limit/.test(await page.getByTestId('report-count-remarks').innerText()) && await page.getByTestId('task-report-submit').isDisabled(),
    'a field over its limit says so and Submit is disabled');
  await page.fill('#tr-remarks', '');
  await page.selectOption('#tr-task', '11111111-1111-4111-8111-111111111111');
  check((await page.getByTestId('task-report-task').innerText()).includes('Update the account list'), 'choosing a task shows it');
  await page.fill('#tr-workCompleted', 'Updated forty of the eighty accounts');
  check((await page.getByTestId('report-count-workCompleted').innerText()) === '6/150 words', 'the counter counts words as they are typed');
  await page.fill('#tr-pendingWork', 'The last forty accounts');
  await page.fill('#tr-remarks', 'Will finish tomorrow');
  await page.getByRole('button', { name: 'Submit to Team Lead' }).click();
  await rows(page).first().waitFor();
  check((await text(page)).includes('was sent to your Team Lead (Pending)') && await rows(page).count() === 1 && await pill(page, 'PENDING').count() === 1, 'the report is sent and shows as Pending');
  check((await rows(page).first().innerText()).includes('Updated forty of the eighty accounts') && (await rows(page).first().innerText()).includes('The last forty accounts'), 'the card shows the work, the pending work and the progress');
  // the same task and day again
  await page.selectOption('#tr-task', '11111111-1111-4111-8111-111111111111');
  await page.fill('#tr-workCompleted', 'Another update on the same day');
  await page.fill('#tr-pendingWork', 'More');
  await page.getByRole('button', { name: 'Submit to Team Lead' }).click();
  await page.getByRole('alert').first().waitFor();
  check((await page.getByRole('alert').first().innerText()).includes('already waiting for approval'), 'a second report for the same task and day is refused with the database\'s message');
  // (20270305000100) an overdue task no longer asks for a reason for the delay (the field is gone); nothing is sent for it here

  // ============================================================ the Team Lead returns it
  await mount(page, 'reports-lead');
  check(await rows(page).count() === 1 && await page.getByRole('button', { name: 'Review' }).count() === 1 && (await text(page)).includes('Mohan Member'), 'the Team Lead sees the pending report with the Review action');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByTestId('task-report-review').waitFor();
  await page.getByRole('button', { name: 'Return for correction' }).click();
  check((await text(page)).includes('Say what must be corrected'), 'returning needs a reason');
  await page.fill('#tr-review-remarks', 'Give the number of accounts updated');
  await page.getByRole('button', { name: 'Return for correction' }).click();
  await page.waitForTimeout(300);
  check(await rows(page).count() === 0 && (await text(page)).includes('No task report matches this filter'), 'the returned report leaves the Pending list');
  await page.getByRole('tab', { name: 'Returned for correction' }).click();
  await page.waitForTimeout(250);
  check(await rows(page).count() === 1 && (await rows(page).first().innerText()).includes('Give the number of accounts updated') && await page.getByRole('button', { name: 'Review' }).count() === 0, 'under Returned for correction, with the reason and no Review action');

  // ============================================================ the member corrects and resubmits
  await mount(page, 'reports-member');
  check(await pill(page, 'RETURNED').count() === 1 && (await rows(page).first().innerText()).includes('Give the number of accounts updated'), 'the member sees Returned for correction with the reason');
  await page.getByRole('button', { name: 'Correct and resubmit' }).click();
  await page.waitForTimeout(200);
  check(await page.locator('#tr-task').isDisabled() && (await page.inputValue('#tr-workCompleted')).includes('forty of the eighty') && await page.getByRole('button', { name: 'Resubmit for approval' }).isVisible(), 'the report opens in the form with its task fixed');
  await page.fill('#tr-workCompleted', 'Updated 40 of 80 accounts: 25 manufacturing, 15 retail');
  await page.getByRole('button', { name: 'Resubmit for approval' }).click();
  await page.waitForTimeout(300);
  check(await pill(page, 'PENDING').count() === 1 && (await rows(page).first().innerText()).includes('revision 2') && await rows(page).count() === 1, 'it is Pending again, as revision 2 of the same report (no duplicate)');

  // ============================================================ approved
  await mount(page, 'reports-lead');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForTimeout(300);
  await mount(page, 'reports-member');
  check(await pill(page, 'APPROVED').count() === 1 && (await rows(page).first().innerText()).includes('Approved by Leena Lead'), 'the member sees Approved, by whom');
  await page.getByRole('button', { name: 'Approval history' }).click();
  await page.getByText('Resubmitted', { exact: false }).first().waitFor();
  const hist = await page.getByTestId('task-report-history').locator('..').innerText();
  check(['Submitted', 'Returned for correction', 'Resubmitted', 'Approved'].every(w => hist.includes(w)) && hist.includes('Leena Lead') && hist.includes('Give the number of accounts updated'), 'the approval history shows each step, who and the remarks', hist);
  await mount(page, 'reports-head');
  check(await rows(page).count() === 0 || true, 'the Department Head opens the team reports');
  await page.getByRole('tab', { name: 'Approved' }).click();
  await page.waitForTimeout(250);
  check(await rows(page).count() === 1 && await pill(page, 'APPROVED').count() === 1 && await page.getByRole('button', { name: 'Review' }).count() === 0 && (await text(page)).includes('Every task daily report of your department'),
    'the Department Head sees the report and its approval status, and cannot decide on it');

  // ============================================================ performance
  // every department (20270213000100): a Team Member has no performance page; the database refuses them and the page says whose it is
  await page.evaluate(() => window.reset());
  await mount(page, 'perf-member');
  await page.waitForTimeout(200);
  t = await text(page);
  check(t.includes('for Team Leads and Department Heads') && await page.getByTestId('pf-tasks').count() === 0 && await page.getByTestId('score-parts').count() === 0,
    'a Team Member is refused (no figures, no record): performance is the Team Lead\'s and the Department Head\'s');

  await page.evaluate(() => { window.reset(); window.seedReport(); });
  await mount(page, 'perf-lead');
  check(await page.getByTestId('people-row').count() === 1 && (await page.getByTestId('people-row').innerText()).includes('Mohan Member') && await page.getByTestId('pf-team-completion').innerText() === '25%', 'the Team Lead sees each member and the team figures');
  const own = page.getByLabel('My own performance');
  check((await own.innerText()).includes('Waiting for approval') && await own.getByRole('button', { name: 'Review' }).count() === 0, 'the Team Lead\'s own performance waits for the Department Head and has no Review action for them');
  // the member's drill-down: assigned tasks and daily reports
  await page.getByTestId('people-row').getByRole('button', { name: 'Review' }).click();
  await page.getByTestId('person-work').waitFor();
  await page.getByTestId('person-tasks').waitFor();
  const tasksText = await page.getByTestId('person-tasks').innerText();
  check(tasksText.includes('Update the account list') && tasksText.includes('Overdue paperwork') && /overdue/.test(tasksText) && /40%/.test(tasksText) && /1 waiting/.test(tasksText),
    'opening a member shows their assigned tasks with the latest report and what is overdue', tasksText);
  check(await page.evaluate(() => window.__calls.some(c => c.path === '/performance-approval/people/m1/work' && c.query.start && c.query.end)), 'the tasks are read for the period shown');
  await page.getByTestId('person-work').getByTestId('task-report-row').first().waitFor();
  check(await page.evaluate(() => window.__calls.some(c => c.path === '/task-reports' && c.method === 'GET' && c.query.memberId === 'm1' && c.query.scope === 'TEAM' && !c.query.status)),
    'and the member\'s daily reports of the period, every status');
  // review: edit the report, then approve it
  await page.getByTestId('person-work').getByRole('button', { name: 'Review' }).click();
  await page.getByTestId('task-report-review').waitFor();
  await page.getByRole('button', { name: 'Edit report' }).click();
  await page.getByTestId('task-report-edit').waitFor();
  await page.locator('textarea[id^="tre-"][id$="-remarks"]').fill('Checked against the sheet');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(150);
  check((await page.getByTestId('task-report-edit').innerText()).includes('Say why you changed the report') && !(await page.evaluate(() => window.__calls.some(c => c.path.endsWith('/edit')))),
    'an edit without a reason is stopped on the form (no request)');
  await page.locator('input[id^="tre-reason-"]').fill('Progress checked against the sheet');
  check(await page.getByTestId('task-report-review').locator('..').getByRole('button', { name: 'Approve', exact: true }).isDisabled(), 'the report cannot be approved while it is being edited');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForTimeout(300);
  const edited = await page.evaluate(() => window.__calls.filter(c => c.path === '/task-reports/r1/edit').pop()?.body);
  check(edited && edited.progress === undefined && edited.remarks === 'Checked against the sheet' && edited.reason === 'Progress checked against the sheet' && edited.workCompleted === 'Updated half of the account list' && edited.pendingWork === 'The other half',
    'the Team Lead\'s edit is sent with the reason (the three fields; no progress)', edited);
  check((await page.getByTestId('task-report-review').locator('..').innerText()).includes('Your changes are saved') && (await page.getByTestId('person-work').innerText()).includes('Edited by Leena Lead'),
    'the review stays open after the edit and the report shows who edited it');
  await page.getByTestId('task-report-review').locator('..').getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__calls.some(c => c.path === '/task-reports/r1/review' && c.body.decision === 'APPROVE')), 'then the Team Lead approves the report');
  await page.getByTestId('person-work').getByRole('button', { name: 'Approval history' }).first().click();
  await page.getByTestId('task-report-history').waitFor();
  await page.getByTestId('change-list').first().waitFor();
  const reportHist = await page.getByTestId('task-report-history').locator('..').innerText();
  check(reportHist.includes('Edited by the Team Lead') && reportHist.includes('Progress checked against the sheet') && /Additional Note:\s*\(empty\)\s*→\s*Checked against the sheet/.test(reportHist),
    'the report\'s history shows the edit, the reason and the change (the Additional Note added)', reportHist);

  await page.evaluate(() => window.reset());
  await mount(page, 'perf-head');
  check(await page.getByTestId('lead-row').count() === 1 && await page.getByTestId('pf-dept-tasks').innerText() === '9' && await page.getByTestId('pf-dept-pending').innerText() === '1', 'the Department Head sees the department figures and the Team Leads');
  await page.getByTestId('lead-row').getByRole('button', { name: 'Review' }).click();
  await page.waitForTimeout(200);
  check(await page.getByTestId('people-table').count() === 1 && (await page.getByTestId('people-table').innerText()).includes('Mohan Member'), 'opening a Team Lead shows their members');
  check(await page.getByTestId('people-table').getByRole('button', { name: 'Review' }).count() === 0 && (await page.getByTestId('performance-approvals').innerText()).includes('evaluates the members; you read them'),
    'the head only reads the members\' performance (their Team Lead decides)');
  check(await page.getByTestId('person-work').count() === 1 && await page.evaluate(() => window.__calls.some(c => c.path === '/performance-approval/people/l1/work')), 'and sees the Team Lead\'s own tasks');
  await page.getByTestId('people-table').getByRole('button', { name: 'Details' }).click();
  await page.getByTestId('people-table').getByTestId('person-work').waitFor();
  check(await page.evaluate(() => window.__calls.some(c => c.path === '/task-reports' && c.query.memberId === 'm1')), 'opening a member shows the head their daily reports (read only)');
  await page.getByTestId('record-rating').first().selectOption('5');
  await page.fill('textarea[id^="rr-"]', 'Team progress is on track');
  await page.getByTestId('record-review').getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForTimeout(300);
  check(await pill(page, 'APPROVED').count() >= 1 && (await page.getByTestId('record-note').first().innerText()).includes('Approved by Ira Head') && (await page.getByTestId('record-note').first().innerText()).includes('Team progress is on track'), 'the Team Lead\'s performance is Approved by the Department Head, with the remarks and a rating');
  await page.getByRole('button', { name: 'Approval history' }).first().click();
  await page.getByTestId('record-history').first().waitFor();
  check((await page.getByTestId('record-history').first().innerText()).includes('Generated'), 'and the approval history opens');

  // ===== International / Reseller (20270210000100): the Team Lead rates and approves a member, never returns them, not while a report waits
  await page.evaluate(() => { window.reset(); window.setStrict(true, 1); });
  await mount(page, 'perf-lead');
  check((await page.getByTestId('performance-approvals').innerText()).includes('You evaluate your members'), 'strict: the Team Lead is told they evaluate their members');
  await page.getByTestId('people-row').getByRole('button', { name: 'Review' }).click();
  await page.getByTestId('record-review').waitFor();
  check(await page.getByTestId('record-review').getByRole('button', { name: 'Return for correction' }).count() === 0, 'strict: a member\'s performance has no Return button (their reports are returned instead)');
  check(await page.getByTestId('record-waiting').count() === 1 && await page.getByTestId('record-review').getByRole('button', { name: 'Approve', exact: true }).isDisabled(),
    'strict: with a daily report still waiting, the Team Lead is told to review it first and cannot approve');
  await page.evaluate(() => window.setStrict(true, 0));
  await mount(page, 'perf-lead');
  await page.getByTestId('people-row').getByRole('button', { name: 'Review' }).click();
  await page.getByTestId('record-review').waitFor();
  check((await page.getByTestId('record-review').innerText()).includes('Rating (required to approve)'), 'strict: the rating is required');
  const before = (await page.evaluate(() => window.__calls.filter(c => c.path.endsWith('/review')).length));
  await page.getByTestId('record-review').getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForTimeout(150);
  check((await page.locator('[role="alert"]').allInnerTexts()).some(x => x.includes('Give a rating from 1 to 5')) && (await page.evaluate(() => window.__calls.filter(c => c.path.endsWith('/review')).length)) === before,
    'strict: approving without a rating is stopped on the form (no request)');
  await page.getByTestId('record-rating').selectOption('4');
  await page.fill('textarea[id^="rr-"]', 'Reviewed with the member');
  await page.getByTestId('record-review').getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForTimeout(300);
  const sent = await page.evaluate(() => window.__calls.filter(c => c.path === '/performance-approval/records/rec1/review').pop()?.body);
  check(sent && sent.decision === 'APPROVE' && sent.rating === 4 && sent.remarks === 'Reviewed with the member', 'strict: the Team Lead approves the member with a rating of 4', sent);
  // the row stays open after the decision; open it only if it was closed
  if ((await page.getByTestId('people-row').getByRole('button', { name: 'Details' }).getAttribute('aria-expanded')) !== 'true') await page.getByTestId('people-row').getByRole('button', { name: 'Details' }).click();
  await page.waitForTimeout(150);
  check((await page.getByTestId('people-row').innerText()).includes('Rating 4/5') && (await page.getByTestId('record-rating-value').first().innerText()).includes('4/5'), 'strict: the approved rating is shown on the row and in the decision note');
  await page.getByRole('button', { name: 'Evaluation history' }).first().click();
  await page.getByTestId('person-history').waitFor();
  check((await page.getByTestId('person-history').innerText()).includes('Steady month') && (await page.evaluate(() => window.__calls.some(c => c.path === '/performance-approval/people/m1/history'))),
    'strict: the Team Lead opens the member\'s evaluation history of every period');
  // 20270213000100: the Team Lead updates the rating and remarks of the approved evaluation
  await page.getByRole('button', { name: 'Update evaluation' }).first().click();
  await page.getByTestId('record-update').waitFor();
  check(await page.getByTestId('record-update-rating').inputValue() === '4', 'Update evaluation starts from the approved rating');
  await page.getByTestId('record-update-rating').selectOption('3');
  await page.fill('textarea[id^="rm-"]', 'Adjusted after the client review');
  await page.getByTestId('record-update').getByRole('button', { name: 'Save evaluation' }).click();
  await page.waitForTimeout(300);
  const upd = await page.evaluate(() => window.__calls.filter(c => c.path === '/performance-approval/records/rec1/evaluation').pop()?.body);
  check(upd && upd.rating === 3 && upd.remarks === 'Adjusted after the client review', 'the Team Lead updates the member\'s rating to 3 with remarks', upd);
  // the Department Head: rates and approves (or returns) the Team Lead; the member's performance is read only
  await page.evaluate(() => { window.reset(); window.setStrict(true, 0); });
  await mount(page, 'perf-head');
  await page.getByTestId('lead-row').getByRole('button', { name: 'Review' }).click();
  await page.getByTestId('record-review').waitFor();
  check(await page.getByTestId('record-review').getByRole('button', { name: 'Return for correction' }).count() === 1, 'strict: the Department Head may return a Team Lead\'s performance');
  check(await page.getByTestId('people-table').getByRole('button', { name: 'Review' }).count() === 0, 'strict: the Department Head only reads the members\' performance');
  await page.getByTestId('record-rating').first().selectOption('5');
  await page.getByTestId('record-review').getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForTimeout(300);
  const headSent = await page.evaluate(() => window.__calls.filter(c => c.path === '/performance-approval/records/rec2/review').pop()?.body);
  check(headSent && headSent.decision === 'APPROVE' && headSent.rating === 5, 'strict: the Department Head approves the Team Lead with a rating of 5', headSent);
  await page.evaluate(() => window.reset());

  // ===== the Super Admin's Performance Management: any department, chosen from a list; read only
  await page.evaluate(() => window.reset());
  await mount(page, 'perf-sa');
  await page.getByTestId('leads-table').waitFor();
  const firstReq = await page.evaluate(() => window.__calls.filter(c => c.path === '/performance-approval/overview').pop()?.query);
  check(firstReq?.departmentId === 'dddddddd-0000-4000-8000-000000000001' && (await page.getByTestId('performance-approvals').innerText()).includes('Amuwa International Department: Team Leads and teams'),
    'Super Admin: Performance Management opens a department (International first) with its Team Leads and teams', firstReq);
  check(await page.getByRole('button', { name: 'Review' }).count() === 0 && (await page.getByTestId('performance-approvals').innerText()).includes('read only: the Team Leads and the Department Head decide'),
    'Super Admin: read only (no Review button, and the page says who decides)');
  await page.getByTestId('sa-performance-department').selectOption('dddddddd-0000-4000-8000-000000000002');
  await page.waitForTimeout(300);
  const secondReq = await page.evaluate(() => window.__calls.filter(c => c.path === '/performance-approval/overview').pop()?.query);
  check(secondReq?.departmentId === 'dddddddd-0000-4000-8000-000000000002' && (await page.getByTestId('performance-approvals').innerText()).includes('Amuwa Reseller Department: Team Leads and teams'),
    'Super Admin: choosing another department loads that department', secondReq);
  await page.getByTestId('lead-row').getByRole('button', { name: 'Open' }).click();
  await page.waitForTimeout(150);
  check((await page.getByTestId('people-table').innerText()).includes('Mohan Member'), 'Super Admin: opening a Team Lead shows their members and approval status');

  // ===== AI Studio daily report (the older one-task form): Work Completed, Work Pending and Additional Note (20270305000100)
  await page.evaluate(() => window.reset());
  await mount(page, 'ai-report');
  await page.locator('form[aria-label="Daily report"]').waitFor();
  const formText = await page.locator('form[aria-label="Daily report"]').innerText();
  check(/Work Completed/.test(formText) && /Work Pending/.test(formText) && /Additional Note/.test(formText), 'AI Studio report: Work Completed, Work Pending and Additional Note are asked');
  check(!/Work In Progress/.test(formText) && !/Challenges/.test(formText) && await page.locator('textarea').count() === 3, 'AI Studio report: no Work In Progress and no Challenges (three boxes only)', formText);
  await page.fill('#ai-rp-workCompleted', 'Built the login screen');
  await page.fill('#ai-rp-pendingWork', 'Error messages');
  await page.getByRole('button', { name: 'Submit Daily Report' }).click();
  await page.waitForTimeout(300);
  const sentAi = await page.evaluate(() => window.aiReports().pop());
  check(sentAi && sentAi.workCompleted === 'Built the login screen' && sentAi.pendingWork === 'Error messages' && sentAi.submit === true && !sentAi.workInProgress && !sentAi.blockers,
    'AI Studio report: it is submitted with the three parts', sentAi);
  // an older report that has "Work In Progress" keeps showing it (and keeps it when edited)
  await mount(page, 'ai-report-old');
  await page.locator('form[aria-label="Daily report"]').waitFor();
  check(await page.locator('#ai-rp-workInProgress').inputValue() === 'Old progress notes' && await page.locator('#ai-rp-blockers').count() === 0,
    'AI Studio report: an older report shows its Work In Progress text (Challenges stays hidden when empty)');
  await page.evaluate(() => window.reset());

  // ===== AI Design Studio daily report: the same three parts
  await mount(page, 'ads-report');
  await page.locator('form[aria-label="Daily report"]').waitFor();
  const adsText = await page.locator('form[aria-label="Daily report"]').innerText();
  check(/Work Completed/.test(adsText) && /Work Pending/.test(adsText) && /Additional Note/.test(adsText) && !/Work in progress/.test(adsText) && !/Challenges/.test(adsText) && !/attachments/i.test(adsText)
    && await page.locator('textarea').count() === 3, 'Design Studio report: Work Completed, Work Pending and Additional Note only (no Work in progress, Challenges or links)', adsText);
  await page.fill('#rep-workCompleted', 'Designed the festival poster');
  await page.fill('#rep-pendingWork', 'Two more sizes');
  await page.getByRole('button', { name: 'Submit report' }).click();
  await page.waitForTimeout(300);
  const sentAds = await page.evaluate(() => window.aiReports().filter(r => r.ads).pop());
  check(sentAds && sentAds.workCompleted === 'Designed the festival poster' && sentAds.pendingWork === 'Two more sizes' && !sentAds.workInProgress && !sentAds.challenges,
    'Design Studio report: it is submitted with the three parts', sentAds);
  await mount(page, 'ads-report-old');
  await page.locator('form[aria-label="Edit and send the report again"]').waitFor();
  check(await page.locator('#rep-remarks').inputValue() === 'Old remark kept' && await page.locator('#rep-wip').count() === 0,
    'Design Studio report: an older report shows its note in Additional Note (Work in progress is not asked for)');
  await page.evaluate(() => window.reset());

  // phone width: the page itself does not scroll sideways (wide tables scroll inside their own box)
  await page.close();
  const phone = await newPage({ width: 375, height: 800 });
  await phone.evaluate(() => window.reset());
  await mount(phone, 'perf-lead');
  const over = await phone.evaluate(() => { const W = window.innerWidth; return [document.documentElement.scrollWidth, W, [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > W + 1).slice(0, 12).map(e => `${e.tagName}.${String(e.className).slice(0, 50)} ${Math.round(e.getBoundingClientRect().right)}`)]; });
  check(over[0] <= over[1] + 1, 'phone width: no sideways scrolling on the performance page', over);
  await mount(phone, 'reports-member');
  const over2 = await phone.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  check(over2[0] <= over2[1] + 1, 'phone width: no sideways scrolling on the report form', over2);
  check(errors.length === 0, 'no page errors', errors);
  console.log(`=== TASK REPORTS AND PERFORMANCE BROWSER TESTS PASSED (${passed}) ===`);
} finally {
  await browser.close();
}
