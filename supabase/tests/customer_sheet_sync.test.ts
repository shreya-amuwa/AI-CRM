// Google Sheet sync of existing customers (docs/CUSTOMER_SHEET_SYNC.md): the server rebuilds the sheet from what the script sends and reads it with
// the Excel import's own parser; the key's shape is checked; and the generated Apps Script, run against a simulated Google Sheet, sends only new
// and changed rows, writes every row's result into "CRM Status", remembers saved rows, and re-sends the ones that still need fixing.
import { createHash } from 'node:crypto';
import { parseExistingCustomers } from '../../shared/existingCustomerImport';
import { sheetFromSync, sheetSyncKeyFrom, sheetSyncKeyHash } from '../../server/services/SheetSyncService';
import { buildSheetSyncScript } from '../../src/lib/sheetSyncScript';

let passed = 0;
const check = (cond: unknown, msg: string, detail?: unknown) => {
  if (!cond) {
    console.error('FAILED:', msg, detail === undefined ? '' : JSON.stringify(detail).slice(0, 800));
    process.exit(1);
  }
  passed++;
  console.log('ok -', msg);
};

// ---------------------------------------------------------------- the server side
const header = [['CUSTOMER', null, null, 'SERVICE BOUGHT'], ['Mobile Number', 'Customer Name', 'Business Name', 'Service', 'Status', 'Start Date', 'CRM Status']];
const wb = sheetFromSync({ header, rows: [{ r: 5, c: ['9000000501', 'Asha', 'Asha Co', 'AI Calling', 'Live', '2026-01-05', '✅ Added'] }, { r: 2, c: ['ignored heading row'] }] });
check(wb.sheets[0].rows.length === 5 && wb.sheets[0].rows[4]?.[0] === '9000000501' && wb.sheets[0].rows[1]?.[0] === 'Mobile Number', 'rows go back to their own sheet row numbers; a heading row is never overwritten');
const parsed = parseExistingCustomers(wb);
check(parsed.format === 'one-sheet' && parsed.data.customers?.[0]?.row === 5 && parsed.data.services?.[0]?.service === 'AI Calling', 'the Excel import parser reads it (row numbers kept)', parsed);
check(!parsed.ignored.some(c => /crm status/i.test(c)), 'the "CRM Status" column is not reported as an unknown heading');
const key = `crmss_${'A'.repeat(43)}`;
check(sheetSyncKeyFrom(`Bearer ${key}`) === key, 'a well-formed key is accepted');
for (const bad of [undefined, '', 'Bearer crmss_short', `Bearer xx_${'A'.repeat(43)}`, `Bearer ${key}x`]) {
  let threw = false;
  try { sheetSyncKeyFrom(bad); } catch { threw = true; }
  check(threw, `a malformed key is refused before the database is asked (${String(bad).slice(0, 20)})`);
}
check(sheetSyncKeyHash(key) === createHash('sha256').update(key).digest('hex'), 'only the SHA-256 hash of the key is used');

// ---------------------------------------------------------------- the Apps Script, against a simulated sheet
const script = buildSheetSyncScript({ url: 'https://crm.example.test/api/v1/integrations/customer-sheet/sync', key, connectedBy: 'Test */ Person', date: '25 Nov 2026' });
check(script.includes('@OnlyCurrentDoc') && script.includes(key) && !script.includes('Test */'), 'the script is limited to this spreadsheet, carries the key, and a name cannot close its comment');

type V = string | number | Date | null;
function makeSheet(grid: V[][]) {
  const at = (r: number, c: number) => (grid[r - 1]?.[c - 1] ?? '');
  const put = (r: number, c: number, v: V) => { while (grid.length < r) grid.push([]); grid[r - 1][c - 1] = v; };
  const width = () => Math.max(...grid.map(r => r.length));
  const range = (r: number, c: number, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => at(r + i, c + j))),
    setValues: (vals: V[][]) => vals.forEach((row, i) => row.forEach((v, j) => put(r + i, c + j, v))),
    setValue: (v: V) => { put(r, c, v); return { setFontWeight: () => undefined }; }
  });
  return {
    grid, hidden: [] as number[],
    getName: () => 'Import',
    getLastRow: () => grid.length,
    getLastColumn: () => width(),
    getRange: range,
    getDataRange: () => range(1, 1, grid.length, width()),
    hideColumns(c: number) { this.hidden.push(c); }
  };
}
const today = new Date(Date.UTC(2026, 0, 5));
const sheet = makeSheet([
  ['CUSTOMER', '', '', 'SERVICE BOUGHT', '', ''],
  ['Mobile Number', 'Customer Name', 'Business Name', 'Service', 'Status', 'Start Date'],
  ['9820011111', 'EXAMPLE', 'Example Co', 'AI Calling', 'Live', today],
  ['9000000601', 'Asha', 'Asha Co', 'AI Calling', 'Live', today],
  ['', '', '', '', '', ''],
  ['9000000602', 'Bala', '', '', '', '']
]);
const alerts: string[] = [];
const sent: any[] = [];
let answer: (body: any) => any = () => ({});
const g: Record<string, unknown> = {
  SpreadsheetApp: {
    getUi: () => ({ alert: (m: string) => alerts.push(m), createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }),
    getActiveSpreadsheet: () => ({ getSheetByName: (n: string) => (n === 'Import' ? sheet : null), getSheets: () => [sheet] })
  },
  LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => undefined }) },
  Session: { getScriptTimeZone: () => 'UTC' },
  Utilities: {
    formatDate: (d: Date, _tz: string, f: string) => (f === 'yyyy-MM-dd' ? d.toISOString().slice(0, 10) : 'now'),
    computeDigest: (_a: unknown, s: string) => [...createHash('md5').update(s, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
    DigestAlgorithm: { MD5: 'MD5' }, Charset: { UTF_8: 'UTF_8' }
  },
  UrlFetchApp: {
    fetch: (url: string, o: any) => {
      const body = JSON.parse(o.payload);
      sent.push({ url, auth: o.headers.Authorization, body });
      const reply = answer(body);
      return { getContentText: () => JSON.stringify(reply), getResponseCode: () => 200 };
    }
  }
};
const run = new Function(...Object.keys(g), `${script}\nreturn { crmSyncNow, crmSyncEveryRow, onOpen };`)(...Object.values(g)) as Record<string, () => void>;
run.onOpen();

answer = body => ({
  success: true,
  data: {
    results: body.rows.map((x: any) => (x.c[2] ? { row: x.r, status: 'ADDED', message: 'Added to the CRM.' } : { row: x.r, status: 'ERROR', message: 'Business Name is required.' })),
    summary: { added: body.rows.filter((x: any) => x.c[2]).length, updated: 0, saved: 0, rejected: body.rows.filter((x: any) => !x.c[2]).length, duplicates: 0 }
  }
});
run.crmSyncNow();
check(sent.length === 1 && sent[0].auth === `Bearer ${key}` && sent[0].url.endsWith('/integrations/customer-sheet/sync'), 'Sync now calls the CRM once, with the key', sent);
check(sent[0].body.rows.map((x: any) => x.r).join() === '4,6', 'only the filled rows are sent (the example row and the empty row are not)', sent[0].body.rows);
check(sent[0].body.rows[0].c[5] === '2026-01-05' && sent[0].body.header.length === 2, 'dates are sent as yyyy-mm-dd, with the heading rows', sent[0].body);
check(sheet.grid[1][6] === 'CRM Status' && sheet.grid[1][7] === 'CRM Sync Hash' && sheet.hidden.includes(8), 'the "CRM Status" and hidden "CRM Sync Hash" columns are added', sheet.grid[1]);
check(String(sheet.grid[3][6]).includes('Added') && String(sheet.grid[5][6]).includes('Business Name is required'), 'each row gets its result in CRM Status', sheet.grid.map(r => r[6]));
check(/^[0-9a-f]{32}$/.test(String(sheet.grid[3][7])) && !sheet.grid[5][7], 'a saved row is remembered; a row to fix is not', sheet.grid.map(r => r[7]));
check(/added: 1/i.test(alerts.at(-1) ?? '') && /To fix: 1/.test(alerts.at(-1) ?? ''), 'the person sees a summary', alerts);

run.crmSyncNow();
check(sent.length === 2 && sent[1].body.rows.map((x: any) => x.r).join() === '6', 'the next Sync now sends only the row that still needs fixing', sent[1]?.body.rows);
sheet.grid[5][2] = 'Bala Stores';
sheet.grid[3][1] = 'Asha K';
run.crmSyncNow();
check(sent.length === 3 && sent[2].body.rows.map((x: any) => x.r).join() === '4,6', 'an edited saved row is sent again (and the fixed one)', sent[2]?.body.rows);
check(sent[2].body.rows.every((x: any) => x.c.length === 6), 'the CRM columns are never sent back to the CRM', sent[2]?.body.rows);
run.crmSyncNow();
check(sent.length === 3 && /Nothing new/.test(alerts.at(-1) ?? ''), 'nothing changed: nothing is sent', alerts.at(-1));
run.crmSyncEveryRow();
check(sent.length === 4 && sent[3].body.rows.length === 2, '"Send every row again" sends all of them', sent[3]?.body.rows);

answer = () => ({ success: false, error: { code: 'FORBIDDEN', message: 'This sync key is not valid any more.' } });
sheet.grid[3][1] = 'Asha Kumari';
run.crmSyncNow();
check(/stopped: This sync key is not valid/.test(alerts.at(-1) ?? ''), 'a refusal from the CRM is shown to the person', alerts.at(-1));
check(String(sheet.grid[3][6]).includes('Added'), 'and the rows keep their earlier status', sheet.grid[3]);

console.log(`=== ${passed} CUSTOMER SHEET SYNC UNIT CHECKS PASSED ===`);
