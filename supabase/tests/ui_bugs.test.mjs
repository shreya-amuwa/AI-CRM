// Browser test of bugs for the Developers team (migration 20270122000300): the real dashboard shell shows "Bugs" in the menu ONLY for a
// developer; an employee reports a technical issue from Raise an Issue (required fields checked first, one bug per form) and follows its
// status and resolution (never the developers' internal comments); a developer lists, opens, assigns, comments and resolves (a note is
// required). Real React components, real Chromium; the CRM API is answered in the page (supabase/tests/ui/bugs_harness.tsx).
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

try {
  const page = await newPage();
  // ---- an employee: no Bugs in the menu; reports a bug from Raise an Issue
  await open(page, 'employee');
  check(await navHas(page, 'Bugs') === 0 && await navHas(page, 'Meetings') === 1, 'an employee has Attendance / Meetings but no Bugs in the menu');
  await page.selectOption('[data-testid="case-type"]', 'BUG');
  await page.waitForSelector('[data-testid="bug-form"]');
  check(/Report a bug to the Developers team/.test(await page.innerText('[data-testid="case-type"]')), 'Raise an Issue offers "Report a bug to the Developers team" next to the existing two');
  check(await page.isVisible('text=Screenshots or files'), 'with screenshots / files');
  await page.click('[data-testid="submit-bug"]');
  await page.waitForSelector('text=Give the issue a title');
  check(!(await page.evaluate(() => window.__calls.some(c => c.method === 'POST' && c.path === '/api/v1/bugs'))), 'an incomplete form is not sent');
  await page.fill('#bug-title', 'Invoice PDF is blank');
  await page.fill('#bug-description', 'The invoice PDF opens with an empty page for every customer.');
  await page.fill('#bug-steps', '1. Open Accounts\n2. Download an invoice');
  await page.click('[data-testid="submit-bug"]');
  await page.waitForSelector('[data-testid="bug-submitted"]');
  check(/BUG-2026-00001/.test(await page.innerText('[data-testid="bug-submitted"]')), 'sent to the Developers team, with its reference');
  const sent = await page.evaluate(() => window.__calls.find(c => c.method === 'POST' && c.path === '/api/v1/bugs')?.body);
  check(sent.title === 'Invoice PDF is blank' && sent.steps.startsWith('1. Open') && sent.clientRequestId?.length >= 8 && !('reporterName' in sent), 'the server receives the issue (never who reported it)', sent);
  await page.waitForSelector('[data-testid="my-bug-row"]');
  check(/Pending/.test(await page.innerText('[data-testid="my-bug-row"]')) && /Not assigned yet/.test(await page.innerText('[data-testid="my-bug-row"]')), 'it is in "My bug reports" as Pending');

  // ---- someone who is not a developer cannot see the section
  const other = await newPage();
  await open(other, 'other');
  check(await navHas(other, 'Bugs') === 0, 'an AI Studio colleague who is not a developer has no Bugs entry');
  const forbidden = await other.evaluate(async () => (await fetch('/api/v1/bugs')).status);
  check(forbidden === 403, 'and the server refuses the list');
  await other.close();

  // ---- a developer: Bugs in the menu; assign, comment, resolve
  // the same page (its in-page stand-in server keeps the reported bug): switch to the developer
  await page.evaluate(() => { document.body.innerHTML = '<div id="root"></div>'; window.__calls = []; });
  await open(page, 'dev');
  check(await navHas(page, 'Bugs') === 1, 'a developer has "Bugs" in the menu');
  await page.locator('nav button', { hasText: 'Bugs' }).click();
  await page.waitForSelector('[data-testid="bug-row"]');
  const r = await page.innerText('[data-testid="bug-row"]');
  check(/Invoice PDF is blank/.test(r) && /Priya Sales/.test(r) && /Wabastore/.test(r) && /Team Member/.test(r) && /Unassigned/.test(r) && /Pending/.test(r),
    'the reported bug is in the Bugs section: title, reporter, department, designation, unassigned, Pending', r);
  await page.click('button[aria-label^="Open BUG-2026-00001"]');
  await page.waitForSelector('[data-testid="bug-drawer"] >> text=Steps to reproduce');
  check(await page.isVisible('[data-testid="bug-drawer"] >> text=The invoice PDF opens with an empty page'), 'the developer reads the description and steps');
  await page.selectOption('#bug-assignee', 'd2');
  await page.waitForSelector('text=Assigned to Ashish Sinha');
  check(true, 'assigned to another developer');
  await page.fill('#bug-comment', 'Caused by the new font loader');
  await page.click('button:has-text("Add comment")');
  await page.waitForSelector('[data-testid="bug-history"] >> text=Internal comment (developers only)');
  check(true, 'an internal comment, marked as developers only');
  await page.selectOption('#bug-status', 'RESOLVED');
  check(await page.isDisabled('button:has-text("Update status")'), 'resolving needs the resolution note first');
  await page.fill('#bug-note', 'Fixed in release 2.4; please download again.');
  await page.click('button:has-text("Update status")');
  await page.waitForSelector('[data-testid="bug-drawer"] [data-testid="bug-status"][data-status="RESOLVED"]');
  check(/Resolved/.test(await page.innerText('[data-testid="bug-drawer"]')), 'Resolved, with the note');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'nothing runs off the screen');

  // ---- back to the employee: the status and resolution, never the internal comment
  // a new page for the employee (the developer's drawer is rendered outside the root)
  await page.evaluate(() => { document.body.innerHTML = '<div id="root"></div>'; });
  await open(page, 'employee');
  await page.selectOption('[data-testid="case-type"]', 'BUG');
  await page.waitForSelector('[data-testid="my-bug-row"]');
  const mine = await page.innerText('[data-testid="my-bug-row"]');
  check(/Resolved/.test(mine) && /Developer: Ashish Sinha/.test(mine) && /Fixed in release 2.4/.test(mine), 'the employee sees Resolved, the developer and the resolution', mine);
  await page.click('[data-testid="my-bug-row"]');
  await page.waitForSelector('[data-testid="my-bug-dialog"] [data-testid="bug-history"]');
  check(!/font loader|developers only/.test(await page.innerText('[data-testid="my-bug-dialog"]')), 'never the internal comment');
  await page.close();

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
