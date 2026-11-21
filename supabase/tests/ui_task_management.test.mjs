// Browser test of Task Management v2 (20270117000100): the assignment panel (validation, searchable people with avatars, chips, Urgent, loading, success and
// refusal), the task tracker (summary cards, the eight filters, search, overdue-first order), the task details panel (Overview, Work Progress, Update Requests,
// Activity Timeline, Request Update) and the employee's Submit Work Update form (what it refuses, and exactly what it sends), at desktop and phone width.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the task management browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/task_management_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/task_management_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
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
const countCalls = (page, fn) => page.evaluate(f => window.__calls.filter(c => c.fn === f).length, fn);
const noSmuggling = sent => sent && !/role|user|actor|employee|assignee|requested_by|requested_from|SUPER_ADMIN/i.test(Object.keys(sent).join(' '));
const PEOPLE = [
  { id: 'p1', name: 'Mia Member', designation: 'Support Executive', team: 'Support A' },
  { id: 'p2', name: 'Ravi Kumar', designation: 'Sales Associate', team: 'Support A' },
  { id: 'p3', name: 'Nina Shah', designation: 'Senior Executive', team: 'Support A' }
];
try {
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));

  // ================= Assign task panel
  await page.goto(base);
  await page.evaluate(p => window.mountAssign(p), PEOPLE);
  await page.getByRole('button', { name: 'Assign task' }).click();
  await page.getByRole('dialog', { name: 'Assign task' }).waitFor();
  check(await page.getByText('Task information').isVisible() && await page.getByText('Assignment', { exact: true }).isVisible(), 'the panel has a Task information and an Assignment section');
  check(await page.getByRole('radio').count() === 4 && await page.getByRole('radio', { name: 'Urgent' }).isVisible(), 'priority offers Low, Medium, High and Urgent');
  check(await page.getByText('Support Executive · Support A').isVisible() && await page.getByText('MM', { exact: true }).first().isVisible(), 'each person shows initials, name, designation and team');
  const dlg = page.getByRole('dialog', { name: 'Assign task' });
  await dlg.getByRole('button', { name: 'Assign task' }).click();
  check(await page.getByText('Give the task a title.').isVisible() && await page.getByText('Choose who the task is for.').isVisible(), 'submitting an empty form says what is missing');
  check(await page.evaluate(() => window.__assigned.length) === 0, 'nothing is sent while the form is invalid');
  await page.getByLabel('Task title *').fill('Call back customers');
  await page.getByLabel('Due date').fill('2001-01-01');
  await dlg.getByRole('button', { name: 'Assign task' }).click();
  check(await page.getByText('The due date cannot be in the past.').isVisible(), 'a due date in the past is refused');
  await page.getByLabel('Due date').fill('2999-01-01');
  // searchable people
  const pick = page.getByRole('listbox', { name: 'Assign to team members' });
  await page.getByPlaceholder('Search by name, designation or team').fill('sales');
  check(await pick.getByRole('option').count() === 1 && await pick.getByRole('option', { name: /Ravi Kumar/ }).isVisible(), 'the people list is searchable by designation');
  await page.getByPlaceholder('Search by name, designation or team').fill('zzz');
  check(await page.getByText(/No one matches/).isVisible(), 'a search with no match says so');
  await page.getByPlaceholder('Search by name, designation or team').fill('');
  await pick.getByRole('option', { name: /Mia Member/ }).click();
  await pick.getByRole('option', { name: /Ravi Kumar/ }).click();
  check(await page.getByRole('list', { name: 'Selected' }).getByText('Mia Member').isVisible() && await page.getByRole('list', { name: 'Selected' }).getByText('Ravi Kumar').isVisible(), 'the chosen people are shown as chips');
  await page.getByRole('button', { name: 'Remove Ravi Kumar' }).click();
  check(await page.getByRole('list', { name: 'Selected' }).getByText('Ravi Kumar').count() === 0, 'a chip can be removed');
  await pick.getByRole('option', { name: /Nina Shah/ }).click();
  await page.getByRole('radio', { name: 'Urgent' }).click();
  await page.getByLabel('Related customer (optional)').selectOption('c1');
  // refusal from the database is shown and nothing is lost
  await page.evaluate(() => { window.__failAssign = 'You can only assign tasks to your own team members.'; });
  await dlg.getByRole('button', { name: 'Assign to 2 people' }).click();
  await page.getByRole('button', { name: 'Assigning…' }).waitFor();
  check(await page.getByRole('button', { name: 'Assigning…' }).isDisabled(), 'the button shows a loading state and cannot be pressed twice');
  await page.getByText('You can only assign tasks to your own team members.').waitFor();
  check(await page.getByLabel('Task title *').inputValue() === 'Call back customers', 'a refusal is shown and the form keeps what was typed');
  await dlg.getByRole('button', { name: 'Assign to 2 people' }).click();
  await page.getByText('Task assigned to 2 team members.').waitFor();
  const sent = await page.evaluate(() => window.__assigned[0]);
  check(sent && sent.title === 'Call back customers' && sent.priority === 'URGENT' && sent.dueDate === '2999-01-01' && sent.customerId === 'c1' && sent.assigneeIds.join() === 'p1,p3',
    'the task is sent with the title, Urgent priority, due date, customer and the chosen people', sent);
  check(await page.getByRole('dialog').count() === 0, 'the panel closes and the success message stays');

  // ================= Tracker
  const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const T = (id, title, o = {}) => ({ id, departmentId: 'd', teamId: null, parentId: null, customerId: null, title, description: null, priority: 'MEDIUM', dueDate: null, assignedBy: 'boss', assigneeId: 'emp',
    status: 'ASSIGNED', progress: 0, lastUpdateNote: null, lastUpdateAt: null, completedAt: null, createdAt: new Date().toISOString(), assignmentNote: null, division: null, handling: null, ...o });
  const tasks = [
    T('t-soon', 'Prepare the monthly deck', { dueDate: day(2), assigneeId: 'e2' }),
    T('t-urgent', 'Fix the billing mismatch', { priority: 'URGENT', dueDate: day(9), status: 'IN_PROGRESS', progress: 55, lastUpdateAt: new Date(Date.now() - 3 * 3600e3).toISOString(), lastUpdateNote: 'Found the cause' }),
    T('t-late', 'Reply to the backlog', { dueDate: day(-4), status: 'IN_PROGRESS', progress: 30, lastUpdateAt: new Date(Date.now() - 50 * 3600e3).toISOString() }),
    T('t-blocked', 'Migrate the old contacts', { status: 'BLOCKED', progress: 20, priority: 'HIGH' }),
    T('t-done', 'Send the welcome pack', { status: 'COMPLETED', progress: 100, dueDate: day(-10) })
  ];
  const people = [{ id: 'emp', fullName: 'Mia Member' }, { id: 'e2', fullName: 'Ravi Kumar' }, { id: 'boss', fullName: 'Tara Lead' }];
  await page.goto(base);
  await page.evaluate(([t, p]) => window.mountTracker(t, p, 'boss'), [tasks, people]);
  await page.getByTestId('task-tracker').waitFor();
  const stat = async label => (await page.getByRole('button', { name: new RegExp(`^${label}\\s*\\d+$`) }).first().innerText()).replace(/\D+/g, '');
  check(await stat('Total tasks') === '5' && await stat('Assigned') === '1' && await stat('In progress') === '2' && await stat('Blocked') === '1' && await stat('Completed') === '1' && await stat('Overdue') === '1',
    'the summary cards count total, assigned, in progress, blocked, completed and overdue');
  await page.getByRole('button', { name: /^Awaiting update\s*1$/ }).waitFor();
  check(await page.getByRole('button', { name: /^Awaiting update\s*1$/ }).isVisible(), 'awaiting update counts the task with an open update request');
  const order = async () => page.getByTestId('tracker-task').evaluateAll(els => els.map(e => e.getAttribute('aria-label').replace(/^Open /, '')));
  const o = await order();
  check(o[0] === 'Reply to the backlog' && o[1] === 'Fix the billing mismatch' && o.at(-1) === 'Send the welcome pack', 'overdue first, then Urgent / High, finished last', o);
  const first = page.getByTestId('tracker-task').first();
  check(await first.getByText('Overdue').first().isVisible() && await first.getByText('Awaiting update').isVisible() && await first.getByText(/Last update: 2d ago/).isVisible(), 'a card shows overdue, awaiting update and the time of the last update');
  await page.getByRole('tab', { name: 'Blocked' }).click();
  check(await page.getByTestId('tracker-task').count() === 1 && await page.getByText('Migrate the old contacts').first().isVisible(), 'the Blocked filter lists blocked tasks only');
  await page.getByRole('tab', { name: 'Overdue' }).click();
  check(await page.getByTestId('tracker-task').count() === 1, 'the Overdue filter lists open tasks past their due date (a late completed one is not overdue)');
  await page.getByRole('tab', { name: 'Awaiting Update' }).click();
  check(await page.getByTestId('tracker-task').count() === 1, 'the Awaiting Update filter lists tasks somebody is waiting on');
  await page.getByRole('tab', { name: 'Assigned by Me' }).click();
  check(await page.getByTestId('tracker-task').count() === 5, 'Assigned by Me lists what this person gave out');
  await page.getByRole('tab', { name: 'All Tasks' }).click();
  await page.getByLabel('Search tasks').fill('ravi');
  check(await page.getByTestId('tracker-task').count() === 1 && await page.getByText('Prepare the monthly deck').first().isVisible(), 'search finds a task by the employee name');
  await page.getByLabel('Search tasks').fill('billing');
  check(await page.getByTestId('tracker-task').count() === 1, 'search finds a task by its title');
  await page.getByLabel('Search tasks').fill('nothing like this');
  check(await page.getByText('No tasks match').isVisible(), 'no match says so');
  await page.getByLabel('Search tasks').fill('');

  // ================= Task details (manager)
  await page.getByRole('button', { name: /Open Reply to the backlog/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Reply to the backlog' });
  await drawer.getByRole('tab', { name: 'Overview' }).waitFor();
  check(await drawer.getByRole('tab').count() === 4, 'the details panel has Overview, Work Progress, Update Requests and Activity Timeline');
  check(await drawer.getByText('Support Executive · Support A · Wabastore').isVisible() && await drawer.getByText('Acme Traders').isVisible() && await drawer.getByText('Call every customer with an open ticket.').isVisible(), 'Overview shows the description, the assignee with designation and team, and the customer');
  check(await drawer.getByText('Blocked:').isVisible() === false, 'the blocked banner follows the task status (this task is not blocked)');
  await drawer.getByRole('tab', { name: /Work Progress/ }).click();
  const recs = drawer.getByTestId('update-record');
  check(await recs.count() === 2 && await recs.first().getByText('Waiting for the new call list').isVisible() && await recs.first().getByText('Eight more calls').isVisible() && await recs.first().getByText('Resume tomorrow').isVisible(),
    'Work Progress keeps every update as its own record (progress, work done, remaining, blockers, next steps), newest first');
  check(await drawer.getByTestId('work-update-form').count() === 0, 'a manager cannot submit a work update for the employee');
  await drawer.getByRole('tab', { name: 'Activity Timeline' }).click();
  const tl = (await drawer.getByRole('tabpanel', { name: 'Activity Timeline' }).innerText());
  check(/Task created/.test(tl) && /Task assigned/.test(tl) && /Progress update/.test(tl), 'the timeline lists created, assigned and progress events');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });

  // ask for an update on a task from its details
  await page.getByRole('button', { name: /Open Fix the billing mismatch/ }).click();
  const d2 = page.getByRole('dialog', { name: 'Fix the billing mismatch' });
  await d2.getByRole('tab', { name: 'Overview' }).waitFor();
  await d2.getByRole('button', { name: 'Request update' }).first().click();
  await d2.getByLabel('Message (optional)').fill('What is the current progress? Any blockers?');
  await d2.getByRole('button', { name: 'Send request' }).click();
  await page.getByText(/Update requested from Mia Member/).first().waitFor();
  const req = await lastCall(page, 'work_update_request');
  check(req && req.p_task === 't-urgent' && Object.keys(req).sort().join() === 'p_due,p_message,p_task' && noSmuggling(req), 'a request carries only the task, the message and the deadline (the employee is read by the database)', req);
  await d2.getByRole('tab', { name: /Update Requests/ }).click();
  check(await d2.getByTestId('request-card').count() === 1 && await d2.getByText('Please share the current progress.').isVisible(), 'the request is listed on the task');
  await page.keyboard.press('Escape');

  // phone
  const pm = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true });
  const phone = await pm.newPage();
  phone.on('pageerror', e => errors.push(String(e)));
  await phone.goto(base);
  await phone.evaluate(([t, p]) => window.mountTracker(t, p, 'boss'), [tasks, people]);
  await phone.getByTestId('task-tracker').waitFor();
  check(await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'the tracker fits a phone (no sideways scrolling)');
  await phone.getByRole('button', { name: /Open Fix the billing mismatch/ }).click();
  await phone.getByRole('dialog').getByRole('tab', { name: 'Overview' }).waitFor();
  check(await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'and so does the details panel');
  await pm.close();

  // ================= Employee: Submit Work Update
  const emp = await ctx.newPage();
  emp.on('pageerror', e => errors.push(String(e)));
  await emp.goto(base);
  await emp.evaluate(() => { window.__state.viewer = 'employee'; window.mountUpdate('IN_PROGRESS', 30); });
  await emp.getByRole('button', { name: 'Submit work update' }).click();
  const submit = emp.getByRole('button', { name: 'Submit update' });
  check(await submit.isDisabled() && await emp.getByText(/at least 10 characters/).isVisible(), 'an empty update cannot be submitted');
  await emp.getByLabel('Work completed since the last update *').fill('done');
  check(await submit.isDisabled(), 'a meaningless update cannot be submitted');
  await emp.getByLabel('Current status').selectOption('BLOCKED');
  check(await emp.getByText(/Explain what is blocking the task/).isVisible() && await submit.isDisabled(), 'Blocked needs the blocker explained');
  await emp.getByLabel(/Blockers or issues/).fill('Waiting for the new call list');
  check(await submit.isEnabled(), 'with the blocker explained it can be sent');
  await emp.getByLabel('Current status').selectOption('COMPLETED');
  check(await emp.getByText('A completed task is 100%.').isVisible() && await emp.getByText('Progress: 100%').isVisible(), 'Completed is always 100%');
  await emp.getByLabel('Current status').selectOption('IN_PROGRESS');
  check(await emp.getByText(/Progress: 30%/).isVisible(), 'going back to In progress keeps the real progress, never 100%');
  await emp.getByLabel('Work completed since the last update *').fill('Called twelve customers today');
  await emp.getByLabel('Remaining work').fill('Eight more calls');
  await emp.getByLabel('Next steps').fill('Resume tomorrow');
  await emp.getByLabel(/Expected completion date/).fill('2999-02-01');
  await submit.click();
  await emp.getByText(/Work update submitted/).waitFor();
  const u = await lastCall(emp, 'submit_work_update');
  check(u && u.p_task === 't-1' && u.p_status === 'IN_PROGRESS' && u.p_progress === 30 && u.p_completed === 'Called twelve customers today' && u.p_remaining === 'Eight more calls'
        && u.p_next === 'Resume tomorrow' && u.p_expected === '2999-02-01' && u.p_request === null && noSmuggling(u), 'the update sends the status, the progress and the text fields, and no role or user id', u);
  check(await emp.evaluate(() => window.__sent) === 1, 'the page is told to refresh');
  await emp.getByRole('button', { name: 'Submit work update' }).click();
  await emp.evaluate(() => { window.__state.failNext = 'You are not assigned to this task.'; });
  await emp.getByLabel('Work completed since the last update *').fill('Another real piece of work');
  await emp.getByRole('button', { name: 'Submit update' }).click();
  await emp.getByText('You are not assigned to this task.').waitFor();
  check(await emp.getByLabel('Work completed since the last update *').inputValue() === 'Another real piece of work', 'a refusal from the database is shown and the text is kept');
  await emp.evaluate(() => window.mountUpdate('COMPLETED', 100));
  check(await emp.getByText('This task is completed.').isVisible() && await emp.getByRole('button', { name: 'Submit work update' }).count() === 0, 'a completed task offers no more updates');

  // employee details panel: can update, cannot request, answers a request from the panel
  const emp2 = await ctx.newPage();
  emp2.on('pageerror', e => errors.push(String(e)));
  await emp2.goto(base);
  await emp2.evaluate(([t, p]) => { window.__state.viewer = 'employee'; window.mountTracker(t, p, 'emp', ['ALL', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'OVERDUE', 'AWAITING']); }, [tasks, people]);
  check(await emp2.getByRole('tab', { name: 'Assigned by Me' }).count() === 0, 'a Team Member is not offered "Assigned by Me"');
  await emp2.getByRole('button', { name: /Open Reply to the backlog/ }).click();
  const ed = emp2.getByRole('dialog', { name: 'Reply to the backlog' });
  await ed.getByRole('tab', { name: 'Overview' }).waitFor();
  check(await ed.getByRole('button', { name: 'Request update' }).count() === 0 && await ed.getByRole('button', { name: 'Submit work update' }).isVisible(), 'the employee can submit an update but not request one');
  await ed.getByRole('tab', { name: /Update Requests/ }).click();
  check(await ed.getByTestId('work-update-form').isVisible() && await ed.getByText('Respond to the update request').isVisible(), 'the employee responds to that specific request from the Update Requests tab');
  await ed.getByLabel('Work completed since the last update *').fill('Cleared half of the backlog');
  await ed.getByRole('button', { name: 'Submit update' }).click();
  await emp2.waitForFunction(() => window.__calls.some(c => c.fn === 'submit_work_update'));
  const ans = await lastCall(emp2, 'submit_work_update');
  check(ans && ans.p_request === 'req-t-late' && ans.p_task === 't-late', 'the answer is tied to the request it answers', ans);
  check(errors.length === 0, 'no script errors', errors);
  console.log(`=== ${passed} TASK MANAGEMENT BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
