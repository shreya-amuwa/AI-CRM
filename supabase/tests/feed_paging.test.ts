/**
 * Feed-style lists (recent activity, history, timelines, notes, logs, notifications) show one page at a time instead of growing
 * the page: 10 per page, 5 for the "Recent activity" cards (src/lib/paging.ts, src/components/common/Paged.tsx, src/client/ui.tsx).
 *   1. the paging arithmetic;
 *   2. guard: every feed screen that was paged keeps using the pager (a later edit that goes back to printing the whole list fails here).
 */
import { readFileSync } from 'node:fs';
import { FEED_PAGE_SIZE, pageOf } from '../../src/lib/paging';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => {
  if (!ok) { console.error('not ok -', name, extra ?? ''); process.exit(1); }
  passed++; console.log('ok -', name);
};
const items = Array.from({ length: 23 }, (_, i) => i + 1);

check(FEED_PAGE_SIZE === 10, 'feeds show 10 per page by default');
let v = pageOf(items, 1, 10);
check(v.rows.join() === '1,2,3,4,5,6,7,8,9,10' && v.pages === 3 && v.page === 1, 'page 1 holds the first 10 (the newest: feeds arrive newest first)', v);
v = pageOf(items, 3, 10);
check(v.rows.join() === '21,22,23' && v.page === 3, 'the last page holds the rest', v);
v = pageOf(items, 9, 10);
check(v.page === 3 && v.rows.length === 3, 'a page past the end shows the last page, never an empty one', v);
v = pageOf(items, 0, 10);
check(v.page === 1 && v.rows.length === 10, 'page 0 or less is page 1', v);
v = pageOf(items, Number.NaN, 10);
check(v.page === 1, 'a broken page number is page 1', v);
v = pageOf([], 1, 10);
check(v.rows.length === 0 && v.pages === 1 && v.page === 1, 'an empty list has one (empty) page', v);
v = pageOf(items, 2, 5);
check(v.rows.join() === '6,7,8,9,10' && v.pages === 5, 'recent activity: 5 per page', v);
v = pageOf(items, 1, 0);
check(v.rows.length === 1, 'a zero page size is treated as 1, not an endless page', v);

// ---- guard ---------------------------------------------------------------------------------------------------------------------
const PAGED: string[] = [
  'src/components/ai-design-studio/AdsOverviewPage.tsx',
  'src/components/ai-design-studio/adsUi.tsx',
  'src/components/ai-studio/AiStudioOverview.tsx',
  'src/components/ai-studio/AiStudioReports.tsx',
  'src/components/ai-studio/AiStudioTasks.tsx',
  'src/components/ai-studio/ReportWork.tsx',
  'src/components/aiqr/AiqrStudioPanel.tsx',
  'src/components/attendance/AttendancePage.tsx',
  'src/components/bugs/bugUi.tsx',
  'src/components/business-associate/HomePage.tsx',
  'src/components/business-associate/TasksPage.tsx',
  'src/components/client-portal/ClientActivityManager.tsx',
  'src/components/common/ScopeOverviewPanel.tsx',
  'src/components/crocodial/CrocodialAdminPage.tsx',
  'src/components/crocodial/CrocodialLeadActivityCard.tsx',
  'src/components/departments/amuwa/EmployeeProfileModal.tsx',
  'src/components/departments/wabastore/LeadActivityTimeline.tsx',
  'src/components/employees/EmployeeRequestsPanel.tsx',
  'src/components/field-visit/ActiveFieldVisits.tsx',
  'src/components/field-visit/FieldVisitLeadQueue.tsx',
  'src/components/hr-recruiter/CandidateProfile.tsx',
  'src/components/hr/PaidLeaveManagement.tsx',
  'src/components/hr/RecruitmentManagement.tsx',
  'src/components/hr/offers/OfferLetterGenerator.tsx',
  'src/components/invoices/InvoiceWhatsAppCard.tsx',
  'src/components/issues/caseUi.tsx',
  'src/components/journey/SubscriptionPanel.tsx',
  'src/components/leave/LeaveCenter.tsx',
  'src/components/meetings/MeetingSummaries.tsx',
  'src/components/meetings/MeetingsPage.tsx',
  'src/components/notices/NoticeBoard.tsx',
  'src/components/notifications/NotificationBell.tsx',
  'src/components/operations/OperationsDashboard.tsx',
  'src/components/performance/ReportView.tsx',
  'src/components/reports/ReportDetailDialog.tsx',
  'src/components/reports/TaskReports.tsx',
  'src/components/reports/WeeklyPackageView.tsx',
  'src/components/sales-head/LeadList.tsx',
  'src/components/sales-head/SalesOverview.tsx',
  'src/components/superadmin/CompanyOverview.tsx',
  'src/components/support-member/CustomersPage.tsx',
  'src/components/support/consultant/ConsultationNotes.tsx',
  'src/components/support/consultant/VerificationNotes.tsx',
  'src/components/support/consultant/WorkflowStatusPanel.tsx',
  'src/components/tasks/TaskParts.tsx',
  'src/components/tasks/WorkUpdates.tsx',
  'src/components/team-lead/dashboard/TeamLeaderDashboard.tsx',
  'src/components/team-member/pipeline/ChecklistPanel.tsx',
  'src/components/team-member/pipeline/LeadForms.tsx',
  'supabase/tests/ui/feed_paging_harness.tsx',
];
for (const f of PAGED) {
  const s = readFileSync(f, 'utf8');
  check(/<Paged\b/.test(s) && /import \{[^}]*\bPaged\b[^}]*\} from '[^']*\/Paged'/.test(s), `${f} shows its feed one page at a time`);
}
for (const f of ['src/client/MonthlyPlans.tsx', 'src/client/Notifications.tsx']) {
  check(/<ClientPaged\b/.test(readFileSync(f, 'utf8')), `${f} (client dashboard) shows its feed one page at a time`);
}
// the two lists the owner named: Recent activity 5, Crocodial history 10
check(/<Paged items=\{d\.recentActivity\} pageSize=\{5\}/.test(readFileSync('src/components/superadmin/CompanyOverview.tsx', 'utf8')), 'Company overview: Recent activity shows 5 per page');
check(/<Paged items=\{data\.audit\} noun="changes">/.test(readFileSync('src/components/crocodial/CrocodialAdminPage.tsx', 'utf8')), 'Crocodial: History shows 10 per page');
console.log(`=== FEED PAGING CHECKS PASSED (${passed}) ===`);
