// Google Sheet sync of existing customers in a real browser (docs/CUSTOMER_SHEET_SYNC.md): a Support Team Member opens Import Customers, connects
// the sheet and copies the script; the sheet's "Sync now" is played by calling the CRM exactly as the script does (with the URL and key read from
// the script on the page); the page then shows the sync; a new script replaces the key; Disconnect stops the sheet. Passwords are made up at run time.
import { chromium } from 'playwright-core';
import crypto from 'node:crypto';
import pg from 'pg';

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const OUT = process.argv[2] || '.';
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const sign = p => { const e = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p }); return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`; };
const db = new pg.Pool();
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const api = async (who, method, path, body) => {
  const j = await (await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${sign({ sub: who, role: 'authenticated' })}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
  if (!j.success) throw new Error(path + JSON.stringify(j));
  return j.data;
};

const browser = await chromium.launch(process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {});
let step = 0; const ok = m => console.log(`ok ${++step} - ${m}`);
let page;
const fail = async m => { await page?.screenshot({ path: `${OUT}/sheet-sync-fail.png`, fullPage: true }).catch(() => {}); console.error('FAILED:', m); await browser.close().catch(() => {}); process.exit(1); };
const expect = (c, m, detail) => (c ? ok(m) : fail(detail === undefined ? m : `${m} ${JSON.stringify(detail).slice(0, 600)}`));
process.on('uncaughtException', e => fail(`an unexpected error: ${String(e.message).split('\n').slice(0, 4).join(' | ')}`));
process.on('unhandledRejection', e => fail(`an unexpected error: ${String(e?.message ?? e).split('\n').slice(0, 4).join(' | ')}`));

// ------------------------------------------------------------------ a Support Team Member of Wabastore
const sa = (await q(`select id from public.profiles where email = 'root@amuwa.com'`))[0].id;
const support = (await q(`select t.id from public.teams t join public.departments d on d.id = t.department_id where d.slug = 'wabastore' and t.name = 'Support'`))[0].id;
const password = `${crypto.randomBytes(9).toString('base64url')}-Aa1`;
const member = await api(sa, 'POST', '/users', { email: 'sheet.member@amuwa.com', fullName: 'Sheet Member', password, role: 'TEAM_MEMBER', teamId: support });
ok('fixture: a Support Team Member');

const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
page = await ctx.newPage();
await page.goto(BASE + '/login');
await page.getByPlaceholder('name@amuwa.com').fill('sheet.member@amuwa.com');
await page.locator('input[type="password"]').first().fill(password);
await page.locator('form button[type="submit"]').click();
await page.waitForSelector('nav button', { timeout: 25000, state: 'attached' }).catch(() => fail('the member did not reach the dashboard'));
await page.locator('nav button').filter({ hasText: /^\s*Import Customers\s*$/ }).first().click();
await page.waitForSelector('[data-testid="sheet-sync"]', { timeout: 20000 }).catch(() => fail('the Google Sheet sync panel is not on Import Customers'));
expect(await page.getByText('Not connected').count() > 0, 'Import Customers shows the Google Sheet sync panel, not connected');

await page.getByTestId('sheet-sync-connect').click();
await page.waitForSelector('[data-testid="sheet-sync-script"]', { timeout: 15000 }).catch(() => fail('the script was not shown'));
const script = await page.getByTestId('sheet-sync-script').inputValue();
const url = /var CRM_SYNC_URL = "([^"]+)"/.exec(script)?.[1];
const key = /var CRM_SYNC_KEY = "([^"]+)"/.exec(script)?.[1];
expect(url === `${BASE}/api/v1/integrations/customer-sheet/sync` && /^crmss_/.test(key ?? '') && script.includes('Sheet Member') && script.includes('@OnlyCurrentDoc'),
  'connecting shows the Apps Script with this CRM\'s address, the key and the person', { url, key: key?.slice(0, 8) });
await page.getByTestId('sheet-sync-copy').click();
expect(await page.evaluate(() => navigator.clipboard.readText()) === script, 'Copy script puts the whole script on the clipboard');
expect((await q(`select count(*)::int n from public.customer_sheet_connections where owner_id = $1 and status = 'ACTIVE' and key_hash = $2`,
  [member.id, crypto.createHash('sha256').update(key).digest('hex')]))[0].n === 1, 'the database keeps only the key\'s hash');

// ------------------------------------------------------------------ "Sync now" in the sheet (what the script sends)
const header = [['CUSTOMER', null, null, null, 'SERVICE BOUGHT'], ['Mobile Number', 'Customer Name', 'Business Name', 'E-mail', 'Service', 'Status', 'Start Date', 'Client Password']];
const send = body => fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
const r1 = await send({ sheetName: 'Import', scriptVersion: 1, header, rows: [
  { r: 8, c: ['9000008401', 'Neha Shah', 'Neha Boutique', 'neha.sheet@example.com', 'AI Calling', 'Live', '2026-01-10', 'Never-Used-Pass1'] },
  { r: 9, c: ['9000008402', 'No Business', null, null, null, null, null, null] }
] });
const res = row => r1.data?.results?.find(x => x.row === row);
expect(r1.success && res(8)?.status === 'ADDED' && res(9)?.status === 'ERROR', 'Sync now: the new customer is added, the wrong row says what to fix', r1);
expect((await q(`select count(*)::int n from public.customers where phone = '9000008401' and owner_id = $1`, [member.id]))[0].n === 1, 'the customer is in the CRM once, as the member\'s');
const r2 = await send({ sheetName: 'Import', scriptVersion: 1, header, rows: [{ r: 8, c: ['9000008401', 'Neha Shah', 'Neha Boutique', 'neha.sheet@example.com', 'AI Calling', 'Live', '2026-01-10', null] }] });
expect(r2.success && r2.data.results[0].status === 'UPDATED' && (await q(`select count(*)::int n from public.customers where phone = '9000008401'`))[0].n === 1,
  'syncing again never makes a second customer', r2);

await page.getByRole('button', { name: 'Done' }).click();
await page.reload();
await page.locator('nav button').filter({ hasText: /^\s*Import Customers\s*$/ }).first().click();
await page.waitForSelector('[data-testid="sheet-sync-runs"]', { timeout: 20000 }).catch(() => fail('the recent syncs are not shown'));
const runs = await page.getByTestId('sheet-sync-runs').innerText();
expect(/Connected/.test(await page.getByTestId('sheet-sync').innerText()) && runs.split('\n').length >= 3 && await page.getByTestId('sheet-sync-last').innerText() !== 'never',
  'the page shows the sheet as connected with its last sync and recent syncs', runs);
await page.screenshot({ path: `${OUT}/sheet-sync-connected.png`, fullPage: true });

// ------------------------------------------------------------------ a new script replaces the key; disconnect
await page.getByTestId('sheet-sync-replace').click();
await page.getByRole('button', { name: 'Yes, get a new script' }).click();
await page.waitForSelector('[data-testid="sheet-sync-script"]', { timeout: 15000 }).catch(() => fail('the new script was not shown'));
const key2 = /var CRM_SYNC_KEY = "([^"]+)"/.exec(await page.getByTestId('sheet-sync-script').inputValue())?.[1];
const old = await send({ header, rows: [] });
expect(key2 && key2 !== key && !old.success && old.error?.code === 'FORBIDDEN', 'a new script has a new key and the old one stops working at once', old);
await page.getByRole('button', { name: 'Done' }).click();
await page.getByTestId('sheet-sync-disconnect').click();
await page.getByTestId('sheet-sync-disconnect-yes').click();
await page.waitForSelector('[data-testid="sheet-sync-connect"]', { timeout: 15000 }).catch(() => fail('Disconnect did not return to "Connect Google Sheet"'));
const after = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key2}`, 'content-type': 'application/json' }, body: JSON.stringify({ header, rows: [] }) }).then(r => r.json());
expect(!after.success && after.error?.code === 'FORBIDDEN', 'after Disconnect the sheet cannot send anything', after);
expect((await q(`select count(*)::int n from public.customers where phone = '9000008401'`))[0].n === 1, 'the customers already saved stay');

// phone width: the panel fits
await page.setViewportSize({ width: 390, height: 844 });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
expect(overflow <= 1, 'the panel fits a phone screen (no sideways scroll)', overflow);
console.log(`ALL ${step} GOOGLE SHEET SYNC BROWSER CHECKS PASSED`);
await browser.close();
await db.end();
