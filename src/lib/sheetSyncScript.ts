/**
 * The Google Apps Script the CRM gives a person who connects their customer sheet (docs/CUSTOMER_SHEET_SYNC.md). It is pasted into the sheet
 * (Extensions > Apps Script) and adds a "CRM Sync" menu. Nothing runs on a timer: the CRM is called only when someone clicks Sync now, with
 * the rows that changed since the last sync (a hidden "CRM Sync Hash" column remembers each row as it was saved), in batches of 400 rows.
 * Each row's result is written into a "CRM Status" column. "@OnlyCurrentDoc" limits the script to this one spreadsheet.
 */
export const SHEET_SYNC_SCRIPT_VERSION = 1;

export function buildSheetSyncScript(opts: { url: string; key: string; connectedBy: string; date: string }): string {
  const q = (s: string) => JSON.stringify(s);
  return `/**
 * @OnlyCurrentDoc
 * Amuwa CRM - customer sheet sync (version ${SHEET_SYNC_SCRIPT_VERSION}).
 * Made by the CRM for ${opts.connectedBy.replace(/\*\//g, '')} on ${opts.date}. Customers synced from this sheet are saved with that person's CRM permissions.
 *
 * HOW TO USE: Extensions > Apps Script > replace everything with this script > Save. Reload the sheet, then "CRM Sync > Sync now".
 * The first time, Google asks you to allow the script to edit this sheet and to connect to the CRM: allow both.
 * Keep this script private: the key below lets this sheet add customers to the CRM. Lost or shared? Get a new script in the CRM
 * (Import Customers > Google Sheet sync > Get a new script): the old key stops working at once.
 */
var CRM_SYNC_URL = ${q(opts.url)};
var CRM_SYNC_KEY = ${q(opts.key)};
var CRM_SCRIPT_VERSION = ${SHEET_SYNC_SCRIPT_VERSION};
var CRM_SHEET_NAME = 'Import';  // the tab with the customers (else the first tab with the template's headings)
var CRM_BATCH_ROWS = 400;

function onOpen() {
  SpreadsheetApp.getUi().createMenu('CRM Sync')
    .addItem('Sync now', 'crmSyncNow')
    .addItem('Send every row again', 'crmSyncEveryRow')
    .addToUi();
}
function crmSyncNow() { crmSync_(false); }
function crmSyncEveryRow() { crmSync_(true); }

function crmNorm_(v) { return String(v == null ? '' : v).replace(/\\*/g, '').replace(/\\s+/g, ' ').trim().toLowerCase(); }
function crmIsHeader_(row) {
  var h = row.map(crmNorm_);
  return (h.indexOf('mobile number') >= 0 && h.indexOf('business name') >= 0) || (h.indexOf('relationship manager') >= 0 && h.indexOf('service 1') >= 0);
}
function crmFindSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var named = ss.getSheetByName(CRM_SHEET_NAME);
  var sheets = named ? [named] : ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var top = sheets[i].getRange(1, 1, Math.min(6, Math.max(1, sheets[i].getLastRow())), Math.max(1, sheets[i].getLastColumn())).getValues();
    for (var j = 0; j < top.length; j++) if (crmIsHeader_(top[j])) return { sheet: sheets[i], hdr: j };
  }
  return null;
}
function crmCell_(v) {
  if (v === '' || v == null) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v).slice(0, 2000);
}
function crmHash_(cells) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(cells), Utilities.Charset.UTF_8);
  return d.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
var CRM_LABEL = { ADDED: '\\u2705 Added', UPDATED: '\\uD83D\\uDD01 Updated', SAVED: '\\u2705 Saved', DUPLICATE: '\\u26A0\\uFE0F Possible duplicate', ERROR: '\\u274C Fix this', SKIPPED: '\\u23F8 Not saved' };
var CRM_DONE = { ADDED: true, UPDATED: true, SAVED: true };

function crmSync_(everyRow) {
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(2000)) { ui.alert('A sync is already running. Wait for it to finish.'); return; }
  try {
    var found = crmFindSheet_();
    if (!found) { ui.alert('The customer headings were not found. Use the CRM\\'s one-sheet customer template (a tab named "' + CRM_SHEET_NAME + '").'); return; }
    var sheet = found.sheet, hdr = found.hdr;
    var values = sheet.getDataRange().getValues();
    var head = values[hdr].map(crmNorm_);
    var statusCol = head.indexOf('crm status'), hashCol = head.indexOf('crm sync hash');
    var width = values[hdr].length;
    if (statusCol < 0) { statusCol = width++; sheet.getRange(hdr + 1, statusCol + 1).setValue('CRM Status').setFontWeight('bold'); }
    if (hashCol < 0) { hashCol = width++; sheet.getRange(hdr + 1, hashCol + 1).setValue('CRM Sync Hash'); sheet.hideColumns(hashCol + 1); }
    values = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), hdr + 1), width).getValues();
    var keep = function (row) { return row.filter(function (_, j) { return j !== statusCol && j !== hashCol; }); };
    var header = values.slice(0, hdr + 1).map(function (r) { return keep(r).map(crmCell_); });
    var mobileAt = header[hdr].map(crmNorm_).indexOf('mobile number');
    if (mobileAt < 0) mobileAt = header[hdr].map(crmNorm_).indexOf('mobile');
    var pending = [], hashes = {};
    for (var i = hdr + 1; i < values.length; i++) {
      var cells = keep(values[i]).map(crmCell_);
      if (!cells.some(function (c) { return c !== null; })) continue;
      if (cells.some(function (c) { return typeof c === 'string' && /\\bEXAMPLE\\b/.test(c); })) continue;
      if (mobileAt >= 0 && String(cells[mobileAt] || '').replace(/\\D/g, '') === '9820011111') continue;
      var h = crmHash_(cells);
      if (!everyRow && String(values[i][hashCol]) === h) continue;
      hashes[i + 1] = h;
      pending.push({ r: i + 1, c: cells });
    }
    if (!pending.length) { ui.alert('Nothing new to send: every row is already in the CRM.'); return; }
    var status = sheet.getRange(hdr + 2, statusCol + 1, values.length - hdr - 1, 1).getValues();
    var stored = sheet.getRange(hdr + 2, hashCol + 1, values.length - hdr - 1, 1).getValues();
    var total = { added: 0, updated: 0, saved: 0, rejected: 0, duplicates: 0 };
    var when = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd-MMM HH:mm');
    for (var b = 0; b < pending.length; b += CRM_BATCH_ROWS) {
      var res = UrlFetchApp.fetch(CRM_SYNC_URL, {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        headers: { Authorization: 'Bearer ' + CRM_SYNC_KEY },
        payload: JSON.stringify({ sheetName: sheet.getName(), scriptVersion: CRM_SCRIPT_VERSION, header: header, rows: pending.slice(b, b + CRM_BATCH_ROWS) })
      });
      var body = null;
      try { body = JSON.parse(res.getContentText()); } catch (e) { body = null; }
      if (!body || !body.success) {
        var msg = body && body.error && body.error.message ? body.error.message : 'The CRM did not answer (HTTP ' + res.getResponseCode() + '). Try again in a minute.';
        status.length && sheet.getRange(hdr + 2, statusCol + 1, status.length, 1).setValues(status);
        stored.length && sheet.getRange(hdr + 2, hashCol + 1, stored.length, 1).setValues(stored);
        ui.alert('CRM sync stopped: ' + msg + (b > 0 ? '\\n\\nThe rows before this batch were synced.' : ''));
        return;
      }
      var out = body.data;
      out.results.forEach(function (x) {
        var k = x.row - hdr - 2;
        if (k < 0 || k >= status.length) return;
        status[k][0] = (CRM_LABEL[x.status] || x.status) + ' (' + when + '): ' + x.message;
        stored[k][0] = CRM_DONE[x.status] ? (hashes[x.row] || '') : '';
      });
      ['added', 'updated', 'saved', 'rejected', 'duplicates'].forEach(function (f) { total[f] += out.summary[f] || 0; });
    }
    sheet.getRange(hdr + 2, statusCol + 1, status.length, 1).setValues(status);
    sheet.getRange(hdr + 2, hashCol + 1, stored.length, 1).setValues(stored);
    ui.alert('CRM sync done.\\n\\nNew customers added: ' + total.added + '\\nAlready in the CRM, updated: ' + total.updated + '\\nOther rows saved: ' + total.saved +
      '\\nPossible duplicates (held): ' + total.duplicates + '\\nTo fix: ' + total.rejected + '\\n\\nSee the "CRM Status" column for each row.');
  } finally {
    lock.releaseLock();
  }
}
`;
}
