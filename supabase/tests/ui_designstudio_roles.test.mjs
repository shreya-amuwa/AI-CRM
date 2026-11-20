// Browser test of the Add Team Member form and HR's employee request form for Amuwa Design Studio (slug designstudio, an ACTIVE department:
// migration 20270118000100 removed the "(Retired)" label) and AI Design Studio (slug ai-design-studio): choosing the department leaves only
// Department Head, Team Lead and Team Member (no Sales / Support role, team, side or Sales role), an earlier Sales / Support choice is cleared,
// what is sent places the person in Amuwa Design Studio, and other departments keep their Sales and Support options. Real React components
// (the HR designations harness) + the app's stylesheet (npm run build first); the API is an in-page stand-in. Skipped, loudly, when Playwright,
// Chromium or dist/ are missing.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Amuwa Design Studio roles browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const cssFile = existsSync(cssDir) ? readdirSync(cssDir).find(f => /^index-.*\.css$/.test(f)) : null;
if (!cssFile) { console.log('SKIPPED - dist/ is not built (npm run build), the Amuwa Design Studio roles browser test did not run'); process.exit(0); }
const css = readFileSync(path.join(cssDir, cssFile), 'utf8');
const stubs = path.resolve('supabase/tests/ui/hr_designations_stubs.ts');
const supa = path.resolve('supabase/tests/ui/client_journey_supabase_stub.ts');
const work = mkdtempSync(path.join(tmpdir(), 'dsr-ui-'));
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
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }

const DS = '55555555-5555-4555-8555-555555555555';
const OLD = '77777777-7777-4777-8777-777777777777';
const T = { dsGeneral: '66666666-6666-4666-8666-666666666661', dsSales: '66666666-6666-4666-8666-666666666662', dsSupport: '66666666-6666-4666-8666-666666666663', wsSales: '66666666-6666-4666-8666-666666666664', wsSupport: '66666666-6666-4666-8666-666666666665', amGeneral: '66666666-6666-4666-8666-666666666666', amSales: '66666666-6666-4666-8666-666666666667', amSupport: '66666666-6666-4666-8666-666666666668' };
const apiScript = ([DS, OLD, T]) => {
  const U = { hr: '22222222-2222-4222-8222-222222222222', wabastore: '11111111-1111-4111-8111-111111111111', 'ai-design-studio': DS, designstudio: OLD };
  const dep = (id, name) => ({ id, dbId: U[id], name, description: '', category: 'x', facetOf: null, facetDivision: null });
  window.__departments = [dep('hr', 'HR Department'), dep('wabastore', 'Wabastore'), dep('ai-design-studio', 'AI Design Studio'), dep('designstudio', 'Amuwa Design Studio')];
  window.__profile = { id: 'sa1', fullName: 'Super Admin', email: 'sa@x.example', role: 'SUPER_ADMIN', status: 'ACTIVE', departmentId: null, teamId: null, department: null, team: null };
  window.__posts = [];
  const teamsOf = {
    hr: [{ id: '44444444-4444-4444-8444-444444444443', departmentId: U.hr, name: 'HR Team', division: 'GENERAL' }],
    wabastore: [{ id: T.wsSales, departmentId: U.wabastore, name: 'Sales', division: 'SALES' }, { id: T.wsSupport, departmentId: U.wabastore, name: 'Support', division: 'SUPPORT' }],
    // Amuwa Design Studio: its General team (plus, defensively, a Sales and a Support team that must never be offered)
    'ai-design-studio': [{ id: T.dsGeneral, departmentId: DS, name: 'General', division: 'GENERAL' }, { id: T.dsSales, departmentId: DS, name: 'Sales', division: 'SALES' }, { id: T.dsSupport, departmentId: DS, name: 'Support', division: 'SUPPORT' }],
    // Amuwa Design Studio keeps the Sales and Support teams its existing people are in (they are never offered for new people)
    designstudio: [{ id: T.amGeneral, departmentId: OLD, name: 'General', division: 'GENERAL' }, { id: T.amSales, departmentId: OLD, name: 'Sales', division: 'SALES' }, { id: T.amSupport, departmentId: OLD, name: 'Support', division: 'SUPPORT' }]
  };
  const json = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (url, init = {}) => {
    const u = new URL(url, 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    const p = u.pathname.replace('/api/v1', '');
    if (p === '/teams') { const slug = Object.keys(teamsOf).find(k => U[k] === u.searchParams.get('departmentId')); return json(slug ? teamsOf[slug] : Object.values(teamsOf).flat()); }
    if (p === '/users' && method === 'GET') return json({ items: [], total: 0, page: 1, pageSize: 10 });
    if (p === '/employee-requests' && method === 'POST') { const body = JSON.parse(init.body); window.__posts.push(body); return json({ id: 'r1', status: 'PENDING', requestedRole: body.role, employee: { name: body.fullName }, approver: { name: 'Approver' }, awaitingOwner: false }, 201); }
    if (p === '/users' && method === 'POST') { const body = JSON.parse(init.body); window.__posts.push(body); return json({ id: 'new', email: body.email, fullName: body.fullName, role: body.role, status: 'ACTIVE', department: { id: DS, slug: 'ai-design-studio', name: 'Amuwa Design Studio' }, team: null }, 201); }
    return json([]);
  };
};
const open = async (request = false, viewport = { width: 1280, height: 1100 }) => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body><div id="root"></div></body></html>');
  await page.evaluate(apiScript, [DS, OLD, T]);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(request ? () => window.mountRequest() : () => window.mount());
  await page.waitForSelector(request ? 'form[aria-label="Employee request"]' : '#staff-role');
  return page;
};
const roleOptions = page => page.$$eval('#staff-role option', os => os.map(o => o.textContent.trim()));
const teamSelect = 'select:has(option:text("Select team…"))';
const teamOptions = page => page.$$eval(`${teamSelect} option`, os => os.map(o => o.value).filter(Boolean));
const allOptionTexts = page => page.$$eval('select:not(#dept) option', os => os.map(o => o.textContent.trim()));
const SALES_SUPPORT = /Sales|Support|Telecaller|Business Associate|Technical Consultant|Meta Verifier|Operations Head/;
const fill = async (page, name) => {
  await page.fill('input[placeholder="e.g. Kunal Sharma"]', name);
  await page.fill('input[type="email"]', name.toLowerCase().replace(/\W+/g, '.') + '@amuwa.com');
  const dates = await page.$$('input[type="date"]');
  await dates[0].fill('2026-10-01'); await dates[1].fill('1995-05-05');
  await page.selectOption('select:has(option:text("A+"))', 'B+');
  await page.fill('[data-testid="member-contact-number"]', '+91 91234 56781');
  await page.fill('input[placeholder="+91 98765 43210"]', '+91 98765 43211');
};
const submitted = async page => {
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => window.__posts.length === 1, null, { timeout: 5000 }).catch(async () => { console.error('form state:', await page.evaluate(() => document.querySelector('[role=alert]')?.textContent)); throw new Error('no POST'); });
  return page.evaluate(() => window.__posts[0]);
};

{
  // Wabastore first (a Support role and the Sales team with a Telecaller chosen), then Amuwa Design Studio
  const page = await open();
  await page.selectOption('#dept', 'wabastore');
  await page.waitForFunction(() => [...document.querySelectorAll('#staff-role option')].some(o => o.value === 'TECHNICAL_CONSULTANT'));
  const ws = (await roleOptions(page)).join('|');
  check(/Technical Consultant/.test(ws) && /Meta Verifier/.test(ws) && /Operations Head/.test(ws), 'Wabastore: the Support and cross-department roles are offered', ws);
  await page.selectOption('#staff-role', 'TEAM_MEMBER');
  await page.selectOption(teamSelect, T.wsSales);
  await page.selectOption('#staff-sales-role', 'TELECALLER');
  check(await page.isVisible('#staff-sales-role'), 'Wabastore: a Sales Team Member gets the Sales Role dropdown (Telecaller chosen)');

  await page.selectOption('#dept', 'ai-design-studio');
  await page.waitForFunction(T => [...document.querySelectorAll('select option')].some(o => o.value === T), T.dsGeneral);
  check((await roleOptions(page)).join('|') === 'Department Head|Team Lead|Team Member', 'Amuwa Design Studio: the Role dropdown is exactly Department Head, Team Lead, Team Member', await roleOptions(page));
  check((await teamOptions(page)).join() === T.dsGeneral, 'Amuwa Design Studio: the team list is its General team only (no Sales / Support team)', await teamOptions(page));
  check(await page.$eval(teamSelect, s => s.value) === T.dsGeneral, 'the Wabastore Sales team is not kept: the General team is chosen');
  check(!(await page.isVisible('#staff-sales-role')), 'the Sales Role dropdown (Telecaller, Business Associate, ...) is gone');
  check(!(await allOptionTexts(page)).some(t => SALES_SUPPORT.test(t)), 'no Sales or Support option appears in any dropdown', await allOptionTexts(page));
  check(await page.isVisible('[data-testid="designstudio-roles-hint"]'), 'the form says the department has no Sales or Support role');

  await fill(page, 'Dia Member');
  const sent = await submitted(page);
  check(sent.role === 'TEAM_MEMBER' && sent.teamId === T.dsGeneral && !sent.salesSubRole && !sent.technicalConsultant && !sent.metaVerifier && !sent.headDivision,
    'a Team Member is sent in the General team of Amuwa Design Studio, with no Sales role', sent);
  await page.close();
}
{
  // a Department Head: the head of the whole department, no Sales / Support picker
  const page = await open();
  await page.selectOption('#dept', 'ai-design-studio');
  await page.waitForFunction(T => [...document.querySelectorAll('select option')].some(o => o.value === T), T.dsGeneral);
  await page.selectOption('#staff-role', 'DEPARTMENT_HEAD');
  check((await page.$$('[data-testid="head-departments"]')).length === 0, 'Department Head: no Sales / Support head picker is shown');
  check(!(await allOptionTexts(page)).some(t => SALES_SUPPORT.test(t)), 'Department Head: no Sales or Support option anywhere');
  await fill(page, 'Dev Head');
  const sent = await submitted(page);
  check(sent.role === 'DEPARTMENT_HEAD' && sent.departmentId === DS && !sent.headDivision && !sent.teamId && !sent.operationsHead && !(sent.additionalAccess?.length),
    'Department Head: sent for Amuwa Design Studio itself, no side, no team, not an Operations Head', sent);
  await page.close();
}
{
  // Team Lead, and switching back to a Sales / Support department restores its options
  const page = await open();
  await page.selectOption('#dept', 'ai-design-studio');
  await page.waitForFunction(T => [...document.querySelectorAll('select option')].some(o => o.value === T), T.dsGeneral);
  await page.selectOption('#staff-role', 'TEAM_HEAD');
  check((await teamOptions(page)).join() === T.dsGeneral, 'Team Lead: General team only');
  await page.selectOption('#dept', 'wabastore');
  await page.waitForFunction(T => [...document.querySelectorAll('select option')].some(o => o.value === T), T.wsSales);
  check((await teamOptions(page)).sort().join() === [T.wsSales, T.wsSupport].sort().join(), 'back to Wabastore: its Sales and Support teams are offered again', await teamOptions(page));
  check(/Technical Consultant/.test((await roleOptions(page)).join('|')), 'and its Support roles again');
  check(!(await page.$eval(teamSelect, s => s.value)) || [T.wsSales, T.wsSupport].includes(await page.$eval(teamSelect, s => s.value)), 'the Amuwa Design Studio team is not kept');
  await page.close();
}
{
  // HR's employee request form
  const page = await open(true);
  await page.selectOption('select:has(option:text("Choose a department"))', '11111111-1111-4111-8111-111111111111');
  await page.selectOption('select:has(option:text("Not specified"))', 'SALES');
  await page.selectOption('select:has(option:text("Operations Head"))', 'OPERATIONS_HEAD');
  const listed = await page.$$eval('select:has(option:text("Choose a department")) option', os => os.map(o => o.textContent.trim()));
  check(listed.includes('Amuwa Design Studio') && listed.includes('AI Design Studio') && !listed.some(t => /Retired/i.test(t)), 'request form: Amuwa Design Studio and AI Design Studio are both listed, neither is Retired', listed);
  await page.selectOption('select:has(option:text("Choose a department"))', DS);
  const sides = await page.$$eval('select:has(option:text("Not specified")) option', os => os.map(o => o.textContent.trim()));
  check(sides.join('|') === 'Not specified|General', 'request form: Amuwa Design Studio offers the General side only', sides);
  check(await page.$eval('select:has(option:text("Not specified"))', s => s.value) === '', 'request form: the Sales side chosen for Wabastore is cleared');
  const roles = await page.$$eval('select:has(option:text("Team Lead")) option', os => os.map(o => o.textContent.trim()));
  check(roles.join('|') === 'Department Head|Team Lead|Team Member', 'request form: Department Head, Team Lead, Team Member only (no Operations Head)', roles);
  await page.close();
}
{
  // Amuwa Design Studio (slug designstudio) is an ordinary, active department: the Super Admin adds a Team Member, a Team Lead and a Department Head
  for (const [role, label] of [['TEAM_MEMBER', 'Team Member'], ['TEAM_HEAD', 'Team Lead'], ['DEPARTMENT_HEAD', 'Department Head']]) {
    const page = await open();
    check((await page.$$eval('#dept option', os => os.map(o => o.textContent.trim()))).filter(t => /Design Studio/.test(t)).join('|') === 'AI Design Studio|Amuwa Design Studio', 'the department list shows AI Design Studio and Amuwa Design Studio, never Retired');
    await page.selectOption('#dept', 'designstudio');
    await page.waitForFunction(T => [...document.querySelectorAll('select option')].some(o => o.value === T), T.amGeneral);
    check((await page.$$('[data-testid="retired-department"]')).length === 0 && !/retired/i.test(await page.innerText('body')), `${label}: no Retired notice anywhere in the form`);
    check((await roleOptions(page)).join('|') === 'Department Head|Team Lead|Team Member', `${label}: Department Head, Team Lead, Team Member are offered (no Sales or Support role)`);
    check((await teamOptions(page)).join() === T.amGeneral, `${label}: the team list is its General team only`, await teamOptions(page));
    await page.selectOption('#staff-role', role);
    await fill(page, 'Amu ' + label);
    check(!(await page.$eval('button[type="submit"]', b => b.disabled)), `${label}: the Create button is enabled`);
    const sent = await submitted(page);
    check(sent.role === role && !sent.salesSubRole && !sent.headDivision && (role === 'DEPARTMENT_HEAD' ? sent.departmentId === OLD && !sent.teamId : sent.teamId === T.amGeneral),
      `${label}: sent for Amuwa Design Studio (slug designstudio) with no Sales / Support side`, sent);
    await page.close();
  }
}
for (const [name, vp] of [['phone', { width: 360, height: 740 }], ['desktop', { width: 1440, height: 900 }]]) {
  const page = await open(false, vp);
  await page.selectOption('#dept', 'ai-design-studio');
  await page.waitForFunction(T => [...document.querySelectorAll('select option')].some(o => o.value === T), T.dsGeneral);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, w: document.querySelector('#staff-role').getBoundingClientRect().width }));
  check(m.sw <= m.iw && m.w > 150, `${name}: the form fits and the Role dropdown is usable`, m);
  await page.close();
}
await browser.close();
console.log(`=== AMUWA DESIGN STUDIO ROLES BROWSER TESTS PASSED (${passed}) ===`);
