/**
 * Reporting hierarchy (20270306000100) without a database: the shared schemas of the AI Studio weekly report (Team Lead -> the Super Admin) and the extra
 * parts of the weekly department report. Who may write, read and review is decided by the database (report_hierarchy_test.sql).
 */
import { readFileSync } from 'node:fs';
import { aiStudioWeeklyReviewSchema, aiStudioWeeklySaveSchema, aiStudioWeeklyListQuerySchema, reportWeeklySaveSchema } from '../../shared/validation.js';

let passed = 0;
const check = (ok: unknown, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log('ok -', name);
};
const monday = '2026-11-16';
check(aiStudioWeeklySaveSchema.safeParse({ weekStart: monday, completedWork: 'Shipped the landing page', submit: true }).success, 'a week with the completed work can be submitted');
check(!aiStudioWeeklySaveSchema.safeParse({ weekStart: monday, completedWork: 'short', submit: true }).success, 'submitting needs at least 10 characters of completed work');
check(aiStudioWeeklySaveSchema.safeParse({ weekStart: monday, submit: false }).success, 'a draft may be empty');
check(!aiStudioWeeklySaveSchema.safeParse({ weekStart: '2026-11-17', completedWork: 'Shipped the landing page', submit: true }).success, 'a week starts on a Monday');
check(!aiStudioWeeklySaveSchema.safeParse({ weekStart: monday, completedWork: 'Shipped the landing page', submit: true, leadId: 'x' }).success
  && !aiStudioWeeklySaveSchema.safeParse({ weekStart: monday, completedWork: 'Shipped the landing page', submit: true, receiver: 'hr' }).success,
  'the browser never names the author or who receives it');
check(!aiStudioWeeklySaveSchema.safeParse({ weekStart: monday, completedWork: 'x'.repeat(4001), submit: false }).success, 'each part is at most 4000 characters');
check(aiStudioWeeklyReviewSchema.safeParse({ decision: 'ACKNOWLEDGE' }).success && !aiStudioWeeklyReviewSchema.safeParse({ decision: 'RETURN' }).success
  && aiStudioWeeklyReviewSchema.safeParse({ decision: 'RETURN', comment: 'Add the timeline' }).success && !aiStudioWeeklyReviewSchema.safeParse({ decision: 'APPROVE' }).success,
  'the Super Admin acknowledges, or returns with a comment');
check(aiStudioWeeklyListQuerySchema.safeParse({}).success && !aiStudioWeeklyListQuerySchema.safeParse({ status: 'APPROVED' }).success, 'the list filters by week and known statuses');
check(reportWeeklySaveSchema.safeParse({ weekStart: monday, title: 'Week', pendingOverview: 'Two escalations', achievements: 'Faster replies', challenges: 'One agent away', submit: false }).success,
  'the weekly department report takes pending work, achievements and challenges');
const mig = readFileSync('supabase/migrations/20270306000100_report_hierarchy.sql', 'utf8');
check(!/simran/i.test(mig.replace(/--.*$/gm, '')), 'no person is named in the database code (HR viewers are chosen by the Super Admin)');
check(/private\.ai_studio_department\(\)/.test(mig) && /ai_studio_weekly_receiver_ids/.test(mig), 'AI Studio is found from the department, and the weekly report goes to the Super Admins');
console.log(`\n${passed} checks passed`);
