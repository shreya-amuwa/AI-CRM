/**
 * Existing-customer import, the parts that need no database: the column headings of the Excel templates, the rows a template fills in
 * by itself (they are skipped until someone types a number), the optional Client Password and the rules a password must meet.
 */
import { IMPORT_SHEETS, ONE_SHEET_TYPES, SHEET_LABEL, parseExistingCustomers } from '../../src/lib/existingCustomerImport.js';
import { takeClientPasswords } from '../../server/services/CustomerImportService.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const wb = (sheets: Record<string, (string | number | null)[][]>) => ({ sheets: Object.entries(sheets).map(([name, rows]) => ({ name, rows })) });

// ---- the templates' headings are all known (nothing is "not used by the import") -------------------------------------------------
let p = parseExistingCustomers(wb({
  '1 Customers': [
    ['Mobile Number *', 'Customer Name *', 'Business Name *', 'E-mail', 'City', 'Business Address', 'Business Category', 'Customer Since', 'Support Team Member *', 'Client Login E-mail', 'Client Password', 'Sold By (Sales)', 'Notes', 'Mobile key (helper)'],
    ['9324123476', 'Devanshi', 'Ayraa', 'd@example.com', null, null, null, null, 'Avantika', 'd@example.com', 'Pass1234567', null, null, '9324123476'],
    ['8454829758', 'Jinder', 'Shubham', null, null, null, null, null, 'Avantika', null, null, null, null, '8454829758']
  ],
  '2 Services': [
    ['Mobile Number *', 'Customer (auto)', 'Service *', 'Plan / Package Name', 'Price Paid (₹, excl. GST)', 'Billing Cycle', 'Start Date *', 'Renewal / Expiry Date', 'Days Left', 'Status *', 'Panel / Platform', 'Panel Login E-mail / Account ID', 'Notes', 'WhatsApp # (helper)', 'Key (helper)'],
    ['9324123476', 'Ayraa (Devanshi)', 'WhatsApp API + Blue Tick', '1 Lakh messages', 20000, 'Yearly', '29-10-2025', '29-10-2026', 5, 'Live', 'Wabastore', 'd@example.com', null, 1, '9324123476|WhatsApp API + Blue Tick']
  ],
  '3 WhatsApp Account': [
    ['One row per WhatsApp API customer.'],
    ['Mobile Number *', 'Customer (auto)', 'WhatsApp API Number', 'WABA ID', 'Display Name', 'Blue Tick', 'Quality Rating', 'Messaging Limit', 'Message Package', 'Messages in Package *', 'Extra Messages Added', 'Messages Sent (total) *', 'Messages Left', '% Used', 'Subscription Ends', 'Data as of *'],
    // the template listed these two customers; only the first has had numbers typed
    ['9324123476', 'Ayraa (Devanshi)', '9000000001', '1111', 'Ayraa', 'No', null, null, '1 Lakh', 100000, 5, 50000, 50005, 0.5, '29-10-2026', '23-10-2026'],
    ['8454829758', 'Shubham (Jinder)', null, null, 'Shubham', null, null, null, null, null, null, null, null, null, '30-10-2026', '23-10-2026'],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]
  ],
  '5 AI Calling': [
    ['One row per AI Calling customer.'],
    ['Mobile Number *', 'Customer (auto)', 'Platform', 'Calling Plan *', 'Calling Number(s)', 'AI Agent Name', 'Credits Bought (₹)', 'Plan Valid Until', 'Data as of *'],
    ['8828193595', 'Ramchandra', 'Bolify AI', null, null, null, null, '26-01-2027', '23-10-2026']
  ],
  '6 RCS & Voice': [
    ['RCS and Voice.'],
    ['Mobile Number *', 'Customer (auto)', 'Service *', 'Sender ID / Brand Name', 'Package (messages) *', 'Sent *', 'Left', 'Valid Until', 'Data as of'],
    ['8828628005', 'Radha', 'RCS Registration + Platform', null, null, null, null, '28-10-2027', '23-10-2026'],
    ['8828193595', 'Ramchandra', 'Voice Message (Bulk)', null, 50000, 1200, 48800, '01-04-2027', '23-10-2026']
  ]
}));
check(p.ignored.length === 0, 'every heading of the template is known, including the "(auto)" and "(helper)" columns', p.ignored);
check(p.data.customers?.[0]?.loginPassword === 'Pass1234567' && p.data.customers?.[1]?.loginPassword === null, 'Client Password is read from sheet 1 (empty when not given)', p.data.customers);
check(p.counts.whatsapp === 1 && p.data.whatsapp?.[0].mobile === '9324123476' && p.data.whatsapp?.[0].packageMessages === 100000, 'WhatsApp: a listed customer with no numbers typed yet is skipped, the filled one is read', p.data.whatsapp);
check(p.counts.aiCalling === 0, 'AI Calling: a listed customer with only the auto-filled platform and dates is skipped');
check(p.counts.rcsVoice === 1 && p.data.rcsVoice?.[0].service === 'Voice Message (Bulk)' && p.data.rcsVoice?.[0].sent === 1200, 'RCS & Voice: only the row someone typed numbers into is read', p.data.rcsVoice);
check(p.data.services?.[0].renewsOn === '2026-10-29' && p.data.services?.[0].price === 20000, 'a renewal date the sheet worked out is read like a typed one', p.data.services);

// an older file (no auto columns, no password column) still reads as before
p = parseExistingCustomers(wb({
  '1 Customers': [['Mobile Number *', 'Customer Name *', 'Business Name *'], ['9000000001', 'Old Client', 'Old Co']],
  '3 WhatsApp Account': [['note'], ['Mobile Number *', 'Messages in Package *', 'Data as of *'], ['9000000001', 100000, '16-10-2026']]
}));
check(p.counts.customers === 1 && p.counts.whatsapp === 1 && p.data.whatsapp?.[0].packageMessages === 100000, 'an older file with a package typed and nothing else still imports that row', p.data.whatsapp);


// ---- the one-tab template ("Import"): a Record type on every row ------------------------------------------------------------------
check(IMPORT_SHEETS.every(sh => !!SHEET_LABEL[sh.title]) && ONE_SHEET_TYPES.length === IMPORT_SHEETS.length, 'every kind of record has a one-tab label and a column map');
const headers = [
  'Record type *', 'Mobile Number *', 'Customer (auto)', 'Customer Name *', 'Business Name *', 'Support Team Member *', 'Client Password', 'Service *', 'Start Date *', 'Status *',
  'Renewal / Expiry Date', 'Days Left', 'Messages in Package *', 'Message Package', 'Sent *', 'Delivered', 'Read / Answered', 'Replied', 'Messages Left', '% Used',
  'Valid Until', 'Data as of *', 'Campaign Name *', 'Sent On *', 'Audience Size *', 'Calling Plan *', 'Month *', 'What is delivered (unit) *', 'Notes', 'Mobile key (helper)'
];
const rowOf = (vals: Record<string, string | number>) => headers.map(h => (h in vals ? vals[h] : null)) as (string | number | null)[];
p = parseExistingCustomers(wb({
  'How to fill': [['Rules']],
  Import: [
    headers,
    rowOf({ 'Record type *': 'Customer', 'Mobile Number *': '9820011111', 'Customer Name *': 'Example', 'Notes': 'EXAMPLE - delete' }),
    rowOf({ 'Record type *': 'Customer', 'Mobile Number *': 9324123476, 'Customer Name *': 'Devanshi', 'Business Name *': 'Ayraa', 'Support Team Member *': 'Avantika', 'Client Password': 'Pass1234567', 'Customer (auto)': 'Ayraa (Devanshi)' }),
    rowOf({ 'Record type *': 'service', 'Mobile Number *': '9324123476', 'Service *': 'WhatsApp API + Blue Tick', 'Start Date *': '29-10-2025', 'Status *': 'Live', 'Renewal / Expiry Date': '29-10-2026', 'Days Left': 5 }),
    rowOf({ 'Record type *': 'WhatsApp account', 'Mobile Number *': '9324123476', 'Message Package': '1 Lakh', 'Messages in Package *': 100000, 'Sent *': 50000, 'Messages Left': 50000, '% Used': 0.5, 'Valid Until': '29-10-2026', 'Data as of *': '23-10-2026' }),
    rowOf({ 'Record type *': 'WhatsApp campaign', 'Mobile Number *': '9324123476', 'Campaign Name *': 'Dussehara', 'Sent On *': '20-10-2026', 'Audience Size *': 4000, 'Sent *': 3500, 'Delivered': 3200 }),
    rowOf({ 'Record type *': 'RCS / Voice', 'Mobile Number *': '8828628005', 'Service *': 'Voice Message (Bulk)', 'Messages in Package *': 50000, 'Sent *': 100 }),
    rowOf({ 'Record type *': 'Monthly deliverable', 'Mobile Number *': '9324123476', 'Service *': 'AI QR', 'Month *': 'Oct-2026', 'What is delivered (unit) *': 'QR pages live' }),
    rowOf({ 'Record type *': 'Banana', 'Mobile Number *': '9324123476' }),
    rowOf({ 'Customer Name *': 'typed without a record type' }),
    rowOf({ 'Record type *': 'Service', 'Mobile Number *': '9324123476', 'Service *': 'AI Calling', 'Sent *': 7 }),
    rowOf({})
  ]
}));
check(p.format === 'one-sheet' && p.ignored.length === 0, 'the one-tab template is recognised by its Record type column, and every heading is known', { f: p.format, i: p.ignored });
check(p.counts.customers === 1 && p.data.customers?.[0].row === 3 && p.data.customers?.[0].mobile === '9324123476' && p.data.customers?.[0].loginPassword === 'Pass1234567', 'a Customer row is read with its Excel row number (the example is skipped)', p.data.customers);
check(p.counts.services === 2 && p.data.services?.[0].service === 'WhatsApp API + Blue Tick' && p.data.services?.[0].renewsOn === '2026-10-29' && p.data.services?.[0].startDate === '2025-10-29', 'a Record type is case-insensitive and a Service row reads its own columns', p.data.services);
check(p.counts.whatsapp === 1 && p.data.whatsapp?.[0].packageMessages === 100000 && p.data.whatsapp?.[0].sent === 50000 && p.data.whatsapp?.[0].validUntil === '2026-10-29' && p.data.whatsapp?.[0].asOf === '2026-10-23',
  'WhatsApp account: shared columns (Sent, Valid Until, Data as of) go to the right fields', p.data.whatsapp);
check(p.counts.campaigns === 1 && p.data.campaigns?.[0].name === 'Dussehara' && p.data.campaigns?.[0].audienceSize === 4000 && p.data.campaigns?.[0].delivered === 3200 && p.data.campaigns?.[0].sent === 3500, 'a campaign row reads the same Sent / Delivered columns as its own fields', p.data.campaigns);
check(p.counts.rcsVoice === 1 && p.data.rcsVoice?.[0].service === 'Voice Message (Bulk)' && p.data.rcsVoice?.[0].packageMessages === 50000, 'RCS / Voice reads Messages in Package', p.data.rcsVoice);
check(p.counts.monthly === 1 && p.data.monthly?.[0].month === '2026-10' && p.data.monthly?.[0].unit === 'QR pages live', 'a monthly row reads the month', p.data.monthly);
check(p.problems.length === 2 && p.problems[0].row === 9 && /Banana/.test(p.problems[0].message) && p.problems[1].row === 10 && /Choose the Record type/.test(p.problems[1].message), 'an unknown Record type, and data without one, are problems named by row', p.problems);
check(p.warnings.length === 1 && /Row 11/.test(p.warnings[0]) && /Sent/.test(p.warnings[0]), 'a value typed in a column that does not apply to the row is reported (and ignored)', p.warnings);
check(p.data.services?.[1].service === 'AI Calling' && !('sent' in (p.data.services?.[1] ?? {})), 'and it is not sent to the server', p.data.services?.[1]);
check(parseExistingCustomers(wb({ '1 Customers': [['Mobile Number *', 'Customer Name *'], ['9000000001', 'X']] })).format === 'tabs', 'the older template with one tab per kind is still read');

// ---- the team's client passwords ------------------------------------------------------------------------------------------------
const rows = (...r: Record<string, string | number | null>[]) => r.map((x, i) => ({ row: i + 3, ...x }));
let t = takeClientPasswords(rows({ mobile: '9000000001', email: 'a@example.com', loginPassword: 'Longenough-1' }));
check(t.errors.length === 0 && t.passwords.get('a@example.com') === 'Longenough-1', 'a valid password is taken, keyed by the login e-mail (the customer\'s e-mail when no login e-mail is given)', t);
check(!('loginPassword' in (t.rows?.[0] ?? {})) && t.rows?.[0].loginEmail === 'a@example.com', 'it is removed from the rows that go to the database', t.rows);
t = takeClientPasswords(rows({ mobile: '9000000001', loginEmail: 'Login@Example.com', email: 'other@example.com', loginPassword: 'Longenough-1' }));
check(t.passwords.has('login@example.com') && t.rows?.[0].loginEmail === 'login@example.com', 'the Client Login E-mail wins over the E-mail, lower-cased', t);
t = takeClientPasswords(rows({ mobile: '9000000001', email: 'a@example.com', loginPassword: 'short' }));
check(t.errors.length === 1 && t.errors[0].sheet === '1 Customers' && t.errors[0].row === 3 && /10 characters/.test(t.errors[0].message) && t.passwords.size === 0, 'a short password is an error on its sheet and row', t.errors);
t = takeClientPasswords(rows({ mobile: '9000000001', loginPassword: 'Longenough-1' }));
check(t.errors.length === 1 && /needs a Client Login E-mail/.test(t.errors[0].message), 'a password without any e-mail is an error', t.errors);
t = takeClientPasswords(rows({ mobile: '9000000001', email: 'longaddress@example.com', loginPassword: 'longaddress@example.com' }));
check(t.errors.length === 1 && /cannot be the e-mail/.test(t.errors[0].message), 'the password cannot be the e-mail address', t.errors);
t = takeClientPasswords(rows({ mobile: '9000000001', email: 'a@example.com', loginPassword: 'x'.repeat(73) }));
check(t.errors.length === 1, 'more than 72 characters is refused (Auth\'s limit)', t.errors);
t = takeClientPasswords(rows({ mobile: '9000000001', email: 'a@example.com', loginPassword: 'é'.repeat(40) }));
check(t.errors.length === 1 && /too long/.test(t.errors[0].message), 'and so is more than 72 bytes', t.errors);
t = takeClientPasswords(rows({ mobile: '9000000001', email: 'a@example.com', loginPassword: 'Longenough-1' }, { mobile: '9000000002', loginEmail: 'A@example.com', loginPassword: 'Longenough-2' }));
check(t.errors.length === 1 && t.errors[0].row === 4 && /same Client Login E-mail/.test(t.errors[0].message), 'two rows cannot share one login e-mail', t.errors);
t = takeClientPasswords(rows({ mobile: '9000000001', email: 'a@example.com', loginPassword: '  spaced pass  ' }));
check(t.passwords.get('a@example.com') === '  spaced pass  ', 'a password is used exactly as typed (spaces included)', t);
t = takeClientPasswords(rows({ mobile: '9000000001', email: 'a@example.com', loginPassword: null }, { mobile: '9000000002', email: 'b@example.com', loginPassword: '' }));
check(t.errors.length === 0 && t.passwords.size === 0 && t.rows?.length === 2, 'rows without a password are left alone', t);
t = takeClientPasswords(rows({ mobile: '9000000001', email: 'a@example.com', loginPassword: 1234567890123 }));
check(t.passwords.get('a@example.com') === '1234567890123', 'a password typed as a number is read as its digits', t);
check(takeClientPasswords(undefined).rows === undefined, 'a file without the customers sheet is fine');

console.log(`${passed} import-template checks passed`);
