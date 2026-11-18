// Browser test of the attendance reminders on a device (PR 3): the "Turn on reminders" banner on a browser that can receive push, on an
// iPhone that has not installed the app, with notifications blocked, "Not now" for the day, push not set up yet, sign-out removing the
// device, and a reminder in the bell opening Attendance. The browser's push service is replaced by a stand-in (no real device or key).
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the reminders browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/reminders_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/reminders_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;
// a made-up VAPID public key: 65 bytes starting with 0x04, base64url
const KEY = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
let pushKey = KEY;
const json = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
const srv = createServer((req, res) => {
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  if (req.url === '/api/v1/attendance/push-key') return json(res, { publicKey: pushKey });
  if (req.url === '/api/v1/attendance/push-test') return json(res, { sent: 2, gone: 0, failed: 0 });
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

// The stand-in for the browser's push service, installed before the page's own code runs.
const fakePush = ({ permission = 'default', grant = 'granted', subscribed = false, pushManager = true } = {}) => {
  window.__push = { permission, grant, requested: 0, opts: null, sub: null, unsubscribed: 0 };
  const fakeSub = ep => ({ endpoint: ep, toJSON: () => ({ endpoint: ep, keys: { p256dh: 'BPk-test', auth: 'auth-test' } }), unsubscribe: async () => { window.__push.unsubscribed++; window.__push.sub = null; return true; } });
  if (subscribed) window.__push.sub = fakeSub('https://push.example.com/dev-ui');
  const reg = { pushManager: { getSubscription: async () => window.__push.sub, subscribe: async opts => { window.__push.opts = opts; window.__push.sub = fakeSub('https://push.example.com/dev-ui'); return window.__push.sub; } } };
  if (pushManager) {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register: async () => reg, ready: Promise.resolve(reg), getRegistration: async () => reg, addEventListener() {}, removeEventListener() {} } });
    window.PushManager = function PushManager() {};
  } else {
    delete window.PushManager;
  }
  window.Notification = { get permission() { return window.__push.permission; }, requestPermission: async () => { window.__push.requested++; window.__push.permission = window.__push.grant; return window.__push.permission; } };
};

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
const errors = [];
const open = async (options = {}, contextOptions = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...contextOptions });
  await ctx.addInitScript(fakePush, options);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base);
  await page.evaluate(() => window.mountBanner());
  await page.getByTestId('attendance-opened').waitFor();
  return { ctx, page };
};
const calls = (page, fn) => page.evaluate(f => window.__calls.filter(c => c.fn === f).map(c => c.args), fn);
try {
  // 1. a browser that can receive push, reminders off: the banner, then Turn on reminders
  let { ctx, page } = await open();
  await page.getByRole('button', { name: 'Turn on reminders' }).waitFor();
  check(await page.getByText('Get Punch In, lunch and Punch Out reminders on this device.').isVisible(), 'off: banner shows Turn on reminders');
  await page.getByRole('button', { name: 'Turn on reminders' }).click();
  await page.getByText('Reminders are on for this device.').waitFor();
  const saved = await calls(page, 'push_subscription_save');
  const opts = await page.evaluate(() => window.__push.opts);
  check(await page.evaluate(() => window.__push.requested) === 1 && saved.length === 1 && saved[0].p_endpoint === 'https://push.example.com/dev-ui'
    && saved[0].p_p256dh === 'BPk-test' && saved[0].p_auth === 'auth-test' && /Chrome/.test(saved[0].p_label) && opts.userVisibleOnly === true
    && Object.keys(opts.applicationServerKey).length === 65, 'clicking it requests permission and saves the device with its keys and a label', { saved, opts });
  check(await page.getByRole('button', { name: 'Turn on reminders' }).count() === 0, 'and the banner goes away');
  // sign-out: this device stops getting the person's reminders
  await page.evaluate(() => window.unsubscribeThisDevice());
  const removed = await calls(page, 'push_subscription_remove');
  check(removed.length === 1 && removed[0].p_endpoint === 'https://push.example.com/dev-ui' && await page.evaluate(() => window.__push.unsubscribed) === 1,
    'sign-out calls push_subscription_remove for this device and unsubscribes the browser', removed);
  // a reminder in the bell opens Attendance
  check(await page.evaluate(() => window.openFromNotification({ type: 'ATTENDANCE_REMINDER', entityType: 'attendance', entityId: null })) === true, 'the bell knows an attendance reminder');
  await page.waitForFunction(() => document.querySelector('[data-testid="attendance-opened"]').textContent === '1');
  check(true, 'clicking an ATTENDANCE_REMINDER bell item opens Attendance');
  await ctx.close();

  // 2. already on: no banner
  ({ ctx, page } = await open({ permission: 'granted', subscribed: true }));
  await page.waitForTimeout(300);
  check(await page.getByTestId('reminder-banner').count() === 0, 'reminders already on for this device: no banner');
  const claimed = await calls(page, 'push_subscription_save');
  check(claimed.length === 1 && claimed[0].p_endpoint === 'https://push.example.com/dev-ui',
    'a device already subscribed is saved for whoever is signed in now (a shared phone follows the person using it)', claimed);
  await ctx.close();

  // 3. iPhone Safari, app not installed: the Add to Home Screen steps, no Turn on button
  ({ ctx, page } = await open({ pushManager: false }, {
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  }));
  await page.getByTestId('reminder-banner').waitFor();
  const ios = await page.getByTestId('reminder-banner').textContent();
  check(/tap Share, then Add to Home Screen, then open Amuwa CRM from your Home Screen/.test(ios) && await page.getByRole('button', { name: 'Turn on reminders' }).count() === 0,
    'iPhone Safari not installed: shows the Add to Home Screen steps and no Turn on button', ios);
  const box = await page.getByTestId('reminder-banner').boundingBox();
  check(box.width <= 390, 'the banner fits a phone screen', box);
  await ctx.close();

  // 4. notifications blocked for the site
  ({ ctx, page } = await open({ permission: 'denied' }));
  await page.getByTestId('reminder-banner').waitFor();
  check(/Notifications are blocked for this site\. Allow them in your browser's site settings, then reload\./.test(await page.getByTestId('reminder-banner').textContent())
    && await page.getByRole('button', { name: 'Turn on reminders' }).count() === 0, 'blocked: shows the site-settings help');
  await ctx.close();

  // 5. Not now: hidden for the rest of the day, back the next day
  ({ ctx, page } = await open());
  await page.getByRole('button', { name: 'Not now' }).click();
  check(await page.getByTestId('reminder-banner').count() === 0, 'Not now hides the banner');
  await page.reload(); await page.evaluate(() => window.mountBanner()); await page.getByTestId('attendance-opened').waitFor(); await page.waitForTimeout(300);
  check(await page.getByTestId('reminder-banner').count() === 0, 'and it stays hidden for the rest of the day');
  await page.evaluate(() => localStorage.setItem('att-reminder-banner-hidden', '2000-01-01'));
  await page.reload(); await page.evaluate(() => window.mountBanner());
  await page.getByRole('button', { name: 'Turn on reminders' }).waitFor();
  check(true, 'Not now hides it for today and it returns the next day');
  await ctx.close();

  // 6. push not set up on the server yet: a clear message, nothing thrown, nothing saved
  pushKey = null;
  ({ ctx, page } = await open());
  await page.getByRole('button', { name: 'Turn on reminders' }).click();
  await page.getByText('Reminders are not set up yet. Ask your administrator.').waitFor();
  check((await calls(page, 'push_subscription_save')).length === 0, 'no VAPID key: shows "Reminders are not set up yet" and does not throw');
  pushKey = KEY;
  await ctx.close();

  check(errors.length === 0, 'no script errors', errors);
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== ${passed} REMINDERS BROWSER CHECKS PASSED ===`);
