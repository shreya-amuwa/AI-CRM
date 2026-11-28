/**
 * Daily reports, every department (20270308000100), no database: Work Completed (150 words), Work Pending (100), Additional Note (50), all optional, in the
 * shared schemas the forms and the API use (the database's private.report_word_limits holds the same limits). Run: npm run test:unit
 */
import { DAILY_REPORT_FIELDS, adsReportSchema, aiStudioDailyReportSchema, dailyReportWordProblem, taskReportReviewerEditSchema, taskReportSubmitSchema } from '../../shared/validation.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const id = '11111111-1111-4111-8111-111111111111';

check(DAILY_REPORT_FIELDS.map(f => `${f.label}:${f.maxWords}`).join('|') === 'Work Completed:150|Work Pending:100|Additional Note:50', 'three fields: Work Completed 150, Work Pending 100, Additional Note 50');
check(dailyReportWordProblem('workCompleted', words(150)) === null && /at most 150 words \(now 151\)/.test(dailyReportWordProblem('workCompleted', words(151)) ?? ''), 'Work Completed: 150 words pass, 151 do not');
check(dailyReportWordProblem('pendingWork', words(100)) === null && dailyReportWordProblem('pendingWork', words(101)) !== null, 'Work Pending: 100 / 101');
check(dailyReportWordProblem('remarks', words(50)) === null && dailyReportWordProblem('remarks', words(51)) !== null, 'Additional Note: 50 / 51');
check(dailyReportWordProblem('remarks', 'x'.repeat(1000)) === null, 'words are counted, not characters');

// the Task Daily Report (every department that uses work tasks)
check(!taskReportSubmitSchema.safeParse({ taskId: id }).success, 'task report: an empty report is refused');
check(taskReportSubmitSchema.safeParse({ taskId: id, pendingWork: 'Call the rest' }).success, 'task report: one field is enough (no progress, no work completed needed)');
check(taskReportSubmitSchema.safeParse({ taskId: id, remarks: 'Waiting for the client' }).success, 'task report: an Additional Note alone is enough');
check(!taskReportSubmitSchema.safeParse({ taskId: id, workCompleted: words(151) }).success && !taskReportSubmitSchema.safeParse({ taskId: id, pendingWork: words(101) }).success
  && !taskReportSubmitSchema.safeParse({ taskId: id, remarks: words(51) }).success, 'task report: each field over its limit is refused');
check(taskReportSubmitSchema.safeParse({ taskId: id, workCompleted: 'Done', progress: 40 }).success, 'task report: an older client that still sends progress is accepted');
check(taskReportReviewerEditSchema.safeParse({ workCompleted: 'Done', reason: 'Added the detail' }).success && !taskReportReviewerEditSchema.safeParse({ reason: 'Emptied it' }).success
  && !taskReportReviewerEditSchema.safeParse({ remarks: words(51), reason: 'Too long' }).success, 'task report: the Team Lead\'s correction keeps the same rules');

// AI Studio and AI Design Studio
check(aiStudioDailyReportSchema.safeParse({ reportDate: '2026-11-20', taskIds: [], pendingWork: words(100), submit: true }).success
  && !aiStudioDailyReportSchema.safeParse({ reportDate: '2026-11-20', taskIds: [], remarks: words(51), submit: true }).success, 'AI Studio: the same limits');
check(!adsReportSchema.safeParse({}).success && adsReportSchema.safeParse({ remarks: 'Waiting for the colours' }).success && !adsReportSchema.safeParse({ workCompleted: words(151) }).success,
  'AI Design Studio: optional fields (at least one) with the same limits');
console.log(`=== ${passed} DAILY REPORT FIELDS UNIT CHECKS PASSED ===`);
