// Browser test of staff "Forgot password?" (20261231000700): the request sends only the e-mail, the answer never says whether the address
// has an account, rate limiting is explained, and /set-password?purpose=reset uses the reset wording and saves through /me/password.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the staff forgot-password browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/staff_forgot_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/staff_forgot_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;
const srv = createServer((req, res) => {
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
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const sent = [];
  let reply = { status: 200, body: { success: true, data: { ok: true } } };
  await page.route('**/auth/forgot-password', async route => { sent.push(JSON.parse(route.request().postData() || '{}')); await route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) }); });
  await page.goto(base);
  await page.evaluate(() => window.mountForgot());
  await page.getByTestId('forgot-email').waitFor();
  check((await page.getByTestId('forgot-email').inputValue()) === 'Asha@Amuwa.com', 'the address typed on the sign-in page is carried over');
  await page.getByTestId('forgot-email').fill('not an email');
  await page.getByTestId('forgot-submit').click();
  check(await page.getByText('Enter a valid e-mail address.').isVisible() && sent.length === 0, 'a wrong address is caught before anything is sent');
  await page.getByTestId('forgot-email').fill('  Asha@Amuwa.com ');
  await page.getByTestId('forgot-submit').click();
  await page.getByRole('status').waitFor();
  check(sent.length === 1 && JSON.stringify(sent[0]) === JSON.stringify({ email: 'asha@amuwa.com' }), 'only the e-mail is sent (trimmed, lower case)', sent);
  const msg = await page.getByRole('status').textContent();
  check(/If asha@amuwa\.com belongs to an active Amuwa CRM account/.test(msg), 'the answer never says whether the address has an account', msg);
  await page.getByText('Back to sign in').click();
  check(await page.evaluate(() => window.__back === true), 'back to sign in');
  // too many requests
  const p2 = await ctx.newPage();
  await p2.route('**/auth/forgot-password', route => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }) }));
  await p2.goto(base);
  await p2.evaluate(() => window.mountForgot());
  await p2.getByTestId('forgot-submit').click();
  await p2.getByRole('alert').waitFor();
  check(/wait a few minutes/.test(await p2.getByRole('alert').textContent()), 'too many requests: told to wait');
  // the reset page
  const saved = [];
  const p3 = await ctx.newPage();
  await p3.route('**/me/password', async route => { saved.push(JSON.parse(route.request().postData() || '{}')); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { changed: true } }) }); });
  await p3.goto(`${base}/set-password?purpose=reset&token_hash=good-token&type=recovery`);
  await p3.evaluate(() => window.mountSet());
  await p3.getByText('Choose a new password').waitFor();
  check(!(await p3.getByText('Welcome!').count()), 'a reset link shows the reset wording, not the welcome one');
  const fields = p3.locator('input[type="password"]');
  await fields.nth(0).fill('New-Secret-2026');
  await fields.nth(1).fill('New-Secret-2026');
  await p3.getByRole('button', { name: /Save password/ }).click();
  await p3.getByText('Your new password is saved').waitFor();
  check(saved.length === 1 && saved[0].password === 'New-Secret-2026' && await p3.evaluate(() => window.__verified[0].token_hash === 'good-token' && window.__verified[0].type === 'recovery'),
    'the one-time token is used only when the password is saved, then the new password is stored');
  check(await p3.evaluate(() => !location.search.includes('token_hash')), 'the token is removed from the address bar');
  const p4 = await ctx.newPage();
  p4.on('pageerror', e => errors.push(String(e)));
  await p4.route('**/auth/forgot-password', async route => { sent.push(JSON.parse(route.request().postData() || '{}')); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ok: true } }) }); });
  await p4.goto(`${base}/set-password?purpose=reset&token_hash=used-token&type=recovery`);
  await p4.evaluate(() => window.mountSet());
  const f4 = p4.locator('input[type="password"]');
  await f4.nth(0).fill('New-Secret-2026'); await f4.nth(1).fill('New-Secret-2026');
  await p4.getByRole('button', { name: /Save password/ }).click();
  await p4.getByText('This link has expired').waitFor();
  check(/24 hours/.test(await p4.locator('body').textContent()) && await p4.getByTestId('new-link-form').isVisible(),
    'a used or expired link says links work for 24 hours and offers "Send me a new link" on the spot');
  check(await p4.getByTestId('bot-check').count() === 0, 'without a site key no robot check is shown (nothing to complete)');
  const sentBefore = sent.length;
  await p4.getByTestId('new-link-email').fill('Asha@Amuwa.com');
  await p4.getByTestId('new-link-submit').click();
  await p4.getByTestId('new-link-sent').waitFor();
  check(sent.length === sentBefore + 1 && sent[sent.length - 1].email === 'asha@amuwa.com' && /24 hours/.test(await p4.getByTestId('new-link-sent').textContent()),
    '"Send me a new link" asks for a new link the same way as "Forgot password?" and says it works for 24 hours', sent);
  check(errors.length === 0, 'no error in the page', errors);
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'no sideways scroll at 390px');
} finally {
  await browser.close();
  srv.close();
}
console.log(`=== STAFF FORGOT PASSWORD BROWSER TESTS PASSED (${passed}) ===`);
