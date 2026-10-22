import type { HrRecruiter, RecruitmentAgenda, RecruitmentCandidate, RecruitmentDetail, RecruitmentList, RecruitmentOverview, RecruitmentPosition } from '../../shared/contracts.js';
import {
  recruitmentActionCloseSchema, recruitmentActionSchema, recruitmentCallRecordSchema, recruitmentCallScheduleSchema, recruitmentCandidateSchema,
  recruitmentConfirmationSchema, recruitmentListQuerySchema, recruitmentPositionSchema, uuidSchema
} from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { RecruitmentRepository } from '../repositories/RecruitmentRepository.js';

/** HR recruitment: candidates, what is pending, calls and confirmation. Who may use it is decided by the database (HR staff and the Super Admin). */
export class RecruitmentService {
  constructor(private readonly repo: RecruitmentRepository) {}

  overview(): Promise<RecruitmentOverview> { return this.repo.overview(); }
  agenda(): Promise<RecruitmentAgenda> { return this.repo.agenda(); }
  positions(): Promise<RecruitmentPosition[]> { return this.repo.positions(); }
  recruiters(): Promise<HrRecruiter[]> { return this.repo.recruiters(); }
  list(query: unknown): Promise<RecruitmentList> { return this.repo.list(parse(recruitmentListQuerySchema, query)); }
  get(id: string): Promise<RecruitmentDetail> { return this.repo.get(parse(uuidSchema, id)); }
  savePosition(body: unknown) { return this.repo.savePosition(parse(recruitmentPositionSchema, body)); }
  createCandidate(body: unknown): Promise<RecruitmentCandidate> { return this.repo.saveCandidate(null, parse(recruitmentCandidateSchema, body)); }
  updateCandidate(id: string, body: unknown): Promise<RecruitmentCandidate> { return this.repo.saveCandidate(parse(uuidSchema, id), parse(recruitmentCandidateSchema, body)); }
  addAction(id: string, body: unknown) { return this.repo.addAction(parse(uuidSchema, id), parse(recruitmentActionSchema, body)); }
  closeAction(id: string, body: unknown) {
    const i = parse(recruitmentActionCloseSchema, body);
    return this.repo.closeAction(parse(uuidSchema, id), i.done, i.note);
  }
  scheduleCall(id: string, body: unknown) { return this.repo.scheduleCall(parse(uuidSchema, id), parse(recruitmentCallScheduleSchema, body).at); }
  recordCall(id: string, body: unknown) { return this.repo.recordCall(parse(uuidSchema, id), parse(recruitmentCallRecordSchema, body)); }
  setConfirmation(id: string, body: unknown): Promise<RecruitmentCandidate> { return this.repo.setConfirmation(parse(uuidSchema, id), parse(recruitmentConfirmationSchema, body)); }
}
