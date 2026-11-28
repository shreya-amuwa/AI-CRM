// Browser test of a CEO's Crocodial Integration page (20270307000100, Tasks 7-9): the MD's page scoped to the connections the CEO manages.
// "Connect Crocodial" lists only the CEO's departments and sends them (never a server setting name); a refusal shows inline; the key is a
// password field, tested and saved by the server, cleared after saving and only ever shown as "•••• <last 4>"; every key answer has its copy;
// a connection the Managing Director switched off says so and has no "Switch on"; no rollout table and no MD-only calls; at desktop and 360px.
// The API is a fake in this test's server.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { answerAppDialogs, appDialogs } from './ui/appDialogs.mjs';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Crocodial CEO setup browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/meetings_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/crocodial_ceo_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

// ---- the fake API -----------------------------------------------------------------------------------------------------------------------
const DTALK = 'dddddddd-0000-4000-8000-000000000011';
const WABA = 'dddddddd-0000-4000-8000-000000000012';
const OFF = 'cccccccc-0000-4000-8000-0000000000f0';
const NEW = 'cccccccc-0000-4000-8000-000000000001';
const AARTI = { id: 'eeeeeeee-0000-4000-8000-0000000000a1', name: 'Aarti CEO' };
const KEY = 'crocodialkey-secret-abcd1234';
const FORBIDDEN = 'You can manage Crocodial only for departments you run.';
const MD_OFF = 'Switched off by the Managing Director. Ask the Managing Director to switch it back on.';
const now = new Date().toISOString();
const conn = (x) => ({ externalAccountLabel: null, credentialRef: null, credentialConfigured: x.keySource === 'DATABASE', enabled: false, health: 'UNKNOWN', lastError: null,
  lastAttemptAt: null, lastSuccessAt: null, timezone: null, createdAt: now, updatedAt: now, mdDisabledAt: null, keySource: 'NONE', keyLast4: null, managedBy: [AARTI], ...x });
let state;
const reset = () => {
  state = {
    o: {
      rollout: [],
      departments: [{ id: DTALK, name: 'D Talk', slug: 'dtalk' }, { id: WABA, name: 'Wabastore', slug: 'wabastore' }],
      connections: [conn({ id: OFF, name: 'Old D Talk', mdDisabledAt: now, keySource: 'DATABASE', keyLast4: '9z9z', health: 'KEY_UNREADABLE', createdAt: '2027-01-01T00:00:00Z' })],
      departmentLinks: [{ id: 'llllllll-0000-4000-8000-0000000000f0', connectionId: OFF, departmentId: DTALK, departmentName: 'D Talk', division: 'SALES', enabled: false, stage: 'PILOT', updatedAt: now, mdDisabledAt: now }],
      mappings: [], externalEmployees: [], externalBranches: [], audit: []
    },
    calls: [],
    forbid: false,
    keyAnswer: 'OK'
  };
};
reset();
const ok = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
const fail = (res, status, code, message) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: { code, message } })); };
const KEY_FAIL = {
  REFUSED: [422, 'VALIDATION_ERROR', 'Crocodial refused this key.'],
  UNREACHABLE: [503, 'SERVICE_UNAVAILABLE', 'Crocodial could not be reached. Nothing was saved; try again.'],
  DUPLICATE: [409, 'CONFLICT', 'This Crocodial account is already connected (by another department).'],
  LIMIT: [429, 'RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.']
};

function api(req, res, body) {
  const p = new URL(req.url, 'http://x').pathname.replace(/^\/api\/v1/, '');
  state.calls.push({ method: req.method, path: p, body });
  const o = state.o;
  // the MD-only reads: a CEO's page must not depend on them (the real server refuses a CEO)
  if (state.md && p === '/crocodial/sync') return ok(res, []);
  if (state.md && p === '/crocodial/connection-health') return ok(res, { connections: [], departments: [], items: [] });
  if (p === '/crocodial/sync' || p === '/crocodial/connection-health' || p === '/crocodial/rollout') return fail(res, 403, 'FORBIDDEN', 'Only the Super Admin can do this.');
  if (p === '/crocodial/admin') return ok(res, o);
  if (p === '/crocodial/connections' && req.method === 'POST') {
    if (state.forbid) return fail(res, 403, 'FORBIDDEN', FORBIDDEN);
    let c = o.connections.find(x => x.id === body.id);
    if (c && body.enabled && c.mdDisabledAt) return fail(res, 409, 'CONFLICT', MD_OFF);
    if (!c) {
      c = conn({ id: NEW, name: body.name });
      o.connections.push(c);
      for (const d of body.departmentIds ?? []) o.departmentLinks.push({ id: `link-${d}`, connectionId: NEW, departmentId: d, departmentName: o.departments.find(x => x.id === d)?.name, division: 'SALES', enabled: false, stage: 'PILOT', updatedAt: now, mdDisabledAt: null });
    }
    if (body.enabled === false && !c.mdDisabledAt && state.md) c.mdDisabledAt = now;
    if (body.enabled === true) c.mdDisabledAt = null;
    Object.assign(c, { name: body.name, externalAccountLabel: body.externalAccountLabel ?? null, enabled: body.enabled ?? c.enabled });
    return ok(res, c);
  }
  const k = p.match(/^\/crocodial\/connections\/([^/]+)\/key$/);
  if (k && req.method === 'POST') {
    if (state.keyAnswer !== 'OK') { const [s, code, msg] = KEY_FAIL[state.keyAnswer]; return fail(res, s, code, msg); }
    const c = o.connections.find(x => x.id === k[1]);
    Object.assign(c, { keySource: 'DATABASE', keyLast4: body.key.slice(-4), health: 'OK', credentialConfigured: true });
    return ok(res, { ok: true, last4: body.key.slice(-4), users: 23 });
  }
  if (k && req.method === 'DELETE') {
    const c = o.connections.find(x => x.id === k[1]);
    Object.assign(c, { keySource: 'NONE', keyLast4: null, enabled: false, credentialConfigured: false });
    return ok(res, c);
  }
  if (p === '/crocodial/department-links') {
    const l = o.departmentLinks.find(x => x.connectionId === body.connectionId && x.departmentId === body.departmentId);
    if (l && body.enabled && l.mdDisabledAt) return fail(res, 409, 'CONFLICT', MD_OFF);
    if (l) l.enabled = body.enabled;
    return ok(res, l);
  }
  if (p === '/users') return ok(res, { items: [], total: 0, page: 1, pageSize: 100 });
  if (/^\/crocodial\/connections\/[^/]+\/reconcile$/.test(p)) return ok(res, { departments: [], counts: {}, ownershipDiffers: 0, externalLeads: 0, missingAtSource: 0, unknownStatuses: [], mappings: [], unmappedAssignees: [], reconcile: null, resources: [], recentRuns: [] });
  if (p === '/lead-tags') return ok(res, []);
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
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 360, height: 800 }]]) {
    reset();
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => { errors.push('native dialog: ' + d.message()); d.dismiss(); });
    await answerAppDialogs(page);
    await page.goto(base);
    await page.evaluate(() => window.mount());
    await page.getByRole('heading', { name: 'Crocodial Integration' }).waitFor();
    await page.getByTestId('croc-connection').first().waitFor();
    await page.waitForTimeout(200);

    // no rollout table, no MD-only reads, no error screen
    check(!(await page.getByTestId('croc-rollout').count()) && !(await page.getByText('1. Rollout').count()), `${label}: no rollout table for a CEO`);
    check(!state.calls.some(c => ['/crocodial/sync', '/crocodial/connection-health', '/crocodial/rollout'].includes(c.path)), `${label}: the page does not call the MD-only endpoints`, state.calls.map(c => c.path));
    check(!(await page.getByText(/Only the Super Admin/).count()), `${label}: no MD-only refusal is shown`);

    // a connection the MD switched off: the exact copy, no "Switch on" (connection or link)
    const off = page.getByTestId('croc-connection').filter({ hasText: 'Old D Talk' });
    check(await off.getByText(MD_OFF, { exact: true }).first().isVisible(), `${label}: an MD-disabled connection shows the exact copy`);
    check(!(await off.getByRole('button', { name: 'Switch on' }).count()), `${label}: and has no "Switch on" for the CEO (connection or its link)`);
    check(await off.getByText('Key needs to be entered again').first().isVisible() && await off.getByText('•••• 9z9z').isVisible(), `${label}: a key the server can no longer read asks to be entered again (last 4 only)`);

    // Connect Crocodial: only the CEO's departments, no server setting field
    await page.getByRole('button', { name: 'Connect Crocodial' }).click();
    const form = page.getByTestId('croc-connection-form');
    await form.waitFor();
    const depts = await form.getByRole('checkbox').evaluateAll(l => l.map(x => x.closest('label').innerText.trim()));
    check(JSON.stringify(depts) === JSON.stringify(['D Talk', 'Wabastore']), `${label}: "Connect Crocodial" lists only the CEO's departments`, depts);
    check(!(await page.getByLabel(/Server setting/).count()), `${label}: a CEO is not asked for a server setting name`);
    await form.getByLabel('Connection name').fill('D Talk calling');
    await form.getByRole('checkbox', { name: 'D Talk' }).check();
    // a 403 answer is shown inline, in the form, with the FORBIDDEN text
    state.forbid = true;
    await form.getByRole('button', { name: 'Connect Crocodial' }).click();
    await form.getByRole('alert').getByText(FORBIDDEN, { exact: true }).waitFor();
    check(await form.isVisible(), `${label}: a 403 shows "${FORBIDDEN}" inline and the form stays`);
    state.forbid = false;
    await form.getByRole('button', { name: 'Connect Crocodial' }).click();
    const card = page.getByTestId('croc-connection').filter({ hasText: 'D Talk calling' });
    await card.waitFor();
    const saved = lastCall('POST', '/crocodial/connections').body;
    check(JSON.stringify(saved.departmentIds) === JSON.stringify([DTALK]) && !('credentialRef' in saved), `${label}: the connection is created with the chosen departments and no credential name`, saved);

    // the key: a password field; "Test and save"; cleared after saving; only the last 4 are shown
    const keyField = card.getByLabel('Crocodial key');
    check(await keyField.getAttribute('type') === 'password' && await keyField.getAttribute('autocomplete') === 'off', `${label}: the key field is a password field`);
    await keyField.fill(KEY);
    await card.getByRole('button', { name: 'Test and save' }).click();
    await card.getByText('Connected: 23 Crocodial users found').waitFor();
    check(lastCall('POST', `/crocodial/connections/${NEW}/key`).body.key === KEY, `${label}: "Test and save" sends the key to the server`);
    await card.getByText('•••• 1234').waitFor();
    check(!(await page.content()).includes(KEY) && !(await page.content()).includes('abcd1234'), `${label}: the key is never on the page after saving, only "•••• 1234"`);
    check(!(await card.getByLabel('Crocodial key').count()) || await card.getByLabel('Crocodial key').inputValue() === '', `${label}: the key field is cleared after saving`);
    await card.getByRole('button', { name: 'Replace key' }).click();
    check(await card.getByLabel('Crocodial key').inputValue() === '', `${label}: "Replace key" opens an empty field`);
    // each refusal has its copy (nothing saved)
    for (const [answer, copy] of [['REFUSED', 'Crocodial refused this key.'], ['UNREACHABLE', 'Crocodial could not be reached. Nothing was saved; try again.'],
      ['DUPLICATE', 'This Crocodial account is already connected (by another department).'], ['LIMIT', 'Too many attempts. Wait a few minutes and try again.']]) {
      state.keyAnswer = answer;
      await card.getByLabel('Crocodial key').fill('crocodialkey-other-9999');
      await card.getByRole('button', { name: 'Test and save' }).click();
      await card.getByRole('alert').getByText(copy, { exact: true }).waitFor();
      check(true, `${label}: ${answer.toLowerCase()}: "${copy}"`);
    }
    state.keyAnswer = 'OK';
    check(await card.getByText('•••• 1234').isVisible(), `${label}: a refused replacement keeps the saved key`);

    // the CEO switches their own connection on
    await card.getByRole('button', { name: 'Switch on' }).first().click();
    await card.getByText('On', { exact: true }).waitFor();
    check(lastCall('POST', '/crocodial/connections').body.enabled === true && !('credentialRef' in lastCall('POST', '/crocodial/connections').body), `${label}: a CEO switches the connection on (no credential name sent)`);

    // Disconnect, after a confirmation
    await card.getByRole('button', { name: 'Disconnect' }).click();
    await page.getByText('Disconnected: the key was removed and the connection switched off.').waitFor();
    await card.getByText(/No key yet/).waitFor();
    check(lastCall('DELETE', `/crocodial/connections/${NEW}/key`) && (await appDialogs(page)).some(d => /Disconnect/.test(d)), `${label}: "Disconnect" asks first, then removes the key`);

    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(wide <= 1, `${label}: no sideways scroll`, wide);
    check(errors.length === 0, `${label}: no script errors, no browser dialogs`, errors);
    await ctx.close();
  }

  // ---- the Managing Director's view of the same connections ----
  {
    reset();
    state.md = true;
    state.o.rollout = [{ departmentId: DTALK, departmentName: 'D Talk', allowed: true, stage: 'PILOT' }];
    state.o.connections.push(conn({ id: 'cccccccc-0000-4000-8000-0000000000a1', name: 'M Pillar Sales', credentialRef: 'CROCODIAL_MPILLAR', credentialConfigured: true, keySource: 'SERVER_SETTING', managedBy: [] }),
      conn({ id: 'cccccccc-0000-4000-8000-0000000000a2', name: 'D Talk live', keySource: 'DATABASE', keyLast4: '1a2b', health: 'OK', enabled: true, managedBy: [AARTI, { id: 'x2', name: 'Bela CEO' }] }),
      conn({ id: 'cccccccc-0000-4000-8000-0000000000a3', name: 'Unkeyed', keySource: 'NONE', managedBy: [AARTI] }));
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await answerAppDialogs(page);
    await page.goto(base);
    await page.evaluate(() => window.mount('MD'));
    await page.getByRole('heading', { name: 'Crocodial Integration' }).waitFor();
    await page.getByTestId('croc-connection').first().waitFor();
    await page.waitForTimeout(200);
    const card = n => page.getByTestId('croc-connection').filter({ hasText: n });
    check(await card('D Talk live').getByTestId('croc-managed-by').innerText().then(t => /Managed by/.test(t) && /Aarti CEO, Bela CEO/.test(t)), 'MD: "Managed by" lists the CEO names');
    check(/Managing Director only/.test(await card('M Pillar Sales').getByTestId('croc-managed-by').innerText()), 'MD: a connection no CEO manages says "Managing Director only"');
    check(await card('D Talk live').getByTestId('croc-key-source').innerText() === 'Key: Stored (•••• 1a2b)', 'MD: a stored key shows "Stored (•••• 1a2b)"');
    check(await card('M Pillar Sales').getByTestId('croc-key-source').innerText() === 'Key: Server setting', 'MD: a server-setting key shows "Server setting"');
    check(await card('Unkeyed').getByTestId('croc-key-source').innerText() === 'Key: No key', 'MD: no key shows "No key"');
    // the MD switches a connection off: the server marks it, the MD sees "Switched off by you"
    const dl = card('D Talk live');
    await dl.getByRole('button', { name: 'Switch off' }).first().click();
    await dl.getByText('Switched off by you', { exact: false }).first().waitFor();
    check(lastCall('POST', '/crocodial/connections').body.enabled === false, 'MD: "Switch off" sends enabled=false');
    check(await dl.getByRole('button', { name: 'Switch on' }).first().isVisible(), 'MD: the MD can switch it back on');
    check(!(await card('Unkeyed').getByText('Switched off by you').count()), 'MD: an item the MD did not switch off does not say so');
    check(errors.length === 0, 'MD: no script errors', errors);
    await ctx.close();
  }
  console.log(`=== ${passed} CROCODIAL CEO SETUP BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
  srv.close();
}
