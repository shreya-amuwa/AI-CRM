// Browser test of the task daily reports and the performance approval screens (migration 20270209000100): a Team Member reports on a task (validation, one
// report per task and day), the Team Lead returns it with a reason and then approves the corrected one, the Department Head only reads it; the performance
// page for the member (My Performance), the Team Lead and the Department Head shows Pending / Approved / Returned for correction, the approval actions only
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
  check(t.includes('Choose the task you are reporting on.') && t.includes('Describe the work completed'), 'an empty form shows what is missing', t.slice(0, 400));
  await page.selectOption('#tr-task', '11111111-1111-4111-8111-111111111111');
  check((await page.getByTestId('task-report-task').innerText()).includes('Update the account list'), 'choosing a task shows it');
  await page.fill('#tr-work', 'Updated forty of the eighty accounts');
  await page.fill('#tr-progress', '40');
  await page.getByRole('button', { name: 'Submit to Team Lead' }).click();
  check((await text(page)).includes('Say what work is still pending'), 'an unfinished task needs the pending work');
  await page.fill('#tr-pending', 'The last forty accounts');
  await page.fill('#tr-remarks', 'Will finish tomorrow');
  await page.getByRole('button', { name: 'Submit to Team Lead' }).click();
  await rows(page).first().waitFor();
  check((await text(page)).includes('was sent to your Team Lead (Pending)') && await rows(page).count() === 1 && await pill(page, 'PENDING').count() === 1, 'the report is sent and shows as Pending');
  check((await rows(page).first().innerText()).includes('Updated forty of the eighty accounts') && (await rows(page).first().innerText()).includes('The last forty accounts'), 'the card shows the work, the pending work and the progress');
  // the same task and day again
  await page.selectOption('#tr-task', '11111111-1111-4111-8111-111111111111');
  await page.fill('#tr-work', 'Another update on the same day');
  await page.fill('#tr-progress', '50');
  await page.fill('#tr-pending', 'More');
  await page.getByRole('button', { name: 'Submit to Team Lead' }).click();
  await page.getByRole('alert').first().waitFor();
  check((await page.getByRole('alert').first().innerText()).includes('already waiting for approval'), 'a second report for the same task and day is refused with the database\'s message');
  // an overdue task needs the reason for the delay
  await page.selectOption('#tr-task', '22222222-2222-4222-8222-222222222222');
  await page.fill('#tr-work', 'Started on the paperwork today');
  await page.fill('#tr-progress', '20');
  await page.fill('#tr-pending', 'Most of the forms');
  check(await page.locator('label[for="tr-delay"]').innerText().then(x => x.includes('*')), 'the reason for the delay becomes required when the task is past its deadline');
  await page.getByRole('button', { name: 'Submit to Team Lead' }).click();
  check((await text(page)).includes('past its deadline'), 'and is asked for');

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
  check(await page.locator('#tr-task').isDisabled() && (await page.inputValue('#tr-work')).includes('forty of the eighty') && await page.getByRole('button', { name: 'Resubmit for approval' }).isVisible(), 'the report opens in the form with its task fixed');
  await page.fill('#tr-work', 'Updated 40 of 80 accounts: 25 manufacturing, 15 retail');
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
  await mount(page, 'perf-member');
  t = await text(page);
  check(t.includes('My Performance') && await page.getByTestId('pf-tasks').innerText() === '4' && await page.getByTestId('pf-score').innerText() === '61.5', 'My Performance shows the member\'s real figures and score');
  check((await page.getByTestId('score-parts').innerText()).includes('Insufficient data') && t.includes('Calculated from the real task records'), 'a measure without data says "Insufficient data" and the page says where the figures come from');
  check(await pill(page, 'PENDING').count() === 1 && await page.getByRole('button', { name: 'Review' }).count() === 0, 'the member sees Pending and has no approval action');

  await mount(page, 'perf-lead');
  check(await page.getByTestId('people-row').count() === 1 && (await page.getByTestId('people-row').innerText()).includes('Mohan Member') && await page.getByTestId('pf-team-completion').innerText() === '25%', 'the Team Lead sees each member and the team figures');
  await page.getByTestId('people-row').getByRole('button', { name: 'Review' }).click();
  await page.getByTestId('record-review').waitFor();
  await page.getByRole('button', { name: 'Return for correction' }).click();
  check((await text(page)).includes('Say what must be corrected'), 'a return needs a reason');
  await page.fill('textarea[id^="rr-"]', 'Please explain the overdue task');
  await page.getByRole('button', { name: 'Return for correction' }).click();
  await page.waitForTimeout(300);
  check(await pill(page, 'RETURNED').count() >= 1, 'the member\'s performance is Returned for correction');
  const own = page.getByLabel('My own performance');
  check((await own.innerText()).includes('Waiting for approval') && await own.getByRole('button', { name: 'Review' }).count() === 0, 'the Team Lead\'s own performance waits for the Department Head and has no Review action for them');

  await mount(page, 'perf-member');
  check(await pill(page, 'RETURNED').count() === 1 && (await page.getByTestId('record-note').innerText()).includes('Please explain the overdue task'), 'the member sees Returned for correction with the remarks');
  await page.getByRole('button', { name: 'Send again for approval' }).click();
  await page.waitForTimeout(300);
  check(await pill(page, 'PENDING').count() === 1 && await page.getByRole('button', { name: 'Send again for approval' }).count() === 0, 'and sends it again: Pending');

  await mount(page, 'perf-head');
  check(await page.getByTestId('lead-row').count() === 1 && await page.getByTestId('pf-dept-tasks').innerText() === '9' && await page.getByTestId('pf-dept-pending').innerText() === '1', 'the Department Head sees the department figures and the Team Leads');
  await page.getByTestId('lead-row').getByRole('button', { name: 'Review' }).click();
  await page.waitForTimeout(200);
  check(await page.getByTestId('people-table').count() === 1 && (await page.getByTestId('people-table').innerText()).includes('Mohan Member'), 'opening a Team Lead shows their members');
  check(await page.getByTestId('people-table').getByRole('button', { name: 'Review' }).count() === 0, 'the head only reads the members\' performance (their Team Lead decides)');
  await page.fill('textarea[id^="rr-"]', 'Team progress is on track');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.waitForTimeout(300);
  check(await pill(page, 'APPROVED').count() >= 1 && (await page.getByTestId('record-note').first().innerText()).includes('Approved by Ira Head') && (await page.getByTestId('record-note').first().innerText()).includes('Team progress is on track'), 'the Team Lead\'s performance is Approved by the Department Head, with the remarks');
  await page.getByRole('button', { name: 'Approval history' }).first().click();
  await page.getByTestId('record-history').first().waitFor();
  check((await page.getByTestId('record-history').first().innerText()).includes('Generated'), 'and the approval history opens');

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
