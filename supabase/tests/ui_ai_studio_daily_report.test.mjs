// Browser test of the AI Studio consolidated daily report (20270219000100), at desktop and phone widths (390 and 320 px):
// the tasks are picked across projects, the work recorded on them (completion details, updates, links) is fetched and shown read-only, only new
// remarks are typed, the in-app confirmation lists what is submitted, the request carries task ids and the exact history entries shown (never task
// text or files), a report the tasks changed under is refreshed instead of submitted, and the Department Head reads the consolidated report.
// The API is a fake: what may be picked and seen is decided by the database (supabase/tests/ai_studio_daily_reports_test.sql).
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the AI Studio daily report browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/ai_studio_daily_report_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;
const SHOTS = process.env.SHOTS_DIR;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// ---- the fake API ---------------------------------------------------------------------------------------------------------------------------------
const id = n => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DONE_NOTE = '1. Leads responding positively were still receiving follow-ups.\n2. Leads saying Stop still received messages.\n3. Silent leads kept getting messages after Day 21.\n4. Campaign failure alerts were required.';
const TASKS = {
  [id(1)]: { id: id(1), title: 'Blockers to be found', projectId: id(91), projectName: 'AI Website', status: 'COMPLETED', progress: 100, crossTeam: true, assignedByName: 'AI Lead Two', updatesOnDate: 1 },
  [id(2)]: { id: id(2), title: 'Website Development', projectId: id(92), projectName: 'AI CRM', status: 'IN_PROGRESS', progress: 80, crossTeam: false, assignedByName: 'AI Lead One', updatesOnDate: 2 },
  [id(3)]: { id: id(3), title: 'Not started yet', projectId: id(92), projectName: 'AI CRM', status: 'ASSIGNED', progress: 0, crossTeam: false, assignedByName: 'AI Lead One', updatesOnDate: 0 }
};
const ENTRIES = {
  [id(1)]: [{ id: id(201), at: '2026-11-26T06:43:00Z', status: 'COMPLETED', progress: 100, note: DONE_NOTE }],
  [id(2)]: [{ id: id(202), at: '2026-11-26T04:30:00Z', status: 'IN_PROGRESS', progress: 60, note: 'Mobile responsiveness completed.' },
            { id: id(203), at: '2026-11-26T09:30:00Z', status: 'IN_PROGRESS', progress: 80, note: 'Supporting screenshot uploaded.' }],
  [id(3)]: []
};
const LINKS = { [id(1)]: ['https://ai-crm.vercel.app/preview'], [id(2)]: ['https://github.com/amuwa/site/pull/1', 'javascript:alert(1)'], [id(3)]: [] };
let extraEntry = false; // the "tasks changed while preparing" case adds one entry
const work = ids => [...ids].sort((a, b) => TASKS[a].projectName.localeCompare(TASKS[b].projectName)).map(t => {
  const k = TASKS[t];
  const entries = [...ENTRIES[t], ...(extraEntry && t === id(2) ? [{ id: id(204), at: '2026-11-26T11:00:00Z', status: 'IN_PROGRESS', progress: 85, note: 'Late fix.' }] : [])];
  const last = entries[entries.length - 1];
  return {
    taskId: t, title: k.title, description: null, priority: 'MEDIUM', projectId: k.projectId, projectName: k.projectName, assignedById: id(99), assignedByName: k.assignedByName,
    assignedAt: '2026-11-23T04:00:00Z', dueDate: '2026-11-30', crossTeam: k.crossTeam, entries, noUpdate: entries.length === 0,
    status: last ? last.status : k.status, progress: last ? last.progress : k.progress, progressBefore: t === id(2) ? 50 : t === id(1) ? 40 : null,
    completedAt: last && last.status === 'COMPLETED' ? last.at : null, links: entries.length ? LINKS[t] : [], currentStatus: k.status, currentProgress: t === id(2) ? 100 : k.progress
  };
});
const summary = w => ({
  projects: new Set(w.map(x => x.projectId)).size, tasks: w.length, completed: w.filter(x => x.completedAt).length, inProgress: w.filter(x => !x.completedAt && x.status === 'IN_PROGRESS').length,
  onHold: 0, crossTeam: w.filter(x => x.crossTeam).length, updates: w.reduce((n, x) => n + x.entries.length, 0), links: new Set(w.flatMap(x => x.links).filter(l => /^https?:/.test(l))).size, withoutUpdate: w.filter(x => x.noUpdate).length
});
const calls = [];
let conflictOnce = false;
const REPORT_ID = id(500);
const reportDetail = () => {
  const w = work([id(1), id(2)]);
  return {
    id: REPORT_ID, authorId: id(7), authorName: 'AI Member 1A', authorRole: 'MEMBER', kind: 'DAILY', projectId: null, projectName: null, taskId: null, taskTitle: null,
    reportDate: '2026-11-26', status: 'PENDING_DH_APPROVAL', revision: 1, leadId: id(8), leadName: 'AI Lead One', teamName: 'AI Studio Team', submittedAt: '2026-11-26T13:00:00Z',
    approvedAt: null, updatedAt: '2026-11-26T13:00:00Z', counts: { projects: 2, tasks: 2, completed: 1, crossTeam: 1 }, hasBlockers: false,
    workCompleted: null, workInProgress: null, pendingWork: 'Write the tests', blockers: null, remarks: null, tomorrowPlan: 'Final testing', authorDesignation: 'Team Member',
    tlComment: null, tlReviewedAt: null, tlReviewerName: null, dhComment: null, dhReviewedAt: null, dhReviewerName: null,
    canEdit: false, canReview: true, canLeadEdit: false, reviewStage: 'DEPARTMENT_HEAD', frozen: true, work: w, summary: summary(w), history: []
  };
};
const api = async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const ok = data => send(200, { success: true, data });
  let body = '';
  for await (const c of req) body += c;
  const json = body ? JSON.parse(body) : null;
  const url = new URL(req.url, 'http://x');
  calls.push({ method: req.method, path: url.pathname, body: json });
  const p = url.pathname.replace('/api/v1', '');
  if (p === '/ai-studio/reports/context') return ok({ role: 'MEMBER', today: '2026-11-26', reviewer: 'AI Lead One', hasReviewer: true, route: 'TEAM_LEAD', projects: [], tasks: [] });
  if (p === '/ai-studio/daily-reports/options') return ok({ date: url.searchParams.get('date'), existingReportId: null, tasks: Object.values(TASKS) });
  if (p === '/ai-studio/daily-reports/preview') {
    const w = work(json.taskIds);
    return ok({ date: json.reportDate, work: w, summary: summary(w), updateIds: w.flatMap(x => x.entries.map(e => e.id)) });
  }
  if (p === '/ai-studio/daily-reports' && req.method === 'POST') {
    if (conflictOnce) {
      conflictOnce = false; extraEntry = true;
      return send(409, { success: false, error: { code: 'CONFLICT', message: 'Your tasks were updated while you were preparing this report. Review the refreshed report and submit again.' } });
    }
    return send(201, { success: true, data: { ...reportDetail(), status: 'PENDING_TL_APPROVAL' } });
  }
  if (p === `/ai-studio/reports/${REPORT_ID}`) return ok(reportDetail());
  if (/^\/ai-studio\/tasks\/[0-9a-f-]{36}\/reports$/.test(p)) return ok([]);
  if (/^\/ai-studio\/tasks\/[0-9a-f-]{36}$/.test(p)) {
    const t = TASKS[p.split('/').pop()];
    return ok({ id: t.id, projectId: t.projectId, projectName: t.projectName, title: t.title, description: null, priority: 'LOW', status: t.status, progress: t.progress, dueDate: null,
      assignedAt: '2026-11-23T04:00:00Z', startedAt: null, completedAt: null, assigneeId: id(7), assigneeName: 'AI Member 1A', assignedById: id(8), assignedByName: 'AI Lead One',
      lastUpdateNote: null, lastUpdateAt: null, completionNote: null, attachments: [], overdue: false, canUpdate: true, canEdit: false, history: [] });
  }
  send(404, { success: false, error: { code: 'NOT_FOUND', message: 'no fake' } });
};
const srv = createServer((req, res) => {
  if (req.url.startsWith('/api/v1/')) return void api(req, res);
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone 390', { width: 390, height: 844 }], ['phone 320', { width: 320, height: 640 }]]) {
    const ctx = await browser.newContext({ viewport, timezoneId: 'Asia/Kolkata', deviceScaleFactor: SHOTS ? 2 : 1 });
    // the fake API's "today" is 26 Nov 2026: the page's clock is pinned to it, so the test does not depend on the day it is run
    await ctx.clock.setFixedTime(new Date('2026-11-26T08:00:00Z'));
    const page = await ctx.newPage();
    const errors = [];
    let nativeDialogs = 0;
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => { nativeDialogs++; void d.dismiss(); });
    calls.length = 0; extraEntry = false; conflictOnce = false;
    await page.goto(base);
    await page.evaluate(() => window.mountForm());

    // 2. the tasks, grouped by project, searchable
    await page.getByRole('group', { name: 'Your tasks by project' }).waitFor();
    const groupNames = await page.locator('fieldset legend').allInnerTexts();
    check(groupNames.length === 2 && groupNames.some(g => /AI CRM/i.test(g)) && groupNames.some(g => /AI Website/i.test(g)), `${label}: the tasks are grouped by project`, groupNames);
    check(/Cross-team · AI Lead Two/.test(await page.locator('label', { hasText: 'Blockers to be found' }).innerText()), `${label}: a cross-team task says who gave it`);
    await page.getByPlaceholder('Search tasks or projects').fill('website dev');
    check(await page.locator('fieldset label').count() === 1, `${label}: the search narrows the list`);
    await page.getByPlaceholder('Search tasks or projects').fill('');

    // nothing picked and nothing typed: the in-app message, no request (20270312000100: Work Completed is required, 10 to 150 words)
    await page.getByRole('button', { name: 'Submit Daily Report' }).click();
    await page.getByText('Write at least 10 words (10 more needed).').waitFor();
    check(!calls.some(c => c.method === 'POST' && c.path.endsWith('/daily-reports')) && await page.getByText('Write at least 10 words in Work Completed (now 0).').count() === 1,
      `${label}: an empty report is not sent, and Work Completed says what it needs`);

    // 3. pick tasks of two projects: the recorded work appears, read-only
    await page.getByRole('checkbox', { name: /Blockers to be found/ }).check();
    await page.getByRole('checkbox', { name: /Website Development/ }).check();
    await page.getByRole('checkbox', { name: /Not started yet/ }).check();
    await page.getByText('Automatically fetched from task records').waitFor();
    await page.getByTestId('completion-details').waitFor();
    check(await page.getByTestId('completion-details').innerText() === DONE_NOTE, `${label}: the completion details appear exactly as written, without typing them again`);
    const dev = page.getByTestId('report-task').filter({ hasText: 'Website Development' });
    const devText = await dev.innerText();
    check(devText.indexOf('Mobile responsiveness completed.') < devText.indexOf('Supporting screenshot uploaded.') && /50% → 80%/.test(devText), `${label}: the day's updates in order, with the progress of the day`);
    const link = dev.getByRole('link');
    check(await link.count() === 1 && (await link.getAttribute('href')) === 'https://github.com/amuwa/site/pull/1' && /noopener/.test(await link.getAttribute('rel')) && (await link.getAttribute('target')) === '_blank',
      `${label}: the submitted link opens safely in a new tab; a non-web link is never made clickable`);
    check(await page.getByText('No work update has been recorded for this task on the selected reporting date.').isVisible(), `${label}: a task with no update that day says so`);
    check(await page.locator('textarea').filter({ hasText: 'Mobile responsiveness' }).count() === 0 && await page.locator('[data-testid="report-work"] textarea, [data-testid="report-work"] input').count() === 0,
      `${label}: the fetched work cannot be edited from the report`);
    const sum = await page.getByTestId('report-summary').innerText();
    check(/Projects\s*2/.test(sum) && /Tasks\s*3/.test(sum) && /Completed\s*1/.test(sum) && /Cross-team\s*1/.test(sum) && /Work updates\s*3/.test(sum) && /Linked resources\s*2/.test(sum),
      `${label}: the summary counts projects, tasks, completed, cross-team, updates and links`, sum);
    if (SHOTS && label !== 'phone 320') await page.screenshot({ path: path.join(SHOTS, `daily-report-form-${label.replace(' ', '-')}.png`), fullPage: true });

    // Open task, from the "no update" note
    await page.getByRole('button', { name: 'Open task' }).click();
    await page.getByRole('dialog').getByText('Not started yet').first().waitFor();
    check(true, `${label}: "Open task" opens the original task to update it`);
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).last().click();

    // 4. only the three fields are typed (20270308000100): Work Completed, Work Pending, Additional Note
    check(await page.getByLabel(/^Work Completed/).count() === 1 && await page.getByLabel(/^Work Pending/).count() === 1 && await page.getByLabel(/^Additional Note/).count() === 1
      && await page.getByLabel("Tomorrow's work plan").count() === 0 && await page.getByText('Additional information').count() === 0, `${label}: the report has the three fields only (no additional-work section)`);
    await page.getByLabel(/^Work Completed/).fill('Finished the website development and the leads report for the client');
    await page.getByLabel(/^Work Pending/).fill('Write the tests');
    await page.getByLabel(/^Additional Note/).fill('Final testing');

    // 5. the confirmation: "Review report" goes back without sending
    await page.getByRole('button', { name: 'Submit Daily Report' }).click();
    const confirm = page.getByTestId('confirm-dialog');
    await confirm.waitFor();
    const confirmText = await confirm.innerText();
    check(/Submit Daily Report\?/.test(confirmText) && /2 projects/.test(confirmText) && /3 tasks/.test(confirmText) && /3 recorded work updates/.test(confirmText) && /2 submitted links/.test(confirmText) && /AI Lead One/.test(confirmText),
      `${label}: the in-app confirmation lists what is submitted and to whom`, confirmText);
    if (SHOTS && label === 'desktop') await page.screenshot({ path: path.join(SHOTS, 'daily-report-confirm-desktop.png') });
    await page.getByRole('button', { name: 'Review report' }).click();
    check(!calls.some(c => c.method === 'POST' && c.path.endsWith('/daily-reports')), `${label}: "Review report" sends nothing`);

    // the tasks changed meanwhile: refused, refreshed, nothing lost
    conflictOnce = true;
    const previewsBefore = calls.filter(c => c.path.endsWith('/preview')).length;
    await page.getByRole('button', { name: 'Submit Daily Report' }).click();
    await page.getByTestId('confirm-dialog-confirm').click();
    await page.getByText(/updated while you were preparing this report/).first().waitFor();
    await page.getByText('Late fix.').waitFor();
    check(calls.filter(c => c.path.endsWith('/preview')).length > previewsBefore && await page.getByLabel(/^Work Pending/).inputValue() === 'Write the tests',
      `${label}: a report the tasks changed under is refreshed (not submitted), and what was typed is kept`);

    // and submitted for real
    await page.getByRole('button', { name: 'Submit Daily Report' }).click();
    await page.getByTestId('confirm-dialog-confirm').click();
    await page.waitForFunction(() => !!window.done);
    const post = calls.filter(c => c.method === 'POST' && c.path.endsWith('/daily-reports')).pop();
    check(JSON.stringify(post.body.taskIds) === JSON.stringify([id(1), id(2), id(3)]) && JSON.stringify([...post.body.expectedUpdateIds].sort()) === JSON.stringify([id(201), id(202), id(203), id(204)])
      && post.body.workCompleted === 'Finished the website development and the leads report for the client' && post.body.pendingWork === 'Write the tests' && post.body.remarks === 'Final testing' && !post.body.tomorrowPlan && post.body.submit === true,
      `${label}: the request carries the task ids and the exact entries shown, plus the new remarks`, post.body);
    check(!/Leads responding|Mobile responsiveness|github\.com|vercel\.app/.test(JSON.stringify(post.body)) && !('attachments' in post.body) && !('files' in post.body),
      `${label}: no task text, link or file is sent with the report (references only)`);
    await page.getByTestId('toast-success').waitFor();
    check(true, `${label}: success is shown only after the server confirmed it`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: no sideways scrolling`);

    // 12. the Department Head opens the consolidated report (as submitted, before the late fix)
    extraEntry = false;
    await page.goto(base);
    await page.evaluate(id => window.mountReport(id), REPORT_ID);
    const dlg = page.getByRole('dialog');
    await dlg.getByTestId('report-summary').waitFor();
    const dlgText = await dlg.innerText();
    check(/AI Member 1A · Team Member · AI Studio Team/.test(dlgText) && /Project 1 · AI CRM/i.test(dlgText) && /Project 2 · AI Website/i.test(dlgText),
      `${label}: the reviewer sees who, their team, and the work project by project`, dlgText.slice(0, 400));
    check(/Now 100% \(after this report\)/.test(dlgText) && /50% → 80%/.test(dlgText), `${label}: a submitted report keeps its day's progress and says where the task is now`);
    check(/AI Member 1A's report/.test(dlgText) && /Write the tests/.test(dlgText) && /Final testing/.test(dlgText), `${label}: the employee's own fields are shown apart from the task work`);
    check(await dlg.getByRole('button', { name: 'Approve (final)' }).isVisible(), `${label}: the existing review buttons are there`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: the report has no sideways scrolling`);
    // 12b. the report pop-up on a phone: it fits the visible screen, is the one scroll area (the layer and the page behind are locked), and its end is reachable
    const geo = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]'); const r = d.getBoundingClientRect(); const layer = d.parentElement;
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight, sw: d.scrollWidth, cw: d.clientWidth, layerScrolls: layer.scrollHeight > layer.clientHeight + 1, locked: document.body.style.overflow };
    });
    check(geo.top >= 0 && geo.bottom <= geo.vh && geo.left >= 0 && geo.right <= geo.vw, `${label}: the report pop-up fits the visible screen`, geo);
    check(geo.sw <= geo.cw, `${label}: nothing inside the report is wider than the pop-up`, geo);
    check(geo.locked === 'hidden' && !geo.layerScrolls, `${label}: the page behind is locked and the dimmed layer is not a second scroll area`, geo);
    await dlg.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const closeBox = await dlg.getByRole('button', { name: 'Close' }).last().boundingBox();
    check(closeBox && closeBox.y >= 0 && closeBox.y + closeBox.height <= geo.vh && closeBox.x + closeBox.width <= geo.vw, `${label}: scrolled to the end, the Close button is on screen`, closeBox);
    await dlg.evaluate(el => { el.scrollTop = 0; });
    if (SHOTS && label !== 'phone 320') await page.screenshot({ path: path.join(SHOTS, `daily-report-review-${label.replace(' ', '-')}.png`), fullPage: true });

    check(nativeDialogs === 0, `${label}: no browser alert or confirm`);
    check(errors.length === 0, `${label}: no script errors`, errors);
    await ctx.close();
  }
  console.log(`=== ${passed} AI STUDIO DAILY REPORT BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
