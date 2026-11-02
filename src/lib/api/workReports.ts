import type {
  DailyDepartmentSummary, WeeklyBoard, WeeklyDepartmentReport, WeeklyPendingItem,
  DepartmentReportBox, MemberApprovalList, ReportContext, ReportTaskOption, ReportInbox, ReportPackage, ReportsDepartmentDetail, OperationsReportBoard, TeamReportBox, WorkReportContent, WorkReportDetail,
  WorkReportSummary
} from '../../../shared/contracts';
import type { ReportPeriodType } from '../../../shared/reportFields';
import { api } from './client';

/** What the author fills in: nothing about the author, the team or the reviewer (the database reads those from the login). */
export interface WorkReportForm {
  title: string;
  reportDate: string;
  periodType: ReportPeriodType;
  periodStart: string;
  periodEnd: string;
  content: WorkReportContent;
}
export interface InboxFilter { status?: string; from?: string; to?: string; author?: string }

export const workReportsApi = {
  context: () => api.get<ReportContext>('/work-reports/context'),
  mine: (status?: string) => api.get<WorkReportSummary[]>('/work-reports/mine', { status }),
  get: (id: string) => api.get<WorkReportDetail>(`/work-reports/${id}`),
  create: (form: WorkReportForm) => api.post<WorkReportDetail>('/work-reports', form),
  update: (id: string, form: WorkReportForm) => api.patch<WorkReportDetail>(`/work-reports/${id}`, form),
  submit: (id: string) => api.post<WorkReportDetail>(`/work-reports/${id}/submit`, {}),
  deleteDraft: (id: string) => api.delete<null>(`/work-reports/${id}`),
  inbox: (f: InboxFilter = {}) => api.get<ReportInbox>('/work-reports/inbox', { ...f }),
  memberApprovals: (f: { status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVISION_REQUIRED' | 'ALL'; from?: string; to?: string } = {}) =>
    api.get<MemberApprovalList>('/work-reports/member-approvals', { ...f }),
  myTasks: () => api.get<ReportTaskOption[]>('/work-reports/my-tasks'),
  review: (id: string, decision: 'APPROVED' | 'REJECTED' | 'REVISION_REQUIRED', comment?: string) =>
    api.post<WorkReportDetail>(`/work-reports/${id}/review`, { decision, comment }),
  teamBox: (from: string, to: string) => api.get<TeamReportBox>('/work-reports/team-box', { from, to }),
  department: (from: string, to: string) => api.get<DepartmentReportBox>('/work-reports/department', { from, to }),
  submitPackage: (p: { from: string; to: string; periodType: ReportPeriodType; note?: string }) => api.post<ReportPackage>('/work-reports/package', p),
  operations: (from: string, to: string) => api.get<OperationsReportBoard>('/work-reports/operations', { from, to }),
  operationsDepartment: (id: string, from: string, to: string) => api.get<ReportsDepartmentDetail>(`/work-reports/operations/departments/${id}`, { from, to })
};

// ---- Daily summary and the weekly department report (Department Head -> Operations Head -> HR) ----
export const weeklyReportsApi = {
  dailySummary: (q: { date?: string; department?: string } = {}) => api.get<DailyDepartmentSummary>('/work-reports/daily-summary', { ...q }),
  weekly: (weekStart: string) => api.get<WeeklyDepartmentReport>('/work-reports/weekly', { weekStart }),
  saveWeekly: (w: { weekStart: string; title: string; assignedOverview?: string; completedOverview?: string; remarks?: string; submit: boolean }) =>
    api.post<ReportPackage>('/work-reports/weekly', w),
  board: (weekStart: string) => api.get<WeeklyBoard>('/work-reports/weekly/board', { weekStart }),
  pending: () => api.get<WeeklyPendingItem[]>('/work-reports/weekly/pending'),
  review: (id: string, decision: 'APPROVED' | 'REVISION_REQUIRED', comment?: string) => api.post<ReportPackage>(`/work-reports/weekly/${id}/review`, { decision, comment })
};
