// Issue routing (migration 20270127000200): the shared schemas the forms and the server both use. An issue to the Developer Team carries
// a category and a priority (an older form without them still works), HR may name the affected department / employee (ids only), the
// conversation's messages, HR's escalation and HR's list order / routing filter.
import {
  bugFollowUpSchema, bugListQuerySchema, bugMyListQuerySchema, bugReplySchema, bugStatusSchema, bugSubmitSchema, DEV_BUG_STATUSES, DEV_ISSUE_CATEGORIES, DEV_ISSUE_CATEGORY_LABELS,
  issueEscalateSchema, issueHrListQuerySchema
} from '../../shared/validation.js';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra ?? ''); process.exitCode = 1; throw new Error(`failed: ${name}`); }
  passed++;
  console.log('ok -', name);
};
const id = '11111111-1111-4111-8111-111111111111';
const base = { title: 'Export is slow', description: 'The export takes ten minutes.', clientRequestId: 'irx-key-0001' };

const old = bugSubmitSchema.safeParse(base);
check(old.success && old.data.category === 'BUG' && old.data.priority === 'MEDIUM' && old.data.attachmentIds.length === 0, 'an older form without category or priority: Bug, Medium');
const hr = bugSubmitSchema.safeParse({ ...base, category: 'DATA_ISSUE', priority: 'URGENT', affectedDepartmentId: id, affectedEmployeeId: '' });
check(hr.success && hr.data.affectedDepartmentId === id && hr.data.affectedEmployeeId === null, 'HR names the affected department; an empty employee is "none"');
check(!bugSubmitSchema.safeParse({ ...base, category: 'COFFEE' }).success && !bugSubmitSchema.safeParse({ ...base, priority: 'NOW' }).success, 'unknown categories and priorities are refused');
check(!bugSubmitSchema.safeParse({ ...base, affectedEmployeeId: 'Ravi' }).success, 'the affected employee is an id, never a typed name');
check(!bugSubmitSchema.safeParse({ ...base, source: 'HR_ESCALATION' }).success, 'the browser never says where an issue came from');
check(DEV_ISSUE_CATEGORIES.every(c => DEV_ISSUE_CATEGORY_LABELS[c]), 'every category has a label');

check(DEV_BUG_STATUSES.join() === 'PENDING,UNDER_REVIEW,IN_PROGRESS,NEEDS_INFO,RESOLVED,REJECTED,CLOSED', 'the statuses: Pending, Under Review, In Progress, Pending Information, Resolved, Rejected, Closed');
check(bugStatusSchema.safeParse({ status: 'CLOSED' }).success && !bugStatusSchema.safeParse({ status: 'RESOLVED' }).success, 'closing needs no note; resolving does');
check(bugListQuerySchema.safeParse({ status: 'DONE' }).success && bugMyListQuerySchema.safeParse({ status: 'OPEN', search: 'export' }).success
  && !bugMyListQuerySchema.safeParse({ status: 'SOMETIMES' }).success, 'the lists filter by status groups (open / done) or one status');

check(!bugFollowUpSchema.safeParse({ message: ' ' }).success && bugFollowUpSchema.safeParse({ message: 'The customers export.' }).success, 'a follow-up needs words');
check(bugFollowUpSchema.safeParse({ message: 'ok', attachmentIds: Array(6).fill(id) }).success === false, 'at most 5 files');
const rep = bugReplySchema.safeParse({ message: 'Which export?' });
check(rep.success && rep.data.requestInfo === false, 'a reply is a plain reply unless it asks for information');

check(issueEscalateSchema.safeParse({}).success && issueEscalateSchema.safeParse({ note: 'Seen twice', category: 'ACCESS_LOGIN', priority: 'HIGH' }).success, 'an escalation: all optional');
check(!issueEscalateSchema.safeParse({ category: 'NOPE' }).success && !issueEscalateSchema.safeParse({ bugId: id }).success, '... but checked, and never names the Developer Team issue');
check(issueHrListQuerySchema.safeParse({ sort: 'PRIORITY', routing: 'ESCALATED_TO_DEVELOPERS' }).success && !issueHrListQuerySchema.safeParse({ sort: 'RANDOM' }).success,
  'HR\'s list: the sort orders and the routing filter');

console.log(`=== ISSUE ROUTING TESTS PASSED (${passed}) ===`);
