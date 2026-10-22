import type {
  AttendanceDay, HrEmailCards, HrEmailDataIssue, HrEmailHistory, HrEmailKind, HrEmailOverview, HrProbationCycle, LeaveMonthlySummary, LeaveRequest, LeaveReview, PersonalDetails
} from '../../shared/contracts.js';
import {
  hrConfirmProbationSchema,
  hrDismissProbationSchema,
  hrEmailHistoryQuerySchema,
  hrEmployeeDatesSchema,
  attendanceQuerySchema,
  leaveDecisionSchema,
  leaveMonthQuerySchema,
  leaveSubmitSchema,
  manualPunchSchema,
  uuidSchema
} from '../../shared/validation.js';
import { automationSettings, liveChannels } from '../automations/config.js';
import { renderHrEmail } from '../automations/hrTemplates.js';
import { parse } from '../http/validate.js';
import type { HrRepository } from '../repositories/HrRepository.js';

export class HrService {
  constructor(private readonly repo: HrRepository) {}

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
  leaveToReview(): Promise<LeaveReview> { return this.repo.leaveToReview(); }
  decideAsDepartmentHead(id: string, body: unknown): Promise<LeaveRequest> {
    const i = parse(leaveDecisionSchema, body);
    return this.repo.decideAsDepartmentHead(parse(uuidSchema, id), i.approve, i.note ?? null);
  }
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
  confirmProbation(id: string, body: unknown): Promise<HrProbationCycle> {
    const i = parse(hrConfirmProbationSchema, body ?? {});
    return this.repo.confirmProbation(parse(uuidSchema, id), i.effectiveDate ?? null, i.note ?? null);
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
