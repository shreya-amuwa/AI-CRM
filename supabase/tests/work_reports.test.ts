/**
 * Work reports: the shared field list and the schemas the forms and the server both use (no database needed).
 */
import { ALL_REPORT_FIELD_KEYS, REPORT_FIELDS } from '../../shared/reportFields.js';
import { reportListQuerySchema, reportPackageSchema, reportRangeQuerySchema, reportReviewSchema, reportSaveSchema } from '../../shared/validation.js';

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

// every kind of report has its own sections, and each one can be submitted only with "work completed"
for (const kind of ['MEMBER', 'TEAM_LEAD', 'DEPARTMENT_HEAD'] as const) {
  const required = REPORT_FIELDS[kind].filter(f => 'required' in f && f.required).map(f => f.key);
  check(required.length === 1 && required[0] === 'workCompleted', `${kind}: work completed is the one required section`, required);
  check(new Set(REPORT_FIELDS[kind].map(f => f.key)).size === REPORT_FIELDS[kind].length, `${kind}: no section is listed twice`);
}
check(['tasksAssigned', 'tasksCompleted', 'todayActivities', 'pendingTasks'].every(k => REPORT_FIELDS.MEMBER.some(f => f.key === k)), 'a member report has the assigned / completed tasks, activities and pending tasks');
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
