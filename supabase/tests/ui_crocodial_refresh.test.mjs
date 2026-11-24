// Browser test of the scoped Crocodial refresh (20270204000100): "Refresh My Data" for an employee, "Refresh My Team" for a Team Lead,
// "Refresh Selected Department" / "Refresh My Departments" for an Operations Head; the request names only a scope (never a person), the
// button follows the request and says "up to date" only when the read has finished, the figures reload, a token problem is reported
// without details, and an employee without a mapping is told so. Desktop and phone width. The API is a fake.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Crocodial refresh browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/crocodial_refresh_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

// ---- the fake API -----------------------------------------------------------------------------------------------------------------------
const now = new Date().toISOString();
const old = new Date(Date.now() - 20 * 60_000).toISOString();
const D1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', D2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let state;
const CAPS = {
  employee: { kind: 'EMPLOYEE', active: true, rollout: true, self: { state: 'CONNECTED', lastSyncAt: old }, team: null, departments: [], all: null, recent: null },
  unmapped: { kind: 'EMPLOYEE', active: true, rollout: true, self: { state: 'NOT_MAPPED' }, team: null, departments: [], all: null, recent: null },
  elsewhere: { kind: 'EMPLOYEE', active: true, rollout: false, self: { state: 'NOT_MAPPED' }, team: null, departments: [], all: null, recent: null },
  lead: { kind: 'TEAM_LEAD', active: true, rollout: true, self: { state: 'NOT_MAPPED' }, team: { people: 2 }, departments: [], all: null, recent: null },
  ops: { kind: 'OPERATIONS_HEAD', active: true, rollout: false, self: { state: 'NOT_MAPPED' }, team: null,
    departments: [{ departmentId: D1, name: 'M Pillar', people: 2, lastSyncAt: old }, { departmentId: D2, name: 'D Talk', people: 1, lastSyncAt: old }], all: { people: 3 }, recent: null }
};
const reset = (who, finalState = 'UP_TO_DATE') => { state = { caps: CAPS[who], calls: [], posts: [], polls: 0, finalState, activityLoads: 0 }; };
reset('employee');
const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
const fail = (res, code, message) => { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: { code, message } })); };
const request = (body, st, finished) => ({ id: 'req-1', scope: body.scope, departmentId: body.departmentId ?? null, people: 2, connections: 1, outcome: 'QUEUED',
  requestedAt: now, state: st, finished, lastSyncAt: finished && st === 'UP_TO_DATE' ? new Date().toISOString() : old });
const activity = () => ({ enabled: true, available: true, stale: false, lastSyncAt: old, timezone: 'Asia/Kolkata', from: null, to: null,
  person: { id: 'me', name: 'Sachin', role: 'TEAM_MEMBER', salesSubRole: 'TELECALLER' }, demos: { scheduled: 0, completed: 0, cancelled: 0, upcoming: 0 },
  calls: { made: 19, connected: 8, notConnected: 11, connectRate: 42.1, talkSeconds: 424, incoming: 0, missed: 0, uniqueLeads: 3, uniqueNumbers: 3 },
  followups: { scheduled: 0, completed: 0, completionRate: null, overdue: 0 }, leads: { assigned: 0, neverCalled: 0, followUpDue: 0 }, remarks: 0, daily: [], recentCalls: [], upcomingFollowups: [] });
const team = () => ({ connectedEmployees: 2, label: 'Crocodial Pilot — 2 connected employees', stage: 'PILOT', from: null, to: null, oldestSyncAt: old, anyStale: false, unavailable: 0,
  note: 'Totals cover only the connected employees listed here, not the whole department.', people: [], totals: null, teams: [], daily: [] });
let lastBody;
function api(req, res, body) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/^\/api\/v1/, '');
  state.calls.push({ method: req.method, path: p, query: Object.fromEntries(u.searchParams) });
  if (p === '/crocodial/refresh-capabilities') return ok(res, state.caps);
  if (p === '/crocodial/me') return ok(res, state.caps.self.state === 'CONNECTED' ? { enabled: true, connectionName: 'M Pillar', health: 'OK' } : { enabled: false });
  if (p === '/crocodial/activity') { state.activityLoads++; return ok(res, activity()); }
  if (p === '/crocodial/team-activity') return ok(res, team());
  if (p === '/crocodial/refresh' && req.method === 'POST') { state.posts.push(body); lastBody = body; return ok(res, request(body, 'REFRESH_QUEUED', false)); }
  if (p === '/crocodial/refresh/req-1') {
    state.polls++;
    return ok(res, state.polls < 2 ? request(lastBody, 'SYNCING', false) : request(lastBody, state.finalState, true));
  }
  return fail(res, 'NOT_FOUND', 'no fake');
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
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport, timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const msg = () => page.getByTestId('croc-refresh-message').first();

    // ---- an employee: Refresh My Data
    reset('employee');
    await page.goto(base);
    await page.evaluate(() => window.mountSelf());
    const btn = page.getByRole('button', { name: 'Refresh My Data' });
    await btn.waitFor();
    check(await page.getByTestId('croc-last-synced').first().getByText(/Last synced: 2\d minutes ago/).isVisible(), `${label}: employee: "Last synced" is shown`);
    const loadsBefore = state.activityLoads;
    await btn.click();
    await page.getByText(/Refresh requested|Refreshing Crocodial data/).waitFor();
    check(JSON.stringify(state.posts[0]) === '{"scope":"SELF"}', `${label}: the request names only the scope (no person, no Crocodial user)`, state.posts);
    check(!(await msg().getByText(/up to date/).count()) && await btn.isDisabled(), `${label}: no "up to date" while the read is queued or running; the button waits`);
    await page.getByText('Your Crocodial data is up to date.').waitFor({ timeout: 15_000 });
    check(state.polls >= 2, `${label}: the button followed the request until it finished`);
    await page.waitForTimeout(300);
    check(state.activityLoads > loadsBefore && await page.getByTestId('croc-last-synced').first().getByText(/just now/).isVisible(), `${label}: the figures reload and "Last synced" is current`);

    // a token problem: reported without details, the button is usable again
    reset('employee', 'TOKEN_MISSING');
    await page.goto(base);
    await page.evaluate(() => window.mountSelf());
    await page.getByRole('button', { name: 'Refresh My Data' }).click();
    await page.getByText(/connection needs the administrator/).waitFor({ timeout: 15_000 });
    check(!(await page.getByText(/CROCODIAL_TOKEN|secret/i).count()) && await page.getByRole('button', { name: 'Refresh My Data' }).isEnabled(),
      `${label}: a token problem is reported to the employee without details`);

    // not connected
    reset('unmapped');
    await page.goto(base);
    await page.evaluate(() => window.mountSelf());
    await page.getByTestId('croc-not-connected').waitFor();
    check(await page.getByText('Your Crocodial account is not connected to Amuwa CRM. Contact your administrator.').isVisible()
      && !(await page.getByRole('button', { name: /Refresh/ }).count()), `${label}: an employee without a mapping is told so, with no button`);
    reset('elsewhere');
    await page.goto(base);
    await page.evaluate(() => window.mountSelf());
    await page.waitForTimeout(500);
    check(!(await page.getByTestId('croc-not-connected').count()) && !(await page.getByTestId('crocodial-activity').count()), `${label}: outside the rollout nothing is shown`);

    // ---- a Team Lead: Refresh My Team
    reset('lead');
    await page.goto(base);
    await page.evaluate(() => window.mountTeam());
    await page.getByRole('button', { name: 'Refresh My Team' }).waitFor();
    check(await page.getByText(/My Team Crocodial Activity/).isVisible() && await page.getByTestId('croc-refresh-bar').getByText(/Connected employees: 2/).isVisible()
      && !(await page.getByRole('button', { name: 'Refresh My Data' }).count()), `${label}: Team Lead: team count, Refresh My Team, no Refresh My Data without a mapping`);
    await page.getByRole('button', { name: 'Refresh My Team' }).click();
    await page.getByText('Your team’s Crocodial data is up to date.').waitFor({ timeout: 15_000 });
    check(JSON.stringify(state.posts[0]) === '{"scope":"TEAM"}', `${label}: Team Lead: the request is the TEAM scope only`, state.posts);

    // ---- an Operations Head: departments
    reset('ops');
    await page.goto(base);
    await page.evaluate(() => window.mountTeam());
    await page.getByRole('button', { name: 'Refresh My Departments' }).waitFor();
    check(await page.getByText(/Operations Crocodial Activity/).isVisible() && await page.getByText(/Authorized departments: 2 · Connected employees: 3/).isVisible(),
      `${label}: Operations Head: departments and connected employees from approved mappings`);
    await page.getByLabel('Department').selectOption(D2);
    await page.getByRole('button', { name: 'Refresh Selected Department' }).waitFor();
    await page.waitForTimeout(300);
    const lastTeam = [...state.calls].reverse().find(c => c.path === '/crocodial/team-activity');
    check(lastTeam.query.departmentId === D2, `${label}: choosing a department filters the figures`, lastTeam.query);
    await page.getByRole('button', { name: 'Refresh Selected Department' }).click();
    await page.getByText('This department’s Crocodial data is up to date.').waitFor({ timeout: 15_000 });
    check(JSON.stringify(state.posts[0]) === JSON.stringify({ scope: 'DEPARTMENT', departmentId: D2 }), `${label}: Refresh Selected Department sends that department (checked by the database)`, state.posts);
    state.polls = 0;
    await page.getByRole('button', { name: 'Refresh My Departments' }).click();
    await page.getByText('Crocodial data for your departments is up to date.').waitFor({ timeout: 15_000 });
    check(JSON.stringify(state.posts[1]) === '{"scope":"ALL"}', `${label}: Refresh My Departments`, state.posts);
    check(errors.length === 0, `${label}: no script errors`, errors);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: the page does not scroll sideways`);
    await ctx.close();
  }
  console.log(`=== ${passed} CROCODIAL REFRESH BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
