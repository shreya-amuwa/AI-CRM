// Browser test of Work Updates (20270116000100): the Department Head / Team Lead's Work Updates list (counts, filters, reminders), a task's requests and
// history with "Request update", and the Team Member's Update Requests with the answer form, at desktop and phone width. The database is answered
// in the page; the test also checks what is SENT: never a role, a user id or a task status.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the work updates browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/work_updates_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/work_updates_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;
const srv = createServer((req, res) => {
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
const lastCall = (page, fn) => page.evaluate(f => [...window.__calls].reverse().find(c => c.fn === f)?.args, fn);
const noSmuggling = sent => sent && !/role|user|actor|requested_by|requested_from|status|SUPER_ADMIN/i.test(Object.keys(sent).join(' '));
try {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));

  // ---- Department Head / Team Lead: Work Updates
  await page.goto(base);
  await page.evaluate(() => window.mountManager());
  await page.getByRole('heading', { name: 'Work Updates' }).waitFor();
  await page.getByRole('tab', { name: 'All Updates (3)' }).waitFor();
  check(await page.getByRole('tab', { name: 'Pending (2)' }).isVisible() && await page.getByRole('tab', { name: 'Responded (1)' }).isVisible() && await page.getByRole('tab', { name: 'Overdue (1)' }).isVisible(),
    'the filters show All Updates, Pending, Responded and Overdue with their counts');
  check(await page.getByText('Mia Member').isVisible() && await page.getByText('Clear the e-mail escalations').isVisible() && await page.getByText(/Requested .* by Tara Lead/).first().isVisible(),
    'each row shows the employee, the task and the request date');
  check(await page.getByText('Waiting for a response').count() === 1 && await page.getByText('Overdue', { exact: true }).count() >= 1, 'pending, overdue and responded are told apart');
  await page.getByRole('tab', { name: /^Overdue/ }).click();
  await page.getByText('Mia Member').waitFor();
  check(await page.getByText('Ravi Member').count() === 0 && await page.getByText('Tom Lead').count() === 0, 'the Overdue filter lists only the request past its deadline');
  await page.getByRole('tab', { name: /^Responded/ }).click();
  await page.getByText('Tom Lead').waitFor();
  check(await page.getByText(/Plan is 60% drafted/).isVisible() && await page.getByText(/Waiting for the Pune figures/).isVisible() && await page.getByText(/expected 15 Jan 2030/).isVisible(),
    'a responded row shows the progress, the blockers and the expected completion date');
  await page.getByRole('tab', { name: /^Pending/ }).click();
  await page.getByText('Ravi Member').waitFor();
  // a reminder: allowed on the old request, not yet on the recent one
  await page.getByRole('button', { name: /Mia Member/ }).first().click();
  await page.getByRole('button', { name: 'Send a reminder' }).first().waitFor();
  await page.getByRole('button', { name: 'Send a reminder' }).first().click();
  await page.getByText('Reminder sent.').waitFor();
  const fu = await lastCall(page, 'work_update_follow_up');
  check(fu && fu.p_request === 'r1' && noSmuggling(fu), 'a reminder is sent for the request only (no role, no user id)', fu);
  await page.getByRole('button', { name: /Ravi Member/ }).first().click();
  check(await page.getByText(/Next reminder possible/).isVisible(), 'a reminder is not offered again at once (the next time is shown)');

  // ---- a task: Request update, the history and no duplicate request
  await page.evaluate(() => window.mountTask('t9'));
  await page.getByTestId('task-work-updates').waitFor();
  check(await page.getByText('Task assigned').isVisible() && await page.getByText('Progress update').isVisible(), 'the task history keeps the assignment and the earlier progress update');
  await page.getByRole('button', { name: 'Request update' }).click();
  await page.getByLabel('Message (optional)').fill('What is the current progress? Any blockers?');
  await page.getByRole('button', { name: 'Send request' }).click();
  await page.getByText(/Update requested from Nina Member/).waitFor();
  const rq = await lastCall(page, 'work_update_request');
  check(rq && rq.p_task === 't9' && rq.p_message === 'What is the current progress? Any blockers?' && Object.keys(rq).sort().join() === 'p_due,p_message,p_task',
    'the request carries only the task, the message and the deadline (the employee is the task\'s assignee, read by the database)', rq);
  await page.evaluate(() => window.mountTask('t1'));
  await page.getByTestId('task-work-updates').waitFor();
  check(await page.getByRole('button', { name: 'Request update' }).count() === 0, 'no second request is offered while one is waiting');
  check(await page.getByText('Work update requested').first().isVisible(), 'the request is in the task\'s timeline');

  // ---- phone width: nothing spills sideways
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pm = await phone.newPage();
  pm.on('pageerror', e => errors.push(String(e)));
  await pm.goto(base);
  await pm.evaluate(() => window.mountManager());
  await pm.getByRole('heading', { name: 'Work Updates' }).waitFor();
  await pm.getByText('Mia Member').waitFor();
  check(await pm.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'Work Updates fits a phone (no sideways scrolling)');

  // ---- Team Member: Update Requests
  await page.goto(base);
  await page.evaluate(() => {
    window.__state.requests.push({
      id: 'me1', taskId: 'tm1', taskTitle: 'Prepare the Q1 plan', taskDescription: 'Targets per team', taskStatus: 'IN_PROGRESS', taskProgress: 30, taskDueDate: null, priority: 'HIGH',
      requestedBy: 'tl1', requestedByName: 'Tara Lead', requestedFrom: 'me', requestedFromName: 'Me', employeeRole: 'TEAM_MEMBER', message: 'When do you expect to finish?',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(), status: 'PENDING', overdue: false, followupCount: 1, lastNotifiedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
      respondedAt: null, canRespond: true, canFollowUp: false, followUpAvailableAt: null, response: null
    });
    window.mountEmployee();
  });
  await page.getByRole('heading', { name: /Update Requests \(1\)/ }).waitFor();
  check(await page.getByText('Prepare the Q1 plan').isVisible() && await page.getByText('Targets per team').isVisible() && await page.getByText(/Requested by/).isVisible()
        && await page.getByText('When do you expect to finish?').isVisible() && await page.getByText(/reply by/).isVisible() && await page.getByText('In progress').first().isVisible(),
    'the employee sees the task, description, requester, date, message, deadline and current task status');
  check(await page.getByText('Respond to the update request').isVisible() && await page.getByText(/kept in the task history/).isVisible(), 'the form says the update is kept in the task history');
  const submit = page.getByRole('button', { name: 'Submit update' });
  check(await submit.isDisabled(), 'an empty update cannot be submitted');
  await page.getByLabel('Work completed since the last update *').fill('too short');
  check(await submit.isDisabled(), 'a meaningless one-word update cannot be submitted either');
  await page.getByLabel('Work completed since the last update *').fill('Three of five regions drafted');
  await page.getByLabel('Remaining work').fill('Two regions and the review');
  await page.getByLabel(/Blockers or issues/).fill('Waiting for the Pune figures');
  await page.getByLabel(/Expected completion date/).fill('2030-02-01');
  await submit.click();
  await page.getByText(/Update sent/).waitFor();
  const ans = await lastCall(page, 'submit_work_update');
  check(ans && ans.p_request === 'me1' && ans.p_task === 'tm1' && ans.p_status === 'IN_PROGRESS' && ans.p_progress === 30 && ans.p_expected === '2030-02-01' && ans.p_blockers === 'Waiting for the Pune figures'
        && Object.keys(ans).sort().join() === 'p_blockers,p_completed,p_expected,p_next,p_progress,p_remaining,p_request,p_status,p_task' && !/role|user|actor|employee|assignee|requested/i.test(Object.keys(ans).join(' ')),
    'the update is sent for that task and request only, never with a role, a user id or an assignee', ans);
  const task = await page.evaluate(() => window.__state.requests.find(r => r.id === 'me1').taskStatus);
  check(task === 'IN_PROGRESS', 'the task status is what the employee reported');
  await page.getByRole('button', { name: /Updates I sent/ }).click();
  check(await page.getByText('Three of five regions drafted').first().isVisible() && await page.getByText('Waiting for the Pune figures').first().isVisible(), 'the answer moves to "Updates I sent"');
  check(await page.getByText(/No one is waiting for an update from you/).isVisible(), 'and nothing is waiting any more');

  // phone: the answer form
  await pm.goto(base);
  await pm.evaluate(() => {
    window.__state.requests.push({
      id: 'me2', taskId: 'tm2', taskTitle: 'Reply to the e-mail backlog', taskDescription: null, taskStatus: 'ASSIGNED', taskProgress: 0, taskDueDate: null, priority: 'LOW', requestedBy: 'tl1',
      requestedByName: 'Tara Lead', requestedFrom: 'me', requestedFromName: 'Me', employeeRole: 'TEAM_MEMBER', message: null, dueAt: null, status: 'PENDING', overdue: false, followupCount: 0,
      lastNotifiedAt: new Date().toISOString(), createdAt: new Date().toISOString(), respondedAt: null, canRespond: true, canFollowUp: false, followUpAvailableAt: null, response: null
    });
    window.mountEmployee();
  });
  await pm.getByRole('heading', { name: /Update Requests/ }).waitFor();
  check(await pm.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth) && await pm.getByRole('button', { name: 'Submit update' }).isVisible(),
    'the Team Member\'s Update Requests and the answer form fit a phone');

  // a person nobody asked sees nothing
  const none = await ctx.newPage();
  none.on('pageerror', e => errors.push(String(e)));
  await none.goto(base);
  await none.evaluate(() => { window.__state.requests.length = 0; window.mountEmployee(); });
  await none.waitForTimeout(400);
  check(await none.getByRole('heading', { name: /Update Requests/ }).count() === 0, 'an employee nobody has asked sees no Update Requests section');

  check(errors.length === 0, 'no script errors', errors);
  console.log(`=== ${passed} WORK UPDATES BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
