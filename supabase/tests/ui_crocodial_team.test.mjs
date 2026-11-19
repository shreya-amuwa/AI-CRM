// Browser test of the Crocodial management view (20270115000400): the pilot label and its note, totals, a person not synced shown as
// "not available", the period filter, opening one person's activity, and no one connected, at desktop and phone width. The API is a fake.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Crocodial management browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/crocodial_team_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

// ---- the fake API -----------------------------------------------------------------------------------------------------------------------
const now = new Date().toISOString();
const SACHIN = '11111111-1111-4111-8111-111111111111';
let state;
const reset = () => { state = { empty: false, calls: [] }; };
reset();
const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
const person = (id, name, team, made, conn, extra = {}) => ({ profileId: id, name, role: 'TEAM_MEMBER', salesSubRole: 'TELECALLER', teamId: 't1', teamName: team,
  departmentId: 'd', departmentName: 'M Pillar', available: true, stale: false, lastSyncAt: now,
  calls: { made, connected: conn, connectRate: made ? Math.round(1000 * conn / made) / 10 : null, talkSeconds: conn * 60, incoming: 0, missed: 0, uniqueLeads: made },
  followups: { scheduled: 2, completed: 1, completionRate: 50, overdue: 1 }, demos: { scheduled: 1, completed: 1, cancelled: 0, upcoming: 0 }, ...extra });
function team(q) {
  if (state.empty) return { connectedEmployees: 0, label: 'Crocodial Pilot — 0 connected employees', stage: 'PILOT', from: null, to: null, oldestSyncAt: null, anyStale: false, unavailable: 0,
    note: 'Totals cover only the connected employees listed here, not the whole department.', people: [], totals: null, teams: [], daily: [] };
  return { connectedEmployees: 3, label: 'Crocodial Pilot — 3 connected employees', stage: 'PILOT', from: q.get('from'), to: q.get('to'), oldestSyncAt: now, anyStale: false, unavailable: 1,
    note: 'Totals cover only the connected employees listed here, not the whole department.',
    people: [person(SACHIN, 'Sachin', 'Sales', 19, 8), person('22222222-2222-4222-8222-222222222222', 'Supriya', 'Sales', 954, 534),
             { ...person('33333333-3333-4333-8333-333333333333', 'New Person', 'Sales', 0, 0), available: false, calls: null, followups: null }],
    totals: { made: 973, connected: 542, connectRate: 55.7, talkSeconds: 542 * 60, uniqueLeads: 973, followupsScheduled: 4, followupsCompleted: 2, followupsOverdue: 2, demosScheduled: 3, demosCompleted: 3 },
    teams: [{ teamId: 't1', teamName: 'Sales', people: 3, made: 973, connected: 542 }],
    daily: [{ day: '2026-11-18', made: 500, connected: 300 }, { day: '2026-11-19', made: 473, connected: 242 }] };
}
const activity = q => ({ enabled: true, available: true, stale: false, lastSyncAt: now, timezone: 'Asia/Kolkata', from: q.get('from'), to: q.get('to'),
  person: { id: q.get('profileId'), name: 'Sachin', role: 'TEAM_MEMBER', salesSubRole: 'TELECALLER' }, demos: { scheduled: 0, completed: 0, cancelled: 0, upcoming: 0 },
  calls: { made: 19, connected: 8, connectRate: 42.1, talkSeconds: 424, incoming: 11, missed: 11, uniqueLeads: 3 }, followups: { scheduled: 0, completed: 0, completionRate: null, overdue: 0 },
  leads: { assigned: 0, neverCalled: 0, followUpDue: 0 }, remarks: 1, daily: [], recentCalls: [], upcomingFollowups: [] });
function api(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/^\/api\/v1/, '');
  state.calls.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams), auth: req.headers.authorization || null });
  if (p === '/crocodial/team-activity') return ok(res, team(u.searchParams));
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
    reset();
    await page.goto(base);
    await page.evaluate(() => window.mount());
    await page.getByTestId('croc-team-table').waitFor();
    const last = p => [...state.calls].reverse().find(c => c.path === p);
    check(last('/crocodial/team-activity').auth === 'Bearer test-token', `${label}: read with the manager's session (the database decides who is listed)`);
    check(await page.getByText(/Crocodial Pilot — 3 connected employees/).first().isVisible()
      && await page.getByTestId('croc-team-note').getByText(/not the whole department/).isVisible(), `${label}: labelled as a pilot of 3 connected employees, not the whole department`);
    check(await page.getByTestId('croc-team-note').getByText(/1 not synced yet \(not counted\)/).isVisible(), `${label}: a person not synced yet is said to be left out of the totals`);
    check(await page.getByText('Connect rate 55.7%').isVisible() && await page.getByText('973', { exact: true }).isVisible(), `${label}: the totals`);
    check(await page.getByRole('row', { name: /New Person/ }).getByText('Not available yet (not synced)').isVisible(), `${label}: shown as not available, not zero`);
    check(await page.getByRole('img', { name: /Calls made per day, 2 days/ }).isVisible(), `${label}: a calls-per-day chart`);
    await page.getByRole('button', { name: 'Last 30 days' }).click();
    await page.waitForTimeout(300);
    const q = last('/crocodial/team-activity').query;
    check((new Date(q.to) - new Date(q.from)) / 86400000 === 29, `${label}: the period filter asks for 30 days`, q);
    await page.getByRole('button', { name: "Open Sachin's activity" }).click();
    await page.getByRole('heading', { name: /Sachin — Crocodial activity/ }).waitFor();
    check(last('/crocodial/activity').query.profileId === SACHIN, `${label}: drilling down asks for that person's activity (checked again by the database)`);
    await page.getByRole('button', { name: /All connected employees/ }).click();
    await page.getByTestId('croc-team-table').waitFor();
    check(errors.length === 0, `${label}: no script errors`, errors);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: the page does not scroll sideways (the table scrolls in its box)`);
    reset(); state.empty = true;
    await page.goto(base);
    await page.evaluate(() => window.mount());
    await page.getByTestId('croc-team-empty').waitFor();
    check(!(await page.getByTestId('croc-team-table').count()), `${label}: nobody connected: no table, no totals`);
    await ctx.close();
  }
  console.log(`=== ${passed} CROCODIAL MANAGEMENT BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
