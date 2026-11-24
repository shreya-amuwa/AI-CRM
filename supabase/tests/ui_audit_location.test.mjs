// Browser test of two screens: the Super Admin's Departments page (no lock controls; every department opens, even one the database
// still flags as locked) and Security & Audit Logs (Location column, details, fallback for older events, filters, layout on phone / desktop).
// The real components and the app's real stylesheet (npm run build first); the contexts and the API are stand-ins that follow the real
// contract. Skipped, loudly, when Playwright, Chromium or dist/ are missing.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the audit location browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const cssFile = existsSync(cssDir) ? readdirSync(cssDir).find(f => /^index-.*\.css$/.test(f)) : null;
if (!cssFile) { console.log('SKIPPED - dist/ is not built (npm run build), the audit location browser test did not run'); process.exit(0); }
const css = readFileSync(path.join(cssDir, cssFile), 'utf8');

const stub = path.resolve('supabase/tests/ui/audit_location_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/audit_location_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error', loader: { '.css': 'empty' },
  define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'stub-contexts', setup(b) { b.onResolve({ filter: /\/context\/(AuthContext|DepartmentContext|TabContext)$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }

const setup = (role) => {
  window.__user = { role };
  window.__entered = [];
  const mk = (id, name, locked) => ({ id, name, description: '', iconName: 'Building2', accentColor: '#2563eb', totalLeads: 0, activeSessions: 0, maxSessions: 2, locked, createdAt: '2026-01-01' });
  window.__departments = [mk('whatsbox', 'Whatsbox', false), mk('wabastar', 'Wabastar', true), mk('accounts', 'Accounts Department', false)];
  const row = (id, over) => ({ id, at: '2026-10-28T09:58:18.851473+00:00', action: 'SESSION_STARTED', entityType: 'session', entityId: null, outcome: 'SUCCESS', actorId: 'u1', actor: 'Member A <a@amuwa.com>', actorRole: 'TEAM_MEMBER', departmentId: 'd1', department: 'Wabastore', requestId: `req-${id}-aaaaaaaaaaaa`, ip: null, location: null, metadata: {}, ...over });
  const all = [
    row(5, { ip: '203.0.113.50', location: { country: 'India', region: 'MH', city: 'Pune', latitude: 18.52, longitude: 73.86, source: 'PLATFORM_IP', accuracy: 'CITY' } }),
    row(4, { action: 'LOGIN_ATTEMPT_FAILED', entityType: 'auth', outcome: 'FAILURE', actorId: null, actor: null, actorRole: null, department: null, ip: '198.51.100.7', location: { country: 'India', region: null, city: null, latitude: null, longitude: null, source: 'PLATFORM_IP', accuracy: 'COUNTRY' }, metadata: { identifier: 's***@example.com', identifierVerified: false } }),
    row(3, { ip: '203.0.113.9', location: { country: 'India', region: 'KA', city: 'Bengaluru', latitude: 12.97, longitude: 77.59, source: 'IP_PROVIDER', accuracy: 'CITY' } }),
    row(2, { action: 'SESSION_STARTED' }),
    row(1, { action: 'DEPARTMENT_UPDATED', entityType: 'department', actorRole: 'SUPER_ADMIN', actor: 'Root <root@amuwa.com>', department: null, metadata: { name: 'Whatsbox' } })
  ];
  window.__calls = [];
  const json = (data) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  window.fetch = async (url) => {
    const u = new URL(url, 'http://localhost');
    window.__calls.push(`${u.pathname}${u.search}`);
    if (u.pathname.endsWith('/audit-logs/actions')) return json(['DEPARTMENT_UPDATED', 'LOGIN_ATTEMPT_FAILED', 'SESSION_STARTED']);
    if (u.pathname.endsWith('/audit-logs/search')) {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const action = u.searchParams.get('action');
      const outcome = u.searchParams.get('outcome');
      const items = all.filter(e => (!action || e.action === action) && (!outcome || e.outcome === outcome)
        && (!q || [e.action, e.actor, e.requestId, e.location && [e.location.city, e.location.region, e.location.country].filter(Boolean).join(' ')].some(v => (v || '').toLowerCase().includes(q))));
      return json({ items, total: items.length, page: 1, pageSize: 25 });
    }
    return new Response(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'no' } }), { status: 404 });
  };
};

const open = async (which, role, vp) => {
  const page = await browser.newPage({ viewport: vp });
  page.on('pageerror', e => console.log('pageerror:', e.message.slice(0, 300)));
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div>`);
  await page.evaluate(setup, role);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(w => window.mount(w), which);
  return page;
};

// --- Departments page: no lock anywhere
{
  const page = await open('departments', 'superadmin', { width: 1280, height: 900 });
  await page.waitForSelector('text=Wabastar');
  const text = (await page.evaluate(() => document.body.innerText)).toLowerCase();
  check(!/\block(ed)?\b|\bunlock(ed)?\b/.test(text), 'the Departments page shows no Lock / Unlock / Locked / Unlocked text', text.slice(0, 300));
  check((await page.$$('[aria-label^="Lock "], [aria-label^="Unlock "], [title*="ock department"]')).length === 0, 'and no lock or unlock button');
  check(await page.evaluate(() => !document.querySelector('svg.lucide-lock, svg.lucide-unlock, svg.lucide-lock-open')), 'and no lock icon');
  const enters = await page.$$('button:has-text("Enter Panel")');
  check(enters.length === 3, 'every department, including one the database still flags as locked, has an Enter Panel button', enters.length);
  await enters[1].click();
  check(JSON.stringify(await page.evaluate(() => window.__entered)) === '["wabastar"]', 'and the Super Admin enters it (no "locked" refusal)');
  check(await page.isVisible('text=Add Department'), 'adding a department is still there');
  await page.close();
}

// --- Security & Audit Logs
for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 360, height: 740 }]]) {
  const page = await open('audit', 'superadmin', vp);
  await page.waitForSelector('tbody tr');
  const heads = await page.$$eval('thead th', t => t.map(x => x.textContent.trim()));
  check(JSON.stringify(heads) === JSON.stringify(['When', 'Who', 'Event', 'About', 'Outcome', 'Location', 'Request']), `${name}: the columns keep the design and gain Location`, heads);
  const cells = await page.$$eval('tbody tr', trs => trs.map(t => t.children[5].textContent.replace(/\s+/g, ' ').trim()));
  check(cells[0].startsWith('Pune, MH, India') && cells[0].includes('approximate'), `${name}: a located sign-in shows "City, Region, Country"`, cells);
  check(cells[1].startsWith('India') && cells[3] === 'Unavailable' && cells[4] === '-', `${name}: country only, "Unavailable" for an older sign-in, "-" for events that have no place`, cells);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
  check(m.sw <= m.iw, `${name}: the page does not scroll sideways (the table scrolls inside its box)`, m);
  await page.click('tbody tr:first-child button:has-text("Session started")');
  await page.waitForSelector('[role="dialog"]');
  const d = (await page.textContent('[role="dialog"]')).replace(/\s+/g, ' ');
  check(/Location\s*Pune, MH, India/.test(d) && /City level, approximate/.test(d) && /Hosting platform IP lookup/.test(d) && /18\.52, 73\.86/.test(d) && /203\.0\.113\.50/.test(d) && /not the person.s exact position/.test(d) && /UTC/.test(d), `${name}: the details show the place, source, accuracy, approximate coordinates, address and UTC time`, d);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  // search by place
  await page.fill('input[placeholder*="place"]', 'bengaluru');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
  check(/Bengaluru/.test(await page.textContent('tbody tr')), `${name}: searching a place finds the event`);
  await page.fill('input[placeholder*="place"]', '');
  await page.selectOption('select >> nth=0', 'LOGIN_ATTEMPT_FAILED');
  // the cleared place search applies after its typing pause: wait for the filtered table itself, not for any single row (the "no events" row is one too)
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1 && /Failed/.test(document.querySelector('tbody tr')?.textContent || ''), null, { timeout: 5000 }).catch(() => undefined);
  check(/Failed/.test(await page.textContent('tbody tr')), `${name}: the event-type filter still works`);
  await page.selectOption('select >> nth=0', '');
  await page.selectOption('select >> nth=1', 'FAILURE');
  await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
  check(true, `${name}: the outcome filter still works`);
  await page.close();
}
// an older event opened in the details
{
  const page = await open('audit', 'superadmin', { width: 1280, height: 900 });
  await page.waitForSelector('tbody tr');
  await page.click('tbody tr:nth-child(4) button');
  await page.waitForSelector('[role="dialog"]');
  const d = (await page.textContent('[role="dialog"]')).replace(/\s+/g, ' ');
  check(/Location\s*Unavailable/.test(d) && /Address\s*Unavailable/.test(d), 'an older sign-in opens with "Unavailable" for address and location, not a blank or a guess', d);
  await page.close();
}
// anyone but the Super Admin: no Location column, no place in the details
{
  const page = await open('audit', 'hr', { width: 1280, height: 900 });
  await page.waitForSelector('tbody tr');
  const heads = await page.$$eval('thead th', t => t.map(x => x.textContent.trim()));
  check(!heads.includes('Location'), 'a Department Head or other role gets no Location column', heads);
  check(await page.getAttribute('input[type=text], input:not([type])', 'placeholder') === 'Person, event or request id', 'and the search box does not promise places');
  await page.click('tbody tr:first-child button');
  await page.waitForSelector('[role="dialog"]');
  const d = (await page.textContent('[role="dialog"]')).replace(/\s+/g, ' ');
  check(!/Location|Address|Coordinates/.test(d), 'nor in the details', d);
  await page.close();
}
await browser.close();
console.log(`=== AUDIT LOCATION BROWSER TESTS PASSED (${passed}) ===`);
