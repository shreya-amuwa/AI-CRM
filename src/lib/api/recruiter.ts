import type {
  RecruiterApplicationDetail, RecruiterApplicationPage, RecruiterCall, RecruiterCallLists, RecruiterContext, RecruiterDecisionListItem, RecruiterDecisionResult,
  RecruiterFilterOptions, RecruiterInterview, RecruiterInterviewListItem, RecruiterOverview, RecruiterPerson, RecruiterPipeline, RecruiterReports,
  RecruiterVacancy, RecruiterVacancyDetail, VacancyStatus
} from '../../../shared/contracts';
import type { RecruiterFilters } from '../../../shared/validation';
import { api } from './client';

export type RecruiterQuery = Partial<Omit<RecruiterFilters, 'page' | 'pageSize'>> & { page?: number; pageSize?: number };
const clean = (q: RecruiterQuery): Record<string, string | number> =>
  Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as Record<string, string | number>;

/**
 * The HR Recruiter workspace. There is deliberately nothing here about e-mail: candidate selection / rejection messages are sent by the server on its
 * own after a decision is recorded, and no screen can start, stop, edit or retry them.
 */
export const recruiterApi = {
  context: () => api.get<RecruiterContext>('/recruiter/context'),
  directory: () => api.get<RecruiterPerson[]>('/recruiter/directory'),
  filterOptions: () => api.get<RecruiterFilterOptions>('/recruiter/filter-options'),
  overview: (q: RecruiterQuery = {}) => api.get<RecruiterOverview>('/recruiter/overview', clean(q)),
  vacancies: (status?: VacancyStatus) => api.get<RecruiterVacancy[]>('/recruiter/vacancies', clean({ status } as RecruiterQuery)),
  vacancy: (id: string) => api.get<RecruiterVacancyDetail>(`/recruiter/vacancies/${id}`),
  assignVacancy: (id: string, recruiter: string | null) => api.post<RecruiterVacancy>(`/recruiter/vacancies/${id}/recruiter`, { recruiter }),
  vacancyStatus: (id: string, status: VacancyStatus, note?: string) => api.post<RecruiterVacancy>(`/recruiter/vacancies/${id}/status`, { status, note: note || undefined }),
  applications: (q: RecruiterQuery = {}) => api.get<RecruiterApplicationPage>('/recruiter/applications', clean(q)),
  application: (id: string) => api.get<RecruiterApplicationDetail>(`/recruiter/applications/${id}`),
  addNote: (id: string, kind: 'NOTE' | 'EVALUATION', body: string) => api.post<RecruiterApplicationDetail['notes'][number]>(`/recruiter/applications/${id}/notes`, { kind, body }),
  stage: (id: string, action: 'SCREEN' | 'HOLD' | 'RESUME' | 'REQUEST_REVIEW' | 'CLEAR_REVIEW', comment?: string) =>
    api.post<{ applicationId: string; stage: string }>(`/recruiter/applications/${id}/stage`, { action, comment: comment || undefined }),
  saveCall: (id: string, body: Record<string, unknown>) => api.post<RecruiterCall>(`/recruiter/applications/${id}/calls`, body),
  saveInterview: (id: string, body: Record<string, unknown>) => api.post<RecruiterInterview>(`/recruiter/applications/${id}/interviews`, body),
  invite: (id: string, testId: string, until: string) => api.post<{ id: string; alreadyInvited: boolean }>(`/recruiter/applications/${id}/assessments`, { testId, until }),
  decide: (id: string, body: { decision: 'SELECTED' | 'REJECTED'; category?: string; reason?: string }) => api.post<RecruiterDecisionResult>(`/recruiter/applications/${id}/decision`, body),
  correct: (id: string, body: { decision: 'SELECTED' | 'REJECTED'; reason: string }) => api.post<RecruiterDecisionResult>(`/recruiter/applications/${id}/decision/correction`, body),
  tests: () => api.get<{ id: string; title: string; durationMinutes: number; passPercent: number; questions: number }[]>('/recruiter/tests'),
  pipeline: (posting?: string) => api.get<RecruiterPipeline>('/recruiter/pipeline', posting ? { posting } : {}),
  calls: () => api.get<RecruiterCallLists>('/recruiter/calls'),
  interviews: () => api.get<{ items: RecruiterInterviewListItem[] }>('/recruiter/interviews'),
  decisions: (view: 'READY' | 'DECIDED') => api.get<RecruiterDecisionListItem[]>('/recruiter/decisions', { view }),
  reports: (q: RecruiterQuery = {}) => api.get<RecruiterReports>('/recruiter/reports', clean(q)),
  resumeUrl: (fileId: string) => api.get<{ url: string }>(`/recruiter/resumes/${fileId}/url`)
};
