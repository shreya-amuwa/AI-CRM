import { NO_SALES_SUPPORT_DEPARTMENT_SLUGS, UNIFIED_DEPARTMENT_SLUGS, type TeamDivision } from '../../../shared/contracts';

/**
 * Amuwa Design Studio (slug designstudio) and AI Design Studio (slug ai-design-studio) have only Department Head -> Team Lead -> Team Member: no Sales or Support roles (Sales Team Member, Telecaller, Business
 * Associate, Support Team Member, Technical Consultant, Meta Verifier, ...), no Sales / Support team and no Sales / Support side for its head.
 * The member forms use these helpers to offer only what the department has; the database refuses the rest anyway
 * (private.designstudio_role_problem, migrations 20270112000100 / 20270112000200), so this is a convenience, not the security boundary.
 */
export const hasNoSalesSupport = (slug?: string | null): boolean => !!slug && NO_SALES_SUPPORT_DEPARTMENT_SLUGS.includes(slug);

/**
 * International and Reseller: Sales AND Support in one dashboard. Their people are never given a Sales-only or Support-only role (Telecaller, Business
 * Associate, Technical Consultant, ...), team or side: Department Head, Team Lead and Team Member in the department's one team, whose function is the
 * department's (migration 20270127000100). A convenience for the forms; the database enforces it.
 */
export const isUnifiedDepartment = (slug?: string | null): boolean => !!slug && (UNIFIED_DEPARTMENT_SLUGS.includes(slug) || flaggedUnified.has(slug));

/**
 * The departments the DATABASE marks unified (departments.unified_sales_support). The department list registers them when it loads, so International and
 * Reseller are recognised under whatever slug they were created with ("Amuwa International Department"); the two seeded slugs stay as the fallback.
 */
const flaggedUnified = new Set<string>();
export function registerUnifiedDepartments(departments: readonly { slug: string; unifiedSalesSupport?: boolean }[]): void {
  flaggedUnified.clear();
  for (const d of departments) if (d.unifiedSalesSupport) flaggedUnified.add(d.slug);
}

/** Departments whose forms offer only Department Head / Team Lead / Team Member, the one General team and no side. */
export const hasPlainRolesOnly = (slug?: string | null): boolean => hasNoSalesSupport(slug) || isUnifiedDepartment(slug);

const PLAIN_ROLES: readonly string[] = ['DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER'];

/** The role choices of the Add Team Member form for this department (the order of `choices` is kept). */
export function staffChoicesForDepartment<T extends string>(slug: string | null | undefined, choices: readonly T[]): T[] {
  return hasPlainRolesOnly(slug) ? choices.filter(c => PLAIN_ROLES.includes(c)) : [...choices];
}

/** The teams a new member of this department may be placed in (Amuwa Design Studio: its General team only). */
export function staffTeamsForDepartment<T extends { division: TeamDivision | string }>(slug: string | null | undefined, teams: readonly T[]): T[] {
  return hasPlainRolesOnly(slug) ? teams.filter(t => t.division === 'GENERAL') : [...teams];
}

/** The sides (Sales / Support / General) an employee request may name for this department. */
export function requestSidesForDepartment(slug: string | null | undefined): Array<'SALES' | 'SUPPORT' | 'GENERAL'> {
  return hasPlainRolesOnly(slug) ? ['GENERAL'] : ['SALES', 'SUPPORT', 'GENERAL'];
}

/** The designations offered for this department (Amuwa Design Studio: Department Head, Team Lead, Team Member). */
export function designationsForDepartment<T extends string>(slug: string | null | undefined, designations: readonly T[]): T[] {
  const plain = ['Department Head', 'Team Lead', 'Team Member'];
  return hasPlainRolesOnly(slug) ? designations.filter(d => plain.includes(d)) : [...designations];
}
