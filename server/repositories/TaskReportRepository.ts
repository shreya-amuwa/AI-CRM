import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  PerformanceOverview, PerformanceRecordHistoryEntry, PerformanceRecordState, PerformanceSubjectHistory, PerformanceWork, TaskDailyReport, TaskDailyReportDetail, TaskDailyReportList,
  TaskReportTaskOption
} from '../../shared/contracts.js';
import { unwrap } from './base.js';

/**
 * Task daily reports and performance approval. Every call is a database function that reads the caller from the login and decides what they may
 * see and do (Team Member: own; Team Lead: their team; Department Head: their department); nothing here names a role, team or reviewer.
 */
export class TaskReportRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  myTasks() { return this.rpc<TaskReportTaskOption[]>('task_reports_my_tasks'); }
  submit(r: { taskId: string; reportDate?: string; workCompleted?: string; progress?: number; pendingWork?: string; delayReason?: string; remarks?: string }) {
    return this.rpc<TaskDailyReport>('task_report_submit', {
      p_task: r.taskId, p_date: r.reportDate ?? null, p_work: r.workCompleted ?? null, p_progress: r.progress ?? null,
      p_pending: r.pendingWork ?? null, p_delay: r.delayReason ?? null, p_remarks: r.remarks ?? null
    });
  }
  review(id: string, decision: 'APPROVE' | 'RETURN', remarks?: string) {
    return this.rpc<TaskDailyReport>('task_report_review', { p_report: id, p_decision: decision, p_remarks: remarks ?? null });
  }
  /** The Team Lead edits a member's waiting report before deciding it (20270213000100). */
  reviewerEdit(id: string, e: { workCompleted?: string; progress?: number; pendingWork?: string; delayReason?: string; remarks?: string; reason: string }) {
    return this.rpc<TaskDailyReport>('task_report_reviewer_edit', {
      p_report: id, p_work: e.workCompleted ?? null, p_progress: e.progress ?? null, p_pending: e.pendingWork ?? null, p_delay: e.delayReason ?? null, p_remarks: e.remarks ?? null, p_reason: e.reason
    });
  }
  list(q: { scope: 'MINE' | 'TEAM'; status?: string; from?: string; to?: string; memberId?: string; taskId?: string; limit: number; offset: number }) {
    return this.rpc<TaskDailyReportList>('task_reports_list', {
      p_scope: q.scope, p_status: q.status ?? null, p_from: q.from ?? null, p_to: q.to ?? null, p_member: q.memberId ?? null, p_task: q.taskId ?? null,
      p_limit: q.limit, p_offset: q.offset
    });
  }
  get(id: string) { return this.rpc<TaskDailyReportDetail>('task_report_get', { p_report: id }); }

  overview(q: { start: string; end: string; departmentId?: string }) {
    return this.rpc<PerformanceOverview>('performance_overview', { p_start: q.start, p_end: q.end, p_department: q.departmentId ?? null });
  }
  reviewRecord(id: string, decision: 'APPROVE' | 'RETURN', remarks?: string, version?: number, rating?: number) {
    // p_rating is sent only when given, so the call still works on a database without 20270210000100
    return this.rpc<PerformanceRecordState>('performance_record_review', {
      p_record: id, p_decision: decision, p_remarks: remarks ?? null, p_version: version ?? null, ...(rating === undefined ? {} : { p_rating: rating })
    });
  }
  resubmitRecord(id: string) { return this.rpc<PerformanceRecordState>('performance_record_resubmit', { p_record: id }); }
  recordHistory(id: string) { return this.rpc<PerformanceRecordHistoryEntry[]>('performance_record_history', { p_record: id }); }
  subjectHistory(id: string) { return this.rpc<PerformanceSubjectHistory>('performance_subject_history', { p_subject: id }); }
  updateEvaluation(id: string, rating: number, remarks?: string) {
    return this.rpc<PerformanceRecordState>('performance_record_update_evaluation', { p_record: id, p_rating: rating, p_remarks: remarks ?? null });
  }
  work(id: string, q: { start: string; end: string }) { return this.rpc<PerformanceWork>('performance_member_work', { p_subject: id, p_start: q.start, p_end: q.end }); }
}
