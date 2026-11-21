// Browser test: the page a person is on inside a dashboard survives a refresh (and a closed and reopened browser), belongs to that person only,
// and is forgotten when they sign out on purpose. Uses the real useRememberedPage hook and the real browser storage.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the session persistence browser test did not run'); process.exit(0); }
const authStub = path.resolve('supabase/tests/ui/session_persistence_auth_stub.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/session_persistence_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' },
  plugins: [{ name: 'stub-auth', setup(b) { b.onResolve({ filter: /context\/AuthContext$/ }, () => ({ path: authStub })); } }]
});
const bundle = built.outputFiles[0].text;
const srv = createServer((req, res) => {
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(r => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}/`;
let passed = 0;
const check = (ok, label) => { if (!ok) { console.error('FAILED:', label); process.exit(1); } passed++; console.log('ok -', label); };

let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const shown = () => page.getByTestId('page').innerText();

  await page.goto(`${base}?u=u1`);
  check(await shown() === 'overview', 'a first visit opens the Overview');
  await page.getByRole('button', { name: 'tasks' }).click();
  check(await shown() === 'tasks', 'choosing a page shows it');
  await page.reload();
  check(await shown() === 'tasks', 'a refresh stays on the same page (not the Overview)');

  // a closed and reopened browser: a new page in the same profile (the storage is kept, nothing else is)
  await page.close();
  const reopened = await ctx.newPage();
  await reopened.goto(`${base}?u=u1`);
  check(await reopened.getByTestId('page').innerText() === 'tasks', 'reopening the browser or the app returns to the same page');

  await reopened.goto(`${base}?u=u2`);
  check(await reopened.getByTestId('page').innerText() === 'overview', 'another person on the same computer starts at the Overview');
  await reopened.goto(`${base}?u=u1`);
  check(await reopened.getByTestId('page').innerText() === 'tasks', 'and the first person still has theirs');

  await reopened.evaluate(() => localStorage.setItem('amuwa.page.u1.harness', 'page-from-an-old-version'));
  await reopened.reload();
  check(await reopened.getByTestId('page').innerText() === 'overview', 'a remembered page that no longer exists opens the Overview, not a blank screen');

  await reopened.getByRole('button', { name: 'projects' }).click();
  await reopened.getByRole('button', { name: 'sign out' }).click();
  await reopened.reload();
  check(await reopened.getByTestId('page').innerText() === 'overview', 'after signing out on purpose the next visit starts at the Overview');
  console.log(`=== SESSION PERSISTENCE BROWSER CHECKS PASSED (${passed}) ===`);
} finally {
  await browser.close();
  srv.close();
}
