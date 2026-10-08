import type { Paginated, Profile } from '../../shared/contracts.js';
import {
  profileSelfUpdateSchema,
  userAssignSchema,
  technicalConsultantSchema,
  userCreateSchema,
  userListQuerySchema,
  userStatusSchema,
  uuidSchema
} from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { assertCanAssignRole, assertManager, assertSuperAdmin } from '../authz/policies.js';
import { parse } from '../http/validate.js';
import { AppError } from '../http/errors.js';
import { AuthAdminRepository } from '../repositories/AuthAdminRepository.js';
import { ProfileRepository } from '../repositories/ProfileRepository.js';

export class UserService {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly authAdmin = new AuthAdminRepository()
  ) {}

  /** Own profile — available to every authenticated user, whatever the status. */
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
    await this.profiles.assertCanCreate(input.role, input.departmentId, input.teamId);
    if (input.technicalConsultant && (!input.teamId || (await this.profiles.teamDivision(input.teamId)) !== 'SUPPORT')) {
      throw new AppError('VALIDATION_ERROR', 'A Technical Consultant must be in a support team.');
    }
    const id = await this.authAdmin.createProvisionedUser({ ...input, provisionedBy: actor.id });
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

  async setTechnicalConsultant(actor: Actor, id: string, body: unknown): Promise<Profile> {
    assertManager(actor);
    const userId = parse(uuidSchema, id);
    const { value } = parse(technicalConsultantSchema, body);
    await this.profiles.setTechnicalConsultant(userId, value);
    return this.profiles.findById(userId);
  }

  async delete(actor: Actor, id: string): Promise<void> {
    assertSuperAdmin(actor);
    await this.profiles.delete(parse(uuidSchema, id));
  }
}
