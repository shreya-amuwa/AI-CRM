// Browser test of "My Crocodial Activity" (20270115000300): hidden without an approved mapping, the figures and their labels, the period
// filter, CRM demos for a Business Associate, "not available" (never zeros) and stale data, at desktop and phone width. The API is a fake.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Crocodial activity browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/crocodial_activity_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

// ---- the fake API -----------------------------------------------------------------------------------------------------------------------
const now = new Date().toISOString();
let state;
const reset = () => { state = { me: { enabled: true, connectionName: 'M Pillar', externalName: 'sachin' }, mode: 'ok', calls: [] }; };
reset();
const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
const activity = q => {
  const base = { enabled: true, timezone: 'Asia/Kolkata', from: q.get('from'), to: q.get('to'), lastSyncAt: now,
    person: { id: 'p1', name: 'Sachin', role: 'TEAM_MEMBER', salesSubRole: 'TELECALLER' }, demos: { scheduled: 2, completed: 1, cancelled: 1, upcoming: 1 } };
  if (state.mode === 'unavailable') return { ...base, available: false, stale: true, lastSyncAt: null };
  return { ...base, available: true, stale: state.mode === 'stale',
    calls: { made: 4, connected: 3, notConnected: 1, connectRate: 75, talkSeconds: 130, incoming: 1, missed: 1, uniqueLeads: 2, uniqueNumbers: 3 },
    followups: { scheduled: 2, completed: 1, completionRate: 50, overdue: 1 }, leads: { assigned: 2, neverCalled: 1, followUpDue: 1 }, remarks: 1,
    daily: [], recentCalls: [{ callAt: now, type: 'outgoing', connected: true, durationSeconds: 60, contactName: 'Ravi', phone: 'XXXXXX0001', leadStatus: null },
      { callAt: now, type: 'outgoing', connected: false, durationSeconds: 0, contactName: 'Meera', phone: 'XXXXXX0002', leadStatus: null },
      { callAt: now, type: 'outgoing', connected: null, durationSeconds: null, contactName: 'Kiran', phone: 'XXXXXX0003', leadStatus: null }],
    upcomingFollowups: [{ scheduledAt: now, note: 'Call back', leadName: 'Asha', overdue: true }] };
};
function api(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/^\/api\/v1/, '');
  state.calls.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization || null });
  if (p === '/crocodial/me') return ok(res, state.me);
  if (p === '/crocodial/activity') return ok(res, activity(u.searchParams));
  res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'no fake' } }));
}

const srv = createServer((req, res) => {
  if (req.url.startsWith('/api/v1/')) {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => api(req, res, raw ? JSON.parse(raw) : undefined));
    return;
  }
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
const lastCall = (method, p) => [...state.calls].reverse().find(c => c.method === method && c.path === p);
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport, timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));

    // without an approved mapping: nothing at all
    reset(); state.me = { enabled: false };
    await page.goto(base);
    await page.evaluate(() => window.mount({}));
    await page.getByText('Home').waitFor();
    await page.waitForTimeout(300);
    check(!(await page.getByTestId('crocodial-activity').count()) && !state.calls.some(c => c.path === '/crocodial/activity'), `${label}: without an approved mapping nothing is shown or asked`);

    // switched on: the figures
    reset();
    await page.goto(base);
    await page.evaluate(() => window.mount({ showDemos: false }));
    await page.getByRole('heading', { name: /My Crocodial Activity/ }).waitFor();
    await page.getByText('Total calls').waitFor();
    const last = () => [...state.calls].reverse().find(c => c.path === '/crocodial/activity');
    check(last().auth === 'Bearer test-token' && !last().query.profileId, `${label}: the person's own activity is read with their session (no id sent)`);
    check(await page.getByText(/Source: Crocodial \(read-only\) · last synced/).isVisible(), `${label}: the source and the last sync are shown`);
    const summary = page.getByLabel('Calling summary');
    check(await summary.getByText('Connect rate 75%').isVisible() && await summary.getByText('2 min').isVisible() && await summary.getByText('Not connected').isVisible()
      && await summary.getByText('Unique numbers').isVisible(), `${label}: the five Crocodial call figures: total, connected (with the rate), not connected, unique numbers, talk time`);
    check((await summary.locator(':scope > div').allTextContents()).map(t => t.split(/(?=[0-9—])/)[0]).join('|').startsWith('Total calls|Connected|Not connected|Unique numbers|Talk time')
      && await summary.locator(':scope > div').count() === 5, `${label}: exactly those five, in the shared order`);
    check(!(await page.getByText(/1 completed · 50%/).count()) && !(await page.getByText('1 never called').count()) && !(await page.getByText('Incoming / missed').count()),
      `${label}: the follow-up counters, the duplicate Crocodial-leads card and incoming / missed are gone`);
    const recent = page.getByTestId('croc-recent-calls');
    check(await recent.getByText('Connected', { exact: true }).isVisible() && await recent.getByText('Not connected', { exact: true }).isVisible()
      && await recent.getByText('Not reported', { exact: true }).isVisible(), `${label}: each call's status as Crocodial sent it; an empty "connected" is "not reported", never "not connected"`);
    check(await page.getByText('XXXXXX0001').isVisible() && await page.getByText(/Overdue ·/).isVisible(), `${label}: recent calls (last 4 digits only) and overdue follow-ups`);
    check(!(await page.getByText('Demos scheduled').count()), `${label}: a Telecaller does not get the demo cards`);
    await page.getByRole('button', { name: 'Last 30 days' }).click();
    await page.waitForFunction(() => true);
    await page.waitForTimeout(300);
    const q = last().query;
    check(q.from && q.to && (new Date(q.to) - new Date(q.from)) / 86400000 === 29, `${label}: the period filter asks for 30 days`, q);
    check(errors.length === 0, `${label}: no script errors`, errors);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: nothing runs off the screen`);

    // a Business Associate: demos from the CRM schedule
    reset();
    await page.goto(base);
    await page.evaluate(() => window.mount({ showDemos: true }));
    await page.getByText('Demos scheduled').waitFor();
    check(await page.getByText('From the CRM demo schedule').isVisible(), `${label}: a Business Associate sees demo counts from the CRM demo schedule`);

    // not synced yet: no zeros; old data: labelled
    reset(); state.mode = 'unavailable';
    await page.goto(base);
    await page.evaluate(() => window.mount({}));
    await page.getByTestId('croc-unavailable').waitFor();
    check(!(await page.getByText('Total calls').count()), `${label}: before the first sync there are no figures (not zeros)`);
    reset(); state.mode = 'stale';
    await page.goto(base);
    await page.evaluate(() => window.mount({}));
    await page.getByTestId('croc-stale').waitFor();
    check(await page.getByText('Total calls').isVisible(), `${label}: old data is shown with a "not current" label`);

    // a manager's view of one person
    reset();
    await page.goto(base);
    await page.evaluate(() => window.mount({ profileId: '11111111-1111-4111-8111-111111111111', title: 'Sachin — Crocodial activity' }));
    await page.getByRole('heading', { name: /Sachin — Crocodial activity/ }).waitFor();
    check(last().query.profileId === '11111111-1111-4111-8111-111111111111' && !state.calls.some(c => c.path === '/crocodial/me'), `${label}: a manager's view asks for that person (the database decides)`);
    await ctx.close();
  }
  console.log(`=== ${passed} CROCODIAL ACTIVITY BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
