// Browser test of the paged feeds (src/components/common/Paged.tsx, src/client/ui.tsx ClientPaged): long recent-activity / history lists
// show one page (10, or 5 for recent activity) with the page buttons below, short lists show no buttons, and a list that shrinks
// never leaves an empty page.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the feed paging browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/task_hierarchy_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/feed_paging_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;
const srv = createServer((req, res) => {
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
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
  const rows = id => page.$$eval(`[data-testid="${id}"] li`, l => l.map(x => x.textContent));
  const box = id => page.getByTestId(id);

  // a long history: 10 per page, newest first, page buttons below
  let h = await rows('history');
  check(h.length === 10 && h[0] === 'History entry 23' && h[9] === 'History entry 14', 'a long history shows the newest 10 only', h);
  check(await box('history').getByText(/Showing\s*1–10\s*of 23 entries/).isVisible(), 'it says which entries are shown, of how many');
  check(await box('history').getByRole('button', { name: 'Previous page' }).isDisabled(), 'no previous page on the first page');
  await box('history').getByRole('button', { name: 'Next page' }).click();
  h = await rows('history');
  check(h.length === 10 && h[0] === 'History entry 13', 'Next shows the next 10 older entries', h);
  await box('history').getByRole('button', { name: '3', exact: true }).click();
  h = await rows('history');
  check(h.length === 3 && h[2] === 'History entry 1' && await box('history').getByRole('button', { name: 'Next page' }).isDisabled(), 'the last page holds the oldest 3, and Next stops there', h);

  // recent activity: 5 per page
  const r = await rows('recent');
  check(r.length === 5 && r[0] === 'Recent entry 12' && await box('recent').getByText(/1–5\s*of 12/).isVisible(), 'recent activity shows the newest 5', r);

  // a short list: everything, no buttons
  check((await rows('short')).length === 4 && await box('short').getByRole('button').count() === 0, 'a list that fits on one page shows no page buttons');

  // a list that shrinks while on a later page lands on a page that exists
  await box('shrink').getByRole('button', { name: 'Next page' }).click();
  await box('shrink').getByRole('button', { name: 'Shrink the list' }).click();
  const s = await rows('shrink');
  check(s.length === 4 && await box('shrink').getByRole('button', { name: 'Next page' }).count() === 0, 'after the list shrinks it shows its entries, never an empty page', s);

  // the client dashboard's own pager
  let c = await rows('client');
  check(c.length === 10 && await box('client').getByText('Page 1 of 2').isVisible(), 'the client dashboard shows 10 with "Page 1 of 2"', c);
  await box('client').getByRole('button', { name: 'Next page' }).click();
  c = await rows('client');
  check(c.length === 2 && c[1] === 'Client entry 1' && await box('client').getByRole('button', { name: 'Previous page' }).isEnabled(), 'Next shows the 2 oldest', c);

  check(errors.length === 0, 'no error in the page', errors);
  for (const vp of [{ width: 360, height: 780 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(vp);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!overflow, `no sideways scroll at ${vp.width}px`);
  }
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== FEED PAGING BROWSER TESTS PASSED (${passed}) ===`);
