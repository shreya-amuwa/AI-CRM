import type { SupabaseClient } from '@supabase/supabase-js';
import type { HrRecruiter, RecruitmentAgenda, RecruitmentCandidate, RecruitmentDetail, RecruitmentList, RecruitmentOverview, RecruitmentPosition } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** HR recruitment. Every function checks that the caller is HR staff (or the Super Admin) and writes the candidate's history. */
export class RecruitmentRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    return unwrap(await this.db.rpc(name, args)) as T;
  }

  overview() { return this.rpc<RecruitmentOverview>('hr_recruitment_overview'); }
  agenda() { return this.rpc<RecruitmentAgenda>('hr_recruitment_agenda'); }
  positions() { return this.rpc<RecruitmentPosition[]>('hr_positions_list'); }
  recruiters() { return this.rpc<HrRecruiter[]>('hr_recruiters'); }
  list(i: { search?: string; positionId?: string; confirmation?: string; pending?: string; call?: string; ownerKey?: string; limit: number; offset: number }) {
    return this.rpc<RecruitmentList>('hr_recruitment_list', {
      p_search: i.search || null, p_position: i.positionId ?? null, p_confirmation: i.confirmation ?? null, p_pending: i.pending ?? null,
      p_call: i.call ?? null, p_owner: i.ownerKey ?? null, p_limit: i.limit, p_offset: i.offset
    });
  }
  get(id: string) { return this.rpc<RecruitmentDetail>('hr_recruitment_get', { p_id: id }); }
  savePosition(i: { id?: string; title: string; departmentId?: string | null; isOpen: boolean }) {
    return this.rpc<{ id: string; title: string; isOpen: boolean }>('hr_position_save', { p_id: i.id ?? null, p_title: i.title, p_department: i.departmentId ?? null, p_open: i.isOpen });
  }
  saveCandidate(id: string | null, i: { name: string; email: string; phone?: string | null; positionId?: string | null; positionTitle?: string | null; ownerKey?: string | null; source?: string | null; notes?: string | null }) {
    return this.rpc<RecruitmentCandidate>('hr_candidate_save', {
      p_id: id, p_name: i.name, p_email: i.email, p_phone: i.phone ?? null, p_position: i.positionId ?? null, p_position_title: i.positionTitle ?? null, p_owner: i.ownerKey ?? null, p_source: i.source ?? null, p_notes: i.notes ?? null
    });
  }
  addAction(candidate: string, i: { kind: string; title: string; dueDate?: string | null; assigneeKey?: string | null }) {
    return this.rpc<{ id: string }>('hr_candidate_action_add', { p_candidate: candidate, p_kind: i.kind, p_title: i.title, p_due: i.dueDate ?? null, p_assignee: i.assigneeKey ?? null });
  }
  closeAction(action: string, done: boolean, note?: string | null) {
    return this.rpc<{ id: string; status: string }>('hr_candidate_action_close', { p_action: action, p_done: done, p_note: note ?? null });
  }
  scheduleCall(candidate: string, at: string) { return this.rpc<{ id: string }>('hr_candidate_call_schedule', { p_candidate: candidate, p_at: at }); }
  recordCall(candidate: string, i: { callId?: string | null; outcome: string; note?: string | null; followUpDate?: string | null }) {
    return this.rpc<{ id: string }>('hr_candidate_call_record', { p_candidate: candidate, p_call: i.callId ?? null, p_outcome: i.outcome, p_note: i.note ?? null, p_follow_up: i.followUpDate ?? null });
  }
  setConfirmation(candidate: string, i: { status: string; date?: string | null; note?: string | null }) {
    return this.rpc<RecruitmentCandidate>('hr_candidate_confirmation_set', { p_candidate: candidate, p_status: i.status, p_date: i.date ?? null, p_note: i.note ?? null });
  }
}
