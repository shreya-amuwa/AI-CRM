import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaidLeaveBalance, PaidLeaveDetail, PaidLeaveList, PaidLeavePolicy,
  AttendanceDay, HrEmailCards, HrEmailDataIssue, HrEmailHistory, HrEmailOverview, HrProbationCycle, LeaveMonthlySummary, LeaveRequest, LeaveReview, PersonalDetails
} from '../../shared/contracts.js';
import { unwrap } from './base.js';

/**
 * HR attendance, personal details and leave. Each call is a database function that checks who the caller is and
 * what they may do (HR staff, the employee's Department Head, the employee themselves), so the rules hold even
 * for a request that does not come from this API.
 */
export class HrRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    return unwrap(await this.db.rpc(name, args)) as T;
  }

  async recordRmLogin(): Promise<void> { await this.rpc('record_rm_login'); }
  attendance(date: string | null) { return this.rpc<AttendanceDay>('hr_attendance', { p_date: date }); }
  async manualPunch(profileId: string, kind: 'RM' | 'BIOMETRIC', at: string): Promise<void> {
    await this.rpc('hr_record_punch', { p_profile: profileId, p_kind: kind, p_at: at });
  }
  personalDetails() { return this.rpc<PersonalDetails[]>('hr_personal_details'); }
  async notifyMemberCreated(profileId: string): Promise<void> { await this.rpc('notify_member_created', { p_profile: profileId }); }

  submitLeave(i: { leaveType: string; startDate: string; endDate: string | null; halfDayShift: string | null; reason: string }) {
    return this.rpc<LeaveRequest>('submit_leave_request', {
      p_leave_type: i.leaveType, p_start: i.startDate, p_end: i.endDate, p_half_day_shift: i.halfDayShift, p_reason: i.reason
    });
  }
  myLeave() { return this.rpc<LeaveRequest[]>('my_leave_requests'); }
  // paid leave: the employee's balance, a paid request, and HR's view and corrections (the database computes every figure)
  submitPaidLeave(i: { leaveType: string; startDate: string; endDate: string | null; halfDayShift: string | null; reason: string }) {
    return this.rpc<LeaveRequest>('submit_paid_leave_request', {
      p_leave_type: i.leaveType, p_start: i.startDate, p_end: i.endDate, p_half_day_shift: i.halfDayShift, p_reason: i.reason
    });
  }
  myPaidLeave() { return this.rpc<PaidLeaveBalance>('my_paid_leave_balance'); }
  paidLeaveList(search?: string) { return this.rpc<PaidLeaveList>('hr_paid_leave_balances', { p_search: search || null }); }
  paidLeaveDetail(profileId: string) { return this.rpc<PaidLeaveDetail>('hr_paid_leave_detail', { p_profile: profileId }); }
  paidLeaveAdjust(profileId: string, i: { kind: string; days: number; note: string }) {
    return this.rpc<PaidLeaveDetail>('hr_paid_leave_adjust', { p_profile: profileId, p_kind: i.kind, p_days: i.days, p_note: i.note });
  }
  paidLeavePolicy(i: { enabled: boolean; monthlyDays: number; creditDay: number; partialMonthRule: string; startMonth?: string | null }) {
    return this.rpc<PaidLeavePolicy>('paid_leave_settings_set', {
      p_enabled: i.enabled, p_monthly_days: i.monthlyDays, p_credit_day: i.creditDay, p_partial_month_rule: i.partialMonthRule, p_start_month: i.startMonth ?? null
    });
  }
  confirmationDate(cycleId: string, i: { effectiveDate: string; note: string }) {
    return this.rpc<{ cycleId: string; effectiveDate: string; before: string | null }>('hr_confirmation_effective_date_set', { p_cycle: cycleId, p_effective: i.effectiveDate, p_note: i.note });
  }
  leaveToReview() { return this.rpc<LeaveReview>('leave_requests_to_review'); }
  decideAsDepartmentHead(id: string, approve: boolean, note: string | null) {
    return this.rpc<LeaveRequest>('decide_leave_department_head', { p_id: id, p_approve: approve, p_note: note });
  }
  decideAsHr(id: string, approve: boolean, note: string | null) {
    return this.rpc<LeaveRequest>('decide_leave_hr', { p_id: id, p_approve: approve, p_note: note });
  }
  /** One step of the multi-level chain (20261225000200): the database checks the caller is the current approver. */
  decideLeave(id: string, decision: 'APPROVE' | 'REJECT' | 'REVISE', note: string | null) {
    return this.rpc<LeaveRequest>('decide_leave', { p_id: id, p_decision: decision, p_note: note });
  }
  resubmitLeave(id: string, reason: string) { return this.rpc<LeaveRequest>('resubmit_leave_request', { p_id: id, p_reason: reason }); }
  setLeaveWorkflow(workflow: 'MULTI_LEVEL' | 'TWO_STEP') { return this.rpc<{ workflow: string }>('set_leave_workflow', { p_workflow: workflow }); }
  setSupportDesk(on: boolean) { return this.rpc<{ supportDeskDepartmentWide: boolean }>('set_support_desk_department_wide', { p_on: on }); }
  monthlySummary(month: string | null) { return this.rpc<LeaveMonthlySummary>('leave_monthly_summary', { p_month: month }); }

  // HR e-mail automation (birthdays, anniversaries, probation reminders, confirmation). Every function checks HR staff itself.
  emailOverview() { return this.rpc<Omit<HrEmailOverview, 'settings'>>('hr_email_overview'); }
  emailHistory(i: { status?: string; kind?: string; limit: number; offset: number }) {
    return this.rpc<HrEmailHistory>('hr_email_history', { p_status: i.status ?? null, p_kind: i.kind ?? null, p_limit: i.limit, p_offset: i.offset });
  }
  probationList() { return this.rpc<HrProbationCycle[]>('hr_probation_list'); }
  confirmProbation(id: string, effectiveDate: string | null, note: string | null) {
    return this.rpc<HrProbationCycle>('hr_confirm_probation', { p_cycle: id, p_effective: effectiveDate, p_note: note });
  }
  dismissProbation(id: string, note: string) { return this.rpc<HrProbationCycle>('hr_dismiss_probation', { p_cycle: id, p_note: note }); }
  // Confirmation completes only once the employee's e-mail is sent (20270223000100): read back, retry the e-mail, the overdue reminder.
  probationGet(id: string) { return this.rpc<HrProbationCycle>('hr_probation_get', { p_cycle: id }); }
  retryProbationEmail(id: string) { return this.rpc<HrProbationCycle>('hr_probation_retry_email', { p_cycle: id }); }
  remindOverdueProbation(id: string) { return this.rpc<HrProbationCycle & { reminded: number }>('hr_probation_remind_overdue', { p_cycle: id }); }
  retryEmail(id: string) { return this.rpc<{ id: string; status: string }>('hr_email_retry', { p_event: id }); }
  emailCards() { return this.rpc<Omit<HrEmailCards, 'settings' | 'templates' | 'runsAt'>>('hr_email_cards'); }
  emailDataIssues() { return this.rpc<HrEmailDataIssue[]>('hr_email_data_issues'); }
  setEmployeeDates(i: { employeeKey: string; dateOfBirth: string | null; joiningDate: string | null }) {
    return this.rpc<{ employeeKey: string }>('hr_set_employee_dates', { p_employee_key: i.employeeKey, p_date_of_birth: i.dateOfBirth, p_joining_date: i.joiningDate });
  }
}
