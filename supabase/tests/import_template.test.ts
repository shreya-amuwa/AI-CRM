/**
 * Existing-customer import, the parts that need no database: the column headings of the Excel templates, the rows a template fills in
 * by itself (they are skipped until someone types a number), the optional Client Password and the rules a password must meet.
 */
import { IMPORT_SHEETS, ONE_SHEET_BLOCKS, SHEET_LABEL, isCustomerRowsSheet, parseExistingCustomers } from '../../src/lib/existingCustomerImport.js';
import { parseCsv } from '../../src/lib/csv.js';
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


// ---- the one-sheet template ("Import"): one table, a row per customer and service, blocks of columns, no record type --------------------------
check(IMPORT_SHEETS.every(sh => !!SHEET_LABEL[sh.title]) && ONE_SHEET_BLOCKS.length === IMPORT_SHEETS.length, 'every kind of record has a one-sheet label and a block of columns');
const headers = [
  'Mobile Number *', 'Customer Name *', 'Business Name *', 'Handled by - Support Team Member *', 'Brought by (Sales / Support)', 'Brought by - Name', 'Client Password', 'Customer Notes',
  'Service *', 'Plan / Package Name', 'Start Date *', 'Renewal / Expiry Date', 'Status *', 'Service Notes',
  'Messages in Package *', 'Messages Sent (total) *', 'Messages Delivered (total)', 'WhatsApp Data as of *',
  'Campaign Name *', 'Sent On *', 'Audience Size *', 'Campaign Sent *', 'Campaign Delivered *',
  'Calling Plan *', 'Minutes Bought', 'AI Data as of *',
  'RCS / Voice Messages in Package *', 'RCS / Voice Sent *',
  'Month *', 'What is delivered (unit) *', 'Included in Plan', 'Delivered This Month', 'Mobile key (helper)'
];
const rowOf = (vals: Record<string, string | number>) => headers.map(h => (h in vals ? vals[h] : null)) as (string | number | null)[];
const blockRow = headers.map(() => null) as (string | number | null)[];
p = parseExistingCustomers(wb({
  'How to fill': [['Rules']],
  Import: [
    blockRow,
    headers,
    rowOf({ 'Mobile Number *': '9820011111', 'Customer Name *': 'Example', 'Customer Notes': 'EXAMPLE - delete' }),
    // customer + service + WhatsApp numbers on ONE row
    rowOf({ 'Mobile Number *': 9324123476, 'Customer Name *': 'Devanshi', 'Business Name *': 'Ayraa', 'Handled by - Support Team Member *': 'Avantika', 'Brought by (Sales / Support)': 'Sales',
      'Brought by - Name': 'Shreya', 'Client Password': 'Pass1234567', 'Service *': 'WhatsApp API + Blue Tick', 'Plan / Package Name': '1 Lakh messages', 'Start Date *': '29-10-2025',
      'Renewal / Expiry Date': '29-10-2026', 'Status *': 'Live', 'Messages in Package *': 100000, 'Messages Sent (total) *': 50000, 'WhatsApp Data as of *': '23-10-2026' }),
    // a campaign of the same customer: only the mobile, the service and the campaign block
    rowOf({ 'Mobile Number *': '9324123476', 'Service *': 'WhatsApp API + Blue Tick', 'Campaign Name *': 'Dussehara', 'Sent On *': '20-10-2026', 'Audience Size *': 4000, 'Campaign Sent *': 3500, 'Campaign Delivered *': 3200 }),
    // a second customer, AI Calling
    rowOf({ 'Mobile Number *': '8828628005', 'Customer Name *': 'Shirish', 'Business Name *': 'Radha', 'Handled by - Support Team Member *': 'Avantika', 'Service *': 'AI Calling', 'Start Date *': '26-10-2026',
      'Status *': 'Live', 'Calling Plan *': 'Credit-based', 'Minutes Bought': 1000, 'AI Data as of *': '23-10-2026' }),
    // their RCS service, without the customer block
    rowOf({ 'Mobile Number *': '8828628005', 'Service *': 'RCS Registration + Platform', 'Start Date *': '28-10-2026', 'Status *': 'Live', 'RCS / Voice Messages in Package *': 50000, 'RCS / Voice Sent *': 100 }),
    // a month of another service
    rowOf({ 'Mobile Number *': '8828628005', 'Service *': 'AI QR', 'Month *': 'Oct-2026', 'What is delivered (unit) *': 'QR pages live', 'Included in Plan': 5, 'Delivered This Month': 4 }),
    // WhatsApp numbers on a row whose service is AI Calling
    rowOf({ 'Mobile Number *': '8828628005', 'Service *': 'AI Calling', 'Messages in Package *': 1000 }),
    // data without a mobile number
    rowOf({ 'Customer Name *': 'typed without a mobile' }),
    // WhatsApp numbers with no Service chosen (the service is added by the import)
    rowOf({ 'Mobile Number *': '8828628005', 'Messages in Package *': 500, 'Messages Sent (total) *': 5, 'WhatsApp Data as of *': '23-10-2026' }),
    // a Service chosen and nothing else
    rowOf({ 'Mobile Number *': '8828628005', 'Service *': 'Voice Message (Bulk)' }),
    rowOf({})
  ]
}));
check(p.format === 'one-sheet' && p.ignored.length === 0, 'the one-sheet template is recognised by its columns (no record type), and every heading is known', { f: p.format, i: p.ignored });
check(p.counts.customers === 2 && p.data.customers?.[0].row === 4 && p.data.customers?.[0].mobile === '9324123476' && p.data.customers?.[0].loginPassword === 'Pass1234567'
  && p.data.customers?.[0].member === 'Avantika' && p.data.customers?.[0].broughtByType === 'Sales' && p.data.customers?.[0].broughtBy === 'Shreya', 'the customer block is read once, with who handles and who brought the customer (the example row is skipped)', p.data.customers);
check(p.data.services?.length === 4 && p.data.services?.[0].service === 'WhatsApp API + Blue Tick' && p.data.services?.[0].renewsOn === '2026-10-29' && p.data.services?.[0].startDate === '2025-10-29',
  'the service block becomes a service of that customer, on the same row as the customer and the usage', p.data.services);
check(p.counts.whatsapp === 3 && p.data.whatsapp?.[0].packageMessages === 100000 && p.data.whatsapp?.[0].sent === 50000 && p.data.whatsapp?.[0].asOf === '2026-10-23', 'the WhatsApp block is read from its own headings', p.data.whatsapp);
check(p.counts.campaigns === 1 && p.data.campaigns?.[0].row === 5 && p.data.campaigns?.[0].name === 'Dussehara' && p.data.campaigns?.[0].audienceSize === 4000 && p.data.campaigns?.[0].sent === 3500 && p.data.campaigns?.[0].delivered === 3200,
  'a campaign row (mobile + service + the campaign block) is a campaign, whose Sent is its own', p.data.campaigns);
check(p.data.services?.filter(sv => sv.row === 5).length === 0, 'a campaign row does not make a second service (its Service only says which one)');
check(p.counts.aiCalling === 1 && p.data.aiCalling?.[0].plan === 'Credit-based' && p.data.aiCalling?.[0].minutesBought === 1000, 'the AI Calling block', p.data.aiCalling);
check(p.counts.rcsVoice === 1 && p.data.rcsVoice?.[0].service === 'RCS Registration + Platform' && p.data.rcsVoice?.[0].packageMessages === 50000 && p.data.rcsVoice?.[0].sent === 100, 'the RCS / Voice block takes the row\'s Service', p.data.rcsVoice);
check(p.counts.monthly === 1 && p.data.monthly?.[0].service === 'AI QR' && p.data.monthly?.[0].month === '2026-10' && p.data.monthly?.[0].delivered === 4, 'the monthly block is one month of a service', p.data.monthly);
check(p.data.whatsapp?.some(w => w.row === 11 && w.sent === 5) && !p.data.services?.some(sv => sv.row === 11), 'a usage row with no Service is accepted (the import adds the service)');
check(p.data.services?.some(sv => sv.row === 12 && sv.service === 'Voice Message (Bulk)'), 'a Service chosen with nothing else is still a service (the database says what is missing)');
check(p.problems.length === 2 && p.problems.some(x => x.row === 9 && /WhatsApp API columns are filled, but the Service on this row is "AI Calling"/.test(x.message)) && p.problems.some(x => x.row === 10 && /Mobile Number is missing/.test(x.message)),
  'WhatsApp numbers on an AI Calling row, and data without a mobile number, are problems named by row', p.problems);
check(parseExistingCustomers(wb({ '1 Customers': [['Mobile Number *', 'Customer Name *'], ['9000000001', 'X']] })).format === 'tabs', 'the older template with one tab per kind is still read');
const old = parseExistingCustomers(wb({ '1 Customers': [['Mobile Number *', 'Customer Name *', 'Business Name *'], ['9000000001', 'X', 'Y']], '2 Services': [['Mobile Number *', 'Service *', 'Start Date *'], ['9000000001', 'AI QR', '01-01-2026']] }));
check(old.format === 'tabs' && old.counts.customers === 1 && old.counts.services === 1, 'each older tab is still a tab (no tab has both Business Name and Service)', old.counts);

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

// ---- the Add Customer upload template (public/templates/Customer_Upload_Template.xlsx): one row per customer --------------------------------
{
  const head = ['Relationship Manager *', 'Customer Name *', 'Business Name *', 'Mobile *', 'E-mail', 'City', 'Client Login E-mail', 'Client Password'];
  for (let n = 1; n <= 5; n++) head.push(`Service ${n}`, `Plan ${n}`, `Price ${n} (₹)`, `Billing Cycle ${n}`, `Start Date ${n}`, `Expiry Date ${n}`, `Status ${n}`);
  head.push('Notes');
  const row = (cells: Record<string, string | number | null>) => head.map(h => cells[h] ?? null);
  const up = parseExistingCustomers(wb({
    Customers: [
      ['One row = one customer ...'],
      head,
      row({ 'Relationship Manager *': 'Priya Sharma', 'Customer Name *': 'Siddhesh Patil', 'Business Name *': 'Galaxy Jewellers', 'Mobile *': '9820011111', 'Service 1': 'AI Calling', Notes: 'EXAMPLE - start on row 4' }),
      row({ 'Relationship Manager *': 'Asha RM', 'Customer Name *': 'Meera Joshi', 'Business Name *': 'Joshi Sweets', 'Mobile *': '9876500001', 'E-mail': 'meera@example.com',
            'Client Login E-mail': 'Meera@Example.com', 'Client Password': 'Sweets@2026!x', Notes: 'VIP',
            'Service 1': 'AI Calling', 'Plan 1': 'Gold', 'Price 1 (₹)': 25000, 'Billing Cycle 1': 'Yearly', 'Start Date 1': '01-01-2026', 'Expiry Date 1': '01-01-2027', 'Status 1': 'Live',
            'Service 3': 'AI Website', 'Start Date 3': 46058, 'Status 3': 'Setting up' }),
      row({ 'Relationship Manager *': 'Vikas RM', 'Customer Name *': 'Ravi Kumar', 'Business Name *': 'RK Motors', 'Mobile *': 9876500002, 'Client Login E-mail': 'ravi@rk.example' }),
      row({}),
      row({ 'Customer Name *': 'No Number', 'Service 1': 'AI QR' }),
      row({ 'Relationship Manager *': 'Asha RM', 'Customer Name *': 'Half Filled', 'Business Name *': 'HF', 'Mobile *': '9876500004', 'Plan 2': 'Gold', 'Price 2 (₹)': '12,000' })
    ]
  }));
  check(up.format === 'customer-rows' && up.ignored.length === 0, 'upload template: recognised, every heading known', { format: up.format, ignored: up.ignored });
  check(up.counts.customers === 3 && up.counts.services === 2, 'upload template: the example and empty rows are skipped; one customer per row, one service per filled block', up.counts);
  const meera = up.data.customers!.find(c => c.mobile === '9876500001')!;
  check(meera.member === 'Asha RM' && meera.name === 'Meera Joshi' && meera.businessName === 'Joshi Sweets' && meera.loginEmail === 'Meera@Example.com'
        && meera.loginPassword === 'Sweets@2026!x' && meera.notes === 'VIP' && meera.row === 4, 'upload template: the RM is the "Handled by" member, the client login and password are read, with the sheet row number', meera);
  check(up.data.customers!.find(c => c.row === 5)?.mobile === '9876500002' && up.data.customers!.find(c => c.row === 5)?.loginPassword === undefined,
    'upload template: a mobile typed as a number is read; no password column filled = the client sets their own');
  const s = up.data.services!;
  check(s[0].mobile === '9876500001' && s[0].service === 'AI Calling' && s[0].plan === 'Gold' && s[0].price === 25000 && s[0].billingCycle === 'Yearly'
        && s[0].startDate === '2026-01-01' && s[0].renewsOn === '2027-01-01' && s[0].status === 'Live' && s[0].row === 4, 'upload template: a service block becomes a service record', s[0]);
  check(s[1].service === 'AI Website' && s[1].startDate === '2026-02-05' && s[1].status === 'Setting up' && s[1].mobile === '9876500001', 'upload template: service 3 of the same row, an Excel date is read', s[1]);
  check(up.problems.length === 2 && up.problems.some(x => x.row === 7 && /Mobile/.test(x.message)) && up.problems.some(x => x.row === 8 && /Service 2/.test(x.message)),
    'upload template: a row with no mobile and a service block with no Service are problems (nothing is saved until fixed)', up.problems);
  // the passwords go through the same rules as the Import Customers page before anything is saved
  const taken = takeClientPasswords(up.data.customers as never);
  check(taken.errors.length === 0 && taken.passwords.get('meera@example.com') === 'Sweets@2026!x', 'upload template: the client password is taken out of the rows for the login (lower-case login e-mail)', taken.errors);
  check(!(taken.rows as any[]).some(r => 'loginPassword' in r), 'upload template: no password is left in the rows sent to the database');
}

// ---- the same template saved as CSV (Google Sheets: File > Download > CSV) is read the same way ------------------------------------------
{
  const head = ['Relationship Manager *', 'Customer Name *', 'Business Name *', 'Mobile *', 'E-mail', 'City', 'Client Login E-mail', 'Client Password'];
  for (let n = 1; n <= 5; n++) head.push(`Service ${n}`, `Plan ${n}`, `Price ${n} (₹)`, `Billing Cycle ${n}`, `Start Date ${n}`, `Expiry Date ${n}`, `Status ${n}`);
  head.push('Notes');
  const line = (cells: Record<string, string>) => head.map(h => { const v = cells[h] ?? ''; return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(',');
  const csv = [
    '"One row = one customer. Required: RM, Customer Name, Business Name, Mobile (10 digits).",,,,',
    head.join(','),
    line({ 'Relationship Manager *': 'Priya Sharma', 'Customer Name *': 'Siddhesh Patil', 'Business Name *': 'Galaxy Jewellers', 'Mobile *': '9820011111', Notes: 'EXAMPLE - start on row 4' }),
    line({ 'Relationship Manager *': 'Asha RM', 'Customer Name *': 'Meera Joshi', 'Business Name *': 'Joshi Sweets, Pune', 'Mobile *': '9876500001', 'Client Login E-mail': 'meera@example.com',
           'Service 1': 'AI Calling', 'Price 1 (₹)': '25,000', 'Start Date 1': '01-01-2026', 'Expiry Date 1': '01-01-2027', 'Status 1': 'Live' }),
    head.map(() => '').join(',')
  ].join('\r\n');
  const rows = parseCsv(csv);
  check(isCustomerRowsSheet(rows) && !isCustomerRowsSheet(parseCsv('Name,Company,Phone\r\nAsha,Verma Traders,9820012345')), 'csv: the new template is recognised, the older CSV is not');
  const up = parseExistingCustomers({ sheets: [{ name: 'Customers', rows }] });
  check(up.format === 'customer-rows' && up.counts.customers === 1 && up.counts.services === 1 && up.problems.length === 0, 'csv: one customer and one service, the example skipped', { counts: up.counts, problems: up.problems });
  const c = up.data.customers![0], sv = up.data.services![0];
  check(c.businessName === 'Joshi Sweets, Pune' && c.member === 'Asha RM' && c.loginEmail === 'meera@example.com' && sv.price === 25000 && sv.startDate === '2026-01-01' && sv.renewsOn === '2027-01-01',
    'csv: a comma inside a cell, a price with a comma and DD-MM-YYYY dates are read', { c, sv });
}

console.log(`${passed} import-template checks passed`);
