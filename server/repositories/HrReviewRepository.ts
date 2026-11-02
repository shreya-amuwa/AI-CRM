import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  HrConsolidated, HrConsolidatedSaved, HrReview, HrReviewDepartment, HrReviewLog, HrReviewSaved, HrReviewsOverview, WorkReportDetail
} from '../../shared/contracts.js';
import { unwrap } from './base.js';

/**
 * HR individual performance reviews and the consolidated report. Every call is a database function that works out from the caller's own login
 * whether they are HR staff (or the Super Admin, for reading); nothing here names a role. The caller's own database client is used.
 */
export class HrReviewRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  overview(weekStart?: string) { return this.rpc<HrReviewsOverview>('hr_reviews_overview', { p_week_start: weekStart ?? null }); }
  department(packageId: string) { return this.rpc<HrReviewDepartment>('hr_reviews_department', { p_package: packageId }); }
  personReports(packageId: string, personId: string) { return this.rpc<WorkReportDetail[]>('hr_person_reports', { p_package: packageId, p_person: personId }); }
  save(r: { packageId: string; subjectId: string; rating: number | null; consistencyNote?: string | null; workAssessment?: string | null; comments?: string | null; recommendations?: string | null; submit: boolean }) {
    return this.rpc<HrReviewSaved>('hr_review_save', {
      p_package: r.packageId, p_subject: r.subjectId, p_rating: r.rating, p_consistency: r.consistencyNote ?? null, p_assessment: r.workAssessment ?? null,
      p_comments: r.comments ?? null, p_recommendations: r.recommendations ?? null, p_submit: r.submit
    });
  }
  history(subjectId: string) { return this.rpc<HrReview[]>('hr_review_history', { p_subject: subjectId }); }
  log(q: { department?: string; search?: string; limit: number; offset: number }) {
    return this.rpc<HrReviewLog>('hr_review_log', { p_department: q.department ?? null, p_search: q.search ?? null, p_limit: q.limit, p_offset: q.offset });
  }
  consolidated(weekStart: string) { return this.rpc<HrConsolidated>('hr_consolidated_get', { p_week_start: weekStart }); }
  consolidatedSave(c: { weekStart: string; note?: string | null; submit: boolean }) {
    return this.rpc<HrConsolidatedSaved>('hr_consolidated_save', { p_week_start: c.weekStart, p_note: c.note ?? null, p_submit: c.submit });
  }
}
