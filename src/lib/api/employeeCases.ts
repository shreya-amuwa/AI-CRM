import type {
  CaseDepartment, CaseMyDetails, ClientDocumentUrl, EmployeeIssue, EmployeeIssueDetail, EmployeeIssueList, EmployeeIssueOverview, EmployeeMeeting,
  EmployeeMeetingDetail, EmployeeMeetingList, EmployeeMeetingOverview, HrAssignee, IssueUploadTicket, MeetingAction
} from '../../../shared/contracts';
import { api } from './client';

/** What the employee fills in to raise an issue: nothing about the employee (the server reads that from the profile). */
export interface IssueForm {
  clientRequestId: string;
  title: string;
  category: string;
  description: string;
  priority: string;
  preferredResolution?: string;
  attachmentIds: string[];
}
export interface MeetingForm {
  clientRequestId: string;
  subject: string;
  category: string;
  description: string;
  preferredDate: string;
  preferredTime: string;
  mode: string;
  notes?: string;
}
export interface MeetingDecision {
  action: MeetingAction;
  date?: string | null;
  time?: string | null;
  mode?: string | null;
  location?: string | null;
  link?: string | null;
  instructions?: string | null;
  message?: string | null;
  reason?: string | null;
  outcome?: string | null;
  followUp?: string | null;
}
type Paging = { limit?: number; offset?: number };
export type HrIssueFilters = Paging & { status?: string; departmentId?: string; priority?: string; category?: string; assigneeId?: string; unassigned?: boolean; from?: string; to?: string; search?: string };
export type HrMeetingFilters = Paging & { status?: string; departmentId?: string; category?: string; assigneeId?: string; unassigned?: boolean; from?: string; to?: string; search?: string };

/** Drops the empty filters so the query string only carries what was chosen. */
const clean = <T extends Record<string, unknown>>(q: T) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== false && v !== 'ALL')) as Record<string, string | number | boolean>;

/** The employee's own page (Raise an Issue / Meeting Request) and HR's two sections (Employee Issues / Meeting Requests). */
export const employeeCasesApi = {
  details: () => api.get<CaseMyDetails>('/employee/case-details'),
  // the employee: issues
  submitIssue: (b: IssueForm) => api.post<EmployeeIssue>('/employee/issues', b),
  myIssues: (q: Paging & { status?: string } = {}) => api.get<EmployeeIssueList>('/employee/issues', clean(q)),
  myIssue: (id: string) => api.get<EmployeeIssueDetail>(`/employee/issues/${id}`),
  replyToIssue: (id: string, message: string, attachmentIds: string[] = []) => api.post<EmployeeIssueDetail>(`/employee/issues/${id}/reply`, { message, attachmentIds }),
  // the employee: meetings
  submitMeeting: (b: MeetingForm) => api.post<EmployeeMeeting>('/employee/meetings', b),
  myMeetings: (q: Paging & { status?: string } = {}) => api.get<EmployeeMeetingList>('/employee/meetings', clean(q)),
  myMeeting: (id: string) => api.get<EmployeeMeetingDetail>(`/employee/meetings/${id}`),
  cancelMyMeeting: (id: string, reason?: string) => api.post<EmployeeMeetingDetail>(`/employee/meetings/${id}/cancel`, { reason: reason || undefined }),
  answerAlternative: (id: string, accept: boolean, message?: string) => api.post<EmployeeMeetingDetail>(`/employee/meetings/${id}/alternative`, { accept, message: message || undefined }),
  // files on an issue
  beginUpload: (b: { fileName: string; mimeType: string; sizeBytes: number }) => api.post<IssueUploadTicket>('/employee/issues/uploads', b),
  completeUpload: (id: string) => api.post<{ id: string; name: string; mime: string; size: number }>(`/employee/issues/uploads/${id}/complete`, {}),
  abortUpload: (id: string) => api.post(`/employee/issues/uploads/${id}/abort`, {}),
  fileUrl: (id: string, action: 'view' | 'download' = 'view') => api.get<ClientDocumentUrl>(`/employee/issue-attachments/${id}/url`, { action }),
  // HR: issues
  assignees: () => api.get<HrAssignee[]>('/hr/case-assignees'),
  departments: () => api.get<CaseDepartment[]>('/hr/case-departments'),
  issueOverview: () => api.get<EmployeeIssueOverview>('/hr/issues/overview'),
  hrIssues: (q: HrIssueFilters) => api.get<EmployeeIssueList>('/hr/issues', clean(q)),
  hrIssue: (id: string) => api.get<EmployeeIssueDetail>(`/hr/issues/${id}`),
  assignIssue: (id: string, hrId: string | null) => api.post<EmployeeIssueDetail>(`/hr/issues/${id}/assign`, { hrId }),
  setIssueStatus: (id: string, status: string, message?: string) => api.post<EmployeeIssueDetail>(`/hr/issues/${id}/status`, { status, message: message || undefined }),
  respondToIssue: (id: string, message: string, requestInfo: boolean) => api.post<EmployeeIssueDetail>(`/hr/issues/${id}/respond`, { message, requestInfo }),
  noteOnIssue: (id: string, note: string) => api.post<EmployeeIssueDetail>(`/hr/issues/${id}/note`, { note }),
  // HR: meetings
  meetingOverview: () => api.get<EmployeeMeetingOverview>('/hr/meetings/overview'),
  hrMeetings: (q: HrMeetingFilters) => api.get<EmployeeMeetingList>('/hr/meetings', clean(q)),
  hrMeeting: (id: string) => api.get<EmployeeMeetingDetail>(`/hr/meetings/${id}`),
  assignMeeting: (id: string, hrId: string | null) => api.post<EmployeeMeetingDetail>(`/hr/meetings/${id}/assign`, { hrId }),
  noteOnMeeting: (id: string, note: string) => api.post<EmployeeMeetingDetail>(`/hr/meetings/${id}/note`, { note }),
  decideMeeting: (id: string, d: MeetingDecision) => api.post<EmployeeMeetingDetail>(`/hr/meetings/${id}/decide`, Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined && v !== '' && v !== null)))
};
