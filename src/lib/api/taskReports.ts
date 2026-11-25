import type {
  PerformanceOverview, PerformanceRecordHistoryEntry, PerformanceRecordState, PerformanceSubjectHistory, TaskDailyReport, TaskDailyReportDetail, TaskDailyReportList, TaskReportTaskOption
} from '../../../shared/contracts';
import { api } from './client';

/** What the Team Member fills in: nothing about the author, the team or the reviewer (the database reads those from the login). */
export interface TaskReportForm {
  taskId: string;
  reportDate?: string;
  workCompleted: string;
  progress: number;
  pendingWork?: string;
  delayReason?: string;
  remarks?: string;
}
export interface TaskReportFilter { scope: 'MINE' | 'TEAM'; status?: string; from?: string; to?: string; memberId?: string; taskId?: string; page?: number }

export const taskReportsApi = {
  myTasks: () => api.get<TaskReportTaskOption[]>('/task-reports/my-tasks'),
  submit: (f: TaskReportForm) => api.post<TaskDailyReport>('/task-reports', f),
  list: (f: TaskReportFilter) => api.get<TaskDailyReportList>('/task-reports', { ...f }),
  get: (id: string) => api.get<TaskDailyReportDetail>(`/task-reports/${id}`),
  review: (id: string, decision: 'APPROVE' | 'RETURN', remarks?: string) => api.post<TaskDailyReport>(`/task-reports/${id}/review`, { decision, remarks })
};

export const performanceApprovalApi = {
  overview: (q: { start: string; end: string; departmentId?: string }) => api.get<PerformanceOverview>('/performance-approval/overview', { ...q }),
  review: (id: string, decision: 'APPROVE' | 'RETURN', remarks?: string, version?: number, rating?: number) =>
    api.post<PerformanceRecordState>(`/performance-approval/records/${id}/review`, { decision, remarks, version, rating }),
  resubmit: (id: string) => api.post<PerformanceRecordState>(`/performance-approval/records/${id}/resubmit`, {}),
  history: (id: string) => api.get<PerformanceRecordHistoryEntry[]>(`/performance-approval/records/${id}/history`),
  /** Every evaluation of one person, all periods (Team Lead: their members; Department Head: the department). */
  personHistory: (id: string) => api.get<PerformanceSubjectHistory>(`/performance-approval/people/${id}/history`)
};
