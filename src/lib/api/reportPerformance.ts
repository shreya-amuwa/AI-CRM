import type {
  EmployeeProfile, HrConsolidated, HrConsolidatedSaved, HrReview, HrReviewDepartment, HrReviewLog, HrReviewSaved, HrReviewsOverview, Leaderboard,
  LeaderboardOptions, ReportAnalysisView, ReportSettings, SaConsolidated, SaConsolidatedListItem, WorkReportDetail
} from '../../../shared/contracts';
import { api } from './client';

/** HR individual performance reviews and the consolidated report to the Super Admin. */
export const hrReviewsApi = {
  overview: (weekStart?: string) => api.get<HrReviewsOverview>('/hr-reviews/overview', { weekStart }),
  department: (packageId: string) => api.get<HrReviewDepartment>(`/hr-reviews/packages/${packageId}`),
  personReports: (packageId: string, personId: string) => api.get<WorkReportDetail[]>(`/hr-reviews/packages/${packageId}/people/${personId}/reports`),
  save: (r: { packageId: string; subjectId: string; rating: number | null; consistencyNote?: string; workAssessment?: string; comments?: string; recommendations?: string; submit: boolean }) =>
    api.post<HrReviewSaved>('/hr-reviews', r),
  history: (subjectId: string) => api.get<HrReview[]>(`/hr-reviews/history/${subjectId}`),
  log: (q: { department?: string; search?: string; page?: number } = {}) => api.get<HrReviewLog>('/hr-reviews/log', { ...q }),
  consolidated: (weekStart: string) => api.get<HrConsolidated>('/hr-reviews/consolidated', { weekStart }),
  saveConsolidated: (c: { weekStart: string; note?: string; submit: boolean }) => api.post<HrConsolidatedSaved>('/hr-reviews/consolidated', c)
};

export type LeaderboardQuery = Record<string, string | number | undefined>;

/** The Super Admin's performance views. */
export const reportPerformanceApi = {
  consolidatedList: () => api.get<SaConsolidatedListItem[]>('/report-performance/consolidated'),
  consolidated: (id: string) => api.get<SaConsolidated>(`/report-performance/consolidated/${id}`),
  leaderboard: (q: LeaderboardQuery) => api.get<Leaderboard>('/report-performance/leaderboard', { ...q }),
  options: () => api.get<LeaderboardOptions>('/report-performance/options'),
  employee: (id: string, q: { periodType?: string; from?: string; to?: string } = {}) => api.get<EmployeeProfile>(`/report-performance/employees/${id}`, { ...q }),
  settings: () => api.get<ReportSettings>('/report-performance/settings'),
  updateSettings: (s: { weights: Record<string, number>; minTasks: number; minExpectedReports: number; workingDays: number[] }) => api.patch<ReportSettings>('/report-performance/settings', s),
  analysis: (from: string, to: string) => api.get<ReportAnalysisView>('/report-performance/analysis', { from, to }),
  generateAnalysis: (from: string, to: string) => api.post<ReportAnalysisView>('/report-performance/analysis', { from, to })
};
