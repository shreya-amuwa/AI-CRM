// Browser test of Enter / Exit Meeting for employees (migration 20270122000100): an employee enters and exits (the header badge and the panel
// follow), the Super Admin has no controls and the server refuses them, colleagues show BUSY in the New meeting form as soon as Realtime says
// so, a meeting starting within 30 minutes with a BUSY colleague is flagged and refused, and Ask the CEO no longer mentions waiting.
// Real React components, real Chromium; the CRM API is answered in the page (supabase/tests/ui/meeting_presence_harness.tsx).
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
  await page.waitForSelector('h1:has-text("Meetings")');
  return page;
};
const statusIn = (page, scope) => page.$eval(`${scope} [data-testid="availability"]`, e => e.getAttribute('data-status'));
const calls = page => page.evaluate(() => window.__calls.filter(c => c.method !== 'GET').map(c => c.path));

try {
  // ---- an employee: Enter Meeting / Exit Meeting
  {
    const page = await open('member');
    await page.waitForSelector('[data-testid="presence-panel"]');
    check(await statusIn(page, '[data-testid="presence-panel"]') === 'AVAILABLE', 'an employee starts AVAILABLE');
    check(!(await page.isVisible('[data-testid="header"] [data-testid="availability"]')), 'no header badge while AVAILABLE');
    check(await page.isVisible('[data-testid="presence-enter"]') && !(await page.isVisible('[data-testid="presence-exit"]')), 'not in a meeting: only Enter Meeting is offered');
    await page.click('[data-testid="presence-enter"]');
    await page.waitForSelector('[data-testid="presence-exit"]');
    check(await statusIn(page, '[data-testid="presence-panel"]') === 'BUSY', 'Enter Meeting: BUSY');
    check(/In a meeting since/.test(await page.innerText('[data-testid="presence-panel"]')), 'the panel says since when');
    await page.evaluate(() => window.__fireRealtime('meeting_presence'));
    await page.waitForSelector('[data-testid="header"] [data-testid="availability"][data-status="BUSY"]');
    check(/You: BUSY/.test(await page.innerText('[data-testid="header"]')), 'the header badge reminds them they are BUSY');
    check((await calls(page)).includes('/api/v1/meetings/presence/enter'), 'Enter is sent to the server (not kept in the page)');
    await page.click('[data-testid="presence-exit"]');
    await page.waitForSelector('[data-testid="presence-enter"]');
    check(await statusIn(page, '[data-testid="presence-panel"]') === 'AVAILABLE', 'Exit Meeting: AVAILABLE again');
    check(/AVAILABLE again/.test(await page.innerText('body')), 'they are told');
    await page.evaluate(() => window.__fireRealtime('meeting_presence'));
    await page.waitForFunction(() => !document.querySelector('[data-testid="header"] [data-testid="availability"]'));
    check(true, 'the header badge goes away');

    // ---- a colleague enters a meeting elsewhere: BUSY in the New meeting form, without a refresh
    await page.click('button:has-text("New meeting")');
    await page.fill('#mtg-people', 'Ravi');
    await page.waitForSelector('li:has-text("Ravi Colleague")');
    check(!(await page.isVisible('li:has-text("Ravi Colleague") [data-testid="availability"]')), 'the colleague is shown without BUSY while AVAILABLE');
    await page.evaluate(() => { window.__setServerStatus(window.__ids.COL, 'BUSY'); window.__fireRealtime('meeting_presence'); });
    await page.waitForSelector('li:has-text("Ravi Colleague") [data-testid="availability"][data-status="BUSY"]');
    check(true, 'Realtime: the colleague turns BUSY in the list while the form is open');
    await page.click('li:has-text("Ravi Colleague") button');
    await page.waitForSelector('span:has-text("Ravi Colleague") [data-testid="availability"][data-status="BUSY"]');
    check(true, 'the invited colleague carries the BUSY status');
    const soon = new Date(Date.now() + 10 * 60_000);
    const pad = n => String(n).padStart(2, '0');
    await page.fill('#mtg-title', 'Quick sync');
    await page.fill('#mtg-date', `${soon.getFullYear()}-${pad(soon.getMonth() + 1)}-${pad(soon.getDate())}`);
    await page.fill('#mtg-time', `${pad(soon.getHours())}:${pad(soon.getMinutes())}`);
    await page.waitForSelector('[data-testid="busy-soon"]');
    check(/Ravi Colleague is in a meeting right now \(Busy\)/.test(await page.innerText('[data-testid="busy-soon"]')), 'starting within 30 minutes: the form says the colleague is BUSY');
    await page.click('button:has-text("Book the meeting")');
    await page.waitForSelector('text=is in a meeting right now (Busy). Pick a later time');
    check(true, 'the server refuses the conflicting booking and the form shows why');
    await page.evaluate(() => { window.__setServerStatus(window.__ids.COL, 'AVAILABLE'); window.__fireRealtime('meeting_presence'); });
    await page.waitForFunction(() => !document.querySelector('[data-testid="busy-soon"]'));
    check(true, 'the colleague exits: AVAILABLE again and the warning goes away');
    await page.click('button:has-text("Book the meeting")');
    await page.waitForSelector('text=booked for');
    check(true, 'now the meeting can be booked');

    // ---- asking the CEO for time: no waiting / pending availability any more
    await page.click('button:has-text("Ask the CEO for time")');
    await page.waitForSelector('button:has-text("Send the request")');
    check(!(await page.isVisible('text=Superadmin is currently attending another meeting')) && !(await page.isVisible('text=pending availability')),
      'asking the CEO says nothing about the CEO being in a meeting');
    await page.close();
  }
  // ---- the Super Admin: no Enter / Exit at all, and the server refuses it
  {
    const page = await open('ceo');
    await page.waitForTimeout(300);
    check(!(await page.isVisible('[data-testid="presence-panel"]')) && !(await page.isVisible('[data-testid="presence-enter"]')) && !(await page.isVisible('[data-testid="presence-exit"]')),
      'the Super Admin sees no Enter Meeting / Exit Meeting');
    check(!(await page.isVisible('[data-testid="header"] [data-testid="availability"]')), 'and no availability badge');
    const r = await page.evaluate(async () => (await fetch('/api/v1/meetings/presence/enter', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })).status);
    check(r === 403, 'calling the API directly is refused');
    await page.close();
  }
  // ---- phone width
  {
    const page = await open('member', { width: 360, height: 740 });
    await page.waitForSelector('[data-testid="presence-enter"]');
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    check(m.sw <= m.iw, 'phone width: the panel fits and Enter Meeting is reachable', m);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`=== EMPLOYEE MEETING AVAILABILITY BROWSER TESTS PASSED (${passed}) ===`);
