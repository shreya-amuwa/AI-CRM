import type {
  AdsAssignmentDeleteResult,
  AdsAssignment, AdsAssignmentDetail, AdsClient, AdsContext, AdsIssue, AdsIssueDetail, AdsNotice, AdsOverview, AdsPerson, AdsReport, AdsReportDetail
} from '../../shared/contracts.js';
import {
  adsAssignmentCreateSchema, adsAssignmentListQuerySchema, adsAssignmentReassignSchema, adsAssignmentStatusSchema, adsAssignmentUpdateSchema, adsClientCreateSchema,
  adsClientListQuerySchema, adsClientUpdateSchema, adsIssueCreateSchema, adsIssueEscalateSchema, adsIssueListQuerySchema, adsIssueUpdateSchema, adsNoticeCreateSchema,
  adsNoticeListQuerySchema, adsNoticeStatusSchema, adsReportListQuerySchema, adsReportReviewSchema, adsReportSchema, uuidSchema
} from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { AiDesignStudioRepository } from '../repositories/AiDesignStudioRepository.js';

/**
 * AI Design Studio: clients, client notices, assignments, daily reports and issues of one department. Who may read or write what is
 * decided by the database from the caller's own login; this layer only validates input with the same schemas the forms use.
 */
export class AiDesignStudioService {
  constructor(private readonly repo: AiDesignStudioRepository) {}

  context(): Promise<AdsContext> { return this.repo.context(); }
  people(): Promise<AdsPerson[]> { return this.repo.people(); }
  overview(): Promise<AdsOverview> { return this.repo.overview(); }

  clientCreate(body: unknown): Promise<AdsClient> { return this.repo.clientCreate(parse(adsClientCreateSchema, body)); }
  clientUpdate(id: string, body: unknown): Promise<AdsClient> { return this.repo.clientUpdate(parse(uuidSchema, id), parse(adsClientUpdateSchema, body)); }
  clients(query: unknown): Promise<AdsClient[]> { return this.repo.clients(parse(adsClientListQuerySchema, query ?? {})); }
  client(id: string): Promise<AdsClient> { return this.repo.client(parse(uuidSchema, id)); }

  noticeCreate(body: unknown): Promise<AdsNotice> { return this.repo.noticeCreate(parse(adsNoticeCreateSchema, body)); }
  notices(query: unknown): Promise<AdsNotice[]> { return this.repo.notices(parse(adsNoticeListQuerySchema, query ?? {})); }
  noticeStatus(id: string, body: unknown): Promise<AdsNotice> { return this.repo.noticeStatus(parse(uuidSchema, id), parse(adsNoticeStatusSchema, body).status); }

  assignmentCreate(body: unknown): Promise<AdsAssignment> { return this.repo.assignmentCreate(parse(adsAssignmentCreateSchema, body)); }
  assignments(query: unknown): Promise<AdsAssignment[]> { return this.repo.assignments(parse(adsAssignmentListQuerySchema, query ?? {})); }
  assignment(id: string): Promise<AdsAssignmentDetail> { return this.repo.assignment(parse(uuidSchema, id)); }
  assignmentStatus(id: string, body: unknown): Promise<AdsAssignment> { return this.repo.assignmentStatus(parse(uuidSchema, id), parse(adsAssignmentStatusSchema, body)); }
  assignmentUpdate(id: string, body: unknown): Promise<AdsAssignment> { return this.repo.assignmentUpdate(parse(uuidSchema, id), parse(adsAssignmentUpdateSchema, body)); }
  assignmentReassign(id: string, body: unknown): Promise<AdsAssignment> {
    const b = parse(adsAssignmentReassignSchema, body);
    return this.repo.assignmentReassign(parse(uuidSchema, id), b.assigneeId, b.note);
  }

  /** The Team Lead who gave the work or the Department Head (the database checks). */
  assignmentDelete(id: string): Promise<AdsAssignmentDeleteResult> { return this.repo.assignmentDelete(parse(uuidSchema, id)); }

  reportSubmit(body: unknown): Promise<AdsReport> { return this.repo.reportSubmit(parse(adsReportSchema, body)); }
  reports(query: unknown): Promise<AdsReport[]> { return this.repo.reports(parse(adsReportListQuerySchema, query ?? {})); }
  report(id: string): Promise<AdsReportDetail> { return this.repo.report(parse(uuidSchema, id)); }
  reportReview(id: string, body: unknown): Promise<AdsReport> {
    const b = parse(adsReportReviewSchema, body);
    return this.repo.reportReview(parse(uuidSchema, id), b.decision, b.remarks);
  }

  issueCreate(body: unknown): Promise<AdsIssue> { return this.repo.issueCreate(parse(adsIssueCreateSchema, body)); }
  issues(query: unknown): Promise<AdsIssue[]> { return this.repo.issues(parse(adsIssueListQuerySchema, query ?? {})); }
  issue(id: string): Promise<AdsIssueDetail> { return this.repo.issue(parse(uuidSchema, id)); }
  issueUpdate(id: string, body: unknown): Promise<AdsIssue> {
    const b = parse(adsIssueUpdateSchema, body);
    return this.repo.issueUpdate(parse(uuidSchema, id), b.status, b.note);
  }
  issueEscalate(id: string, body: unknown): Promise<AdsIssue> { return this.repo.issueEscalate(parse(uuidSchema, id), parse(adsIssueEscalateSchema, body ?? {}).note); }
}
