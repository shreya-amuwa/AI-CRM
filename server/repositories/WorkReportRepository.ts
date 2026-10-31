import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  DepartmentReportBox, ReportsDepartmentDetail, OperationsReportBoard, ReportContext, ReportInbox, ReportPackage, TeamReportBox, WorkReportDetail, WorkReportSummary
} from '../../shared/contracts.js';
import { unwrap } from './base.js';

/**
 * Work reports. Every call is a database function that works out from the caller's own login who they are in the reporting chain
 * (member, Team Lead, Department Head, Operations Head) and what that allows; nothing here names a role, a team or a department to trust.
 * The caller's own database client is used (row level security applies), never the service key.
 */
export class WorkReportRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  context() { return this.rpc<ReportContext>('work_reports_context'); }
  mine(status?: string) { return this.rpc<WorkReportSummary[]>('work_reports_mine', { p_status: status ?? null }); }
  get(id: string) { return this.rpc<WorkReportDetail>('work_report_get', { p_id: id }); }

  save(id: string | null, r: { title: string; reportDate: string; periodType: string; periodStart: string; periodEnd: string; content: Record<string, unknown> }) {
    return this.rpc<WorkReportDetail>('work_report_save', {
      p_id: id, p_title: r.title, p_report_date: r.reportDate, p_period_type: r.periodType, p_period_start: r.periodStart, p_period_end: r.periodEnd, p_content: r.content
    });
  }
  submit(id: string) { return this.rpc<WorkReportDetail>('work_report_submit', { p_id: id }); }
  async deleteDraft(id: string): Promise<void> { await this.rpc<null>('work_report_delete_draft', { p_id: id }); }

  inbox(q: { status?: string; from?: string; to?: string; author?: string }) {
    return this.rpc<ReportInbox>('work_reports_inbox', { p_status: q.status ?? null, p_from: q.from ?? null, p_to: q.to ?? null, p_author: q.author ?? null });
  }
  review(id: string, decision: string, comment?: string | null) {
    return this.rpc<WorkReportDetail>('work_report_review', { p_id: id, p_decision: decision, p_comment: comment ?? null });
  }

  teamBox(from: string, to: string) { return this.rpc<TeamReportBox>('work_reports_team_box', { p_from: from, p_to: to }); }
  department(from: string, to: string) { return this.rpc<DepartmentReportBox>('work_reports_department', { p_from: from, p_to: to }); }
  submitPackage(p: { from: string; to: string; periodType: string; note?: string | null }) {
    return this.rpc<ReportPackage>('work_report_package_submit', { p_from: p.from, p_to: p.to, p_period_type: p.periodType, p_note: p.note ?? null });
  }
  operations(from: string, to: string) { return this.rpc<OperationsReportBoard>('work_reports_operations', { p_from: from, p_to: to }); }
  operationsDepartment(departmentId: string, from: string, to: string) {
    return this.rpc<ReportsDepartmentDetail>('work_reports_operations_department', { p_department: departmentId, p_from: from, p_to: to });
  }
}
