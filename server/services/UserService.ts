import type { Paginated, Profile } from '../../shared/contracts.js';
import {
  profileSelfUpdateSchema,
  headDivisionSchema,
  salesSubRoleSchema,
  userAssignSchema,
  technicalConsultantSchema,
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
    if (input.salesSubRole) {
      // Only the Super Admin and the Department Head give a Sales role, and only to a member of a Sales team.
      if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'DEPARTMENT_HEAD') throw new AppError('FORBIDDEN', 'Only the Super Admin or the Department Head can set a Sales role.');
      if (!input.teamId || (await this.profiles.teamDivision(input.teamId)) !== 'SALES') throw new AppError('VALIDATION_ERROR', 'A Sales role can only be given to a member of a Sales team.');
    }
    const { details, salesSubRole, ...account } = input;
    const id = await this.authAdmin.createProvisionedUser({ ...account, provisionedBy: actor.id });
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
