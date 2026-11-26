import type {
  AiStudioAssignees, AiStudioDailyContext, AiStudioDeadlines, AiStudioOverview, AiStudioPerson, AiStudioProject, AiStudioReportContext, AiStudioReportDetail, AiStudioReportPage, AiStudioTask,
  AiStudioTaskDetail, AiStudioTaskPage
} from '../../../shared/contracts';
import { api } from './client';

export interface AiStudioTaskForm { projectId: string; assigneeId: string; title: string; description?: string; priority: string; dueDate?: string; attachments?: string[] }
export interface AiStudioReportForm {
  projectId: string;
  taskId?: string | null;
  reportDate: string;
  workCompleted?: string;
  workInProgress?: string;
  pendingWork?: string;
  blockers?: string;
  remarks?: string;
  submit: boolean;
}
export interface AiStudioReportsFilter { view: 'mine' | 'team' | 'department'; projectId?: string; status?: string; leadId?: string; authorId?: string; from?: string; to?: string; page?: number; pageSize?: number }
export interface AiStudioTasksFilter { scope: 'mine' | 'ongoing' | 'team'; projectId?: string; status?: string; assigneeId?: string; kind?: 'STANDARD' | 'CROSS_TEAM'; page?: number; pageSize?: number }
/** The day's report (20270218000100): one per person and day, one entry per task. */
export interface AiStudioDailyReportForm {
  id?: string | null;
  reportDate: string;
  summary?: string | null;
  additionalWork?: string | null;
  blockers?: string | null;
  tomorrowPlan?: string | null;
  entries: { taskId: string; workCompleted?: string | null; minutesSpent?: number | null; reportedProgress?: number | null; blockers?: string | null; nextAction?: string | null }[];
  submit: boolean;
}

/** AI Studio: every call is checked again by the database for who is asking. */
export const aiStudioApi = {
  overview: () => api.get<AiStudioOverview>('/ai-studio/overview'),
  people: () => api.get<AiStudioPerson[]>('/ai-studio/people'),
  assignLead: (memberIds: string[], leadId: string) => api.post<{ leadId: string; assigned: number; alreadyAssigned: number }>('/ai-studio/people/assign-lead', { memberIds, leadId }),
  setLead: (memberId: string, leadId: string) => api.post<{ memberId: string; leadId: string }>(`/ai-studio/people/${memberId}/lead`, { leadId }),
  projects: () => api.get<AiStudioProject[]>('/ai-studio/projects'),
  deadlines: () => api.get<AiStudioDeadlines>('/ai-studio/deadlines'),
  createProject: (p: { name: string; description?: string; deadlineAt?: string | null }) => api.post<Pick<AiStudioProject, 'id' | 'name' | 'description' | 'status' | 'createdAt' | 'deadlineAt'>>('/ai-studio/projects', p),
  updateProject: (id: string, p: { name: string; description?: string; status?: string; deadlineAt?: string | null }) => api.patch<Pick<AiStudioProject, 'id' | 'name' | 'description' | 'status' | 'createdAt' | 'deadlineAt'>>(`/ai-studio/projects/${id}`, p),
  assignProject: (id: string, profileId: string, assign: boolean) => api.post<{ projectId: string; profileId: string; assigned: boolean }>(`/ai-studio/projects/${id}/assign`, { profileId, assign }),
  tasks: (f: AiStudioTasksFilter) => api.get<AiStudioTaskPage>('/ai-studio/tasks', { ...f }),
  task: (id: string) => api.get<AiStudioTaskDetail>(`/ai-studio/tasks/${id}`),
  assignTask: (t: AiStudioTaskForm) => api.post<AiStudioTask>('/ai-studio/tasks', t),
  editTask: (id: string, t: { title: string; description?: string; priority: string; dueDate?: string }) => api.patch<AiStudioTask>(`/ai-studio/tasks/${id}`, t),
  updateTask: (id: string, u: { status: 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED'; progress: number; note?: string; attachments?: string[] }) => api.post<AiStudioTask>(`/ai-studio/tasks/${id}/update`, u),
  reportContext: () => api.get<AiStudioReportContext>('/ai-studio/reports/context'),
  reports: (f: AiStudioReportsFilter) => api.get<AiStudioReportPage>('/ai-studio/reports', { ...f }),
  report: (id: string) => api.get<AiStudioReportDetail>(`/ai-studio/reports/${id}`),
  createReport: (r: AiStudioReportForm) => api.post<AiStudioReportDetail>('/ai-studio/reports', r),
  updateReport: (id: string, r: AiStudioReportForm) => api.patch<AiStudioReportDetail>(`/ai-studio/reports/${id}`, r),
  deleteDraft: (id: string) => api.delete<null>(`/ai-studio/reports/${id}`),
  review: (id: string, decision: 'APPROVE' | 'RETURN', comment?: string) => api.post<AiStudioReportDetail>(`/ai-studio/reports/${id}/review`, { decision, comment }),
  /** Who a task of this project can go to, grouped by team with their workload (cross-team for a Team Lead on the project). */
  assignees: (projectId: string) => api.get<AiStudioAssignees>(`/ai-studio/projects/${projectId}/assignees`),
  dailyContext: (date?: string) => api.get<AiStudioDailyContext>('/ai-studio/daily-reports/context', date ? { date } : {}),
  saveDailyReport: (r: AiStudioDailyReportForm) => api.post<AiStudioReportDetail>('/ai-studio/daily-reports', r),
  /** The Team Lead corrects a report waiting for their approval; `reason` is shown to the employee (20270214000100). */
  leadEdit: (id: string, e: { workCompleted: string; workInProgress?: string | null; pendingWork?: string | null; blockers?: string | null; remarks?: string | null; reason: string }) =>
    api.post<AiStudioReportDetail>(`/ai-studio/reports/${id}/lead-edit`, e)
};
