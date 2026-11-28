import type { SupabaseClient } from '@supabase/supabase-js';
import type { OfficeHoliday, ReviewDetail, ReviewList, ReviewQueue } from '../../shared/hrUpgrade.js';
import { unwrap } from './base.js';

/**
 * HR dashboard upgrade (docs/hr-dashboard-upgrade.md). Every call is one database function, run with the caller's JWT: the database decides
 * who may see or change what (HR, the assigned reviewers, the department's heads and CEOs, Department HR).
 */
export class HrUpgradeRepository {
  constructor(private readonly db: SupabaseClient) {}
  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }
  // Phase 1 / 4: confirmation and internship reviews
  reviews(filters: Record<string, unknown>) { return this.rpc<ReviewList>('hr_reviews_list', { p_filters: filters }); }
  myReviews() { return this.rpc<ReviewQueue>('hr_review_my_queue'); }
  review(id: string) { return this.rpc<ReviewDetail>('hr_review_detail', { p_cycle: id }); }
  saveEvaluation(id: string, role: string, p: Record<string, unknown>) { return this.rpc<ReviewDetail>('hr_review_save', { p_cycle: id, p_role: role, p }); }
  returnEvaluation(id: string, role: string, reason: string) { return this.rpc<ReviewDetail>('hr_review_return', { p_cycle: id, p_role: role, p_reason: reason }); }
  reassign(id: string, role: string, profileId: string, reason: string) {
    return this.rpc<ReviewDetail>('hr_review_reassign', { p_cycle: id, p_role: role, p_profile: profileId, p_reason: reason });
  }
  start(id: string) { return this.rpc<ReviewDetail>('hr_review_start', { p_cycle: id }); }
  decide(id: string, p: Record<string, unknown>) { return this.rpc<ReviewDetail>('hr_review_decide', { p_cycle: id, p }); }
  holidays(year: number | null) { return this.rpc<OfficeHoliday[]>('office_holidays_list', { p_year: year }); }
  setHoliday(day: string, name: string | null, remove: boolean) { return this.rpc<OfficeHoliday[]>('office_holiday_set', { p_day: day, p_name: name, p_remove: remove }); }
}
