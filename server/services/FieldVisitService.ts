import type { FieldVisitAssignedList, FieldVisitLeadList, FieldVisitOverview, LeadVisit, LeadVisitList, SalesVisitAssignee } from '../../shared/contracts.js';
import {
  fieldVisitAssignedQuerySchema, fieldVisitCancelSchema, fieldVisitCompleteSchema, fieldVisitLeadsQuerySchema, fieldVisitListQuerySchema, fieldVisitScheduleSchema,
  fieldVisitStartSchema, fieldVisitUpdateSchema, salesVisitAssignSchema, uuidSchema
} from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { FieldVisitRepository } from '../repositories/FieldVisitRepository.js';

export class FieldVisitService {
  constructor(private readonly repo: FieldVisitRepository) {}

  overview(): Promise<FieldVisitOverview> { return this.repo.overview(); }
  leads(query: unknown): Promise<FieldVisitLeadList> { return this.repo.leads(parse(fieldVisitLeadsQuerySchema, query)); }
  assigned(query: unknown): Promise<FieldVisitAssignedList> { return this.repo.assigned(parse(fieldVisitAssignedQuerySchema, query)); }
  list(query: unknown): Promise<LeadVisitList> { return this.repo.list(parse(fieldVisitListQuerySchema, query)); }
  schedule(body: unknown): Promise<LeadVisit> { return this.repo.schedule(parse(fieldVisitScheduleSchema, body)); }
  update(id: string, body: unknown): Promise<LeadVisit> { return this.repo.update(parse(uuidSchema, id), parse(fieldVisitUpdateSchema, body)); }
  start(id: string, body: unknown): Promise<LeadVisit> { return this.repo.start(parse(uuidSchema, id), parse(fieldVisitStartSchema, body ?? {})); }
  complete(id: string, body: unknown): Promise<LeadVisit> { return this.repo.complete(parse(uuidSchema, id), parse(fieldVisitCompleteSchema, body)); }
  cancel(id: string, body: unknown): Promise<LeadVisit> { return this.repo.cancel(parse(uuidSchema, id), parse(fieldVisitCancelSchema, body ?? {}).reason); }

  assignees(): Promise<SalesVisitAssignee[]> { return this.repo.assignees(); }
  assign(body: unknown) { return this.repo.assign(parse(salesVisitAssignSchema, body)); }
  cancelAssignment(leadId: string) { return this.repo.cancelAssignment(parse(uuidSchema, leadId)); }
}
