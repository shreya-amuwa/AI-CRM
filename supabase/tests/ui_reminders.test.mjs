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
let keyRequests = 0;
const json = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
// Notification Health stand-in: two employees, one without a device, one ready
const healthQueries = [];
const emp = (id, name, status, extra = {}) => ({ profileId: id, name, role: 'TEAM_MEMBER', designation: null, departmentId: '11111111-1111-4111-8111-111111111111', department: 'Sales',
  status, remindersEnabled: true, effective: { punchIn: '10:00', lunch: '14:00', punchOut: '19:00' }, activeDevices: 0, inactiveDevices: 0, expiredDevices: 0,
  lastAcceptedAt: null, lastFailureAt: null, lastFailureCode: null, failed7d: 0, retryPending: 0, pending: 0, todayGenerated: 1, todayNoDevice: 1,
  reminderMissing: false, noReminderToday: false, onLeave: false, attendanceStatus: 'NOT_PUNCHED_IN', blockedReported: false, lastDeviceCheckAt: null,
  testConfirmedAt: null, soundStatus: 'UNKNOWN', ...extra });
const report = () => ({ generatedAt: new Date().toISOString(), today: '2027-01-11', pushConfigured: true,
  summary: { eligible: 2, remindersEnabled: 2, remindersDisabled: 0, withDevice: 1, withoutDevice: 1, recentFailures: 0, reminderMissing: 0, ready: 1, byStatus: { READY: 1, DEVICE_NOT_REGISTERED: 1 } },
  queue: { pending: 0, retryPending: 0, accepted24h: 3, failed24h: 0, expired24h: 0, cancelled24h: 1 },
  todayReminders: { generated: 2, bellWritten: 2, noDevice: 1, pushOff: 0 },
  scheduler: { lastSuccessAt: new Date().toISOString(), lastRunAt: new Date().toISOString(), lastRunOk: true, lastError: null, lastRunPushConfigured: true, runs24h: 288, failedRuns24h: 0,
    health: 'HEALTHY', last24h: { attempted: 3, accepted: 3, failed: 0, retry: 0, gone: 0, noDevice: 1, generated: 4 } },
  employees: [emp('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Asha Device', 'DEVICE_NOT_REGISTERED'),
              emp('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Ravi Ready', 'READY', { activeDevices: 1, lastAcceptedAt: new Date().toISOString(), soundStatus: 'CONFIRMED' })] });
function healthApi(req, res) {
  healthQueries.push(req.url);
  if (req.method === 'POST' && req.url.endsWith('/test')) return json(res, { devices: 1, sent: 1, retry: 0, failed: 0, gone: 0, pushConfigured: true });
  if (/health\/[0-9a-f-]{36}$/.test(req.url)) return json(res, { profileId: 'x', name: 'x', devices: [], browsers: [], deliveries: [], reminders: [] });
  return json(res, report());
}
const srv = createServer((req, res) => {
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  if (req.url === '/api/v1/attendance/push-key') { keyRequests++; return json(res, { publicKey: pushKey }); }
  if (req.url === '/api/v1/attendance/push-test') return json(res, { sent: 2, gone: 0, failed: 0 });
  if (req.url.startsWith('/api/v1/notifications/health')) return healthApi(req, res);
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
    window.__swListeners = [];
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register: async () => reg, ready: Promise.resolve(reg), getRegistration: async () => reg,
      addEventListener: (t, l) => { if (t === 'message') window.__swListeners.push(l); }, removeEventListener() {} } });
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
const open = async (options = {}, contextOptions = {}, before = undefined, path = '/') => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...contextOptions });
  await ctx.addInitScript(fakePush, options);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + path);
  if (before) await page.evaluate(before);
  await page.evaluate(() => window.mountBanner());
  await page.getByTestId('attendance-opened').waitFor();
  return { ctx, page };
};
const calls = (page, fn) => page.evaluate(f => window.__calls.filter(c => c.fn === f).map(c => c.args), fn);
try {
  // 1. a browser that can receive push, reminders off: the banner, then Turn on reminders
  let { ctx, page } = await open();
  await page.getByRole('button', { name: 'Turn on notifications' }).waitFor();
  check(await page.getByText('Enable notifications to receive Punch In, Lunch, Resume Work and Punch Out reminders.').isVisible(), 'off: banner names the four reminders and offers Turn on notifications');
  await page.waitForTimeout(300);
  const keysBeforeClick = keyRequests;
  await page.getByRole('button', { name: 'Turn on notifications' }).click();
  await page.getByText('Notifications are on for this device.').waitFor();
  check(keysBeforeClick >= 1 && keyRequests === keysBeforeClick,
    'the push key is fetched when the banner shows, so the click asks for permission straight away (Safari needs the tap)', { keysBeforeClick, keyRequests });
  const saved = await calls(page, 'push_subscription_save');
  const opts = await page.evaluate(() => window.__push.opts);
  check(await page.evaluate(() => window.__push.requested) === 1 && saved.length === 1 && saved[0].p_endpoint === 'https://push.example.com/dev-ui'
    && saved[0].p_p256dh === 'BPk-test' && saved[0].p_auth === 'auth-test' && /Chrome/.test(saved[0].p_label) && opts.userVisibleOnly === true
    && Object.keys(opts.applicationServerKey).length === 65, 'clicking it requests permission and saves the device with its keys and a label', { saved, opts });
  check(await page.getByRole('button', { name: 'Turn on notifications' }).count() === 0, 'and the banner goes away');
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
  const claimed = await calls(page, 'push_subscription_claim');
  check(claimed.length === 1 && claimed[0].p_endpoint === 'https://push.example.com/dev-ui' && (await calls(page, 'push_subscription_save')).length === 0,
    'a device already subscribed is saved for whoever is signed in now (a shared phone follows the person using it)', claimed);
  await ctx.close();

  // 2b. subscribed in the browser, but the person removed this device from their list: it is not brought back
  ({ ctx, page } = await open({ permission: 'granted', subscribed: true }, {}, () => { window.__state.thisDevice = null; }));
  await page.getByRole('button', { name: 'Turn on notifications' }).waitFor();
  check(await page.evaluate(() => window.__push.unsubscribed) === 1 && (await calls(page, 'push_subscription_save')).length === 0,
    'a device removed from the list stays removed: the browser unsubscribes and the banner offers to turn reminders on again');
  await ctx.close();

  // 3. iPhone Safari, app not installed: the Add to Home Screen steps, no Turn on button
  ({ ctx, page } = await open({ pushManager: false }, {
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  }));
  await page.getByTestId('reminder-banner').waitFor();
  const ios = await page.getByTestId('reminder-banner').textContent();
  check(/tap Share, then Add to Home Screen, then open Amuwa CRM from your Home Screen/.test(ios) && await page.getByRole('button', { name: 'Turn on notifications' }).count() === 0,
    'iPhone Safari not installed: shows the Add to Home Screen steps and no Turn on button', ios);
  const box = await page.getByTestId('reminder-banner').boundingBox();
  check(box.width <= 390, 'the banner fits a phone screen', box);
  await ctx.close();

  // 4. notifications blocked for the site
  ({ ctx, page } = await open({ permission: 'denied' }));
  await page.getByTestId('reminder-banner').waitFor();
  check(/Notifications are blocked for this site, so reminders cannot reach this device\. Allow them in your browser's site settings \(Attendance → Reminders → Notification troubleshooting\), then reload\./.test(await page.getByTestId('reminder-banner').textContent())
    && await page.getByRole('button', { name: 'Turn on notifications' }).count() === 0, 'blocked: shows the site-settings help');
  await ctx.close();

  // 5. Not now: hidden for the rest of the day, back the next day
  ({ ctx, page } = await open());
  await page.getByRole('button', { name: 'Not now' }).click();
  check(await page.getByTestId('reminder-banner').count() === 0, 'Not now hides the banner');
  await page.reload(); await page.evaluate(() => window.mountBanner()); await page.getByTestId('attendance-opened').waitFor(); await page.waitForTimeout(300);
  check(await page.getByTestId('reminder-banner').count() === 0, 'and it stays hidden for the rest of the day');
  await page.evaluate(() => localStorage.setItem('att-reminder-banner-hidden', '2000-01-01'));
  await page.reload(); await page.evaluate(() => window.mountBanner());
  await page.getByRole('button', { name: 'Turn on notifications' }).waitFor();
  check(true, 'Not now hides it for today and it returns the next day');
  await ctx.close();

  // 6. push not set up on the server yet: a clear message, nothing thrown, nothing saved
  pushKey = null;
  ({ ctx, page } = await open());
  await page.getByRole('button', { name: 'Turn on notifications' }).click();
  await page.getByText('Notifications are not set up yet. Ask your administrator.').waitFor();
  check((await calls(page, 'push_subscription_save')).length === 0, 'no VAPID key: shows "Notifications are not set up yet" and does not throw');
  pushKey = KEY;
  await ctx.close();

  // 7. the Reminders tab: my times, my devices, the company defaults (HR)
  const panel = async (role, options = { permission: 'granted', subscribed: true }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(fakePush, options);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base);
    await page.evaluate(r => window.mountPanel(r), role);
    await page.getByTestId('reminders-panel').waitFor();
    return { ctx, page };
  };
  ({ ctx, page } = await panel('staff'));
  await page.getByLabel('Punch In reminder').waitFor();
  const hints = await page.getByTestId('my-reminders').textContent();
  check(/Company time 10:00/.test(hints) && /Company time 14:00/.test(hints) && /Company time 19:00/.test(hints), 'staff see 10:00 / 14:00 / 19:00 as the company times', hints);
  await page.getByLabel('Punch In reminder').fill('09:30');
  await page.getByRole('button', { name: 'Save my times' }).click();
  await page.getByText('Saved.').waitFor();
  const mine = await calls(page, 'attendance_reminder_save_mine');
  check(mine.length === 1 && mine[0].p_punch_in === '09:30' && mine[0].p_lunch === null && mine[0].p_punch_out === null && mine[0].p_enabled === true,
    'staff save a personal 09:30 (the other times stay on the company time)', mine);
  await page.getByLabel('Punch In reminder').fill('05:30');
  await page.getByRole('button', { name: 'Save my times' }).click();
  await page.getByText('Punch In reminder must be between 06:00 and 13:00').waitFor();
  check(true, 'an out-of-range time shows the server message inline');
  check(await page.getByTestId('company-reminders').count() === 0, 'team member does not see Company defaults');
  await page.getByText('Notifications are on for this device.').waitFor();
  check(true, 'the panel says this device gets reminders');
  const devices = page.getByTestId('device-row');
  await devices.first().waitFor();
  check(await devices.count() === 2 && /Chrome on Android/.test(await devices.first().textContent()), 'devices list shows two devices');
  await devices.first().getByRole('button', { name: 'Remove' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="device-row"]').length === 1);
  check((await calls(page, 'push_subscription_remove_by_id'))[0]?.p_id === 'd1', 'Remove deletes one');
  await page.getByTestId('this-device').getByText('Enable notifications to receive Punch In, Lunch, Resume Work and Punch Out reminders.').waitFor();
  check(await page.evaluate(() => window.__push.unsubscribed) === 1, 'removing the device you are holding turns its reminders off here too');
  await page.getByRole('button', { name: 'Send test notification' }).click();
  await page.getByText('Accepted by the push service for 2 devices. It should appear in a few seconds.').waitFor();
  check(true, 'Send test notification says the push service accepted it (not "delivered")');
  await page.getByRole('group', { name: 'Did the test notification appear?' }).getByRole('button', { name: 'Yes' }).click();
  await page.getByRole('group', { name: 'Did it make a sound?' }).getByRole('button', { name: 'Yes' }).click();
  await page.getByText('Thanks — recorded for this device.').waitFor();
  const conf = await calls(page, 'push_test_confirm');
  check(conf.length === 1 && conf[0].p_appeared === true && conf[0].p_sound === true, 'the employee confirms the test appeared and sounded', conf);
  await page.getByRole('button', { name: 'Check device status' }).click();
  const status = await page.getByTestId('device-status').textContent();
  check(/Permission:\s*Allowed\./.test(status) && /Browser support:/.test(status) && /In-app sound:/.test(status), 'Check device status lists support, permission and sound', status);
  await page.getByText('Notification troubleshooting').click();
  check(/Site settings|site settings/.test(await page.getByTestId('device-guide').textContent()), 'troubleshooting steps for this device are one click away');
  // the sound settings: three switches and Test sound
  const sound = page.getByTestId('notification-sound');
  check(await sound.getByLabel('Attendance reminders').isChecked() && await sound.getByLabel('Chat messages').isChecked() && await sound.getByLabel('General notifications').isChecked(),
    'Notification sound: three switches, on by default');
  await sound.getByLabel('General notifications').uncheck();
  check(await page.evaluate(() => localStorage.getItem('crm.sound.general')) === 'off', 'turning general sounds off is remembered');
  await sound.getByRole('button', { name: 'Test sound' }).click();
  await page.getByRole('group', { name: 'Did you hear the sound?' }).getByRole('button', { name: 'Yes' }).click();
  await page.getByText('Thanks — sound is confirmed on this device.').waitFor();
  check((await calls(page, 'notification_sound_confirm')).length === 1, 'Test sound plays inside the click and the employee can confirm hearing it');
  await ctx.close();

  ({ ctx, page } = await panel('hr'));
  await page.getByTestId('company-reminders').waitFor();
  await page.getByLabel('Company Punch Out').fill('18:30');
  await page.getByLabel('Sunday').check();
  await page.getByRole('button', { name: 'Save company times' }).click();
  await page.getByText('Company times saved.').waitFor();
  const co = await calls(page, 'hr_attendance_reminder_defaults_save');
  check(co.length === 1 && co[0].p_punch_out === '18:30' && co[0].p_punch_in === '10:00' && JSON.stringify(co[0].p_days) === '[1,2,3,4,5,6,7]'
    && co[0].p_follow_up === 15 && co[0].p_warning === 5 && co[0].p_enabled === true, 'HR sees Company defaults and can save', co);
  await page.getByRole('button', { name: 'Turn off reminders for today' }).click();
  await page.getByRole('button', { name: 'Turn reminders back on for today' }).waitFor();
  check((await calls(page, 'hr_attendance_reminders_pause_today'))[0]?.p_paused === true, 'HR can turn reminders off for today');
  check(await page.getByTestId('my-reminders').count() === 1, 'HR also has their own times');
  await page.getByLabel('Resume Work follow-up (minutes, 0 = none)').fill('0');
  await page.getByRole('button', { name: 'Save follow-up' }).click();
  await page.getByTestId('resume-follow-up').getByText('Saved.').waitFor();
  check((await calls(page, 'hr_attendance_resume_follow_up_save'))[0]?.p_minutes === 0, 'HR sets the Resume Work follow-up (0 = none)');
  await ctx.close();

  ({ ctx, page } = await panel('sa'));
  await page.getByTestId('company-reminders').waitFor();
  check(await page.getByTestId('my-reminders').count() === 0 && await page.getByTestId('this-device').count() === 0, 'Super Admin sees only Company defaults');
  await ctx.close();

  // phone width: nothing wider than the screen
  ({ ctx, page } = await panel('hr'));
  await page.setViewportSize({ width: 375, height: 800 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= 375), 'the Reminders tab fits a phone screen');
  await ctx.close();

  // 8. chat notifications: the wording, opening a conversation from a notification, and the Chat notifications switch
  ({ ctx, page } = await open({}, {}, undefined, '/?open=chat&conversation=c1'));
  await page.waitForFunction(() => (window.__chatOpened || []).length === 1);
  check(JSON.stringify(await page.evaluate(() => window.__chatOpened[0])) === JSON.stringify({ conversationId: 'c1' })
    && !/open=/.test(await page.evaluate(() => location.search)), '/?open=chat&conversation=c1 opens the chat on c1 and the address no longer has open=');
  await page.evaluate(() => window.__swListeners.forEach(l => l({ data: { type: 'open-chat', clientConversationId: 'cc1' } })));
  await page.waitForFunction(() => window.__chatOpened.length === 2);
  check(JSON.stringify(await page.evaluate(() => window.__chatOpened[1])) === JSON.stringify({ clientConversationId: 'cc1' }),
    'a worker message open-chat with clientConversationId opens that client chat');
  check(await page.getByTestId('overlay-closed').textContent() === '2', 'opening a chat closes Attendance if it was on screen (the layout is told each time)');
  await ctx.close();
  ({ ctx, page } = await open({}, {}, undefined, '/?open=attendance'));
  await page.waitForFunction(() => document.querySelector('[data-testid="attendance-opened"]').textContent !== '0' || !/open=/.test(location.search));
  check(!/open=/.test(await page.evaluate(() => location.search)), 'opening from a reminder also clears ?open=attendance (a reload does not reopen it)');
  await ctx.close();
  ({ ctx, page } = await panel('staff'));
  const chatSwitch = page.getByLabel('Chat notifications');
  await chatSwitch.waitFor();
  check(await chatSwitch.isChecked(), 'the Reminders tab has a Chat notifications switch, on by default');
  await chatSwitch.uncheck();
  await page.waitForFunction(() => window.__calls.some(c => c.fn === 'push_chat_set'));
  check((await calls(page, 'push_chat_set'))[0]?.p_enabled === false && !(await chatSwitch.isChecked()), 'turning it off calls push_chat_set(false)');
  await ctx.close();

  // 9. Notification Health (Super Admin / HR): statuses with reasons, filters, the employee detail, a confirmed test
  ({ ctx, page } = await open());
  await page.evaluate(() => { document.getElementById('root').innerHTML = ''; window.mountHealth(); });
  await page.getByTestId('notification-health').getByText('Healthy').waitFor();
  const rows = page.getByTestId('health-row');
  check(await rows.count() === 2, 'Notification Health lists the employees from the server', await rows.count());
  check(/Device not registered/.test(await rows.nth(0).textContent()) && /Ready/.test(await rows.nth(1).textContent()), 'each with a meaningful status');
  check(!/push\.example\.com|p256dh/.test(await page.content()), 'no device address or key on the page');
  const filtered = page.waitForResponse(r => r.url().includes('issue=DEVICE_NOT_REGISTERED'));
  await page.getByLabel('Issue').selectOption('DEVICE_NOT_REGISTERED');
  await filtered;
  check(healthQueries.some(q => q.includes('issue=DEVICE_NOT_REGISTERED')), 'the issue filter asks the server for that issue');
  await rows.nth(1).getByRole('button', { name: /Send a test notification/ }).click();
  await rows.nth(1).getByRole('button', { name: 'Send' }).click();
  await page.getByText(/Accepted by the push service for 1 of 1 device/).waitFor();
  check(true, 'Send test asks for confirmation, then shows how many push services accepted it');
  await rows.nth(0).getByRole('button', { name: /^Asha Device/ }).click();
  await page.getByText('What to do:').waitFor();
  check(/turn on notifications/i.test(await page.getByText('What to do:').locator('..').textContent()), 'opening a row explains why and what to do');
  await page.setViewportSize({ width: 375, height: 800 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= 375 + 1), 'the page itself does not scroll sideways on a phone (the table scrolls in its box)');
  await ctx.close();

  check(errors.length === 0, 'no script errors', errors);
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== ${passed} REMINDERS BROWSER CHECKS PASSED ===`);
