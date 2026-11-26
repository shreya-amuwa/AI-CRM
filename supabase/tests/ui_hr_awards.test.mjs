// Browser test of HR Awards (20270203000100) in the real HR dashboard panel: Award Management's menu reads Birthdays, Anniversaries, Awards
// (Awards last); the existing anniversary card still shows; the seven award cards; HR adds several nominees to one award (from the CRM's
// employees, never typed), edits and removes one, declares one winner and then a second, sees winners apart from nominees, revokes a winner
// after confirming; another month starts empty and the earlier month is unchanged; a reload shows what was saved; a refusal is shown.
// Real React components, real Chromium; the CRM API is answered by a stateful fake below (the database rules are tested in hr_awards_test.sql).
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', 'playwright-core']) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.log('SKIPPED - Playwright is not installed, the HR Awards browser test did not run'); process.exit(0); }
const work = mkdtempSync(path.join(tmpdir(), 'aw-ui-'));
const out = path.join(work, 'app.js');
await build({
  entryPoints: ['supabase/tests/ui/hr_awards_harness.tsx'], bundle: true, format: 'iife', platform: 'browser', outfile: out, define: { 'import.meta.env': '{}' },
  jsx: 'automatic', logLevel: 'error', loader: { '.css': 'empty', '.png': 'empty', '.svg': 'empty', '.jpg': 'empty' },
  plugins: [{ name: 'stubs', setup(b) {
    b.onResolve({ filter: /services\/supabaseClient$/ }, () => ({ path: path.resolve('supabase/tests/ui/hr_awards_stubs.ts') }));
    b.onResolve({ filter: /\/context\/(AuthContext|LeadStoreContext|NotificationContext)$/ }, () => ({ path: path.resolve('supabase/tests/ui/hr_awards_contexts.ts') }));
  } }]
});
const bundle = readFileSync(out, 'utf8');
const cssFile = existsSync('dist/assets') ? readdirSync('dist/assets').find(f => /^index-.*\.css$/.test(f)) : null;
const css = cssFile ? readFileSync(path.join('dist/assets', cssFile), 'utf8') : '';

import { AWARDS, control, handle, label, state } from './ui/hr_awards_fake_api.mjs';

let passed = 0;
const check = (ok, name, extra) => { if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exitCode = 1; throw new Error(`failed: ${name}`); } passed++; console.log('ok -', name); };
let browser;
try { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); } catch (e) { console.log('SKIPPED - Chromium could not be started:', String(e.message).split('\n')[0]); process.exit(0); }
const errors = [];
const open = async (viewport = { width: 1280, height: 1000 }) => {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', e => errors.push(e.message));
  await page.route('http://aw.test/api/v1/**', async route => {
    const req = route.request();
    const r = handle(req.method(), new URL(req.url()), req.postData() ? JSON.parse(req.postData()) : undefined);
    await route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.body) });
  });
  await page.route('http://aw.test/', route => route.fulfill({ status: 200, contentType: 'text/html',
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><div id="root"></div></body></html>' }));
  await page.goto('http://aw.test/');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => window.mount());
  return page;
};
const openAwardManagement = async page => {
  await page.getByRole('heading', { name: 'Award Management' }).click();
  await page.getByRole('navigation', { name: 'Award Management' }).waitFor();
};
const awardNav = page => page.getByRole('navigation', { name: 'Award Management' });
const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
const shift = (m, by) => { const [y, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mm - 1 + by, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

try {
  let page = await open();
  await openAwardManagement(page);
  const items = await awardNav(page).getByRole('button').allInnerTexts();
  check(JSON.stringify(items.map(s => s.trim())) === JSON.stringify(['Birthdays', 'Anniversaries', 'Awards']), 'Award Management: Birthdays, Anniversaries, then Awards (below them)', items);
  check(await page.getByText('Anita Anniversary').isVisible(), 'the existing anniversary card still shows under Anniversaries');
  await awardNav(page).getByRole('button', { name: 'Birthdays' }).click();
  check(await page.getByText('Upcoming Birthdays (Within 30 Days)').isVisible() && !(await page.getByText('Anita Anniversary').isVisible()), 'Birthdays shows the birthday list');
  await awardNav(page).getByRole('button', { name: 'Awards' }).click();
  await page.getByRole('button', { name: /^Manage .* of the Month$/ }).first().waitFor();
  const cards = await page.getByRole('button', { name: /^Manage .* of the Month$/ }).count();
  check(cards === 7, 'the seven award cards', cards);
  for (const [, name] of AWARDS) check(await page.getByRole('heading', { name }).isVisible(), `card: ${name}`);
  check(await page.getByText(label(thisMonth())).first().isVisible(), 'each card shows the award period');

  // several nominees under Rising Star
  await page.getByRole('button', { name: 'Manage Rising Star of the Month' }).click();
  await page.getByText('Award overview').waitFor();
  await page.getByRole('button', { name: 'Add Nominee' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('option').first().waitFor();
  check(await dialog.getByRole('radio', { name: 'Team' }).isDisabled() && await dialog.getByRole('radio', { name: 'Individual' }).isChecked(), 'the nominee type follows the award (Individual)');
  await dialog.getByRole('button', { name: 'Add nominee' }).click();
  check(await dialog.getByText('Choose who is nominated.').isVisible(), 'the form asks for the nominee first (the shared schema)');
  for (const [i, who] of ['Employee A', 'Employee B', 'Employee C', 'Employee D'].entries()) {
    await dialog.getByLabel(/Nominee \(employee\)/).fill(who.slice(-1) === 'A' ? 'employee a' : who);
    await dialog.getByRole('option', { name: new RegExp(who) }).getByRole('button').click();
    check(await dialog.getByTestId('nominee-department').innerText() === 'Wabastore' && await dialog.getByTestId('nominee-designation').innerText() === 'Executive', `${who}: department and designation come from the CRM`);
    await dialog.getByLabel('Reason for nomination').fill(`Reason for ${who}`);
    if (i === 0) await dialog.getByLabel('Supporting remarks').fill('Customer praise');
    await dialog.getByRole('button', { name: i < 3 ? 'Save & add another' : 'Add nominee' }).click();
    if (i < 3) await dialog.getByLabel('Reason for nomination').and(page.locator(':placeholder-shown')).waitFor();
  }
  await dialog.waitFor({ state: 'detached' });
  check((await page.locator('tbody tr').count()) === 4, 'four nominees under the same award');
  check(state.nominees.length === 4 && state.nominees[0].remarks === 'Customer praise', 'saved through the API (with the remarks)', state.nominees.map(n => n.name));

  // the same person twice: the server's message is shown
  await page.getByRole('button', { name: 'Add Nominee' }).first().click();
  await dialog.getByRole('option').first().waitFor();
  check(await dialog.getByRole('option', { name: /Employee A/ }).getByText('Already nominated').isVisible()
    && await dialog.getByRole('option', { name: /Employee A/ }).getByRole('button').isDisabled(), 'someone already nominated cannot be picked again');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // edit and remove
  await page.getByRole('button', { name: 'Edit nomination of Employee D' }).click();
  await dialog.getByLabel('Reason for nomination').fill('Edited reason for D');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Edited reason for D').waitFor();
  check(true, 'HR edits a nomination');
  await page.getByRole('button', { name: 'Remove Employee D' }).click();
  check(await dialog.getByText('Remove Employee D?').isVisible(), 'removing asks for confirmation');
  await dialog.getByRole('button', { name: 'Remove nominee' }).click();
  await dialog.waitFor({ state: 'detached' });
  check((await page.locator('tbody tr').count()) === 3, 'HR removes a nominee');

  // one winner, then a second
  await page.getByRole('button', { name: 'Declare Employee A a winner' }).click();
  check(await dialog.getByRole('checkbox', { name: /Employee A/ }).isChecked() && !(await dialog.getByRole('checkbox', { name: /Employee B/ }).isChecked()), 'Declare from a row preselects that nominee only');
  await dialog.getByLabel('Winner remarks').fill('Top of the month');
  await dialog.getByRole('button', { name: /Review 1 winner/ }).click();
  check(await dialog.getByText('Confirm winner declaration').isVisible() && await dialog.getByText('Top of the month').isVisible(), 'a confirmation shows the winners and remarks before saving');
  check(!state.winners.length, 'nothing is saved before the confirmation');
  await dialog.getByRole('button', { name: /Confirm 1 winner/ }).click();
  await dialog.waitFor({ state: 'detached' });
  const winners = page.getByRole('region', { name: /Winners/ }).or(page.locator('section[aria-labelledby="award-winners"]'));
  check(await winners.getByText('Employee A').isVisible() && await winners.getByText('Top of the month').isVisible(), 'a single winner is declared and shown in Winners');
  await page.getByRole('button', { name: 'Declare Winner' }).click();
  check(!(await dialog.getByRole('checkbox', { name: /Employee A/ }).count()), 'a declared winner is not offered again');
  await dialog.getByRole('checkbox', { name: /Employee C/ }).check();
  await dialog.getByRole('button', { name: /Review 1 winner/ }).click();
  await dialog.getByRole('button', { name: /Confirm 1 winner/ }).click();
  await dialog.waitFor({ state: 'detached' });
  const winnerItems = await winners.locator('li').allInnerTexts();
  check(winnerItems.length === 2 && winnerItems.some(t => t.includes('Employee A')) && winnerItems.some(t => t.includes('Employee C')) && !winnerItems.some(t => t.includes('Employee B')),
    'two winners shown separately; Employee B stays a nominee', winnerItems);
  check((await page.locator('tbody tr', { hasText: 'Employee B' }).getByText('Nominated').count()) === 1
    && (await page.locator('tbody tr', { hasText: 'Employee C' }).getByText('Winner').count()) === 1, 'the nominee table marks winners and nominees differently');
  check((await page.locator('dd', { hasText: /^2$/ }).count()) >= 1, 'the overview counts 2 winners');

  // a winner cannot be removed while declared; revoke needs confirmation and a reason
  await page.getByRole('button', { name: 'Remove Employee C' }).click();
  await dialog.getByRole('button', { name: 'Remove nominee' }).click();
  await dialog.getByText('Revoke the winner declaration first.').waitFor();
  check(true, 'the server refusal is shown in the dialog');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Revoke Employee C as winner' }).click();
  check(await dialog.getByText('Revoke Employee C as winner?').isVisible(), 'revoking asks for confirmation');
  await dialog.getByRole('button', { name: 'Revoke winner' }).click();
  await dialog.getByText('Enter the reason (at least 3 characters).').waitFor();
  check(true, 'and a reason');
  await dialog.getByLabel('Reason for revoking').fill('Declared by mistake');
  await dialog.getByRole('button', { name: 'Revoke winner' }).click();
  await dialog.waitFor({ state: 'detached' });
  check((await winners.locator('> ul > li').count()) === 1, 'one winner left after revoking');
  await page.getByRole('button', { name: /Show revoked declarations \(1\)/ }).click();
  check(await page.getByText(/Declared by mistake/).isVisible(), 'the revoked declaration is kept on record');

  // month-wise: the next month starts empty; this month is unchanged
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByText(`No nominees for ${label(shift(thisMonth(), 1))} yet`).waitFor();
  check(true, 'the next month starts empty for the same award');
  await page.getByRole('button', { name: 'Previous month' }).click();
  await page.locator('tbody tr').first().waitFor();
  check((await page.locator('tbody tr').count()) === 3, 'the earlier month is unchanged');

  // back to the cards, then a reload: everything comes from the server again
  await page.getByRole('button', { name: 'All awards' }).click();
  const card = page.getByRole('article', { name: 'Rising Star of the Month' });
  check((await card.innerText()).includes('Winner declared') && /Nominees\s*3/i.test(await card.innerText()) && /Winners\s*1/i.test(await card.innerText()), 'the card: 3 nominees, 1 winner, Winner declared', await card.innerText());
  await page.close();

  page = await open({ width: 390, height: 844 });
  await openAwardManagement(page);
  await awardNav(page).getByRole('button', { name: 'Awards' }).click();
  await page.getByRole('button', { name: 'Manage Rising Star of the Month' }).click();
  const phoneList = page.locator('section[aria-labelledby="award-nominees"] ul > li');
  await phoneList.first().waitFor();
  check((await phoneList.count()) === 3 && !(await page.locator('table').isVisible()) && await page.locator('section[aria-labelledby="award-winners"]').getByText('Employee A').isVisible(),
    'after a reload the saved nominees and winner are there (as cards on a phone, no table)');
  check(await phoneList.first().getByRole('button', { name: /Edit nomination of/ }).isVisible(), 'the nominee actions are reachable on a phone');
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check(scrollW <= 392, 'no sideways page scroll on a phone', scrollW);
  await page.close();

  // someone who may not manage awards sees the refusal
  control.forbidden = true;
  page = await open();
  await openAwardManagement(page);
  await awardNav(page).getByRole('button', { name: 'Awards' }).click();
  await page.getByText('Only HR staff manage awards.').waitFor();
  check(true, 'a refused user sees the server message, no award cards');
  await page.close();
  check(!errors.length, 'no page errors', errors);
  console.log(`=== ${passed} HR AWARDS BROWSER CHECKS PASSED ===`);
} finally {
  await browser.close();
}
