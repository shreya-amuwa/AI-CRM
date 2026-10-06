import type { Profile, Role, TeamDivision } from '../../../shared/contracts';
import type { AuthUser } from '../../types/crm';

/**
 * Maps the database profile to the legacy `AuthUser` shape the existing
 * dashboards route on. Used for NAVIGATION ONLY — every permission is
 * enforced by the API and database from the profile itself.
 */
export function toAuthUser(profile: Profile): AuthUser {
  const departmentSlug = profile.department?.slug;
  let role: AuthUser['role'];
  switch (profile.role) {
    case 'SUPER_ADMIN':
      role = 'superadmin';
      break;
    case 'DEPARTMENT_HEAD':
      role = departmentSlug === 'hr' ? 'hr' : 'admin';
      break;
    case 'TEAM_HEAD':
      role = 'team-lead';
      break;
    default:
      role = profile.team?.division === 'SUPPORT' ? 'technical-support' : 'team-member';
  }
  return {
    id: profile.id,
    name: profile.fullName,
    email: profile.email,
    avatar: profile.avatarUrl || undefined,
    role,
    departmentId: departmentSlug,
    subDepartment: profile.team?.division === 'SUPPORT' ? 'support' : profile.team?.division === 'SALES' ? 'sales' : undefined,
    position: profile.position || undefined,
    profile
  };
}

/** Roles the given role may create (mirrors private.actor_can_assign_role). */
export function creatableRoles(role: Role | undefined): Exclude<Role, 'SUPER_ADMIN'>[] {
  switch (role) {
    case 'SUPER_ADMIN':
      return ['DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER'];
    case 'DEPARTMENT_HEAD':
      return ['TEAM_HEAD', 'TEAM_MEMBER'];
    case 'TEAM_HEAD':
      return ['TEAM_MEMBER'];
    default:
      return [];
  }
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  DEPARTMENT_HEAD: 'Department Head (Admin)',
  TEAM_HEAD: 'Team Lead',
  TEAM_MEMBER: 'Team Member'
};

/** The dashboard a user lands on after signing in (same rules as toAuthUser). */
export function defaultDashboardLabel(role: Role, division?: TeamDivision | null, departmentName?: string): string {
  const dept = departmentName ? ` · ${departmentName}` : '';
  switch (role) {
    case 'SUPER_ADMIN':
      return 'Super Admin Department Hub';
    case 'DEPARTMENT_HEAD':
      return `Department Admin Dashboard${dept}`;
    case 'TEAM_HEAD':
      return `Team Lead Dashboard${dept}`;
    default:
      return division === 'SUPPORT' ? `Technical Support Dashboard${dept}` : `Sales Team Member Dashboard${dept}`;
  }
}
