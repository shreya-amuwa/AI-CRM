import type { SupabaseClient } from '@supabase/supabase-js';
import type { HrAwardDetail, HrAwardOptions, HrAwardsOverview } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** HR Awards (20270202000100): every call is one database function that checks the caller is HR staff (or the Super Admin). */
export class HrAwardRepository {
  constructor(private readonly db: SupabaseClient) {}
  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }
  overview(month: string) { return this.rpc<HrAwardsOverview>('hr_awards_overview', { p_month: month }); }
  detail(code: string, month: string) { return this.rpc<HrAwardDetail>('hr_award_detail', { p_category: code, p_month: month }); }
  options() { return this.rpc<HrAwardOptions>('hr_award_options'); }
  nominate(code: string, i: { month: string; nomineeType: string; entityId: string; reason: string; remarks: string | null }) {
    return this.rpc<HrAwardDetail>('hr_award_nominate', {
      p_category: code, p_month: i.month, p_nominee_type: i.nomineeType, p_entity_id: i.entityId, p_reason: i.reason, p_remarks: i.remarks
    });
  }
  updateNominee(id: string, reason: string, remarks: string | null) {
    return this.rpc<HrAwardDetail>('hr_award_update_nominee', { p_nominee: id, p_reason: reason, p_remarks: remarks });
  }
  removeNominee(id: string, reason: string | null) { return this.rpc<HrAwardDetail>('hr_award_remove_nominee', { p_nominee: id, p_reason: reason }); }
  declareWinners(nomineeIds: string[], remarks: string | null) {
    return this.rpc<HrAwardDetail>('hr_award_declare_winners', { p_nominees: nomineeIds, p_remarks: remarks });
  }
  updateWinner(id: string, remarks: string | null) { return this.rpc<HrAwardDetail>('hr_award_update_winner', { p_winner: id, p_remarks: remarks }); }
  revokeWinner(id: string, reason: string) { return this.rpc<HrAwardDetail>('hr_award_revoke_winner', { p_winner: id, p_reason: reason }); }
}
