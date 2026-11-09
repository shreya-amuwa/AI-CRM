import type {
  DailyDepartmentSummary, WeeklyBoard, WeeklyDepartmentReport, WeeklyPendingItem, WeeklyRoutingItem, OperationsPeopleDaily,
  DepartmentReportBox, MemberApprovalList, ReportTaskOption, ReportsDepartmentDetail, OperationsReportBoard, ReportContext, ReportInbox, ReportPackage, TeamReportBox, WorkReportDetail, WorkReportSummary
} from '../../shared/contracts.js';
import { operationsPeopleQuerySchema, reportDailySummaryQuerySchema, reportWeekQuerySchema, reportWeeklyReviewSchema, reportWeeklySaveSchema, reportListQuerySchema, reportMemberApprovalsQuerySchema, reportPackageSchema, reportRangeQuerySchema, reportReviewSchema, reportSaveSchema, uuidSchema } from '../../shared/validation.js';
import { REPORT_STATUSES } from '../../shared/reportFields.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import type { WorkReportRepository } from '../repositories/WorkReportRepository.js';

/**
 * Work reports: Team Member -> Team Lead -> Department Head -> Operations Head. Who may write, read or decide on a report is decided by the
 * database from the caller's own login; this layer only validates the input (the same schemas the forms use).
 */
export class WorkReportService {
  constructor(private readonly repo: WorkReportRepository) {}

  context(): Promise<ReportContext> { return this.repo.context(); }
  mine(query: unknown): Promise<WorkReportSummary[]> {
    const status = (query as { status?: string } | undefined)?.status;
    if (status !== undefined && !(REPORT_STATUSES as readonly string[]).includes(status)) throw new AppError('VALIDATION_ERROR', 'Choose a valid status.');
    return this.repo.mine(status);
  }
  get(id: string): Promise<WorkReportDetail> { return this.repo.get(parse(uuidSchema, id)); }
  create(body: unknown): Promise<WorkReportDetail> { return this.repo.save(null, parse(reportSaveSchema, body)); }
  update(id: string, body: unknown): Promise<WorkReportDetail> { return this.repo.save(parse(uuidSchema, id), parse(reportSaveSchema, body)); }
  submit(id: string): Promise<WorkReportDetail> { return this.repo.submit(parse(uuidSchema, id)); }
  deleteDraft(id: string): Promise<void> { return this.repo.deleteDraft(parse(uuidSchema, id)); }

  inbox(query: unknown): Promise<ReportInbox> { return this.repo.inbox(parse(reportListQuerySchema, query ?? {})); }
  memberApprovals(query: unknown): Promise<MemberApprovalList> { return this.repo.memberApprovals(parse(reportMemberApprovalsQuerySchema, query ?? {})); }
  myTasks(): Promise<ReportTaskOption[]> { return this.repo.myTasks(); }
  review(id: string, body: unknown): Promise<WorkReportDetail> {
    const r = parse(reportReviewSchema, body);
    return this.repo.review(parse(uuidSchema, id), r.decision, r.comment);
  }

  teamBox(query: unknown): Promise<TeamReportBox> { const q = parse(reportRangeQuerySchema, query); return this.repo.teamBox(q.from, q.to); }
  department(query: unknown): Promise<DepartmentReportBox> { const q = parse(reportRangeQuerySchema, query); return this.repo.department(q.from, q.to); }
  submitPackage(body: unknown): Promise<ReportPackage> { return this.repo.submitPackage(parse(reportPackageSchema, body)); }
  operations(query: unknown): Promise<OperationsReportBoard> { const q = parse(reportRangeQuerySchema, query); return this.repo.operations(q.from, q.to); }
  operationsPeople(query: unknown): Promise<OperationsPeopleDaily> {
    const q = parse(operationsPeopleQuerySchema, query);
    return this.repo.operationsPeople(q.department, q.from, q.to);
  }
  operationsDepartment(id: string, query: unknown): Promise<ReportsDepartmentDetail> {
    const q = parse(reportRangeQuerySchema, query);
    return this.repo.operationsDepartment(parse(uuidSchema, id), q.from, q.to);
  }

  dailySummary(query: unknown): Promise<DailyDepartmentSummary> { return this.repo.dailySummary(parse(reportDailySummaryQuerySchema, query ?? {})); }
  weekly(query: unknown): Promise<WeeklyDepartmentReport> { const q = parse(reportWeekQuerySchema, query); return this.repo.weekly(q.weekStart, q.function); }
  weeklySave(body: unknown): Promise<ReportPackage> { return this.repo.weeklySave(parse(reportWeeklySaveSchema, body)); }
  weeklyBoard(query: unknown): Promise<WeeklyBoard> { return this.repo.weeklyBoard(parse(reportWeekQuerySchema, query).weekStart); }
  weeklyPending(): Promise<WeeklyPendingItem[]> { return this.repo.weeklyPending(); }
  weeklyRouting(): Promise<WeeklyRoutingItem[]> { return this.repo.weeklyRouting(); }
  weeklyReview(id: string, body: unknown): Promise<ReportPackage> {
    const r = parse(reportWeeklyReviewSchema, body);
    return this.repo.weeklyReview(parse(uuidSchema, id), r.decision, r.comment);
  }
}
