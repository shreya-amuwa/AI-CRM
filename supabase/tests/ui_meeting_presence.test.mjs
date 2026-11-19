// Browser test of the CEO's live meeting availability: Enter / Exit Meeting on the CEO's Meetings page, the BUSY / AVAILABLE indicator for
// team members (on the Meetings page and in the header badge every dashboard shows), the "Superadmin is currently attending another
// meeting" message and the pending request, and a Realtime change updating the page without a refresh. Real React components, real
// Chromium; the CRM API is answered in the page (supabase/tests/ui/meeting_presence_harness.tsx). Skipped, loudly, without Playwright.
import { execFileSync } from 'node:child_process';
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the meeting availability browser test did not run'); process.exit(0); }
const work = mkdtempSync(path.join(tmpdir(), 'mp-ui-'));
const out = path.join(work, 'app.js');
await build({
  entryPoints: ['supabase/tests/ui/meeting_presence_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' },
  jsx: 'automatic', logLevel: 'error',
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: path.resolve('supabase/tests/ui/meeting_presence_supabase_stub.ts') }));
  } }]
});
const bundle = readFileSync(out, 'utf8');
void execFileSync;
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const css = cssFile ? readFileSync(path.join('dist/assets', cssFile), 'utf8') : '';

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }
const open = async (who, viewport = { width: 1280, height: 1000 }) => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => { console.error('page error:', e.message); process.exitCode = 1; });
  await page.route('http://mp.test/**', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div id="root"></div></body></html>' }));
  await page.goto('http://mp.test/');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(w => window.mount(w), who);
  await page.waitForSelector('[data-testid="ceo-presence-panel"]');
  return page;
};
const statusIn = (page, scope) => page.$eval(`${scope} [data-testid="ceo-availability"]`, e => e.getAttribute('data-status'));
const calls = page => page.evaluate(() => window.__calls.filter(c => c.method !== 'GET').map(c => c.path));

try {
  // ---- the CEO: Enter Meeting / Exit Meeting
  {
    const page = await open('ceo');
    check(await statusIn(page, '[data-testid="ceo-presence-panel"]') === 'AVAILABLE', 'the CEO starts AVAILABLE');
    check(await page.isVisible('[data-testid="presence-enter"]') && !(await page.isVisible('[data-testid="presence-exit"]')), 'not in a meeting: only Enter Meeting is offered');
    await page.click('[data-testid="presence-enter"]');
    await page.waitForSelector('[data-testid="presence-exit"]');
    check(await statusIn(page, '[data-testid="ceo-presence-panel"]') === 'BUSY', 'Enter Meeting: BUSY');
    check(/In a meeting since/.test(await page.innerText('[data-testid="ceo-presence-panel"]')), 'the panel says since when');
    check(!(await page.isVisible('[data-testid="presence-enter"]')), 'in a meeting: only Exit Meeting is offered');
    check((await calls(page)).includes('/api/v1/meetings/presence/enter'), 'Enter is sent to the server (not kept in the page)');
    await page.click('[data-testid="presence-exit"]');
    await page.waitForSelector('[data-testid="presence-enter"]');
    check(await statusIn(page, '[data-testid="ceo-presence-panel"]') === 'AVAILABLE', 'Exit Meeting: AVAILABLE again');
    check(/AVAILABLE again/.test(await page.innerText('body')), 'the CEO is told');
    await page.close();
  }
  // ---- a team member: BUSY indicator, the message, the pending request; then the CEO exits (Realtime)
  {
    const page = await open('member');
    check(await statusIn(page, '[data-testid="header"]') === 'AVAILABLE' && await statusIn(page, '[data-testid="ceo-presence-panel"]') === 'AVAILABLE',
      'a team member sees AVAILABLE in the header badge and on the Meetings page');
    check(!(await page.isVisible('[data-testid="presence-enter"]')) && !(await page.isVisible('[data-testid="presence-exit"]')), 'a team member has no Enter / Exit controls');
    // the CEO enters a meeting elsewhere: the server changes, Supabase sends the Realtime event
    await page.evaluate(() => { window.__setServerStatus('BUSY'); window.__fireRealtime('meeting_presence'); });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="ceo-availability"]')].every(e => e.getAttribute('data-status') === 'BUSY'));
    check(true, 'without a refresh, every indicator turns BUSY');

    await page.click('button:has-text("Ask the CEO for time")');
    await page.waitForSelector('[data-testid="ceo-busy-notice"]');
    check(/Superadmin is currently attending another meeting\./.test(await page.innerText('[data-testid="ceo-busy-notice"]')), 'the scheduler says: Superadmin is currently attending another meeting.');
    check(await page.isVisible('button:has-text("Submit the request (pending availability)")'), 'the request can still be submitted');
    await page.fill('#mtg-title', 'Budget review');
    await page.selectOption('#mtg-dur', '60');
    await page.fill('#mtg-desc', 'Pune office budget');
    await page.click('button:has-text("Submit the request (pending availability)")');
    await page.waitForSelector('[role="status"]:has-text("is currently attending another meeting. Your request is saved")');
    const sent = await page.evaluate(() => window.__calls.find(c => c.method === 'POST' && c.path === '/api/v1/meetings')?.body);
    check(sent && sent.title === 'Budget review' && (new Date(sent.endsAt) - new Date(sent.startsAt)) === 3600000 && !!sent.startsAt && sent.description === 'Pune office budget',
      'the request carries the date, time, length and purpose', sent);
    check(/currently attending another meeting/.test(await page.innerText('body')), 'the member is told the request is saved and waits');
    await page.waitForSelector('[data-testid="my-pending-count"]');
    check(/1 of your requests waiting/.test(await page.innerText('[data-testid="my-pending-count"]')), 'the pending request is shown');
    await page.click('[role="tab"]:has-text("Requests")');
    await page.waitForSelector('text=Pending availability');
    check(true, 'Requests > Your requests lists it as Pending availability');

    // the CEO exits elsewhere: the server schedules the request; the Realtime event updates this page
    await page.evaluate(async () => {
      window.__profile = { ...window.__profile, id: window.__ids.CEO };
      await fetch('/api/v1/meetings/presence/exit', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
      window.__profile = { ...window.__profile, id: window.__ids.ME };
      window.__fireRealtime('meeting_presence');
    });
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="ceo-availability"]')].every(e => e.getAttribute('data-status') === 'AVAILABLE'));
    check(true, 'the CEO exits: every indicator turns AVAILABLE without a refresh');
    await page.waitForFunction(() => !document.querySelector('[data-testid="my-pending-count"]'));
    check(true, 'the request is no longer waiting');
    await page.waitForSelector('text=Scheduled');
    check(true, 'the meeting list reloads and shows it Scheduled');
    await page.close();
  }
  // ---- phone width
  {
    const page = await open('ceo', { width: 360, height: 740 });
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    check(m.sw <= m.iw && await page.isVisible('[data-testid="presence-enter"]'), 'phone width: the panel fits and Enter Meeting is reachable', m);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`=== MEETING AVAILABILITY BROWSER TESTS PASSED (${passed}) ===`);
