/**
 * Upload Leads without a database: matching the file's headings, one row -> the Add Lead values (the same rules as the form), follow-up dates,
 * and the template / failed-records writers. Run: npm run test:unit
 */
import JSZip from 'jszip';
import type { LeadUploadRawRow } from '../../shared/contracts.js';
import { LEAD_UPLOAD_COLUMNS, matchLeadUploadHeadings, parseFollowUpDate, prepareLeadUploadRow } from '../../shared/leadUpload.js';
import { leadUploadCheckSchema, leadUploadRowsSchema, leadUploadStartSchema, LEAD_UPLOAD_CHUNK_ROWS } from '../../shared/validation.js';
import { toCsv, writeXlsx } from '../../src/lib/xlsxWriter.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++;
  console.log(`ok - ${label}`);
}
const empty: Omit<LeadUploadRawRow, 'row'> = {
  name: '', contactPerson: '', phone: '', email: '', company: '', businessType: '', location: '', services: '', leadSource: '', description: '', followUpDate: '', assignee: ''
};
const raw = (o: Partial<LeadUploadRawRow>): LeadUploadRawRow => ({ row: 2, ...empty, name: 'Ravi Kumar', phone: '+91 98290 12345', company: 'Ravi Jewellers', services: 'WhatsApp API', ...o });

// ---- headings
const m = matchLeadUploadHeadings(LEAD_UPLOAD_COLUMNS.map(c => c.label));
check(LEAD_UPLOAD_COLUMNS.every((c, i) => m[c.key] === i), 'the template headings match every field in order');
const m2 = matchLeadUploadHeadings(['Mobile No.', 'Name*', 'Business Name', 'City', 'Service', 'Source', 'Remarks', 'Follow up date', 'Assigned To', 'E-mail']);
check(m2.phone === 0 && m2.name === 1 && m2.company === 2 && m2.location === 3 && m2.services === 4 && m2.leadSource === 5 && m2.description === 6 && m2.followUpDate === 7 && m2.assignee === 8 && m2.email === 9,
  'common other headings are recognised (any case, * and . ignored)', m2);
check(matchLeadUploadHeadings(['Name', 'Name']).name === 0, 'a field takes the first matching column');
check(matchLeadUploadHeadings(['Something else']).name === undefined, 'an unknown heading matches nothing');

// ---- dates
check(parseFollowUpDate('25-12-2026') === '2026-12-25' && parseFollowUpDate('25/12/2026') === '2026-12-25' && parseFollowUpDate('2026-12-25') === '2026-12-25', 'DD-MM-YYYY, DD/MM/YYYY and YYYY-MM-DD');
check(parseFollowUpDate('46016') === '2025-12-25', 'an Excel date number', parseFollowUpDate('46016'));
check(parseFollowUpDate('31-02-2026') === null && parseFollowUpDate('tomorrow') === null && parseFollowUpDate('12-2026') === null, 'a date that does not exist or is not a date is refused');

// ---- one row -> Add Lead values
const ok = prepareLeadUploadRow(raw({ email: 'Ravi@Example.com', leadSource: 'referral', followUpDate: '05-01-2027', contactPerson: 'Sunil', description: 'Wants a demo', services: 'WhatsApp API; AI Chatbot ;WhatsApp API' }));
check(ok.problem === null && ok.fields !== null, 'a good row has no problem', ok);
check(ok.fields!.phone === '9829012345', 'the mobile number is stored as 10 digits', ok.fields);
check(ok.fields!.email === 'ravi@example.com', 'the e-mail is stored in lower case');
check(ok.fields!.leadSource === 'Referral', 'a known lead source is written as the Add Lead form writes it');
check(ok.fields!.nextFollowUpAt === '2027-01-05T10:00:00+05:30', 'the follow-up date becomes a time on that day (India)');
check(ok.fields!.notes === 'Contact person: Sunil\nWants a demo', 'the contact person and the description go in the notes');
check(JSON.stringify(ok.services) === JSON.stringify(['WhatsApp API', 'AI Chatbot']), 'services are split on ; and repeated ones dropped');
check(prepareLeadUploadRow(raw({ leadSource: '' })).fields!.leadSource === 'Other', 'an empty lead source is Other');
check(prepareLeadUploadRow(raw({ leadSource: 'Trade fair' })).fields!.leadSource === 'Trade fair', 'another lead source is kept as written');
check(prepareLeadUploadRow(raw({ contactPerson: 'ravi kumar' })).fields!.notes === null, 'a contact person who is the customer is not repeated');

const bad = prepareLeadUploadRow(raw({ name: '', company: '', phone: '12345', email: 'not-an-email', services: '', followUpDate: '99-99-2026' }));
check(bad.problem !== null, 'a bad row has a problem');
for (const word of ['Customer Name', 'Company Name', 'Mobile Number', 'Email Address', 'Interested Service', 'Follow-up Date']) {
  check(bad.problem!.includes(word), `the problem names the column: ${word}`, bad.problem);
}
check(/^Mobile Number: .+/.test(prepareLeadUploadRow(raw({ phone: '9876543210' })).problem ?? ''), 'a made-up mobile number (9876543210) is refused like in Add Lead');
check(/too long/.test(prepareLeadUploadRow(raw({ name: 'x'.repeat(201) })).problem ?? ''), 'a value over the Add Lead length is refused');

// ---- request shapes
const r = (n: number) => ({ ...raw({}), row: n });
check(leadUploadCheckSchema.safeParse({ rows: [r(2), r(3)] }).success, 'the preview takes rows');
check(!leadUploadCheckSchema.safeParse({ rows: [r(2), r(2)] }).success, 'a row number twice is refused');
check(!leadUploadCheckSchema.safeParse({ rows: [] }).success, 'no rows is refused');
check(!leadUploadCheckSchema.safeParse({ rows: [{ ...r(2), extra: 'x' }] }).success, 'an unknown field is refused');
check(!leadUploadRowsSchema.safeParse({ rows: Array.from({ length: LEAD_UPLOAD_CHUNK_ROWS * 2 + 1 }, (_, i) => r(i + 2)) }).success, 'a chunk has a size limit');
check(leadUploadStartSchema.safeParse({ clientRequestId: '0b6f2a1e-6f9a-4b8e-9f0e-1d2c3b4a5f60', fileName: 'a.xlsx', fileType: 'XLSX', fileHash: 'a'.repeat(64), totalRows: 10 }).success, 'start takes a request id, file and hash');
check(!leadUploadStartSchema.safeParse({ clientRequestId: '0b6f2a1e-6f9a-4b8e-9f0e-1d2c3b4a5f60', fileName: 'a.xls', fileType: 'XLS', fileHash: 'a'.repeat(64), totalRows: 10 }).success, 'only XLSX or CSV');

// ---- writers
const csvBytes = new Uint8Array(await toCsv([['Name', 'Note'], ['A, B', '=1+2'], ['C "D"', '+919829012345']]).arrayBuffer());
const csv = new TextDecoder().decode(csvBytes);
check(csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf, 'the CSV starts with a byte-order mark (Excel reads UTF-8)');
check(csv.includes('"A, B"') && csv.includes('"C ""D"""'), 'commas and quotes are quoted');
check(csv.includes(`"'=1+2"`), 'a value that Excel would run as a formula is made text');
const xlsx = await writeXlsx('Leads', [['Customer Name', 'Mobile Number'], ['Zoë & Co <1>', '09829012345']], [20, 16]);
const zip = await JSZip.loadAsync(await xlsx.arrayBuffer());
const sheet = (await zip.file('xl/worksheets/sheet1.xml')?.async('string')) ?? '';
check(!!zip.file('xl/workbook.xml') && !!zip.file('xl/styles.xml') && !!zip.file('[Content_Types].xml'), 'the .xlsx has a workbook, styles and content types');
check(sheet.includes('Zoë &amp; Co &lt;1&gt;') && sheet.includes('>09829012345<'), 'cells are escaped and a number keeps its leading 0 (stored as text)');
check(/<c r="A1" t="inlineStr" s="1">/.test(sheet), 'the heading row is bold');

console.log(`\n${passed} lead upload checks passed`);
