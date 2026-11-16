import { SALES_SUB_ROLE_LABELS, type HeadDivision, type Profile, type Role, type SalesSubRole, type TeamDivision } from '../../../shared/contracts';
import type { AuthUser } from '../../types/crm';

/**
 * Maps the database profile to the legacy `AuthUser` shape the existing
 * dashboards route on. Used for NAVIGATION ONLY - every permission is
 * enforced by the API and database from the profile itself.
 */
export function toAuthUser(profile: Profile): AuthUser {
  const departmentSlug = profile.department?.slug;
  let role: AuthUser['role'];
  // An HR Recruiter opens the recruiter dashboard, never the HR Assistant's one (the database refuses them the HR Assistant's data as well).
  if (isHrRecruiter(profile)) {
    return {
      id: profile.id, name: profile.fullName, email: profile.email, avatar: profile.avatarUrl || undefined, role: 'hr-recruiter',
      departmentId: departmentSlug, position: profile.position || undefined, profile
    };
  }
  // AI Studio: the Department Head, the Team Leads and the Team Members of the department open the AI Studio dashboard (which of the three is decided by the
  // role in the profile, and every permission by the database)
  if (isAiStudioStaff(profile)) {
    return {
      id: profile.id, name: profile.fullName, email: profile.email, avatar: profile.avatarUrl || undefined, role: 'ai-studio',
      departmentId: departmentSlug, position: profile.position || undefined, profile
    };
  }
  switch (profile.role) {
    case 'SUPER_ADMIN':
      role = 'superadmin';
      break;
    case 'DEPARTMENT_HEAD':
      // The Department Head of the Sales side has their own dashboard; every other Department Head keeps the shared one.
      role = departmentSlug === 'hr' ? 'hr' : isSalesHead(profile) ? 'sales-head' : 'admin';
      break;
    case 'TEAM_HEAD':
      if (isAccountsStaff(profile)) {
        role = 'accounts-staff';
        break;
      }
      if (isHrStaff(profile)) {
        role = 'hr';
        break;
      }
      // Department decides the dashboard: Support Team Leads have their own
      // dashboard; Sales (and other) Team Leads keep the Sales Team Lead one.
      role = isSupportLead(profile) ? 'support-lead' : 'team-lead';
      break;
    default:
      if (isAccountsStaff(profile)) {
        role = 'accounts-staff';
        break;
      }
      if (isHrStaff(profile)) {
        role = 'hr';
        break;
      }
      // Technical Consultants open the client-onboarding dashboard; other Support
      // team members open the Support dashboard; everyone else the team member
      // dashboard (Sales and other teams).
      // A Sales member with a Sales role: Telecallers open the Telecaller dashboard; the other Sales roles have no dashboard yet and
      // open a notice page - never another role's dashboard.
      if (isSalesSubRoleMember(profile)) {
        role = profile.salesSubRole === 'TELECALLER' ? 'telecaller' : profile.salesSubRole === 'BUSINESS_ASSOCIATE' ? 'business-associate' : 'sales-role';
        break;
      }
      // A Sales Team Member with no Sales role works in the one Sales dashboard (the Business Associate dashboard, which carries the pages
      // the separate Sales Team Member dashboard had). Permissions are unchanged: they come from the profile in the database.
      if (isSalesTeamMember(profile)) {
        role = 'business-associate';
        break;
      }
      role = isMetaVerifier(profile) ? 'meta-verifier' : isTechnicalConsultant(profile) ? 'technical-support' : isSupportMember(profile) ? 'support-member' : 'team-member';
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
 * The Department Head of the Sales side of a department (the database stores it as head_division = SALES and resolves the dashboard
 * value 'sales-department-head'). The Support Department Head, and a head with no side set, keep the Department Head dashboard.
 */
export function isSalesHead(p: Pick<Profile, 'role' | 'department' | 'headDivision' | 'defaultDashboard'>): boolean {
  if (p.role !== 'DEPARTMENT_HEAD' || p.department?.slug === 'hr' || p.department?.slug === 'accounts') return false;
  return p.defaultDashboard === 'sales-department-head' || p.headDivision === 'SALES';
}

/** The Department Head, Team Leads and Team Members of the AI Studio department. */
export function isAiStudioStaff(p: Pick<Profile, 'role' | 'department'>): boolean {
  return p.department?.slug === 'ai-studio' && p.role !== 'SUPER_ADMIN';
}

/** Team members and leads of the Accounts department confirm payments sent by Sales. */
export function isAccountsStaff(p: Pick<Profile, 'role' | 'department'>): boolean {
  return (p.role === 'TEAM_MEMBER' || p.role === 'TEAM_HEAD') && p.department?.slug === 'accounts';
}

/**
 * Team leads and team members of the HR department open the HR dashboard, the same one the HR head uses.
 * What they may do inside it is decided by their own role (and enforced by the API and database): HR staff
 * see HR data; only a Department Head can publish client notices; only leads and heads can add members.
 */
/** An HR employee whose designation is HR Recruiter (the role stays Team Member / Team Lead; the department is HR). */
export function isHrRecruiter(p: Pick<Profile, 'role' | 'department' | 'hrSubRole'>): boolean {
  return isHrStaff(p) && p.hrSubRole === 'HR_RECRUITER';
}

export function isHrStaff(p: Pick<Profile, 'role' | 'department'>): boolean {
  return (p.role === 'TEAM_MEMBER' || p.role === 'TEAM_HEAD') && p.department?.slug === 'hr';
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

/** A team member of a Support team who is neither a Technical Consultant nor a Meta Verifier. */
export function isSupportMember(p: Pick<Profile, 'role' | 'isTechnicalConsultant' | 'isMetaVerifier' | 'team'>): boolean {
  return p.role === 'TEAM_MEMBER' && p.team?.division === 'SUPPORT' && !isTechnicalConsultant(p) && !isMetaVerifier(p);
}

/** A support team member created (or marked) as Meta Verifier: does the first WhatsApp verification, then hands over to the Department Head. */
export function isMetaVerifier(p: Pick<Profile, 'role' | 'isMetaVerifier' | 'team'>): boolean {
  return p.role === 'TEAM_MEMBER' && !!p.isMetaVerifier && p.team?.division === 'SUPPORT';
}

/** A Team Member of a Sales team who has a Sales role (Telecaller, Business Associate, ...). */
export function isSalesSubRoleMember(p: Pick<Profile, 'role' | 'team' | 'salesSubRole'>): boolean {
  return p.role === 'TEAM_MEMBER' && p.team?.division === 'SALES' && !!p.salesSubRole;
}

/** A Team Member of a Sales team (whatever Sales role they have, or none). */
export function isSalesTeamMember(p: Pick<Profile, 'role' | 'team'>): boolean {
  return p.role === 'TEAM_MEMBER' && p.team?.division === 'SALES';
}

/**
 * Upload Leads is offered to every Sales employee: a Sales Team Member (any Sales role), a Sales Team Lead and the Sales Department Head.
 * Navigation only: the database (private.can_upload_leads) decides.
 */
export function canUploadLeads(p: Pick<Profile, 'role' | 'team' | 'department' | 'headDivision' | 'defaultDashboard'>): boolean {
  if (p.department?.slug === 'hr' || p.department?.slug === 'accounts') return false;
  if (p.role === 'TEAM_MEMBER' || p.role === 'TEAM_HEAD') return p.team?.division === 'SALES';
  return isSalesHead(p);
}

/** A support team member created (or marked) as Technical Consultant. */
export function isTechnicalConsultant(p: Pick<Profile, 'role' | 'isTechnicalConsultant' | 'team'>): boolean {
  return p.role === 'TEAM_MEMBER' && !!p.isTechnicalConsultant && p.team?.division === 'SUPPORT';
}

/** A Department Head who oversees the several departments the Super Admin assigned. */
export function isOperationsHead(p: Pick<Profile, 'role' | 'isOperationsHead'>): boolean {
  return p.role === 'DEPARTMENT_HEAD' && !!p.isOperationsHead;
}

/** Label for a profile's role, with Technical Consultant and Operations Head shown as their own roles. */
export function staffRoleLabel(p: Pick<Profile, 'role' | 'isTechnicalConsultant' | 'isMetaVerifier' | 'isOperationsHead' | 'team'>): string {
  if (isOperationsHead(p)) return OPERATIONS_HEAD_LABEL;
  if (isMetaVerifier(p)) return META_VERIFIER_LABEL;
  return isTechnicalConsultant(p) ? TECHNICAL_CONSULTANT_LABEL : ROLE_LABELS[p.role];
}

export const OPERATIONS_HEAD_LABEL = 'Operations Head';

export const META_VERIFIER_LABEL = 'Meta Verifier';

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
  technicalConsultant = false,
  departmentSlug?: string,
  salesSubRole?: SalesSubRole | null,
  headDivision?: HeadDivision | null,
  metaVerifier = false,
  operationsHead = false,
  hrSubRole?: Profile['hrSubRole']
): string {
  const dept = departmentName ? ` · ${departmentName}` : '';
  // AI Studio people open the AI Studio dashboard of their role
  if (departmentSlug === 'ai-studio' && role !== 'SUPER_ADMIN') {
    return `AI Studio ${role === 'DEPARTMENT_HEAD' ? 'Department Head' : role === 'TEAM_HEAD' ? 'Team Lead' : 'Team Member'} Dashboard${dept}`;
  }
  // An Operations Head opens its own dashboard (the departments it oversees side by side), not the Department Head dashboard.
  if (role === 'DEPARTMENT_HEAD' && operationsHead) {
    return `${headDivision === 'SALES' ? 'Sales ' : headDivision === 'SUPPORT' ? 'Support ' : ''}Operations Head Dashboard${dept}`;
  }
  // HR and Accounts staff open their department's own dashboard.
  if (departmentSlug === 'hr' && hrSubRole === 'HR_RECRUITER' && role !== 'SUPER_ADMIN') return `HR Recruiter Dashboard${dept}`;
  if (departmentSlug === 'hr' && role === 'DEPARTMENT_HEAD') return `HR Department Head Dashboard${dept}`;
  if (departmentSlug === 'hr') return `HR Dashboard${dept}`;
  switch (role) {
    case 'SUPER_ADMIN':
      return 'Super Admin Department Hub';
    case 'DEPARTMENT_HEAD':
      if (headDivision === 'SALES') return `Sales Department Head Dashboard${dept}`;
      return `Department Head Dashboard${dept}`;
    case 'TEAM_HEAD':
      if (division === 'SUPPORT') return `Support Team Lead Dashboard${dept}`;
      if (division === 'SALES') return `Sales Team Lead Dashboard${dept}`;
      return `Team Lead Dashboard${dept}`;
    default:
      if (metaVerifier && division === 'SUPPORT') return `Meta Verifier Dashboard${dept}`;
      if (technicalConsultant && division === 'SUPPORT') return `Technical Consultant Dashboard${dept}`;
      if (division === 'SALES' && salesSubRole === 'TELECALLER') return `Telecaller Dashboard${dept}`;
      if (division === 'SALES' && salesSubRole === 'BUSINESS_ASSOCIATE') return `Business Associate Dashboard${dept}`;
      if (division === 'SALES' && salesSubRole) return `${SALES_SUB_ROLE_LABELS[salesSubRole]} (dashboard not set up yet)${dept}`;
      // Only a Sales team opens as "Sales"; other teams get the plain label.
      if (division === 'SALES') return `Sales Dashboard${dept}`;
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
