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
      // Department decides the dashboard: Support Team Leads have their own
      // dashboard; Sales (and other) Team Leads keep the Sales Team Lead one.
      role = isSupportLead(profile) ? 'support-lead' : 'team-lead';
      break;
    default:
      // Technical Consultants open the client-onboarding dashboard; other Support
      // team members open the Support dashboard; everyone else the team member
      // dashboard (Sales and other teams).
      role = isTechnicalConsultant(profile) ? 'technical-support' : isSupportMember(profile) ? 'support-member' : 'team-member';
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

/**
 * A Team Lead of a Support team. The stored default dashboard (resolved by the
 * database from role + team division) wins; the team division is the fallback.
 */
export function isSupportLead(p: Pick<Profile, 'role' | 'team' | 'defaultDashboard'>): boolean {
  if (p.role !== 'TEAM_HEAD') return false;
  if (p.defaultDashboard === 'support-lead') return true;
  if (p.defaultDashboard === 'sales-lead') return false;
  // Older stored value ('team-lead', before the per-department mapping) or none.
  return p.team?.division === 'SUPPORT';
}

/** A team member of a Support team who is not a Technical Consultant. */
export function isSupportMember(p: Pick<Profile, 'role' | 'isTechnicalConsultant' | 'team'>): boolean {
  return p.role === 'TEAM_MEMBER' && p.team?.division === 'SUPPORT' && !isTechnicalConsultant(p);
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
  DEPARTMENT_HEAD: 'Department Head',
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
      return `Department Head Dashboard${dept}`;
    case 'TEAM_HEAD':
      if (division === 'SUPPORT') return `Support Team Lead Dashboard${dept}`;
      if (division === 'SALES') return `Sales Team Lead Dashboard${dept}`;
      return `Team Lead Dashboard${dept}`;
    default:
      if (technicalConsultant && division === 'SUPPORT') return `Technical Consultant Dashboard${dept}`;
      // Only a Sales team opens as "Sales"; other teams get the plain label.
      if (division === 'SALES') return `Sales Team Member Dashboard${dept}`;
      if (division === 'SUPPORT') return `Support Team Member Dashboard${dept}`;
      return `Team Member Dashboard${dept}`;
  }
}

/** Title shown under a team member's name: their position, else their team's role. */
export function memberTitle(user: { position?: string; subDepartment?: string } | null | undefined): string {
  if (user?.position) return user.position;
  if (user?.subDepartment === 'sales') return 'Sales Team Member';
  if (user?.subDepartment === 'support') return 'Support Team Member';
  return ROLE_LABELS.TEAM_MEMBER;
}
