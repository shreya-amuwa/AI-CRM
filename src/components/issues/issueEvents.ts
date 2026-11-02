import { useEffect } from 'react';
import { openReports } from '../reports/reportEvents';

/** Other screens (a notification) can open the Raise an Issue page on one of the employee's own issues or meeting requests. */
export const OPEN_ISSUES_EVENT = 'crm:open-issues';
export interface OpenIssuesDetail {
  kind: 'ISSUE' | 'MEETING';
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
  section: 'issues' | 'meetings' | 'reviews';
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
  // a work report notification (submitted, decided, sent back, package sent) opens the Reports page, on the report when it names one
  // a weekly report that reached HR opens HR's Performance Reviews; the consolidated report / analysis opens the Super Admin's Reports & Performance
  if (n.entityType === 'work_report_package' && n.type === 'REPORT_WEEKLY_SENT_TO_HR') { openHrCase({ section: 'reviews' }); return true; }
  if (n.entityType === 'hr_consolidated_report') { openReports({}); return true; }
  if (n.entityType === 'work_report' || n.entityType === 'work_report_package') {
    openReports({ id: n.entityType === 'work_report' ? n.entityId ?? undefined : undefined });
    return true;
  }
  if (n.entityType !== 'employee_issue' && n.entityType !== 'employee_meeting') return false;
  const issue = n.entityType === 'employee_issue';
  if (EMPLOYEE_SIDE.has(n.type)) openIssues({ kind: issue ? 'ISSUE' : 'MEETING', id: n.entityId ?? undefined });
  else openHrCase({ section: issue ? 'issues' : 'meetings', id: n.entityId ?? undefined });
  return true;
}
