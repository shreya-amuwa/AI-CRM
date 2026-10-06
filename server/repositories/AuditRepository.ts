import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditLog, Paginated } from '../../shared/contracts.js';
import { pageRange, unwrap, type PageRequest } from './base.js';

export interface AuditFilter extends PageRequest {
  action?: string;
  entityType?: string;
  entityId?: string;
  departmentId?: string;
  teamId?: string;
}

/** Read-only: audit rows are written exclusively by database triggers/functions. */
export class AuditRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(f: AuditFilter): Promise<Paginated<AuditLog>> {
    let query = this.db
      .from('audit_logs')
      .select('id, actor_id, action, entity_type, entity_id, department_id, team_id, metadata, created_at', { count: 'exact' });
    if (f.action) query = query.eq('action', f.action);
    if (f.entityType) query = query.eq('entity_type', f.entityType);
    if (f.entityId) query = query.eq('entity_id', f.entityId);
    if (f.departmentId) query = query.eq('department_id', f.departmentId);
    if (f.teamId) query = query.eq('team_id', f.teamId);
    const { data, error, count } = await query.order('created_at', { ascending: false }).range(...pageRange(f));
    const rows = unwrap({ data, error });
    return {
      items: rows.map((r: any) => ({
        id: r.id,
        actorId: r.actor_id,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        departmentId: r.department_id,
        teamId: r.team_id,
        metadata: r.metadata ?? {},
        createdAt: r.created_at
      })),
      page: f.page,
      pageSize: f.pageSize,
      total: count ?? rows.length
    };
  }
}
