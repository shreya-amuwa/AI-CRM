import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  FieldVisitAssignedList, FieldVisitLeadList, FieldVisitLeadQueue, FieldVisitLeadRoute, FieldVisitOverview, FieldVisitTelecaller, LeadVisit, LeadVisitList, SalesVisitAssignee,
  TrackingBoard, TrackingTrail, VisitTrackingState
} from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** Field Visit for the Sales employees, and the Sales Department Head's assignments. Who may do what is decided in the database. */
export class FieldVisitRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    return unwrap(await this.db.rpc(name, args)) as T;
  }

  overview() { return this.rpc<FieldVisitOverview>('field_visit_overview'); }
  leads(i: { filter: string; search?: string; sort: string; page: number; pageSize: number }) {
    return this.rpc<FieldVisitLeadList>('field_visit_leads_list', { p_filter: i.filter, p_search: i.search || null, p_sort: i.sort, p_page: i.page, p_page_size: i.pageSize });
  }
  assigned(i: { search?: string; page: number; pageSize: number }) {
    return this.rpc<FieldVisitAssignedList>('field_visit_assigned_list', { p_search: i.search || null, p_page: i.page, p_page_size: i.pageSize });
  }
  list(i: { scope: string; status?: string; leadId?: string; search?: string; page: number; pageSize: number }) {
    return this.rpc<LeadVisitList>('field_visit_list', {
      p_scope: i.scope, p_status: i.status ?? null, p_lead: i.leadId ?? null, p_search: i.search || null, p_page: i.page, p_page_size: i.pageSize
    });
  }
  schedule(i: { leadId: string; visitDate: string; plannedTime?: string | null; address?: string | null; purpose: string; notes?: string | null; clientRequestId?: string; taskId?: string }) {
    return this.rpc<LeadVisit>('field_visit_schedule', {
      p_lead: i.leadId, p_date: i.visitDate, p_time: i.plannedTime ?? null, p_address: i.address ?? null, p_purpose: i.purpose, p_notes: i.notes ?? null,
      p_request: i.clientRequestId ?? null, p_task: i.taskId ?? null
    });
  }
  update(id: string, i: { visitDate: string; plannedTime?: string | null; address?: string | null; purpose: string; notes?: string | null }) {
    return this.rpc<LeadVisit>('field_visit_update', { p_id: id, p_date: i.visitDate, p_time: i.plannedTime ?? null, p_address: i.address ?? null, p_purpose: i.purpose, p_notes: i.notes ?? null });
  }
  start(id: string, i: { latitude?: number | null; longitude?: number | null; accuracyMeters?: number | null; locationNote?: string | null }) {
    return this.rpc<LeadVisit>('field_visit_start', {
      p_id: id, p_lat: i.latitude ?? null, p_lng: i.longitude ?? null, p_accuracy: i.accuracyMeters ?? null, p_location_note: i.locationNote ?? null
    });
  }
  complete(id: string, i: { status: string; outcome: string; notes?: string | null; requirements?: string | null; nextSteps?: string | null; followUpDate?: string | null }) {
    return this.rpc<LeadVisit>('field_visit_complete', {
      p_id: id, p_status: i.status, p_outcome: i.outcome, p_notes: i.notes ?? null, p_requirements: i.requirements ?? null, p_next_steps: i.nextSteps ?? null, p_follow_up: i.followUpDate ?? null
    });
  }
  cancel(id: string, reason?: string | null) { return this.rpc<LeadVisit>('field_visit_cancel', { p_id: id, p_reason: reason ?? null }); }

  assignees() { return this.rpc<SalesVisitAssignee[]>('sales_visit_assignees'); }
  assign(i: { leadId: string; assigneeId: string; priority: string; instructions?: string | null }) {
    return this.rpc<{ id: string; leadId: string; assignee: string; reassigned: boolean }>('sales_visit_assign', {
      p_lead: i.leadId, p_assignee: i.assigneeId, p_priority: i.priority, p_instructions: i.instructions ?? null
    });
  }
  cancelAssignment(leadId: string) { return this.rpc<{ id: string; leadId: string }>('sales_visit_assignment_cancel', { p_lead: leadId }); }

  // live location of a visit in progress (the employee), and the board / trail (the people allowed to track them)
  trackingStart(id: string, p: { latitude: number; longitude: number; accuracyMeters: number; recordedAt: string }) {
    return this.rpc<VisitTrackingState>('field_visit_tracking_start', { p_id: id, p_lat: p.latitude, p_lng: p.longitude, p_accuracy: p.accuracyMeters, p_at: p.recordedAt });
  }
  trackingPoints(id: string, points: { latitude: number; longitude: number; accuracyMeters: number; recordedAt: string }[]) {
    return this.rpc<VisitTrackingState>('field_visit_tracking_points', { p_id: id, p_points: points });
  }
  trackingIssue(id: string, issue: string) { return this.rpc<VisitTrackingState>('field_visit_tracking_issue', { p_id: id, p_issue: issue }); }
  trackingStop(id: string) { return this.rpc<VisitTrackingState>('field_visit_tracking_stop', { p_id: id }); }
  trackingBoard(date?: string) { return this.rpc<TrackingBoard>('field_visit_tracking_board', { p_date: date ?? null }); }
  trackingTrail(id: string) { return this.rpc<TrackingTrail>('field_visit_tracking_trail', { p_id: id }); }

  // Field Visit leads waiting for the Sales Department Head, and the assignment to a Telecaller
  leadQueue(i: { status: string; search?: string; page: number; pageSize: number }) {
    return this.rpc<FieldVisitLeadQueue>('field_visit_lead_queue', { p_status: i.status, p_search: i.search || null, p_page: i.page, p_page_size: i.pageSize });
  }
  leadTelecallers(leadId: string) { return this.rpc<FieldVisitTelecaller[]>('field_visit_lead_telecallers', { p_lead: leadId }); }
  leadAssign(leadId: string, i: { telecallerId: string; note?: string | null }) {
    return this.rpc<FieldVisitLeadRoute>('field_visit_lead_assign', { p_lead: leadId, p_telecaller: i.telecallerId, p_note: i.note ?? null });
  }
}
