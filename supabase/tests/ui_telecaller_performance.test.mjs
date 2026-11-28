// Browser test of the Telecaller performance screens (docs/hr-dashboard-upgrade.md, Phase 3) and the HR overview cards (Phase 5), at desktop and
// phone width: the weekly list with cards that filter on the server, one Telecaller's history, HR's meeting report with an improvement plan,
// a call target, the Telecaller's own page (no HR notes, no HR buttons), and the overview cards opening their pages. The components are the real
// ones; the API is a fake.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Telecaller performance browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/telecaller_performance_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

const week = (over = {}) => ({
  id: 'w1', profileId: 't1', name: 'Asha Caller', employeeCode: 'EMP-0007', department: 'Wabastore', team: 'Sales A', weekStart: '2026-11-16', weekEnd: '2026-11-22',
  status: 'FINAL', category: 'LOW_PERFORMANCE', reason: null, scheduledDays: 6, leaveDays: 1, eligibleDays: 5, dailyTarget: 60, weeklyTarget: null, adjustedTarget: 300,
  actualCalls: 150, connectedCalls: 90, notConnectedCalls: 60, incomingCalls: 4, missedCalls: 1, uniqueContacts: 120, talkSeconds: 9000, averageConnectedSeconds: 100,
  connectionRate: 60, achievement: 50, mappingOk: true, dataComplete: true, breakdown: {}, computedAt: '2026-11-23T04:00:00Z', finalizedAt: '2026-11-23T04:00:00Z', recalcCount: 0,
  reviewStatus: 'SCHEDULED', reviewReason: 'Below 70%', meetingId: 'm1', meeting: { id: 'm1', startsAt: '2026-11-26T05:30:00Z', status: 'SCHEDULED' }, previousAchievement: 62,
  unavailable: ['dispositions'], ...over
});
let mode = 'hr';
let calls = [];
let wk;
let plans;
let reports;
function profile() {
  const self = mode === 'tc';
  return { profileId: 't1', name: 'Asha Caller', isSelf: self, isHr: mode === 'hr', today: '2026-11-28', dailyTarget: 60, weeklyTarget: null, todayCalls: 41, thisWeek: null,
    days: [], weeks: [wk], reports: self ? [] : reports, plans, meetings: [{ id: 'm1', title: 'Performance review: Asha Caller', startsAt: '2026-11-26T05:30:00Z', status: wk.reviewStatus === 'COMPLETED' ? 'COMPLETED' : 'SCHEDULED' }],
    actionItems: [] };
}
const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
const fail = (res, status, code, message) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: { code, message } })); };
function api(req, res, body) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/^\/api\/v1/, '');
  const q = Object.fromEntries(u.searchParams);
  calls.push({ method: req.method, path: p, query: q, body });
  if (p === '/performance/telecallers' && req.method === 'GET') {
    const rows = [wk, week({ id: 'w2', profileId: 't2', name: 'Bina Caller', category: 'TARGET_ACHIEVED', achievement: 104, actualCalls: 312, reviewStatus: 'NONE', meeting: null, meetingId: null, previousAchievement: null })];
    return ok(res, { weekStart: q.weekStart ?? '2026-11-16', weekEnd: '2026-11-22', rows: rows.filter(r => !q.category || r.category === q.category),
      cards: { telecallers: 2, evaluated: 2, achieved: 1, onTrack: 0, needsImprovement: 0, low: 1, insufficient: 0, average: 77, pendingMeetings: 1, completedMeetings: 0 },
      sync: [], policy: { enabled: false, approvedAt: null, achievedPct: 100, onTrackPct: 80, needsImprovementPct: 70, reviewBelowPct: 70 }, canManage: mode === 'hr', isHr: mode === 'hr', lastRun: null,
      options: { telecallers: [{ id: 't1', name: 'Asha Caller', departmentId: 'd1', teamId: 'tm1' }], teams: [{ id: 'tm1', name: 'Sales A', departmentId: 'd1' }], departments: [{ id: 'd1', name: 'Wabastore' }], designations: ['Telecaller'] } });
  }
  if (p === '/performance/telecallers/t1') return ok(res, profile());
  if (p === '/performance/telecallers/targets' && req.method === 'GET') return ok(res, []);
  if (p === '/performance/telecallers/targets' && req.method === 'POST') {
    return ok(res, [{ id: 'g1', scopeType: body.scopeType, department: 'Wabastore', team: null, designation: null, employee: null, dailyCalls: body.dailyCalls, weeklyCalls: null,
      effectiveFrom: body.effectiveFrom, effectiveTo: null, note: null, by: 'Payal HR', at: '2026-11-28T06:00:00Z', canManage: true }]);
  }
  if (p === '/performance/weeks/w1/report') {
    if (body.outcome === 'IMPROVEMENT_PLAN' && !body.plan) return fail(res, 422, 'VALIDATION_ERROR', 'An improvement plan needs the agreed targets and the review deadline.');
    wk = { ...wk, reviewStatus: 'COMPLETED' };
    reports = [{ id: 'r1', meetingId: 'm1', outcome: body.outcome, fields: body.fields, actionItems: [], followUpDate: null, by: 'Payal HR', at: '2026-11-28T06:00:00Z' }];
    if (body.plan) plans = [{ id: 'pl1', targets: body.plan.targets, support: null, startDate: '2026-11-28', deadline: body.plan.deadline, status: 'OPEN', closedRemarks: null, closedAt: null }];
    return ok(res, profile());
  }
  if (p === '/hr/reviews') return ok(res, { today: '2026-11-28', canManage: true, departments: [], rows: [],
    cards: q.type === 'INTERNSHIP' ? { upcoming: 0, due10: 0, due4: 0, pendingDh: 0, pendingCeo: 0, pendingHr: 0, overdue: 1, confirmed: 0, extended: 0, internshipsUpcoming: 2, configIssues: 0 }
      : { upcoming: 4, due10: 3, due4: 1, pendingDh: 1, pendingCeo: 1, pendingHr: 2, overdue: 0, confirmed: 5, extended: 1, internshipsUpcoming: 0, configIssues: 0 } });
  fail(res, 404, 'NOT_FOUND', `no fake for ${req.method} ${p}`);
}
const srv = createServer((req, res) => {
  if (req.url.startsWith('/api/v1/')) {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => api(req, res, raw ? JSON.parse(raw) : undefined));
    return;
  }
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.dismiss(); });
    const noSideways = async who => { const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); check(wide <= 1, `${label}: no sideways scrolling (${who})`, wide); };

    // ---- HR: the weekly list
    mode = 'hr'; calls = []; wk = week(); plans = []; reports = [];
    await page.goto(base);
    await page.evaluate(() => window.mountPerf());
    await page.getByTestId('tc-cards').waitFor();
    const cards = await page.getByTestId('tc-cards').innerText();
    check(/Low performance\s*1/.test(cards) && /Average achievement\s*77%/.test(cards), `${label}: the cards show the counts and the average`, cards);
    check(/Automatic review meetings are off/.test(await page.getByTestId('telecaller-performance').innerText()), `${label}: the policy being off is stated`);
    await page.getByTestId('tc-card-low').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="tc-table"] tbody tr').length === 1);
    check(calls.some(c => c.path === '/performance/telecallers' && c.query.category === 'LOW_PERFORMANCE'), `${label}: a card filters on the server`, calls.at(-1));
    const table = await page.getByTestId('tc-table').innerText();
    check(/Asha Caller/.test(table) && /50%/.test(table) && !/Bina Caller/.test(table), `${label}: the filtered list holds the low performer only`, table);
    await page.getByRole('button', { name: 'Next week' }).click();
    await page.waitForFunction(() => /23 Nov 2026/.test(document.querySelector('[data-testid="tc-week"]')?.textContent ?? ''));
    check(calls.some(c => c.path === '/performance/telecallers' && c.query.weekStart === '2026-11-23'), `${label}: the week can be changed`);
    await page.getByRole('button', { name: 'Previous week' }).click();
    await page.waitForFunction(() => /16 Nov 2026/.test(document.querySelector('[data-testid="tc-week"]')?.textContent ?? ''));
    await noSideways('HR list');

    // ---- one Telecaller: the report with an improvement plan
    await page.getByTestId('tc-table').getByText('Asha Caller').click();
    await page.getByTestId('tc-profile').waitFor();
    check(/Calls today\s*41/.test(await page.getByTestId('tc-profile').innerText()), `${label}: the Telecaller's day and target are shown`);
    await page.getByRole('button', { name: 'Write report' }).click();
    const form = page.getByTestId('tc-report-form');
    await form.waitFor();
    await form.getByLabel('Performance gap discussed (required)').fill('Calls at half of the adjusted target');
    await form.getByLabel('HR observations (required)').fill('Opening script needs work');
    await form.getByLabel('Outcome').selectOption('IMPROVEMENT_PLAN');
    await form.getByLabel('Agreed targets (required)').fill('80% of the adjusted target for three weeks');
    await form.getByLabel('Review deadline (required)').fill('2026-12-19');
    await form.getByRole('button', { name: 'Save report' }).click();
    await page.getByText('Meeting report saved. The review is completed.').first().waitFor();
    const rep = calls.find(c => c.path === '/performance/weeks/w1/report');
    check(rep && rep.body.outcome === 'IMPROVEMENT_PLAN' && rep.body.plan.deadline === '2026-12-19' && rep.body.fields.hrObservations === 'Opening script needs work', `${label}: the report and plan are sent`, rep?.body);
    await page.getByTestId('tc-plan').waitFor();
    check(/80% of the adjusted target/.test(await page.getByTestId('tc-plan').innerText()), `${label}: the improvement plan is listed`);
    await page.getByRole('button', { name: 'Close', exact: true }).click();

    // ---- a target
    await page.getByRole('tab', { name: 'Targets' }).click();
    await page.getByTestId('tc-targets').waitFor();
    await page.getByTestId('tc-targets').locator('select').nth(1).selectOption('d1');
    await page.getByLabel('Calls a day').fill('65');
    await page.getByRole('button', { name: 'Save target' }).click();
    await page.getByRole('dialog').filter({ hasText: 'Set a target of 65 calls a day?' }).getByRole('button', { name: 'Set target' }).click();
    await page.getByText('Target saved.').first().waitFor();
    const tg = calls.find(c => c.path === '/performance/telecallers/targets' && c.method === 'POST');
    check(tg && tg.body.scopeType === 'DEPARTMENT' && tg.body.departmentId === 'd1' && tg.body.dailyCalls === 65, `${label}: the target is sent with its scope`, tg?.body);
    await noSideways('targets');

    // ---- the Telecaller's own page
    mode = 'tc'; calls = []; wk = week({ reviewStatus: 'COMPLETED' }); reports = [{ id: 'r1', meetingId: 'm1', outcome: 'IMPROVEMENT_PLAN', fields: { hrObservations: 'Private HR note' }, actionItems: [], followUpDate: null, by: 'Payal HR', at: '2026-11-28T06:00:00Z' }];
    await page.goto(base);
    await page.evaluate(() => window.mountMine());
    await page.getByTestId('tc-profile').waitFor();
    const mine = await page.getByTestId('my-call-performance').innerText();
    check(/My Call Performance/.test(mine) && /Improvement plans/.test(mine) && !/Private HR note/.test(mine), `${label}: the Telecaller sees their figures and plan, not HR's notes`, mine);
    check(await page.getByRole('button', { name: /Write report|Schedule meeting|Recalculate|Close plan/ }).count() === 0, `${label}: and no HR buttons`);
    await noSideways('Telecaller');

    // ---- the HR overview cards
    mode = 'hr'; calls = [];
    await page.goto(base);
    await page.evaluate(() => window.mountOverview());
    await page.getByTestId('hr-upgrade-overview').waitFor();
    await page.waitForFunction(() => /2/.test(document.querySelector('[data-testid="ov-internships"]')?.textContent ?? '') && /1/.test(document.querySelector('[data-testid="ov-tc-low"]')?.textContent ?? ''));
    const ov = await page.getByTestId('hr-upgrade-overview').innerText();
    check(/Confirmations due within 10 days\s*3/.test(ov) && /Awaiting HR decision\s*2/.test(ov) && /Upcoming internship reviews\s*2/.test(ov) && /1 overdue/.test(ov)
      && /Automatic meetings off/.test(ov), `${label}: the overview cards show the review and performance counts`, ov);
    await page.getByTestId('ov-internships').click();
    await page.getByTestId('ov-tc-low').click();
    const opened = await page.evaluate(() => window.openedTabs);
    check(opened.join(',') === 'hr_internships,hr_telecaller_performance', `${label}: a card opens its HR page`, opened);
    await noSideways('overview');
    check(errors.length === 0, `${label}: no script errors and no browser dialogs`, errors);
    await ctx.close();
  }
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== ${passed} TELECALLER PERFORMANCE BROWSER CHECKS PASSED ===`);
