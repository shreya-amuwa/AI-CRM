// "Confirm you are not a robot" on the CRM's forms (src/components/auth/useBotCheck.tsx, docs/PASSWORD_LINKS.md), with a site key and a
// stand-in for Cloudflare's script: the check appears in a form opened after the page loaded (the client sign-in page), its token is sent
// with "Send me a new link", and a check that cannot load never blocks the form (the server decides).
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the robot check browser test did not run'); process.exit(0); }
const stub = new URL('./ui/staff_forgot_stubs.ts', import.meta.url).pathname;
const built = await build({
  entryPoints: ['supabase/tests/ui/bot_check_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': JSON.stringify({ VITE_TURNSTILE_SITE_KEY: 'test-site-key' }) }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;
const srv = createServer((req, res) => {
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
// Cloudflare's script, stood in: renders a box and passes at once with a fresh token each time
const FAKE = `window.turnstile = { n: 0, render(el, o) { window.__rendered = (window.__rendered || 0) + 1; window.__opts = { sitekey: o.sitekey, action: o.action };
  el.innerHTML = '<span data-testid="ts-box">ok</span>'; setTimeout(() => o.callback('tok-' + (++this.n)), 10); return 'w' + this.n; },
  reset() {}, remove(id) { window.__removed = (window.__removed || 0) + 1; } };`;

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
try {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await ctx.newPage();
  await page.route('https://challenges.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE }));
  await page.goto(base);
  await page.evaluate(() => window.mountLater());
  await page.getByTestId('open-forgot').click();
  await page.getByTestId('ts-box').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="ready"]')?.textContent === 'true');
  check(await page.evaluate(() => window.__rendered === 1 && window.__opts.sitekey === 'test-site-key' && window.__opts.action === 'reset'),
    'a form opened after the page loaded shows the robot check (the client "Forgot password?")');
  await page.getByTestId('open-forgot').click();
  await page.getByTestId('open-forgot').click();
  await page.getByTestId('ts-box').waitFor();
  check(await page.evaluate(() => window.__rendered === 2 && window.__removed >= 1), 'closed and opened again: the old check is removed and a new one shown');

  const p2 = await ctx.newPage();
  await p2.route('https://challenges.cloudflare.com/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE }));
  const sent = [];
  await p2.route('**/client-auth/forgot-password', async r => { sent.push({ token: r.request().headers()['x-turnstile-token'], body: JSON.parse(r.request().postData() || '{}') });
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ok: true } }) }); });
  await p2.goto(base);
  await p2.evaluate(() => window.mountNewLink());
  await p2.getByTestId('ts-box').waitFor();
  await p2.waitForTimeout(50);
  await p2.getByTestId('new-link-email').fill('ravi@shop.example');
  await p2.getByTestId('new-link-submit').click();
  await p2.getByTestId('new-link-sent').waitFor();
  check(sent.length === 1 && /^tok-\d+$/.test(sent[0].token || '') && sent[0].body.email === 'ravi@shop.example', '"Send me a new link" sends the passed check with the request', sent);

  const p3 = await ctx.newPage();
  await p3.route('https://challenges.cloudflare.com/**', r => r.abort());
  const sent3 = [];
  await p3.route('**/client-auth/forgot-password', async r => { sent3.push(r.request().headers()['x-turnstile-token'] ?? null);
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ok: true } }) }); });
  await p3.goto(base);
  await p3.evaluate(() => window.mountNewLink());
  await p3.getByText('The robot check could not load').waitFor();
  await p3.getByTestId('new-link-email').fill('ravi@shop.example');
  await p3.getByTestId('new-link-submit').click();
  await p3.getByTestId('new-link-sent').waitFor();
  check(sent3.length === 1 && sent3[0] === null, 'a check blocked by an ad blocker never blocks the form: sent without it, the server decides', sent3);
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== ROBOT CHECK BROWSER TESTS PASSED (${passed}) ===`);
