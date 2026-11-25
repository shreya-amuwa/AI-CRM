import type {
  PerformanceOverview, PerformanceRecordHistoryEntry, PerformanceRecordState, PerformanceSubjectHistory, PerformanceWork, TaskDailyReport, TaskDailyReportDetail, TaskDailyReportList,
  TaskReportTaskOption
} from '../../shared/contracts.js';
import {
  performanceEvaluationUpdateSchema, performanceOverviewQuerySchema, performanceRecordReviewSchema, performanceWorkQuerySchema, taskReportListQuerySchema, taskReportReviewSchema,
  taskReportReviewerEditSchema, taskReportSubmitSchema, uuidSchema
} from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { TaskReportRepository } from '../repositories/TaskReportRepository.js';

/**
 * Task daily reports (Team Member -> Team Lead) and performance approval (Team Member -> Team Lead -> Department Head). The same Zod schemas as the
 * forms; the database checks everything again (who the caller is, whose report it is, which department).
 */
export class TaskReportService {
  constructor(private readonly repo: TaskReportRepository) {}

  myTasks(): Promise<TaskReportTaskOption[]> { return this.repo.myTasks(); }
  submit(body: unknown): Promise<TaskDailyReport> { return this.repo.submit(parse(taskReportSubmitSchema, body)); }
  review(id: string, body: unknown): Promise<TaskDailyReport> {
    const b = parse(taskReportReviewSchema, body);
    return this.repo.review(parse(uuidSchema, id), b.decision, b.remarks);
  }
  /** The Team Lead edits a member's waiting report (the database checks that the caller is that member's reviewer). */
  reviewerEdit(id: string, body: unknown): Promise<TaskDailyReport> { return this.repo.reviewerEdit(parse(uuidSchema, id), parse(taskReportReviewerEditSchema, body)); }
  list(query: unknown): Promise<TaskDailyReportList> {
    const q = parse(taskReportListQuerySchema, query);
    return this.repo.list({ scope: q.scope, status: q.status, from: q.from, to: q.to, memberId: q.memberId, taskId: q.taskId, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
  }
  get(id: string): Promise<TaskDailyReportDetail> { return this.repo.get(parse(uuidSchema, id)); }

  overview(query: unknown): Promise<PerformanceOverview> { return this.repo.overview(parse(performanceOverviewQuerySchema, query)); }
  reviewRecord(id: string, body: unknown): Promise<PerformanceRecordState> {
    const b = parse(performanceRecordReviewSchema, body);
    return this.repo.reviewRecord(parse(uuidSchema, id), b.decision, b.remarks, b.version, b.rating);
  }
  resubmitRecord(id: string): Promise<PerformanceRecordState> { return this.repo.resubmitRecord(parse(uuidSchema, id)); }
  recordHistory(id: string): Promise<PerformanceRecordHistoryEntry[]> { return this.repo.recordHistory(parse(uuidSchema, id)); }
  /** Every evaluation of one person (all periods); the database decides who may read it (their Team Lead, their Department Head, the Super Admin). */
  subjectHistory(id: string): Promise<PerformanceSubjectHistory> { return this.repo.subjectHistory(parse(uuidSchema, id)); }
  /** Update the rating and remarks of an approved evaluation (Team Lead: their members; Department Head: Team Leads). */
  updateEvaluation(id: string, body: unknown): Promise<PerformanceRecordState> {
    const b = parse(performanceEvaluationUpdateSchema, body);
    return this.repo.updateEvaluation(parse(uuidSchema, id), b.rating, b.remarks);
  }
  /** One person's tasks and reports in a period, for their reviewer (never for the person themselves). */
  work(id: string, query: unknown): Promise<PerformanceWork> { return this.repo.work(parse(uuidSchema, id), parse(performanceWorkQuerySchema, query)); }
}
