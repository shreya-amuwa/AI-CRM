/**
 * Daily reports, every department (20270308000100, 20270312000100), no database: Work Completed (required, 10 to 150 words), Work Pending (optional, 100),
 * Additional Note (optional, 50), in the shared schemas the forms and the API use (the database's private.report_word_limits holds the same rules).
 * Run: npm run test:unit
 */
import {
  DAILY_REPORT_FIELDS, adsReportSchema, aiStudioDailyReportSchema, dailyReportMinProblem, dailyReportProblems, dailyReportWordProblem, reportSaveSchema, reportSubmitProblems,
  taskReportReviewerEditSchema, taskReportSubmitSchema
} from '../../shared/validation.js';

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

check(DAILY_REPORT_FIELDS.map(f => `${f.label}:${f.minWords}-${f.maxWords}`).join('|') === 'Work Completed:10-150|Work Pending:0-100|Additional Note:0-50',
  'three fields, in order: Work Completed 10-150 (required), Work Pending up to 100, Additional Note up to 50');
check(dailyReportWordProblem('workCompleted', words(150)) === null && /at most 150 words \(now 151\)/.test(dailyReportWordProblem('workCompleted', words(151)) ?? ''), 'Work Completed: 150 words pass, 151 do not');
check(dailyReportMinProblem('workCompleted', words(10)) === null && /at least 10 words in Work Completed \(now 9\)/.test(dailyReportMinProblem('workCompleted', words(9)) ?? ''), 'Work Completed: 10 words pass, 9 do not');
check(/now 0/.test(dailyReportMinProblem('workCompleted', '') ?? '') && dailyReportMinProblem('pendingWork', '') === null && dailyReportMinProblem('remarks', '') === null,
  'Work Completed is required; the other two are optional');
check(dailyReportWordProblem('pendingWork', words(100)) === null && dailyReportWordProblem('pendingWork', words(101)) !== null, 'Work Pending: 100 / 101');
check(dailyReportWordProblem('remarks', words(50)) === null && dailyReportWordProblem('remarks', words(51)) !== null, 'Additional Note: 50 / 51');
check(dailyReportWordProblem('remarks', 'x'.repeat(1000)) === null && dailyReportMinProblem('workCompleted', `${'x'.repeat(100)} - ...`) !== null, 'words are counted, not characters (punctuation alone is not a word)');
check(Object.keys(dailyReportProblems({ workCompleted: words(12), pendingWork: words(101), remarks: words(51) })).join() === 'pendingWork,remarks', 'every problem is listed by field');

// the Task Daily Report (every department that uses work tasks)
check(!taskReportSubmitSchema.safeParse({ taskId: id }).success && !taskReportSubmitSchema.safeParse({ taskId: id, pendingWork: 'Call the rest' }).success, 'task report: Work Completed is required');
check(taskReportSubmitSchema.safeParse({ taskId: id, workCompleted: words(10) }).success, 'task report: Work Completed alone (10 words) is enough');
check(!taskReportSubmitSchema.safeParse({ taskId: id, workCompleted: words(151) }).success && !taskReportSubmitSchema.safeParse({ taskId: id, workCompleted: words(10), pendingWork: words(101) }).success
  && !taskReportSubmitSchema.safeParse({ taskId: id, workCompleted: words(10), remarks: words(51) }).success, 'task report: each field over its limit is refused');
check(taskReportSubmitSchema.safeParse({ taskId: id, workCompleted: words(10), progress: 40 }).success, 'task report: an older client that still sends progress is accepted');
check(taskReportReviewerEditSchema.safeParse({ workCompleted: words(10), reason: 'Added the detail' }).success && !taskReportReviewerEditSchema.safeParse({ workCompleted: 'Done', reason: 'Shortened it' }).success
  && !taskReportReviewerEditSchema.safeParse({ workCompleted: words(10), remarks: words(51), reason: 'Too long' }).success, 'task report: the Team Lead\'s correction keeps the same rules');

// AI Studio and AI Design Studio
check(aiStudioDailyReportSchema.safeParse({ reportDate: '2026-11-20', taskIds: [], workCompleted: words(10), pendingWork: words(100), submit: true }).success
  && !aiStudioDailyReportSchema.safeParse({ reportDate: '2026-11-20', taskIds: [], workCompleted: words(9), submit: true }).success
  && aiStudioDailyReportSchema.safeParse({ reportDate: '2026-11-20', taskIds: [], workCompleted: 'Short draft', submit: false }).success, 'AI Studio: the same rules on submission; a draft may be short');
check(!adsReportSchema.safeParse({ remarks: 'Waiting for the colours' }).success && adsReportSchema.safeParse({ workCompleted: words(10) }).success && !adsReportSchema.safeParse({ workCompleted: words(151) }).success,
  'AI Design Studio: the same rules');

// the work report of the Reports menu: the maximums on every save, the minimum on submission
const wr = (content: Record<string, unknown>) => reportSaveSchema.safeParse({ title: 'Daily report', reportDate: '2026-11-20', periodType: 'DAILY', periodStart: '2026-11-20', periodEnd: '2026-11-20', content });
check(wr({ workCompleted: 'Short draft', pendingWork: 'Later' }).success, 'work report: a short draft is saved');
const over = wr({ workCompleted: words(151) });
check(!over.success && over.error.issues[0]?.path.join('.') === 'content.workCompleted', 'work report: a field over its limit is refused on save, on its field');
check(!wr({ pendingWork: words(101) }).success && !wr({ remarks: words(51) }).success, 'work report: Work Pending 101 and an Additional Note of 51 words are refused');
check(!!reportSubmitProblems({ workCompleted: 'Short' }).workCompleted && Object.keys(reportSubmitProblems({ workCompleted: words(10) })).length === 0, 'work report: submission needs 10 words in Work Completed');
console.log(`=== ${passed} DAILY REPORT FIELDS UNIT CHECKS PASSED ===`);
