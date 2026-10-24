/** The contact-sheet reader of the Sales Department Head's upload (a sheet goes to a Telecaller): heading detection, column mapping, numbers typed as phones, the size limit and the API schema. */
import { buildLeadRows, missingFields, readLeadSheet } from '../../src/lib/salesLeadSheet.js';
import { salesLeadSheetSchema, salesTaskCreateSchema, userCreateSchema } from '../../shared/validation.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

let r = readLeadSheet([
  ['Contact Name', 'Company Name', 'Phone Number', 'Email', 'Remarks'],
  ['Asha Rao', 'Rao Traders', 9811234561, 'asha@example.com', 'Called before'],
  [null, null, null, null, null],
  ['Vik Shah', null, '+91 98112 34562']
]);
check(!r.problem && r.body.length === 2 && r.body[0].row === 2 && r.body[1].row === 4 && missingFields(r.mapping).length === 0, 'the usual headings are matched and blank rows skipped', r);
let rows = buildLeadRows(r, r.mapping);
check(rows[0].phone === '9811234561' && rows[0].remarks === 'Called before' && rows[0].company === 'Rao Traders' && rows[1].company === '', 'a phone typed as a number is written in full; fields are mapped', rows);

r = readLeadSheet([[null, null], ['Name', 'MOBILE', 'e-mail'], ['Dev', '9811234563', 'dev@example.com']]);
check(!r.problem && r.headerRow === 2 && r.body[0].row === 3 && r.mapping.name === 0 && r.mapping.phone === 1 && r.mapping.email === 2, 'the heading row can be anywhere; other names are known', r);

r = readLeadSheet([['Party', 'Number'], ['Asha', '9811234561']]);
check(missingFields(r.mapping).join() === 'Contact Name,Phone Number', 'unknown headings are reported so the head can map them by hand', r.mapping);
rows = buildLeadRows(r, { name: 0, phone: 1 });
check(rows.length === 1 && rows[0].name === 'Asha' && rows[0].phone === '9811234561', 'a manual mapping is applied');

check(readLeadSheet([]).problem === 'The sheet is empty.', 'an empty sheet is refused');
check(/no lead rows/.test(readLeadSheet([['Name', 'Phone']]).problem || ''), 'a sheet with only headings is refused');
const many = readLeadSheet([['Name', 'Phone'], ...Array.from({ length: 2001 }, (_v, i) => [`P${i}`, 9000000000 + i])]);
check(/at most 2,000/.test(many.problem || ''), 'more than 2,000 leads is refused');

const hash = 'a'.repeat(64);
const id = '11111111-1111-4111-8111-111111111111';
check(salesLeadSheetSchema.safeParse({ assigneeId: id, fileName: 'a.xlsx', hash, rows: [{ row: 2, name: 'A', phone: '9811234561', remarks: 'x' }], commit: false }).success, 'a sheet body is accepted');
check(!salesLeadSheetSchema.safeParse({ assigneeId: id, fileName: 'a.xlsx', hash: 'x', rows: [{ row: 2, name: 'A', phone: '9' }], commit: false }).success, 'a bad hash is refused');
check(!salesLeadSheetSchema.safeParse({ assigneeId: id, fileName: 'a.xlsx', hash, rows: [], commit: false }).success, 'an empty sheet is refused');
check(!salesLeadSheetSchema.safeParse({ assigneeId: id, fileName: 'a.xlsx', hash, rows: [{ row: 2, name: 'A', phone: '9', extra: 1 }], commit: false }).success, 'unknown fields are refused (strict)');
check(!salesLeadSheetSchema.safeParse({ assigneeId: id, fileName: 'a.xlsx', hash, rows: [{ row: 2, name: 'A', phone: '9811234561', temperature: 'hot' }], commit: false }).success, 'a lead temperature is not part of the sheet (the Telecaller sets it after the call)');
check(salesTaskCreateSchema.safeParse({ assigneeId: id, title: 'Call leads', priority: 'HIGH', dueDate: '2026-12-01' }).success && !salesTaskCreateSchema.safeParse({ assigneeId: id, title: ' ' }).success, 'a task needs a title');
check(userCreateSchema.safeParse({ email: 'a@b.co', fullName: 'A', password: 'Sup3rSecret!', role: 'DEPARTMENT_HEAD', departmentId: id, headDivision: 'SALES' }).success
  && !userCreateSchema.safeParse({ email: 'a@b.co', fullName: 'A', password: 'Sup3rSecret!', role: 'TEAM_MEMBER', teamId: id, headDivision: 'SALES' }).success, 'a Sales / Support side is for a Department Head only');
console.log(`=== ${passed} SALES LEAD SHEET CHECKS PASSED ===`);
