import type { SupabaseClient } from '@supabase/supabase-js';
import type { ApprovalRequest, ApprovalStatus, Paginated } from '../../shared/contracts.js';
import { pageRange, unwrap, unwrapOne, type PageRequest } from './base.js';

const COLUMNS = `id, request_type, status, department_id, team_id, decided_by, decided_at, decision_note, created_at,
  subject:profiles!approval_requests_subject_user_id_fkey(id, email, full_name, status, role)`;

function mapRequest(row: any): ApprovalRequest {
  return {
    id: row.id,
    requestType: row.request_type,
    status: row.status,
    subject: row.subject
      ? { id: row.subject.id, email: row.subject.email, fullName: row.subject.full_name, status: row.subject.status, role: row.subject.role }
      : null,
    departmentId: row.department_id,
    teamId: row.team_id,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    createdAt: row.created_at
  };
}

export class ApprovalRepository {
  constructor(private readonly db: SupabaseClient) {}

  /** RLS returns only requests the caller is allowed to decide (or their own). */
  async list(status: ApprovalStatus, page: PageRequest): Promise<Paginated<ApprovalRequest>> {
    const { data, error, count } = await this.db
      .from('approval_requests')
      .select(COLUMNS, { count: 'exact' })
      .eq('status', status)
      .order('created_at', { ascending: false })
      .range(...pageRange(page));
    const rows = unwrap({ data, error });
    return { items: rows.map(mapRequest), ...page, total: count ?? rows.length };
  }

  async findById(id: string): Promise<ApprovalRequest> {
    return mapRequest(unwrapOne(await this.db.from('approval_requests').select(COLUMNS).eq('id', id).maybeSingle(), 'Approval request'));
  }

  async approve(id: string, teamId?: string, note?: string | null): Promise<void> {
    unwrap(await this.db.rpc('approve_registration', { p_request_id: id, p_team_id: teamId ?? null, p_note: note ?? null }));
  }

  async reject(id: string, reason?: string | null): Promise<void> {
    unwrap(await this.db.rpc('reject_registration', { p_request_id: id, p_reason: reason ?? null }));
  }
}
