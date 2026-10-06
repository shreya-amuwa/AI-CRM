/**
 * Centralised authorization pre-checks for the API layer.
 *
 * These MIRROR the database rules (supabase/migrations/*_authorization_helpers.sql)
 * so the API can fail fast with a clear message. They are NOT the security
 * boundary: the database re-checks every operation through RLS and workflow
 * functions, so a mistake here can only produce a less friendly error.
 */
import type { Role } from '../../shared/contracts.js';
import type { Actor } from '../auth/authenticate.js';
import { AppError } from '../http/errors.js';

const RANK: Record<Role, number> = { SUPER_ADMIN: 4, DEPARTMENT_HEAD: 3, TEAM_HEAD: 2, TEAM_MEMBER: 1 };

/** Roles each role may create/assign (scope is checked separately). */
const ASSIGNABLE: Record<Role, Role[]> = {
  SUPER_ADMIN: ['DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER'],
  DEPARTMENT_HEAD: ['TEAM_HEAD', 'TEAM_MEMBER'],
  TEAM_HEAD: ['TEAM_MEMBER'],
  TEAM_MEMBER: []
};

export const isManager = (actor: Actor) => RANK[actor.role] >= RANK.TEAM_HEAD;
export const isSuperAdmin = (actor: Actor) => actor.role === 'SUPER_ADMIN';

export function assertManager(actor: Actor): void {
  if (!isManager(actor)) throw new AppError('FORBIDDEN');
}

export function assertSuperAdmin(actor: Actor): void {
  if (!isSuperAdmin(actor)) throw new AppError('FORBIDDEN');
}

export function assertCanAssignRole(actor: Actor, role: Role, departmentId?: string | null, teamId?: string | null): void {
  if (!ASSIGNABLE[actor.role].includes(role)) {
    throw new AppError('FORBIDDEN', `You cannot assign the ${role.replace('_', ' ').toLowerCase()} role.`);
  }
  if (actor.role === 'DEPARTMENT_HEAD' && departmentId && departmentId !== actor.departmentId) {
    throw new AppError('FORBIDDEN', 'You can only manage users in your own department.');
  }
  if (actor.role === 'TEAM_HEAD' && teamId !== actor.teamId) {
    throw new AppError('FORBIDDEN', 'You can only manage users in your own team.');
  }
}

export function assertCanBroadcast(actor: Actor, departmentId?: string): void {
  if (!isManager(actor)) throw new AppError('FORBIDDEN', 'You cannot send announcements.');
  if (actor.role === 'DEPARTMENT_HEAD' && departmentId && departmentId !== actor.departmentId) {
    throw new AppError('FORBIDDEN', 'You can only message your own department.');
  }
}

export function assertCanManageTeamsIn(actor: Actor, departmentId: string): void {
  if (isSuperAdmin(actor)) return;
  if (actor.role === 'DEPARTMENT_HEAD' && actor.departmentId === departmentId) return;
  throw new AppError('FORBIDDEN', 'Only department heads can manage teams in their department.');
}

export function assertCanDeleteCustomers(actor: Actor): void {
  if (!isManager(actor)) throw new AppError('FORBIDDEN', 'Only team heads and above can delete customers.');
}
