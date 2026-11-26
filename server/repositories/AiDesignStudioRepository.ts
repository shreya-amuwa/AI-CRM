import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AdsAssignment, AdsAssignmentDetail, AdsClient, AdsContext, AdsIssue, AdsIssueDetail, AdsNotice, AdsOverview, AdsPerson, AdsReport, AdsReportDetail
} from '../../shared/contracts.js';
import { unwrap } from './base.js';

/**
 * AI Design Studio. Every call is a database function (ads_*) that works out who the caller is from their own login and checks the
 * Department Head -> Team Lead -> Team Member hierarchy; nothing here names a role, a team or a department to trust. The caller's own
 * database client is used (never the service key), and the tables themselves are not readable by the app roles.
 */
export class AiDesignStudioRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  context() { return this.rpc<AdsContext>('ads_context'); }
  people() { return this.rpc<AdsPerson[]>('ads_people'); }
  overview() { return this.rpc<AdsOverview>('ads_overview'); }

  clientCreate(p: Record<string, unknown>) { return this.rpc<AdsClient>('ads_client_create', { p }); }
  clientUpdate(id: string, p: Record<string, unknown>) { return this.rpc<AdsClient>('ads_client_update', { p_id: id, p }); }
  clients(q: { search?: string; status?: string }) { return this.rpc<AdsClient[]>('ads_clients_list', { p_search: q.search ?? null, p_status: q.status ?? null }); }
  client(id: string) { return this.rpc<AdsClient>('ads_client_get', { p_id: id }); }

  noticeCreate(p: Record<string, unknown>) { return this.rpc<AdsNotice>('ads_notice_create', { p }); }
  notices(q: { clientId?: string; status?: string }) { return this.rpc<AdsNotice[]>('ads_notices_list', { p_client: q.clientId ?? null, p_status: q.status ?? null }); }
  noticeStatus(id: string, status: string) { return this.rpc<AdsNotice>('ads_notice_set_status', { p_id: id, p_status: status }); }

  assignmentCreate(p: Record<string, unknown>) { return this.rpc<AdsAssignment>('ads_assignment_create', { p }); }
  assignments(q: { view: string; status?: string; clientId?: string }) {
    return this.rpc<AdsAssignment[]>('ads_assignments_list', { p_view: q.view, p_status: q.status ?? null, p_client: q.clientId ?? null });
  }
  assignment(id: string) { return this.rpc<AdsAssignmentDetail>('ads_assignment_get', { p_id: id }); }
  assignmentStatus(id: string, s: { status: string; progress?: number; note?: string | null }) {
    return this.rpc<AdsAssignment>('ads_assignment_set_status', { p_id: id, p_status: s.status, p_progress: s.progress ?? null, p_note: s.note ?? null });
  }
  assignmentUpdate(id: string, p: Record<string, unknown>) { return this.rpc<AdsAssignment>('ads_assignment_update', { p_id: id, p }); }
  assignmentReassign(id: string, assigneeId: string, note?: string | null) {
    return this.rpc<AdsAssignment>('ads_assignment_reassign', { p_id: id, p_assignee: assigneeId, p_note: note ?? null });
  }

  reportSubmit(p: Record<string, unknown>) { return this.rpc<AdsReport>('ads_report_submit', { p }); }
  reports(q: { view: string; status?: string; from?: string; to?: string; clientId?: string; authorId?: string; leadId?: string }) {
    return this.rpc<AdsReport[]>('ads_reports_list', {
      p_view: q.view, p_status: q.status ?? null, p_from: q.from ?? null, p_to: q.to ?? null, p_client: q.clientId ?? null, p_author: q.authorId ?? null, p_lead: q.leadId ?? null
    });
  }
  report(id: string) { return this.rpc<AdsReportDetail>('ads_report_get', { p_id: id }); }
  reportReview(id: string, decision: string, remarks?: string | null) {
    return this.rpc<AdsReport>('ads_report_review', { p_id: id, p_decision: decision, p_remarks: remarks ?? null });
  }

  issueCreate(p: Record<string, unknown>) { return this.rpc<AdsIssue>('ads_issue_create', { p }); }
  issues(q: { view: string; status?: string }) { return this.rpc<AdsIssue[]>('ads_issues_list', { p_view: q.view, p_status: q.status ?? null }); }
  issue(id: string) { return this.rpc<AdsIssueDetail>('ads_issue_get', { p_id: id }); }
  issueUpdate(id: string, status?: string, note?: string | null) { return this.rpc<AdsIssue>('ads_issue_update', { p_id: id, p_status: status ?? null, p_note: note ?? null }); }
  issueEscalate(id: string, note?: string | null) { return this.rpc<AdsIssue>('ads_issue_escalate', { p_id: id, p_note: note ?? null }); }
}
