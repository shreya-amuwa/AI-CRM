import type {
  AttendanceDay, HrEmailCards, HrEmailDataIssue, HrEmailHistory, HrEmailKind, HrEmailOverview, HrProbationCycle, LeaveMonthlySummary, LeaveRequest, LeaveReview, PersonalDetails
} from '../../shared/contracts.js';
import { confirmationDateSchema, paidLeaveAdjustSchema, paidLeaveListQuerySchema, paidLeavePolicySchema,
  hrConfirmProbationSchema,
  hrDismissProbationSchema,
  hrEmailHistoryQuerySchema,
  hrEmployeeDatesSchema,
  attendanceQuerySchema,
  leaveDecisionSchema,
  leaveResubmitSchema,
  leaveStageDecisionSchema,
  leaveWorkflowSchema,
  supportDeskSchema,
  leaveMonthQuerySchema,
  leaveSubmitSchema,
  manualPunchSchema,
  uuidSchema
} from '../../shared/validation.js';
import { automationSettings, liveChannels } from '../automations/config.js';
import { sendHrCycleEmails } from '../automations/hrDispatcher.js';
import { renderHrEmail } from '../automations/hrTemplates.js';
import { parse } from '../http/validate.js';
import type { HrRepository } from '../repositories/HrRepository.js';

export class HrService {
  constructor(
    private readonly repo: HrRepository,
    // sends one cycle's confirmation e-mails now (service role); injectable for tests
    private readonly sendCycle: (cycleId: string) => Promise<{ note?: string }> = id => sendHrCycleEmails(id)
  ) {}

  recordRmLogin() { return this.repo.recordRmLogin(); }

  attendance(query: unknown): Promise<AttendanceDay> {
    return this.repo.attendance(parse(attendanceQuerySchema, query).date ?? null);
  }
  async manualPunch(body: unknown): Promise<void> {
    const i = parse(manualPunchSchema, body);
    await this.repo.manualPunch(i.profileId, i.kind, i.at);
  }
  personalDetails(): Promise<PersonalDetails[]> { return this.repo.personalDetails(); }

  submitLeave(body: unknown): Promise<LeaveRequest> {
    const i = parse(leaveSubmitSchema, body);
    return this.repo.submitLeave({
      leaveType: i.leaveType, startDate: i.startDate, endDate: i.endDate ?? null, halfDayShift: i.halfDayShift ?? null, reason: i.reason
    });
  }
  myLeave(): Promise<LeaveRequest[]> { return this.repo.myLeave(); }
  submitPaidLeave(body: unknown): Promise<LeaveRequest> {
    const i = parse(leaveSubmitSchema, body);
    return this.repo.submitPaidLeave({
      leaveType: i.leaveType, startDate: i.startDate, endDate: i.endDate ?? null, halfDayShift: i.halfDayShift ?? null, reason: i.reason
    });
  }
  myPaidLeave() { return this.repo.myPaidLeave(); }
  paidLeaveList(query: unknown) { return this.repo.paidLeaveList(parse(paidLeaveListQuerySchema, query).search); }
  paidLeaveDetail(profileId: string) { return this.repo.paidLeaveDetail(parse(uuidSchema, profileId)); }
  paidLeaveAdjust(profileId: string, body: unknown) { return this.repo.paidLeaveAdjust(parse(uuidSchema, profileId), parse(paidLeaveAdjustSchema, body)); }
  paidLeavePolicy(body: unknown) { return this.repo.paidLeavePolicy(parse(paidLeavePolicySchema, body)); }
  confirmationDate(cycleId: string, body: unknown) { return this.repo.confirmationDate(parse(uuidSchema, cycleId), parse(confirmationDateSchema, body)); }
  leaveToReview(): Promise<LeaveReview> { return this.repo.leaveToReview(); }
  decideAsDepartmentHead(id: string, body: unknown): Promise<LeaveRequest> {
    const i = parse(leaveDecisionSchema, body);
    return this.repo.decideAsDepartmentHead(parse(uuidSchema, id), i.approve, i.note ?? null);
  }
  decideLeave(id: string, body: unknown): Promise<LeaveRequest> {
    const i = parse(leaveStageDecisionSchema, body);
    return this.repo.decideLeave(parse(uuidSchema, id), i.decision, i.note ?? null);
  }
  resubmitLeave(id: string, body: unknown): Promise<LeaveRequest> {
    return this.repo.resubmitLeave(parse(uuidSchema, id), parse(leaveResubmitSchema, body).reason);
  }
  setLeaveWorkflow(body: unknown) { return this.repo.setLeaveWorkflow(parse(leaveWorkflowSchema, body).workflow); }
  setSupportDesk(body: unknown) { return this.repo.setSupportDesk(parse(supportDeskSchema, body).departmentWide); }
  decideAsHr(id: string, body: unknown): Promise<LeaveRequest> {
    const i = parse(leaveDecisionSchema, body);
    return this.repo.decideAsHr(parse(uuidSchema, id), i.approve, i.note ?? null);
  }
  monthlySummary(query: unknown): Promise<LeaveMonthlySummary> {
    const { month } = parse(leaveMonthQuerySchema, query);
    return this.repo.monthlySummary(month ? `${month}-01` : null);
  }

  // ---- E-mail automation ----
  async emailOverview(): Promise<HrEmailOverview> {
    const base = await this.repo.emailOverview();
    const s = automationSettings();
    return { ...base, settings: { mode: s.mode, emailConfigured: liveChannels(s).includes('EMAIL'), testMode: !!s.testRecipients } };
  }
  /** The three automation cards: live figures from the database plus the wording of each e-mail (a sample employee, never real data). */
  async emailCards(): Promise<HrEmailCards> {
    const base = await this.repo.emailCards();
    const s = automationSettings();
    const sample = { employeeName: 'Asha Verma', employeeCode: 'EMP-1A2B3C4D', department: 'Sales', designation: 'Sales Executive', reportingManager: 'Rohan Mehta',
                     joiningDate: '2026-04-10', probationEndDate: '2026-10-10', years: 2, daysLeft: 7 };
    const sampleMail = (label: string, to: string, kind: HrEmailKind) => {
      const m = renderHrEmail(kind, sample);
      return { label, to, subject: m.subject, text: m.text };
    };
    return {
      ...base,
      settings: { mode: s.mode, emailConfigured: liveChannels(s).includes('EMAIL'), testMode: !!s.testRecipients },
      runsAt: '9:00 AM and 10:30 AM (India time), every day',
      templates: {
        BIRTHDAY: [sampleMail('Birthday e-mail', 'The employee', 'BIRTHDAY')],
        ANNIVERSARY: [sampleMail('Work anniversary e-mail', 'The employee', 'ANNIVERSARY')],
        CONFIRMATION: [
          sampleMail('Reminder to the employee', 'The employee', 'PROBATION_REMINDER_EMPLOYEE'),
          sampleMail('Reminder to HR', 'The HR team', 'PROBATION_REMINDER_HR')
        ]
      }
    };
  }
  emailHistory(query: unknown): Promise<HrEmailHistory> { return this.repo.emailHistory(parse(hrEmailHistoryQuerySchema, query)); }
  probationList(): Promise<HrProbationCycle[]> { return this.repo.probationList(); }
  /**
   * Confirm: the database validates and records the decision (CONFIRMING) and queues the confirmation e-mails; they are sent right here, and the
   * employee is Confirmed only when the database has recorded their e-mail as SENT. The cycle is read back so the screen shows the real outcome.
   */
  async confirmProbation(id: string, body: unknown): Promise<HrProbationCycle> {
    const i = parse(hrConfirmProbationSchema, body ?? {});
    const cycleId = parse(uuidSchema, id);
    await this.repo.confirmProbation(cycleId, i.effectiveDate ?? null, i.note ?? null);
    return this.sendConfirmationNow(cycleId);
  }
  async retryProbationEmail(id: string): Promise<HrProbationCycle> {
    const cycleId = parse(uuidSchema, id);
    const cycle = await this.repo.retryProbationEmail(cycleId);
    return cycle.status === 'APPROVED' ? cycle : this.sendConfirmationNow(cycleId);
  }
  remindOverdueProbation(id: string) { return this.repo.remindOverdueProbation(parse(uuidSchema, id)); }
  private async sendConfirmationNow(cycleId: string): Promise<HrProbationCycle> {
    let notice: string | undefined;
    try {
      notice = (await this.sendCycle(cycleId)).note;
    } catch {
      // the e-mail stays queued (the scheduler sends it); the read-back below shows its real status
      notice = 'The confirmation e-mail could not be sent just now. It stays queued; retry it or wait for the next automatic run.';
    }
    const cycle = await this.repo.probationGet(cycleId);
    return notice && cycle.status !== 'APPROVED' ? { ...cycle, notice } : cycle;
  }
  dismissProbation(id: string, body: unknown): Promise<HrProbationCycle> {
    return this.repo.dismissProbation(parse(uuidSchema, id), parse(hrDismissProbationSchema, body).note);
  }
  retryEmail(id: string) { return this.repo.retryEmail(parse(uuidSchema, id)); }
  emailDataIssues(): Promise<HrEmailDataIssue[]> { return this.repo.emailDataIssues(); }
  setEmployeeDates(body: unknown) {
    const i = parse(hrEmployeeDatesSchema, body);
    return this.repo.setEmployeeDates({ employeeKey: i.employeeKey, dateOfBirth: i.dateOfBirth ?? null, joiningDate: i.joiningDate ?? null });
  }
}
