// Browser test of CEO Availability (migration 20270201000100): the entry sits immediately below the Notice Board in the HR sidebar and in the HR
// Recruiter's shell (and nowhere else); HR sets CEO Arrived / CEO Not Arrived with the time and person of the update; every open dashboard follows the
// one stored status (Realtime) and it is still there after a refresh; an HR Recruiter and an employee only read; asking the CEO for time shows the
// warning popup when the CEO has not arrived, never blocks the request, and saves it; no popup once the CEO has arrived.
// Real React components, real Chromium; the CRM API is answered in the page (supabase/tests/ui/ceo_availability_harness.tsx).
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the CEO availability browser test did not run'); process.exit(0); }
const work = mkdtempSync(path.join(tmpdir(), 'ca-ui-'));
const out = path.join(work, 'app.js');
await build({
  entryPoints: ['supabase/tests/ui/ceo_availability_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' },
  jsx: 'automatic', logLevel: 'error',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: path.resolve('supabase/tests/ui/meeting_presence_supabase_stub.ts') }));
    b.onResolve({ filter: /context\/AuthContext$/ }, () => ({ path: path.resolve('supabase/tests/ui/ceo_availability_auth_stub.tsx') }));
    b.onResolve({ filter: /context\/NotificationContext$/ }, () => ({ path: path.resolve('supabase/tests/ui/department_head_notifications_stub.tsx') }));
  } }]
});
const bundle = readFileSync(out, 'utf8');
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const css = cssFile ? readFileSync(path.join('dist/assets', cssFile), 'utf8') : '';

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }
// one browser page = one database: the same page holds several "dashboards" side by side (each mounted in its own slot), like several HR people on one status
const newPage = async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
  await page.route('http://ca.test/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body></body></html>' }));
  await page.goto('http://ca.test/');
  await page.addScriptTag({ content: bundle });
  return page;
};
const mount = (page, who, view, slot, dept) => page.evaluate(([a, b, c, d]) => window.mount(a, b, c, d), [who, view, slot, dept]);
const writes = page => page.evaluate(() => window.__calls.filter(c => c.method !== 'GET').map(c => c.path));
const navLabels = (page, slot) => page.$$eval(`#${slot} ${slot === 'sb' ? 'aside' : 'nav'} button`, bs => bs.map(b => b.textContent.replace(/\s+/g, ' ').trim()));

try {
  // ---- the HR department's sidebar: CEO Availability immediately below Notice Board, for every HR login
  for (const who of ['hr', 'recruiter']) {
    const page = await newPage();
    await mount(page, who, 'sidebar', 'sb');
    await page.waitForSelector('#sb aside button');
    const labels = await navLabels(page, 'sb');
    const i = labels.findIndex(l => l.startsWith('Notice Board'));
    check(i >= 0 && labels[i + 1] === 'CEO Availability', `HR sidebar (${who}): CEO Availability is immediately below Notice Board`, labels);
    check(labels.filter(l => l === 'CEO Availability').length === 1, `HR sidebar (${who}): the entry appears once`, labels);
    await page.click('#sb aside button:has-text("CEO Availability")');
    check(await page.evaluate(() => window.__tab) === 'hr_ceo_availability', `HR sidebar (${who}): clicking it opens the CEO Availability screen`);
    await page.close();
  }
  // other departments do not get it
  {
    const page = await newPage();
    await mount(page, 'member', 'sidebar', 'sb', 'wabastore');
    await page.waitForSelector('#sb aside button');
    const labels = await navLabels(page, 'sb');
    check(labels.some(l => l.startsWith('Notice Board')) && !labels.includes('CEO Availability'), 'a department that is not HR has the Notice Board and no CEO Availability entry', labels);
    await page.close();
  }

  // ---- the HR Recruiter's dashboard shell
  {
    const page = await newPage();
    await mount(page, 'recruiter', 'shell', 'sh');
    await page.waitForSelector('#sh nav button');
    const labels = await navLabels(page, 'sh');
    const i = labels.findIndex(l => l.startsWith('Notice Board'));
    check(i >= 0 && labels[i + 1] === 'CEO Availability' && labels.filter(l => l === 'CEO Availability').length === 1, 'HR Recruiter dashboard: CEO Availability is immediately below Notice Board', labels);
    await page.click('#sh nav button:has-text("CEO Availability")');
    await page.waitForSelector('[data-testid="ceo-availability-page"]');
    check(await page.isVisible('[data-testid="ceo-availability-readonly"]') && !(await page.isVisible('[data-testid="ceo-set-arrived"]')), 'HR Recruiter dashboard: the screen is read-only for a Recruiter');
    await page.close();
    const other = await newPage();
    await mount(other, 'member', 'shell', 'sh');
    await other.waitForSelector('#sh nav button');
    check(!(await navLabels(other, 'sh')).includes('CEO Availability'), 'a dashboard that is not HR has no CEO Availability entry');
    await other.close();
  }

  // ---- the screen: two HR dashboards, an HR Recruiter and an employee on one stored status
  {
    const page = await newPage();
    await mount(page, 'hr', 'page', 'hr1');
    await page.waitForSelector('#hr1 [data-testid="ceo-availability-card"]');
    check(await page.$eval('#hr1 [data-testid="ceo-availability-card"]', e => e.getAttribute('data-status')) === 'NOT_ARRIVED', 'the CEO starts as not arrived');
    check((await page.textContent('#hr1 [data-testid="ceo-availability-updated"]')).includes('No update has been recorded yet'), 'no update is shown before the first press');
    check(await page.isVisible('#hr1 [data-testid="ceo-set-arrived"]') && await page.isVisible('#hr1 [data-testid="ceo-set-not-arrived"]'), 'HR sees both buttons: CEO Arrived and CEO Not Arrived');
    await mount(page, 'hr', 'page', 'hr2');
    await page.waitForSelector('#hr2 [data-testid="ceo-availability-card"]');

    await page.click('#hr1 [data-testid="ceo-set-arrived"]');
    await page.waitForSelector('#hr1 [data-status="ARRIVED"]');
    check((await writes(page)).at(-1) === '/api/v1/meetings/ceo-office/arrived', 'CEO Arrived calls the server (stored, not a frontend flag)');
    const upd = await page.textContent('#hr1 [data-testid="ceo-availability-updated"]');
    check(/CEO Arrived/.test(upd) && /by Hema HR/.test(upd) && /\d{4}/.test(upd), 'the latest update shows the status, the date and time, and who', upd);
    await page.waitForSelector('#hr2 [data-status="ARRIVED"]');
    check(true, 'the other HR dashboard follows at once (Realtime)');
    check(!(await page.isEnabled('#hr1 [data-testid="ceo-set-arrived"]')), 'CEO Arrived is disabled while the CEO is marked as arrived');

    await page.click('#hr2 [data-testid="ceo-set-not-arrived"]');
    await page.waitForSelector('#hr2 [data-status="NOT_ARRIVED"]');
    check((await writes(page)).at(-1) === '/api/v1/meetings/ceo-office/not-arrived', 'CEO Not Arrived calls the server');
    await page.waitForSelector('#hr1 [data-status="NOT_ARRIVED"]');
    check(/CEO Not Arrived/.test(await page.textContent('#hr1 [data-testid="ceo-availability-updated"]')), 'both dashboards show the same latest update');
    await page.click('#hr1 [data-testid="ceo-set-arrived"]');
    await page.waitForSelector('#hr1 [data-status="ARRIVED"]');

    // a refresh of a dashboard: the status is read again from the server
    await mount(page, 'hr', 'page', 'hr3');
    await page.waitForSelector('#hr3 [data-status="ARRIVED"]');
    check(/CEO Arrived/.test(await page.textContent('#hr3 [data-testid="ceo-availability-updated"]')), 'after a refresh (a new dashboard) the stored status and its update are still there');

    // an HR Recruiter and an employee see it, and have no buttons
    await mount(page, 'recruiter', 'page', 'rec');
    await page.waitForSelector('#rec [data-status="ARRIVED"]');
    check(await page.isVisible('#rec [data-testid="ceo-availability-readonly"]') && !(await page.isVisible('#rec [data-testid="ceo-set-not-arrived"]')), 'an HR Recruiter sees the status and has no buttons');
    // and the server refuses their attempt anyway
    const refused = await page.evaluate(async () => (await fetch('/api/v1/meetings/ceo-office/not-arrived', { method: 'POST', body: '{}' })).status);
    check(refused === 403, 'an unauthorised update is refused by the server (403)', refused);
    check((await page.$eval('#rec [data-testid="ceo-availability-card"]', e => e.getAttribute('data-status'))) === 'ARRIVED', 'and the status did not change');
    await page.close();
  }

  // ---- meeting requests: the warning popup and never a blocked request
  {
    const page = await newPage();
    await mount(page, 'member', 'meetings', 'mt');
    await page.waitForSelector('button:has-text("Ask the CEO for time")');
    await page.click('button:has-text("Ask the CEO for time")');
    await page.waitForSelector('[data-testid="ceo-not-arrived-popup"]');
    const text = (await page.textContent('[data-testid="ceo-not-arrived-text"]')).trim();
    check(text === 'CEO has not arrived yet. You can still schedule your meeting request. Please plan your preferred meeting time accordingly.', 'CEO not arrived: the popup shows the required message', text);
    check(await page.$eval('[data-testid="ceo-not-arrived-popup"] [role="alertdialog"]', e => e.getAttribute('aria-modal')) === 'true', 'the popup is an accessible modal dialog');
    await page.click('[data-testid="ceo-not-arrived-continue"]');
    await page.waitForSelector('[data-testid="ceo-not-arrived-popup"]', { state: 'detached' });
    check(await page.isVisible('[data-testid="ceo-arrival"][data-arrived="false"]'), 'after the popup the form shows the CEO\'s availability next to the request');
    await page.fill('#mtg-title', 'Approval for the Pune office budget');
    await page.fill('#mtg-desc', 'Budget for the new Pune office');
    await page.click('button:has-text("Send the request")');
    await page.waitForFunction(() => window.__requests.length === 1);
    const saved = await page.evaluate(() => window.__requests[0]);
    check(saved.status === 'REQUESTED' && saved.title === 'Approval for the Pune office budget' && saved.description === 'Budget for the new Pune office' && !!saved.startsAt && saved.hostId, 'the request is saved although the CEO has not arrived (title, purpose, date and time)', saved);
    check(saved.createdByName === 'Team Member A' && saved.createdByDepartment === 'Wabastore', 'it carries the employee and the department');
    await page.close();
  }
  {
    // the CEO has arrived: no popup, the request is saved the same
    const page = await newPage();
    await mount(page, 'hr', 'page', 'hr1');
    await page.waitForSelector('#hr1 [data-testid="ceo-set-arrived"]');
    await page.click('#hr1 [data-testid="ceo-set-arrived"]');
    await page.waitForSelector('#hr1 [data-status="ARRIVED"]');
    await mount(page, 'member', 'meetings', 'mt');
    await page.waitForSelector('#mt button:has-text("Ask the CEO for time")');
    await page.click('#mt button:has-text("Ask the CEO for time")');
    await page.waitForSelector('#mtg-title');
    check(await page.isVisible('[data-testid="ceo-arrival"][data-arrived="true"]') && !(await page.isVisible('[data-testid="ceo-not-arrived-popup"]')), 'CEO arrived: the green banner, and no warning popup');
    await page.fill('#mtg-title', 'Hiring plan');
    await page.fill('#mtg-desc', 'Plan the hiring for the quarter');
    await page.click('button:has-text("Send the request")');
    await page.waitForFunction(() => window.__requests.length === 1);
    check((await page.evaluate(() => window.__requests[0].status)) === 'REQUESTED', 'CEO arrived: the request is saved as usual');
    await page.close();
  }
  console.log(`=== ${passed} CEO AVAILABILITY BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
}
