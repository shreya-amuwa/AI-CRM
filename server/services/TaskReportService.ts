import type {
  PerformanceOverview, PerformanceRecordHistoryEntry, PerformanceRecordState, TaskDailyReport, TaskDailyReportDetail, TaskDailyReportList, TaskReportTaskOption
} from '../../shared/contracts.js';
import {
  performanceOverviewQuerySchema, performanceRecordReviewSchema, taskReportListQuerySchema, taskReportReviewSchema, taskReportSubmitSchema, uuidSchema
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
  list(query: unknown): Promise<TaskDailyReportList> {
    const q = parse(taskReportListQuerySchema, query);
    return this.repo.list({ scope: q.scope, status: q.status, from: q.from, to: q.to, memberId: q.memberId, taskId: q.taskId, limit: q.pageSize, offset: (q.page - 1) * q.pageSize });
  }
  get(id: string): Promise<TaskDailyReportDetail> { return this.repo.get(parse(uuidSchema, id)); }

  overview(query: unknown): Promise<PerformanceOverview> { return this.repo.overview(parse(performanceOverviewQuerySchema, query)); }
  reviewRecord(id: string, body: unknown): Promise<PerformanceRecordState> {
    const b = parse(performanceRecordReviewSchema, body);
    return this.repo.reviewRecord(parse(uuidSchema, id), b.decision, b.remarks, b.version);
  }
  resubmitRecord(id: string): Promise<PerformanceRecordState> { return this.repo.resubmitRecord(parse(uuidSchema, id)); }
  recordHistory(id: string): Promise<PerformanceRecordHistoryEntry[]> { return this.repo.recordHistory(parse(uuidSchema, id)); }
}
