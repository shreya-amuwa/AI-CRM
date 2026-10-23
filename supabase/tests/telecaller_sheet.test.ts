/** The contact-sheet reader of the Department Head's upload: headings, numbers typed as phones, blank rows and the size limit. */
import { cellText, parseContactSheet, MAX_SHEET_ROWS } from '../../src/lib/telecallerSheet.js';
import { TELECALLER_SHEET_MAX_BYTES, telecallerLeadSchema, telecallerSheetSchema, userCreateSchema } from '../../shared/validation.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

check(cellText(9811234561) === '9811234561', 'a phone typed as a number is written out in full');
check(cellText(919811234561) === '919811234561', 'also with the country code');
check(cellText('  +91 98112 34561 ') === '+91 98112 34561', 'text is trimmed');
check(cellText(null) === '', 'an empty cell is empty text');

let r = parseContactSheet([
  ['Contact Name', 'Company Name', 'Phone Number', 'Email', 'Remarks'],
  ['Asha Rao', 'Rao Traders', 9811234561, 'asha@example.com', 'Called before'],
  [null, null, null, null, null],
  ['Vik Shah', null, '+91 98112 34562']
]);
check(!r.problem && r.rows.length === 2 && r.rows[0].phone === '9811234561' && r.rows[0].row === 2 && r.rows[1].row === 4 && r.rows[1].company === '', 'rows are read with their Excel row numbers; blank rows are skipped', r);

r = parseContactSheet([[null, null], ['name', 'MOBILE', 'e-mail', 'Business Name'], ['Dev', '9811234563', 'dev@example.com', 'Dev Co']]);
check(!r.problem && r.rows.length === 1 && r.rows[0].company === 'Dev Co' && r.rows[0].email === 'dev@example.com' && r.rows[0].row === 3, 'headings are matched by common names, wherever the header row is', r);

r = parseContactSheet([['Company', 'Email'], ['Acme', 'a@b.co']]);
check(r.problem && /Contact Name and Phone Number/.test(r.problem), 'a sheet without a name and a phone column is explained', r);
r = parseContactSheet([]);
check(r.problem === 'The sheet is empty.', 'an empty sheet is explained');
r = parseContactSheet([['Name', 'Phone']]);
check(r.problem && /no contact rows/.test(r.problem), 'headings only is explained');
r = parseContactSheet([['Name', 'Phone'], ...Array.from({ length: MAX_SHEET_ROWS + 1 }, (_v, i) => [`P${i}`, `98000${String(i).padStart(5, '0')}`])]);
check(r.problem && /at most 2,000/.test(r.problem), 'more than 2,000 contacts is refused', r.problem);

const hash = 'a'.repeat(64);
const id = '11111111-1111-4111-8111-111111111111';
check(telecallerSheetSchema.safeParse({ assigneeId: id, fileName: 'x.xlsx', hash, rows: [{ row: 2, name: 'A', phone: '9811234561' }], commit: false }).success, 'a sheet request is accepted');
check(!telecallerSheetSchema.safeParse({ assigneeId: id, fileName: 'x.xlsx', hash: 'nope', rows: [{ row: 2, name: 'A', phone: '1' }] }).success, 'a bad file identity is refused');
check(!telecallerSheetSchema.safeParse({ assigneeId: id, fileName: 'x.xlsx', hash, rows: [] }).success, 'a sheet needs rows');
check(TELECALLER_SHEET_MAX_BYTES === 700 * 1024, 'the file limit is 700 KB (it travels inside a 1 MB request)');

const lead = { name: 'A', company: 'B', phone: '9811234561', leadSource: 'Cold call', services: ['X_SERVICE'], leadTemperature: 'HOT', callStatus: 'PENDING' };
check(telecallerLeadSchema.safeParse(lead).success, 'a lead is accepted');
check(!telecallerLeadSchema.safeParse({ ...lead, leadTemperature: 'LUKEWARM' }).success, 'the temperature is Hot, Warm or Cold');
check(!telecallerLeadSchema.safeParse({ ...lead, callStatus: 'DONE' }).success, 'the call status is one of the six');
check(!telecallerLeadSchema.safeParse({ ...lead, services: [] }).success, 'a service is required');
check(!telecallerLeadSchema.safeParse({ ...lead, phone: '123' }).success, 'the phone is checked');
check(!telecallerLeadSchema.safeParse({ ...lead, ownerId: id }).success, 'an owner cannot be chosen: the lead is the Telecaller’s own');

const base = { email: 'a@b.co', fullName: 'A B', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: id };
check(userCreateSchema.safeParse({ ...base, salesSubRole: 'TELECALLER' }).success, 'a Team Member can be created with a Sales role');
check(!userCreateSchema.safeParse({ ...base, role: 'TEAM_HEAD', salesSubRole: 'TELECALLER' }).success, 'a Team Lead cannot');
check(!userCreateSchema.safeParse({ ...base, salesSubRole: 'MANAGER' }).success, 'only the five Sales roles exist');
check(!userCreateSchema.safeParse({ ...base, salesSubRole: 'TELECALLER', technicalConsultant: true }).success, 'a Technical Consultant has no Sales role');
check(userCreateSchema.safeParse(base).success, 'creating a member without a Sales role is unchanged');

console.log(`=== ${passed} TELECALLER UNIT CHECKS PASSED ===`);
