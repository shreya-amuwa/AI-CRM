// Browser test of the reported error (migration 20270202000300): the Super Admin's Add Team Member form for "Amuwa International Department" and "Amuwa Reseller
// Department" (the departments the owner created, with their own slugs) said "... has no Sales or Support team to manage." and offered the Sales / Support roles.
// Once the department list says they are unified (departments.unified_sales_support) the form offers Department Head, Team Lead and Team Member only, in the
// department's one team and with no Sales / Support side, names the unified Sales & Support dashboard, and sends exactly that. An ordinary department (and one that
// merely says International) keeps its roles. Real React component + the app's real stylesheet (npm run build first); the API is an in-page stand-in.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the unified existing departments browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const cssFile = existsSync(cssDir) ? readdirSync(cssDir).find(f => /^index-.*\.css$/.test(f)) : null;
if (!cssFile) { console.log('SKIPPED - dist/ is not built (npm run build), the unified existing departments browser test did not run'); process.exit(0); }
const css = readFileSync(path.join(cssDir, cssFile), 'utf8');
const stubs = path.resolve('supabase/tests/ui/hr_designations_stubs.ts');
const supa = path.resolve('supabase/tests/ui/client_journey_supabase_stub.ts');
const work = mkdtempSync(path.join(tmpdir(), 'ue-ui-'));
const out = path.join(work, 'bundle.js');
await build({
  entryPoints: ['supabase/tests/ui/unified_existing_form_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' }, jsx: 'automatic', logLevel: 'error',
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
  const U = { 'amuwa-international-department': '11111111-1111-4111-8111-111111111111', 'amuwa-reseller-department': '22222222-2222-4222-8222-222222222222', wabastore: '33333333-3333-4333-8333-333333333333', 'intl-sales-hub': '55555555-5555-4555-8555-555555555555' };
  const NAME = { 'amuwa-international-department': 'Amuwa International Department', 'amuwa-reseller-department': 'Amuwa Reseller Department', wabastore: 'Wabastore', 'intl-sales-hub': 'International Sales Hub' };
  const T = { 'amuwa-international-department': '44444444-4444-4444-8444-444444444441', 'amuwa-reseller-department': '44444444-4444-4444-8444-444444444442' };
  // what the API returns: the database flag is set only after the migration has run (window.__migrated)
  const row = slug => ({ id: slug, slug, dbId: U[slug], name: NAME[slug], description: '', category: 'x', facetOf: null, facetDivision: null,
    unifiedSalesSupport: !!window.__migrated && (slug === 'amuwa-international-department' || slug === 'amuwa-reseller-department') });
  window.__departments = Object.keys(U).map(row);
  window.__profile = { id: 'sa1', fullName: 'Super Admin', email: 'sa@x.example', role: 'SUPER_ADMIN', status: 'ACTIVE', departmentId: null, teamId: null, department: null, team: null };
  window.__posts = [];
  const teams = () => [
    ...(window.__migrated ? [{ id: T['amuwa-international-department'], departmentId: U['amuwa-international-department'], name: 'Amuwa International Department Team', division: 'GENERAL' },
      { id: T['amuwa-reseller-department'], departmentId: U['amuwa-reseller-department'], name: 'Amuwa Reseller Department Team', division: 'GENERAL' }] : []),
    { id: '66666666-6666-4666-8666-666666666661', departmentId: U.wabastore, name: 'Sales', division: 'SALES' }, { id: '66666666-6666-4666-8666-666666666662', departmentId: U.wabastore, name: 'Support', division: 'SUPPORT' },
    { id: '66666666-6666-4666-8666-666666666663', departmentId: U['intl-sales-hub'], name: 'Hub Sales', division: 'SALES' }];
  const json = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (url, init = {}) => {
    const u = new URL(url, 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    const p = u.pathname.replace('/api/v1', '');
    if (p === '/departments') return json(window.__departments.map(d => ({ ...d, isLocked: false, iconName: 'x', accentColor: '#000', logoUrl: null, createdAt: '2026-01-01', slug: d.id, unifiedSalesSupport: d.unifiedSalesSupport })));
    if (p === '/teams') { const id = u.searchParams.get('departmentId'); return json(id ? teams().filter(t => t.departmentId === id) : teams()); }
    if (p === '/users' && method === 'GET') return json({ items: [], total: 0, page: 1, pageSize: 10 });
    if (p === '/users' && method === 'POST') { const body = JSON.parse(init.body); window.__posts.push(body); return json({ id: 'new', email: body.email, fullName: body.fullName, role: body.role, status: 'ACTIVE', hrSubRole: null, department: { id: body.departmentId ?? 'd', slug: 'x', name: 'x' }, team: null }, 201); }
    return json([]);
  };
  // the migration is run: the list the API returns now carries the flag
  window.__runMigration = () => { window.__migrated = true; window.__departments = Object.keys(U).map(row); };
};
const open = async migrated => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body><div id="root"></div></body></html>');
  await page.evaluate(apiScript);
  if (migrated) await page.evaluate(() => window.__runMigration());
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.load());   // the department list, through the real API client: this is what teaches the forms which departments are unified
  await page.evaluate(() => window.mount());
  await page.waitForSelector('#staff-role');
  return page;
};
const optionsOf = page => page.$$eval('#staff-role option', os => os.map(o => o.textContent.trim()));
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
  // BEFORE the migration: the reported behaviour (the form does not know the department is unified)
  const page = await open(false);
  const opts = await optionsOf(page);
  check(opts.includes('CEO'), 'before the migration: the form treats the owner-created department as an ordinary one (Operations Head offered; the reported state)', opts);
  await page.close();
}
for (const [slug, name, dbId] of [['amuwa-international-department', 'Amuwa International Department', '11111111-1111-4111-8111-111111111111'],
                                  ['amuwa-reseller-department', 'Amuwa Reseller Department', '22222222-2222-4222-8222-222222222222']]) {
  const page = await open(true);
  await page.selectOption('#dept', slug);
  const opts = await optionsOf(page);
  check(opts.join('|') === 'Department Head|Team Lead|Team Member', `${name}: only Department Head, Team Lead and Team Member are offered`, opts);
  check(!/Telecaller|Business Associate|Technical Consultant|Meta Verifier|Operations Head/.test(opts.join('|')), `${name}: no Sales-only or Support-only role`);
  for (const [role, label, dash] of [['DEPARTMENT_HEAD', 'Department Head', 'Sales & Support Department Head Dashboard'], ['TEAM_HEAD', 'Team Lead', 'Sales & Support Team Lead Dashboard'], ['TEAM_MEMBER', 'Team Member', 'Sales & Support Team Member Dashboard']]) {
    await page.selectOption('#staff-role', role);
    const will = await page.innerText('text=Will open');
    check(will.includes(dash) && will.includes(name), `${name}: ${label}: "Will open" names the one unified dashboard`, will);
    const shown = await page.innerText('body');
    check(!shown.includes('has no Sales or Support team'), `${name}: ${label}: the error "has no Sales or Support team to manage" is gone`, shown.slice(-600));
  }
  // the Department Head is created: placed in the department itself, one head for both sides
  await page.selectOption('#staff-role', 'DEPARTMENT_HEAD');
  await fill(page, `Test ${slug} Head`);
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => window.__posts.length === 1, null, { timeout: 5000 }).catch(async () => { console.error('form state:', await page.evaluate(() => document.querySelector('[role=alert]')?.textContent)); });
  const sent = await page.evaluate(() => window.__posts[0]);
  check(sent && sent.role === 'DEPARTMENT_HEAD' && sent.departmentId === dbId && !sent.headDivision && !sent.operationsHead && !sent.salesSubRole, `${name}: the Department Head is sent in the department, with no Sales / Support side`, sent);
  await page.close();
}
{
  // Team Lead and Team Member are sent to the department's one (General) team
  const page = await open(true);
  await page.selectOption('#dept', 'amuwa-reseller-department');
  for (const [role, label] of [['TEAM_HEAD', 'Team Lead'], ['TEAM_MEMBER', 'Team Member']]) {
    await page.selectOption('#staff-role', role);
    const teams = await page.$$eval('select:has(option:text("Select team…")) option', os => os.map(o => o.textContent.trim()).filter(t => !/Select team/.test(t)));
    check(teams.length === 1 && /Amuwa Reseller Department Team/.test(teams[0]), `Reseller ${label}: the only team offered is the department's own`, teams);
  }
  await page.close();
}
{
  // an ordinary department, and one that merely says International, keep their roles
  const page = await open(true);
  for (const slug of ['wabastore', 'intl-sales-hub']) {
    await page.selectOption('#dept', slug);
    const opts = (await optionsOf(page)).join('|');
    check(/Department Head/.test(opts) && /Team Lead/.test(opts) && /Team Member/.test(opts) && /CEO/.test(opts), `${slug}: keeps every existing role`, opts);
  }
  await page.close();
}
await browser.close();
console.log(`=== UNIFIED EXISTING DEPARTMENTS BROWSER TESTS PASSED (${passed}) ===`);
