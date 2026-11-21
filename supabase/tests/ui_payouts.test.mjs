// Browser test of incentive payouts (20270123000100): My Income's My Earnings / Balance blocks, payout details, Withdraw (closed states,
// the ₹500 minimum, the server's message, the open request, cancel, recovery text, the slip), and Accounts > Payout requests (mark paid with
// TDS and the net, the server's conflict message, reject with a reason, final settlement of a leaver), at desktop and phone width.
// The database and the API are stand-ins with synthetic data.
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the payouts browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/payouts_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/payouts_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;
const slipCalls = [];
const ok = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
const srv = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const m = u.pathname.match(/^\/api\/v1\/payouts\/([^/]+)\/slip$/);
  if (m) { slipCalls.push(m[1]); return ok(res, { fileName: `Payout-PO-2611-${m[1]}.pdf`, contentBase64: Buffer.from('%PDF-1.7 test').toString('base64') }); }
  if (u.pathname === '/api/v1/crocodial/me') return ok(res, { enabled: false });
  if (u.pathname.startsWith('/api/v1/')) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'no fake' } })); }
  if (req.url === '/app.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(bundle); }
  if (req.url === '/app.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;

let passed = 0;
const check = (cond, name, extra) => { if (!cond) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); srv.close(); process.exit(0); }
const errors = [];
const open = async (mount, { width = 1280, before } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(base);
  if (before) await page.evaluate(before);
  await page.evaluate(m => window[m](), mount);
  return { ctx, page };
};
const calls = (page, fn) => page.evaluate(f => window.__calls.filter(c => c.fn === f).map(c => c.args), fn);
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
try {
  // 1. closed: no HR joining date
  let { ctx, page } = await open('mountIncome', { before: () => { window.__state.opensOn = null; window.__state.open = false; } });
  await page.getByText('Withdrawals open 15 days after HR records your joining date.').waitFor();
  check(await page.getByRole('button', { name: 'Withdraw', exact: true }).isDisabled(), 'without an HR joining date Withdraw is off and says why');
  await ctx.close();
  // 2. closed: before the opening date
  ({ ctx, page } = await open('mountIncome', { before: () => { window.__state.opensOn = '2026-12-05'; window.__state.open = false; } }));
  await page.getByText('Withdrawals open on 5 Dec 2026').waitFor();
  check(await page.getByRole('button', { name: 'Withdraw', exact: true }).isDisabled(), 'before the opening date Withdraw is off and shows the date');
  await ctx.close();

  // 3. open: the two blocks, payout details, withdraw, cancel, withdraw again
  ({ ctx, page } = await open('mountIncome'));
  const earnings = page.getByRole('region', { name: 'My Earnings' });
  const balance = page.getByRole('region', { name: 'Balance' });
  await balance.waitFor();
  const e = (await earnings.innerText()).toLowerCase(), b = (await balance.innerText()).toLowerCase();
  check(e.includes('total earned') && e.includes('₹3,000') && e.includes('today') && e.includes('₹50'), 'My Earnings shows overall and today', e);
  check(b.includes('withdrawn so far') && b.includes('₹0') && b.includes('available to withdraw') && b.includes('₹3,000'), 'Balance shows withdrawn and available', b);
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  let dlg = page.getByRole('dialog', { name: 'Withdraw' });
  await dlg.getByText('Add your payout details first').waitFor();
  await dlg.getByRole('button', { name: 'Add payout details' }).click();
  const form = page.getByRole('form', { name: 'Payout details' });
  await form.getByLabel('Account holder name').fill('Meera Member');
  await form.getByLabel('Account number').fill('123456789012');
  await form.getByLabel('IFSC').fill('HDFC001234');
  await form.getByRole('button', { name: 'Save details' }).click();
  await form.getByRole('alert').waitFor();
  check((await form.getByRole('alert').innerText()).includes('Enter the IFSC'), "a wrong IFSC shows the database's message");
  await form.getByLabel('IFSC').fill('hdfc0001234');
  await form.getByRole('button', { name: 'Save details' }).click();
  dlg = page.getByRole('dialog', { name: 'Withdraw' });
  await dlg.getByText('••••9012').waitFor();
  check(true, 'after saving, the dialog shows the masked account');
  await dlg.getByLabel('Amount (₹)').fill('400');
  await dlg.getByRole('button', { name: 'Request withdrawal' }).click();
  check((await dlg.getByRole('alert').innerText()).includes('at least ₹500'), 'less than ₹500 is refused before sending');
  check((await calls(page, 'payout_request')).length === 0, 'and nothing was sent');
  await dlg.getByLabel('Amount (₹)').fill('5000');
  await dlg.getByRole('button', { name: 'Request withdrawal' }).click();
  await dlg.getByText('You can withdraw up to').waitFor();
  check(true, "more than available shows the database's message");
  await dlg.getByLabel('Amount (₹)').fill('1234.50');
  await dlg.getByRole('button', { name: 'Request withdrawal' }).click();
  await page.getByTestId('withdrawal-row').first().waitFor();
  const req = (await calls(page, 'payout_request')).at(-1);
  check(req.p_amount === 1234.5 && typeof req.p_request_id === 'string' && req.p_request_id.length >= 8, 'the request sends the amount and a request id', JSON.stringify(req));
  check(await page.getByRole('button', { name: 'Withdraw', exact: true }).isDisabled(), 'while a request is waiting, Withdraw is off');
  check((await balance.innerText()).includes('₹1,765.5'), 'available drops by the open request');
  await page.getByRole('button', { name: 'Cancel withdrawal' }).click();
  await page.getByTestId('withdrawal-row').filter({ hasText: 'Cancelled' }).waitFor();
  check(await page.getByRole('button', { name: 'Withdraw', exact: true }).isEnabled(), 'after cancelling, Withdraw is on again');
  check(await noOverflow(page), 'My Income fits at desktop width');
  await ctx.close();

  // 4. Accounts: mark paid with TDS (net shown), conflict message, reject, final settlement
  ({ ctx, page } = await open('mountAccounts', { before: () => {
    window.__state.method = { kind: 'BANK', holderName: 'Meera Member', accountNumber: '123456789012', ifsc: 'HDFC0001234', upiId: null, otherDetails: null, pan: null };
    const mk = (id, amount) => ({ id, profileId: 'me', name: id === 'pr-a' ? 'Meera Member' : 'Ravi Rep', department: 'Sales', amount, status: 'REQUESTED', requestedAt: '2026-11-21T06:00:00Z',
      tdsAmount: 0, netAmount: null, reference: null, paidOn: null, reason: null, finalSettlement: false, method: window.__state.method });
    window.__state.requests = [mk('pr-a', 1234.5), mk('pr-b', 800)];
  } }));
  await page.getByRole('button', { name: /Meera Member/ }).click();
  const detail = page.getByRole('region', { name: 'Withdrawal details' });
  await detail.getByText('123456789012').waitFor();
  check(true, 'Accounts sees the full account number');
  await detail.getByLabel('Reference').fill('UTR123');
  await detail.getByLabel('TDS (₹)').fill('50.25');
  check((await detail.getByTestId('net-to-pay').innerText()).includes('₹1,184.25'), 'TDS 50.25 on 1,234.50 shows "Net to pay: ₹1,184.25"');
  await detail.getByRole('button', { name: 'Mark paid' }).click();
  await page.getByText('Marked paid.').waitFor();
  const mp = (await calls(page, 'payout_mark_paid')).at(-1);
  check(mp.p_id === 'pr-a' && mp.p_reference === 'UTR123' && mp.p_tds === 50.25 && /^\d{4}-\d{2}-\d{2}$/.test(mp.p_paid_on), 'mark paid sends the reference, date and TDS', JSON.stringify(mp));
  await page.getByRole('button', { name: /Ravi Rep/ }).click();
  await detail.getByLabel('Reference').fill('UTR999');
  // another Accountant pays it meanwhile
  await page.evaluate(() => { window.__state.requests.find(r => r.id === 'pr-b').status = 'PAID'; });
  await detail.getByRole('button', { name: 'Mark paid' }).click();
  await detail.getByText('This withdrawal was already handled.').waitFor();
  check(true, "a request another Accountant already paid shows the database's message");
  await page.evaluate(() => { window.__state.requests.find(r => r.id === 'pr-b').status = 'REQUESTED'; });
  await detail.getByRole('button', { name: 'Reject' }).click();
  await detail.getByRole('button', { name: 'Confirm reject' }).click();
  check(await detail.getByRole('alert').filter({ hasText: 'Say why' }).isVisible(), 'rejecting needs a reason');
  await detail.getByLabel('Reason').fill('Wrong account');
  await detail.getByRole('button', { name: 'Confirm reject' }).click();
  await page.getByText('Rejected.').waitFor();
  check((await calls(page, 'payout_reject')).at(-1).p_reason === 'Wrong account', 'reject sends the reason');
  await page.getByRole('tab', { name: /Leavers/ }).click();
  await page.getByRole('button', { name: /Gita Gone/ }).click();
  await detail.getByLabel('Reference').fill('UTR-FINAL');
  await detail.getByRole('button', { name: 'Pay final settlement' }).click();
  await page.getByText('Final settlement paid.').waitFor();
  const fs = (await calls(page, 'payout_final_settlement')).at(-1);
  check(fs.p_profile === 'gone-1' && fs.p_amount === 900, 'Accounts pays a leaver their final settlement, confirming the amount they saw', JSON.stringify(fs));
  await page.getByRole('tab', { name: /Paid/ }).click();
  await page.getByRole('button', { name: /Meera Member/ }).click();
  await detail.getByRole('button', { name: 'Download slip' }).click();
  await page.waitForFunction(() => true);
  await page.waitForTimeout(300);
  check(slipCalls.includes('pr-a'), 'Accounts downloads the slip of a paid withdrawal');
  await ctx.close();

  // 4b. a request now larger than the balance (an earning was reversed after it was made): Accounts is warned before paying
  ({ ctx, page } = await open('mountAccounts', { before: () => {
    window.__state.earned = 1000;
    window.__state.requests = [{ id: 'pr-n', profileId: 'me', name: 'Neha Negative', department: 'Sales', amount: 1500, status: 'REQUESTED', requestedAt: '2026-11-21T06:00:00Z',
      tdsAmount: 0, netAmount: null, reference: null, paidOn: null, reason: null, finalSettlement: false, method: { kind: 'UPI', holderName: 'Neha', upiId: 'neha@okaxis' } }];
  } }));
  await page.getByRole('button', { name: /Neha Negative/ }).click();
  await page.getByRole('region', { name: 'Withdrawal details' }).getByText('Mark paid').first().waitFor();
  check(await page.getByRole('region', { name: 'Withdrawal details' }).getByTestId('negative-warning').isVisible(),
    'Accounts is warned when the request is now more than the person has');
  await ctx.close();

  // 5. phone width, a paid request with its slip, and money to be recovered
  ({ ctx, page } = await open('mountIncome', { width: 375, before: () => {
    window.__state.method = { kind: 'UPI', holderName: 'Meera Member', upiId: 'meera@okhdfcbank' };
    window.__state.requests = [{ id: 'pr-p', amount: 3500, status: 'PAID', requestedAt: '2026-11-01T06:00:00Z', reference: 'UTR777', paidOn: '2026-11-02', tdsAmount: 0, netAmount: 3500, method: window.__state.method }];
  } }));
  await page.getByText('to be recovered from future incentives').waitFor();
  check((await page.getByRole('region', { name: 'Balance' }).innerText()).includes('-₹500') || (await page.getByRole('region', { name: 'Balance' }).innerText()).includes('₹500 to be recovered'),
    'a negative balance reads "to be recovered from future incentives"');
  check(await page.getByRole('button', { name: 'Withdraw', exact: true }).isDisabled(), 'no withdrawal while money is to be recovered');
  await page.getByRole('button', { name: 'Download slip' }).click();
  await page.waitForTimeout(300);
  check(slipCalls.includes('pr-p'), 'the person downloads their slip');
  check(await noOverflow(page), 'nothing overflows at 375 px');
  await ctx.close();

  check(errors.length === 0, 'no page errors', errors.join('\n'));
} finally {
  await browser.close();
  srv.close();
}
console.log(`${passed} passed`);
