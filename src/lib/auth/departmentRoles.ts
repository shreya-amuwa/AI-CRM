import { NO_SALES_SUPPORT_DEPARTMENT_SLUGS, type TeamDivision } from '../../../shared/contracts';

/**
 * Amuwa Design Studio (slug designstudio) and AI Design Studio (slug ai-design-studio) have only Department Head -> Team Lead -> Team Member: no Sales or Support roles (Sales Team Member, Telecaller, Business
 * Associate, Support Team Member, Technical Consultant, Meta Verifier, ...), no Sales / Support team and no Sales / Support side for its head.
 * The member forms use these helpers to offer only what the department has; the database refuses the rest anyway
 * (private.designstudio_role_problem, migrations 20270112000100 / 20270112000200), so this is a convenience, not the security boundary.
 */
export const hasNoSalesSupport = (slug?: string | null): boolean => !!slug && NO_SALES_SUPPORT_DEPARTMENT_SLUGS.includes(slug);

const PLAIN_ROLES: readonly string[] = ['DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER'];

/** The role choices of the Add Team Member form for this department (the order of `choices` is kept). */
export function staffChoicesForDepartment<T extends string>(slug: string | null | undefined, choices: readonly T[]): T[] {
  return hasNoSalesSupport(slug) ? choices.filter(c => PLAIN_ROLES.includes(c)) : [...choices];
}

/** The teams a new member of this department may be placed in (Amuwa Design Studio: its General team only). */
export function staffTeamsForDepartment<T extends { division: TeamDivision | string }>(slug: string | null | undefined, teams: readonly T[]): T[] {
  return hasNoSalesSupport(slug) ? teams.filter(t => t.division === 'GENERAL') : [...teams];
}

/** The sides (Sales / Support / General) an employee request may name for this department. */
export function requestSidesForDepartment(slug: string | null | undefined): Array<'SALES' | 'SUPPORT' | 'GENERAL'> {
  return hasNoSalesSupport(slug) ? ['GENERAL'] : ['SALES', 'SUPPORT', 'GENERAL'];
}

/** The designations offered for this department (Amuwa Design Studio: Department Head, Team Lead, Team Member). */
export function designationsForDepartment<T extends string>(slug: string | null | undefined, designations: readonly T[]): T[] {
  const plain = ['Department Head', 'Team Lead', 'Team Member'];
  return hasNoSalesSupport(slug) ? designations.filter(d => plain.includes(d)) : [...designations];
}
