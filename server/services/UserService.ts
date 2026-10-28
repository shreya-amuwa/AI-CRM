import type { DepartmentAccessInfo, DepartmentHeadAccess, MyDepartmentScopes, OperationsHeadReviewItem, OperationsOverviewRow, Paginated, Profile } from '../../shared/contracts.js';
import {
  departmentAccessApplySchema,
  departmentAccessSchema,
  profileSelfUpdateSchema,
  headDivisionSchema,
  operationsHeadSchema,
  salesSubRoleSchema,
  userAssignSchema,
  technicalConsultantSchema,
  metaVerifierSchema,
  userCreateSchema,
  userListQuerySchema,
  userStatusSchema,
  uuidSchema
} from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { assertCanAssignRole, assertManager } from '../authz/policies.js';
import { parse } from '../http/validate.js';
import { AppError } from '../http/errors.js';
import { AuthAdminRepository } from '../repositories/AuthAdminRepository.js';
import type { HrRepository } from '../repositories/HrRepository.js';
import { ProfileRepository } from '../repositories/ProfileRepository.js';

export class UserService {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly authAdmin = new AuthAdminRepository(),
    private readonly hr?: HrRepository
  ) {}

  /** Own profile - available to every authenticated user, whatever the status. */
  me(actor: Actor): Promise<Profile> {
    return this.profiles.findById(actor.id);
  }

  updateMe(actor: Actor, body: unknown): Promise<Profile> {
    return this.profiles.updateSelf(actor.id, parse(profileSelfUpdateSchema, body));
  }

  list(actor: Actor, query: unknown): Promise<Paginated<Profile>> {
    assertManager(actor);
    return this.profiles.list(parse(userListQuerySchema, query));
  }

  get(id: string): Promise<Profile> {
    return this.profiles.findById(parse(uuidSchema, id));
  }

  /**
   * 1. validate  2. policy pre-check  3. authoritative DB check with the
   * caller's JWT  4. create auth user with the service role (the DB trigger
   * re-validates the provisioning actor)  5. read back through RLS.
   */
  async create(actor: Actor, body: unknown): Promise<Profile> {
    const input = parse(userCreateSchema, body);
    assertCanAssignRole(actor, input.role, input.departmentId, input.teamId);
    await this.profiles.assertCanCreate(input.role, input.departmentId, input.teamId, input.headDivision);
    if (input.technicalConsultant && (!input.teamId || (await this.profiles.teamDivision(input.teamId)) !== 'SUPPORT')) {
      throw new AppError('VALIDATION_ERROR', 'A Technical Consultant must be in a support team.');
    }
    if (input.metaVerifier && (!input.teamId || (await this.profiles.teamDivision(input.teamId)) !== 'SUPPORT')) {
      throw new AppError('VALIDATION_ERROR', 'A Meta Verifier must be in a support team.');
    }
    if (input.salesSubRole) {
      // Only the Super Admin and the Department Head give a Sales role, and only to a member of a Sales team.
      if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'DEPARTMENT_HEAD') throw new AppError('FORBIDDEN', 'Only the Super Admin or the Department Head can set a Sales role.');
      if (!input.teamId || (await this.profiles.teamDivision(input.teamId)) !== 'SALES') throw new AppError('VALIDATION_ERROR', 'A Sales role can only be given to a member of a Sales team.');
    }
    const { details, salesSubRole, additionalAccess, operationsHead, ...account } = input;
    if (operationsHead && actor.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only the Super Admin can make an Operations Head.');
    // One account for a head who works in several departments / both functions: every extra pair is checked BEFORE the account exists
    // (a wrong pair never leaves a half-made user), and given right after it by the Super Admin's own database call.
    const extra = additionalAccess?.length ? [...new Map(additionalAccess.map(a => [`${a.departmentId}:${a.division}`, a])).values()] : [];
    if (extra.length) {
      if (actor.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only the Super Admin can give a Department Head more departments.');
      const problems = await this.profiles.checkDepartmentAccess(extra);
      if (problems.length) throw new AppError('VALIDATION_ERROR', problems[0].problem);
      // another DEPARTMENT is for an Operations Head; the other function of the head's own department is not (the database enforces the same rule)
      if (!operationsHead && account.departmentId) {
        const base = await this.profiles.baseDepartments([account.departmentId, ...extra.map(a => a.departmentId)]);
        if (extra.some(a => base.get(a.departmentId) !== base.get(account.departmentId!))) {
          throw new AppError('VALIDATION_ERROR', 'A Department Head works in one department. To oversee several departments, make this person an Operations Head.');
        }
      }
    }
    const id = await this.authAdmin.createProvisionedUser({ ...account, provisionedBy: actor.id });
    if (operationsHead) {
      try {
        await this.profiles.setOperationsHead(id, true, null);
      } catch (err) {
        await this.authAdmin.deleteUser(id).catch(() => undefined);
        throw err;
      }
    }
    for (const a of extra) {
      try {
        await this.profiles.setDepartmentAccess(id, a.departmentId, a.division, true);
      } catch (err) {
        // Never leave a head without the departments that were asked for.
        await this.authAdmin.deleteUser(id).catch(() => undefined);
        throw err;
      }
    }
    if (salesSubRole) {
      try {
        await this.profiles.setSalesSubRole(id, salesSubRole);
      } catch (err) {
        // Never leave a Sales member without the role that was asked for.
        await this.authAdmin.deleteUser(id).catch(() => undefined);
        throw err;
      }
    }
    if (details) {
      try {
        await this.authAdmin.savePersonalDetails(id, details);
      } catch (err) {
        // Never leave an account without the details that were asked for.
        await this.authAdmin.deleteUser(id).catch(() => undefined);
        throw err;
      }
    }
    // Tell HR about the new member (once). A failed notification never fails the creation.
    await this.hr?.notifyMemberCreated(id).catch(() => undefined);
    return this.profiles.findById(id);
  }

  async setStatus(actor: Actor, id: string, body: unknown): Promise<Profile> {
    assertManager(actor);
    const userId = parse(uuidSchema, id);
    const { status, reason } = parse(userStatusSchema, body);
    await this.profiles.setStatus(userId, status, reason);
    await this.authAdmin.setSignInBlocked(userId, status !== 'ACTIVE');
    return this.profiles.findById(userId);
  }

  async assign(actor: Actor, id: string, body: unknown): Promise<Profile> {
    const userId = parse(uuidSchema, id);
    const input = parse(userAssignSchema, body);
    assertCanAssignRole(actor, input.role, input.departmentId, input.teamId);
    await this.profiles.assign(userId, input.role, input.departmentId, input.teamId);
    return this.profiles.findById(userId);
  }

  /** Give a Sales team member a Sales role (Telecaller, ...) or clear it. The database lets only the Super Admin and the Department Head of that department do it. */
  async setSalesSubRole(actor: Actor, id: string, body: unknown): Promise<Profile> {
    assertManager(actor);
    const userId = parse(uuidSchema, id);
    const { role } = parse(salesSubRoleSchema, body);
    await this.profiles.setSalesSubRole(userId, role);
    return this.profiles.findById(userId);
  }

  /** Label a Department Head Sales or Support. Only the Super Admin; the database refuses a second head for the same side. */
  async setHeadDivision(actor: Actor, id: string, body: unknown): Promise<Profile> {
    if (actor.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only the Super Admin can set a Department Head\'s side.');
    const userId = parse(uuidSchema, id);
    const { division } = parse(headDivisionSchema, body);
    await this.profiles.setHeadDivision(userId, division);
    return this.profiles.findById(userId);
  }

  /** The departments and functions the signed-in Department Head may switch between (the database decides; a member or a head with one scope gets what they already have). */
  myDepartmentScopes(): Promise<MyDepartmentScopes> {
    return this.profiles.myDepartmentScopes();
  }

  /** Department Heads who work in a department (their own, or authorised by the Super Admin) with every department they work in. */
  async departmentHeads(actor: Actor, departmentId: unknown): Promise<DepartmentHeadAccess[]> {
    assertManager(actor);
    return this.profiles.departmentHeads(parse(uuidSchema, departmentId));
  }

  /** The Super Admin sees which departments and functions a Department Head is authorised for. */
  async departmentAccess(actor: Actor, id: string): Promise<DepartmentAccessInfo> {
    if (actor.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only the Super Admin can see this.');
    return this.profiles.departmentAccess(parse(uuidSchema, id));
  }

  /** Authorise (or withdraw) one department + function for a Department Head. Only the Super Admin; the database checks the head, the department and that it has such a team. */
  async setDepartmentAccess(actor: Actor, id: string, body: unknown): Promise<DepartmentAccessInfo> {
    if (actor.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only the Super Admin can give a Department Head more departments.');
    const userId = parse(uuidSchema, id);
    const { departmentId, division, granted } = parse(departmentAccessSchema, body);
    return this.profiles.setDepartmentAccess(userId, departmentId, division, granted);
  }

  /** Save a Department Head's whole department / function matrix (Super Admin). The database validates every pair and applies all of them or none. */
  async applyDepartmentAccess(actor: Actor, id: string, body: unknown): Promise<DepartmentAccessInfo> {
    if (actor.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only the Super Admin can give a Department Head more departments.');
    const userId = parse(uuidSchema, id);
    const { pairs } = parse(departmentAccessApplySchema, body);
    return this.profiles.applyDepartmentAccess(userId, pairs);
  }

  /** Make a Department Head an Operations Head (or take it back): Super Admin only, audited by the database. */
  async setOperationsHead(actor: Actor, id: string, body: unknown): Promise<Profile> {
    if (actor.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only the Super Admin can make or remove an Operations Head.');
    const userId = parse(uuidSchema, id);
    const { value, note } = parse(operationsHeadSchema, body);
    await this.profiles.setOperationsHead(userId, value, note ?? null);
    return this.profiles.findById(userId);
  }

  /** Super Admin: Department Heads that work in several departments, and which of them still need a decision. */
  async operationsHeadReview(actor: Actor): Promise<OperationsHeadReviewItem[]> {
    if (actor.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only the Super Admin can see this.');
    return this.profiles.operationsHeadReview();
  }

  /** Operations Head (and the Super Admin): the departments side by side. */
  operationsOverview(): Promise<OperationsOverviewRow[]> {
    return this.profiles.operationsOverview();
  }

  /** Make a support team member a Meta Verifier (or take it back). The database checks who may and that the person is not a Technical Consultant. */
  async setMetaVerifier(actor: Actor, id: string, body: unknown): Promise<Profile> {
    assertManager(actor);
    const userId = parse(uuidSchema, id);
    const { value } = parse(metaVerifierSchema, body);
    await this.profiles.setMetaVerifier(userId, value);
    return this.profiles.findById(userId);
  }

  async setTechnicalConsultant(actor: Actor, id: string, body: unknown): Promise<Profile> {
    assertManager(actor);
    const userId = parse(uuidSchema, id);
    const { value } = parse(technicalConsultantSchema, body);
    await this.profiles.setTechnicalConsultant(userId, value);
    return this.profiles.findById(userId);
  }

  /** Removal follows the hierarchy; delete_user() enforces who may remove whom. */
  async delete(actor: Actor, id: string): Promise<void> {
    assertManager(actor);
    await this.profiles.delete(parse(uuidSchema, id));
  }
}
