import type { DefaultDashboard, MyDepartmentScopes, Profile, TeamDivision } from '../../../shared/contracts';
import { dashboardById, departmentBySlug, PREVIEW_DEPARTMENTS, type DashboardEntry, type PreviewDepartment } from '../../../shared/dashboardExplorer';

/**
 * The synthetic person a preview shows. It is NOT an employee: the ids are fixed demonstration ids, the name says "Demo", and nothing
 * outside this frame ever sees it (the frame has no network). The production role mapping (toAuthUser) turns it into the dashboard.
 */
export const DEMO_ME_ID = 'd0000000-0000-4000-8000-000000000001';
export const demoDepartmentId = (slug: string) => `d1000000-0000-4000-8000-${(PREVIEW_DEPARTMENTS.findIndex(d => d.slug === slug) + 1).toString().padStart(12, '0')}`;
export const demoTeamId = (slug: string, division: TeamDivision) =>
  `d2000000-0000-4000-8000-${((PREVIEW_DEPARTMENTS.findIndex(d => d.slug === slug) + 1) * 10 + ['SALES', 'SUPPORT', 'GENERAL'].indexOf(division)).toString().padStart(12, '0')}`;

/** The dashboard value the database would compute for this person (profiles.default_dashboard); toAuthUser reads it for some departments. */
function defaultDashboardFor(e: DashboardEntry, dept: PreviewDepartment): DefaultDashboard {
  const p = e.profile;
  if (dept.unified) return p.role === 'DEPARTMENT_HEAD' ? 'unified-head' : p.role === 'TEAM_HEAD' ? 'unified-lead' : 'unified-member';
  if (dept.slug === 'ai-studio') return p.role === 'DEPARTMENT_HEAD' ? 'ai-studio-head' : p.role === 'TEAM_HEAD' ? 'ai-studio-lead' : 'ai-studio-member';
  if (p.role === 'DEPARTMENT_HEAD') return dept.slug === 'hr' ? 'hr-head' : p.headDivision === 'SALES' ? 'sales-department-head' : 'department-head';
  if (p.hrSubRole === 'HR_RECRUITER') return 'hr-recruiter';
  if (dept.slug === 'accounts') return 'accounts-staff';
  if (p.role === 'TEAM_HEAD') return p.teamDivision === 'SUPPORT' ? 'support-lead' : p.teamDivision === 'SALES' ? 'sales-lead' : 'team-lead';
  if (p.isMetaVerifier) return 'meta-verifier';
  if (p.isTechnicalConsultant) return 'technical-consultant';
  if (p.salesSubRole === 'TELECALLER') return 'telecaller';
  if (p.salesSubRole) return p.salesSubRole === 'BUSINESS_ASSOCIATE' ? 'business-associate' : `sales-${p.salesSubRole.toLowerCase().replace(/_/g, '-')}`;
  if (p.teamDivision === 'SUPPORT') return 'support-member';
  if (p.teamDivision === 'SALES') return 'sales-member';
  return 'team-member';
}

const POSITION_TITLE: Record<string, string> = { DEPARTMENT_HEAD: 'Department Head', TEAM_HEAD: 'Team Lead', TEAM_MEMBER: 'Team Member' };

export interface PreviewIdentity { entry: DashboardEntry; department: PreviewDepartment; profile: Profile; scopes: MyDepartmentScopes | null }

export function buildPreviewIdentity(dashboardId: string, departmentSlug: string): PreviewIdentity | null {
  const entry = dashboardById(dashboardId);
  const department = departmentBySlug(departmentSlug);
  if (!entry || !department || !entry.departments.includes(department.slug)) return null;
  const p = entry.profile;
  const division: TeamDivision | undefined = p.role === 'DEPARTMENT_HEAD' ? undefined : (p.teamDivision ?? 'GENERAL');
  const deptRef = { id: demoDepartmentId(department.slug), slug: department.slug, name: department.name };
  const profile: Profile = {
    id: DEMO_ME_ID,
    email: 'demo.preview@example.invalid',
    fullName: `Demo ${entry.position}`,
    avatarUrl: null,
    phone: null,
    position: entry.position,
    role: p.role,
    isTechnicalConsultant: !!p.isTechnicalConsultant,
    isMetaVerifier: !!p.isMetaVerifier,
    isOperationsHead: !!p.isOperationsHead,
    salesSubRole: p.salesSubRole ?? null,
    hrSubRole: p.hrSubRole ?? (department.slug === 'hr' && p.role !== 'DEPARTMENT_HEAD' ? 'HR_ASSISTANT' : null),
    headDivision: p.headDivision ?? null,
    defaultDashboard: defaultDashboardFor(entry, department),
    status: 'ACTIVE',
    statusReason: null,
    departmentId: deptRef.id,
    teamId: division ? demoTeamId(department.slug, division) : null,
    department: deptRef,
    team: division ? { id: demoTeamId(department.slug, division), name: division === 'GENERAL' ? department.name : `${department.name} ${division === 'SALES' ? 'Sales' : 'Support'}`, division } : null,
    approvedAt: '2026-01-05T04:30:00.000Z',
    createdAt: '2026-01-05T04:30:00.000Z'
  };
  // A CEO with several departments: the production department choice (DepartmentChoice) with two demonstration departments and both functions
  let scopes: MyDepartmentScopes | null = null;
  if (p.role === 'DEPARTMENT_HEAD' && (p.isOperationsHead || p.multiDepartment) && entry.category === 'EXECUTIVE') {
    const others = p.multiDepartment ? PREVIEW_DEPARTMENTS.filter(d => entry.departments.includes(d.slug) && d.slug !== department.slug).slice(0, 2) : [];
    const list = [department, ...others];
    scopes = {
      departments: list.map((d, i) => ({
        id: demoDepartmentId(d.slug), slug: d.slug, name: d.name, iconName: null, accentColor: null, dataDepartmentId: demoDepartmentId(d.slug), dataSlug: d.slug,
        isHome: i === 0, divisions: p.multiDepartment ? ['SALES', 'SUPPORT'] : [p.headDivision ?? 'SUPPORT'], wholeDepartment: false
      })),
      homeDepartmentId: deptRef.id,
      activeDepartmentId: deptRef.id,
      activeDivision: p.headDivision ?? null
    };
  }
  return { entry, department, profile, scopes };
}

export const positionTitle = (role: string) => POSITION_TITLE[role] ?? role;
