// Browser test of the Attendance card and HR's register (20261230000400 / 0700): the browser's own geolocation (Playwright emulation) granted,
// denied, off, imprecise and missing (nothing is sent without a usable position), the attendance states and buttons, India time on devices set
// to other time zones, the lunch timer from the SERVER clock, phone width, and HR's register of every employee.
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
  const calledRpc = (pg, fn) => pg.evaluate(f => window.__calls.filter(c => c.fn === f).map(c => c.args), fn);
  // 1. location allowed: Punch In, lunch, Resume Work, Punch Out with a fresh location
  const ctx = await browser.newContext({ geolocation: { latitude: 18.5204, longitude: 73.8567, accuracy: 12 }, permissions: ['geolocation'], viewport: { width: 1280, height: 900 }, timezoneId: 'America/New_York' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base);
  await page.evaluate(() => window.mount());
  await page.getByTestId('punch-in').waitFor();
  check((await page.getByTestId('attendance-status').textContent()) === 'Not Punched In', 'opening the CRM: "Not Punched In" (nothing is punched automatically)');
  check(await page.getByText('Today – 9 November 2026').isVisible(), 'the attendance date in words (India time)');
  check(await page.getByTestId('punch-out').isDisabled() && await page.getByTestId('lunch-start').isDisabled() && !(await page.getByTestId('punch-in').isDisabled()),
    'Not Punched In: only Punch In is available');
  check((await calledRpc(page, 'attendance_punch_in')).length === 0, 'no Punch In is sent until the button is pressed');
  await page.getByTestId('punch-in').click();
  await page.getByText(/^Punched in at/).waitFor();
  const sentIn = (await calledRpc(page, 'attendance_punch_in'))[0];
  check(sentIn.p_location_status === 'CAPTURED' && Math.abs(sentIn.p_lat - 18.5204) < 1e-6 && Math.abs(sentIn.p_lng - 73.8567) < 1e-6 && sentIn.p_accuracy === 12 && typeof sentIn.p_request === 'string',
    'Punch In sends the GPS position, its accuracy and a request id', sentIn);
  check(!('p_at' in sentIn) && !('p_time' in sentIn), 'no browser time is sent (the server decides)');
  check((await page.getByTestId('punch-in-time').textContent()) === '9:05 AM IST', 'the server time in India Standard Time, on a device set to New York time (03:35 UTC = 9:05 AM IST)', await page.getByTestId('punch-in-time').textContent());
  const inLoc = await page.getByTestId('punch-in-location').textContent();
  check(/18\.520400, 73\.856700/.test(inLoc) && /within 12 m/.test(inLoc) && (await page.getByTestId('punch-in-location').getByRole('link', { name: 'Google Maps' }).getAttribute('href')) === 'https://www.google.com/maps?q=18.5204,73.8567',
    'the card shows the Punch In coordinates, accuracy and a Google Maps link', inLoc);
  check((await page.getByTestId('attendance-status').textContent()) === 'Punched In' && await page.getByTestId('punch-in').isDisabled()
    && !(await page.getByTestId('lunch-start').isDisabled()) && !(await page.getByTestId('punch-out').isDisabled()), 'Punched In: Start Lunch and Punch Out available, no second Punch In');
  await page.getByTestId('lunch-start').click();
  await page.getByTestId('lunch-end').waitFor();
  check((await page.getByTestId('attendance-status').textContent()) === 'On Lunch' && await page.getByTestId('punch-out').isDisabled(), 'On Lunch: only Resume Work');
  const lunchText = await page.getByTestId('lunch-minutes').textContent();
  check(/^52 min \(on lunch\)$/.test(lunchText), 'the running lunch is counted from the server clock (52 min, though the device clock is 3 minutes behind)', lunchText);
  check((await page.getByTestId('lunch-extra').textContent()) === '2 min' && (await page.getByTestId('lunch-remaining').textContent()) === '0 min', 'over the 50 minutes: 0 remaining, 2 min extra');
  await page.getByTestId('lunch-end').click();
  await page.getByTestId('lunch-start').waitFor();
  check((await page.getByTestId('attendance-status').textContent()) === 'Resumed Work', 'Resume Work: state "Resumed Work"');
  await ctx.setGeolocation({ latitude: 18.559, longitude: 73.7868, accuracy: 9 });
  await page.getByTestId('punch-out').click();
  await page.getByText(/^Punched out at/).waitFor();
  const sentOut = (await calledRpc(page, 'attendance_punch_out'))[0];
  check(Math.abs(sentOut.p_lat - 18.559) < 1e-6 && Math.abs(sentOut.p_lng - 73.7868) < 1e-6 && sentOut.p_accuracy === 9, 'Punch Out sends a fresh position (not the Punch In one)', sentOut);
  check((await page.getByTestId('punch-out-time').textContent()) === '6:10 PM IST', 'Punch Out time in IST (12:40 UTC = 6:10 PM IST)');
  check((await page.getByTestId('attendance-status').textContent()) === 'Punched Out' && await page.getByTestId('punch-in').isDisabled()
    && await page.getByTestId('lunch-start').isDisabled() && await page.getByTestId('punch-out').isDisabled(), 'Punched Out: no further Punch In, lunch or Punch Out');
  check(errors.length === 0, 'no error in the page', errors);
  await page.setViewportSize({ width: 390, height: 844 });
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'no sideways scroll at 390px');
  await ctx.close();

  // 2. permission denied / location services off / imprecise / unsupported: nothing is sent, the person is told how to fix it
  const refused = async (label, ctxOpts, init, expect) => {
    const c = await browser.newContext(ctxOpts);
    if (init) await c.addInitScript(init);
    const pg = await c.newPage();
    await pg.goto(base);
    await pg.evaluate(() => window.mount());
    await pg.getByTestId('punch-in').click();
    await pg.getByTestId('attendance-notice').waitFor();
    const msg = await pg.getByTestId('attendance-notice').textContent();
    check(expect.test(msg) && (await calledRpc(pg, 'attendance_punch_in')).length === 0 && (await pg.getByTestId('attendance-status').textContent()) === 'Not Punched In'
      && !(await pg.getByTestId('punch-in').isDisabled()), label, msg);
    await c.close();
  };
  await refused('permission denied: attendance is NOT marked and the person is told how to allow location', { permissions: [] }, null, /permission is blocked.*Allow/);
  await refused('location services off: not marked, with how to turn location on', {}, () => {
    navigator.geolocation.watchPosition = (_ok, err) => { setTimeout(() => err({ code: 2, message: 'off' }), 10); return 1; };
    navigator.geolocation.clearWatch = () => {};
  }, /could not find its location.*Turn on location services/);
  await refused('an approximate 5 km (network / IP) position: not marked', { geolocation: { latitude: 18.5, longitude: 73.8, accuracy: 5000 }, permissions: ['geolocation'] }, null, /not precise enough \(within 5000 m; at most 1000 m/);
  await refused('a browser without geolocation: not marked', {}, () => { Object.defineProperty(Navigator.prototype, 'geolocation', { get: () => undefined }); }, /cannot share its location/);

  // 3. HR: the register of every employee for a day, CRM login / logout apart from punches, coordinates, maps, lunch, states
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'UTC' });
  const p3 = await ctx3.newPage();
  const errors3 = [];
  p3.on('pageerror', e => errors3.push(String(e)));
  await p3.goto(base);
  await p3.evaluate(() => window.mountHr());
  await p3.getByTestId('register-row').first().waitFor();
  const headers = await p3.locator('[data-testid="hr-register"] thead th').allTextContents();
  check(JSON.stringify(headers) === JSON.stringify(['Employee', 'Department', 'CRM Login', 'Punch In', 'Punch In Location', 'Lunch Duration', 'Punch Out', 'Punch Out Location', 'Worked', 'Status']),
    'the register has the requested columns', headers);
  check(await p3.getByTestId('register-row').count() === 4, 'every employee is listed, including the one not punched in');
  const asha = p3.getByTestId('register-row').filter({ hasText: 'Asha Staff' });
  const ashaIn = await asha.getByTestId('hr-location').textContent();
  const ashaOut = await asha.getByTestId('hr-out-location').textContent();
  check(/18\.520431, 73\.856743/.test(ashaIn) && /within 113 m/.test(ashaIn) && /Near: Baner Road/.test(ashaIn) && /18\.559000, 73\.786800/.test(ashaOut) && /within 9 m/.test(ashaOut),
    'HR sees the Punch In and Punch Out coordinates and accuracy (and the nearest address when looked up)', { ashaIn, ashaOut });
  check((await asha.getByTestId('hr-location').getByRole('link', { name: 'Google Maps' }).getAttribute('href')) === 'https://www.google.com/maps?q=18.520431,73.856743', 'a Google Maps link for each punch');
  check((await asha.getByTestId('crm-login').textContent()) === '9:00 AM IST' && (await asha.getByTestId('crm-logout').textContent()) === 'Logout 6:15 PM IST'
    && (await asha.getByTestId('register-in').textContent()) === '9:05 AM IST' && /55 min/.test(await asha.getByTestId('register-lunch').textContent()) && /\+5 min over/.test(await asha.getByTestId('register-lunch').textContent()),
    'CRM login and logout, Punch In and lunch (55 min, 5 over) in IST on a device set to UTC');
  const ravi = p3.getByTestId('register-row').filter({ hasText: 'Ravi Staff' });
  check((await ravi.getByTestId('register-out').textContent()) === 'Missing' && (await ravi.getByTestId('register-status-badge').textContent()) === 'Incomplete Attendance'
    && (await ravi.getByTestId('crm-logout').textContent()) === 'Logout 1:00 PM IST', 'logged out of the CRM without punching out: Punch Out "Missing", "Incomplete Attendance"');
  const meera = p3.getByTestId('register-row').filter({ hasText: 'Meera Staff' });
  check((await meera.getByTestId('register-status-badge').textContent()) === 'Not Punched In', 'not punched in is shown');
  const old = p3.getByTestId('register-row').filter({ hasText: 'Old Record' });
  check(/Location unavailable \(permission denied\)/.test(await old.textContent()) && /Location erased after 90 days/.test(await old.textContent()), 'older punches keep their recorded state (no address is invented)');
  await p3.getByTestId('register-status').selectOption('INCOMPLETE');
  check(await p3.getByTestId('register-row').count() === 1 && /Ravi Staff/.test(await p3.getByTestId('register-row').textContent()), 'filter by status');
  await p3.getByTestId('register-status').selectOption('');
  await asha.getByRole('button', { name: /Asha Staff/ }).click();
  const detail = p3.getByTestId('register-detail');
  await detail.waitFor();
  const dtext = await detail.textContent();
  check(/9 November 2026 – 9:05 AM IST/.test(dtext) && /Latitude18\.520431/.test(dtext) && /Accuracy113 m/.test(dtext) && /9 November 2026 – 6:10 PM IST/.test(dtext)
    && /Chrome on Windows/.test(dtext) && /1:00 PM IST → 1:20 PM IST · 20 min/.test(dtext) && /extra 5 min/.test(dtext), 'the detail: full IST stamps, coordinates, accuracy, CRM sessions with device, each lunch break', dtext);
  const maps = await detail.locator('iframe').evaluateAll(fs => fs.map(f => f.getAttribute('src')));
  check(maps.length === 2 && maps[0].includes('marker=18.520431,73.856743') && maps[1].includes('marker=18.559,73.7868'), 'the Punch In and Punch Out locations on a map', maps);
  await p3.getByTestId('register-date').fill('2026-11-08');
  await p3.getByText('Attendance register – 8 November 2026').waitFor();
  check((await calledRpc(p3, 'hr_attendance_register')).some(a => a.p_date === '2026-11-08'), 'HR opens a previous date');
  check(errors3.length === 0, 'no error in the HR page', errors3);
  await ctx3.close();
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== ATTENDANCE BROWSER TESTS PASSED (${passed}) ===`);
