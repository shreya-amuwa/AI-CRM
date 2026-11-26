// Browser test of the AI Studio deadline clock: it ticks every second, counts to the SERVER's time (a computer with a wrong clock still shows the right
// time left), turns amber and red, counts how long ago once overdue, stops for a finished project, and says what to do when there is no deadline,
// at desktop and phone width. The API is a fake: who sees which project and the deadlines themselves are decided by the database.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the AI Studio deadline browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/ai_studio_deadlines_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

// ---- the fake API: the server's clock is 3 hours AHEAD of the browser's, the way a wrong computer clock looks ---------------------------------------
const SKEW_MS = 3 * 3600 * 1000;
let mode = 'normal';
const item = (over) => ({ projectId: 'p' + Math.random(), name: 'Project', status: 'ACTIVE', mine: true, openTasks: 4, myOpenTasks: 1, ...over });
const api = (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url.startsWith('/api/v1/ai-studio/tasks')) {
    const task = { id: 'aaaaaaaa-0000-4000-8000-000000000001', projectId: 'p1', projectName: 'AI Website', title: 'Changes discussed in meeting',
      description: 'To perform the changes discussed in the landing page', priority: 'HIGH', status: 'IN_PROGRESS', progress: 90, dueDate: '2026-11-26',
      assignedAt: '2026-11-26T04:00:00Z', startedAt: '2026-11-26T05:00:00Z', completedAt: null, assigneeId: 'u1', assigneeName: 'Aryan', assignedById: 'u2',
      assignedByName: 'Head', lastUpdateNote: 'LONG-REPORT: the landing page is live, clean links, faster loading', lastUpdateAt: '2026-11-26T06:00:00Z',
      completionNote: null, attachments: [], overdue: false };
    if (/\/ai-studio\/tasks\/[0-9a-f-]{36}/.test(req.url)) {
      return send(200, { success: true, data: { ...task, canUpdate: false, canEdit: false, history: [{ id: 'h1', kind: 'PROGRESS', status: 'IN_PROGRESS', progress: 90,
        note: 'LONG-REPORT: the landing page is live, clean links, faster loading', authorName: 'Aryan', createdAt: '2026-11-26T06:00:00Z' }] } });
    }
    return send(200, { success: true, data: { items: [task], total: 1, page: 1, pageSize: 10 } });
  }
  if (!req.url.startsWith('/api/v1/ai-studio/deadlines')) return send(404, { success: false, error: { code: 'NOT_FOUND', message: 'no fake' } });
  if (mode === 'error') return send(500, { success: false, error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } });
  const serverNow = Date.now() + SKEW_MS;
  const iso = (ms) => new Date(serverNow + ms).toISOString();
  const H = 3600 * 1000, D = 24 * H;
  const items = mode === 'empty' ? [] : [
    item({ name: 'AI CRM', deadlineAt: iso(-(5 * H + 20 * 60000)) }),                // overdue by 5 h 20 min
    item({ name: 'AI Website', deadlineAt: iso(2 * D + 6 * H) }),                    // soon
    item({ name: 'AIQR', deadlineAt: iso(20 * D), openTasks: 9, myOpenTasks: 0 })    // on track
  ];
  send(200, { success: true, data: { serverNow: new Date(serverNow).toISOString(), items } });
};
const srv = createServer((req, res) => {
  if (req.url.startsWith('/api/v1/')) return api(req, res);
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
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport, timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));

    mode = 'normal';
    await page.goto(base);
    // the chip's deadline is 2 h from now on the SERVER's clock (which is 3 h ahead of this browser's)
    await page.evaluate(() => { window.chipAt = new Date(Date.now() + 3 * 3600 * 1000 + 2 * 3600 * 1000).toISOString(); window.mount(true); });
    const timer = page.getByRole('timer').first();
    await timer.waitFor();
    check(await page.getByRole('heading', { name: 'Project deadlines' }).isVisible(), `${label}: the panel is on the dashboard`);

    // the nearest deadline is the overdue one: it is the big clock, and it counts how long AGO, to the SERVER's time (5 h 20 min), not the computer's
    const read = async () => {
      const t = (await timer.innerText()).replace(/\s+/g, ' ');
      const m = /(\d+) DAYS (\d+) HOURS (\d+) MINUTES (\d+) SECONDS/i.exec(t.replace(/\n/g, ' '));
      return m ? m.slice(1, 5).map(Number) : null;
    };
    const first = await read();
    check(first && first[0] === 0 && first[1] === 5 && first[2] >= 19 && first[2] <= 20, `${label}: overdue by about 5 h 20 min on the server's clock (the computer's own clock is 3 h behind)`, first);
    check(await page.getByText(/Overdue: the deadline passed/).isVisible(), `${label}: it says overdue and when it was due`);

    // it ticks: overdue counts UP, the seconds move by themselves
    await page.waitForTimeout(2300);
    const later = await read();
    const total = a => a[2] * 60 + a[3];
    check(later && total(later) - total(first) >= 2 && total(later) - total(first) <= 4, `${label}: the seconds go up by themselves (overdue counts how long ago)`, [first, later]);

    // the others are listed with the time left, in their own tone
    const row = name => page.getByRole('listitem').filter({ hasText: name });
    check(/2d \d\dh \d\dm \d\ds left/.test(await row('AI Website').innerText()), `${label}: a project due in two days shows "2d .. left"`);
    check(/19d|20d/.test(await row('AIQR').innerText()) && /9 open tasks/.test(await row('AIQR').innerText()), `${label}: a far deadline, with its open tasks`);
    check(await page.getByText(/4 open tasks · 1 yours/).first().isVisible(), `${label}: the person's own open tasks are shown`);

    // the chip of a project card
    const chips = page.getByTestId('chips');
    check(/01h 59m \d\ds left/.test(await chips.locator('span').nth(0).innerText()), `${label}: a running project's chip shows the time left (2 h on the server's clock)`, await chips.innerText());
    check(/Due \d\d \w{3} \d{4}/.test(await chips.locator('span').nth(1).innerText()) && !/left/.test(await chips.locator('span').nth(1).innerText()), `${label}: a finished project's chip shows the date only, no clock`);

    // the head's "Set deadlines" link, and no horizontal scrolling on a phone
    await page.getByRole('button', { name: 'Set deadlines' }).click();
    check(await page.evaluate(() => window.managed === true), `${label}: "Set deadlines" opens Project Management`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: no sideways scrolling`);

    // no deadline: a Team Member is told, the head is told how to set one
    mode = 'empty';
    await page.goto(base);
    await page.evaluate(() => { window.chipAt = null; window.mount(false); });
    await page.getByText('None of your projects has a deadline right now.').waitFor();
    check(await page.getByRole('button', { name: 'Set deadlines' }).count() === 0, `${label}: a Team Member has no "Set deadlines" (the database refuses it as well)`);
    await page.goto(base);
    await page.evaluate(() => { window.chipAt = null; window.mount(true); });
    await page.getByText(/Open Project Management and set one/).waitFor();
    check(true, `${label}: the head is told where to set a deadline`);

    // a server error is shown with a retry, not a blank
    mode = 'error';
    await page.goto(base);
    await page.evaluate(() => { window.chipAt = null; window.mount(false); });
    await page.getByRole('button', { name: /retry|try again/i }).first().waitFor();
    check(true, `${label}: an error is shown with a way to try again`);
    // the task list: the row shows the title and the description only (not the long update), and clicking anywhere on the row opens the task
    mode = 'normal';
    await page.goto(base);
    await page.evaluate(() => window.mountTasks());
    const taskRow = page.getByTestId('ai-task-row').first();
    await taskRow.waitFor();
    check(/To perform the changes discussed/.test(await taskRow.innerText()) && !/LONG-REPORT/.test(await taskRow.innerText()), `${label}: a task row shows its description, not the whole update`);
    check(await page.getByRole('button', { name: 'Open', exact: true }).count() === 0, `${label}: there is no separate Open button to find`);
    await taskRow.locator('td').nth(3).click(); // a plain cell (the assigned date), not the title
    await page.getByRole('dialog').getByText(/LONG-REPORT/).waitFor();
    check(true, `${label}: clicking the row opens the task, and its update is there`);
    check(errors.length === 0, `${label}: no script errors`, errors);
    await ctx.close();
  }
  console.log(`=== ${passed} AI STUDIO DEADLINE BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
