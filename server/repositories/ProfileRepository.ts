import type { SupabaseClient } from '@supabase/supabase-js';
import type { Paginated, Profile, Role } from '../../shared/contracts.js';
import type { UserListQuery } from '../../shared/validation.js';
import { compact, likePattern, pageRange, unwrap, unwrapOne } from './base.js';

const COLUMNS = `id, email, full_name, avatar_url, phone, position, role, is_technical_consultant, default_dashboard, status, status_reason,
  department_id, team_id, approved_at, created_at,
  department:departments!profiles_department_id_fkey(id, slug, name),
  team:teams!profiles_team_in_department(id, name, division)`;

export function mapProfile(row: any): Profile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    phone: row.phone,
    position: row.position,
    role: row.role,
    isTechnicalConsultant: !!row.is_technical_consultant,
    defaultDashboard: row.default_dashboard ?? null,
    status: row.status,
    statusReason: row.status_reason,
    departmentId: row.department_id,
    teamId: row.team_id,
    department: row.department ?? null,
    team: row.team ?? null,
    approvedAt: row.approved_at,
    createdAt: row.created_at
  };
}

export class ProfileRepository {
  constructor(private readonly db: SupabaseClient) {}

  async findById(id: string): Promise<Profile> {
    const row = unwrapOne(await this.db.from('profiles').select(COLUMNS).eq('id', id).maybeSingle(), 'User');
    return mapProfile(row);
  }

  async list(q: UserListQuery): Promise<Paginated<Profile>> {
    let query = this.db.from('profiles').select(COLUMNS, { count: 'exact' });
    if (q.status) query = query.eq('status', q.status);
    if (q.role) query = query.eq('role', q.role);
    if (q.departmentId) query = query.eq('department_id', q.departmentId);
    if (q.teamId) query = query.eq('team_id', q.teamId);
    if (q.search) {
      const p = likePattern(q.search);
      query = query.or(`full_name.ilike.${JSON.stringify(p)},email.ilike.${JSON.stringify(p)}`);
    }
    const { data, error, count } = await query.order('created_at', { ascending: false }).range(...pageRange(q));
    const rows = unwrap({ data, error });
    return { items: rows.map(mapProfile), page: q.page, pageSize: q.pageSize, total: count ?? rows.length };
  }

  async updateSelf(id: string, fields: { fullName?: string; phone?: string | null; position?: string | null; avatarUrl?: string | null }): Promise<Profile> {
    const patch = compact({ full_name: fields.fullName, phone: fields.phone, position: fields.position, avatar_url: fields.avatarUrl });
    const row = unwrapOne(await this.db.from('profiles').update(patch).eq('id', id).select(COLUMNS).maybeSingle(), 'User');
    return mapProfile(row);
  }

  // ---- workflow functions (authorization enforced inside the database) ----
  async assertCanCreate(role: Role, departmentId?: string, teamId?: string): Promise<void> {
    unwrap(await this.db.rpc('assert_can_create_user', { p_role: role, p_department_id: departmentId ?? null, p_team_id: teamId ?? null }));
  }

  async setStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED', reason?: string | null): Promise<void> {
    unwrap(await this.db.rpc('set_user_status', { p_user_id: id, p_status: status, p_reason: reason ?? null }));
  }

  async assign(id: string, role: Role, departmentId?: string, teamId?: string): Promise<void> {
    unwrap(await this.db.rpc('assign_user', { p_user_id: id, p_role: role, p_department_id: departmentId ?? null, p_team_id: teamId ?? null }));
  }

  /** Division of a team the caller can see (null when not visible). */
  async teamDivision(teamId: string): Promise<string | null> {
    const row = unwrap(await this.db.from('teams').select('division').eq('id', teamId).maybeSingle()) as { division: string } | null;
    return row?.division ?? null;
  }

  async setTechnicalConsultant(id: string, value: boolean): Promise<void> {
    unwrap(await this.db.rpc('set_technical_consultant', { p_user_id: id, p_value: value }));
  }

  async delete(id: string): Promise<void> {
    unwrap(await this.db.rpc('delete_user', { p_user_id: id }));
  }
}
