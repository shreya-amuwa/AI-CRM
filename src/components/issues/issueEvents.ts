import { openReview } from '../hr/reviews/reviewUi';
import { openHrTab } from '../hr/hrTabEvents';
import { useEffect } from 'react';
import { openReports } from '../reports/reportEvents';
import { openAiStudio } from '../ai-studio/aiStudioEvents';
import { openAttendance } from '../attendance/attendanceEvents';
import { openAds } from '../ai-design-studio/adsEvents';
import { openHrMeetingRequest, openMeeting, openMeetingReport } from '../meetings/meetingEvents';
import { openWorkUpdate } from '../tasks/workUpdateEvents';
import { openBugs } from '../bugs/bugEvents';
import { openNotice } from '../notices/noticeEvents';
import { openWallet, openWalletAdmin } from '../wallet/walletEvents';

/** Other screens (a notification) can open the Raise an Issue page on one of the employee's own issues or meeting requests. */
export const OPEN_ISSUES_EVENT = 'crm:open-issues';
export interface OpenIssuesDetail {
  kind: 'ISSUE' | 'MEETING' | 'BUG';
  id?: string;
}

let pending: OpenIssuesDetail | null = null;

export const openIssues = (detail: OpenIssuesDetail) => {
  pending = detail;
  window.dispatchEvent(new CustomEvent<OpenIssuesDetail>(OPEN_ISSUES_EVENT, { detail }));
};
/** The page takes what was asked for when it opens (once). */
export const takePendingIssues = (): OpenIssuesDetail | null => {
  const p = pending;
  pending = null;
  return p;
};

/** For a dashboard: switch to its Raise an Issue page when something asks for it. */
export function useOpenIssuesRequest(show: () => void) {
  useEffect(() => {
    const on = () => show();
    window.addEventListener(OPEN_ISSUES_EVENT, on);
    return () => window.removeEventListener(OPEN_ISSUES_EVENT, on);
  }, [show]);
}

/** HR: a notification opens HR's Employee Issues / Meeting Requests section on the case it is about. */
export const OPEN_HR_CASE_EVENT = 'crm:open-hr-case';
export interface OpenHrCaseDetail {
  // 'ai-studio' (20270302000100): HR > AI Studio Performance
  section: 'issues' | 'meetings' | 'reviews' | 'ai-studio';
  id?: string;
}
let pendingHr: OpenHrCaseDetail | null = null;
export const openHrCase = (detail: OpenHrCaseDetail) => {
  pendingHr = detail;
  window.dispatchEvent(new CustomEvent<OpenHrCaseDetail>(OPEN_HR_CASE_EVENT, { detail }));
};
export const takePendingHrCase = (section: OpenHrCaseDetail['section']): string | null => {
  const p = pendingHr;
  if (!p || p.section !== section) return null;
  pendingHr = null;
  return p.id ?? null;
};
export function useOpenHrCaseRequest(show: (detail: OpenHrCaseDetail) => void) {
  useEffect(() => {
    const on = (e: Event) => show((e as CustomEvent<OpenHrCaseDetail>).detail);
    window.addEventListener(OPEN_HR_CASE_EVENT, on);
    return () => window.removeEventListener(OPEN_HR_CASE_EVENT, on);
  }, [show]);
}

const EMPLOYEE_SIDE = new Set(['EMPLOYEE_ISSUE_UPDATED', 'EMPLOYEE_MEETING_UPDATED']);
/** A notification about an employee issue or meeting request: open the right page on it. Returns false for any other notification. */
export function openFromNotification(n: { type: string; entityType: string | null; entityId: string | null }): boolean {
  // AI Design Studio (clients, notices, assignments, reports, issues): open its dashboard on the record
  if (n.entityType?.startsWith('ads_')) { openAds({ entityType: n.entityType, id: n.entityId ?? undefined }); return true; }
  // a work report notification (submitted, decided, sent back, package sent) opens the Reports page, on the report when it names one
  // a weekly report that reached HR opens HR's Performance Reviews; the consolidated report / analysis opens the Super Admin's Reports & Performance
  if (n.entityType === 'work_report_package' && n.type === 'REPORT_WEEKLY_SENT_TO_HR') { openHrCase({ section: 'reviews' }); return true; }
  if (n.entityType === 'hr_consolidated_report') { openReports({}); return true; }
  // AI Studio: a task or a daily report opens its page of the AI Studio dashboard, on that item
  // an attendance reminder (Punch In, lunch, Punch Out) opens the person's own attendance
  if (n.entityType === 'attendance') { openAttendance(); return true; }
  // a company notice (20270131000200): the Notice Board, on that notice
  if (n.entityType === 'company_notice') { openNotice(n.entityId ?? undefined); return true; }
  // the wallet (20270207000100): an incentive credited, a bonus credited, a withdrawal submitted / approved; a credit waiting for approval opens Accounts' wallet page
  if (n.entityType === 'wallet') { openWallet(); return true; }
  if (n.entityType === 'wallet_credit') { openWalletAdmin(); return true; }
  // the Super Admin's 11:00 alert (20270131000100): straight to Today's Attendance Overview
  if (n.entityType === 'attendance_overview') { openAttendance('today'); return true; }
  // any task notification (assigned, an update requested / submitted, blocked, completed) opens the Task page that shows it, on that task
  if (n.entityType === 'work_task') { openWorkUpdate({ taskId: n.entityId ?? undefined }); return true; }
  // a meeting (a request, an approval, a move, a cancellation, a reminder) opens Meetings on it
  if (n.entityType === 'meeting') { openMeeting(n.entityId ?? undefined); return true; }
  // confirmation / internship reviews (20270312000100): the review opens over the current dashboard
  if (n.entityType === 'hr_review' && n.entityId) { openReview(n.entityId); return true; }
  // a Telecaller performance review waiting for a meeting time (20270312000300): HR's Telecaller Performance page
  if (n.entityType === 'telecaller_performance') { openHrTab('hr_telecaller_performance'); return true; }
  // a meeting summary report (submitted, revised, an action item given, an answer) opens it in Meetings
  if (n.entityType === 'meeting_summary') { openMeetingReport(n.entityId ?? undefined); return true; }
  // a bug (20270122000300): the reporter's status change opens their bug reports; a developer's opens the Bugs section
  if (n.entityType === 'dev_bug') {
    // the reporter's side (a status change, a developer's reply): their own issues to the Developer Team
    if (n.type === 'DEV_BUG_STATUS' || n.type === 'DEV_BUG_MESSAGE') openIssues({ kind: 'BUG', id: n.entityId ?? undefined });
    else openBugs();
    return true;
  }
  if (n.entityType === 'ai_studio_task') { openAiStudio({ kind: 'task', id: n.entityId ?? undefined }); return true; }
  // a report that reached HR (or the access given) opens HR > AI Studio Performance, never the AI Studio dashboard HR has no part in
  if (n.type === 'AI_STUDIO_REPORT_TO_HR' || n.type === 'AI_STUDIO_REPORT_TO_HR_LEAD' || n.type === 'AI_STUDIO_REPORT_HR_ACCESS') { openHrCase({ section: 'ai-studio' }); return true; }
  if (n.entityType === 'ai_studio_report') { openAiStudio({ kind: 'report', id: n.entityId ?? undefined }); return true; }
  if (n.entityType === 'ai_studio_project') { openAiStudio({ kind: 'task' }); return true; }
  // (20270308000100) an AI Studio weekly report: the Team Lead's Weekly Report, the Super Admin's Weekly Reports
  if (n.entityType === 'ai_studio_weekly_report') { openAiStudio({ kind: 'weekly', id: n.entityId ?? undefined }); return true; }
  if (n.entityType === 'work_report' || n.entityType === 'work_report_package') {
    openReports({ id: n.entityType === 'work_report' ? n.entityId ?? undefined : undefined });
    return true;
  }
  if (n.entityType !== 'employee_issue' && n.entityType !== 'employee_meeting') return false;
  const issue = n.entityType === 'employee_issue';
  // a meeting request to HR is on the Meetings page (HR meeting requests)
  if (EMPLOYEE_SIDE.has(n.type)) { if (issue) openIssues({ kind: 'ISSUE', id: n.entityId ?? undefined }); else openHrMeetingRequest(n.entityId ?? undefined); }
  else openHrCase({ section: issue ? 'issues' : 'meetings', id: n.entityId ?? undefined });
  return true;
}
