import type {
  AiStudioAssignees, AiStudioDailyContext, AiStudioDeadlines, AiStudioOverview, AiStudioPerson, AiStudioProject, AiStudioReportContext, AiStudioReportDetail, AiStudioReportPage, AiStudioTask,
  AiStudioTaskDetail, AiStudioTaskPage
} from '../../shared/contracts.js';
import {
  aiStudioAssignLeadSchema, aiStudioDailyContextQuerySchema, aiStudioDailyReportSchema, aiStudioProjectAssignSchema, aiStudioReportLeadEditSchema, aiStudioProjectSchema, aiStudioSetLeadSchema, aiStudioReportReviewSchema, aiStudioReportSchema, aiStudioReportsQuerySchema, aiStudioTaskCreateSchema,
  aiStudioTaskEditSchema, aiStudioTasksQuerySchema, aiStudioTaskUpdateSchema, uuidSchema
} from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { AiStudioRepository } from '../repositories/AiStudioRepository.js';

/**
 * AI Studio. The browser sends what a person types (a project, a task, a report, a decision) and nothing about who they are: the database works the
 * role, the Team Lead and the reviewer out from the login and refuses what is not theirs. The same schemas validate the forms.
 */
export class AiStudioService {
  constructor(private readonly repo: AiStudioRepository) {}

  overview(): Promise<AiStudioOverview> { return this.repo.overview(); }
  people(): Promise<AiStudioPerson[]> { return this.repo.people(); }

  projects(): Promise<AiStudioProject[]> { return this.repo.projects(); }
  deadlines(): Promise<AiStudioDeadlines> { return this.repo.deadlines(); }
  createProject(body: unknown) { return this.repo.saveProject(null, parse(aiStudioProjectSchema, body)); }
  updateProject(id: string, body: unknown) { return this.repo.saveProject(parse(uuidSchema, id), parse(aiStudioProjectSchema, body)); }
  assignProject(projectId: string, body: unknown) {
    const { profileId, assign } = parse(aiStudioProjectAssignSchema, body);
    return this.repo.assignProject(parse(uuidSchema, projectId), profileId, assign);
  }

  assignLead(body: unknown) { const { memberIds, leadId } = parse(aiStudioAssignLeadSchema, body); return this.repo.assignLead(memberIds, leadId); }
  setLead(memberId: string, body: unknown) { return this.repo.setLead(parse(uuidSchema, memberId), parse(aiStudioSetLeadSchema, body).leadId); }

  tasks(query: unknown): Promise<AiStudioTaskPage> { return this.repo.tasks(parse(aiStudioTasksQuerySchema, query)); }
  task(id: string): Promise<AiStudioTaskDetail> { return this.repo.task(parse(uuidSchema, id)); }
  assignTask(body: unknown): Promise<AiStudioTask> { return this.repo.assignTask(parse(aiStudioTaskCreateSchema, body)); }
  editTask(id: string, body: unknown): Promise<AiStudioTask> { return this.repo.editTask(parse(uuidSchema, id), parse(aiStudioTaskEditSchema, body)); }
  updateTask(id: string, body: unknown): Promise<AiStudioTask> { return this.repo.updateTask(parse(uuidSchema, id), parse(aiStudioTaskUpdateSchema, body)); }

  reportContext(): Promise<AiStudioReportContext> { return this.repo.reportContext(); }
  reports(query: unknown): Promise<AiStudioReportPage> { return this.repo.reports(parse(aiStudioReportsQuerySchema, query)); }
  report(id: string): Promise<AiStudioReportDetail> { return this.repo.report(parse(uuidSchema, id)); }
  createReport(body: unknown): Promise<AiStudioReportDetail> { return this.repo.saveReport(null, parse(aiStudioReportSchema, body)); }
  updateReport(id: string, body: unknown): Promise<AiStudioReportDetail> { return this.repo.saveReport(parse(uuidSchema, id), parse(aiStudioReportSchema, body)); }
  deleteDraft(id: string) { return this.repo.deleteDraft(parse(uuidSchema, id)); }
  reviewReport(id: string, body: unknown): Promise<AiStudioReportDetail> {
    const { decision, comment } = parse(aiStudioReportReviewSchema, body);
    return this.repo.reviewReport(parse(uuidSchema, id), decision, comment);
  }
  /** Who a task of this project can go to: the database works out the team, the assignment type and who is eligible (20270218000100). */
  assignees(projectId: string): Promise<AiStudioAssignees> { return this.repo.assignees(parse(uuidSchema, projectId)); }
  /** The day's report form: the tasks the person may report on, the report already started, the attendance hours (to warn only). */
  dailyContext(query: unknown): Promise<AiStudioDailyContext> { return this.repo.dailyContext(parse(aiStudioDailyContextQuerySchema, query ?? {}).date); }
  /** Save or submit the day's report (one per person and day, one entry per task); the database checks every task and writes it all or nothing. */
  saveDailyReport(body: unknown): Promise<AiStudioReportDetail> { return this.repo.saveDailyReport(parse(aiStudioDailyReportSchema, body)); }
  /** The Team Lead corrects a report waiting for their approval (the database checks that the caller is that reviewer). */
  leadEditReport(id: string, body: unknown): Promise<AiStudioReportDetail> { return this.repo.leadEditReport(parse(uuidSchema, id), parse(aiStudioReportLeadEditSchema, body)); }
}
