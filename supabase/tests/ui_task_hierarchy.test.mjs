// Browser test of the Operations Head's Assign page (20261230000300): Department Heads only (with department and function), what is sent on assign,
// and the expandable Operations Head -> Department Head -> Team Lead -> Team Member chain. The database is answered in the page.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the task hierarchy browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/task_hierarchy_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/task_hierarchy_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;
const srv = createServer((req, res) => {
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base);
  await page.evaluate(() => window.mount());
  await page.waitForSelector('[data-testid="oh-assignee"] option:nth-child(3)', { state: 'attached' });
  const options = await page.$$eval('[data-testid="oh-assignee"] option', o => o.map(x => x.textContent));
  check(options.length === 3 && options[1] === 'Dev Head - Wabastore (Support)' && options[2] === 'Ria Head - Whatsbox (Whole department)',
    'the Operations Head is offered Department Heads with their department and function (no Team Lead)', options);
  check(await page.getByRole('button', { name: 'Assign to Department Head' }).isDisabled(), 'assigning needs a Department Head and a task');
  await page.selectOption('[data-testid="oh-assignee"]', { label: 'Dev Head - Wabastore (Support)' });
  await page.getByLabel('Task *').fill('Review all pending customer escalations');
  await page.getByRole('button', { name: 'Assign to Department Head' }).click();
  await page.getByText('Task assigned to Dev Head (Wabastore).').waitFor();
  const sent = await page.evaluate(() => window.__calls.find(c => c.fn === 'assign_task_to_department_head')?.args);
  check(sent && sent.p_assignee === 'dh' && sent.p_department === 'd-wab' && sent.p_division === 'SUPPORT' && sent.p_title === 'Review all pending customer escalations' && sent.p_priority === 'MEDIUM',
    'the task is sent for that head, department and function', sent);
  // the chain: the Department Head is open, the Team Leads below; the member appears when Tom Lead's level is opened
  check(await page.getByText('Tara Lead').isVisible() && await page.getByText('Working on it personally').isVisible(), 'the Team Lead who works on it personally is shown as such');
  check(await page.getByText('Take the WhatsApp escalations').isVisible(), "with the Department Head's instructions");
  check(!(await page.getByText('Mia Member').isVisible()), 'the Team Members are folded until opened');
  await page.getByRole('button', { name: 'Show 1 person below' }).click();
  check(await page.getByText('Mia Member').isVisible() && await page.getByText('Reply to 20 e-mails').isVisible() && await page.getByText(/Delegated by Tom Lead/).isVisible(),
    'opening the Team Lead shows the member, their share and who delegated it');
  check(errors.length === 0, 'no error in the page', errors);
  for (const vp of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(vp);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!overflow, `no sideways scroll at ${vp.width}px`);
  }
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== TASK HIERARCHY BROWSER TESTS PASSED (${passed}) ===`);
