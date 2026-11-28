// Browser test of HR > AI Studio Performance (20270302000100) and the daily report's word counter. Real React components + the app's real stylesheet
// (npm run build first); the API is an in-page stand-in that follows the real contract. Skipped, loudly, when Playwright, Chromium or dist/ are missing.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the AI Studio HR browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const cssFile = existsSync(cssDir) ? readdirSync(cssDir).find(f => /^index-.*\.css$/.test(f)) : null;
if (!cssFile) { console.log('SKIPPED - dist/ is not built (npm run build), the AI Studio HR browser test did not run'); process.exit(0); }
const css = readFileSync(path.join(cssDir, cssFile), 'utf8');
const work = mkdtempSync(path.join(tmpdir(), 'aihr-ui-'));
const out = path.join(work, 'bundle.js');
await build({
  entryPoints: ['supabase/tests/ui/ai_studio_hr_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' }, jsx: 'automatic', logLevel: 'error',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /\/context\/(AuthContext|DepartmentContext)$/ }, () => ({ path: path.resolve('supabase/tests/ui/hr_designations_stubs.ts') }));
    b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: path.resolve('supabase/tests/ui/client_journey_supabase_stub.ts') }));
  } }]
});
const bundle = readFileSync(out, 'utf8');

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }

const apiScript = (admin) => {
  window.__departments = [];
  window.__profile = { id: 'u1', fullName: admin ? 'Super Admin' : 'HR Viewer', role: admin ? 'SUPER_ADMIN' : 'TEAM_MEMBER', status: 'ACTIVE' };
  window.__posts = [];
  const task = (title, projectId, projectName, completed) => ({ taskId: title, title, projectId, projectName, status: completed ? 'COMPLETED' : 'IN_PROGRESS', progress: completed ? 100 : 40, completed, notes: ['Updated today'] });
  const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const report = (id, member, memberName, lead, leadName, tasks) => ({ id, reportDate: day, memberId: member, memberName, leadId: lead, leadName, teamName: `${leadName}'s team`, tasks,
    projectIds: [...new Set(tasks.map(t => t.projectId))], description: 'Built the onboarding screens and fixed the layout of the client dashboard on phones today.',
    workCompleted: 'Onboarding screens', pendingWork: 'Tests', blockers: null, remarks: 'Good progress', status: 'PENDING_DH_APPROVAL', approvalStatus: 'APPROVED', approvedBy: leadName,
    approvedAt: new Date().toISOString(), sentToHrAt: new Date().toISOString(), revision: 1, completedTasks: tasks.filter(t => t.completed).length, pendingTasks: tasks.filter(t => !t.completed).length });
  const perf = {
    from: day, to: day,
    teams: [
      { leadId: 'l1', leadName: 'Asha Lead', teamName: "Asha Lead's team", projects: [{ id: 'p1', name: 'AI CRM' }], members: [{ id: 'm1', name: 'Ravi Member', projects: [{ id: 'p1', name: 'AI CRM' }] }, { id: 'm2', name: 'Neha Member', projects: [{ id: 'p2', name: 'AIQR' }] }] },
      { leadId: 'l2', leadName: 'Vikram Lead', teamName: "Vikram Lead's team", projects: [{ id: 'p2', name: 'AIQR' }], members: [{ id: 'm3', name: 'Kiran Member', projects: [{ id: 'p2', name: 'AIQR' }] }] }
    ],
    projects: [
      { id: 'p1', name: 'AI CRM', status: 'ACTIVE', people: [{ id: 'l1', name: 'Asha Lead', role: 'LEAD', leadId: 'l1' }, { id: 'm1', name: 'Ravi Member', role: 'MEMBER', leadId: 'l1' }] },
      { id: 'p2', name: 'AIQR', status: 'ACTIVE', people: [{ id: 'l2', name: 'Vikram Lead', role: 'LEAD', leadId: 'l2' }, { id: 'm2', name: 'Neha Member', role: 'MEMBER', leadId: 'l1' }, { id: 'm3', name: 'Kiran Member', role: 'MEMBER', leadId: 'l2' }] }
    ],
    memberReports: [
      report('r1', 'm1', 'Ravi Member', 'l1', 'Asha Lead', [task('Onboarding screens', 'p1', 'AI CRM', true), task('Dashboard layout', 'p1', 'AI CRM', false)]),
      report('r2', 'm3', 'Kiran Member', 'l2', 'Vikram Lead', [task('QR studio', 'p2', 'AIQR', true)])
    ],
    leadReports: [{ id: 'lr1', reportDate: day, leadId: 'l1', leadName: 'Asha Lead', teamName: "Asha Lead's team", status: 'PENDING_DH_APPROVAL', sentToHrAt: new Date().toISOString(),
      description: 'Reviewed the team reports and planned the next sprint with the members of the team.', workCompleted: 'Sprint plan', pendingWork: null, blockers: null, remarks: 'On track',
      tasks: [task('Sprint plan', 'p1', 'AI CRM', true)], projectIds: ['p1'], teamMembers: 2, approvedMemberReports: 1, completedTasks: 1, pendingTasks: 1 }]
  };
  const access = () => ({ allowed: true, canManage: admin, viewers: admin ? window.__viewers : [], candidates: admin ? [{ id: 'h1', name: 'Simran HR', email: 's@x.example' }, { id: 'h2', name: 'Other HR', email: 'o@x.example' }] : [] });
  window.__viewers = [];
  const json = (data, status = 200) => new Response(JSON.stringify(status < 400 ? { success: true, data } : { success: false, error: data }), { status, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (url, init = {}) => {
    const u = new URL(url, 'http://localhost');
    const method = (init.method || 'GET').toUpperCase();
    const p = u.pathname.replace('/api/v1', '');
    if (p === '/ai-studio/hr-performance/access') return json(access());
    if (p === '/ai-studio/hr-performance/viewers' && method === 'POST') {
      const b = JSON.parse(init.body); window.__posts.push(b);
      window.__viewers = b.allowed ? [...window.__viewers, { id: b.profileId, name: 'Simran HR', email: 's@x.example', active: true, grantedAt: new Date().toISOString() }] : window.__viewers.filter(v => v.id !== b.profileId);
      return json(access());
    }
    if (p === '/ai-studio/hr-performance') return json(perf);
    // the AI Studio weekly report (20270308000100)
    const stats = { weekStart: day, weekEnd: day, team: "Asha Lead's team", members: [{ id: 'l1', name: 'Asha Lead', isLead: true, reportsSubmitted: 3, reportsApproved: 0, tasksCompleted: 1, tasksPending: 0, tasksOverdue: 0 },
      { id: 'm1', name: 'Ravi Member', isLead: false, reportsSubmitted: 5, reportsApproved: 4, tasksCompleted: 3, tasksPending: 1, tasksOverdue: 0 }],
      projects: [{ id: 'p1', name: 'AI CRM', tasksCompleted: 4, tasksPending: 1, people: 2 }], totals: { members: 1, reportsSubmitted: 8, reportsApproved: 4, tasksCompleted: 4, tasksPending: 1, projects: 1 } };
    window.__weekly = window.__weekly ?? null;
    const weeklyRow = () => ({ id: 'w1', leadId: 'l1', leadName: 'Asha Lead', team: "Asha Lead's team", weekStart: day, weekEnd: day, status: 'SUBMITTED', completedWork: 'Shipped the CRM login', pendingWork: 'Reports page',
      achievements: 'Live on time', challenges: 'API keys late', remarks: 'Good week', stats, revision: 1, submittedAt: new Date().toISOString(), reviewedBy: null, reviewedAt: null, reviewComment: null, updatedAt: new Date().toISOString(), events: [], ...(window.__weekly ?? {}) });
    if (p === '/ai-studio/weekly-reports/week') return json({ weekStart: u.searchParams.get('weekStart'), weekEnd: day, report: window.__weekly ? weeklyRow() : null, liveStats: stats });
    if (p === '/ai-studio/weekly-reports' && method === 'POST') { const b = JSON.parse(init.body); window.__posts.push(b); window.__weekly = { ...b, status: b.submit ? 'SUBMITTED' : 'DRAFT' }; return json(weeklyRow()); }
    if (p === '/ai-studio/weekly-reports' && method === 'GET') return json([weeklyRow()]);
    if (p === '/ai-studio/weekly-reports/w1/review' && method === 'POST') { const b = JSON.parse(init.body); window.__posts.push(b); window.__weekly = { status: 'ACKNOWLEDGED', reviewedBy: 'Super Admin', reviewComment: b.comment ?? null }; return json(weeklyRow()); }
    if (p === '/ai-studio/weekly-reports/w1') return json(weeklyRow());
    // the daily report form
    if (p === '/ai-studio/reports/context') return json({ role: 'MEMBER', today: day, hasReviewer: true, reviewer: 'Asha Lead', route: 'LEAD', projects: [], tasks: [] });
    if (p === '/ai-studio/daily-reports/options') return json({ date: day, existingReportId: null, tasks: [] });
    if (p === '/ai-studio/daily-reports' && method === 'POST') { const b = JSON.parse(init.body); window.__posts.push(b); return json({ id: 'new', status: 'PENDING_TL_APPROVAL', ...b }, 201); }
    return json([]);
  };
};
const open = async (mount, viewport = { width: 1280, height: 1000 }, admin = false) => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body><div id="root"></div></body></html>');
  await page.evaluate(apiScript, admin);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(m => window[m](), mount);
  return page;
};
const fits = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

try {
  // ---- HR > AI Studio Performance
  let page = await open('mountHr');
  await page.waitForSelector('[data-testid="ai-studio-hr-performance"]');
  check(/2\s*Approved member reports/.test(await page.innerText('[data-testid="hr-perf-counts"]')), 'the period counts are shown');
  check(!(await page.isVisible('text=HR access (Super Admin)')), 'a named HR employee does not manage access');
  // B. Team Member Reports (the default): Team -> Member -> Project -> report
  check((await page.locator('[data-testid="hr-member"]').count()) === 2, 'Team Member Reports: one entry per member with approved reports');
  await page.locator('[data-testid="hr-member"] summary', { hasText: 'Ravi Member' }).click();
  await page.locator('[data-testid="hr-member-report"] summary').first().click();
  const body = await page.innerText('[data-testid="hr-member-report"]');
  check(/Built the onboarding screens/.test(body) && /Onboarding screens/.test(body) && /Approved by Asha Lead/.test(body) && /Tests/.test(body), 'a report opens with its description, tasks, approval and pending work', body);
  await page.selectOption('select[aria-label="Team"]', 'l2');
  check((await page.locator('[data-testid="hr-member"]').count()) === 1 && /Kiran Member/.test(await page.innerText('[data-testid="ai-studio-hr-performance"]')), 'filtered by team');
  // A. Team Lead Reports
  await page.getByRole('tab', { name: 'Team Lead Reports' }).click().catch(async () => page.click('text=Team Lead Reports'));
  const leads = await page.innerText('[data-testid="hr-lead-reports"]');
  check(/Asha Lead's team/.test(leads) && /1 of 2 member reports approved/.test(leads), 'Team Lead Reports: the team, and the approved-only summary', leads);
  // C. Team-wise
  await page.click('text=Team-wise Performance');
  const team = await page.innerText('[data-testid="hr-team-summary"]');
  check(/2\s*Team members/.test(team) && /1\s*Approved reports/.test(team) && /1\s*Team Lead reports/.test(team), 'Team-wise: the chosen team\'s summary', team);
  // D. Project-wise
  await page.click('text=Project-wise Performance');
  await page.selectOption('[data-testid="hr-project-select"]', 'p2');
  const proj = await page.innerText('[data-testid="hr-project-summary"]');
  check(/Vikram Lead/.test(proj) && /Neha Member/.test(proj) && /Kiran Member/.test(proj), 'Project-wise: the Team Lead and the assigned members', proj);
  check(/QR studio/.test(await page.innerText('[data-testid="hr-project-history"]')) || (await page.locator('[data-testid="hr-project-history"] [data-testid="hr-member-report"]').count()) === 1, 'Project-wise: the project\'s history');
  await page.close();

  // ---- (20270308000100) Simran's side-panel section is "Daily Reports – AI Studio"
  page = await open('mountHr');
  await page.waitForSelector('[data-testid="ai-studio-hr-performance"]');
  check(await page.getByRole('heading', { name: 'Daily Reports – AI Studio' }).isVisible() && /Team Member → Team Lead → HR/.test(await page.innerText('[data-testid="ai-studio-hr-performance"]')),
    'the section is "Daily Reports – AI Studio" and says the reports come Team Member → Team Lead → HR');
  await page.close();

  // ---- the AI Studio weekly report: the Team Lead writes it for the Super Admin
  page = await open('mountWeeklyLead');
  await page.waitForSelector('[data-testid="ai-weekly-lead"] [data-testid="weekly-figures"]');
  const fig = await page.innerText('[data-testid="weekly-figures"]');
  check(/Ravi Member/.test(fig) && /AI CRM/.test(fig) && /Approved daily reports/i.test(fig), 'the Team Lead sees the week team-wise and project-wise', fig);
  await page.click('[data-testid="weekly-submit"]');
  await page.waitForSelector('text=Describe the work your team completed this week');
  check(await page.evaluate(() => window.__posts.length) === 0, 'nothing is sent without the completed work');
  await page.fill('#weekly-completedWork', 'Shipped the CRM login and the dashboard.');
  await page.fill('#weekly-achievements', 'Live on time');
  await page.fill('#weekly-challenges', 'API keys late');
  await page.click('[data-testid="weekly-submit"]');
  await page.waitForFunction(() => window.__posts.length === 1);
  const wk = await page.evaluate(() => window.__posts[0]);
  check(wk.submit === true && wk.completedWork.startsWith('Shipped') && wk.achievements === 'Live on time' && !('leadId' in wk) && !('receiver' in wk),
    'it is submitted with the week and the text only (the database decides who receives it)', wk);
  await page.waitForSelector('text=Submitted · with the Super Admin');
  check(true, 'the status says it is with the Super Admin');
  await page.close();
  // the Super Admin acknowledges it
  page = await open('mountWeeklyAdmin', { width: 1280, height: 1000 }, true);
  await page.waitForSelector('[data-testid="weekly-row"]');
  await page.click('[data-testid="weekly-row"]');
  await page.waitForSelector('[data-testid="weekly-dialog"]');
  const dlg = await page.innerText('[data-testid="weekly-dialog"]');
  check(/Shipped the CRM login/.test(dlg) && /Live on time/.test(dlg) && /API keys late/.test(dlg) && /AI CRM/.test(dlg), 'the Super Admin reads completed work, achievements, challenges and the figures', dlg);
  await page.click('[data-testid="weekly-return"]');
  await page.waitForSelector('text=Write what the Team Lead should change.');
  check(await page.evaluate(() => window.__posts.length) === 0, 'returning without a comment sends nothing');
  await page.click('[data-testid="weekly-acknowledge"]');
  await page.waitForFunction(() => window.__posts.length === 1);
  check((await page.evaluate(() => window.__posts[0])).decision === 'ACKNOWLEDGE', 'Acknowledge is sent');
  await page.close();

  // the Super Admin names who may open it
  page = await open('mountHr', { width: 1280, height: 1000 }, true);
  await page.waitForSelector('text=HR access (Super Admin)');
  await page.selectOption('[data-testid="hr-viewer-pick"]', 'h1');
  await page.click('text=Give access');
  await page.waitForFunction(() => window.__posts.length === 1);
  check(JSON.stringify(await page.evaluate(() => window.__posts[0])) === JSON.stringify({ profileId: 'h1', allowed: true }), 'the Super Admin gives Simran access (an id and a yes only)');
  await page.waitForSelector('[data-testid="hr-viewers"] >> text=Simran HR');
  check(true, 'the named HR employee is listed');
  await page.close();

  // phone widths: nothing scrolls sideways
  for (const width of [390, 320]) {
    page = await open('mountHr', { width, height: 800 });
    await page.waitForSelector('[data-testid="ai-studio-hr-performance"]');
    check(await fits(page), `${width}px: the page fits (tables scroll inside their card)`);
    await page.close();
  }

  // ---- the Team Member's form (20270308000100, 20270312000100): Work Completed 10-150 (required) / Work Pending 100 / Additional Note 50, each with a live counter
  page = await open('mountForm');
  await page.waitForSelector('[data-testid="report-word-fields"]');
  const formText = await page.innerText('form[aria-label="Daily report"]').catch(() => page.innerText('body'));
  check(/Work Completed/.test(formText) && /Work Pending/.test(formText) && /Additional Note/.test(formText) && !/Daily work description/.test(formText)
    && !/Additional information/.test(formText) && !/Tomorrow/.test(formText) && !/Challenges/.test(formText), 'only the three fields are asked (no description, no additional-work section)', formText.slice(0, 600));
  await page.fill('#ai-dr-workCompleted', 'Worked on the onboarding screens');
  check((await page.innerText('[data-testid="report-count-workCompleted"]')) === '5 / 150 words', 'the counter counts words');
  await page.click('[data-testid="daily-submit"]');
  await page.waitForSelector('text=Write at least 10 words (5 more needed).');
  check(await page.evaluate(() => window.__posts.length) === 0, 'below 10 words in Work Completed nothing is sent, and the form says how many are needed');
  await page.fill('#ai-dr-workCompleted', 'Worked on the onboarding screens and fixed the two layout bugs');
  await page.fill('#ai-dr-pendingWork', Array.from({ length: 101 }, (_, i) => `w${i}`).join(' '));
  check((await page.innerText('[data-testid="report-count-pendingWork"]')) === '101 / 100 words' && /1 word over the limit/.test(await page.innerText('[data-testid="report-word-fields"]'))
    && await page.isDisabled('[data-testid="daily-submit"]'),
    'Work Pending over 100 words: the counter says so and Submit is disabled');
  await page.fill('#ai-dr-pendingWork', 'Tests for the screens');
  check(!(await page.isDisabled('[data-testid="daily-submit"]')), 'within the limits Submit is enabled (the description is no longer needed)');
  await page.click('[data-testid="daily-submit"]');
  await page.click('text=Confirm submission');
  await page.waitForFunction(() => window.__posts.length === 1);
  const sent = await page.evaluate(() => window.__posts[0]);
  check(sent.submit === true && sent.workCompleted === 'Worked on the onboarding screens and fixed the two layout bugs' && sent.pendingWork === 'Tests for the screens' && !sent.workDescription, 'the three fields are sent with the report', sent);
  await page.close();
} finally {
  await browser.close();
}
console.log(`=== AI STUDIO HR BROWSER TESTS PASSED (${passed}) ===`);
