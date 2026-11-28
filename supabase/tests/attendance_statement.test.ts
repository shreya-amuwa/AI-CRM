// Unit tests: attendance statement date presets (India calendar, both dates included, leap years) and the export writers
// (multi-sheet Excel with real dates / durations, AutoFilter, leading zeros kept, formula injection blocked; CSV with BOM). docs/hr-dashboard-upgrade.md
import JSZip from 'jszip';
import { datesOf, daysBetween, detailCsv, istToday, presetRange, rangeProblem, reconCells } from '../../src/lib/attendanceStatement';
import { csvBlob, excelDate, excelDateTime, safeText, writeWorkbook } from '../../src/lib/xlsxWorkbook';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exit(1); } passed++; console.log('ok -', name); };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

check(istToday(new Date('2026-11-27T19:00:00Z')) === '2026-11-28', 'today is the India calendar day (00:30 IST is already the next day)');
const T = '2027-03-10'; // a Wednesday
check(eq(presetRange('TODAY', T), { from: T, to: T }) && eq(presetRange('YESTERDAY', T), { from: '2027-03-09', to: '2027-03-09' }), 'today and yesterday');
check(eq(presetRange('THIS_WEEK', T), { from: '2027-03-08', to: T }) && eq(presetRange('LAST_WEEK', T), { from: '2027-03-01', to: '2027-03-07' }), 'weeks run Monday to Sunday');
check(eq(presetRange('THIS_MONTH', T), { from: '2027-03-01', to: T }) && eq(presetRange('LAST_MONTH', T), { from: '2027-02-01', to: '2027-02-28' }), 'this and last month');
check(eq(presetRange('LAST_MONTH', '2028-03-05'), { from: '2028-02-01', to: '2028-02-29' }), 'last month of a leap year ends on 29 February');
check(eq(presetRange('LAST_MONTH', '2027-01-15'), { from: '2026-12-01', to: '2026-12-31' }), 'last month across the year');
check(eq(presetRange('LAST_7', T), { from: '2027-03-04', to: T }) && daysBetween('2027-03-04', T) === 7, 'last 7 days includes today (7 calendar days)');
check(daysBetween(presetRange('LAST_30', T).from, T) === 30 && daysBetween(presetRange('LAST_90', T).from, T) === 90, 'last 30 / 90 days');
check(eq(presetRange('LAST_6_MONTHS', T), { from: '2026-09-11', to: T }), 'last six months');
check(eq(presetRange('LAST_6_MONTHS', '2027-08-31'), { from: '2027-03-01', to: '2027-08-31' }), 'last six months from a month end (28 Feb + 1 day)');
check(eq(presetRange('THIS_YEAR', T), { from: '2027-01-01', to: T }), 'this year');
check(rangeProblem('2027-03-10', '2027-03-01') === 'From Date must not be later than To Date.', 'From later than To is refused');
check(rangeProblem('2027-02-29', '2027-03-01') === 'That is not a calendar date.' && rangeProblem('2028-02-29', '2028-03-01') === null, '29 February only in a leap year');
check(rangeProblem('2026-01-01', '2027-12-31') !== null && rangeProblem('2026-01-01', '2026-12-31') === null, 'a year at most for the daily view');
check(eq(datesOf('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']), 'a range across the year lists every date');

check(excelDate('2026-01-01') === 46023 && excelDate('1900-03-01') === 61, 'Excel date serials');
check(Math.abs((excelDateTime("2026-01-01T04:30:00Z") ?? 0) - (46023 + 10 / 24)) < 1e-9, 'a timestamp is shown in India time (04:30 UTC = 10:00 IST)');
check(safeText('=HYPERLINK("x")') === `'=HYPERLINK("x")` && safeText('+91 98') === `'+91 98` && safeText('-5') === `'-5` && safeText('@a') === `'@a` && safeText('Asha') === 'Asha',
  'text that looks like a formula is neutralised');

const row = { date: '2027-03-01', employeeCode: '007', name: '=cmd|calc', department: 'Wabastore', team: null, designation: 'Telecaller', employmentType: 'Full-Time', biometricId: 'B-0042',
  status: 'MISSING_PUNCH_OUT', shiftStart: '10:00', shiftEnd: '19:00', punchIn: '2027-03-01T04:35:00Z', punchOut: null, lunchStart: null, lunchEnd: null, breaks: 0,
  breakMinutes: null, grossMinutes: null, netMinutes: null, lateMinutes: 0, earlyMinutes: 0, leave: null, holiday: null, correction: null, incomplete: true, source: 'CRM' };
const csvRow = detailCsv(row);
check(csvRow[2] === '007' && csvRow[9] === '10:05' && csvRow[10] === '' && csvRow[15] === '' && String(csvRow[22]).includes('Incomplete'),
  'a missing Punch Out stays empty (no hours invented) and is marked incomplete; the code keeps its leading zeros', csvRow);
check(eq(reconCells(row).slice(8, 15), ['', '', '', '', '', '', '']) && reconCells(row)[1] === 'B-0042', 'the biometric columns are empty for HR to fill; the biometric id is carried');

const csvBytes = new Uint8Array(await csvBlob([['Employee ID', 'Name'], ['007', '=1+1'], ['8', 'Shah, "A"']]).arrayBuffer());
const csv = new TextDecoder('utf-8').decode(csvBytes);
check(csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf && csv.startsWith('Employee ID,Name\r\n007,') && csv.includes(`'=1+1`) && csv.includes('"Shah, ""A"""'), 'CSV: UTF-8 BOM, codes as text, formulas neutralised, quoting', csv);

const blob = await writeWorkbook([
  { name: 'Report Summary', rows: [['Attendance Report'], ['Organization', 'Amuwa Corporation']] },
  { name: 'Detailed Attendance', table: true, rows: [['Date', 'Employee ID', 'Name', 'Net'], [{ date: '2027-03-01' }, '007', '=evil()', { minutes: 525 }]] }
]);
const zip = await JSZip.loadAsync(await blob.arrayBuffer());
const wb = await zip.file('xl/workbook.xml')!.async('string');
const s2 = await zip.file('xl/worksheets/sheet2.xml')!.async('string');
check(/<sheet name="Report Summary"/.test(wb) && /<sheet name="Detailed Attendance"/.test(wb), 'Excel: one workbook, named sheets');
check(s2.includes('<autoFilter ref="A1:D2"/>') && s2.includes('state="frozen"') && wb.includes('_xlnm._FilterDatabase'), 'Excel: the header row is frozen and filterable');
check(s2.includes('<c r="A2" s="3"><v>46447</v></c>') && s2.includes(`<t xml:space="preserve">007</t>`) && s2.includes(`'=evil()`) && s2.includes(`<v>${525 / 1440}</v>`),
  'Excel: a real date, the code as text, the formula neutralised, a real duration', s2);
console.log(`=== ${passed} ATTENDANCE STATEMENT UNIT CHECKS PASSED ===`);
