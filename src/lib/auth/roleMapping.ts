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
      // Only Technical Consultants open the client-onboarding dashboard; other
      // support team members get the normal team member dashboard.
      role = isTechnicalConsultant(profile) ? 'technical-support' : 'team-member';
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

/** A support team member created (or marked) as Technical Consultant. */
export function isTechnicalConsultant(p: Pick<Profile, 'role' | 'isTechnicalConsultant' | 'team'>): boolean {
  return p.role === 'TEAM_MEMBER' && !!p.isTechnicalConsultant && p.team?.division === 'SUPPORT';
}

/** Label for a profile's role, with Technical Consultant shown as its own role. */
export function staffRoleLabel(p: Pick<Profile, 'role' | 'isTechnicalConsultant' | 'team'>): string {
  return isTechnicalConsultant(p) ? TECHNICAL_CONSULTANT_LABEL : ROLE_LABELS[p.role];
}

export const TECHNICAL_CONSULTANT_LABEL = 'Technical Consultant';

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
export function defaultDashboardLabel(
  role: Role,
  division?: TeamDivision | null,
  departmentName?: string,
  technicalConsultant = false
): string {
  const dept = departmentName ? ` · ${departmentName}` : '';
  switch (role) {
    case 'SUPER_ADMIN':
      return 'Super Admin Department Hub';
    case 'DEPARTMENT_HEAD':
      return `Department Admin Dashboard${dept}`;
    case 'TEAM_HEAD':
      return `Team Lead Dashboard${dept}`;
    default:
      if (technicalConsultant && division === 'SUPPORT') return `Technical Consultant Dashboard${dept}`;
      return division === 'SUPPORT' ? `Support Team Member Dashboard${dept}` : `Sales Team Member Dashboard${dept}`;
  }
}
