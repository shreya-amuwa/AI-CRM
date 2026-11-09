// Browser test of the Attendance card (20261230000400): the browser's own geolocation (Playwright emulation) granted and denied, what is
// sent to the database (never invented coordinates), India-time 12-hour display, the lunch timer from the SERVER clock, and phone width.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the attendance browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/attendance_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/attendance_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
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
  // 1. location allowed
  const ctx = await browser.newContext({ geolocation: { latitude: 18.5204, longitude: 73.8567, accuracy: 12 }, permissions: ['geolocation'], viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base);
  await page.evaluate(() => window.mount());
  await page.getByTestId('punch-in').waitFor();
  check(await page.getByTestId('punch-out').isDisabled() && await page.getByTestId('lunch-start').isDisabled(), 'before Punch In: Punch Out and lunch are not available');
  check(await page.getByText(/recorded only at Punch In and Punch Out/).isVisible(), 'the location notice is shown before punching');
  await page.getByTestId('punch-in').click();
  await page.getByText(/^Punched in at/).waitFor();
  const sentIn = await page.evaluate(() => window.__calls.find(c => c.fn === 'attendance_punch_in').args);
  check(sentIn.p_location_status === 'CAPTURED' && Math.abs(sentIn.p_lat - 18.5204) < 1e-6 && Math.abs(sentIn.p_lng - 73.8567) < 1e-6 && sentIn.p_accuracy === 12 && typeof sentIn.p_request === 'string',
    'Punch In sends the browser location, its accuracy and a request id (no time: the server decides)', sentIn);
  check(!('p_at' in sentIn) && !('p_time' in sentIn), 'no browser time is sent');
  check((await page.getByTestId('punch-in-time').textContent()) === '9:05 am', 'the server time is shown in India time, 12-hour (03:35 UTC = 9:05 am)', await page.getByTestId('punch-in-time').textContent());
  check(await page.getByTestId('punch-in').isDisabled(), 'Punch In cannot be pressed twice');
  await page.getByTestId('lunch-start').click();
  await page.getByTestId('lunch-end').waitFor();
  const lunchText = await page.getByTestId('lunch-minutes').textContent();
  check(/^52 min \(on lunch\)$/.test(lunchText), 'the running lunch is counted from the server clock (52 min, though the device clock is 3 minutes behind)', lunchText);
  check(await page.getByText('Exceeded by 2 min').isVisible(), 'over the 50-minute allowance it is flagged');
  await page.getByTestId('lunch-end').click();
  await page.getByTestId('lunch-start').waitFor();
  await page.getByTestId('punch-out').click();
  await page.getByText(/^Punched out at/).waitFor();
  check((await page.getByTestId('punch-out-time').textContent()) === '6:10 pm', 'Punch Out time in India time (12:40 UTC = 6:10 pm)');
  check(await page.getByTestId('lunch-start').isDisabled(), 'no lunch after Punch Out');
  check(errors.length === 0, 'no error in the page', errors);
  await page.setViewportSize({ width: 390, height: 844 });
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'no sideways scroll at 390px');
  await ctx.close();

  // 2. location denied: the punch is recorded as "location unavailable", with no coordinates
  const ctx2 = await browser.newContext({ permissions: [] });
  const p2 = await ctx2.newPage();
  await p2.goto(base);
  await p2.evaluate(() => window.mount());
  await p2.getByTestId('punch-in').click();
  await p2.getByText(/^Punched in at .*location unavailable/).waitFor();
  const sent2 = await p2.evaluate(() => window.__calls.find(c => c.fn === 'attendance_punch_in').args);
  check(sent2.p_location_status === 'DENIED' && sent2.p_lat === null && sent2.p_lng === null && sent2.p_accuracy === null,
    'location denied: the punch is still recorded, as "location unavailable", with no coordinates', sent2);
  check(await p2.getByText('Location unavailable (permission denied)').isVisible(), 'and the card says so');
  await ctx2.close();
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== ATTENDANCE BROWSER TESTS PASSED (${passed}) ===`);
