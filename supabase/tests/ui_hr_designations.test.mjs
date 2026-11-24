// Browser test of the Super Admin's Add Team Member form: the Role / Designation dropdown follows the department. HR Department shows exactly
// HR Assistant, HR Recruiter, HR Admin Head; other departments keep their roles; changing the department clears an incompatible choice; and what is
// sent to the server carries the right role and designation. Real React component + the app's real stylesheet (npm run build first); the API is an
// in-page stand-in that follows the real contract. Skipped, loudly, when Playwright, Chromium or dist/ are missing.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the HR designations browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const cssFile = existsSync(cssDir) ? readdirSync(cssDir).find(f => /^index-.*\.css$/.test(f)) : null;
if (!cssFile) { console.log('SKIPPED - dist/ is not built (npm run build), the HR designations browser test did not run'); process.exit(0); }
const css = readFileSync(path.join(cssDir, cssFile), 'utf8');
const stubs = path.resolve('supabase/tests/ui/hr_designations_stubs.ts');
const supa = path.resolve('supabase/tests/ui/client_journey_supabase_stub.ts');
const work = mkdtempSync(path.join(tmpdir(), 'hrd-ui-'));
const out = path.join(work, 'bundle.js');
await build({
  entryPoints: ['supabase/tests/ui/hr_designations_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' }, jsx: 'automatic', logLevel: 'error',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /\/context\/(AuthContext|DepartmentContext)$/ }, () => ({ path: stubs }));
    b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: supa }));
  } }]
});
const bundle = readFileSync(out, 'utf8');

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }

const apiScript = () => {
  const U = { wabastore: '11111111-1111-4111-8111-111111111111', hr: '22222222-2222-4222-8222-222222222222', accounts: '33333333-3333-4333-8333-333333333333' };
  const dep = (id, name) => ({ id, dbId: U[id], name, description: '', category: 'x', facetOf: null, facetDivision: null });
  window.__departments = [dep('wabastore', 'Wabastore'), dep('hr', 'HR Department'), dep('accounts', 'Accounts')];
  window.__profile = { id: 'sa1', fullName: 'Super Admin', email: 'sa@x.example', role: 'SUPER_ADMIN', status: 'ACTIVE', departmentId: null, teamId: null, department: null, team: null };
  window.__posts = [];
  const teamsOf = { wabastore: [{ id: '44444444-4444-4444-8444-444444444441', departmentId: U.wabastore, name: 'Sales', division: 'SALES' }, { id: '44444444-4444-4444-8444-444444444442', departmentId: U.wabastore, name: 'Support', division: 'SUPPORT' }], hr: [{ id: '44444444-4444-4444-8444-444444444443', departmentId: U.hr, name: 'HR Team', division: 'GENERAL' }], accounts: [{ id: '44444444-4444-4444-8444-444444444444', departmentId: U.accounts, name: 'Accounts Team', division: 'GENERAL' }] };
  const json = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (url, init = {}) => {
    const u = new URL(url, 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    const p = u.pathname.replace('/api/v1', '');
    if (p === '/teams') { const slug = Object.keys(teamsOf).find(k => U[k] === u.searchParams.get('departmentId')); return json(slug ? teamsOf[slug] : Object.values(teamsOf).flat()); }
    if (p === '/users' && method === 'GET') return json({ items: [], total: 0, page: 1, pageSize: 10 });
    if (p === '/employee-requests' && method === 'POST') { const body = JSON.parse(init.body); window.__posts.push(body); return json({ id: 'r1', status: 'PENDING', requestedRole: body.role, employee: { name: body.fullName }, approver: { name: 'Approver' }, awaitingOwner: false }, 201); }
    if (p === '/users' && method === 'POST') { const body = JSON.parse(init.body); window.__posts.push(body); return json({ id: 'new', email: body.email, fullName: body.fullName, role: body.role, status: 'ACTIVE', hrSubRole: null, department: { id: U.hr, slug: 'hr', name: 'HR Department' }, team: null }, 201); }
    return json([]);
  };
};
const open = async (viewport = { width: 1280, height: 1000 }, request = false) => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body><div id="root"></div></body></html>');
  await page.evaluate(apiScript);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(request ? () => window.mountRequest() : () => window.mount());
  await page.waitForSelector(request ? 'form[aria-label="Employee request"]' : '#staff-role');
  return page;
};
const optionsOf = (page) => page.$$eval('#staff-role option', os => os.map(o => o.textContent.trim()));
const fill = async (page, name) => {
  await page.fill('input[placeholder="e.g. Kunal Sharma"]', name);
  await page.fill('input[type="email"]', name.toLowerCase().replace(/\W+/g, '.') + '@amuwa.com');
  const dates = await page.$$('input[type="date"]');
  await dates[0].fill('2026-10-01'); await dates[1].fill('1995-05-05');
  await page.selectOption('select:has(option:text("A+"))', 'B+');
  await page.fill('[data-testid="member-contact-number"]', '+91 91234 56781');
  await page.fill('input[placeholder="+91 98765 43210"]', '+91 98765 43211');
};

{
  const page = await open();
  check((await optionsOf(page)).join('|') === 'HR Assistant|HR Recruiter|HR Admin Head', 'HR Department: the Role dropdown shows exactly HR Assistant, HR Recruiter, HR Admin Head', await optionsOf(page));
  const labels = (await optionsOf(page)).join('|');
  check(!/Team Member|Team Lead|Department Head|Operations Head/.test(labels), 'and no generic role is offered');
  check((await page.$$('select:has(option:text("Team Lead"))')).length === 0 && (await page.$$('select:has(option:text("CEO"))')).length === 0, 'there is no second dropdown carrying the generic roles either');
  check(/Role \/ Designation/.test(await page.innerText('label:has(#staff-role)')), 'the dropdown is labelled Role / Designation');
  await page.close();
}
for (const [designation, role, dash] of [['HR Assistant', 'TEAM_MEMBER', 'HR Dashboard'], ['HR Recruiter', 'TEAM_MEMBER', 'HR Recruiter Dashboard'], ['HR Admin Head', 'DEPARTMENT_HEAD', 'HR Department Head Dashboard']]) {
  const page = await open();
  await page.selectOption('#staff-role', designation);
  check(new RegExp(dash).test(await page.innerText('text=Will open')) , `${designation}: "Will open" says ${dash}`, await page.innerText('text=Will open'));
  check((await page.$$('[data-testid="head-departments"]')).length === 0, `${designation}: no Sales / Support head picker is shown for HR`);
  await fill(page, 'Test ' + designation);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => window.__posts.length === 1, null, { timeout: 5000 }).catch(async () => { console.error('form state:', await page.evaluate(() => ({ alert: document.querySelector('[role=alert]')?.textContent, invalid: [...document.querySelectorAll('input:invalid,select:invalid')].map(e => e.outerHTML.slice(0, 120)) }))); throw new Error('no POST for ' + designation); });
  const sent = await page.evaluate(() => window.__posts[0]);
  check(sent.role === role && sent.details.designation === designation, `${designation}: sent as role ${role} with designation ${designation}`, sent);
  if (designation === 'HR Admin Head') check(sent.departmentId === '22222222-2222-4222-8222-222222222222' && !sent.teamId && !sent.headDivision && !sent.operationsHead, 'HR Admin Head: placed in the HR department itself, no team, no side, not an Operations Head', sent);
  else check(sent.teamId === '44444444-4444-4444-8444-444444444443' && !sent.departmentId, `${designation}: placed in the HR team`, sent);
  await page.close();
}
{
  // other departments keep their roles; HR options never leak out, and a choice that does not belong is cleared when the department changes
  const page = await open();
  await page.selectOption('#staff-role', 'HR Recruiter');
  await page.selectOption('#dept', 'wabastore');
  const opts = (await optionsOf(page)).join('|');
  check(/Department Head/.test(opts) && /Team Lead/.test(opts) && /Team Member/.test(opts) && !/HR Assistant|HR Recruiter|HR Admin Head/.test(opts), 'Wabastore: the existing roles appear and no HR designation', opts);
  const desig = await page.$$eval('select:has(option:text("CEO")) option, select option', os => os.map(o => o.textContent.trim()));
  check(!desig.some(t => /HR Assistant|HR Recruiter|HR Admin Head/.test(t)), 'Wabastore: no HR designation in any dropdown', desig);
  await page.selectOption('#staff-role', 'TEAM_MEMBER');
  await page.selectOption('select:has(option:text("Select team…"))', '44444444-4444-4444-8444-444444444441');
  check(await page.isVisible('#staff-sales-role'), 'Wabastore: a Team Member of the Sales team still gets the Sales Role dropdown');
  await page.selectOption('#dept', 'accounts');
  const acc = (await optionsOf(page)).join('|');
  check(!/HR /.test(acc) && /Team Member/.test(acc), 'Accounts: its existing roles, no HR designation', acc);
  await page.selectOption('#dept', 'hr');
  check((await optionsOf(page)).join('|') === 'HR Assistant|HR Recruiter|HR Admin Head', 'back to HR: exactly the three HR designations again');
  check(await page.$eval('#staff-role', s => s.value) === 'HR Assistant', 'and the earlier generic choice is gone (it starts at HR Assistant)');
  await page.close();
}
{
  // HR's employee request form: choosing the HR department replaces the generic roles with the three HR designations
  const page = await open({ width: 1280, height: 1100 }, true);
  const generic = await page.$$eval('select option', os => os.map(o => o.textContent.trim()));
  check(generic.includes('CEO') && generic.includes('Team Lead'), 'request form: before a department is chosen it offers the generic roles');
  await page.selectOption('select:has(option:text("Choose a department"))', '22222222-2222-4222-8222-222222222222');
  const hrOpts = await page.$$eval('[data-testid="hr-designation"] option', os => os.map(o => o.textContent.trim()));
  check(hrOpts.join('|') === 'HR Assistant|HR Recruiter|HR Admin Head', 'request form: HR Department shows exactly HR Assistant, HR Recruiter, HR Admin Head', hrOpts);
  check(!(await page.$$eval('select option', os => os.map(o => o.textContent.trim()))).some(t => /^(CEO|Team Lead|Department Head|Team Member)$/.test(t)), 'and no generic role remains in the form');
  await page.selectOption('[data-testid="hr-designation"]', 'HR Admin Head');
  await page.fill('input:not([type])', 'Hira Head');
  await page.fill('input[type="email"]', 'hira.head@amuwa.com');
  const dates = await page.$$('input[type="date"]');
  await dates[0].fill('2026-10-01'); await dates[1].fill('1995-05-05');
  await page.selectOption('select:has(option:text("A+"))', 'B+');
  const phones = await page.$$('input[placeholder="+91 98765 43210"]');
  await phones[0].fill('+91 91234 56781'); await phones[1].fill('+91 98765 43211');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => window.__posts.length === 1, null, { timeout: 5000 }).catch(async () => { console.error('form state:', await page.evaluate(() => document.querySelector('[role=alert]')?.textContent)); throw new Error('no request POST'); });
  const sent = await page.evaluate(() => window.__posts[0]);
  check(sent.role === 'DEPARTMENT_HEAD' && sent.details.designation === 'HR Admin Head' && sent.departmentId === '22222222-2222-4222-8222-222222222222', 'request form: HR Admin Head is sent as the Department Head role of HR (the usual approval route)', sent);
  await page.selectOption('select:has(option:text("Choose a department"))', '11111111-1111-4111-8111-111111111111');
  const back = await page.$$eval('select option', os => os.map(o => o.textContent.trim()));
  check(back.includes('Team Lead') && !back.some(t => /^HR (Assistant|Recruiter|Admin Head)$/.test(t)), 'request form: another department goes back to its generic roles', back);
  await page.close();
}
for (const [name, vp] of [['phone', { width: 360, height: 740 }], ['tablet', { width: 768, height: 1024 }], ['desktop', { width: 1440, height: 900 }]]) {
  const page = await open(vp);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, w: document.querySelector('#staff-role').getBoundingClientRect().width }));
  check(m.sw <= m.iw && m.w > 150, `${name}: the form fits and the Role / Designation dropdown is usable`, m);
  check((await optionsOf(page)).length === 3, `${name}: three HR options`);
  await page.close();
}
await browser.close();
console.log(`=== HR DESIGNATIONS BROWSER TESTS PASSED (${passed}) ===`);
