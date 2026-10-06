import type { SupabaseClient } from '@supabase/supabase-js';
import type { Department, Team, TeamDivision } from '../../shared/contracts.js';
import { AppError } from '../http/errors.js';
import { compact, unwrap, unwrapOne } from './base.js';

const DEPARTMENT_COLUMNS = 'id, slug, name, description, category, icon_name, accent_color, logo_url, is_locked, created_at';
const TEAM_COLUMNS = 'id, department_id, name, division, created_at';

function mapDepartment(row: any): Department {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    iconName: row.icon_name,
    accentColor: row.accent_color,
    logoUrl: row.logo_url,
    isLocked: row.is_locked,
    createdAt: row.created_at
  };
}

function mapTeam(row: any): Team {
  return { id: row.id, departmentId: row.department_id, name: row.name, division: row.division, createdAt: row.created_at };
}

export interface DepartmentWrite {
  slug?: string;
  name?: string;
  description?: string;
  category?: string | null;
  iconName?: string;
  accentColor?: string;
  logoUrl?: string | null;
  isLocked?: boolean;
}

function departmentRow(d: DepartmentWrite) {
  return compact({
    slug: d.slug,
    name: d.name,
    description: d.description,
    category: d.category,
    icon_name: d.iconName,
    accent_color: d.accentColor,
    logo_url: d.logoUrl,
    is_locked: d.isLocked
  });
}

export class OrganizationRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listDepartments(): Promise<Department[]> {
    return unwrap(await this.db.from('departments').select(DEPARTMENT_COLUMNS).order('created_at').order('name')).map(mapDepartment);
  }

  async createDepartment(d: DepartmentWrite): Promise<Department> {
    return mapDepartment(unwrap(await this.db.from('departments').insert(departmentRow(d)).select(DEPARTMENT_COLUMNS).single()));
  }

  async updateDepartment(id: string, d: DepartmentWrite): Promise<Department> {
    return mapDepartment(
      unwrapOne(await this.db.from('departments').update(departmentRow(d)).eq('id', id).select(DEPARTMENT_COLUMNS).maybeSingle(), 'Department')
    );
  }

  async deleteDepartment(id: string): Promise<void> {
    const rows = unwrap(await this.db.from('departments').delete().eq('id', id).select('id'));
    if (!rows.length) throw new AppError('NOT_FOUND', 'Department not found.');
  }

  async listTeams(departmentId?: string): Promise<Team[]> {
    let query = this.db.from('teams').select(TEAM_COLUMNS);
    if (departmentId) query = query.eq('department_id', departmentId);
    return unwrap(await query.order('name')).map(mapTeam);
  }

  async findTeam(id: string): Promise<Team> {
    return mapTeam(unwrapOne(await this.db.from('teams').select(TEAM_COLUMNS).eq('id', id).maybeSingle(), 'Team'));
  }

  async createTeam(t: { departmentId: string; name: string; division: TeamDivision }): Promise<Team> {
    return mapTeam(
      unwrap(await this.db.from('teams').insert({ department_id: t.departmentId, name: t.name, division: t.division }).select(TEAM_COLUMNS).single())
    );
  }

  async updateTeam(id: string, t: { name?: string; division?: TeamDivision }): Promise<Team> {
    return mapTeam(unwrapOne(await this.db.from('teams').update(compact(t)).eq('id', id).select(TEAM_COLUMNS).maybeSingle(), 'Team'));
  }

  async deleteTeam(id: string): Promise<void> {
    const rows = unwrap(await this.db.from('teams').delete().eq('id', id).select('id'));
    if (!rows.length) throw new AppError('NOT_FOUND', 'Team not found.');
  }
}
