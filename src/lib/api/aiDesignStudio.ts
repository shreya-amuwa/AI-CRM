import type {
  AdsAssignment, AdsAssignmentDetail, AdsClient, AdsContext, AdsIssue, AdsIssueDetail, AdsNotice, AdsOverview, AdsPerson, AdsReport, AdsReportDetail
} from '../../../shared/contracts';
import type {
  AdsAssignmentCreateInput, AdsClientCreateInput, AdsClientUpdateInput, AdsIssueCreateInput, AdsNoticeCreateInput, AdsReportInput
} from '../../../shared/validation';
import { api } from './client';

/** AI Design Studio API client. Nothing here sends a role, a team or a reviewer: the database reads those from the login. */
export const aiDesignStudioApi = {
  context: () => api.get<AdsContext>('/ai-design-studio/context'),
  people: () => api.get<AdsPerson[]>('/ai-design-studio/people'),
  overview: () => api.get<AdsOverview>('/ai-design-studio/overview'),

  clients: (q: { search?: string; status?: string } = {}) => api.get<AdsClient[]>('/ai-design-studio/clients', { ...q }),
  client: (id: string) => api.get<AdsClient>(`/ai-design-studio/clients/${id}`),
  createClient: (body: AdsClientCreateInput) => api.post<AdsClient>('/ai-design-studio/clients', body),
  updateClient: (id: string, body: AdsClientUpdateInput) => api.patch<AdsClient>(`/ai-design-studio/clients/${id}`, body),

  notices: (q: { clientId?: string; status?: string } = {}) => api.get<AdsNotice[]>('/ai-design-studio/notices', { ...q }),
  createNotice: (body: AdsNoticeCreateInput) => api.post<AdsNotice>('/ai-design-studio/notices', body),
  noticeStatus: (id: string, status: string) => api.post<AdsNotice>(`/ai-design-studio/notices/${id}/status`, { status }),

  assignments: (q: { view?: 'mine' | 'team' | 'all'; status?: string; clientId?: string } = {}) => api.get<AdsAssignment[]>('/ai-design-studio/assignments', { ...q }),
  assignment: (id: string) => api.get<AdsAssignmentDetail>(`/ai-design-studio/assignments/${id}`),
  createAssignment: (body: AdsAssignmentCreateInput) => api.post<AdsAssignment>('/ai-design-studio/assignments', body),
  updateAssignment: (id: string, body: { dueDate?: string | null; priority?: string; instructions?: string | null }) => api.patch<AdsAssignment>(`/ai-design-studio/assignments/${id}`, body),
  assignmentStatus: (id: string, body: { status: string; progress?: number; note?: string | null }) => api.post<AdsAssignment>(`/ai-design-studio/assignments/${id}/status`, body),
  reassign: (id: string, assigneeId: string, note?: string) => api.post<AdsAssignment>(`/ai-design-studio/assignments/${id}/reassign`, { assigneeId, note }),

  reports: (q: { view?: 'mine' | 'team' | 'all'; status?: string; from?: string; to?: string; clientId?: string; authorId?: string; leadId?: string } = {}) =>
    api.get<AdsReport[]>('/ai-design-studio/reports', { ...q }),
  report: (id: string) => api.get<AdsReportDetail>(`/ai-design-studio/reports/${id}`),
  submitReport: (body: AdsReportInput) => api.post<AdsReport>('/ai-design-studio/reports', body),
  reviewReport: (id: string, decision: 'APPROVE' | 'RETURN', remarks?: string) => api.post<AdsReport>(`/ai-design-studio/reports/${id}/review`, { decision, remarks }),

  issues: (q: { view?: 'mine' | 'team' | 'all'; status?: string } = {}) => api.get<AdsIssue[]>('/ai-design-studio/issues', { ...q }),
  issue: (id: string) => api.get<AdsIssueDetail>(`/ai-design-studio/issues/${id}`),
  createIssue: (body: AdsIssueCreateInput) => api.post<AdsIssue>('/ai-design-studio/issues', body),
  updateIssue: (id: string, body: { status?: string; note?: string | null }) => api.post<AdsIssue>(`/ai-design-studio/issues/${id}/update`, body),
  escalateIssue: (id: string, note?: string) => api.post<AdsIssue>(`/ai-design-studio/issues/${id}/escalate`, { note })
};
