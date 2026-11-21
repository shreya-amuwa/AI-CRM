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
const authStub = path.resolve('supabase/tests/ui/task_management_auth_stub.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/task_management_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); b.onResolve({ filter: /context\/AuthContext$/ }, () => ({ path: authStub })); } }]
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

  // ================= Task workspace (manager)
  await page.getByRole('button', { name: /Open Reply to the backlog/ }).click();
  const ws = page.getByRole('dialog', { name: 'Reply to the backlog' });
  await ws.getByRole('heading', { name: 'Task overview' }).waitFor();
  const box = await ws.boundingBox();
  check(box.width >= 1280 * 0.85 && box.height >= 900 * 0.85 && box.width <= 1280 && box.height <= 900, 'the workspace is large: it covers 85-95% of the screen, not a small popup', box);
  check(await ws.getByRole('heading', { name: 'Progress' }).isVisible() && await ws.getByRole('heading', { name: /^Work updates \(2\)/ }).isVisible()
        && await ws.getByRole('heading', { name: /^Update requests/ }).isVisible() && await ws.getByRole('heading', { name: 'Activity timeline' }).isVisible(),
    'it has Overview, Progress, Work updates, Update requests and Activity timeline sections');
  check(await ws.getByText(/^ID T-LATE$/).isVisible() && await ws.getByText('Support Executive · Support A', { exact: false }).first().isVisible() && await ws.getByText('Acme Traders').isVisible()
        && await ws.getByText('Call every customer with an open ticket.').isVisible(), 'the header and overview show the task id, the assignee with designation and team, the customer and the description');
  check(await ws.getByText('Updates submitted').isVisible() && await ws.getByText('Expected completion').first().isVisible() && await ws.getByText('Last progress update').isVisible(), 'the progress section shows the last update and the expected completion');
  const recs = ws.getByTestId('update-record');
  check(await recs.count() === 2 && /Started the calls/.test(await recs.first().innerText()) && /Waiting for the new call list/.test(await recs.last().innerText()), 'the work update history is in chronological order (oldest first)');
  await ws.getByRole('button', { name: 'Oldest first' }).click();
  check(/Waiting for the new call list/.test(await recs.first().innerText()) && await ws.getByText('Latest', { exact: true }).isVisible(), 'it can be flipped to newest first, and the latest update is marked');
  check(/Eight more calls/.test(await recs.first().innerText()) && /Resume tomorrow/.test(await recs.first().innerText()), 'each update shows work completed, remaining work, blockers and next steps');
  const tl = await ws.getByRole('list', { name: 'Activity timeline' }).innerText();
  check(/Task created/.test(tl) && /Task assigned/.test(tl) && /Status changed/.test(tl) && /Pending → In progress/.test(tl) && /In progress → Blocked/.test(tl) && /Progress update submitted/.test(tl),
    'the timeline lists created, assigned, status changes and progress updates with who and when');
  check(await ws.getByTestId('work-update-form').count() === 0 && await ws.getByRole('button', { name: 'Start task' }).count() === 0 && await ws.getByRole('button', { name: 'Update progress' }).count() === 0,
    'a manager cannot submit or start the employee\'s work');
  check(await ws.getByRole('button', { name: 'Request update' }).count() === 0 && await ws.getByTestId('request-card').count() === 1, 'while a request is waiting no second one is offered; the waiting request is listed');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  check(await page.getByTestId('tracker-task').count() === 5, 'closing the workspace returns to the task list');

  // ask for an update on a task from its workspace (footer action opens the form)
  await page.getByRole('button', { name: /Open Fix the billing mismatch/ }).click();
  const d2 = page.getByRole('dialog', { name: 'Fix the billing mismatch' });
  await d2.getByRole('heading', { name: 'Task overview' }).waitFor();
  await d2.getByRole('contentinfo', { name: 'Task actions' }).getByRole('button', { name: 'Request update' }).click();
  await d2.getByLabel('Message (optional)').fill('What is the current progress? Any blockers?');
  await d2.getByRole('button', { name: 'Send request' }).click();
  await page.getByText(/Update requested from Mia Member/).first().waitFor();
  const req = await lastCall(page, 'work_update_request');
  check(req && req.p_task === 't-urgent' && Object.keys(req).sort().join() === 'p_due,p_message,p_task' && noSmuggling(req), 'a request carries only the task, the message and the deadline (the employee is read by the database)', req);
  check(await d2.getByTestId('request-card').count() === 1 && await d2.getByTestId('request-card').getByText(/Please share the current progress/).isVisible() && await d2.getByText(/Waiting for a response/).isVisible(), 'the request is listed on the task with its message and status');
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
  await phone.getByRole('dialog').getByRole('heading', { name: 'Task overview' }).waitFor();
  const pb = await phone.getByRole('dialog').boundingBox();
  check(pb.width === 390 && pb.height === 800, 'on a phone the workspace is full screen', pb);
  check(await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth) && await phone.getByTestId('task-workspace').evaluate(el => el.scrollWidth <= el.clientWidth), 'the phone workspace has no sideways scrolling');
  check(await phone.getByRole('contentinfo', { name: 'Task actions' }).getByRole('button', { name: 'Request update' }).isVisible(), 'and the primary action stays reachable at the bottom');
  await pm.close();
  // tablet
  const tab = await browser.newContext({ viewport: { width: 820, height: 1000 } });
  const tp = await tab.newPage();
  tp.on('pageerror', e => errors.push(String(e)));
  await tp.goto(base);
  await tp.evaluate(([t, p]) => window.mountTracker(t, p, 'boss'), [tasks, people]);
  await tp.getByRole('button', { name: /Open Fix the billing mismatch/ }).click();
  await tp.getByRole('dialog').getByRole('heading', { name: 'Task overview' }).waitFor();
  const tbx = await tp.getByRole('dialog').boundingBox();
  check(tbx.width >= 820 * 0.85 && tbx.height >= 1000 * 0.85 && await tp.getByTestId('task-workspace').evaluate(el => el.scrollWidth <= el.clientWidth) && await tp.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    'on a tablet the workspace is large and nothing is clipped or scrolls sideways', tbx);
  await tab.close();

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
  await emp.getByText('This task is completed.').waitFor();
  check(await emp.getByText('This task is completed.').isVisible() && await emp.getByRole('button', { name: 'Submit work update' }).count() === 0, 'a completed task offers no more updates');

  // ================= Employee workspace: actions
  const emp2 = await ctx.newPage();
  emp2.on('pageerror', e => errors.push(String(e)));
  await emp2.goto(base);
  await emp2.evaluate(([t, p]) => { window.__state.viewer = 'employee'; window.mountTracker(t, p, 'emp', ['ALL', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'OVERDUE', 'AWAITING']); }, [tasks, people]);
  check(await emp2.getByRole('tab', { name: 'Assigned by Me' }).count() === 0, 'a Team Member is not offered "Assigned by Me"');
  await emp2.getByRole('button', { name: /Open Reply to the backlog/ }).click();
  const ed = emp2.getByRole('dialog', { name: 'Reply to the backlog' });
  await ed.getByRole('heading', { name: 'Task overview' }).waitFor();
  const acts = ed.getByRole('contentinfo', { name: 'Task actions' });
  check(await acts.getByRole('button', { name: 'Request update' }).count() === 0 && await acts.getByRole('button', { name: 'Start task' }).count() === 0
        && await acts.getByRole('button', { name: 'Update progress' }).isVisible() && await acts.getByRole('button', { name: 'Mark as blocked' }).isVisible() && await acts.getByRole('button', { name: 'Submit completion' }).isVisible()
        && await acts.getByRole('button', { name: 'Respond to request' }).isVisible(),
    'an employee on an in-progress task with a request sees Update progress, Mark as blocked, Submit completion and Respond to request, and no manager action');
  await acts.getByRole('button', { name: 'Mark as blocked' }).click();
  check(await ed.getByLabel('Current status').inputValue() === 'BLOCKED' && await ed.getByRole('button', { name: 'Submit update' }).isDisabled(), 'Mark as blocked opens the form on Blocked and sends nothing yet');
  check(await emp2.evaluate(() => window.__calls.filter(c => c.fn === 'submit_work_update').length) === 0, 'nothing was submitted by opening the form');
  await ed.getByRole('button', { name: 'Cancel' }).click();
  await acts.getByRole('button', { name: 'Submit completion' }).click();
  check(await ed.getByLabel('Current status').inputValue() === 'COMPLETED' && await ed.getByText('A completed task is 100%.').isVisible(), 'Submit completion opens the form on Completed at 100%');
  await ed.getByLabel('Work completed since the last update *').fill('Cleared the whole backlog today');
  await ed.getByRole('button', { name: 'Submit final update' }).click();
  await emp2.waitForFunction(() => window.__calls.some(c => c.fn === 'submit_work_update'));
  const fin = await lastCall(emp2, 'submit_work_update');
  check(fin && fin.p_status === 'COMPLETED' && fin.p_progress === 100 && fin.p_task === 't-late' && fin.p_request === null && noSmuggling(fin), 'completion is only sent by the explicit final update', fin);
  // a progress update never completes the task
  await acts.getByRole('button', { name: 'Update progress' }).click();
  check(await ed.getByLabel('Current status').inputValue() === 'IN_PROGRESS', 'Update progress opens on In progress, never on Completed');
  await ed.getByRole('button', { name: 'Cancel' }).click();
  await acts.getByRole('button', { name: 'Respond to request' }).click();
  await ed.getByLabel('Work completed since the last update *').fill('Cleared half of the backlog');
  await ed.getByRole('button', { name: 'Submit update' }).click();
  await emp2.waitForFunction(() => window.__calls.filter(c => c.fn === 'submit_work_update').length === 2);
  const ans = await lastCall(emp2, 'submit_work_update');
  check(ans && ans.p_request === 'req-t-late' && ans.p_task === 't-late' && ans.p_status === 'IN_PROGRESS', 'the answer is tied to the request it answers and is a progress update, not a completion', ans);

  // Start task: once, even when pressed twice
  const ep = await ctx.newPage();
  ep.on('pageerror', e => errors.push(String(e)));
  await ep.goto(base);
  await ep.evaluate(([t, p]) => { window.__state.viewer = 'employee'; window.__state.delay = 400; window.mountTracker(t, p, 'emp'); }, [tasks, people]);
  await ep.getByRole('button', { name: /Open Prepare the monthly deck/ }).click();
  const sd = ep.getByRole('dialog', { name: 'Prepare the monthly deck' });
  await sd.getByRole('heading', { name: 'Task overview' }).waitFor();
  const start = sd.getByRole('button', { name: 'Start task' });
  await start.dblclick();
  await ep.waitForFunction(() => window.__calls.some(c => c.fn === 'submit_task_update'));
  await ep.waitForTimeout(700);
  const starts = await ep.evaluate(() => window.__calls.filter(c => c.fn === 'submit_task_update').map(c => c.args));
  check(starts.length === 1 && starts[0].p_status === 'IN_PROGRESS' && starts[0].p_progress === 0 && noSmuggling(starts[0]), 'Start task sends one In progress update even when pressed twice', starts);

  // someone who may only read the task sees no actions
  const ro = await ctx.newPage();
  ro.on('pageerror', e => errors.push(String(e)));
  await ro.goto(base);
  await ro.evaluate(([t, p]) => { window.__state.viewer = 'reader'; window.mountTracker(t, p, 'boss'); }, [tasks, people]);
  await ro.getByRole('button', { name: /Open Reply to the backlog/ }).click();
  const rd = ro.getByRole('dialog', { name: 'Reply to the backlog' });
  await rd.getByRole('heading', { name: 'Task overview' }).waitFor();
  check(await rd.getByRole('contentinfo', { name: 'Task actions' }).count() === 0 && await rd.getByRole('button', { name: /Request update|Start task|Update progress|Submit completion|Mark as blocked/ }).count() === 0, 'a person who may only read the task is offered no actions');

  // loading failure: shown with a way to retry
  const er = await ctx.newPage();
  er.on('pageerror', e => errors.push(String(e)));
  await er.goto(base);
  await er.evaluate(([t, p]) => { window.__state.failDetails = 'Task not found.'; window.mountTracker(t, p, 'boss'); }, [tasks, people]);
  await er.getByRole('button', { name: /Open Reply to the backlog/ }).click();
  await er.getByRole('alert').getByText('Task not found.').waitFor();
  await er.evaluate(() => { window.__state.failDetails = null; });
  await er.getByRole('button', { name: 'Try again' }).click();
  await er.getByRole('dialog').getByRole('heading', { name: 'Task overview' }).waitFor();
  check(true, 'a failed load shows the error and Try again loads the task');

  // ================= The real Assigned Tasks pages: clicking a card opens the workspace
  const dbTask = (id, title, o = {}) => ({ id, department_id: 'd', team_id: 't', parent_id: null, customer_id: null, title, description: 'Plan and run it', priority: 'HIGH', due_date: '2999-01-01', assigned_by: 'boss',
    assignee_id: 'me', status: 'IN_PROGRESS', progress: 35, last_update_note: 'Working on the brief', last_update_at: new Date(Date.now() - 3600e3).toISOString(), completed_at: null, created_at: new Date().toISOString(),
    assignment_note: null, division: null, handling: null, ...o });
  const profiles = [{ id: 'me', full_name: 'Avantika Gaikwad', role: 'TEAM_MEMBER', team_id: 't', department_id: 'd', status: 'ACTIVE', position: 'Executive' }, { id: 'boss', full_name: 'Ashwini Rajput', role: 'TEAM_HEAD', team_id: 't', department_id: 'd', status: 'ACTIVE', position: 'Team Lead' }];
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(String(e)));
  await pg.goto(base);
  await pg.evaluate(([rows, ppl]) => { window.__profile = { id: 'me', role: 'TEAM_MEMBER', teamId: 't' }; window.__state.viewer = 'employee'; window.__tables.work_tasks.push(...rows); window.__tables.profiles.push(...ppl); window.mountMember(); },
    [[dbTask('d1', 'Do the campaign'), dbTask('d2', 'todo list share', { priority: 'MEDIUM', status: 'ASSIGNED', progress: 0 })], profiles]);
  await pg.getByRole('article', { name: 'Do the campaign' }).waitFor();
  // a control inside the card does its own job and does not open the workspace
  await pg.getByRole('article', { name: 'Do the campaign' }).getByRole('button', { name: 'Submit work update' }).click();
  check(await pg.getByRole('dialog').count() === 0 && await pg.getByTestId('work-update-form').isVisible(), 'a button inside the card works without opening the workspace');
  await pg.getByTestId('work-update-form').getByLabel('Work completed since the last update *').click();
  check(await pg.getByRole('dialog').count() === 0, 'typing in a field inside the card does not open the workspace either');
  await pg.getByRole('article', { name: 'Do the campaign' }).getByRole('button', { name: 'Cancel' }).click();
  // the card itself opens it
  await pg.getByRole('article', { name: 'Do the campaign' }).getByRole('heading', { name: 'Do the campaign' }).click();
  const pd = pg.getByRole('dialog', { name: 'Do the campaign' });
  await pd.getByRole('heading', { name: 'Task overview' }).waitFor();
  check(await pd.getByText('Plan and run it').isVisible() && await pd.getByText('35%').first().isVisible(), 'clicking a task card opens the workspace with that task\'s information and progress');
  await pd.getByRole('button', { name: 'Close task' }).click();
  check(await pg.getByRole('dialog').count() === 0 && await pg.getByRole('article', { name: 'Do the campaign' }).isVisible(), 'the close button returns to the task list');
  await pg.getByRole('article', { name: 'todo list share' }).click({ position: { x: 5, y: 5 } });
  check(await pg.getByRole('dialog', { name: 'todo list share' }).isVisible(), 'any part of the card opens its own task');
  await pg.keyboard.press('Escape');
  await pg.getByRole('article', { name: 'todo list share' }).focus();
  await pg.keyboard.press('Enter');
  check(await pg.getByRole('dialog', { name: 'todo list share' }).isVisible(), 'a card can also be opened from the keyboard');
  await pg.keyboard.press('Escape');

  // Team Lead page: its controls (expanders, buttons, check boxes) do not open it, the card does
  const tl2 = await ctx.newPage();
  tl2.on('pageerror', e => errors.push(String(e)));
  await tl2.goto(base);
  await tl2.evaluate(([rows, ppl]) => { window.__profile = { id: 'lead', role: 'TEAM_HEAD', teamId: 't' }; window.__state.viewer = 'employee'; window.__tables.work_tasks.push(...rows); window.__tables.profiles.push(...ppl); window.mountLead(); },
    [[dbTask('l1', 'Quarterly review pack', { assignee_id: 'lead', assigned_by: 'boss' })], [...profiles, { id: 'lead', full_name: 'Lena Lead', role: 'TEAM_HEAD', team_id: 't', department_id: 'd', status: 'ACTIVE', position: 'Team Lead' }]]);
  const lead = tl2.getByRole('article', { name: 'Quarterly review pack' });
  await lead.waitFor();
  await lead.getByRole('button', { name: 'Assign to myself' }).click();
  check(await tl2.evaluate(() => window.__calls.some(c => c.fn === 'take_task_myself')) && await tl2.getByRole('dialog', { name: 'Quarterly review pack' }).count() === 0, 'a Team Lead\'s card button (Assign to myself) does its job and does not open the workspace');
  await lead.getByText('Assign to team members').click();
  check(await tl2.getByRole('dialog').count() === 0, 'clicking inside the card\'s own assignment panel does not open the workspace');
  await lead.getByRole('heading', { name: 'Quarterly review pack' }).click();
  check(await tl2.getByRole('dialog', { name: 'Quarterly review pack' }).isVisible(), 'clicking the Team Lead\'s card opens the workspace');
  const tb = await tl2.getByRole('dialog').boundingBox();
  check(tb.width >= 1280 * 0.85, 'it is just as large on the Team Lead page', tb);

  check(errors.length === 0, 'no script errors', errors);
  console.log(`=== ${passed} TASK MANAGEMENT BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
