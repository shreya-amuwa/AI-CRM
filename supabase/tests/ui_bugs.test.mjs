// Browser test of bugs for the Developers team (20270122000300, 20270122000400), with each of the three developer accounts: an employee
// reports bugs; Shreya Mande (Team Lead), Ashish Sinha and Siddhesh Shinde all see every new, unassigned bug; only Shreya assigns (a
// dropdown with Ashish and Siddhesh); after assignment each developer sees only their own, Shreya sees everything with the team's workload;
// the assigned developer resolves; the employee follows it. Real React components and the real dashboard shell, real Chromium; the CRM API is
// answered in the page like the database (supabase/tests/ui/bugs_harness.tsx).
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
  await page.selectOption('[data-testid="case-type"]', 'BUG');
  await page.waitForSelector('[data-testid="bug-form"]');
  await page.click('[data-testid="submit-bug"]');
  await page.waitForSelector('text=Give the issue a title');
  check(!(await page.evaluate(() => window.__calls.some(c => c.method === 'POST' && c.path === '/api/v1/bugs'))), 'an incomplete form is not sent');
  for (const [t, d] of [['Invoice PDF is blank', 'The invoice PDF opens with an empty page for every customer.'], ['Ticket list is slow', 'Opening the ticket list takes more than a minute.']]) {
    await page.fill('#bug-title', t);
    await page.fill('#bug-description', d);
    await page.click('[data-testid="submit-bug"]');
    await page.waitForFunction(n => document.querySelectorAll('[data-testid="my-bug-row"]').length === n, t === 'Invoice PDF is blank' ? 1 : 2);
  }
  check(true, 'two bugs reported, both in "My bug reports"');

  // ---- every new bug is seen by all three developers: Shreya, Ashish AND Siddhesh
  for (const [who, name] of [['dev', 'Shreya'], ['ashish', 'Ashish'], ['siddhesh', 'Siddhesh']]) {
    await reset(page);
    await open(page, who);
    check(await navHas(page, 'Bugs') === 1, `${name} has "Bugs" in the menu`);
    await openBugs(page);
    const r = await rows(page);
    check(r.length === 2 && r.some(x => /Invoice PDF is blank/.test(x) && /Priya Sales/.test(x) && /Wabastore/.test(x) && /Unassigned/.test(x)) && r.some(x => /Ticket list is slow/.test(x)),
      `${name} sees both new, unassigned bugs with the employee's details`, r);
  }
  // Siddhesh (still signed in) opens a new bug: details, but no assignment control and no status change before assignment
  await page.click('button[aria-label^="Open BUG-2026-00001"]');
  await page.waitForSelector('[data-testid="bug-drawer"] >> text=The invoice PDF opens with an empty page');
  check(!(await page.locator('#bug-assignee').count()) && /the Team Lead assigns new bugs/.test(await page.innerText('[data-testid="bug-assignment"]')), 'a developer has no assignment control');
  check(await page.isVisible('[data-testid="status-locked"]'), 'nor a status control on an unassigned bug');

  // ---- Shreya (Team Lead) assigns: bug 1 to Ashish, bug 2 to Siddhesh
  await reset(page);
  await open(page, 'dev');
  await openBugs(page);
  check(/Team Lead view/.test(await page.innerText('[data-testid="bugs-page"]')), 'Shreya has the Team Lead view');
  for (const [ref, dev] of [['BUG-2026-00001', 'd2'], ['BUG-2026-00002', 'd3']]) {
    await page.click(`button[aria-label^="Open ${ref}"]`);
    await page.waitForSelector('#bug-assignee');
    const opts = await page.$$eval('#bug-assignee option', os => os.map(o => o.textContent));
    check(opts.length === 3 && opts.includes('Ashish Sinha') && opts.includes('Siddhesh Shinde') && !opts.includes('Shreya Mande'), 'her assignment dropdown offers Ashish Sinha and Siddhesh Shinde', opts);
    await page.selectOption('#bug-assignee', dev);
    await page.waitForSelector('text=only you and them see it now');
    check(/Assigned by Shreya Mande/.test(await page.innerText('[data-testid="bug-assignment"]')), `${ref} assigned, with who and when`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  await page.waitForSelector('[data-testid="team-workload"]');
  const wl = await page.innerText('[data-testid="team-workload"]');
  check(/Ashish Sinha\s*1 open/.test(wl) && /Siddhesh Shinde\s*1 open/.test(wl), 'her consolidated view shows each developer\'s workload', wl);
  check((await rows(page)).length === 2, 'and she still sees both bugs');

  // ---- after assignment: each developer sees only their own
  await reset(page);
  await open(page, 'ashish');
  await openBugs(page);
  let r = await rows(page);
  check(r.length === 1 && /Invoice PDF is blank/.test(r[0]), 'Ashish now sees only the bug assigned to him', r);
  await reset(page);
  await open(page, 'siddhesh');
  await openBugs(page);
  r = await rows(page);
  check(r.length === 1 && /Ticket list is slow/.test(r[0]), 'Siddhesh now sees only the bug assigned to him', r);
  const blocked = await page.evaluate(async () => (await fetch('/api/v1/bugs/b1')).status);
  check(blocked === 404, 'and the server refuses Ashish\'s bug to him');
  // Siddhesh resolves his bug
  await page.click('button[aria-label^="Open BUG-2026-00002"]');
  await page.waitForSelector('#bug-status');
  await page.selectOption('#bug-status', 'RESOLVED');
  check(await page.isDisabled('button:has-text("Update status")'), 'resolving needs the resolution note first');
  await page.fill('#bug-note', 'Added an index; the list opens in a second.');
  await page.click('button:has-text("Update status")');
  await page.waitForSelector('[data-testid="bug-drawer"] [data-testid="bug-status"][data-status="RESOLVED"]');
  check(true, 'Siddhesh resolves the bug assigned to him');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'nothing runs off the screen');

  // ---- Shreya monitors the result; the employee sees the resolution, never internal comments
  await reset(page);
  await open(page, 'dev');
  await openBugs(page);
  await page.click('[role="tab"]:has-text("Resolved")');
  await page.waitForSelector('[data-testid="bug-row"]:has-text("Ticket list is slow")');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="bug-row"]').length === 1);
  check(/Resolved/.test((await rows(page))[0]), 'Shreya sees the resolved bug under Resolved');
  await reset(page);
  await open(page, 'employee');
  await page.selectOption('[data-testid="case-type"]', 'BUG');
  await page.waitForSelector('[data-testid="my-bug-row"]');
  const mine = await page.$$eval('[data-testid="my-bug-row"]', rs => rs.map(x => x.innerText).join(' | '));
  check(/Resolved/.test(mine) && /Developer: Siddhesh Shinde/.test(mine) && /Added an index/.test(mine) && /Developer: Ashish Sinha/.test(mine), 'the employee sees who works on each bug and the resolution', mine);
  await page.close();

  // ---- someone who is not a developer
  const other = await newPage();
  await open(other, 'other');
  check(await navHas(other, 'Bugs') === 0, 'an AI Studio colleague who is not a developer has no Bugs entry');
  check(await other.evaluate(async () => (await fetch('/api/v1/bugs')).status) === 403, 'and the server refuses the list');
  await other.close();

  // ---- phone width
  const phone = await newPage({ width: 360, height: 740 });
  await open(phone, 'employee');
  await phone.selectOption('[data-testid="case-type"]', 'BUG');
  await phone.waitForSelector('[data-testid="bug-form"]');
  const m = await phone.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check(m.sw <= m.iw, 'phone width: the form fits', m);
  await phone.close();
  check(errors.length === 0, 'no script errors', errors);
} finally {
  await browser.close();
}
console.log(`=== BUGS BROWSER TESTS PASSED (${passed}) ===`);
