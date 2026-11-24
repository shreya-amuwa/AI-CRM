// Browser test of the Employee Wallet (20270207000100): the wallet card, the six tabs (Overview, Earnings, Incentives, Salary, Withdrawals, Transactions),
// salary shown as expected only, the withdrawal rules and messages, the ledger with credit / debit / pending indicators, filters and pages, a person without a
// wallet, a failure; and Accounts' wallet credits (the form, approve, reject, the server's refusal) and the report, at desktop and phone width.
// The database is a stand-in with synthetic data (supabase/tests/ui/wallet_stubs.ts).
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
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the wallet browser test did not run'); process.exit(0); }
const cssDir = 'dist/assets';
const css = existsSync(cssDir) ? readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n') : '';
const stub = path.resolve('supabase/tests/ui/wallet_stubs.ts');
const built = await build({
  entryPoints: ['supabase/tests/ui/wallet_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', write: false, jsx: 'automatic', logLevel: 'error',
  define: { 'import.meta.env': '{}' }, loader: { '.css': 'empty' },
  plugins: [{ name: 'stub-supabase', setup(b) { b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: stub })); } }]
});
const bundle = built.outputFiles[0].text;
const srv = createServer((req, res) => {
  if (req.url.startsWith('/api/v1/')) { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'no fake' } })); }
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
// the visible text, on one line (labels are upper-cased by the page's style: patterns that name a label use the i flag)
const text = async (page, sel) => (await page.innerText(sel)).replace(/\s+/g, ' ').trim();
const calls = (page, fn) => page.evaluate(f => window.__calls.filter(c => c.fn === f), fn);
try {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport, timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', d => d.accept());
    await page.goto(base);
    await page.evaluate(() => window.mountWallet());
    await page.getByTestId('wallet-card').waitFor();
    await page.waitForFunction(() => document.querySelector('[data-testid="wallet-balance"]')?.textContent !== '…');

    // ---- the main card: 5000 incentive + 2000 bonus = 7000 balance; the pending 1500 bonus is not in it
    check(await text(page, '[data-testid="wallet-balance"]') === '₹7,000', `${label}: the total wallet balance is the credited incentives plus bonuses`);
    check(/^Available for withdrawal ₹7,000 Credited incentives and bonuses$/i.test(await text(page, '[data-testid="wallet-available"]')), `${label}: available for withdrawal`, await text(page, '[data-testid="wallet-available"]'));
    check(/₹1,500/.test(await text(page, '[data-testid="wallet-pending"]')) && /1 waiting for approval/i.test(await text(page, '[data-testid="wallet-pending"]')), `${label}: pending earnings: the 1,500 bonus waiting for approval`);
    check(/₹25,000/.test(await text(page, '[data-testid="wallet-salary-month"]')) && /not yet credited/i.test(await text(page, '[data-testid="wallet-salary-month"]')), `${label}: this month's salary, marked expected and not credited`);
    check(/₹5,000/.test(await text(page, '[data-testid="wallet-incentives-month"]')), `${label}: this month's incentives`);
    const tabs = (await page.locator('[role="tab"]').allInnerTexts()).map(t => t.trim());
    check(tabs.join('|') === 'Overview|Earnings|Incentives|Salary|Withdrawals|Transactions', `${label}: the six tabs`, tabs);

    // ---- overview
    check(/Wallet balance ₹7,000/i.test(await text(page, '[role="tabpanel"]')), `${label}: overview: the balance adds up from its parts`);
    check((await page.locator('[role="tabpanel"] [data-testid="wallet-row"]').count()) >= 4, `${label}: overview: recent transactions`);
    check((await page.locator('[data-testid="wallet-month-row"]').count()) === 3, `${label}: overview: the monthly summary`);

    // ---- earnings
    await page.getByTestId('wallet-tab-earnings').click();
    check(/Nov 2026/.test(await text(page, '[data-testid="wallet-months"]')) && /Oct 2026/.test(await text(page, '[data-testid="wallet-months"]')), `${label}: earnings: month by month`);

    // ---- incentives: none pending, none awaiting approval, the credited ones and a reversal
    await page.getByTestId('wallet-tab-incentives').click();
    await page.getByText('Your incentives').waitFor();
    const inc = await text(page, '[role="tabpanel"]');
    check(/Pending incentives ₹0/i.test(inc) && /Approved incentives ₹0/i.test(inc) && /Credited incentives ₹5,000/i.test(inc) && /Paid incentives ₹0/i.test(inc), `${label}: incentives: pending, approved, credited and paid figures`, inc.slice(0, 300));
    check(await page.locator('[role="tabpanel"] [data-type="INCENTIVE_CREDIT"]').count() >= 2 && await page.locator('[role="tabpanel"] [data-type="REVERSAL"]').count() >= 1, `${label}: incentives: the credits and the reversal are listed`);
    check(/credited to your wallet as soon as its rule is met/.test(inc), `${label}: incentives: says when an incentive is credited`);

    // ---- salary: expected only
    await page.getByTestId('wallet-tab-salary').click();
    const sal = await text(page, '[role="tabpanel"]');
    check(/Monthly salary ₹25,000/i.test(sal) && /Approved salary Not recorded/i.test(sal) && /Salary credited Not recorded/i.test(sal), `${label}: salary: the HR figure is expected; approved and credited are not recorded`, sal.slice(0, 300));
    check(/never withdrawable/.test(sal) && /No salary credits yet/.test(sal) && /not recorded in the CRM yet/.test(sal), `${label}: salary: says it is not withdrawable, has no history, and what is not recorded`);

    // ---- transactions: indicators, filter, dates, pages
    await page.getByTestId('wallet-tab-transactions').click();
    await page.locator('[role="tabpanel"] [data-testid="wallet-row"]:visible').first().waitFor();
    const rows = page.locator('[role="tabpanel"] [data-testid="wallet-row"]:visible');
    check(await rows.count() >= 5, `${label}: transactions are listed`);
    const pend = rows.filter({ hasText: 'Target bonus' }).first();
    check(/Pending approval/.test(await pend.innerText()) && (await pend.locator('.line-through').count()) > 0, `${label}: a pending bonus says Pending approval and is struck through (not counted)`);
    const credit = rows.filter({ hasText: 'Acme Traders' }).first();
    check(/Credit/.test(await credit.innerText()) && /\+₹5,000/.test(await credit.innerText()) && /Credited/.test(await credit.innerText()), `${label}: a credit: Credit, +₹5,000, Credited`);
    await page.selectOption('[data-testid="wallet-filter-type"]', 'REVERSAL');
    await page.waitForFunction(() => document.querySelectorAll('[role="tabpanel"] [data-type]').length > 0 && [...document.querySelectorAll('[role="tabpanel"] [data-type]')].every(e => e.getAttribute('data-type') === 'REVERSAL'));
    check(/-₹800/.test(await text(page, '[role="tabpanel"]')) && /Debit/.test(await text(page, '[role="tabpanel"]')), `${label}: the type filter, and a debit (-₹800)`);
    await page.selectOption('[data-testid="wallet-filter-type"]', '');
    await page.fill('input[aria-label="From date"]', '2026-11-16');
    await page.waitForFunction(() => ![...document.querySelectorAll('[role="tabpanel"] [data-testid="wallet-row"]')].some(r => /Diwali/.test(r.textContent)));
    check(/Acme Traders/.test(await text(page, '[role="tabpanel"]')) && !/Diwali/.test(await text(page, '[role="tabpanel"]')), `${label}: the date filter`);
    await page.fill('input[aria-label="From date"]', '');
    // pages
    await page.evaluate(() => { window.__state.extraRows = 30; });
    await page.getByTestId('wallet-tab-overview').click();
    await page.getByTestId('wallet-tab-transactions').click();
    await page.getByText(/Page 1 of 2/).waitFor();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByText(/Page 2 of 2/).waitFor();
    check((await calls(page, 'wallet_transactions')).some(c => c.args.p_offset === 20), `${label}: the next page is asked from the database`);
    await page.evaluate(() => { window.__state.extraRows = 0; });

    // ---- withdrawals: closed, then open; the rules and the messages
    await page.evaluate(() => { window.__state.open = false; });
    await page.getByRole('button', { name: 'Refresh the wallet' }).click();
    await page.getByTestId('wallet-tab-withdrawals').click();
    await page.getByTestId('withdraw-note').waitFor();
    check(/Withdrawals open on 16 Jan 2026/.test(await text(page, '[data-testid="withdraw-note"]')) && await page.getByTestId('wallet-withdraw').isDisabled(), `${label}: before the opening date: the date is shown and Withdraw is off`);
    await page.evaluate(() => { window.__state.open = true; });
    await page.getByRole('button', { name: 'Refresh the wallet' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-testid="withdraw-note"]'));
    check(await text(page, '[data-testid="withdraw-available"]') === '₹7,000' && !(await page.getByTestId('wallet-withdraw').isDisabled()), `${label}: open: ₹7,000 can be withdrawn`);
    check(/not pending items and not uncredited salary/.test(await text(page, '[role="tabpanel"]')), `${label}: it says what cannot be withdrawn`);
    // without payout details the dialog asks for them first
    await page.getByTestId('wallet-withdraw').click();
    await page.getByRole('button', { name: 'Add payout details' }).waitFor();
    check(true, `${label}: without payout details the withdrawal dialog asks for them first`);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__state.method = { kind: 'UPI', holderName: 'Meera Member', upiId: 'meera@okhdfcbank' }; });
    await page.getByTestId('wallet-withdraw').click();
    await page.getByLabel('Amount (₹)').fill('9000');
    await page.getByRole('button', { name: 'Request withdrawal' }).click();
    await page.getByRole('alert').waitFor();
    check(/You can withdraw up to ₹7000/.test(await text(page, '[role="alert"]')), `${label}: more than available is refused, with the database's message`);
    await page.getByLabel('Amount (₹)').fill('100');
    await page.getByRole('button', { name: 'Request withdrawal' }).click();
    check(/at least ₹500/i.test(await text(page, '[role="alert"]')), `${label}: under the minimum is refused`);
    await page.getByLabel('Amount (₹)').fill('1000');
    await page.getByRole('button', { name: 'Request withdrawal' }).click();
    await page.getByText(/Withdrawal requested/).waitFor();
    check((await calls(page, 'payout_request')).filter(c => c.args.p_amount === 1000).length === 1, `${label}: one request of 1,000 was sent`);
    await page.getByTestId('withdrawal-row').waitFor();
    check(/Waiting for Accounts/.test(await text(page, '[data-testid="withdrawal-row"]')), `${label}: it shows in the history, waiting for Accounts`);
    check(/set aside/.test(await text(page, '[data-testid="withdraw-note"]')) && await text(page, '[data-testid="withdraw-available"]') === '₹6,000' && await page.getByTestId('wallet-withdraw').isDisabled(), `${label}: the 1,000 is set aside: available is 6,000 and a second request is not possible`);
    check(/₹7,000/.test(await text(page, '[data-testid="wallet-balance"]')), `${label}: the balance does not change until it is paid`);
    await page.getByRole('button', { name: 'Cancel withdrawal' }).click();
    await page.waitForFunction(() => /Cancelled/.test(document.querySelector('[data-testid="withdrawal-row"]')?.textContent ?? ''));
    check(await text(page, '[data-testid="withdraw-available"]') === '₹7,000', `${label}: cancelling frees the amount`);
    // a rejected request shows its reason and the processing date
    await page.evaluate(() => { window.__state.requests.unshift({ id: 'pr-x', profileId: 'me', name: 'M', department: 'S', amount: 600, status: 'REJECTED', requestedAt: '2026-11-20T06:00:00Z', decidedAt: '2026-11-20T09:00:00Z', decidedBy: 'Dev Accounts', channel: null, reference: null, paidOn: null, tdsAmount: 0, netAmount: null, reason: 'Details do not match', finalSettlement: false, method: { kind: 'UPI', holderName: 'M', upiId: 'm@okhdfcbank' } }); });
    await page.getByRole('button', { name: 'Refresh the wallet' }).click();
    await page.getByTestId('withdrawal-reason').waitFor();
    check(/Details do not match/.test(await text(page, '[data-testid="withdrawal-reason"]')) && /Rejected .* by Dev Accounts/.test(await text(page, '[role="tabpanel"]')), `${label}: a rejected request shows its reason, when and by whom`);

    // ---- layout
    check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label}: no sideways scrolling`);
    if (label === 'phone') {
      await page.getByTestId('wallet-tab-transactions').click();
      await page.locator('[role="tabpanel"] [data-testid="wallet-row"]:visible').first().waitFor();
      check(!(await page.locator('[data-testid="wallet-table"]').isVisible()), 'phone: the transactions are cards, not a wide table');
    }

    // ---- a person with no wallet, and a failure
    await page.evaluate(() => { window.__state.eligible = false; });
    await page.evaluate(() => window.mountWallet());
    await page.getByText('There is no wallet for this account.').waitFor();
    check(true, `${label}: a person without a wallet is told so`);
    await page.evaluate(() => { window.__state.eligible = true; window.__state.fail = true; });
    await page.evaluate(() => window.mountWallet());
    await page.getByRole('alert').first().waitFor();
    check(/unavailable/.test(await text(page, '[role="alert"]')), `${label}: a failure is shown, not a blank page`);
    await page.evaluate(() => { window.__state.fail = false; });
    check(errors.length === 0, `${label}: no script errors`, errors);
    await ctx.close();
  }

  // ---- Accounts: wallet credits and the report
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base);
    await page.evaluate(() => window.mountAdmin());
    await page.getByTestId('credit-form').waitFor();
    await page.getByTestId('credit-submit').click();
    check(/Choose the employee/.test(await text(page, '[data-testid="credit-form"]')), 'Accounts: the employee must be chosen');
    await page.fill('#wc-person', 'Meer');
    await page.getByRole('option', { name: /Meera Member/ }).click();
    await page.getByTestId('credit-submit').click();
    check(/Enter an amount/.test(await text(page, '[data-testid="credit-form"]')), 'Accounts: an amount is needed');
    await page.getByLabel('Amount (₹)').fill('-100');
    await page.getByLabel('What it is for').fill('Test');
    await page.getByTestId('credit-submit').click();
    check(/positive amount/.test(await text(page, '[data-testid="credit-form"]')), 'Accounts: a negative bonus is refused on the form');
    await page.selectOption('select', 'ADJUSTMENT');
    await page.getByLabel('What it is for').fill('x');
    await page.getByTestId('credit-submit').click();
    check(/Say what it is for/.test(await text(page, '[data-testid="credit-form"]')), 'Accounts: it says what it is for');
    await page.getByLabel('Amount (₹)').fill('2500');
    await page.selectOption('select', 'BONUS');
    await page.getByLabel('What it is for').fill('Quarterly target bonus');
    await page.getByLabel('Reference').fill('Q3-2026');
    await page.getByTestId('credit-submit').click();
    await page.getByText(/A different Accounts person approves it/).waitFor();
    const created = await calls(page, 'wallet_credit_create');
    check(created.length === 1 && created[0].args.p_amount === 2500 && created[0].args.p_kind === 'BONUS' && created[0].args.p_profile === 'p1' && created[0].args.p_reference === 'Q3-2026' && created[0].args.p_request_id.length >= 8,
      'Accounts: the credit is sent with the employee, the amount, the type and a request id', created);
    check(/Meera Member/.test(await text(page, '[data-testid="credit-row"]')) && /\+₹2,500/.test(await text(page, '[data-testid="credit-row"]')), 'Accounts: it waits in the approval list');
    // a second credit gets a new request id
    await page.fill('#wc-person', 'Meen');
    await page.getByRole('option', { name: /Meena Support/ }).click();
    await page.getByLabel('Amount (₹)').fill('300');
    await page.getByLabel('What it is for').fill('Refund of a mistaken deduction');
    await page.selectOption('select', 'REFUND');
    await page.getByTestId('credit-submit').click();
    await page.waitForFunction(() => window.__calls.filter(c => c.fn === 'wallet_credit_create').length === 2);
    const two = await calls(page, 'wallet_credit_create');
    check(two[0].args.p_request_id !== two[1].args.p_request_id, 'Accounts: the next credit has its own request id (a retry of one credit reuses its id)');
    // the server refuses an approval by the person who entered it
    await page.evaluate(() => { window.__state.decideError = 'FORBIDDEN: A different Accounts person must approve a credit you entered.'; });
    await page.locator('[data-testid="credit-row"]').first().getByTestId('credit-approve').click();
    await page.getByTestId('credit-confirm').click();
    await page.getByRole('alert').waitFor();
    check(/different Accounts person/.test(await text(page, '[role="alert"]')), "Accounts: the server's refusal is shown and the credit stays");
    await page.evaluate(() => { window.__state.decideError = null; });
    await page.getByTestId('credit-confirm').dblclick();
    await page.getByText(/Approved\. It is in the employee/).waitFor();
    check((await calls(page, 'wallet_credit_decide')).filter(c => c.args.p_approve === true).length === 2, 'Accounts: approving sends the decision (the refused try and the real one)');
    check(await page.locator('[data-testid="credit-row"]').count() === 1, 'Accounts: the approved credit leaves the waiting list');
    // rejecting needs a reason
    await page.getByTestId('credit-reject').click();
    await page.getByTestId('credit-confirm').click();
    check(/Say why you reject it/.test(await text(page, '[role="dialog"]')), 'Accounts: a rejection needs a reason');
    await page.getByLabel('Reason').fill('Not in policy');
    await page.getByTestId('credit-confirm').click();
    await page.getByText('Rejected.').waitFor();
    check((await calls(page, 'wallet_credit_decide')).some(c => c.args.p_approve === false && c.args.p_note === 'Not in policy'), 'Accounts: the rejection is sent with its reason');
    // the report
    await page.getByTestId('wallet-admin-tab-report').click();
    await page.getByTestId('wallet-report').getByText('Incentives generated').waitFor();
    check(/₹2,50,000/.test(await text(page, '[data-testid="report-salary"]')) && /payroll not tracked/i.test(await text(page, '[data-testid="report-salary"]')), 'Report: the salary payable, from the HR figures, and that payroll is not tracked');
    check(/₹90,000/.test(await text(page, '[data-testid="report-generated"]')), 'Report: incentives generated');
    const rep = await text(page, '[data-testid="wallet-report"]');
    check(/Pending withdrawals 2/i.test(rep) && /Paid withdrawals ₹30,000/i.test(rep) && /Withdrawal requests 7/i.test(rep) && /Pending incentive approvals ₹0/i.test(rep), 'Report: withdrawal requests, pending and paid; pending incentive approvals', rep.slice(0, 400));
    check((await page.locator('[data-testid="report-departments"] tbody tr').count()) === 2 && (await page.locator('[data-testid="report-employees"] tbody tr').count()) === 1 && (await page.locator('[data-testid="report-months"] tbody tr').count()) === 2, 'Report: department-wise, employee-wise and monthly tables');
    await page.fill('input[aria-label="Report from"]', '2026-10-01');
    await page.waitForFunction(() => window.__calls.some(c => c.fn === 'wallet_report' && c.args.p_from === '2026-10-01'));
    check(true, 'Report: changing the period asks the database again');
    check(errors.length === 0, 'Accounts: no script errors', errors);
    await ctx.close();
  }
  console.log(`=== WALLET BROWSER CHECKS PASSED (${passed}) ===`);
} finally {
  await browser.close();
  srv.close();
}
