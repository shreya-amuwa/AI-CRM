// Browser test of the user manual's sidebar: clicking one item after another must open each page (it used to resolve the second click against the
// address of the first, ending on a page that does not exist - which on the live site falls through to the app's dashboard).
// Builds the manual, serves it under /documentation/ like the live site (anything that is not a real file answers with an "app" page, as the
// single-page-app rewrite does) and clicks through pages of different depth. Skipped, loudly, when Playwright or Chromium are missing.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the manual navigation browser test did not run'); process.exit(0); }
const out = mkdtempSync(path.join(tmpdir(), 'docs-nav-'));
execFileSync('node', ['docs-site/build.mjs', `--out=${out}`], { stdio: 'ignore' });
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = url.startsWith('/documentation/') ? url.slice('/documentation/'.length) : null;
  let file = rel === null ? null : path.join(out, rel);
  if (file && existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (file && existsSync(file) && statSync(file).isFile()) { res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }); return res.end(readFileSync(file)); }
  // the live site's rewrite: everything else is the app
  res.writeHead(200, { 'content-type': types['.html'] }); res.end('<!doctype html><title>Amuwa CRM app</title><div id="root">THE APP DASHBOARD</div>');
});
await new Promise(r => server.listen(0, r));
const origin = `http://localhost:${server.address().port}`;
let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); server.close(); process.exit(0); }

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${origin}/documentation/`);
await page.waitForSelector('#sidebar a', { state: 'attached' });
const open = () => page.evaluate(() => document.querySelectorAll('details').forEach(d => (d.open = true)));
const hrefs = await page.$$eval('#sidebar a', as => as.map(a => a.getAttribute('href')));
check(hrefs.every(h => /^https?:\/\//.test(h)), 'every sidebar link is an absolute address (it no longer depends on the page it is read from)', hrefs.slice(0, 3));

// pages of different depth, one click after another
const route = ['getting-started/platform-overview/', 'getting-started/signing-in/', 'sales/creating-a-lead/', 'getting-started/roles-and-permissions/'];
for (const r of route) {
  await open();
  await page.locator(`#sidebar a[href$="/documentation/${r}"]`).first().click();
  await page.waitForFunction(p => location.pathname.endsWith(p), `/documentation/${r}`, { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(400);
  const body = await page.locator('body').innerText();
  check(new URL(page.url()).pathname === `/documentation/${r}` && !/THE APP DASHBOARD|Page not found/.test(body), `clicking "${r}" opens that manual page`, { url: page.url() });
}
// the header link goes home from any depth, and a reload of a deep page keeps working
await page.locator('header.top a.brand').click();
await page.waitForTimeout(500);
check(new URL(page.url()).pathname === '/documentation/', 'the manual\'s logo link goes to the manual home from a deep page', page.url());
await page.locator('#sidebar a[href$="/documentation/sales/creating-a-lead/"]').first().evaluate(a => a.click());
await page.waitForTimeout(500);
await page.reload();
await page.waitForSelector('#sidebar a', { state: 'attached' });
check(!/THE APP DASHBOARD/.test(await page.locator('body').innerText()) && new URL(page.url()).pathname === '/documentation/sales/creating-a-lead/', 'reloading a deep page stays in the manual');
await open();
await page.locator('#sidebar a[href$="/documentation/getting-started/signing-in/"]').first().click();
await page.waitForTimeout(500);
check(new URL(page.url()).pathname === '/documentation/getting-started/signing-in/', 'and the sidebar still works after the reload');
await browser.close();
server.close();
console.log(`=== MANUAL NAVIGATION BROWSER TESTS PASSED (${passed}) ===`);
