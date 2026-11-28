// Browser test of bugs for the Developers team (20270122000300, 20270122000400), with each of the three developer accounts: an employee
// reports bugs; Shreya Mande (Team Lead), Ashish Sinha and Siddhesh Shinde all see and work on every bug (20270312000400: no mandatory assignee; only
// Shreya may name an optional primary contact); each adds progress updates that are kept with their author; contributors, progress and a conflict on an
// out-of-date screen are shown; a bug nobody was assigned to is resolved; the employee follows it. Issue routing (20270128000200): the two recipients (HR or the Developer Team, no
// meeting request), category and priority, the conversation (a developer asks for information, the employee answers), whole rows that open,
// and HR's Raise an Issue page (report to the Developer Team with the affected department / employee; escalate an employee issue once).
// Real React components and the real dashboard shell, real Chromium; the CRM API is answered in the page like the database
// (supabase/tests/ui/bugs_harness.tsx).
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the bugs browser test did not run'); process.exit(0); }
const work = mkdtempSync(path.join(tmpdir(), 'bug-ui-'));
const out = path.join(work, 'app.js');
await build({
  entryPoints: ['supabase/tests/ui/bugs_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' },
  jsx: 'automatic', logLevel: 'error', loader: { '.css': 'empty' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: path.resolve('supabase/tests/ui/meeting_presence_supabase_stub.ts') }));
    b.onResolve({ filter: /\/context\/AuthContext$/ }, () => ({ path: path.resolve('supabase/tests/ui/chat_extras_auth_stub.ts') }));
  } }]
});
const bundle = readFileSync(out, 'utf8');
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const css = cssFile ? readFileSync(path.join('dist/assets', cssFile), 'utf8') : '';

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }
const errors = [];
const open = async (page, who) => {
  await page.evaluate(w => window.mount(w), who);
  await page.waitForSelector('nav', { state: 'attached' });
  await page.waitForFunction(() => window.__calls.some(c => c.path === '/api/v1/bugs/access'));
  await page.waitForTimeout(200);
};
const newPage = async (viewport = { width: 1280, height: 1000 }) => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('http://bug.test/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div id="root"></div></body></html>' }));
  await page.goto('http://bug.test/');
  await page.addScriptTag({ content: bundle });
  return page;
};
const navHas = (page, label) => page.locator('nav button', { hasText: label }).count();

const reset = page => page.evaluate(() => window.signOut());
const rows = page => page.$$eval('[data-testid="bug-row"]', rs => rs.map(r => r.innerText));
const openBugs = async page => { await page.locator('nav button', { hasText: 'Bugs' }).click(); await page.waitForSelector('[data-testid="bugs-page"]'); await page.waitForTimeout(250); };

try {
  const page = await newPage();
  // ---- an employee reports two bugs from Raise an Issue (no Bugs in their menu)
  await open(page, 'employee');
  check(await navHas(page, 'Bugs') === 0 && await navHas(page, 'Meetings') === 1, 'an employee has no Bugs in the menu');
  // two recipients, each clearly named; no meeting request on this page any more
  await page.waitForSelector('[data-testid="recipient-hr"]');
  const opts = await page.$$eval('[data-testid="case-type"] [role="radio"] span.font-bold', xs => xs.map(x => x.textContent));
  check(JSON.stringify(opts) === JSON.stringify(['Raise an Issue to HR', 'Raise an Issue to Developer Team']) && !(await page.locator('[data-testid="meeting-form"]').count()),
    'Raise an Issue offers two recipients: HR or the Developer Team (no meeting request)', opts);
  await page.waitForSelector('[data-testid="my-case-row"]');
  const hrRows = await page.$$eval('[data-testid="my-case-row"]', rs => rs.map(r => r.innerText));
  check(hrRows.some(r => /Leave balance looks wrong/.test(r) && /Escalated to Developer Team · In Progress/.test(r)) && hrRows.some(r => /The CRM logs me out/.test(r) && /To: HR/.test(r)),
    'each issue to HR says where it is: with HR, or escalated to the Developer Team with their status', hrRows);
  await page.click('[data-testid="recipient-dev"]');
  await page.waitForSelector('[data-testid="bug-form"]');
  check(await page.getAttribute('[data-testid="recipient-dev"]', 'aria-checked') === 'true' && !(await page.locator('[data-testid="issue-form"]').count()), 'choosing the Developer Team shows only its form');
  await page.click('[data-testid="submit-bug"]');
  await page.waitForSelector('text=Give the issue a title');
  check(!(await page.evaluate(() => window.__calls.some(c => c.method === 'POST' && c.path === '/api/v1/bugs'))), 'an incomplete form is not sent');
  for (const [t, d] of [['Invoice PDF is blank', 'The invoice PDF opens with an empty page for every customer.'], ['Ticket list is slow', 'Opening the ticket list takes more than a minute.']]) {
    await page.fill('#bug-title', t);
    await page.fill('#bug-description', d);
    if (t === 'Ticket list is slow') { await page.selectOption('#bug-category', 'PERFORMANCE'); await page.selectOption('#bug-priority', 'HIGH'); }
    await page.click('[data-testid="submit-bug"]');
    await page.waitForFunction(n => document.querySelectorAll('[data-testid="my-bug-row"]').length === n, t === 'Invoice PDF is blank' ? 1 : 2);
  }
  check(true, 'two issues sent to the Developer Team, both in the employee\'s list');
  const sent = await page.evaluate(() => window.__calls.filter(c => c.method === 'POST' && c.path === '/api/v1/bugs').map(c => c.body));
  check(sent[1].category === 'PERFORMANCE' && sent[1].priority === 'HIGH' && sent[0].category === 'BUG' && sent[0].priority === 'MEDIUM' && !('affectedEmployeeId' in sent[0]),
    'the category and priority are sent (an employee names no affected employee)', sent);

  // ---- every bug is seen by all three developers: Shreya, Ashish AND Siddhesh (nothing is assigned, nothing has to be)
  for (const [who, name] of [['dev', 'Shreya'], ['ashish', 'Ashish'], ['siddhesh', 'Siddhesh']]) {
    await reset(page);
    await open(page, who);
    check(await navHas(page, 'Bugs') === 1, `${name} has "Bugs" in the menu`);
    await openBugs(page);
    const r = await rows(page);
    check(r.length === 2 && r.some(x => /Invoice PDF is blank/.test(x) && /Priya Sales/.test(x) && /Wabastore/.test(x) && /0%/.test(x) && /No update yet/.test(x)) && r.some(x => /Ticket list is slow/.test(x)) && !r.some(x => /Unassigned/.test(x)),
      `${name} sees both new bugs with the employee's details, 0% progress and nobody assigned`, r);
  }
  // Siddhesh (still signed in) opens a new bug: the progress form, replies and requests for information; no assignment control
  await page.click('button[aria-label^="Open BUG-2026-00001"]');
  await page.waitForSelector('[data-testid="bug-drawer"] >> text=The invoice PDF opens with an empty page');
  check(!(await page.locator('#bug-assignee').count()) && await page.isVisible('[data-testid="bug-progress-form"]') && !(await page.locator('[data-testid="status-locked"]').count()),
    'a developer has no assignment control, but can update any bug at once (nobody has to be assigned first)');
  check(await page.locator('[data-testid="ask-info"]').count() === 1 && await page.isVisible('[data-testid="bug-reply"]'), 'he can reply to the reporter and ask for information');
  check(/Nobody yet/.test(await page.innerText('[data-testid="bug-contributor-list"]')) && /No progress update yet/.test(await page.innerText('[data-testid="bug-latest-update"]')), 'the bug shows no contributor and no update yet');
  const statuses = await page.$$eval('#bug-status option', os => os.map(o => o.textContent));
  check(JSON.stringify(statuses) === JSON.stringify(['Pending', 'Under Review', 'In Progress', 'Testing', 'Pending Information', 'Resolved', 'Rejected', 'Closed']), 'the statuses include Testing next to the existing ones', statuses);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  // the whole row opens a bug (here: a click on the reporter's name)
  await page.click('[data-testid="bug-row"]:has-text("Ticket list is slow") >> text=Priya Sales');
  await page.waitForSelector('[data-testid="bug-drawer"] >> text=Opening the ticket list takes more than a minute');
  check(/High/.test(await page.innerText('[data-testid="bug-drawer"] [data-testid="bug-tags"]')), 'clicking anywhere on the row opens it, with its priority');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // ---- Shreya (Team Lead) may name an optional primary contact; it hides nothing
  await reset(page);
  await open(page, 'dev');
  await openBugs(page);
  check(/whole team works on them together/.test(await page.innerText('[data-testid="bugs-page"]')), 'the Bugs page says the team works on the bugs together');
  await page.click('button[aria-label^="Open BUG-2026-00001"]');
  await page.waitForSelector('#bug-assignee');
  const contacts = await page.$$eval('#bug-assignee option', os => os.map(o => o.textContent));
  check(contacts.length === 3 && contacts[0].startsWith('None') && contacts.includes('Ashish Sinha') && contacts.includes('Siddhesh Shinde') && !contacts.includes('Shreya Mande'), 'her optional primary-contact list: none, Ashish Sinha or Siddhesh Shinde', contacts);
  await page.selectOption('#bug-assignee', 'd2');
  await page.waitForSelector('text=is the primary contact');
  check(/Named by Shreya Mande/.test(await page.innerText('[data-testid="bug-assignment"]')), 'the primary contact is named, with who and when');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await page.waitForSelector('[data-testid="team-workload"]');
  const wl = await page.innerText('[data-testid="team-workload"]');
  check(/Shreya Mande\s*0 progress updates/.test(wl) && /Ashish Sinha\s*0 progress updates/.test(wl) && /Siddhesh Shinde\s*0 progress updates/.test(wl), 'the team panel lists the three developers with their updates', wl);
  check((await rows(page)).length === 2, 'and she still sees both bugs');

  // ---- Ashish (the primary contact) asks the reporter for information; the others still see the bug
  await reset(page);
  await open(page, 'ashish');
  await openBugs(page);
  let r = await rows(page);
  check(r.length === 2, 'Ashish sees both bugs', r);
  await page.click('button[aria-label^="Open BUG-2026-00001"]');
  await page.waitForSelector('[data-testid="ask-info"]');
  await page.fill('#bug-reply-text', 'Which customer was it? Please send the invoice number.');
  await page.click('[data-testid="ask-info"]');
  await page.waitForSelector('[data-testid="bug-drawer"] [data-testid="bug-status"][data-status="NEEDS_INFO"]');
  check(/The developers asked for information/.test(await page.innerText('[data-testid="bug-history"]')), 'a developer asks the reporter for information: Pending Information');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  // the employee answers: back to the developers
  await reset(page);
  await open(page, 'employee');
  await page.click('[data-testid="recipient-dev"]');
  await page.waitForSelector('[data-testid="my-bug-row"]:has-text("waiting for your reply")');
  await page.click('[data-testid="my-bug-row"]:has-text("Invoice PDF is blank")');
  await page.waitForSelector('[data-testid="my-bug-dialog"] >> text=Which customer was it?');
  await page.fill('#bug-follow-up-text', 'Sharma Traders, invoice INV-2026-0042.');
  await page.click('[data-testid="send-follow-up"]');
  await page.waitForSelector('text=Sent. Status: In Progress.');
  check(/Message from the reporter/.test(await page.innerText('[data-testid="my-bug-dialog"] [data-testid="bug-history"]')), 'the employee answers; the issue goes back to the developers (In Progress)');

  // ---- the three developers add progress updates to the same bug
  const addUpdate = async (who, workText, status, progress, notes) => {
    await reset(page);
    await open(page, who);
    await openBugs(page);
    await page.click('button[aria-label^="Open BUG-2026-00001"]');
    await page.waitForSelector('[data-testid="bug-progress-form"]');
    await page.fill('#bug-work', workText);
    await page.selectOption('#bug-status', status);
    await page.fill('#bug-progress', String(progress));
    if (notes) await page.fill('#bug-notes', notes);
    await page.click('[data-testid="bug-save-update"]');
    await page.waitForSelector('text=Progress update saved.');
  };
  await addUpdate('ashish', 'Reproduced with INV-2026-0042: the PDF font is missing', 'IN_PROGRESS', 30, 'Needs the embedded font');
  check(await page.inputValue('#bug-work') === '' && await page.inputValue('#bug-notes') === '' && /30%/.test(await page.innerText('[data-testid="bug-drawer"] [data-testid="bug-progress"]')), 'after saving, the form is empty again and the bar shows 30%');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await addUpdate('siddhesh', 'Embedded the font in the PDF template', 'TESTING', 60);
  check(await page.isVisible('[data-testid="bug-drawer"] [data-testid="bug-status"][data-status="TESTING"]'), 'Siddhesh (not the primary contact) moves the bug to Testing, 60%');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await addUpdate('dev', 'Reviewed the fix on staging', 'TESTING', 75, 'Ready once Accounts confirms');
  const drawer = await page.innerText('[data-testid="bug-drawer"]');
  const contrib = await page.innerText('[data-testid="bug-contributor-list"]');
  check(/Ashish Sinha/.test(contrib) && /Siddhesh Shinde/.test(contrib) && /Shreya Mande/.test(contrib), 'the bug lists all three contributors', contrib);
  check(/Shreya Mande/.test(await page.innerText('[data-testid="bug-latest-update"]')) && /Reviewed the fix on staging/.test(await page.innerText('[data-testid="bug-latest-update"]')), 'the latest update names who made it');
  check(await page.getAttribute('[data-testid="bug-drawer"] [data-testid="bug-progress"]', 'data-progress') === '75', 'the overall progress is 75%');
  const hist = await page.$$eval('[data-testid="bug-history"] li[data-kind="PROGRESS"]', ls => ls.map(l => l.innerText));
  check(hist.length === 3 && /Reproduced with INV-2026-0042/.test(hist[0]) && /Ashish Sinha/.test(hist[0]) && /Needs the embedded font/.test(hist[0]) && /Embedded the font/.test(hist[1]) && /Siddhesh Shinde/.test(hist[1])
    && /Reviewed the fix/.test(hist[2]) && /Shreya Mande/.test(hist[2]) && /Pending → In Progress|In Progress → Testing/.test(hist.join(' ')) && /30% → 60%/.test(hist[1]),
    'the history keeps three separate progress updates, each with its author, notes and what changed', hist);
  check(/Created/.test(drawer) && /High|Medium/.test(await page.innerText('[data-testid="bug-drawer"] [data-testid="bug-tags"]')) && /description/i.test(drawer), 'the bug shows its created date, priority and description');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  let tr = await rows(page);
  check(/75%/.test(tr.find(x => /Invoice PDF is blank/.test(x))) && /Ashish Sinha/.test(tr.find(x => /Invoice PDF is blank/.test(x))), 'the list shows the progress and the contributors', tr);

  // ---- a colleague saved first: the old screen is told, nothing is overwritten
  await reset(page);
  await open(page, 'siddhesh');
  await openBugs(page);
  await page.click('button[aria-label^="Open BUG-2026-00001"]');
  await page.waitForSelector('[data-testid="bug-progress-form"]');
  await page.evaluate(async () => {
    const mine = window.__profile;
    window.__profile = { ...mine, id: 'd2', fullName: 'Ashish Sinha' };
    const v = (await (await fetch('/api/v1/bugs/b1')).json()).data.version;
    await fetch('/api/v1/bugs/b1/updates', { method: 'POST', body: JSON.stringify({ work: 'Verified on production data', status: 'TESTING', progress: 90, expectedVersion: v }) });
    window.__profile = mine;
  });
  await page.fill('#bug-work', 'Closing the loop from my old screen');
  await page.selectOption('#bug-status', 'IN_PROGRESS');
  await page.fill('#bug-progress', '10');
  await page.click('[data-testid="bug-save-update"]');
  await page.waitForSelector('[data-testid="bug-reload"]');
  check(/Another developer updated this bug/.test(await page.innerText('[data-testid="bug-drawer"] [role="alert"]')), 'saving from an out-of-date screen shows a clear conflict message');
  check(await page.inputValue('#bug-work') === 'Closing the loop from my old screen', 'and what he typed is kept');
  await page.click('[data-testid="bug-reload"]');
  await page.waitForFunction(() => document.querySelector('[data-testid="bug-drawer"] [data-testid="bug-progress"]')?.getAttribute('data-progress') === '90');
  check(/Verified on production data/.test(await page.innerText('[data-testid="bug-history"]')), 'loading the latest version shows his colleague\'s update (90%, not overwritten)');
  await page.fill('#bug-progress', '95');
  await page.selectOption('#bug-status', 'TESTING');
  await page.dblclick('[data-testid="bug-save-update"]');
  await page.waitForSelector('text=Progress update saved.');
  await page.waitForTimeout(300);
  const progressEntries = await page.$$eval('[data-testid="bug-history"] li[data-kind="PROGRESS"]', ls => ls.length);
  check(progressEntries === 5 && await page.getAttribute('[data-testid="bug-drawer"] [data-testid="bug-progress"]', 'data-progress') === '95',
    'saving again works, and a double click stores one update (five in all: three, his colleague\'s, his own)', progressEntries);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // ---- Siddhesh resolves the other bug through the same form
  await page.click('button[aria-label^="Open BUG-2026-00002"]');
  await page.waitForSelector('#bug-status');
  await page.selectOption('#bug-status', 'RESOLVED');
  check(await page.isDisabled('[data-testid="bug-save-update"]'), 'resolving needs the update text first');
  await page.fill('#bug-work', 'Added an index; the list opens in a second.');
  check(!(await page.isDisabled('[data-testid="bug-save-update"]')) && await page.inputValue('#bug-progress') !== '', 'then it can be saved');
  await page.fill('#bug-progress', '100');
  await page.click('[data-testid="bug-save-update"]');
  await page.waitForSelector('[data-testid="bug-drawer"] [data-testid="bug-status"][data-status="RESOLVED"]');
  check(await page.getAttribute('[data-testid="bug-drawer"] [data-testid="bug-progress"]', 'data-progress') === '100', 'Siddhesh resolves a bug nobody was assigned to: 100%');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'nothing runs off the screen');

  // ---- Shreya monitors the result; the employee sees the resolution, never internal comments or the work log
  await reset(page);
  await open(page, 'dev');
  await openBugs(page);
  await page.click('[role="tab"]:has-text("Resolved")');
  await page.waitForSelector('[data-testid="bug-row"]:has-text("Ticket list is slow")');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="bug-row"]').length === 1);
  check(/Resolved/.test((await rows(page))[0]) && /100%/.test((await rows(page))[0]) && /Siddhesh Shinde/.test((await rows(page))[0]), 'Shreya sees the resolved bug under Resolved, 100%, with who worked on it');
  await page.click('[role="tab"]:has-text("Testing")');
  await page.waitForSelector('[data-testid="bug-row"]:has-text("Invoice PDF is blank")');
  check((await rows(page)).length === 1, 'and the other one under Testing');
  await page.click('[role="tab"]:has-text("I worked on")');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="bug-row"]').length === 1);
  check(/Invoice PDF is blank/.test((await rows(page))[0]), '"I worked on" lists the bug she added an update to');
  await reset(page);
  await open(page, 'employee');
  await page.click('[data-testid="recipient-dev"]');
  await page.waitForSelector('[data-testid="my-bug-row"]');
  const mine = await page.$$eval('[data-testid="my-bug-row"]', rs => rs.map(x => x.innerText).join(' | '));
  check(/Resolved/.test(mine) && /Added an index/.test(mine) && /Developer: Ashish Sinha/.test(mine), 'the employee sees the resolution and the primary contact', mine);
  check(!/Reproduced with INV-2026-0042|Needs the embedded font|Reviewed the fix/.test(mine), 'but none of the developers\' internal work log', mine);
  await page.close();

  // ---- HR's Raise an Issue: A. report to the Developer Team, B. the employee issues received (escalate once)
  const hr = await newPage();
  await hr.evaluate(() => window.mount('hr'));
  await hr.waitForSelector('[data-testid="hr-raise-issue-page"] [data-testid="bug-form"]');
  const tabs = await hr.$$eval('[data-testid="hr-raise-issue-page"] [role="tab"]', ts => ts.map(t => t.textContent));
  check(JSON.stringify(tabs) === JSON.stringify(['A. Report to Developer Team', 'B. Employee Issues – Received by HR']), 'HR\'s Raise an Issue has its two sections', tabs);
  await hr.waitForFunction(() => document.querySelectorAll('#bug-dept option').length === 3 && document.querySelectorAll('#bug-emp option').length === 3);
  await hr.fill('#bug-title', 'Payslip export is empty');
  await hr.fill('#bug-description', 'The payslip export has no rows for Accounts this month.');
  await hr.selectOption('#bug-category', 'DATA_ISSUE');
  await hr.selectOption('#bug-priority', 'URGENT');
  await hr.selectOption('#bug-dept', '00000000-0000-4000-8000-00000000dea2');
  check((await hr.$$eval('#bug-emp option', os => os.map(o => o.textContent))).join('|') === 'Not one employee|Ravi Accounts · Accounts', 'choosing the department narrows the employees');
  await hr.selectOption('#bug-emp', '00000000-0000-4000-8000-0000000000e2');
  await hr.click('[data-testid="submit-bug"]');
  await hr.waitForSelector('[data-testid="my-bug-row"]:has-text("Payslip export is empty")');
  const hrSent = await hr.evaluate(() => window.__calls.filter(c => c.method === 'POST' && c.path === '/api/v1/bugs').map(c => c.body)[0]);
  check(hrSent.affectedDepartmentId === '00000000-0000-4000-8000-00000000dea2' && hrSent.affectedEmployeeId === '00000000-0000-4000-8000-0000000000e2' && hrSent.priority === 'URGENT' && hrSent.category === 'DATA_ISSUE', 'HR\'s report carries the affected department and employee', hrSent);
  check(/Reported by HR/.test(await hr.innerText('[data-testid="my-bug-row"]:has-text("Payslip export is empty")')), 'HR follows it in its list');
  await hr.click('[data-testid="hr-section-EMPLOYEE"]');
  await hr.waitForSelector('[data-testid="issue-row"]:has-text("The CRM logs me out")');
  check(/Developers: In Progress/.test(await hr.innerText('[data-testid="issue-row"]:has-text("Leave balance looks wrong")')), 'the escalated issue shows the developers\' status in HR\'s list');
  await hr.selectOption('[data-testid="filter-sort"]', 'PRIORITY');
  await hr.waitForFunction(() => window.__calls.some(c => c.path === '/api/v1/hr/issues' && c.query.sort === 'PRIORITY'));
  check(true, 'HR sorts the list in the database (by priority)');
  // the whole row opens the issue (a click on the employee's name)
  await hr.click('[data-testid="issue-row"]:has-text("The CRM logs me out") >> td:nth-child(2)');
  await hr.waitForSelector('[data-testid="hr-issue-detail"] [data-testid="escalate-button"]');
  await hr.selectOption('[data-testid="escalate-category"]', 'ACCESS_LOGIN');
  await hr.fill('[data-testid="escalate-note"]', 'Seen on two laptops.');
  await hr.click('[data-testid="escalate-button"]');
  await hr.click('[data-testid="confirm-escalate"]');
  await hr.waitForSelector('[data-testid="escalation-status"]');
  const esc = await hr.$eval('[data-testid="escalate-card"]', h => h.parentElement.innerText);
  check(/Escalated as BUG-2026-\d+ by Hema HR/.test(esc) && /Pending/.test(esc), 'HR escalates it: linked to a Developer Team issue, with its status', esc);
  check(await hr.isVisible('[data-testid="escalation-history"]') && /Escalated to the Developer Team/.test(await hr.innerText('[data-testid="case-timeline"]')), 'the history says so; the developers\' answers will show here');
  const escCalls = await hr.evaluate(() => window.__calls.filter(c => c.path.endsWith('/escalate')).map(c => c.body));
  check(escCalls.length === 1 && escCalls[0].category === 'ACCESS_LOGIN' && escCalls[0].note === 'Seen on two laptops.' && !(await hr.locator('[data-testid="escalate-button"]').count()),
    'one escalation, and the button is gone (it cannot be sent twice)', escCalls);
  const again = await hr.evaluate(async () => (await (await fetch('/api/v1/hr/issues/i1/escalate', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })).json()).data);
  check(again.duplicate === true && (await hr.evaluate(() => window.__escalations)) === 1, 'a retry returns the same Developer Team issue, nothing new');
  const hrM = await hr.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check(hrM.sw <= hrM.iw + 1, 'nothing runs off the screen', hrM);
  await hr.close();

  // ---- someone who is not a developer
  const other = await newPage();
  await open(other, 'other');
  check(await navHas(other, 'Bugs') === 0, 'an AI Studio colleague who is not a developer has no Bugs entry');
  check(await other.evaluate(async () => (await fetch('/api/v1/bugs')).status) === 403, 'and the server refuses the list');
  await other.close();

  // ---- phone width
  const phone = await newPage({ width: 360, height: 740 });
  await open(phone, 'employee');
  await phone.click('[data-testid="recipient-dev"]');
  await phone.waitForSelector('[data-testid="bug-form"]');
  const m = await phone.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check(m.sw <= m.iw, 'phone width: the form fits', m);
  await phone.close();
  check(errors.length === 0, 'no script errors', errors);
} finally {
  await browser.close();
}
console.log(`=== BUGS BROWSER TESTS PASSED (${passed}) ===`);
