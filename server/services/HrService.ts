import type {
  AttendanceDay, HrEmailDataIssue, HrEmailHistory, HrEmailOverview, HrProbationCycle, LeaveMonthlySummary, LeaveRequest, LeaveReview, PersonalDetails
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
