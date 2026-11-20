// Browser test of Super Admin > Crocodial Integration (20270115000100): the rollout, a connection (the token is only a server setting's
// name), Test connection, linking M Pillar Sales, proposing a mapping with its checks, approving it, at desktop and phone width.
// The API is a fake in this test's server.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Crocodial browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/crocodial_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

// ---- the fake API -----------------------------------------------------------------------------------------------------------------------
const MP = 'dddddddd-0000-4000-8000-000000000001';
const SACHIN = 'eeeeeeee-0000-4000-8000-000000000001';
const SUPPORT = 'eeeeeeee-0000-4000-8000-000000000002';
const now = new Date().toISOString();
let state;
const reset = () => {
  state = {
    o: { rollout: [{ departmentId: MP, departmentName: 'M Pillar', departmentSlug: 'mpillar', division: 'SALES', allowed: true, note: 'Crocodial pilot', updatedAt: now }],
      connections: [], departmentLinks: [], mappings: [], externalEmployees: [], externalBranches: [], audit: [] },
    calls: [],
    synced: false
  };
};
reset();
const ok = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
const fail = (res, status, code, message) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: { code, message } })); };

function api(req, res, body) {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/api\/v1/, '');
  state.calls.push({ method: req.method, path: p, body, auth: req.headers.authorization || null, raw: req.url.replace(/^\/api\/v1\/users/, '') });
  const o = state.o;
  if (p === '/crocodial/admin') return ok(res, o);
  if (p === '/crocodial/sync') return ok(res, o.connections.map(c => ({ connectionId: c.id, syncable: c.enabled, lastManualSyncAt: null,
    resources: state.synced ? [{ resource: 'call-logs', checkpoint: now, lastFullAt: now, running: false, inProgress: false, lastRunAt: now, lastOkAt: now, lastError: null, rowsLastRun: 18387, skippedLastRun: 0 }] : [],
    counts: { leads: 234, calls: state.synced ? 18387 : 0, followups: 0, remarks: 0, missing: 0 },
    unmatched: { calls: state.synced ? 5714 : 0, followups: 0, leads: 0 },
    unmatchedByUser: state.synced ? [{ externalId: 340, name: null, calls: 5714 }] : [], recentRuns: [] })));
  const sy = p.match(/^\/crocodial\/connections\/([^/]+)\/sync$/);
  if (sy) { state.synced = true; return ok(res, { connections: [{ connectionId: sy[1], health: 'OK', resources: [{ resource: 'call-logs', outcome: 'DONE', pages: 37, rows: 18387, skipped: 0 }] }], requests: 42, note: null }); }
  if (p === '/crocodial/connections') {
    if (!/^CROCODIAL_TOKEN_[A-Z0-9_]{1,40}$/.test(body.credentialRef)) return fail(res, 422, 'VALIDATION_ERROR', 'Enter the NAME of the server setting that holds the token, like CROCODIAL_TOKEN_MPILLAR (never the token itself).');
    let c = o.connections.find(x => x.id === body.id);
    if (!c) { c = { id: 'cccccccc-0000-4000-8000-000000000001', health: 'UNKNOWN', lastError: null, lastAttemptAt: null, lastSuccessAt: null, timezone: null, createdAt: now, updatedAt: now, enabled: false }; o.connections.push(c); }
    Object.assign(c, { name: body.name, externalAccountLabel: body.externalAccountLabel, credentialRef: body.credentialRef, enabled: body.enabled ?? c.enabled, credentialConfigured: true });
    o.audit.unshift({ at: now, action: 'CROCODIAL_CONNECTION_CREATED', actorName: 'Root', entityId: c.id, metadata: {} });
    return ok(res, c);
  }
  const t = p.match(/^\/crocodial\/connections\/([^/]+)\/test$/);
  if (t) {
    o.connections[0].health = 'OK'; o.connections[0].lastSuccessAt = now; o.connections[0].timezone = 'Asia/Kolkata';
    o.externalEmployees = [{ connectionId: t[1], externalId: 371, name: 'Supriya Mpillar', isActive: true, branchIds: [121], lastSeenAt: now, missingSince: null, mappingStatus: null },
                           { connectionId: t[1], externalId: 4138, name: 'sachin', isActive: true, branchIds: [121], lastSeenAt: now, missingSince: null, mappingStatus: null }];
    return ok(res, { ok: true, health: 'OK', message: 'Connected. 2 employees and 1 branches read.', employees: 2, branches: 1, timezone: 'Asia/Kolkata', requests: 2 });
  }
  if (p === '/crocodial/department-links') {
    let l = o.departmentLinks.find(x => x.connectionId === body.connectionId && x.departmentId === body.departmentId);
    if (!l) { l = { id: 'llllllll-0000-4000-8000-000000000001', connectionId: body.connectionId, departmentId: body.departmentId, departmentName: 'M Pillar', division: 'SALES', stage: 'PILOT', updatedAt: now }; o.departmentLinks.push(l); }
    l.enabled = body.enabled;
    return ok(res, l);
  }
  // like the real API: at most 100 a page
  if (p === '/users' && Number(new URL(req.url, 'http://x').searchParams.get('pageSize')) > 100) return fail(res, 422, 'VALIDATION_ERROR', 'Number must be less than or equal to 100');
  if (p === '/users') return ok(res, { items: [{ id: SACHIN, fullName: 'Sachin Kumar', email: 'sachin@amuwa.com' }, { id: SUPPORT, fullName: 'Support Person', email: 'sp@amuwa.com' }], total: 2, page: 1, pageSize: 200 });
  if (p === '/crocodial/mappings/check') {
    const eligible = body.profileId === SACHIN;
    return ok(res, { profile: { profileId: body.profileId, name: eligible ? 'Sachin Kumar' : 'Support Person', status: 'ACTIVE', role: 'TEAM_MEMBER', salesSubRole: eligible ? 'TELECALLER' : null,
      departmentId: MP, departmentName: 'M Pillar', teamId: 't', teamName: eligible ? 'Sales' : 'Support', teamDivision: eligible ? 'SALES' : 'SUPPORT', active: true, inDepartment: true, inFunction: eligible, eligible },
      externalEmployee: { externalId: body.externalEmployeeId, name: body.externalEmployeeId === 4138 ? 'sachin' : 'Supriya Mpillar', isActive: true },
      externalAlreadyMapped: false, profileAlreadyMapped: false, departmentLinked: true });
  }
  if (p === '/crocodial/mappings') {
    const m = { id: 'mmmmmmmm-0000-4000-8000-000000000001', connectionId: body.connectionId, externalEmployeeId: body.externalEmployeeId, externalName: 'sachin', profileId: body.profileId,
      profileName: 'Sachin Kumar', departmentId: MP, departmentName: 'M Pillar', division: 'SALES', roleSnapshot: { role: 'TEAM_MEMBER', salesSubRole: 'TELECALLER' }, status: 'PENDING',
      approvedByName: null, approvedAt: null, effectiveFrom: null, endedAt: null, endReason: null, createdAt: now, live: false };
    o.mappings.push(m);
    o.externalEmployees.find(e => e.externalId === body.externalEmployeeId).mappingStatus = 'PENDING';
    return ok(res, m);
  }
  const a = p.match(/^\/crocodial\/mappings\/([^/]+)\/approve$/);
  if (a) { const m = o.mappings.find(x => x.id === a[1]); Object.assign(m, { status: 'APPROVED', approvedByName: 'Root', approvedAt: now, effectiveFrom: now, live: true }); return ok(res, m); }
  const cf = p.match(/^\/crocodial\/mappings\/([^/]+)\/count-from$/);
  if (cf) {
    const m = o.mappings.find(x => x.id === cf[1]);
    m.effectiveFrom = body.from ? `${body.from}T00:00:00+05:30` : '2026-06-01T00:00:00+05:30';
    o.audit.unshift({ at: now, action: 'CROCODIAL_MAPPING_COUNT_FROM_SET', actorName: 'Root', entityId: m.id, metadata: {} });
    return ok(res, m);
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: `No fake for ${req.method} ${p}` } }));
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
    reset();
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => d.accept());
    await page.goto(base);
    await page.evaluate(() => window.mount());
    await page.getByRole('heading', { name: 'Crocodial Integration' }).waitFor();
    check(await page.getByTestId('croc-rollout').getByText(/M Pillar · Sales/).isVisible() && await page.getByText('Allowed', { exact: true }).isVisible(), `${label}: the rollout shows M Pillar Sales only`);
    check(lastCall('GET', '/crocodial/admin').auth === 'Bearer test-token', `${label}: read with the signed-in session`);

    // a connection: a pasted token is refused, the setting name is kept
    await page.getByRole('button', { name: 'Add connection' }).click();
    await page.getByLabel('Connection name').fill('M Pillar');
    await page.getByLabel(/Crocodial account/).fill('M pillar corporation');
    await page.getByLabel(/Server setting that holds the token/).fill('rmd_abc-def');
    check(await page.getByLabel(/Server setting that holds the token/).inputValue() === 'RMD_ABCDEF', `${label}: the setting name field keeps only setting-name characters`);
    await page.getByRole('button', { name: 'Add connection' }).last().click();
    await page.getByRole('alert').getByText(/never the token itself/).waitFor();
    check(true, `${label}: a value that is not a CROCODIAL_TOKEN_ setting name is refused`);
    await page.getByLabel(/Server setting that holds the token/).fill('CROCODIAL_TOKEN_MPILLAR');
    await page.getByRole('button', { name: 'Add connection' }).last().click();
    await page.getByTestId('croc-connection').waitFor();
    check(lastCall('POST', '/crocodial/connections').body.credentialRef === 'CROCODIAL_TOKEN_MPILLAR', `${label}: the connection is saved with the setting name`);
    check(await page.getByText('(set on the server)').isVisible() && await page.getByText('Not tested yet').isVisible(), `${label}: it says the server has the setting, not tested yet`);

    // Test connection fills the Crocodial user list
    await page.getByTestId('croc-test').click();
    await page.getByTestId('croc-test-result').getByText(/Connected\. 2 employees/).waitFor();
    check(true, `${label}: Test connection reports what it read`);
    // link M Pillar Sales (stays off), then map Sachin
    await page.getByRole('button', { name: 'Link (stays off)' }).click();
    await page.getByText('Linked, off').waitFor();
    check(lastCall('POST', '/crocodial/department-links').body.enabled === false, `${label}: linking does not switch the department on`);
    await page.getByLabel('Crocodial user').selectOption('4138');
    await page.getByLabel(/CRM employee/).selectOption(SUPPORT);
    await page.getByTestId('croc-mapping-check').getByText('✗ Not Sales', { exact: false }).waitFor();
    check(await page.getByRole('button', { name: /Propose mapping/ }).isDisabled(), `${label}: someone outside Sales cannot be proposed`);
    const usersQ = new URL('http://x' + [...state.calls].reverse().find(c => c.path === '/users').raw).searchParams;
    check(Number(usersQ.get('pageSize')) <= 100 && !usersQ.has('division') && usersQ.get('departmentId') === MP,
      `${label}: the CRM employees of the department are loaded within the API's page limit (heads included: no team filter)`);
    await page.getByLabel(/CRM employee/).selectOption(SACHIN);
    await page.getByTestId('croc-mapping-check').getByText(/✓ Sales/).waitFor();
    check(await page.getByText(/Names are not proof of identity/).isVisible(), `${label}: the check reminds that names are not proof`);
    await page.getByRole('button', { name: /Propose mapping/ }).click();
    await page.getByText('Waiting for approval').waitFor();
    check(lastCall('POST', '/crocodial/mappings').body.externalEmployeeId === 4138 && lastCall('POST', '/crocodial/mappings').body.profileId === SACHIN, `${label}: the mapping is proposed with the Crocodial id and the CRM employee`);
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByText(/Approved by Root/).waitFor();
    check(lastCall('POST', '/crocodial/mappings/mmmmmmmm-0000-4000-8000-000000000001/approve'), `${label}: Approve asks the server`);
    check(await page.getByTestId('croc-audit').isVisible(), `${label}: the history is listed`);

    // earlier activity: count from the first stored record, or from a chosen day (audited)
    await page.getByTestId('croc-count-from').getByRole('button', { name: 'Count all past activity' }).click();
    await page.getByText(/past activity now counts/).waitFor();
    const all = lastCall('POST', '/crocodial/mappings/mmmmmmmm-0000-4000-8000-000000000001/count-from');
    check(all && all.body.from === null, `${label}: "Count all past activity" asks the server to count from the first stored record`, all?.body);
    check(await page.getByTestId('croc-count-from').getByText(/1 Jun 2026/).isVisible(), `${label}: the new start is shown`);
    check(await page.getByTestId('croc-audit').getByText(/activity start date changed · Root/).isVisible(), `${label}: and the change is in the history`);
    check(await page.getByTestId('croc-count-from').getByRole('button', { name: 'Use this date' }).isDisabled(), `${label}: a date must be chosen first`);
    await page.getByLabel("Count Sachin Kumar's activity from").fill('2026-09-01');
    await page.getByTestId('croc-count-from').getByRole('button', { name: 'Use this date' }).click();
    await page.getByText(/now counts from 2026-09-01/).waitFor();
    check(lastCall('POST', '/crocodial/mappings/mmmmmmmm-0000-4000-8000-000000000001/count-from').body.from === '2026-09-01', `${label}: or from a chosen day`);

    // sync: off until the connection is switched on; then Sync now, the counts and what is not attributed to anyone
    check(await page.getByText(/Not synced: the connection or its department is switched off/).isVisible() && await page.getByRole('button', { name: 'Sync now' }).isDisabled(),
      `${label}: a connection that is off is not synced`);
    await page.getByRole('button', { name: 'Switch on' }).first().click();
    await page.getByRole('button', { name: 'Sync now' }).and(page.locator(':not([disabled])')).waitFor();
    await page.getByRole('button', { name: 'Sync now' }).click();
    await page.getByText(/Sync: Call logs 18387 rows/).waitFor();
    check(lastCall('POST', `/crocodial/connections/${state.o.connections[0].id}/sync`), `${label}: Sync now asks the server`);
    check(await page.getByTestId('croc-sync').getByText(/18387 calls/).isVisible(), `${label}: what was stored is shown`);
    check(await page.getByTestId('croc-unmatched').getByText(/5714 calls/).first().isVisible() && await page.getByText(/id 340, not in the account’s user list/).isVisible(),
      `${label}: calls of an unmapped Crocodial user are shown as not attributed, never counted`);
    check(errors.length === 0, `${label}: no script errors`, errors);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: nothing runs off the screen`);
    await ctx.close();
  }
  console.log(`=== ${passed} CROCODIAL BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
