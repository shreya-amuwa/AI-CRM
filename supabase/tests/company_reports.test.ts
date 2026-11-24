/**
 * Company reporting: the schemas the screens and the server share, and the analysis writer (no database needed). The analysis must stay
 * traceable: every point cites facts that exist, nothing is kept that cannot be traced, and the AI never receives a name.
 */
import { LEADERBOARD_CATEGORIES, REPORT_REMARKS_MAX, WEEKLY_REPORT_STATUSES, WEEKLY_STATUS_LABEL } from '../../shared/reportFields.js';
import {
  hrConsolidatedSaveSchema, hrReviewSaveSchema, reportAnalysisQuerySchema, reportDailySummaryQuerySchema, reportLeaderboardQuerySchema, reportSaveSchema,
  reportSettingsSchema, reportWeeklyReviewSchema, reportWeeklySaveSchema
} from '../../shared/validation.js';
import type { AnalysisFacts } from '../../shared/contracts.js';
import { aiFactsInput } from '../../server/reportAnalysis/ai.js';
import { FIXED_LIMITATIONS, ruleNarrative, validateNarrative } from '../../server/reportAnalysis/narrative.js';
import { writeAnalysis } from '../../server/reportAnalysis/writer.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

// ---- the standard report form: a short remark
const base = { title: 'Daily report', reportDate: '2026-12-01', periodType: 'DAILY', periodStart: '2026-12-01', periodEnd: '2026-12-01' };
check(reportSaveSchema.safeParse({ ...base, content: { remarks: 'x'.repeat(REPORT_REMARKS_MAX) } }).success, 'the remarks may use the full 500 characters');
check(!reportSaveSchema.safeParse({ ...base, content: { remarks: 'x'.repeat(REPORT_REMARKS_MAX + 1) } }).success, 'longer remarks are refused');
check(reportSaveSchema.safeParse({ ...base, content: { assignedTasks: ['5d4f1f3e-6f55-4b9c-9a4e-2c9d6a0b7a11'], completedTasks: [] } }).success, 'tasks are chosen by id');

// ---- the daily summary and the weekly report
check(reportDailySummaryQuerySchema.safeParse({}).success && reportDailySummaryQuerySchema.safeParse({ date: '2026-12-01' }).success && !reportDailySummaryQuerySchema.safeParse({ date: 'tomorrow' }).success, 'the summary date is optional but valid');
check(reportWeeklySaveSchema.safeParse({ weekStart: '2026-11-23', title: 'Week 1', submit: true }).success, 'a weekly report starting on a Monday passes');
check(!reportWeeklySaveSchema.safeParse({ weekStart: '2026-11-24', title: 'Week 1' }).success, 'a week must start on a Monday');
check(!reportWeeklySaveSchema.safeParse({ weekStart: '2026-11-23', title: '', submit: true }).success && reportWeeklySaveSchema.safeParse({ weekStart: '2026-11-23', title: '', submit: false }).success, 'a title is needed to submit, not to save a draft');
check(!reportWeeklySaveSchema.safeParse({ weekStart: '2026-11-23', title: 'x y z', remarks: 'x'.repeat(2001) }).success, 'the weekly summary is limited');
check(!reportWeeklyReviewSchema.safeParse({ decision: 'REVISION_REQUIRED' }).success && reportWeeklyReviewSchema.safeParse({ decision: 'APPROVED' }).success && !reportWeeklyReviewSchema.safeParse({ decision: 'REJECTED', comment: 'no' }).success, 'a revision needs a comment; the Operations Head approves or sends back');

// ---- HR reviews and the consolidated report
const pkg = '5d4f1f3e-6f55-4b9c-9a4e-2c9d6a0b7a11';
check(hrReviewSaveSchema.safeParse({ packageId: pkg, subjectId: pkg, rating: null }).success, 'a draft review needs nothing else');
check(!hrReviewSaveSchema.safeParse({ packageId: pkg, subjectId: pkg, rating: null, comments: 'ok fine', submit: true }).success, 'a submitted review needs a rating');
check(!hrReviewSaveSchema.safeParse({ packageId: pkg, subjectId: pkg, rating: 4, submit: true }).success && hrReviewSaveSchema.safeParse({ packageId: pkg, subjectId: pkg, rating: 4, comments: 'Good', submit: true }).success, 'and the assessment or the comments');
check(!hrReviewSaveSchema.safeParse({ packageId: pkg, subjectId: pkg, rating: 11 }).success, 'a rating is at most 10 (the scale is checked by the database)');
check(hrConsolidatedSaveSchema.safeParse({ weekStart: '2026-11-23', submit: true }).success && !hrConsolidatedSaveSchema.safeParse({ weekStart: '2026-11-24' }).success, 'the consolidated report is per week');

// ---- the leaderboard and the settings
check(reportLeaderboardQuerySchema.parse({}).category === 'TOP10' && reportLeaderboardQuerySchema.parse({}).periodType === 'WEEKLY', 'the leaderboard defaults to the weekly Top 10');
check(LEADERBOARD_CATEGORIES.every(c => reportLeaderboardQuerySchema.safeParse({ category: c }).success), 'every category is accepted');
check(!reportLeaderboardQuerySchema.safeParse({ category: 'BEST' }).success && !reportLeaderboardQuerySchema.safeParse({ department: 'x' }).success && !reportLeaderboardQuerySchema.safeParse({ ratingMin: 99 }).success, 'unknown categories, ids and out-of-range filters are refused');
check(reportLeaderboardQuerySchema.safeParse({ periodType: 'CUSTOM', from: '2026-11-01', to: '2026-11-30', role: 'TEAM_LEAD', completionMin: '50', complianceMax: '90', limit: '10' }).success, 'the filters work together');
check(reportAnalysisQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-07' }).success && !reportAnalysisQuerySchema.safeParse({ from: '2026-11-07', to: '2026-11-01' }).success, 'an analysis period ends after it starts');
const w = { taskCompletion: 35, compliance: 20, onTime: 10, approvalQuality: 10, hrRating: 25 };
check(reportSettingsSchema.safeParse({ weights: w, minTasks: 3, minExpectedReports: 3, workingDays: [1, 2, 3, 4, 5, 6] }).success, 'the scoring settings pass');
check(!reportSettingsSchema.safeParse({ weights: { ...w, hrRating: 101 }, minTasks: 3, minExpectedReports: 3, workingDays: [1] }).success
  && !reportSettingsSchema.safeParse({ weights: { taskCompletion: 0, compliance: 0, onTime: 0, approvalQuality: 0, hrRating: 0 }, minTasks: 3, minExpectedReports: 3, workingDays: [1] }).success
  && !reportSettingsSchema.safeParse({ weights: w, minTasks: 0, minExpectedReports: 3, workingDays: [1] }).success
  && !reportSettingsSchema.safeParse({ weights: w, minTasks: 3, minExpectedReports: 3, workingDays: [] }).success, 'a weight over 100, no weight at all, no minimum or no working day is refused');

// ---- the statuses
check(WEEKLY_REPORT_STATUSES.length === 9 && WEEKLY_REPORT_STATUSES.every(s => !!WEEKLY_STATUS_LABEL[s]), 'every weekly status has its label');
check(WEEKLY_STATUS_LABEL.SUBMITTED_TO_SUPERADMIN === 'Submitted to Managing Director' && WEEKLY_STATUS_LABEL.PENDING_OPERATIONS_HEAD.includes('CEO'), 'the weekly labels read as the stages');

// ---- the analysis: traceable, no names to the AI
const fact = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ factId: id, subjectType: 'PERSON' as const, subjectId: id, name, department: 'Sales', team: 'North', sources: ['work_tasks'], ...extra });
const facts: AnalysisFacts = {
  period: { from: '2026-11-23', to: '2026-11-29', days: 7, previousFrom: '2026-11-16', previousTo: '2026-11-22' },
  thresholds: { lowCompletion: 50, minTasks: 3 },
  counts: { people: 10, ranked: 8, insufficient: 2 },
  strongCompletion: [fact('SC-1', 'Asha Rao', { completionRate: 95, tasks: 20, completed: 19 })],
  lowCompletion: [fact('LC-2', 'Ravi Kumar', { completionRate: 30, tasks: 10, completed: 3 })],
  missingReports: [fact('MR-3', 'Meera Das', { compliance: 40, expected: 5, submitted: 2 })],
  repeatedRevisions: [], wellPerformingTeams: [], taskGaps: [], performanceChanges: [], departmentDelays: [], hrRatings: []
};
const rules = ruleNarrative(facts);
check(rules.sections.length === 3 && rules.sections.every(s => s.items.every(i => i.factIds.length === 1)), 'the rule-based analysis has one cited fact per point');
check(rules.sections.find(s => s.key === 'lowCompletion')?.items[0].text.includes('3 of 10') && rules.summary.includes('2 with insufficient data'), 'it states the recorded numbers and counts the insufficient-data people apart');
check(!/because|due to|reason|lazy|poor/i.test(JSON.stringify(rules.sections)), 'it assumes no reason for a result');
check(FIXED_LIMITATIONS.every(l => rules.limitations.includes(l)), 'the limits are always stated');
const ai = JSON.stringify(aiFactsInput(facts));
check(!ai.includes('Asha') && !ai.includes('Ravi') && !ai.includes('Meera') && !ai.includes('Sales') && ai.includes('SC-1'), 'the AI receives the facts by id, with no name, department or team');
const cleaned = validateNarrative({ summary: 's', sections: [{ key: 'lowCompletion', title: 'Low', items: [{ text: 'ok', factIds: ['LC-2'] }, { text: 'invented', factIds: ['XX-9'] }] }, { key: 'none', title: 'None', items: [{ text: 'x', factIds: ['XX-1'] }] }], limitations: [] }, facts);
check(cleaned.sections.length === 1 && cleaned.sections[0].items.length === 1 && cleaned.sections[0].items[0].factIds[0] === 'LC-2', 'a point that cites no real fact is dropped');
let threw = false;
try { validateNarrative({ summary: '', sections: [] }, facts); } catch { threw = true; }
check(threw, 'an AI answer without the required parts is refused');
const noKey = await writeAnalysis(facts, { apiKey: null, model: 'm', baseUrl: 'http://127.0.0.1:9', timeoutMs: 1000 });
check(noKey.source === 'RULES' && noKey.status === 'NOT_CONFIGURED' && noKey.narrative.sections.length === 3, 'without an AI key the rule-based analysis is used and says so');
const failed = await writeAnalysis(facts, { apiKey: 'k', model: 'm', baseUrl: 'http://127.0.0.1:9', timeoutMs: 1000 });
check(failed.source === 'RULES' && failed.status === 'FAILED' && !!failed.error, 'when the AI cannot be reached the rules are used and the failure is recorded');

console.log(`=== ${passed} COMPANY REPORT UNIT CHECKS PASSED ===`);
