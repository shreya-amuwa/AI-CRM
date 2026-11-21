/**
 * The sample sheets people download before an upload (shared/sampleSheets.ts, docs/SAMPLE_SHEETS.md): every sample has the headings the CRM
 * expects and one row of dummy details that is a PLACEHOLDER (Customer_Name, Contact_Name ...), never a real person, business, mobile number or
 * e-mail address; the upload skips that row (and the sample row of earlier versions); and the Excel templates shipped in public/templates hold no
 * real-sounding names either.
 */
import { readFileSync, readdirSync } from 'node:fs';
import JSZip from 'jszip';
import { CONTACT_SAMPLE_HEADINGS, CONTACT_SAMPLE_ROW, CUSTOMER_SAMPLE_NAME, LEAD_IMPORT_SAMPLE_HEADINGS, LEAD_IMPORT_SAMPLE_ROW, SAMPLE_EMAIL, SAMPLE_PHONE, isContactSampleRow, isCustomerSampleRow, isLeadImportSampleRow } from '../../shared/sampleSheets.js';
import { LEAD_UPLOAD_COLUMNS, LEAD_UPLOAD_LEGACY_EXAMPLE } from '../../shared/leadUpload.js';
import { importTemplate, parseCustomerSheet, IMPORT_COLUMNS } from '../../src/lib/customerImport.js';
import { buildLeadRows, readLeadSheet } from '../../src/lib/salesLeadSheet.js';
import { contactSampleRows, leadImportSampleRows } from '../../src/lib/sampleSheetDownload.js';
import { parseContactSheet, SHEET_COLUMNS } from '../../src/lib/telecallerSheet.js';
import { toCsv, writeXlsx } from '../../src/lib/xlsxWriter.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

// names that were in the old samples (and similar real-sounding ones): none may be left in anything a person downloads
const REAL = ['Siddhesh', 'Patil', 'Priya Sharma', 'Rahul Mehta', 'Mohan Member', 'Galaxy', 'Thane', 'Jewellery', 'Sneha', 'Riya', 'Asha Verma', 'Verma Traders', 'Ravi Kumar',
  'Ravi Jewellers', 'Rajesh Sharma', 'Pooja Varma', 'Amit Kumar', 'Sharma Retail', 'Varma Boutique', '9876543210', '9820012345', 'asha@example', 'ravi@example'];
const clean = (text: string) => REAL.filter(w => text.includes(w));

// ---- the contact sheet (Sheet Upload and Telecaller Sheets) ----------------------------------------------------------------------------------
const contact = contactSampleRows();
check(JSON.stringify(contact[0]) === JSON.stringify(SHEET_COLUMNS) && contact[0].join(',') === 'Contact Name,Company Name,Phone Number,Email,Remarks', 'the contact sample has the headings both uploads read');
check(contact.length === 2 && contact[1][0] === 'Contact_Name' && contact[1][1] === 'Company_Name', 'its first row is placeholders (Contact_Name, Company_Name), not a person');
check(contact[1][2] === SAMPLE_PHONE && /^9000000000$/.test(SAMPLE_PHONE) && contact[1][3] === SAMPLE_EMAIL && /@example\.com$/.test(SAMPLE_EMAIL), 'the dummy mobile number is made up and the e-mail is on example.com');
check(clean(contact.flat().join('|')).length === 0, 'no real-sounding name is in it', clean(contact.flat().join('|')));

let r = parseContactSheet(contact);
check(r.problem === 'The sheet only has the sample row. Replace it with your contacts, or add them below it.' && r.rows.length === 0 && r.sampleSkipped === true, 'Telecaller Sheets: a file with only the sample row says so, nothing is assigned', r);
r = parseContactSheet([...contact, ['Test_Lead_One', 'Test_Company', '9811234561', null, null]]);
check(!r.problem && r.rows.length === 1 && r.rows[0].name === 'Test_Lead_One' && r.rows[0].row === 3 && r.sampleSkipped === true, 'Telecaller Sheets: the sample row is left out, the real rows keep their Excel row numbers', r);
r = parseContactSheet([[...SHEET_COLUMNS], ['Contact_Name', 'Some company', '9811234561', null, null]]);
check(r.rows.length === 1 && !r.sampleSkipped, 'a real contact that merely has the placeholder name but another number is kept (only the exact sample row is skipped)');

// Sheet Upload (the Sales Department Head): the same sheet read with its column mapping
let lead = readLeadSheet(contact);
check(lead.problem === 'The sheet only has the sample row. Replace it with your contacts, or add them below it.' && lead.sampleSkipped === true, 'Sheet Upload: a file with only the sample row says so', lead);
lead = readLeadSheet([...contact, ['Test_Lead_One', 'Test_Company', '9811234561', null, null], ['Test_Lead_Two', null, 9811234562, null, null]]);
check(!lead.problem && lead.body.length === 2 && lead.sampleSkipped === true && lead.body[0].row === 3, 'Sheet Upload: the sample row is left out of the rows to check', lead.body.map(b => b.row));
const built = buildLeadRows(lead, lead.mapping);
check(built.length === 2 && built[0].name === 'Test_Lead_One' && built[1].phone === '9811234562', 'and the rows that are built carry the real contacts only');
// the head corrected the column match after reading: the sample row is still not built
const wide = readLeadSheet([['Name', 'Mobile', 'Contact Name', 'x'], ['Test_Lead_One', '9811234561', 'Contact_Name', 'y']]);
check(buildLeadRows({ ...wide, body: [...wide.body, { row: 9, cells: ['Contact_Name', SAMPLE_PHONE] }] }, { name: 0, phone: 1 }).every(x => x.name !== 'Contact_Name'), 'the sample row is skipped under any column match');

// ---- Upload Leads ---------------------------------------------------------------------------------------------------------------------------
const example = LEAD_UPLOAD_COLUMNS.map(c => c.example);
check(example[0] === 'Customer_Name' && example[1] === 'Contact_Person_Name' && example[4] === 'Company_Name' && example[2] === SAMPLE_PHONE, 'Upload Leads: the example row is placeholders (Customer_Name, Company_Name, a made-up mobile number)');
check(clean(example.join('|')).length === 0, 'Upload Leads: no real-sounding name in the example row', clean(example.join('|')));
check(LEAD_UPLOAD_LEGACY_EXAMPLE.length === example.length && LEAD_UPLOAD_LEGACY_EXAMPLE[0] === 'Ravi Kumar', 'Upload Leads: the previous example row is kept as a legacy row, so old downloads are still skipped');

// ---- Upload customers (CSV) ------------------------------------------------------------------------------------------------------------------
const services = [{ code: 'WA', name: 'WhatsApp API', category: 'X' }];
const tmpl = importTemplate(services);
check(tmpl.split('\r\n')[0] === IMPORT_COLUMNS.join(',') && clean(tmpl).length === 0 && tmpl.includes(CUSTOMER_SAMPLE_NAME), 'Upload customers: the CSV template has the headings and a placeholder row without a real name', tmpl);
let c = parseCustomerSheet(tmpl, services);
check(c.rows.length === 0 && /only has the sample row/.test(c.fileError ?? ''), 'a file with only the template row says so and imports nothing', c);
c = parseCustomerSheet(tmpl + 'Test_Customer_One,Test_Co,9811234561,t@example.com,Retail,Active,WhatsApp API,,Phone,\r\n', services);
check(c.rows.length === 1 && c.rows[0].line === 3 && c.rows[0].errors.length === 0, 'the template row is skipped, a real row after it keeps the file\'s own line number', c.rows);
c = parseCustomerSheet(`${IMPORT_COLUMNS.join(',')}\r\nAsha Verma,Verma Traders,9820012345,asha@example.com,Retail,Active,,,Phone,\r\n`, services);
check(c.rows.length === 0, 'the template row of earlier versions (in an old download) is still skipped');
check(isCustomerSampleRow('Customer_Name', '90000 00000') && !isCustomerSampleRow('Customer_Name', '9811234561') && isContactSampleRow('Contact_Name', '9000000000') && !isContactSampleRow('Test', '9000000000'), 'a sample row is only the exact placeholder name with the made-up number');

// ---- the Wabastore lead import ------------------------------------------------------------------------------------------------------------
const imp = leadImportSampleRows();
check(imp[0].join(',') === LEAD_IMPORT_SAMPLE_HEADINGS.join(',') && imp[1].join(',') === LEAD_IMPORT_SAMPLE_ROW.join(',') && imp[1][0] === 'Lead_Name' && clean(imp.flat().join('|')).length === 0, 'Wabastore import: the sample has placeholders only');
check(!imp[1].join(',').split(',').some(x => x === '') && imp[1].join(',').split(',').length === imp[0].length, 'and its row has exactly one value per heading (the old sample had a comma inside a value, which broke the row)');
check(isLeadImportSampleRow('Lead_Name', SAMPLE_PHONE) && !isLeadImportSampleRow('Lead_Name', '9811234561'), 'the import skips only its exact sample row');

// ---- the files that are actually downloaded ------------------------------------------------------------------------------------------------
const csvBytes = new Uint8Array(await toCsv(contact).arrayBuffer());
const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(csvBytes);
check(csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf, 'the CSV starts with the byte-order mark that Excel needs');
check(csv.slice(1) === 'Contact Name,Company Name,Phone Number,Email,Remarks\r\nContact_Name,Company_Name,9000000000,name@example.com,Remarks', 'the CSV that is downloaded is the headings and the placeholder row', csv);
const xlsx = await JSZip.loadAsync(await writeXlsx('Contacts', contact, [22, 24, 18, 28, 30]).then(b => b.arrayBuffer()));
const sheetXml = await xlsx.file('xl/worksheets/sheet1.xml')!.async('string');
check(['Contact Name', 'Phone Number', 'Contact_Name', 'Company_Name', '9000000000', 'name@example.com'].every(t => sheetXml.includes(`>${t}</t>`)) && clean(sheetXml).length === 0, 'the Excel file that is downloaded holds the headings and the placeholder row (the number as text)');

// ---- the Excel templates shipped in public/templates -----------------------------------------------------------------------------------------
const templates = readdirSync('public/templates').filter(f => f.endsWith('.xlsx'));
check(templates.length === 4, 'four Excel templates are shipped', templates);
for (const f of templates) {
  const zip = await JSZip.loadAsync(readFileSync(`public/templates/${f}`));
  let all = '';
  for (const name of Object.keys(zip.files)) if (/\.(xml|vml|rels)$/.test(name)) all += await zip.files[name].async('string');
  check(clean(all).length === 0, `${f}: no real-sounding name, e-mail or number anywhere in the file (cells, comments, lists)`, clean(all));
  check(all.includes('9820011111'), `${f}: the example row still uses the dummy mobile number that the import recognises and skips`);
  check(/Customer_Name|Business_Name/.test(all), `${f}: the example row uses placeholders (Customer_Name, Business_Name)`);
}

console.log(`=== ${passed} SAMPLE SHEET CHECKS PASSED ===`);
