import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AnalysisFacts, EmployeeProfile, Leaderboard, LeaderboardOptions, ReportAnalysis, ReportSettings, SaConsolidated, SaConsolidatedListItem
} from '../../shared/contracts.js';
import { unwrap } from './base.js';

/**
 * The Super Admin's performance views: the consolidated reports HR submitted, the Leaderboard, one employee, the scoring settings and the
 * facts / written analysis. The database allows only the Super Admin (HR may read the settings); the caller's own client is used.
 */
export class ReportAnalyticsRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  consolidatedList() { return this.rpc<SaConsolidatedListItem[]>('sa_consolidated_list'); }
  consolidated(id: string) { return this.rpc<SaConsolidated>('sa_consolidated_get', { p_id: id }); }
  leaderboard(filters: Record<string, unknown>) { return this.rpc<Leaderboard>('report_leaderboard', { p_filters: filters }); }
  options() { return this.rpc<LeaderboardOptions>('report_leaderboard_options'); }
  employee(id: string, q: { periodType: string; from?: string; to?: string }) {
    return this.rpc<EmployeeProfile>('report_employee_profile', { p_person: id, p_period_type: q.periodType, p_from: q.from ?? null, p_to: q.to ?? null });
  }
  settings() { return this.rpc<ReportSettings>('report_settings_get'); }
  updateSettings(s: { weights: Record<string, number>; minTasks: number; minExpectedReports: number; workingDays: number[] }) {
    return this.rpc<ReportSettings>('report_settings_update', { p_weights: s.weights, p_min_tasks: s.minTasks, p_min_expected: s.minExpectedReports, p_working_days: s.workingDays });
  }
  facts(from: string, to: string) { return this.rpc<AnalysisFacts>('report_analysis_facts', { p_from: from, p_to: to }); }
  latestAnalysis(from: string, to: string) { return this.rpc<ReportAnalysis | null>('report_analysis_latest', { p_from: from, p_to: to }); }
}
