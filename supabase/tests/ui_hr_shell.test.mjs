// Browser test of the HR dashboard chrome and layout (the HR UI redesign): the real Header, Sidebar and HR panel as App.tsx mounts them.
// The HR menu keeps every entry (Attendance, Meetings, Notice Board, CEO Availability, Dashboard, Employee Requests, HR & Operations,
// Recruitment Management, Recruitment Portal, User Documentation ...), shows the active page, its labelled sections open and close (remembered;
// the section of the open page stays open) and its last entries are reachable; the content uses the screen width (wider on large screens) with
// no sideways scroll on a laptop, a tablet or a phone; Award Management opens without the KPI strip, "Nominate Star Award" nominates for an award
// chosen in the form (a team for Team of the Month), the month picker changes the month, and pop-ups fit a phone screen.
// Real React components, real Chromium; the CRM API is answered by supabase/tests/ui/hr_awards_fake_api.mjs.
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { handle, label, state } from './ui/hr_awards_fake_api.mjs';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the HR shell browser test did not run'); process.exit(0); }
const work = mkdtempSync(path.join(tmpdir(), 'hr-shell-ui-'));
const out = path.join(work, 'app.js');
await build({
  entryPoints: ['supabase/tests/ui/hr_shell_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' },
  jsx: 'automatic', logLevel: 'error', loader: { '.css': 'empty', '.png': 'empty', '.svg': 'empty', '.jpg': 'empty', '.webp': 'empty' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: path.resolve('supabase/tests/ui/hr_awards_stubs.ts') }));
    b.onResolve({ filter: /\/context\/(AuthContext|LeadStoreContext|NotificationContext)$/ }, () => ({ path: path.resolve('supabase/tests/ui/hr_shell_contexts.ts') }));
  } }]
});
const bundle = readFileSync(out, 'utf8');
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
if (!cssFile) { console.log('SKIPPED - no built CSS (run npm run build first), the HR shell browser test did not run'); process.exit(0); }
const css = readFileSync(path.join('dist/assets', cssFile), 'utf8');

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }
const errors = [];
let context;
const open = async (viewport = { width: 1366, height: 768 }) => {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  page.on('pageerror', e => errors.push(e.message));
  await page.route('http://hr.test/api/v1/**', async route => {
    const req = route.request();
    const r = handle(req.method(), new URL(req.url()), req.postData() ? JSON.parse(req.postData()) : undefined);
    await route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
  });
  await page.route('http://hr.test/', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div id="root"></div></body></html>' }));
  await page.goto('http://hr.test/');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.mount());
  await page.getByRole('heading', { name: 'Human Resources', level: 1 }).waitFor();
  return page;
};
const sidebar = page => page.locator('#app-sidebar');
const noSidewaysScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  context = await browser.newContext();
  let page = await open();

  // --- the HR menu: every entry, the active page, sections
  const labels = (await sidebar(page).locator('nav button, button').allInnerTexts()).map(s => s.trim()).filter(Boolean);
  for (const name of ['Attendance', 'Meetings', 'Notice Board', 'CEO Availability', 'Dashboard', 'Employee Requests', 'HR & Operations', 'Recruitment Management', 'Recruitment Portal'])
    check(labels.some(l => l === name || l.startsWith(name)), `the HR menu keeps "${name}"`, labels);
  check(await sidebar(page).getByRole('link', { name: 'User Documentation' }).isVisible(), 'User Documentation stays at the foot of the menu');
  check((await sidebar(page).getByText('Human Resources', { exact: true }).count()) === 1, 'the department name appears once (no repeated heading in the menu)');
  check(await sidebar(page).getByRole('button', { name: 'Dashboard' }).getAttribute('aria-current') === 'page', 'the open page is marked in the menu');
  const order = labels.slice(0, 6);
  check(order[0] === 'Attendance' && order[1] === 'Meetings' && order[2] === 'Notice Board' && order[3] === 'CEO Availability', 'the top entries keep their order', order);

  const work = sidebar(page).getByRole('button', { name: /^Work$/ });
  check(await work.getAttribute('aria-expanded') === 'true', 'the Work section (holding the open page) is open');
  await work.click();
  check(await work.getAttribute('aria-expanded') === 'true' && await sidebar(page).getByRole('button', { name: 'Dashboard' }).isVisible(), 'the section of the open page stays open');
  const letters = sidebar(page).getByRole('button', { name: /^Employee Letters$/ });
  await letters.click();
  check(await letters.getAttribute('aria-expanded') === 'false' && !(await sidebar(page).getByRole('button', { name: 'NDA Letter' }).isVisible()), 'another section closes');
  await sidebar(page).getByRole('button', { name: 'Employee Requests' }).click();
  check(await page.evaluate(() => window.__tab) === 'hr_requests' && await sidebar(page).getByRole('button', { name: 'Employee Requests' }).getAttribute('aria-current') === 'page', 'choosing an entry opens that page');
  await sidebar(page).getByRole('button', { name: 'Dashboard' }).click();
  await page.reload();
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.mount());
  await page.getByRole('heading', { name: 'Human Resources', level: 1 }).waitFor();
  check(await sidebar(page).getByRole('button', { name: /^Employee Letters$/ }).getAttribute('aria-expanded') === 'false', 'a closed section stays closed after a reload (this browser)');
  await sidebar(page).getByRole('button', { name: /^Employee Letters$/ }).click();

  // the last entry is reachable: the menu scrolls inside the column and nothing covers it
  const last = sidebar(page).getByRole('button', { name: 'Experience Letter' });
  await last.scrollIntoViewIfNeeded();
  const covered = await last.evaluate(el => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !(top && el.contains(top)); });
  check(!covered && await last.isVisible(), 'the last menu entry scrolls into view and is not hidden behind the documentation link');

  // --- the header
  check(await page.getByText('Active Sessions:').isVisible() && await page.getByText('Hema Head').isVisible() && await page.getByRole('button', { name: /sign out|log out|logout/i }).first().isVisible(),
    'the header keeps Active Sessions, the signed-in person and sign out');

  // --- layout: one header, KPIs on the overview, no sideways scroll
  check((await page.getByRole('heading', { name: 'Human Resources' }).count()) === 1, 'one page title');
  check(await page.getByText('Active Roster').isVisible(), 'the overview shows the KPI cards');
  check(await page.getByText('3 Candidates').isVisible(), 'the Recruitment card shows the real candidate count');
  check(await noSidewaysScroll(page), 'no sideways scroll at 1366 × 768');

  // --- Award Management: Birthdays, Anniversaries, Awards; no KPI strip, no repeated titles
  await page.getByRole('heading', { name: 'Award Management' }).click();
  const tabs = await page.getByRole('navigation', { name: 'Award Management' }).getByRole('button').allInnerTexts();
  check(JSON.stringify(tabs.map(t => t.trim())) === JSON.stringify(['Birthdays', 'Anniversaries', 'Awards']), 'Award Management: Birthdays, Anniversaries, then Awards', tabs);
  check(!(await page.getByText('Active Roster').isVisible()), 'an open workspace starts under the header (no KPI strip to scroll past)');
  check(await page.getByRole('navigation', { name: 'Breadcrumb' }).getByText('Award Management').isVisible(), 'the breadcrumb names Award Management');
  await page.getByRole('navigation', { name: 'Award Management' }).getByRole('button', { name: 'Awards' }).click();
  await page.getByRole('heading', { name: 'Employee Recognition & Awards' }).waitFor();
  check(await page.getByText('Recognising outstanding performance, leadership, teamwork and professional excellence across Amuwa Corporation.').isVisible(), 'the Awards header and subtitle');
  check((await page.getByRole('heading', { name: /Awards, Upcoming Birthdays/ }).count()) === 0, 'no duplicate titles');

  // cards: three per row on a laptop, equal heights
  const boxes = await page.getByRole('article').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height) }; }));
  check(boxes.length === 7, 'seven award cards', boxes.length);
  const firstRow = boxes.filter(b => b.y === boxes[0].y);
  check(firstRow.length === 3 && new Set(firstRow.map(b => b.h)).size === 1, 'three cards per row at 1366, all the same height', firstRow);

  // month picker
  const thisMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
  const lastYear = String(Number(thisMonth.slice(0, 4)) - 1);
  await page.getByRole('button', { name: /^Award month:/ }).click();
  const picker = page.getByRole('dialog', { name: 'Choose the award month' });
  await page.getByRole('button', { name: 'Previous year' }).click();
  await picker.getByRole('button', { name: `March ${lastYear}` }).click();
  check(await page.getByRole('button', { name: `Award month: March ${lastYear}. Choose another month` }).isVisible() && !(await picker.isVisible()), 'the month picker chooses a month and year');
  await page.getByRole('button', { name: 'This month', exact: true }).click();
  check(await page.getByRole('button', { name: `Award month: ${label(thisMonth)}. Choose another month` }).isVisible(), '"This month" goes back');

  // Nominate Star Award: the award is chosen in the form; a team for Team of the Month
  await page.getByRole('button', { name: 'Nominate Star Award' }).click();
  const dialog = page.getByRole('dialog', { name: 'Nominate Star Award' });
  await dialog.getByLabel('Award').selectOption({ label: 'Team of the Month' });
  check(await dialog.getByRole('radio', { name: 'Team' }).isChecked() && await dialog.getByRole('radio', { name: 'Individual' }).isDisabled(), 'the nominee type follows the chosen award (Team)');
  await dialog.getByRole('option', { name: /Sales/ }).getByRole('button').click();
  check(await dialog.getByText('Active members').isVisible() && !(await dialog.getByText('Designation').isVisible()), 'a team shows its department and members, not a designation');
  await dialog.getByLabel('Reason for nomination').fill('Delivered the quarter together');
  await dialog.getByRole('button', { name: 'Add nominee' }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('status').getByText(/Sales nominated for Team of the Month/).waitFor();
  check(state.nominees.some(n => n.code === 'TEAM' && n.nomineeType === 'TEAM' && n.name === 'Sales'), 'the team is saved as a team nominee');
  const teamCard = page.getByRole('article', { name: 'Team of the Month' });
  await teamCard.getByText('Nominations open').waitFor();
  check(/Nominees\s*1/i.test(await teamCard.innerText()), 'the card counts the new nominee', await teamCard.innerText());

  // wide screen: the content uses more of the width (but stays readable)
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(200);
  const mainW = await page.locator('main').evaluate(el => el.getBoundingClientRect().width);
  check(mainW > 1400 && mainW <= 1600, 'at 1920 the HR content is up to 1600px wide (it was 1280)', mainW);
  check(await noSidewaysScroll(page), 'no sideways scroll at 1920');

  // tablet and phone
  for (const [w, h, cols] of [[820, 1180, 2], [390, 844, 1]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(200);
    check(await noSidewaysScroll(page), `no sideways scroll at ${w}px`);
    check(!(await sidebar(page).isVisible()) || await sidebar(page).evaluate(el => el.getBoundingClientRect().right <= 0), `the sidebar is a drawer at ${w}px`);
    const b = await page.getByRole('article').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().y)));
    check(b.filter(y => y === b[0]).length === cols, `${cols} card(s) per row at ${w}px`);
  }
  // a pop-up fits the phone screen
  await page.getByRole('button', { name: 'Manage Rising Star of the Month' }).click();
  await page.getByRole('button', { name: 'Add Nominee' }).first().click();
  const d = page.getByRole('dialog').first();
  await d.getByRole('option').first().waitFor();
  const box = await d.boundingBox();
  check(box && box.x >= 0 && box.x + box.width <= 390 && box.height <= 844, 'the Add Nominee form fits a phone screen (it scrolls inside)', box);
  check(await noSidewaysScroll(page), 'no sideways scroll with the form open');
  await page.close();

  check(!errors.length, 'no page errors', errors);
  console.log(`=== ${passed} HR SHELL BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
}
