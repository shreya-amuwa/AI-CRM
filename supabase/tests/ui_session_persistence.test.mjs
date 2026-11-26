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

  // Attendance / Meeting Request / Bugs: pages shown over the dashboard's own page. A refresh used to drop them and return to the Overview.
  const o = await ctx.newPage();
  const now = () => o.getByTestId('page').innerText();
  await o.goto(`${base}?u=u1`);
  await o.getByRole('button', { name: 'tasks' }).click();
  await o.getByRole('button', { name: 'Meeting Request' }).click();
  check(await now() === '__meetings', 'Meeting Request opens over the dashboard');
  await o.reload();
  check(await now() === '__meetings', 'a refresh stays on Meeting Request (not the Overview)');
  await o.getByRole('button', { name: 'Attendance' }).click();
  await o.reload();
  check(await now() === '__attendance', 'a refresh stays on Attendance');
  await o.getByRole('button', { name: 'Bugs' }).click();
  await o.reload();
  check(await now() === '__bugs', 'a refresh stays on Bugs');
  await o.getByRole('button', { name: 'projects' }).click();
  await o.reload();
  check(await now() === 'projects', 'choosing a dashboard page leaves the overlay: a refresh stays on that page');
  await o.getByRole('button', { name: 'Meeting Request' }).click();
  await o.goto(`${base}?u=u2`);
  check(await now() === 'overview', 'another person on the same computer does not get the overlay');
  await o.goto(`${base}?u=u1`);
  check(await now() === '__meetings', 'and the first person still has it');
  await o.goto(`${base}?u=u1&open=meetings`);
  await o.getByRole('button', { name: 'Attendance' }).click();
  await o.goto(`${base}?u=u1&open=meetings`);
  check(await now() === '__meetings', 'a page asked for by a notification or link wins over the remembered one');
  await o.evaluate(() => localStorage.setItem('amuwa.page.u1.overlay./', 'no-such-overlay'));
  await o.goto(`${base}?u=u1`);
  check(await now() === 'projects', 'a remembered overlay that does not exist any more opens the dashboard page, not a blank screen');
  await o.getByRole('button', { name: 'Meeting Request' }).click();
  await o.getByRole('button', { name: 'sign out' }).click();
  await o.reload();
  check(await now() === 'overview', 'after signing out on purpose the overlay is forgotten too');
  console.log(`=== SESSION PERSISTENCE BROWSER CHECKS PASSED (${passed}) ===`);
} finally {
  await browser.close();
  srv.close();
}
