import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  RecruiterApplicationDetail, RecruiterApplicationPage, RecruiterCall, RecruiterCallLists, RecruiterContext, RecruiterDecisionListItem, RecruiterDecisionResult,
  RecruiterFilterOptions, RecruiterInterview, RecruiterInterviewListItem, RecruiterOverview, RecruiterPerson, RecruiterPipeline, RecruiterReports,
  RecruiterVacancy, RecruiterVacancyDetail, RecruitmentEmailRecord
} from '../../shared/contracts.js';
import type { RecruiterFilters } from '../../shared/validation.js';
import { unwrap } from '../repositories/base.js';

/**
 * The HR Recruiter workspace. Every call is one database function that works out from the caller's own login what they may see and do (their
 * vacancies, their applications; HR leadership: all). Nothing here names a role or trusts an id for authorization.
 */
export class RecruiterRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  context() { return this.rpc<RecruiterContext>('recruiter_context'); }
  directory() { return this.rpc<RecruiterPerson[]>('recruiter_directory'); }
  filterOptions() { return this.rpc<RecruiterFilterOptions>('recruiter_filter_options'); }
  overview(filters: Omit<RecruiterFilters, 'page' | 'pageSize'>) { return this.rpc<RecruiterOverview>('recruiter_overview', { p_filters: filters }); }
  vacancies(status?: string) { return this.rpc<RecruiterVacancy[]>('recruiter_vacancies', { p_status: status ?? null }); }
  vacancy(id: string) { return this.rpc<RecruiterVacancyDetail>('recruiter_vacancy', { p_id: id }); }
  assignVacancy(id: string, recruiter: string | null) { return this.rpc<RecruiterVacancy>('recruiter_vacancy_assign', { p_id: id, p_recruiter: recruiter }); }
  vacancyStatus(id: string, status: string, note?: string) { return this.rpc<RecruiterVacancy>('recruiter_vacancy_status', { p_id: id, p_status: status, p_note: note ?? null }); }
  applications(f: RecruiterFilters) {
    const { page, pageSize, ...filters } = f;
    return this.rpc<RecruiterApplicationPage>('recruiter_applications', { p_filters: filters, p_page: page, p_size: pageSize });
  }
  pipeline(posting?: string) { return this.rpc<RecruiterPipeline>('recruiter_pipeline', { p_posting: posting ?? null }); }
  application(id: string) { return this.rpc<RecruiterApplicationDetail>('recruiter_application', { p_id: id }); }
  addNote(id: string, kind: string, body: string) { return this.rpc<RecruiterApplicationDetail['notes'][number]>('recruiter_note_add', { p_application: id, p_kind: kind, p_body: body }); }
  stage(id: string, action: string, comment?: string) { return this.rpc<{ applicationId: string; stage: string }>('recruiter_stage', { p_application: id, p_action: action, p_comment: comment ?? null }); }
  tests() { return this.rpc<{ id: string; title: string; durationMinutes: number; passPercent: number; questions: number }[]>('recruiter_tests'); }
  invite(id: string, test: string, until: string) { return this.rpc<{ id: string; alreadyInvited: boolean }>('recruiter_assessment_invite', { p_application: id, p_test: test, p_until: until }); }
  calls() { return this.rpc<RecruiterCallLists>('recruiter_calls'); }
  saveCall(id: string, data: unknown) { return this.rpc<RecruiterCall>('recruiter_call_save', { p_application: id, p_data: data }); }
  interviews() { return this.rpc<{ items: RecruiterInterviewListItem[] }>('recruiter_interviews'); }
  saveInterview(id: string, data: unknown) { return this.rpc<RecruiterInterview>('recruiter_interview_save', { p_application: id, p_data: data }); }
  decide(id: string, decision: string, category?: string, reason?: string) {
    return this.rpc<RecruiterDecisionResult>('recruiter_decide', { p_application: id, p_decision: decision, p_category: category ?? null, p_reason: reason ?? null });
  }
  correctDecision(id: string, decision: string, reason: string) { return this.rpc<RecruiterDecisionResult>('recruiter_decision_correct', { p_application: id, p_decision: decision, p_reason: reason }); }
  decisions(view: string) { return this.rpc<RecruiterDecisionListItem[]>('recruiter_decisions_list', { p_view: view }); }
  reports(filters: Omit<RecruiterFilters, 'page' | 'pageSize'>) { return this.rpc<RecruiterReports>('recruiter_reports', { p_filters: filters }); }
  // technical, Super Admin only (no screen)
  emailRecords(status?: string, limit = 50) { return this.rpc<RecruitmentEmailRecord[]>('recruitment_email_admin_list', { p_status: status ?? null, p_limit: limit }); }
  emailRequeue(id: string) { return this.rpc<{ id: string; status: string }>('recruitment_email_admin_requeue', { p_id: id }); }
}
