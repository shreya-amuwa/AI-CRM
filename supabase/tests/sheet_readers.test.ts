/**
 * The lead-sheet readers (no database): a real Excel 97-2003 (.xls) workbook and CSV files give the same rows of cells as the .xlsx reader, so the
 * Sheet Upload of the Sales Department Head reads all three the same way; damaged, encrypted-looking and unreadable files are refused with a
 * message. Run: npm run test:unit
 */
import { decodeCsv, parseCsv, readCsv } from '../../src/lib/csvReader.js';
import { buildLeadRows, readLeadSheet } from '../../src/lib/salesLeadSheet.js';
import { isXlsFile, readXls } from '../../src/lib/xlsReader.js';
import { LEAD_SHEET_XLS_BASE64 } from './sheet_fixtures.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++;
  console.log(`ok - ${label}`);
}
const buf = (u8: Uint8Array) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
const refused = async (f: () => Promise<unknown> | unknown) => { try { await f(); return ''; } catch (e) { return (e as Error).message; } };

// ---- CSV
check(JSON.stringify(parseCsv('Name,Phone\r\nA One,9000000001\r\n')) === JSON.stringify([['Name', 'Phone'], ['A One', '9000000001']]), 'CSV: a heading row and a row (Windows line ends)');
check(JSON.stringify(parseCsv('Name,Company\n"Shah, Rina","Café ""Delhi"""\n"Two\nlines",x')) === JSON.stringify([['Name', 'Company'], ['Shah, Rina', 'Café "Delhi"'], ['Two\nlines', 'x']]),
  'CSV: quoted commas, doubled quotes and a line break inside quotes');
check(JSON.stringify(parseCsv('Name;Phone\nA;+91 98100 00001\n')) === JSON.stringify([['Name', 'Phone'], ['A', '+91 98100 00001']]), 'CSV: a ";" file (Excel in some regions) and the phone kept as written');
check(JSON.stringify(parseCsv('Name\tPhone\nA\t09810000001')) === JSON.stringify([['Name', 'Phone'], ['A', '09810000001']]), 'CSV: a tab-separated file, a leading 0 kept (every value is text)');
const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Name,Phone\nराम,9810000001')]);
check(JSON.stringify(readCsv(buf(bom)).sheets[0].rows) === JSON.stringify([['Name', 'Phone'], ['राम', '9810000001']]), 'CSV: UTF-8 with a byte-order mark (Excel "CSV UTF-8")');
check(decodeCsv(buf(new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x5a, 0x6f, 0xeb]))) === 'Name\nZoë', 'CSV: an older Windows-1252 file is still read');
check(/not a CSV/.test(await refused(() => readCsv(buf(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]))))), 'CSV: a binary file is refused');
check(/never closed/.test(await refused(() => parseCsv('Name\n"open'))), 'CSV: an unclosed quote is refused');

// ---- .xls (a real workbook saved by LibreOffice)
const xls = Buffer.from(LEAD_SHEET_XLS_BASE64, 'base64');
check(isXlsFile(buf(xls)) && !isXlsFile(buf(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]))), '.xls: recognised by its first bytes (an .xlsx is not)');
const book = await readXls(new Blob([xls]));
const rows = book.sheets[0].rows;
check(book.sheets.length === 1 && book.sheets[0].name === 'fixture' && rows.length === 231, '.xls: one sheet, the heading row and 230 contacts', { sheets: book.sheets.map(s => s.name), rows: rows.length });
check(JSON.stringify(rows[0]) === JSON.stringify(['Customer Name', 'Company Name', 'Mobile Number', 'Email', 'Remarks']), '.xls: the heading row');
check(rows[1][0] === 'Zoë Fernandes' && rows[1][1] === 'Café "Delhi", Pvt' && rows[1][2] === 9876500001 && rows[1][3] === 'zoe@example.com', '.xls: accents, a quoted comma, the phone as a number', rows[1]);
check(rows[2][0] === 'राम कुमार' && rows[2][1] === 'राम ट्रेडर्स' && rows[2][2] === '+91 98765 00002', '.xls: Hindi text, a phone written with spaces stays text', rows[2]);
check(rows[230][0] === 'Contact person 230 Sharma' && rows[230][4] === 'Interested in plan 230' && rows[230][2] === 9876500230, '.xls: the last row is read (the shared strings run over a CONTINUE record)', rows[230]);

// ---- the same import as an .xlsx: heading row, column matching, rows for the database
const read = readLeadSheet(rows);
check(!read.problem && read.mapping.name === 0 && read.mapping.company === 1 && read.mapping.phone === 2 && read.mapping.email === 3 && read.mapping.remarks === 4,
  'the .xls columns are matched like an .xlsx (Customer Name, Company Name, Mobile Number, Email, Remarks)', read.mapping);
const body = buildLeadRows(read, read.mapping);
check(body.length === 230 && body[0].row === 2 && body[0].phone === '9876500001' && body[2].name === '' && body[2].row === 4, 'rows for the database: numbers become text phones, the row numbers match the file, an empty name is sent (the database lists it)', body.slice(0, 3));
const csvRows = readCsv(buf(new TextEncoder().encode('Customer Name,Mobile Number\nZoë,9876500001\n'))).sheets[0].rows;
check(JSON.stringify(buildLeadRows(readLeadSheet(csvRows), readLeadSheet(csvRows).mapping)[0]) === JSON.stringify({ row: 2, name: 'Zoë', company: '', phone: '9876500001', email: '', remarks: '' }), 'a CSV gives the same rows');

// ---- refused files
check(/not an Excel 97-2003/.test(await refused(() => readXls(new Blob([new Uint8Array([1, 2, 3])])))), '.xls: a file that is not one is refused');
check(/damaged/.test(await refused(() => readXls(new Blob([xls.subarray(0, 700)])))), '.xls: a cut-off file is refused');

console.log(`=== ${passed} SHEET READER CHECKS PASSED ===`);
