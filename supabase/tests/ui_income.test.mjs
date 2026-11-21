// Browser test of the sales incentives screens (20270119000100, 20270121000100): "My Income" (tiles, the start date before incentives
// begin, target progress, the earnings list with reversed ones marked, the calls tile only for someone connected to Crocodial, phone
// width); Incentive setup (the Super Admin creates, edits, stops and deletes rules; a Team Lead entering more than they get sees the
// database's message and the kept share updates; a Department Head saves a 60% split); and the Business Associate's "authorised person
// attended" tick on a completed demo. The database and the API are stand-ins with synthetic data.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the Income browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/income_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/income_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;

// ---- the fake API (Crocodial and the Business Associate's demos) -----------------------------------------------------------------------
let api;
const reset = () => {
  api = { croc: false, calls: [], demo: { id: 'dm1', contactId: 'c1', title: 'Product demo', description: null, startsAt: '2026-11-19T05:00:00Z', endsAt: '2026-11-19T06:00:00Z',
    mode: 'ONLINE', location: 'Meet', meetingLink: null, assignedTo: 'ba1', assignee: 'Bina BA', internalNotes: null, status: 'COMPLETED', rescheduleCount: 0,
    feedback: 'Went well', followUpNotes: null, authorisedPersonAttended: false, client: 'Ravi Kumar', company: 'Kumar Stores' } };
};
reset();
const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
function handle(req, res) {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/^\/api\/v1/, '');
  api.calls.push(p);
  if (p === '/crocodial/me') return ok(res, { enabled: api.croc });
  if (p === '/crocodial/activity') return ok(res, { enabled: true, available: true, calls: { made: 42, connected: 30, connectRate: 71, talkSeconds: 5400, incoming: 2, missed: 1, uniqueLeads: 20 } });
  if (p === '/ba/demos') return ok(res, [api.demo]);
  res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'no fake' } }));
}
const srv = createServer((req, res) => {
  if (req.url.startsWith('/api/v1/')) return handle(req, res);
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
const errors = [];
const open = async (mount, arg, { width = 1280, before } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(base);
  if (before) await page.evaluate(before);
  await page.evaluate(([m, a]) => window[m](a), [mount, arg]);
  return { ctx, page };
};
const calls = (page, fn) => page.evaluate(f => window.__calls.filter(c => c.fn === f).map(c => c.args), fn);
try {
  // 1. My Income: tiles, target, list with the reversed earning marked; no calls tile without Crocodial
  let { ctx, page } = await open('mountIncome');
  await page.getByText('Acme Traders', { exact: false }).waitFor();
  const tiles = await page.getByRole('region', { name: 'Earnings', exact: true }).innerText();
  check(tiles.includes('₹50') && tiles.includes('₹100') && tiles.includes('₹1,250.5'), 'the tiles show today, this month, total and balance', tiles);
  check((await page.getByTestId('target-progress').innerText()) === '412 of 1,000', 'target progress reads "412 of 1,000"');
  const rows = page.getByTestId('earning-row');
  check(await rows.count() === 3, 'every earning is listed');
  check(await rows.nth(1).getByText('Reversed', { exact: false }).isVisible() && (await rows.nth(1).locator('.line-through').count()) > 0, 'a reversed earning is struck through and marked');
  check(await rows.nth(1).getByText('Team Lead share', { exact: false }).isVisible(), 'each earning says what it was for');
  check(!(await page.getByText('Calls this month').count()), 'no calls tile for someone not connected to Crocodial');
  check(!(await page.getByText('Incentives start on').count()), 'no start-date notice once eligible');
  await ctx.close();

  // 2. before the start date, with Crocodial connected, at phone width
  api.croc = true;
  ({ ctx, page } = await open('mountIncome', undefined, { width: 375, before: () => { window.__state.eligible = false; } }));
  await page.getByText('Incentives start on').waitFor();
  check((await page.getByRole('status').filter({ hasText: 'Incentives start on' }).innerText()).includes('5 Dec 2026'), 'before eligibility the page shows "Incentives start on 5 Dec 2026"');
  await page.getByText('Calls this month').waitFor();
  check((await page.getByText('30 connected', { exact: false }).innerText()).includes('1h 30m'), 'the calls tile shows calls and talk time when connected');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'nothing overflows at 375 px');
  await ctx.close();
  api.croc = false;

  // 3. Super Admin: create the ₹500 rule... the form refuses without a product (server message), then creates, edits, stops, deletes
  ({ ctx, page } = await open('mountSetup', 'sa'));
  await page.getByRole('button', { name: 'New rule' }).click();
  const form = page.getByRole('form', { name: 'New rule' });
  await form.getByLabel('Name', { exact: true }).fill('Website 500');
  await form.getByLabel('Product').selectOption('WEB');
  await form.getByLabel('Amount per unit for the Operations Head (₹)').fill('500');
  await form.getByLabel('Operations Head', { exact: true }).selectOption({ label: 'Omkar Ops' });
  await form.getByLabel('Target units (optional, a goal only)').fill('100');
  await form.getByRole('button', { name: 'Create rule' }).click();
  await page.getByText('Rule created.').waitFor();
  const created = (await calls(page, 'incentive_rule_create'))[0].p;
  check(created.amount === 500 && created.serviceCode === 'WEB' && created.scopeType === 'OPERATIONS_HEAD' && created.targetUnits === 100, 'the Super Admin creates the ₹500 rule for the Operations Head', JSON.stringify(created));
  check(await page.getByTestId('rule-row').filter({ hasText: 'Website 500' }).count() === 1, 'the new rule is listed');

  // edit the name only: in place
  await page.getByRole('button', { name: 'Edit Website 500' }).click();
  let edit = page.getByRole('form', { name: 'Edit rule' });
  await edit.getByLabel('Name', { exact: true }).fill('Website 500 renamed');
  check(!(await edit.getByText('applies from now on').count()), 'renaming does not warn about a new version');
  await edit.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Saved.', { exact: true }).waitFor();
  let upd = (await calls(page, 'incentive_rule_update')).at(-1);
  check(!('amount' in upd.p) && upd.p.name === 'Website 500 renamed', 'a rename sends only the in-place fields', JSON.stringify(upd));

  // edit the amount: applies from now on
  await page.getByRole('button', { name: 'Edit Website 500 renamed' }).click();
  edit = page.getByRole('form', { name: 'Edit rule' });
  await edit.getByLabel('Amount per unit for the Operations Head (₹)').fill('450');
  await edit.getByText('This change applies from now on', { exact: false }).waitFor();
  await edit.getByRole('button', { name: 'Save' }).click();
  await page.getByText('The new amount applies from now on', { exact: false }).waitFor();
  upd = (await calls(page, 'incentive_rule_update')).at(-1);
  check(upd.p.amount === 450, 'a new amount is sent as a change that applies from now on');
  check(await page.getByTestId('rule-row').filter({ hasText: '₹450' }).count() === 1 && await page.getByTestId('rule-row').filter({ hasText: '₹500' }).filter({ hasText: 'Website' }).count() === 0, 'the old version leaves the active list');

  // moving a sales rule to another product warns that the amounts must be passed down again
  await page.getByRole('button', { name: 'Edit WA 500' }).click();
  edit = page.getByRole('form', { name: 'Edit rule' });
  await edit.getByLabel('Product').selectOption('WEB');
  const note = await edit.getByTestId('replace-note').innerText();
  check(note.includes('every level must set its amounts again') && !note.includes('keeping the amounts already passed down'), 'a product change says the amounts must be set again', note);
  await edit.getByLabel('Product').selectOption('WA_API');
  await edit.getByLabel('Amount per unit for the Operations Head (₹)').fill('520');
  check((await edit.getByTestId('replace-note').innerText()).includes('keeping the amounts already passed down'), 'an amount change on the same product keeps the amounts passed down');
  await edit.getByRole('button', { name: 'Cancel' }).click();

  // a rule whose Operations Head has left can still be renamed; clearing its target sends null
  await page.getByRole('button', { name: 'Edit Old OH rule' }).click();
  edit = page.getByRole('form', { name: 'Edit rule' });
  check((await edit.getByLabel('Operations Head', { exact: true }).inputValue()) === 'oh-gone', 'the departed Operations Head stays selected');
  await edit.getByLabel('Name', { exact: true }).fill('Old OH rule renamed');
  await edit.getByLabel('Target units (optional, a goal only)').fill('');
  await edit.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Saved.', { exact: true }).waitFor();
  upd = (await calls(page, 'incentive_rule_update')).at(-1);
  check(upd.p.name === 'Old OH rule renamed' && upd.p.targetUnits === null && !('monthlyCap' in upd.p) && !('amount' in upd.p), 'renaming it works and clearing the target sends null (and no cap)', JSON.stringify(upd));

  // delete: a rule with earnings is stopped; a fresh one is removed
  await page.getByRole('button', { name: 'Delete WA 500' }).click();
  await page.getByText('had earnings, so it was stopped instead of deleted', { exact: false }).waitFor();
  check(await page.getByTestId('rule-row').filter({ hasText: 'WA 500' }).count() === 0, 'a rule with earnings is stopped (it leaves the active list)');
  await page.getByLabel('Show stopped rules').check();
  check(await page.getByTestId('rule-row').filter({ hasText: 'WA 500' }).filter({ hasText: 'Stopped' }).count() === 1, 'stopped rules are shown on request');
  await page.getByLabel('Show stopped rules').uncheck();
  await page.getByRole('button', { name: 'Delete Website 500 renamed' }).click();
  await page.getByText('"Website 500 renamed" deleted.').waitFor();
  check((await calls(page, 'incentive_rule_delete')).length === 2, 'each delete asks the database (it decides delete or stop)');

  // start-after days
  await page.getByLabel('Days in the company').fill('20');
  await page.getByRole('region', { name: 'When incentives start' }).getByRole('button', { name: 'Save' }).click();
  await page.getByRole('region', { name: 'When incentives start' }).getByText('Saved.').waitFor();
  check((await calls(page, 'incentive_settings_set'))[0].p_days === 20, 'the Super Admin sets the 15-day rule to 20 days');
  await ctx.close();

  // 4. Team Lead: more than they get is refused with the database's message; the kept share follows the amount
  ({ ctx, page } = await open('mountSetup', 'tl'));
  const row = page.getByRole('region', { name: 'WhatsApp API: WA 500' }).getByTestId('given-row').filter({ hasText: 'Meera Member' });
  await row.waitFor();
  check((await row.getByTestId('kept').innerText()) === '₹50', 'the Team Lead keeps 150 - 100 = ₹50');
  await row.getByLabel('Amount for Meera Member').fill('200');
  check((await row.getByTestId('kept').innerText()) === '-₹50', 'the kept share updates as the amount is typed');
  await row.getByRole('button', { name: 'Save' }).click();
  await row.getByRole('alert').waitFor();
  check((await row.getByRole('alert').innerText()).includes('cannot be more than you get'), "entering more than they get shows the database's message");
  await row.getByLabel('Amount for Meera Member').fill('120');
  await row.getByRole('button', { name: 'Save' }).click();
  await row.getByText('Saved.').waitFor();
  check((await row.getByTestId('kept').innerText()) === '₹30', 'after saving 120 the Team Lead keeps ₹30');
  check(!(await page.getByRole('region', { name: 'Telecaller and Business Associate split' }).count()), 'a Team Lead does not set the split');
  check(!(await page.getByRole('button', { name: 'New rule' }).count()), 'a Team Lead cannot create rules');
  await ctx.close();

  // 5. Department Head: the split
  ({ ctx, page } = await open('mountSetup', 'dh'));
  const split = page.getByRole('region', { name: 'Telecaller and Business Associate split' });
  await split.waitFor();
  await split.getByLabel("Telecaller's share (%)").fill('60');
  check((await split.getByTestId('ba-share').innerText()) === '40%', 'the Business Associate share shows 40%');
  await split.getByRole('button', { name: 'Save' }).click();
  await split.getByText('Saved.').waitFor();
  check((await calls(page, 'incentive_split_set'))[0].p_telecaller_pct === 60, 'the Department Head saves a 60% split');
  await ctx.close();

  // 6. Business Associate: tick "authorised person attended" on a completed demo
  ({ ctx, page } = await open('mountDemos'));
  await page.getByRole('tab', { name: /Completed Demos/ }).click().catch(async () => { await page.getByRole('button', { name: /Completed Demos/ }).click(); });
  await page.getByRole('button', { name: 'Open the demo Product demo for Ravi Kumar' }).click();
  const tick = page.getByLabel("The client's authorised person attended");
  check(!(await tick.isChecked()), 'the tick starts unticked');
  await tick.check();
  await page.waitForFunction(() => window.__calls.some(c => c.fn === 'ba_demo_set_authorised'));
  const a = (await calls(page, 'ba_demo_set_authorised'))[0];
  check(a.p_demo === 'dm1' && a.p_attended === true && await tick.isChecked(), 'the Business Associate ticks a completed demo');
  await ctx.close();

  check(errors.length === 0, 'no page errors', errors.join('\n'));
} finally {
  await browser.close();
  srv.close();
}
console.log(`${passed} passed`);
