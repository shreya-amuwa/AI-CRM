import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CaseDepartment, CaseMyDetails, EmployeeIssue, EmployeeIssueDetail, EmployeeIssueList, EmployeeIssueOverview, EmployeeMeeting, EmployeeMeetingDetail, EmployeeMeetingList,
  EmployeeMeetingOverview, HrAssignee, IssueAttachment
} from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** A row of employee_issue_attachments as the upload / download functions return it. */
export interface IssueAttachmentRow {
  id: string;
  issue_id: string | null;
  uploader_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  storage_bucket: string;
  storage_path: string;
  storage_provider: 'R2' | 'SUPABASE' | null;
}

/**
 * Employee issues and meeting requests. Every call is a database function that decides from the caller's own login (the employee a case
 * belongs to, or HR staff); nothing here names an employee, an owner or a storage path. The caller's own database client is used (row level
 * security applies), never the service key.
 */
export class EmployeeCaseRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  // ---- issues: the employee
  submitIssue(i: { clientRequestId: string; title: string; category: string; description: string; priority: string; preferredResolution?: string | null; attachmentIds: string[] }) {
    return this.rpc<EmployeeIssue>('issue_submit', {
      p_client_request: i.clientRequestId, p_title: i.title, p_category: i.category, p_description: i.description, p_priority: i.priority,
      p_resolution: i.preferredResolution ?? null, p_attachments: i.attachmentIds
    });
  }
  myDetails() { return this.rpc<CaseMyDetails>('issue_my_details'); }
  myIssues(i: { status?: string; limit: number; offset: number }) { return this.rpc<EmployeeIssueList>('issue_my_list', { p_status: i.status ?? null, p_limit: i.limit, p_offset: i.offset }); }
  myIssue(id: string) { return this.rpc<EmployeeIssueDetail>('issue_my_detail', { p_id: id }); }
  replyToIssue(id: string, message: string, attachmentIds: string[]) { return this.rpc<EmployeeIssueDetail>('issue_employee_reply', { p_id: id, p_message: message, p_attachments: attachmentIds }); }

  // ---- issues: HR
  issueOverview() { return this.rpc<EmployeeIssueOverview>('issue_hr_overview'); }
  assignees() { return this.rpc<HrAssignee[]>('issue_hr_assignees'); }
  departments() { return this.rpc<CaseDepartment[]>('issue_hr_departments'); }
  hrIssues(i: { status?: string; departmentId?: string; priority?: string; category?: string; assigneeId?: string; unassigned?: boolean; from?: string; to?: string; search?: string; limit: number; offset: number }) {
    return this.rpc<EmployeeIssueList>('issue_hr_list', {
      p_status: i.status ?? null, p_department: i.departmentId ?? null, p_priority: i.priority ?? null, p_category: i.category ?? null, p_assignee: i.assigneeId ?? null,
      p_unassigned: i.unassigned ?? false, p_from: i.from ?? null, p_to: i.to ?? null, p_search: i.search || null, p_limit: i.limit, p_offset: i.offset
    });
  }
  hrIssue(id: string) { return this.rpc<EmployeeIssueDetail>('issue_hr_detail', { p_id: id }); }
  assignIssue(id: string, hrId: string | null) { return this.rpc<EmployeeIssueDetail>('issue_hr_assign', { p_id: id, p_hr: hrId }); }
  setIssueStatus(id: string, status: string, message?: string | null) { return this.rpc<EmployeeIssueDetail>('issue_hr_set_status', { p_id: id, p_status: status, p_message: message ?? null }); }
  respondToIssue(id: string, message: string, requestInfo: boolean) { return this.rpc<EmployeeIssueDetail>('issue_hr_respond', { p_id: id, p_message: message, p_request_info: requestInfo }); }
  noteOnIssue(id: string, note: string) { return this.rpc<EmployeeIssueDetail>('issue_hr_note', { p_id: id, p_note: note }); }

  // ---- meetings: the employee
  submitMeeting(i: { clientRequestId: string; subject: string; category: string; description: string; preferredDate: string; preferredTime: string; mode: string; notes?: string | null }) {
    return this.rpc<EmployeeMeeting>('meeting_submit', {
      p_client_request: i.clientRequestId, p_subject: i.subject, p_category: i.category, p_description: i.description, p_date: i.preferredDate, p_time: i.preferredTime,
      p_mode: i.mode, p_notes: i.notes ?? null
    });
  }
  myMeetings(i: { status?: string; limit: number; offset: number }) { return this.rpc<EmployeeMeetingList>('meeting_my_list', { p_status: i.status ?? null, p_limit: i.limit, p_offset: i.offset }); }
  myMeeting(id: string) { return this.rpc<EmployeeMeetingDetail>('meeting_my_detail', { p_id: id }); }
  cancelMyMeeting(id: string, reason?: string | null) { return this.rpc<EmployeeMeetingDetail>('meeting_my_cancel', { p_id: id, p_reason: reason ?? null }); }
  answerAlternative(id: string, accept: boolean, message?: string | null) { return this.rpc<EmployeeMeetingDetail>('meeting_respond_alternative', { p_id: id, p_accept: accept, p_message: message ?? null }); }

  // ---- meetings: HR
  meetingOverview() { return this.rpc<EmployeeMeetingOverview>('meeting_hr_overview'); }
  hrMeetings(i: { status?: string; departmentId?: string; category?: string; assigneeId?: string; unassigned?: boolean; from?: string; to?: string; search?: string; limit: number; offset: number }) {
    return this.rpc<EmployeeMeetingList>('meeting_hr_list', {
      p_status: i.status ?? null, p_department: i.departmentId ?? null, p_category: i.category ?? null, p_assignee: i.assigneeId ?? null, p_unassigned: i.unassigned ?? false,
      p_from: i.from ?? null, p_to: i.to ?? null, p_search: i.search || null, p_limit: i.limit, p_offset: i.offset
    });
  }
  hrMeeting(id: string) { return this.rpc<EmployeeMeetingDetail>('meeting_hr_detail', { p_id: id }); }
  assignMeeting(id: string, hrId: string | null) { return this.rpc<EmployeeMeetingDetail>('meeting_hr_assign', { p_id: id, p_hr: hrId }); }
  noteOnMeeting(id: string, note: string) { return this.rpc<EmployeeMeetingDetail>('meeting_hr_note', { p_id: id, p_note: note }); }
  decideMeeting(id: string, i: { action: string; date?: string | null; time?: string | null; mode?: string | null; location?: string | null; link?: string | null; instructions?: string | null; message?: string | null; reason?: string | null; outcome?: string | null; followUp?: string | null }) {
    return this.rpc<EmployeeMeetingDetail>('meeting_hr_decide', {
      p_id: id, p_action: i.action, p_date: i.date ?? null, p_time: i.time ?? null, p_mode: i.mode ?? null, p_location: i.location ?? null, p_link: i.link ?? null,
      p_instructions: i.instructions ?? null, p_message: i.message ?? null, p_reason: i.reason ?? null, p_outcome: i.outcome ?? null, p_follow_up: i.followUp ?? null
    });
  }

  // ---- attachments
  beginUpload(fileName: string, mime: string, size: number) { return this.rpc<IssueAttachmentRow>('issue_begin_upload', { p_file_name: fileName, p_mime: mime, p_size: size }); }
  pendingUpload(id: string) { return this.rpc<IssueAttachmentRow>('issue_pending_upload', { p_attachment: id }); }
  completeUpload(id: string, size: number, etag: string | null) { return this.rpc<Pick<IssueAttachment, 'id'> & { name: string; mime: string; size: number }>('issue_complete_upload', { p_attachment: id, p_size: size, p_etag: etag }); }
  async abortUpload(id: string) { await this.rpc<null>('issue_abort_upload', { p_attachment: id }); }
  attachmentFile(id: string) { return this.rpc<IssueAttachmentRow>('issue_attachment_download', { p_attachment: id }); }
}
