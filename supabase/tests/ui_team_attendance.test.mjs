// Browser test of Team attendance and attendance corrections (Tasks 01 / 02, migration 20270205000200), against canned answers:
// the summary cards filter the list, departments expand, unavailable people stand out, phones get a list (no sideways scroll), the
// correction form and the approver's queue send what the database expects.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the team attendance browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/team_attendance_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/team_attendance_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;
const srv = createServer((req, res) => {
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  const calls = (pg, fn) => pg.evaluate(f => window.__calls.filter(c => c.fn === f).map(c => c.args), fn);
  const noSideScroll = pg => pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const errors = [];

  // 1. desktop: cards, filters, departments, the table
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Kolkata' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base);
  await page.evaluate(() => window.mountTeam());
  await page.getByTestId('team-table').waitFor();
  const first = (await calls(page, 'attendance_team_overview'))[0];
  check(first && first.p_date && first.p_status === null && first.p_department === null, 'today, everyone in scope, by default', first);
  const cards = await page.getByRole('group', { name: 'Attendance summary' }).innerText();
  check(/Scheduled\s*6/.test(cards) && /Present\s*3/.test(cards) && /Absent\s*1/.test(cards) && /Not punched in\s*1/.test(cards) && /Late arrivals\s*1/.test(cards)
    && /On leave\s*1/.test(cards) && /On break\s*0/.test(cards) && /Shift completed\s*1/.test(cards), 'the eight summary cards', cards);
  const head = await page.locator('[data-testid="team-table"] thead').innerText();
  check(['Employee', 'Designation', 'Department', 'Team Lead', 'Status', 'Punch In', 'Punch Out', 'Remarks'].every(h => head.includes(h)), 'the table columns', head);
  check(/Left early: Doctor appointment/.test(await page.getByTestId('team-table').innerText()) && /Late by 25 min/.test(await page.getByTestId('team-table').innerText()),
    'remarks: late and the early Punch Out reason');
  check(await page.locator('[data-testid="team-table"] tr.bg-rose-50\\/40').count() === 3, 'the three people unavailable for work are highlighted');
  await page.getByTestId('team-card-ABSENT').click();
  await page.waitForFunction(() => window.__calls.filter(c => c.fn === 'attendance_team_overview').at(-1).args.p_status === 'ABSENT');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="team-table"] tbody tr').length === 1);
  check((await page.locator('[data-testid="team-table"] tbody').innerText()).includes('Asha Absent'), 'a summary card filters the list (on the server)');
  await page.getByTestId('team-card-ABSENT').click();
  await page.getByTestId('team-status-filter').selectOption('UNAVAILABLE');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="team-table"] tbody tr').length === 3);
  check(await page.locator('[data-testid="team-table"] tbody tr').count() === 3, 'the "unavailable for work" filter: absent, not punched in, on leave');
  await page.getByRole('button', { name: /^Sales/ }).click();
  check(/Asha Absent/.test(await page.getByRole('region', { name: 'Departments' }).innerText()), 'a department expands to its people');
  check(await noSideScroll(page), 'no sideways scroll on a desktop');

  // 2. a phone: the compact list, details on tap, nothing scrolls sideways
  for (const w of [320, 360, 390]) {
    await page.setViewportSize({ width: w, height: 800 });
    check(await noSideScroll(page), `no sideways scroll at ${w}px`);
  }
  check(await page.getByTestId('team-list').isVisible() && !(await page.getByTestId('team-table').isVisible()), 'phones get the compact list instead of the table');
  await page.locator('[data-testid="team-list"] summary').first().click();
  check(/Team Lead/.test(await page.getByTestId('team-list').innerText()), 'a person\'s details open in place');
  await ctx.close();

  // 3. the dashboard summary
  const c2 = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const p2 = await c2.newPage();
  p2.on('pageerror', e => errors.push(String(e)));
  await p2.goto(base);
  await p2.evaluate(() => window.mountSummary());
  await p2.getByTestId('team-attendance-summary').getByText('Sales').waitFor();
  const sum = await p2.getByTestId('team-attendance-summary').innerText();
  check(/Today's Team Attendance/.test(sum) && /2 unavailable/.test(sum) && /View all/.test(sum), 'the dashboard card: counts and availability by department', sum);
  check(await noSideScroll(p2), 'the dashboard card fits a phone');
  await c2.close();

  // 4. corrections: the request form and the approver's queue
  const c3 = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const p3 = await c3.newPage();
  p3.on('pageerror', e => errors.push(String(e)));
  await p3.goto(base);
  await p3.evaluate(() => window.mountCorrections());
  await p3.getByRole('region', { name: 'Waiting for my decision' }).getByText('Esha Early').waitFor();
  await p3.getByTestId('new-correction').click();
  const sheet = p3.getByTestId('correction-form');
  await sheet.waitFor();
  const box = await sheet.locator('[role="dialog"]').boundingBox();
  check(box && box.y + box.height >= 799 && box.height <= 800 * 0.86, 'on a phone the form is a bottom sheet, not a full screen', box);
  check(await p3.getByTestId('send-correction').isDisabled(), 'nothing is sent without a reason');
  await sheet.getByLabel('What should be corrected').selectOption('SET_PUNCH_OUT');
  await sheet.getByLabel('Correct time (IST)').fill('19:00');
  await sheet.getByLabel('Reason (required)').fill('Forgot to punch out after the client call');
  await p3.getByTestId('send-correction').click();
  await p3.getByText('Correction requested').waitFor();
  const sent = (await calls(p3, 'attendance_correction_request'))[0];
  check(sent.p_kind === 'SET_PUNCH_OUT' && sent.p_time === '19:00' && /client call/.test(sent.p_reason) && typeof sent.p_request === 'string', 'the request is sent once, with its id', sent);
  await p3.getByTestId('approve-correction').click();
  await p3.waitForFunction(() => window.__calls.some(c => c.fn === 'attendance_correction_decide'));
  const decided = (await calls(p3, 'attendance_correction_decide'))[0];
  check(decided.p_id === 'c2' && decided.p_approve === true, 'Approve decides the request in the database', decided);
  check(await noSideScroll(p3), 'corrections fit a phone');
  check(errors.length === 0, 'no page errors', errors);
  await c3.close();
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== TEAM ATTENDANCE BROWSER TESTS PASSED (${passed}) ===`);
