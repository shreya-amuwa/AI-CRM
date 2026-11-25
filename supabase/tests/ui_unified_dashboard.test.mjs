// Browser test of the unified dashboard of International and Reseller (PR 2): the Department Head, the Team Lead and the Team Member each open ONE dashboard
// whose sidebar has a Sales section and a Support section; every entry opens the right workspace for that role INSIDE the same dashboard (the address stays under
// /unified/dashboard/:id, never another dashboard); a role cannot reach another role's page by address; phone width. Real React, the real shell, the real
// navigation and routing, real Chromium. The reused pages (leads, tickets, tasks ...) are replaced by markers: they have their own tests; this one checks
// which page each entry opens (supabase/tests/ui/unified_harness.tsx).
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the unified dashboard browser test did not run'); process.exit(0); }
const work = mkdtempSync(path.join(tmpdir(), 'unified-ui-'));
const out = path.join(work, 'app.js');

// Stand-ins: every value the real file exports becomes a marker component (capitalised names) or a harmless function; a few need a real shape.
const STUBBED = [
  'team-member/pipeline/PipelineWorkspace.tsx', 'team-member/pipeline/shared.tsx', 'team-member/MemberSections.tsx', 'sales-head/LeadAssign.tsx', 'sales-head/LeadList.tsx',
  'sales-head/SalesPerformance.tsx', 'sales-head/SalesReports.tsx', 'department-head/HeadAttendancePage.tsx', 'department-head/HeadLeadsPage.tsx', 'department-head/HeadCustomersPage.tsx',
  'support-member/SupportDeskPage.tsx', 'support-member/SupportLeadViews.tsx', 'support-member/TasksPage.tsx', 'support-member/TeamActivityPage.tsx', 'team-lead/TeamCustomers.tsx',
  'common/TeamMemberManagement.tsx', 'tasks/head/HeadAssign.tsx', 'tasks/head/HeadDaily.tsx', 'tasks/head/HeadReports.tsx', 'tasks/TeamLeadTasksView.tsx', 'tasks/WorkUpdates.tsx',
  'performance/PerformanceManagement.tsx', 'performance/PerformanceHub.tsx', 'reports/ReportsRoute.tsx', 'reports/reportEvents.ts', 'unified/UnifiedOverview.tsx', 'unified/UnifiedSupport.tsx', 'chat/ChatRoute.tsx',
  'issues/IssuesRoute.tsx', 'notifications/NotificationBell.tsx', 'notifications/NotificationsPage.tsx', 'leave/LeaveCenter.tsx', '@context/NotificationContext.tsx', '@lib/workTasks.ts'
].map(p => p.startsWith('@') ? path.resolve('src', p.slice(1)) : path.resolve('src/components', p));
const FIXED = {
  usePipelineCounts: '() => ({ counts: null })', useWorkUpdateCounts: '() => null', useChatNavBadge: '() => 0', useReportsBadge: '() => 0', useNotifications: '() => ({ unreadCount: 0 })',
  useWorkTasks: '() => ({ tasks: [], updates: [], people: [], teams: [], loading: false, error: null, reload: async () => undefined })',
  useMemberWorkspace: '() => ({})', useOpenReportsRequest: '() => undefined', LeaveCenter: '() => null', NotificationBell: '() => null',
  CHAT_NAV: "{ id: 'chat', label: 'Chat', icon: () => null }", ISSUES_NAV: "{ id: 'raise-issue', label: 'Raise an Issue', icon: () => null }", REPORTS_NAV: "{ id: 'work-reports', label: 'Daily Reports', icon: () => null }"
};
const stubSource = file => {
  const src = readFileSync(file, 'utf8');
  const names = [...new Set([...src.matchAll(/export\s+(?:const|function|async function|class)\s+([A-Za-z0-9_]+)/g)].map(m => m[1]))];
  const lines = ["import React from 'react';",
    "const mk = name => props => React.createElement('div', { 'data-stub': name, 'data-props': JSON.stringify(props ?? {}, (k, v) => typeof v === 'function' || (v && v.$$typeof) ? undefined : v) }, name);"];
  for (const n of names) lines.push(`export const ${n} = ${FIXED[n] ?? (/^[A-Z][a-z]/.test(n) && !/^[A-Z0-9_]+$/.test(n) ? `mk(${JSON.stringify(n)})` : '() => undefined')};`);
  if (/export\s+default/.test(src)) lines.push(`export default mk(${JSON.stringify(path.basename(file))});`);
  return lines.join('\n');
};
await build({
  entryPoints: ['supabase/tests/ui/unified_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' },
  jsx: 'automatic', logLevel: 'error', loader: { '.css': 'empty' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: path.resolve('supabase/tests/ui/meeting_presence_supabase_stub.ts') }));
    b.onResolve({ filter: /\/context\/AuthContext$/ }, () => ({ path: path.resolve('supabase/tests/ui/chat_extras_auth_stub.ts') }));
    b.onLoad({ filter: /\/src\/.*\.tsx?$/ }, args => STUBBED.some(s => args.path.replace(/\.tsx?$/, '') === s.replace(/\.tsx?$/, '')) ? { contents: stubSource(args.path), loader: 'js', resolveDir: path.dirname(args.path) } : undefined);
  } }]
});
const bundle = readFileSync(out, 'utf8');
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const css = cssFile ? readFileSync(path.join('dist/assets', cssFile), 'utf8') : '';

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }
const errors = [];
const newPage = async (startPath = '/', viewport = { width: 1280, height: 1000 }) => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('http://unified.test/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div id="root"></div></body></html>' }));
  await page.goto('http://unified.test' + startPath);
  await page.addScriptTag({ content: bundle });
  return page;
};
const open = async (page, who, dept) => {
  await page.evaluate(([w, d]) => window.mount(w, d), [who, dept]);
  try { await page.waitForSelector('nav', { state: 'attached', timeout: 8000 }); } catch (e) { console.error('the dashboard did not render; page errors:', errors, 'body:', (await page.locator('body').innerText()).slice(0, 400)); throw e; }
  await page.waitForTimeout(150);
};
const item = (page, label) => page.locator('nav button').filter({ hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) });
const has = async (page, label) => (await item(page, label).count()) > 0;
const body = page => page.locator('[data-testid^="unified-page-"] [data-stub]').first();
const stub = async page => body(page).getAttribute('data-stub');
const stubProps = async page => JSON.parse((await body(page).getAttribute('data-props')) || '{}');
const where = page => page.evaluate(() => location.pathname);
const click = async (page, label) => { await item(page, label).first().click(); await page.waitForTimeout(120); };
// an entry opens a marker (and the address stays in the unified dashboard)
const opens = async (page, label, expected, extraCheck) => {
  await click(page, label);
  const s = await stub(page);
  check(s === expected, `${label} opens ${expected}`, { got: s });
  check((await where(page)).startsWith('/unified/dashboard/u1'), `${label}: stays in the unified dashboard`, await where(page));
  if (extraCheck) check(await extraCheck(await stubProps(page)), `${label}: opened with the right settings`, await stubProps(page));
};

try {
  // ======================================================================== Team Member
  let page = await newPage();
  await open(page, 'member', 'International');
  check((await page.locator('nav').count()) >= 1, 'a sidebar is shown');
  const nav = (await page.locator('nav').first().innerText());
  for (const t of ['Overview', 'Sales', 'Support', 'Add Lead', 'My Leads', 'Lead Follow-ups', 'My Customers', 'My Support Tickets', 'My Assigned Tasks', 'Daily Reports', 'Chat', 'Notification Center', 'Profile', 'Raise an Issue', 'Attendance', 'Meeting Request'])
    check(nav.toLowerCase().includes(t.toLowerCase()), `Team Member: the sidebar has ${t}`, nav);
  // the order of the entries in the sidebar text (innerText does not always break between neighbouring entries, so positions are compared, not lines)
  const lines = nav.toLowerCase();
  const at = t => lines.indexOf(t.toLowerCase());
  check(at('Sales') > -1 && at('Support') > -1 && (await page.locator('nav').count()) === 1, 'Team Member: Sales and Support are two sections of the SAME sidebar', lines);
  check(at('Sales') < at('Add Lead') && at('Add Lead') < at('Lead Follow-ups') && at('Lead Follow-ups') < at('Support') && at('Support') < at('My Customers') && at('My Customers') < at('My Support Tickets'),
    'Team Member: the Sales entries come under Sales and the Support entries under Support');
  for (const t of ['Team Members', 'Department Leads', 'Lead Assignment', 'Sales Reports', 'Customer Issues', 'Team Attendance', 'Team Activity', 'My Performance', 'Performance Management']) check(!(await has(page, t)), `Team Member: no ${t}`);
  check(!/performance/i.test(nav), 'Team Member: no performance entry of any kind in the sidebar (20270210000100)', nav);
  check((await page.locator('[data-testid="unified-page-overview"] [data-stub="UnifiedOverview"]').count()) === 1, 'the Overview opens first');
  check(JSON.parse(await page.locator('[data-testid="unified-page-overview"] [data-stub="UnifiedOverview"]').getAttribute('data-props')).who === 'MEMBER', 'the Overview is the Team Member\'s');
  await opens(page, 'Add Lead', 'PipelineWorkspace', p => p.section === 'leads' && p.startWithAdd === true && p.ownOnly === true);
  await click(page, 'My Leads');
  await opens(page, 'Potential', 'PipelineWorkspace', p => p.section === 'potential');
  await opens(page, 'Customer onboarding', 'PipelineWorkspace', p => p.section === 'onboarding');
  await opens(page, 'Part payments', 'PipelineWorkspace', p => p.section === 'part-payments');
  await opens(page, 'Lead Follow-ups', 'MemberSections');
  await opens(page, 'My Customers', 'UnifiedMemberCustomers');
  check((await where(page)) === '/unified/dashboard/u1/support/customers', 'the address names the Support page');
  await opens(page, 'My Support Tickets', 'UnifiedMemberTickets');
  await opens(page, 'My Assigned Tasks', 'TasksPage');
  await opens(page, 'Daily Reports', 'ReportsRoute');
  await opens(page, 'Chat', 'ChatRoute');
  await opens(page, 'Notification Center', 'NotificationsPage');
  await click(page, 'Profile');
  check(await page.locator('[data-testid="unified-profile"]').count() === 1 && (await page.locator('[data-testid="unified-profile"]').innerText()).includes('Mohan Member') && (await page.locator('[data-testid="unified-profile"]').innerText()).includes('International'), 'Profile shows the person and the department');
  await click(page, 'Overview');
  check((await where(page)) === '/unified/dashboard/u1', 'Overview returns to the dashboard address');
  // Sales and Support never open another dashboard: the whole session stayed under /unified/dashboard
  check((await page.evaluate(() => window.__calls.filter(c => /\/(support|sales)[-/]?(lead|head|member)/.test(c.path)).length)) === 0, 'no other dashboard\'s API was used');
  await page.evaluate(() => window.signOut());
  // deep links
  page = await newPage('/unified/dashboard/u1/support/tickets');
  await open(page, 'member', 'Reseller');
  check((await stub(page)) === 'UnifiedMemberTickets', 'a deep link opens the Support tickets page');
  check((await page.locator('nav').first().innerText()).includes('Reseller') || (await page.locator('header, body').first().innerText()).includes('Reseller'), 'the Reseller dashboard names its department');
  await page.evaluate(() => window.signOut());
  page = await newPage('/unified/dashboard/u1/team');
  await open(page, 'member', 'International');
  check((await stub(page)) === 'UnifiedOverview', 'a Team Member who types the address of Team Members gets the Overview, not the page');
  await page.evaluate(() => window.signOut());

  // ======================================================================== Team Lead
  page = await newPage();
  await open(page, 'lead', 'International');
  const leadNav = await page.locator('nav').first().innerText();
  for (const t of ['Add Lead', 'My Leads', 'Team Leads', 'Lead Follow-ups', 'Sales Performance', 'Customers', 'Support Tickets', 'Team Activity', 'Assign Task', 'Daily Reports', 'Performance Management', 'Team Members'])
    check(leadNav.toLowerCase().includes(t.toLowerCase()), `Team Lead: the sidebar has ${t}`, leadNav);
  for (const t of ['Department Leads', 'Lead Assignment', 'Sales Reports', 'Customer Issues', 'Team Attendance']) check(!(await has(page, t)), `Team Lead: no ${t}`);
  check(JSON.parse(await page.locator('[data-testid="unified-page-overview"] [data-stub="UnifiedOverview"]').getAttribute('data-props')).who === 'LEAD', 'the Overview is the Team Lead\'s');
  await opens(page, 'Add Lead', 'PipelineWorkspace', p => p.startWithAdd === true);
  await opens(page, 'Team Leads', 'TeamCustomers');
  await opens(page, 'Lead Follow-ups', 'MemberSections');
  await opens(page, 'Sales Performance', 'PerformanceManagement', p => p.mode === 'TEAM_LEAD');
  await opens(page, 'Customers', 'SupportLeadCustomers');
  await opens(page, 'Support Tickets', 'SupportLeadTickets');
  await opens(page, 'Team Activity', 'TeamActivityPage');
  await opens(page, 'Assign Task', 'TeamLeadTasksView');
  await opens(page, 'Daily Reports', 'ReportsRoute');
  await opens(page, 'Performance Management', 'PerformanceHub', p => p.mode === 'TEAM_LEAD');
  await opens(page, 'Team Members', 'TeamMemberManagement', p => p.departmentSlug === 'international');
  await page.evaluate(() => window.signOut());
  page = await newPage('/unified/dashboard/u1/sales/department-leads');
  await open(page, 'lead', 'International');
  check((await stub(page)) === 'UnifiedOverview', 'a Team Lead who types the address of Department Leads gets the Overview');
  await page.evaluate(() => window.signOut());

  // ======================================================================== Department Head
  page = await newPage();
  await open(page, 'head', 'Reseller');
  const headNav = await page.locator('nav').first().innerText();
  for (const t of ['Add Lead', 'My Leads', 'Department Leads', 'Lead Assignment', 'Sales Performance', 'Sales Reports', 'Customers', 'Support Tickets', 'Customer Issues', 'Team Activity', 'Task Management', 'Daily Reports', 'Performance Management', 'Team Members', 'Team Attendance'])
    check(headNav.toLowerCase().includes(t.toLowerCase()), `Department Head: the sidebar has ${t}`, headNav);
  check(!(await has(page, 'Lead Follow-ups')), 'Department Head: no Lead Follow-ups (a Team Lead / Team Member page)');
  check(JSON.parse(await page.locator('[data-testid="unified-page-overview"] [data-stub="UnifiedOverview"]').getAttribute('data-props')).who === 'HEAD', 'the Overview is the Department Head\'s');
  await opens(page, 'Add Lead', 'HeadLeadsPage');
  await opens(page, 'Department Leads', 'LeadList');
  await opens(page, 'Lead Assignment', 'LeadAssign');
  await opens(page, 'Sales Performance', 'SalesPerformance');
  await opens(page, 'Sales Reports', 'SalesReports');
  await opens(page, 'Customers', 'HeadCustomersPage');
  await opens(page, 'Support Tickets', 'SupportLeadTickets');
  await opens(page, 'Customer Issues', 'SupportDeskPage');
  await opens(page, 'Team Activity', 'TeamActivityPage');
  await click(page, 'Task Management');
  await opens(page, 'Assign Task', 'HeadAssign');
  await opens(page, 'Work updates', 'WorkUpdatesPanel');
  await opens(page, 'Task reports', 'HeadReports');
  await opens(page, 'Daily tasks', 'HeadDaily');
  await opens(page, 'Daily Reports', 'ReportsRoute');
  await opens(page, 'Performance Management', 'PerformanceHub', p => p.mode === 'DEPARTMENT_HEAD');
  await opens(page, 'Team Members', 'TeamMemberManagement', p => p.departmentSlug === 'reseller');
  await opens(page, 'Team Attendance', 'HeadAttendancePage');
  // the browser's Back button returns to the previous workspace without leaving the dashboard
  await page.goBack(); await page.waitForTimeout(150);
  check((await stub(page)) === 'TeamMemberManagement' && (await where(page)).startsWith('/unified/dashboard/u1'), 'Back returns to the previous page of the same dashboard');
  await page.evaluate(() => window.signOut());

  // ======================================================================== phone width: the page does not scroll sideways
  page = await newPage('/', { width: 375, height: 800 });
  await open(page, 'member', 'International');
  const over = await page.evaluate(() => { const W = window.innerWidth; return [document.documentElement.scrollWidth, W, [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > W + 1).slice(0, 6).map(e => `${e.tagName}.${String(e.className).slice(0, 60)} ${Math.round(e.getBoundingClientRect().right)}`)]; });
  check(over[0] <= over[1] + 1, 'phone width: no sideways scrolling', over);
  await page.close();

  check(errors.length === 0, 'no script errors', errors);
  console.log(`=== UNIFIED DASHBOARD BROWSER CHECKS PASSED (${passed}) ===`);
} finally {
  await browser.close();
}
