import type {
  RecruiterApplicationDetail, RecruiterApplicationPage, RecruiterCall, RecruiterCallLists, RecruiterContext, RecruiterDecisionListItem, RecruiterDecisionResult,
  RecruiterFilterOptions, RecruiterInterview, RecruiterInterviewListItem, RecruiterOverview, RecruiterPerson, RecruiterPipeline, RecruiterReports,
  RecruiterVacancy, RecruiterVacancyDetail, RecruitmentEmailRecord
} from '../../shared/contracts.js';
import {
  recruiterCallSchema, recruiterDecisionCorrectionSchema, recruiterDecisionSchema, recruiterDecisionsQuerySchema, recruiterFiltersSchema,
  recruiterInterviewSchema, recruiterInviteSchema, recruiterNoteSchema, recruiterPipelineQuerySchema, recruiterStageSchema, recruiterVacanciesQuerySchema,
  recruiterVacancyAssignSchema, recruiterVacancySaveSchema, recruiterVacancyStatusSchema, recruitmentEmailAdminQuerySchema, uuidSchema
} from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import type { RecruiterRepository } from './RecruiterRepository.js';

/** Validates with the same schemas the forms use; the database decides who may do what from the caller's own login. */
export class RecruiterService {
  constructor(private readonly repo: RecruiterRepository) {}

  context(): Promise<RecruiterContext> { return this.repo.context(); }
  directory(): Promise<RecruiterPerson[]> { return this.repo.directory(); }
  filterOptions(): Promise<RecruiterFilterOptions> { return this.repo.filterOptions(); }
  overview(query: unknown): Promise<RecruiterOverview> {
    const { page: _page, pageSize: _size, ...filters } = parse(recruiterFiltersSchema, query ?? {});
    return this.repo.overview(filters);
  }
  vacancies(query: unknown): Promise<RecruiterVacancy[]> {
    const q = parse(recruiterVacanciesQuerySchema, query ?? {});
    return this.repo.vacancies(q.status, q.department);
  }
  /** Create (no id) or edit a vacancy. The deadline is the end of the chosen day in India time. */
  saveVacancy(id: string | null, body: unknown): Promise<RecruiterVacancy> {
    const b = parse(recruiterVacancySaveSchema, body);
    if (id && b.version === undefined) throw new AppError('VALIDATION_ERROR', 'Reload the vacancy before saving.');
    return this.repo.saveVacancy({ ...b, id: id ? parse(uuidSchema, id) : undefined, closesAt: b.closesAt ? `${b.closesAt}T23:59:59+05:30` : undefined });
  }
  vacancy(id: string): Promise<RecruiterVacancyDetail> { return this.repo.vacancy(parse(uuidSchema, id)); }
  assignVacancy(id: string, body: unknown): Promise<RecruiterVacancy> { return this.repo.assignVacancy(parse(uuidSchema, id), parse(recruiterVacancyAssignSchema, body).recruiter); }
  vacancyStatus(id: string, body: unknown): Promise<RecruiterVacancy> {
    const b = parse(recruiterVacancyStatusSchema, body);
    return this.repo.vacancyStatus(parse(uuidSchema, id), b.status, b.note);
  }
  applications(query: unknown): Promise<RecruiterApplicationPage> { return this.repo.applications(parse(recruiterFiltersSchema, query ?? {})); }
  pipeline(query: unknown): Promise<RecruiterPipeline> { return this.repo.pipeline(parse(recruiterPipelineQuerySchema, query ?? {}).posting); }
  application(id: string): Promise<RecruiterApplicationDetail> { return this.repo.application(parse(uuidSchema, id)); }
  addNote(id: string, body: unknown) {
    const b = parse(recruiterNoteSchema, body);
    return this.repo.addNote(parse(uuidSchema, id), b.kind, b.body);
  }
  stage(id: string, body: unknown) {
    const b = parse(recruiterStageSchema, body);
    return this.repo.stage(parse(uuidSchema, id), b.action, b.comment);
  }
  tests() { return this.repo.tests(); }
  invite(id: string, body: unknown) {
    const b = parse(recruiterInviteSchema, body);
    return this.repo.invite(parse(uuidSchema, id), b.testId, b.until);
  }
  calls(): Promise<RecruiterCallLists> { return this.repo.calls(); }
  saveCall(id: string, body: unknown): Promise<RecruiterCall> { return this.repo.saveCall(parse(uuidSchema, id), parse(recruiterCallSchema, body)); }
  interviews(): Promise<{ items: RecruiterInterviewListItem[] }> { return this.repo.interviews(); }
  saveInterview(id: string, body: unknown): Promise<RecruiterInterview> { return this.repo.saveInterview(parse(uuidSchema, id), parse(recruiterInterviewSchema, body)); }
  decide(id: string, body: unknown): Promise<RecruiterDecisionResult> {
    const b = parse(recruiterDecisionSchema, body);
    return this.repo.decide(parse(uuidSchema, id), b.decision, b.category, b.reason);
  }
  correctDecision(id: string, body: unknown): Promise<RecruiterDecisionResult> {
    const b = parse(recruiterDecisionCorrectionSchema, body);
    return this.repo.correctDecision(parse(uuidSchema, id), b.decision, b.reason);
  }
  decisions(query: unknown): Promise<RecruiterDecisionListItem[]> { return this.repo.decisions(parse(recruiterDecisionsQuerySchema, query ?? {}).view); }
  reports(query: unknown): Promise<RecruiterReports> {
    const { page: _page, pageSize: _size, ...filters } = parse(recruiterFiltersSchema, query ?? {});
    return this.repo.reports(filters);
  }
  emailRecords(query: unknown): Promise<RecruitmentEmailRecord[]> {
    const q = parse(recruitmentEmailAdminQuerySchema, query ?? {});
    return this.repo.emailRecords(q.status, q.limit);
  }
  emailRequeue(id: string) { return this.repo.emailRequeue(parse(uuidSchema, id)); }
}
