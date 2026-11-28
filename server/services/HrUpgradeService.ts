import type { AttendanceExportPage, AttendanceStatement, AttendanceStatementOptions, OfficeHoliday, ReviewDetail, ReviewList, ReviewQueue } from '../../shared/hrUpgrade.js';
import { attendanceExportSchema, attendanceStatementSchema, biometricIdSchema, holidayQuerySchema, holidaySchema, reviewDecisionSchema, reviewEvaluationSchema, reviewListQuerySchema, reviewReassignSchema,
  reviewReturnSchema, tcListQuerySchema, tcPlanCloseSchema, tcPolicySchema, tcProfileQuerySchema, tcRecalcSchema, tcReportSchema, tcScheduleSchema, tcTargetSchema } from '../../shared/hrUpgrade.js';
import { uuidSchema } from '../../shared/validation.js';
import { sendHrCycleEmails } from '../automations/hrDispatcher.js';
import { parse } from '../http/validate.js';
import type { HrUpgradeRepository } from '../repositories/HrUpgradeRepository.js';

/** HR dashboard upgrade: validates the request; the database decides and records (see HrUpgradeRepository). */
export class HrUpgradeService {
  constructor(
    private readonly repo: HrUpgradeRepository,
    // a confirmation sends its e-mails at once (the same path as the existing Confirm); injectable for tests
    private readonly sendCycle: (cycleId: string) => Promise<{ note?: string }> = id => sendHrCycleEmails(id)
  ) {}

  reviews(query: unknown): Promise<ReviewList> { return this.repo.reviews(parse(reviewListQuerySchema, query ?? {})); }
  myReviews(): Promise<ReviewQueue> { return this.repo.myReviews(); }
  review(id: string): Promise<ReviewDetail> { return this.repo.review(parse(uuidSchema, id)); }
  saveEvaluation(id: string, body: unknown): Promise<ReviewDetail> {
    const i = parse(reviewEvaluationSchema, body);
    return this.repo.saveEvaluation(parse(uuidSchema, id), i.role, { ratings: i.ratings, answers: i.answers, recommendation: i.recommendation ?? null, submit: i.submit });
  }
  returnEvaluation(id: string, body: unknown): Promise<ReviewDetail> {
    const i = parse(reviewReturnSchema, body);
    return this.repo.returnEvaluation(parse(uuidSchema, id), i.role, i.reason);
  }
  reassign(id: string, body: unknown): Promise<ReviewDetail> {
    const i = parse(reviewReassignSchema, body);
    return this.repo.reassign(parse(uuidSchema, id), i.role, i.profileId, i.reason);
  }
  start(id: string): Promise<ReviewDetail> { return this.repo.start(parse(uuidSchema, id)); }
  /** The final decision. A confirmation queues the existing confirmation e-mails; they are sent right here, as Confirm always did. */
  async decide(id: string, body: unknown): Promise<ReviewDetail> {
    const cycleId = parse(uuidSchema, id);
    const i = parse(reviewDecisionSchema, body);
    const detail = await this.repo.decide(cycleId, i as Record<string, unknown>);
    if (i.decision !== 'CONFIRM') return detail;
    let notice: string | undefined;
    try {
      notice = (await this.sendCycle(cycleId)).note;
    } catch {
      notice = 'The confirmation e-mail could not be sent just now. It stays queued and goes out with the next automatic run.';
    }
    const fresh = await this.repo.review(cycleId);
    return notice ? { ...fresh, notice } : fresh;
  }
  holidays(query: unknown): Promise<OfficeHoliday[]> { return this.repo.holidays(parse(holidayQuerySchema, query ?? {}).year ?? null); }
  setHoliday(body: unknown): Promise<OfficeHoliday[]> {
    const i = parse(holidaySchema, body);
    return this.repo.setHoliday(i.day, i.name?.trim() || null, i.remove);
  }
  // Phase 2: attendance statement (the database checks HR / Department HR and the range rules again)
  statement(body: unknown): Promise<AttendanceStatement> { return this.repo.statement(parse(attendanceStatementSchema, body) as Record<string, unknown>); }
  statementOptions(): Promise<AttendanceStatementOptions> { return this.repo.statementOptions(); }
  exportPage(body: unknown): Promise<AttendanceExportPage> {
    const i = parse(attendanceExportSchema, body);
    const f = parse(attendanceStatementSchema, { ...i.filters, view: 'DAILY', page: 1, pageSize: 50 }) as Record<string, unknown>;
    return this.repo.exportPage(f, i.type, i.format, i.offset, i.limit);
  }
  exportHistory() { return this.repo.exportHistory(); }
  setBiometricId(body: unknown) {
    const i = parse(biometricIdSchema, body);
    return this.repo.setBiometricId(i.profileId, i.biometricId || null);
  }
  // Phase 3: Telecaller performance (the database decides who sees which Telecaller and who may change targets, the policy, meetings and reports)
  tcList(query: unknown) { return this.repo.tcList(parse(tcListQuerySchema, query ?? {})); }
  tcProfile(profileId: string, query: unknown) { return this.repo.tcProfile(parse(uuidSchema, profileId), parse(tcProfileQuerySchema, query ?? {}).weeks ?? 12); }
  tcTargets() { return this.repo.tcTargets(); }
  tcSetTarget(body: unknown) { return this.repo.tcSetTarget(parse(tcTargetSchema, body)); }
  tcPolicy() { return this.repo.tcPolicy(); }
  tcSetPolicy(body: unknown) { return this.repo.tcSetPolicy(parse(tcPolicySchema, body)); }
  tcRecalculate(id: string, body: unknown) { return this.repo.tcRecalculate(parse(uuidSchema, id), parse(tcRecalcSchema, body).reason); }
  tcSchedule(id: string, body: unknown) {
    const i = parse(tcScheduleSchema, body);
    return this.repo.tcSchedule(parse(uuidSchema, id), i.startsAt ?? null, i.cancel, i.note?.trim() || null);
  }
  tcReport(id: string, body: unknown) { return this.repo.tcReport(parse(uuidSchema, id), parse(tcReportSchema, body)); }
  tcClosePlan(id: string, body: unknown) { return this.repo.tcClosePlan(parse(uuidSchema, id), parse(tcPlanCloseSchema, body).remarks); }
}
