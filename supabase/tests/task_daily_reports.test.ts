/**
 * Task daily reports and performance approval (migration 20270209000100): the schemas the form and the server share, and the service that maps a request to
 * the database function (the database enforces the permissions; these checks prove nothing malformed or privileged is ever sent to it).
 */
import { performanceOverviewQuerySchema, performanceRecordReviewSchema, taskReportListQuerySchema, taskReportReviewSchema, taskReportSubmitSchema } from '../../shared/validation.js';
import { TaskReportService } from '../../server/services/TaskReportService.js';
import type { TaskReportRepository } from '../../server/repositories/TaskReportRepository.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}
const ID = '11111111-1111-4111-8111-111111111111';
const good = { taskId: ID, reportDate: '2027-02-09', workCompleted: 'Updated half of the account list', progress: 60, pendingWork: 'The other half' };

// ---- the report form
check(taskReportSubmitSchema.safeParse(good).success, 'a complete report is valid');
check(taskReportSubmitSchema.safeParse({ ...good, progress: 100, pendingWork: undefined }).success, 'a finished task needs no pending work');
check(!taskReportSubmitSchema.safeParse({ ...good, pendingWork: undefined }).success, 'an unfinished task needs the pending work');
check(!taskReportSubmitSchema.safeParse({ ...good, workCompleted: 'Short' }).success, 'the work completed must be described');
check(!taskReportSubmitSchema.safeParse({ ...good, progress: 101 }).success && !taskReportSubmitSchema.safeParse({ ...good, progress: -1 }).success && !taskReportSubmitSchema.safeParse({ ...good, progress: 50.5 }).success, 'progress is a whole number from 0 to 100');
check(!taskReportSubmitSchema.safeParse({ ...good, reportDate: '09/02/2027' }).success, 'the date is YYYY-MM-DD');
check(!taskReportSubmitSchema.safeParse({ ...good, taskId: 'nope' }).success, 'the task is an identifier');
check(!taskReportSubmitSchema.safeParse({ ...good, authorId: ID }).success && !taskReportSubmitSchema.safeParse({ ...good, reviewerId: ID }).success && !taskReportSubmitSchema.safeParse({ ...good, status: 'APPROVED' }).success && !taskReportSubmitSchema.safeParse({ ...good, departmentId: ID }).success,
  'a request cannot name the author, the reviewer, the department or a status (the database reads those from the login)');

// ---- the decision
check(taskReportReviewSchema.safeParse({ decision: 'APPROVE' }).success, 'approving needs no remarks');
check(!taskReportReviewSchema.safeParse({ decision: 'RETURN' }).success && !taskReportReviewSchema.safeParse({ decision: 'RETURN', remarks: 'no' }).success, 'returning needs the reason');
check(taskReportReviewSchema.safeParse({ decision: 'RETURN', remarks: 'Give the number of accounts' }).success, 'a return with a reason is valid');
check(!taskReportReviewSchema.safeParse({ decision: 'MAYBE' }).success && !taskReportReviewSchema.safeParse({ decision: 'APPROVE', reviewer: ID }).success, 'only Approve or Return, and nothing else');
check(performanceRecordReviewSchema.safeParse({ decision: 'APPROVE', version: 3 }).success && !performanceRecordReviewSchema.safeParse({ decision: 'RETURN' }).success, 'a performance decision has the same rules (a return needs the reason)');

// ---- the list and the period
check(taskReportListQuerySchema.parse({}).scope === 'MINE' && taskReportListQuerySchema.parse({}).pageSize === 50, 'the list defaults to my own reports');
check(!taskReportListQuerySchema.safeParse({ scope: 'ALL' }).success && !taskReportListQuerySchema.safeParse({ status: 'DONE' }).success && !taskReportListQuerySchema.safeParse({ pageSize: '500' }).success, 'unknown scopes, statuses and huge pages are refused');
check(performanceOverviewQuerySchema.safeParse({ start: '2027-02-01', end: '2027-02-28' }).success && !performanceOverviewQuerySchema.safeParse({ start: '2027-02-28', end: '2027-02-01' }).success, 'the performance period must end after it starts');

// ---- the service sends the right call to the database
const calls: { fn: string; args: unknown }[] = [];
const fake = new Proxy({}, { get: (_t, fn: string) => (...args: unknown[]) => { calls.push({ fn, args }); return Promise.resolve({}); } }) as unknown as TaskReportRepository;
const svc = new TaskReportService(fake);
await svc.submit(good);
check(calls[0].fn === 'submit' && (calls[0].args[0] as { taskId: string; progress: number }).taskId === ID, 'a valid report reaches the repository');
await svc.list({ scope: 'TEAM', status: 'PENDING', page: '3', pageSize: '20' });
check(calls[1].fn === 'list' && (calls[1].args[0] as { offset: number; limit: number; scope: string }).offset === 40 && (calls[1].args[0] as { limit: number }).limit === 20, 'the page becomes a limit and an offset');
await svc.review(ID, { decision: 'RETURN', remarks: 'Please add the numbers' });
check(calls[2].fn === 'review' && calls[2].args[1] === 'RETURN' && calls[2].args[2] === 'Please add the numbers', 'a return reaches the repository with its reason');
let refused = 0;
for (const bad of [() => svc.submit({ ...good, workCompleted: '' }), () => svc.review('not-an-id', { decision: 'APPROVE' }), () => svc.review(ID, { decision: 'RETURN' }), () => svc.reviewRecord(ID, { decision: 'RETURN' }), () => svc.overview({ start: '2027-02-02', end: '2027-02-01' }), () => svc.get('x'), () => svc.recordHistory('x'), () => svc.resubmitRecord('x')]) {
  try { await bad(); } catch { refused++; }
}
check(refused === 8 && calls.length === 3, 'malformed requests are refused before the database is called', { refused, calls: calls.length });
await svc.reviewRecord(ID, { decision: 'APPROVE', remarks: 'Good', version: 2 });
check(calls[3].fn === 'reviewRecord' && calls[3].args[3] === 2 && calls[3].args[4] === undefined, 'a record decision carries the version that was reviewed (and no rating when none was given)');
// 20270210000100: the rating (1 to 5) given when approving
await svc.reviewRecord(ID, { decision: 'APPROVE', version: 3, rating: 4 });
check(calls[4].fn === 'reviewRecord' && calls[4].args[4] === 4, 'the rating reaches the repository');
let badRatings = 0;
for (const rating of [0, 6, 2.5, '4']) { try { await svc.reviewRecord(ID, { decision: 'APPROVE', rating }); } catch { badRatings++; } }
check(badRatings === 4 && calls.length === 5, 'a rating outside 1 to 5 (or not a whole number) is refused before the database');
await svc.subjectHistory(ID);
check(calls[5].fn === 'subjectHistory' && calls[5].args[0] === ID, 'a person\'s evaluation history is read by id');
let badId = false;
try { await svc.subjectHistory('not-an-id'); } catch { badId = true; }
check(badId && calls.length === 6, 'a malformed person id is refused');
console.log(`=== TASK DAILY REPORT UNIT TESTS PASSED (${passed}) ===`);
