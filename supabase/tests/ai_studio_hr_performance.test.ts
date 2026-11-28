/**
 * AI Studio daily report to HR (20270302000100), no database: the word rule the form and the API share (the database's private.word_count is the same
 * rule), the review decisions, and the HR period query. Run: npm run test:unit
 */
import { aiStudioDailyReportSchema, aiStudioHrPerformanceQuerySchema, aiStudioHrViewerSchema, aiStudioReportReviewSchema, countWords, dailyDescriptionProblem } from '../../shared/validation.js';

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

check(countWords('one two  three') === 3 && countWords('') === 0 && countWords(null) === 0 && countWords('  \n ') === 0, 'words are counted, whitespace alone is none');
check(countWords('a - ... b') === 2, 'punctuation alone is not a word');
check(countWords('x'.repeat(300)) === 1, 'a long run of characters is one word (words, not characters)');
check(countWords('नमस्ते दुनिया 2026') === 3, 'other scripts and numbers count as words');
check(dailyDescriptionProblem(words(9))?.includes('at least 10') && dailyDescriptionProblem(words(151))?.includes('at most 150'), '9 and 151 words are refused with a clear message');
check(dailyDescriptionProblem(words(10)) === null && dailyDescriptionProblem(words(150)) === null, '10 and 150 words are accepted');

// (20270308000100) the description is no longer asked for: the three fields' word limits apply instead
const base = { reportDate: '2026-11-20', taskIds: [], workCompleted: words(10) };  // (20270312000100) Work Completed needs 10 words
check(aiStudioDailyReportSchema.safeParse({ ...base, submit: true }).success, 'a submission without a description is accepted');
check(!aiStudioDailyReportSchema.safeParse({ ...base, submit: true, workCompleted: words(151) }).success, 'Work Completed over 150 words is refused');
check(aiStudioDailyReportSchema.safeParse({ ...base, submit: false, workCompleted: words(151) }).success, 'a draft may hold more (checked on submission)');

check(aiStudioReportReviewSchema.safeParse({ decision: 'REJECT', comment: 'Same as yesterday' }).success && !aiStudioReportReviewSchema.safeParse({ decision: 'DELETE' }).success,
  'Approve, Return and Reject only');
check(aiStudioHrPerformanceQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-20' }).success && !aiStudioHrPerformanceQuerySchema.safeParse({ from: '2026-11-21', to: '2026-11-20' }).success,
  'the HR period: from before to');
check(!aiStudioHrViewerSchema.safeParse({ profileId: 'x', allowed: true }).success && !aiStudioHrViewerSchema.safeParse({ profileId: '11111111-1111-4111-8111-111111111111', allowed: true, role: 'HR' }).success,
  'naming a viewer takes an id and a yes / no only');
console.log(`=== ${passed} AI STUDIO HR PERFORMANCE UNIT CHECKS PASSED ===`);
