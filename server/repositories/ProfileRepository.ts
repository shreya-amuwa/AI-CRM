import type { SupabaseClient } from '@supabase/supabase-js';
import type { DepartmentAccessInfo, DepartmentHeadAccess, HeadDivision, MyDepartmentScopes, Paginated, Profile, Role } from '../../shared/contracts.js';
import type { UserListQuery } from '../../shared/validation.js';
import { compact, likePattern, pageRange, unwrap, unwrapOne } from './base.js';

const COLUMNS = `id, email, full_name, avatar_url, phone, position, role, is_technical_consultant, sales_sub_role, head_division, default_dashboard, status, status_reason,
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
    salesSubRole: row.sales_sub_role ?? null,
    headDivision: row.head_division ?? null,
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
    if (q.departmentId) {
      // "Whole department": the people placed here AND the Department Heads who work here without being placed here (shared heads, and a
      // head given another department or function). Heads belong to no team, so a team / function filter keeps its meaning and skips them.
      const withHeads = !q.teamId && !q.division && (!q.role || q.role === 'DEPARTMENT_HEAD');
      const sharedIds = withHeads ? await this.departmentHeadIds(q.departmentId) : [];
      query = sharedIds.length ? query.or(`department_id.eq.${q.departmentId},id.in.(${sharedIds.join(',')})`) : query.eq('department_id', q.departmentId);
    }
    if (q.teamId) query = query.eq('team_id', q.teamId);
    if (q.division && q.departmentId) {
      const teams = unwrap(await this.db.from('teams').select('id').eq('department_id', q.departmentId).eq('division', q.division)) as { id: string }[];
      if (!teams.length) return { items: [], page: q.page, pageSize: q.pageSize, total: 0 };
      query = query.in('team_id', teams.map(t => t.id));
    }
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
  async assertCanCreate(role: Role, departmentId?: string, teamId?: string, headDivision?: HeadDivision): Promise<void> {
    unwrap(await this.db.rpc('assert_can_create_user', {
      p_role: role,
      p_department_id: departmentId ?? null,
      p_team_id: teamId ?? null,
      p_head_division: headDivision ?? null
    }));
  }

  async myDepartmentScopes(): Promise<MyDepartmentScopes> {
    return unwrap(await this.db.rpc('my_department_scopes')) as MyDepartmentScopes;
  }

  async departmentAccess(id: string): Promise<DepartmentAccessInfo> {
    return unwrap(await this.db.rpc('department_access_get', { p_profile: id })) as DepartmentAccessInfo;
  }

  async setDepartmentAccess(id: string, departmentId: string, division: HeadDivision, granted: boolean): Promise<DepartmentAccessInfo> {
    return unwrap(await this.db.rpc('department_access_set', { p_profile: id, p_department: departmentId, p_division: division, p_granted: granted })) as DepartmentAccessInfo;
  }

  /** Ids of the Department Heads who work in a department (own or authorised); the database returns [] to anyone who may not see them. */
  async departmentHeadIds(departmentId: string): Promise<string[]> {
    const rows = unwrap(await this.db.rpc('department_heads_overview', { p_department: departmentId })) as { profileId: string }[];
    return rows.map(r => r.profileId).filter(id => /^[0-9a-f-]{36}$/i.test(id));
  }

  /** Save the whole matrix of a head's extra (department, function) pairs in one step. */
  async applyDepartmentAccess(id: string, pairs: { departmentId: string; division: HeadDivision }[]): Promise<DepartmentAccessInfo> {
    return unwrap(await this.db.rpc('department_access_apply', { p_profile: id, p_pairs: pairs })) as DepartmentAccessInfo;
  }

  /** The (department, function) pairs the database would refuse, with the reason ([] = all fine). */
  async checkDepartmentAccess(pairs: { departmentId: string; division: HeadDivision }[]): Promise<{ departmentId: string; division: string; problem: string }[]> {
    return unwrap(await this.db.rpc('department_access_check', { p_pairs: pairs })) as { departmentId: string; division: string; problem: string }[];
  }

  /** Department Heads who work in a department (own or authorised) with all their departments. */
  async departmentHeads(departmentId: string): Promise<DepartmentHeadAccess[]> {
    const rows = unwrap(await this.db.rpc('department_heads_overview', { p_department: departmentId })) as { profileId: string; access: DepartmentHeadAccess['access'] }[];
    if (!rows.length) return [];
    const profiles = unwrap(await this.db.from('profiles').select(COLUMNS).in('id', rows.map(r => r.profileId))) as any[];
    const byId = new Map(profiles.map(p => [p.id, mapProfile(p)]));
    return rows.filter(r => byId.has(r.profileId)).map(r => ({ profile: byId.get(r.profileId)!, access: r.access ?? [] }));
  }

  async setHeadDivision(id: string, division: HeadDivision | null): Promise<void> {
    unwrap(await this.db.rpc('set_head_division', { p_profile: id, p_division: division }));
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

  async setSalesSubRole(id: string, role: string | null): Promise<void> {
    unwrap(await this.db.rpc('set_sales_sub_role', { p_profile: id, p_role: role }));
  }

  async delete(id: string): Promise<void> {
    unwrap(await this.db.rpc('delete_user', { p_user_id: id }));
  }
}
