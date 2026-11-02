/**
 * Work reports: the shared field list and the schemas the forms and the server both use (no database needed).
 */
import { ALL_REPORT_FIELD_KEYS, MEMBER_REPORT_TASK_KEYS, REPORT_FIELDS, REPORT_STATUSES, reportStatusLabel } from '../../shared/reportFields.js';
import { reportListQuerySchema, reportMemberApprovalsQuerySchema, reportPackageSchema, reportRangeQuerySchema, reportReviewSchema, reportSaveSchema } from '../../shared/validation.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const base = { title: 'Daily report', reportDate: '2026-12-01', periodType: 'DAILY', periodStart: '2026-12-01', periodEnd: '2026-12-01', content: { workCompleted: 'Closed tickets' } };

// a Team Lead and a Department Head report have their own sections and are submitted only with "work completed"
for (const kind of ['TEAM_LEAD', 'DEPARTMENT_HEAD'] as const) {
  const required = REPORT_FIELDS[kind].filter(f => 'required' in f && f.required).map(f => f.key);
  check(required.length === 1 && required[0] === 'workCompleted', `${kind}: work completed is the one required section`, required);
  check(new Set(REPORT_FIELDS[kind].map(f => f.key)).size === REPORT_FIELDS[kind].length, `${kind}: no section is listed twice`);
}
// the Team Member report is title + date + assigned tasks + completed tasks; the older text sections are only kept to show older reports
check(MEMBER_REPORT_TASK_KEYS.join() === 'assignedTasks,completedTasks', 'a member report has an assigned and a completed task list');
check(!REPORT_FIELDS.MEMBER.some(f => 'required' in f && f.required), 'and no required text section');
check(['teamCoordination', 'targetProgress', 'nextPlans'].every(k => REPORT_FIELDS.TEAM_LEAD.some(f => f.key === k)), 'a Team Lead report has team coordination, target progress and next plans');
check(['departmentOverview', 'teamLeadPerformance', 'resourceRequirements'].every(k => REPORT_FIELDS.DEPARTMENT_HEAD.some(f => f.key === k)), 'a Department Head report has the overview, Team Lead performance and resource needs');
check(ALL_REPORT_FIELD_KEYS.includes('workCompleted') && ALL_REPORT_FIELD_KEYS.length === new Set(ALL_REPORT_FIELD_KEYS).size, 'the combined list has each key once');

// save
check(reportSaveSchema.safeParse(base).success, 'a normal report passes');
check(!reportSaveSchema.safeParse({ ...base, title: 'ab' }).success, 'a short title is refused');
check(!reportSaveSchema.safeParse({ ...base, periodEnd: '2026-11-30' }).success, 'a period that ends before it starts is refused');
check(!reportSaveSchema.safeParse({ ...base, reportDate: '01/12/2026' }).success, 'a date must be YYYY-MM-DD');
check(!reportSaveSchema.safeParse({ ...base, periodType: 'YEARLY' }).success, 'the period type is one of the four');
check(!reportSaveSchema.safeParse({ ...base, status: 'APPROVED' }).success, 'a request cannot name its own status');
check(!reportSaveSchema.safeParse({ ...base, authorId: crypto.randomUUID() }).success, 'nor its author');
check(!reportSaveSchema.safeParse({ ...base, content: { workCompleted: 'x'.repeat(5001) } }).success, 'a section over 5000 characters is refused');
check(reportSaveSchema.safeParse({ ...base, content: { workCompleted: 'ok', somethingElse: 'dropped' } }).success && !('somethingElse' in (reportSaveSchema.parse({ ...base, content: { workCompleted: 'ok', somethingElse: 'dropped' } }).content as object)), 'an unknown section is dropped');
check(reportSaveSchema.safeParse({ ...base, content: { workCompleted: 'ok', attachments: [{ name: 'Sheet', url: 'https://example.com/a' }] } }).success, 'an https attachment link passes');
for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.test/a', 'example.com/a', 'https://exa mple.com']) {
  check(!reportSaveSchema.safeParse({ ...base, content: { workCompleted: 'ok', attachments: [{ url: bad }] } }).success, `attachment link refused: ${bad}`);
}
check(!reportSaveSchema.safeParse({ ...base, content: { workCompleted: 'ok', attachments: Array.from({ length: 6 }, () => ({ url: 'https://example.com/a' })) } }).success, 'at most 5 attachment links');

// the Team Member report: two task lists of ids (the database checks them against the member's own task records)
const id1 = crypto.randomUUID();
const id2 = crypto.randomUUID();
const member = { ...base, content: { assignedTasks: [id1, id2], completedTasks: [id1] } };
check(reportSaveSchema.safeParse(member).success, 'a member report with task ids passes');
check(reportSaveSchema.parse(member).content.assignedTasks?.length === 2 && reportSaveSchema.parse(member).content.completedTasks?.length === 1, 'and keeps both lists');
check(!reportSaveSchema.safeParse({ ...base, content: { assignedTasks: ['not-a-uuid'] } }).success, 'a task id must be a uuid');
check(!reportSaveSchema.safeParse({ ...base, content: { assignedTasks: Array.from({ length: 101 }, () => crypto.randomUUID()) } }).success, 'at most 100 tasks');
check(!reportSaveSchema.safeParse({ ...base, content: { assignedTasks: [{ id: id1, title: 'x' }] } }).success, 'a task is sent as an id, not as an object');

// the two approvals: statuses and the words used for them
check(REPORT_STATUSES.includes('PENDING_DEPARTMENT_HEAD'), 'there is a "waiting for the Department Head" status');
check(reportStatusLabel('SUBMITTED', 'MEMBER') === 'Pending Team Lead Approval' && reportStatusLabel('UNDER_REVIEW', 'MEMBER') === 'Pending Team Lead Approval', 'a submitted member report is Pending Team Lead Approval');
check(reportStatusLabel('PENDING_DEPARTMENT_HEAD', 'MEMBER') === 'Pending Department Head Approval', 'once the Team Lead approved it is Pending Department Head Approval');
check(reportStatusLabel('APPROVED', 'MEMBER') === 'Fully Approved' && reportStatusLabel('APPROVED', 'TEAM_LEAD') === 'Approved', 'only a member report is "Fully Approved"');
check(reportStatusLabel('REVISION_REQUIRED', 'MEMBER') === 'Revision Required' && reportStatusLabel('REJECTED', 'MEMBER') === 'Rejected', 'rejected and revision required keep their names');
check(reportMemberApprovalsQuerySchema.safeParse({}).success && reportMemberApprovalsQuerySchema.safeParse({ status: 'PENDING', from: '2026-12-01' }).success && !reportMemberApprovalsQuerySchema.safeParse({ status: 'DONE' }).success, 'the Department Head\'s approval list filters');

// review
check(reportReviewSchema.safeParse({ decision: 'APPROVED' }).success, 'an approval needs no comment');
check(!reportReviewSchema.safeParse({ decision: 'REJECTED' }).success && !reportReviewSchema.safeParse({ decision: 'REVISION_REQUIRED', comment: ' ' }).success, 'a rejection or a revision request needs a comment');
check(reportReviewSchema.safeParse({ decision: 'REVISION_REQUIRED', comment: 'Add the outcomes' }).success, 'a revision request with a comment passes');
check(!reportReviewSchema.safeParse({ decision: 'MAYBE' }).success, 'the decision is one of the three');

// lists and ranges
check(reportListQuerySchema.safeParse({}).success && reportListQuerySchema.safeParse({ status: 'PENDING', from: '2026-12-01', to: '2026-12-31' }).success, 'the inbox filters pass');
check(!reportListQuerySchema.safeParse({ status: 'DONE' }).success && !reportListQuerySchema.safeParse({ author: 'not-a-uuid' }).success, 'a wrong status or author filter is refused');
check(reportRangeQuerySchema.safeParse({ from: '2026-12-01', to: '2026-12-07' }).success && !reportRangeQuerySchema.safeParse({ from: '2026-12-07', to: '2026-12-01' }).success && !reportRangeQuerySchema.safeParse({ from: '2026-12-07' }).success, 'a box needs a valid period');
check(reportPackageSchema.parse({ from: '2026-12-01', to: '2026-12-07' }).periodType === 'WEEKLY', 'a package defaults to a weekly period');
check(!reportPackageSchema.safeParse({ from: '2026-12-01', to: '2026-12-07', note: 'x'.repeat(4001) }).success, 'a package note is limited');

console.log(`=== ${passed} WORK REPORT UNIT CHECKS PASSED ===`);
