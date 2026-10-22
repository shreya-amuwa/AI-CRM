import type { SupabaseClient } from '@supabase/supabase-js';
import type { PerformanceHistoryEntry, PerformancePeople, PerformanceRefreshResult, PerformanceReport } from '../../shared/contracts.js';
import { unwrap } from './base.js';

export interface ReportKey {
  scope: 'MEMBER' | 'TEAM' | 'DEPARTMENT';
  subjectId?: string;
  teamId?: string;
  departmentId?: string;
  kind: string;
  start: string;
  end: string;
}

/** Performance reports. Every call is a database function that checks who the caller is (Team Lead of that team, Department Head of that department, Super Admin). */
export class PerformanceRepository {
  constructor(private readonly db: SupabaseClient) {}

  people(i: { kind: string; start: string; end: string; departmentId?: string }) {
    return this.rpc<PerformancePeople>('performance_people', { p_kind: i.kind, p_start: i.start, p_end: i.end, p_department: i.departmentId ?? null });
  }
  get(k: ReportKey) {
    return this.rpc<PerformanceReport | null>('performance_report_get', this.args(k));
  }
  refresh(k: ReportKey) {
    return this.rpc<PerformanceRefreshResult>('performance_report_refresh', this.args(k));
  }
  history(reportId: string) {
    return this.rpc<PerformanceHistoryEntry[]>('performance_report_history', { p_report: reportId });
  }
  private args(k: ReportKey) {
    return { p_scope: k.scope, p_subject: k.subjectId ?? null, p_team: k.teamId ?? null, p_department: k.departmentId ?? null, p_kind: k.kind, p_start: k.start, p_end: k.end };
  }
  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return unwrap(await this.db.rpc(name, args)) as T;
  }
}
