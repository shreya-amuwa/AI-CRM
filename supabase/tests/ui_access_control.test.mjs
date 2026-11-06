// Browser test of the Access Control tab: employee selector, the department x Sales / Support matrix, unsaved changes, Save / Cancel,
// errors, and the layout on phone / tablet / desktop. Real React component + the app's real stylesheet (npm run build first); the API is a
// small in-page stand-in that follows the real contract. Skipped, loudly, when Playwright, Chromium or dist/ are missing.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Access Control browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const cssFile = existsSync(cssDir) ? readdirSync(cssDir).find(f => /^index-.*\.css$/.test(f)) : null;
if (!cssFile) { console.log('SKIPPED - dist/ is not built (npm run build), the Access Control browser test did not run'); process.exit(0); }
const css = readFileSync(path.join(cssDir, cssFile), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'ac-ui-'));
const out = path.join(work, 'bundle.js');
execFileSync('npx', ['esbuild', 'supabase/tests/ui/access_control_harness.tsx', '--bundle', '--format=iife', '--platform=browser', `--outfile=${out}`, '--define:import.meta.env={}', '--jsx=automatic', '--log-level=error'], { stdio: 'inherit' });
const bundle = readFileSync(out, 'utf8');

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }

// the API stand-in: two Department Heads, the real department list shape
const apiScript = () => {
  const depts = [
    { id: 'd-whatsbox', slug: 'whatsbox', name: 'Whatsbox', hasSales: true, hasSupport: true },
    { id: 'd-wabastar', slug: 'wabastar', name: 'Wabastar', hasSales: true, hasSupport: true },
    { id: 'd-wabastore', slug: 'wabastore', name: 'Wabastore', hasSales: true, hasSupport: true },
    { id: 'd-dtalk', slug: 'dtalk', name: 'D Talk Corporation', hasSales: true, hasSupport: false, supportDepartment: 'Wabatalk' },
    { id: 'd-wabatalk', slug: 'wabatalk', name: 'Wabatalk', hasSales: false, hasSupport: true },
    { id: 'd-accounts', slug: 'accounts', name: 'Accounts Department', hasSales: false, hasSupport: false }
  ];
  const state = {
    h1: { profileId: 'h1', name: 'Ashwini Rajput', role: 'DEPARTMENT_HEAD', homeDepartmentId: 'd-whatsbox', headDivision: 'SUPPORT', grants: [{ departmentId: 'd-wabatalk', division: 'SUPPORT' }] },
    h2: { profileId: 'h2', name: 'Sales Head', role: 'DEPARTMENT_HEAD', homeDepartmentId: 'd-whatsbox', headDivision: 'SALES', grants: [] },
    h3: { profileId: 'h3', name: 'Plain Head', role: 'DEPARTMENT_HEAD', homeDepartmentId: 'd-whatsbox', headDivision: 'SUPPORT', grants: [] }
  };
  window.__calls = [];
  window.__failNext = false;
  const json = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (url, init = {}) => {
    const u = new URL(url, 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    window.__calls.push(`${method} ${u.pathname}${u.search}`);
    if (u.pathname === '/api/v1/users' && method === 'GET') {
      const mk = (id, name, email, op) => ({ id, fullName: name, email, role: 'DEPARTMENT_HEAD', isOperationsHead: op, status: 'ACTIVE', department: { id: 'd-whatsbox', slug: 'whatsbox', name: 'Whatsbox' } });
      return json({ items: [mk('h1', 'Ashwini Rajput', 'a@x.com', true), mk('h2', 'Sales Head', 's@x.com', true), mk('h3', 'Plain Head', 'p@x.com', false)], page: 1, pageSize: 100, total: 3 });
    }
    if (u.pathname === '/api/v1/users/operations-head-review') return json([]);
    const m = u.pathname.match(/^\/api\/v1\/users\/(h\d)\/department-access(\/apply)?$/);
    if (m) {
      const s = state[m[1]];
      if (method === 'GET') return json({ ...s, departments: depts });
      if (window.__failNext) { window.__failNext = false; return json({ code: 'VALIDATION_ERROR', message: 'Accounts Department has no Sales team, so there is nothing for this head to manage there.' }, 422); }
      const pairs = JSON.parse(init.body).pairs;
      const before = s.grants.length;
      s.grants = pairs;
      return json({ ...s, departments: depts, added: Math.max(0, pairs.length - before), removed: Math.max(0, before - pairs.length) });
    }
    return json({ code: 'NOT_FOUND', message: 'no' }, 404);
  };
};

const open = async (vp) => {
  const page = await browser.newPage({ viewport: vp });
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div>`);
  await page.evaluate(apiScript);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.mount());
  page.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 300)));
  await page.waitForSelector('[data-testid="access-employee"] option[value="h1"]', { state: 'attached', timeout: 5000 }).catch(async e => { console.log(await page.evaluate(() => document.body.innerText.slice(0, 600)), await page.evaluate(() => JSON.stringify(window.__calls))); throw e; });
  return page;
};

{
  const page = await open({ width: 1280, height: 900 });
  check(await page.isHidden('[data-testid="access-matrix"]').catch(() => true), 'no employee chosen: no matrix yet');
  await page.selectOption('[data-testid="access-employee"]', 'h1');
  await page.waitForSelector('[data-testid="access-matrix"]');
  const rows = await page.$$eval('[data-testid="access-matrix"] tbody tr', trs => trs.map(t => t.textContent.replace(/\s+/g, ' ').trim()));
  check(rows.length === 6 && /Whatsbox.*HOME/.test(rows[0]), 'the matrix lists the departments from the database, the home department marked', rows);
  check(await page.isChecked('[data-testid="cell-whatsbox-support"]') && await page.isDisabled('[data-testid="cell-whatsbox-support"]'), "the head's own department and side is ticked and locked");
  check(!(await page.isChecked('[data-testid="cell-whatsbox-sales"]')) && !(await page.isDisabled('[data-testid="cell-whatsbox-sales"]')), 'the other function of the home department can be ticked');
  check(await page.isChecked('[data-testid="cell-wabatalk-support"]'), 'saved assignments are ticked (Wabatalk Support)');
  check(await page.isDisabled('[data-testid="cell-dtalk-support"]') && (await page.getAttribute('[data-testid="cell-dtalk-support"]', 'title')).includes('Wabatalk'), "D Talk's Support is disabled and points to Wabatalk");
  check(await page.isDisabled('[data-testid="cell-wabatalk-sales"]') && await page.isDisabled('[data-testid="cell-accounts-sales"]') && await page.isDisabled('[data-testid="cell-accounts-support"]'), 'a function a department does not have cannot be ticked');
  check(await page.isDisabled('[data-testid="access-save"]') && await page.isHidden('[data-testid="unsaved-badge"]').catch(() => true), 'nothing changed: Save is disabled');
  check(await page.isVisible('[data-testid="operations-head-box"]') && /Operations Head/.test(await page.textContent('[data-testid="operations-head-box"]')), 'an Operations Head is shown as one, with the button to remove the role');
  // a plain Department Head (20261224000100): another department CAN be ticked - they stay a Department Head; the database refuses a
  // department/function that already has another head when it is saved, and the screen says so up front
  await page.selectOption('[data-testid="access-employee"]', 'h3');
  await page.waitForSelector('[data-testid="cell-wabastar-support"]');
  check(!(await page.isDisabled('[data-testid="cell-wabastar-support"]')), 'a Department Head who is not an Operations Head can be given another department');
  check(/cannot be given to a second one/.test(await page.textContent('body')), 'and the screen says one department/function cannot have two heads');
  check(!(await page.isDisabled('[data-testid="cell-whatsbox-sales"]')), 'but can still handle the other function of their own department');
  check(/Make Operations Head/.test(await page.textContent('[data-testid="operations-head-toggle"]')), 'and the Super Admin can make them an Operations Head from here');
  await page.selectOption('[data-testid="access-employee"]', 'h1');
  await page.waitForSelector('[data-testid="cell-wabatalk-support"]');
  await page.check('[data-testid="cell-wabastar-support"]');
  await page.check('[data-testid="cell-wabastore-support"]');
  check(await page.isVisible('[data-testid="unsaved-badge"]') && !(await page.isDisabled('[data-testid="access-save"]')), 'ticking shows "Unsaved changes" and enables Save');
  await page.click('[data-testid="access-cancel"]');
  check(!(await page.isChecked('[data-testid="cell-wabastar-support"]')) && await page.isChecked('[data-testid="cell-wabatalk-support"]'), 'Cancel puts the saved state back');
  // an unsaved change guards switching employee
  await page.check('[data-testid="cell-wabastar-support"]');
  let dialogs = 0;
  page.once('dialog', d => { dialogs++; d.dismiss(); });
  await page.selectOption('[data-testid="access-employee"]', 'h2');
  check(dialogs === 1 && (await page.inputValue('[data-testid="access-employee"]')) === 'h1', 'switching employee with unsaved changes asks first, and stays when declined');
  // a refused save shows the reason and keeps the changes
  await page.check('[data-testid="cell-wabastore-support"]');
  await page.evaluate(() => { window.__failNext = true; });
  await page.click('[data-testid="access-save"]');
  await page.waitForSelector('[role="alert"]');
  check(/no Sales team/.test(await page.textContent('[role="alert"]')) && await page.isChecked('[data-testid="cell-wabastore-support"]') && await page.isVisible('[data-testid="unsaved-badge"]'), 'a refused save shows the database reason and keeps the unsaved ticks');
  await page.click('[data-testid="access-save"]');
  await page.waitForSelector('[role="status"]:has-text("Saved")');
  // the "Saved" message and the cleared form are separate renders: wait (briefly) for the form to settle before checking it
  await page.waitForFunction(() => document.querySelector('[data-testid="access-save"]')?.disabled && !document.querySelector('[data-testid="unsaved-badge"]'), null, { timeout: 5000 }).catch(() => {});
  const body = await page.evaluate(() => window.__calls.filter(c => c.startsWith('POST')).length);
  check(body === 2 && await page.isHidden('[data-testid="unsaved-badge"]').catch(() => true) && await page.isDisabled('[data-testid="access-save"]'), 'Save succeeds: the badge goes, Save is disabled again');
  check((await page.textContent('#saves')) === '1', 'the lists are told to refresh (onSaved)');
  check(/Wabastar \(Support\)/.test(await page.textContent('[data-testid="access-summary"]')) && /Whatsbox \(Support, home\)/.test(await page.textContent('[data-testid="access-summary"]')), 'the summary shows what the employee works in now');
  // persisted: choose another employee and come back
  await page.selectOption('[data-testid="access-employee"]', 'h2');
  await page.waitForSelector('[data-testid="cell-whatsbox-sales"]:disabled');
  await page.selectOption('[data-testid="access-employee"]', 'h1');
  await page.waitForSelector('[data-testid="cell-wabastar-support"]:checked');
  check(true, 'the saved assignments persist when the employee is opened again');
  await page.close();
}
for (const [name, vp] of [['phone', { width: 360, height: 740 }], ['tablet', { width: 768, height: 1024 }], ['desktop', { width: 1440, height: 900 }]]) {
  const page = await open(vp);
  await page.selectOption('[data-testid="access-employee"]', 'h1');
  await page.waitForSelector('[data-testid="access-matrix"]');
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check(m.sw <= m.iw, `${name}: the page does not scroll sideways (the matrix scrolls inside its box when needed)`, m);
  const btn = await page.evaluate(() => { const r = document.querySelector('[data-testid="access-save"]').getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; });
  check(btn, `${name}: Save is fully visible`);
  await page.close();
}
await browser.close();
console.log(`=== ACCESS CONTROL BROWSER TESTS PASSED (${passed}) ===`);
