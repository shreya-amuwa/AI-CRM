import type { Profile } from '../../../shared/contracts';
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
