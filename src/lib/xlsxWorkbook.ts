import JSZip from 'jszip';

/**
 * A multi-sheet .xlsx writer for reports (the attendance statement, docs/hr-dashboard-upgrade.md), next to the one-sheet xlsxWriter.
 * - Text stays text (employee codes keep their leading zeros), numbers are numbers, dates / times / durations are real Excel values with formats.
 * - The header row of a table sheet is bold, frozen and has an AutoFilter.
 * - Text that a spreadsheet would run as a formula (= + - @, tab, carriage return) is prefixed with an apostrophe-like quote character, so a
 *   name or a remark can never become a formula (formula injection).
 */
export type XCell =
  | string | number | null | undefined
  | { date: string }            // YYYY-MM-DD
  | { datetime: string | null } // ISO timestamp, shown in Asia/Kolkata
  | { time: string | null }     // ISO timestamp, the time of day in Asia/Kolkata
  | { minutes: number | null }; // a duration, shown as [h]:mm
export interface XSheet { name: string; rows: XCell[][]; widths?: number[]; table?: boolean }

const esc = (v: string) =>
  v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Text that starts like a formula is neutralised (shared with the CSV writer). */
export const safeText = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

function columnName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const EPOCH = Date.UTC(1899, 11, 30);
const IST = 330 * 60_000;
/** Excel serial number of a calendar day (YYYY-MM-DD). */
export function excelDate(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return (Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - EPOCH) / 86_400_000;
}
/** Excel serial of a timestamp in India time (date + fraction of the day). */
export function excelDateTime(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (t + IST - EPOCH) / 86_400_000;
}

// styles: 0 default, 1 header bold, 2 text, 3 date, 4 date-time, 5 time, 6 duration [h]:mm, 7 number
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="dd-mmm-yyyy"/><numFmt numFmtId="165" formatCode="dd-mmm-yyyy hh:mm"/><numFmt numFmtId="166" formatCode="hh:mm"/><numFmt numFmtId="167" formatCode="[h]:mm"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(ref: string, v: XCell, header: boolean): string {
  if (v === null || v === undefined || v === '') return '';
  if (header || typeof v === 'string') {
    const text = header ? String(v) : safeText(v as string);
    return `<c r="${ref}" t="inlineStr" s="${header ? 1 : 2}"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}" s="7"><v>${v}</v></c>` : '';
  if ('date' in v) { const n = excelDate(v.date); return n === null ? '' : `<c r="${ref}" s="3"><v>${n}</v></c>`; }
  if ('datetime' in v) { const n = v.datetime ? excelDateTime(v.datetime) : null; return n === null ? '' : `<c r="${ref}" s="4"><v>${n}</v></c>`; }
  if ('time' in v) { const n = v.time ? excelDateTime(v.time) : null; return n === null ? '' : `<c r="${ref}" s="5"><v>${n - Math.floor(n)}</v></c>`; }
  if ('minutes' in v) return v.minutes === null || v.minutes === undefined ? '' : `<c r="${ref}" s="6"><v>${v.minutes / 1440}</v></c>`;
  return '';
}

function sheetXml(s: XSheet): string {
  const headerRow = s.table ? s.rows.findIndex(r => r.length > 1) : -1;
  const width = Math.max(1, ...s.rows.map(r => r.length));
  const body = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cellXml(`${columnName(ci)}${ri + 1}`, v, ri === headerRow)).join('')}</row>`).join('');
  const cols = (s.widths ?? []).length ? `<cols>${(s.widths ?? []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const freeze = headerRow >= 0
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow + 1}" topLeftCell="A${headerRow + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
  const filter = headerRow >= 0 && s.rows.length > headerRow + 1 ? `<autoFilter ref="A${headerRow + 1}:${columnName(width - 1)}${s.rows.length}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${freeze}${cols}<sheetData>${body}</sheetData>${filter}</worksheet>`;
}

export async function writeWorkbook(sheets: XSheet[]): Promise<Blob> {
  const zip = new JSZip();
  const names = sheets.map((s, i) => esc(s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`));
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${sheets.map((s, i) => {
    const h = s.table ? s.rows.findIndex(r => r.length > 1) : -1;
    if (h < 0 || s.rows.length <= h + 1) return '';
    const w = Math.max(1, ...s.rows.map(r => r.length));
    return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${names[i].replace(/'/g, "''")}'!$A$${h + 1}:$${columnName(w - 1)}$${s.rows.length}</definedName>`;
  }).join('')}</definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.file('xl/styles.xml', STYLES);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** CSV (UTF-8 with BOM so Excel reads names correctly), formula-safe, CRLF line ends. */
export function csvBlob(rows: (string | number | null | undefined)[][]): Blob {
  const cell = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(v) : safeText(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return new Blob(['﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}
