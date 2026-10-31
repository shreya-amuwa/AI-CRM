import type {
  DepartmentReportBox, ReportContext, ReportInbox, ReportPackage, ReportsDepartmentDetail, OperationsReportBoard, TeamReportBox, WorkReportContent, WorkReportDetail,
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
  review: (id: string, decision: 'APPROVED' | 'REJECTED' | 'REVISION_REQUIRED', comment?: string) =>
    api.post<WorkReportDetail>(`/work-reports/${id}/review`, { decision, comment }),
  teamBox: (from: string, to: string) => api.get<TeamReportBox>('/work-reports/team-box', { from, to }),
  department: (from: string, to: string) => api.get<DepartmentReportBox>('/work-reports/department', { from, to }),
  submitPackage: (p: { from: string; to: string; periodType: ReportPeriodType; note?: string }) => api.post<ReportPackage>('/work-reports/package', p),
  operations: (from: string, to: string) => api.get<OperationsReportBoard>('/work-reports/operations', { from, to }),
  operationsDepartment: (id: string, from: string, to: string) => api.get<ReportsDepartmentDetail>(`/work-reports/operations/departments/${id}`, { from, to })
};
