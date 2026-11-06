import type {
  FieldVisitAssignedList, FieldVisitLeadList, FieldVisitLeadQueue, FieldVisitLeadRoute, FieldVisitOverview, FieldVisitTelecaller, LeadVisit, LeadVisitList, SalesVisitAssignee,
  TrackingBoard, TrackingTrail, VisitTrackingState
} from '../../shared/contracts.js';
import {
  fieldVisitAssignedQuerySchema, fieldVisitCancelSchema, fieldVisitCompleteSchema, fieldVisitLeadsQuerySchema, fieldVisitListQuerySchema, fieldVisitScheduleSchema,
  fieldVisitStartSchema, fieldVisitUpdateSchema, salesVisitAssignSchema, uuidSchema,
  fieldVisitLeadAssignSchema, fieldVisitLeadQueueQuerySchema, fieldVisitTrackingBoardQuerySchema, fieldVisitTrackingIssueSchema,
  fieldVisitTrackingPointsSchema, fieldVisitTrackingStartSchema
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

  trackingStart(id: string, body: unknown): Promise<VisitTrackingState> { return this.repo.trackingStart(parse(uuidSchema, id), parse(fieldVisitTrackingStartSchema, body)); }
  trackingPoints(id: string, body: unknown): Promise<VisitTrackingState> { return this.repo.trackingPoints(parse(uuidSchema, id), parse(fieldVisitTrackingPointsSchema, body).points); }
  trackingIssue(id: string, body: unknown): Promise<VisitTrackingState> { return this.repo.trackingIssue(parse(uuidSchema, id), parse(fieldVisitTrackingIssueSchema, body).issue); }
  trackingStop(id: string): Promise<VisitTrackingState> { return this.repo.trackingStop(parse(uuidSchema, id)); }
  trackingBoard(query: unknown): Promise<TrackingBoard> { return this.repo.trackingBoard(parse(fieldVisitTrackingBoardQuerySchema, query).date); }
  trackingTrail(id: string): Promise<TrackingTrail> { return this.repo.trackingTrail(parse(uuidSchema, id)); }

  leadQueue(query: unknown): Promise<FieldVisitLeadQueue> { return this.repo.leadQueue(parse(fieldVisitLeadQueueQuerySchema, query)); }
  leadTelecallers(leadId: string): Promise<FieldVisitTelecaller[]> { return this.repo.leadTelecallers(parse(uuidSchema, leadId)); }
  leadAssign(leadId: string, body: unknown): Promise<FieldVisitLeadRoute> { return this.repo.leadAssign(parse(uuidSchema, leadId), parse(fieldVisitLeadAssignSchema, body)); }
}
