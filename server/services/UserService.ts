import type { DepartmentAccessInfo, DepartmentHeadAccess, MyDepartmentScopes, VerifierDepartments, OffboardingImpact, OffboardingResult, ReassignmentItem, OperationsHeadReviewItem, OperationsOverviewRow, Paginated, Profile } from '../../shared/contracts.js';
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
  ownPasswordSchema,
  userCreateSchema,
  userListQuerySchema,
  userStatusSchema,
  uuidSchema,
  verifierDepartmentsSchema,
  offboardSchema,
  reassignResolveSchema
} from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { assertCanAssignRole, assertManager, assertNotSuperAdminTarget } from '../authz/policies.js';
import { parse } from '../http/validate.js';
import { AppError } from '../http/errors.js';
import { AuthAdminRepository } from '../repositories/AuthAdminRepository.js';
import type { HrRepository } from '../repositories/HrRepository.js';
import { ProfileRepository } from '../repositories/ProfileRepository.js';
import type { AiStudioRepository } from '../repositories/AiStudioRepository.js';
import { temporaryPassword } from '../automations/secrets.js';

export class UserService {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly authAdmin = new AuthAdminRepository(),
    private readonly hr?: HrRepository,
    private readonly aiStudio?: AiStudioRepository
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
    // the Super Admin is not part of anybody's team to manage: only a Super Admin's own list shows the account
    return this.profiles.list(parse(userListQuerySchema, query), actor.role !== 'SUPER_ADMIN');
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
    // Who creates decides the workflow, from the signed-in account: the Super Admin, a Department Head and a Team Lead (a Team Member of their own team) add people
    // directly - an active account, no approval; HR sends an employee request instead (the database refuses HR here: assert_can_create_user).
    // An Operations Head is its own role: only the Super Admin makes one, and the Department Head rule of one head per department and side does not apply to it
    // (that rule is unchanged for Department Heads). The form sends `departmentIds`: whole departments, set in the same step. An older client that sends one
    // department with (department, function) pairs keeps working: the account is still made as an Operations Head from the start.
    const wholeDepartments = !!input.operationsHead && !!input.departmentIds?.length;
    const operationsDepartments = wholeDepartments ? [...new Set(input.departmentIds)] : [];
    if (input.operationsHead) {
      if (actor.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only the Super Admin can make an Operations Head.');
      if (input.role !== 'DEPARTMENT_HEAD' || input.teamId) throw new AppError('VALIDATION_ERROR', 'An Operations Head is created without a team.');
    }
    const homeDepartment = wholeDepartments ? operationsDepartments[0] : input.departmentId;
    assertCanAssignRole(actor, input.role, homeDepartment, input.teamId);
    if (input.operationsHead) await this.profiles.assertCanCreateOperationsHead(homeDepartment!);
    else await this.profiles.assertCanCreate(input.role, input.departmentId, input.teamId, input.headDivision);
    // The department decides the designations: an HR employee is an HR Assistant, an HR Recruiter or an HR Admin Head (the Department Head of HR) and nothing
    // else, and an HR designation is refused anywhere else. Checked by the database BEFORE the account exists (and again when the details are saved).
    await this.profiles.assertDesignationAllowed({ role: input.role, departmentId: homeDepartment, teamId: input.teamId, designation: input.details?.designation, operationsHead: input.operationsHead });
    // AI Studio: a new Team Lead / Team Member needs a project (and a Team Member a Team Lead on it), checked BEFORE the account exists. Nothing happens
    // for another department.
    await this.aiStudio?.checkPlacement({ departmentId: input.departmentId, role: input.role, teamId: input.teamId, projectIds: input.aiStudioProjectIds, leadId: input.aiStudioLeadId });
    if (input.technicalConsultant && (!input.teamId || (await this.profiles.teamDivision(input.teamId)) !== 'SUPPORT')) {
      throw new AppError('VALIDATION_ERROR', 'A Technical Consultant must be in a support team.');
    }
    if (input.metaVerifier && (!input.teamId || (await this.profiles.teamDivision(input.teamId)) !== 'SUPPORT')) {
      throw new AppError('VALIDATION_ERROR', 'A Meta Verifier must be in a support team.');
    }
    if (input.salesSubRole) {
      // The Super Admin, the Department Head and the Team Lead of the member's team give a Sales role, and only to a member of a Sales team (the database checks again).
      if (actor.role !== 'SUPER_ADMIN' && actor.role !== 'DEPARTMENT_HEAD' && actor.role !== 'TEAM_HEAD') throw new AppError('FORBIDDEN', 'Only the Super Admin, the Department Head or the Team Lead can set a Sales role.');
      if (!input.teamId || (await this.profiles.teamDivision(input.teamId)) !== 'SALES') throw new AppError('VALIDATION_ERROR', 'A Sales role can only be given to a member of a Sales team.');
    }
    const { details, salesSubRole, aiStudioProjectIds, aiStudioLeadId, additionalAccess: requestedAccess, operationsHead, departmentIds: _departmentIds, verifierDepartmentIds, ...account } = input;
    void _departmentIds;
    // A Meta Verifier who verifies for several departments: the Super Admin (or the Operations Head who owns them) gives them in the same step; the database
    // re-checks who may, and the account is not left half-made if it refuses.
    const verifierDepartments = [...new Set(verifierDepartmentIds ?? [])];
    if (verifierDepartments.length && actor.role !== 'SUPER_ADMIN' && actor.role !== 'DEPARTMENT_HEAD') {
      throw new AppError('FORBIDDEN', 'Only the Super Admin or an Operations Head can give a Meta Verifier other departments.');
    }
    if (operationsHead && actor.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only the Super Admin can make an Operations Head.');
    // Whole departments are set by operations_head_assign_new; (department, function) pairs are for the older request shape and for a Department Head.
    const additionalAccess = wholeDepartments ? undefined : requestedAccess;
    if (wholeDepartments) {
      account.departmentId = homeDepartment;
      account.headDivision = undefined;
    }
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
    // nobody types or knows an employee's password: the account starts with a random one and the employee chooses their own from the welcome e-mail
    const id = await this.authAdmin.createProvisionedUser({ ...account, password: account.password ?? temporaryPassword(28), operationsHead: !!operationsHead, provisionedBy: actor.id });
    if (wholeDepartments) {
      try {
        await this.profiles.assignOperationsDepartments(id, operationsDepartments);
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
    if (verifierDepartments.length) {
      try {
        await this.profiles.setVerifierDepartments(id, verifierDepartments);
      } catch (err) {
        // Never leave a verifier without the departments that were asked for.
        await this.authAdmin.deleteUser(id).catch(() => undefined);
        throw err;
      }
    }
    if (aiStudioProjectIds?.length || aiStudioLeadId) {
      try {
        // the Department Head / Super Admin name the Team Lead of a new Team Member; a Team Lead's own member is theirs already
        if (aiStudioLeadId && actor.role !== 'TEAM_HEAD') await this.aiStudio!.assignDirectLead(id, aiStudioLeadId);
        for (const projectId of new Set(aiStudioProjectIds ?? [])) await this.aiStudio!.assignProject(projectId, id, true);
      } catch (err) {
        // Never leave an AI Studio employee without the projects that were asked for.
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
    // the account is complete: the welcome e-mail (queued by the database, held while this ran) may go now
    await this.authAdmin.releaseWelcomeEmail(id);
    return this.profiles.findById(id);
  }

  /** The employee chooses their own permanent password (after the e-mailed link signed them in for this one step). Never logged or returned. */
  async setOwnPassword(actor: Actor, body: unknown): Promise<{ changed: true }> {
    const { password } = parse(ownPasswordSchema, body);
    await this.authAdmin.setStaffPassword(actor.id, password);
    return { changed: true };
  }

  /** The Super Admin account is never changed from the application. A person who cannot even see the account gets the database's own answer. */
  private async refuseSuperAdminTarget(userId: string): Promise<void> {
    assertNotSuperAdminTarget(await this.profiles.findById(userId).catch(() => null));
  }

  async setStatus(actor: Actor, id: string, body: unknown): Promise<Profile> {
    assertManager(actor);
    const userId = parse(uuidSchema, id);
    const { status, reason } = parse(userStatusSchema, body);
    await this.refuseSuperAdminTarget(userId);
    await this.profiles.setStatus(userId, status, reason);
    await this.authAdmin.setSignInBlocked(userId, status !== 'ACTIVE');
    return this.profiles.findById(userId);
  }

  async assign(actor: Actor, id: string, body: unknown): Promise<Profile> {
    const userId = parse(uuidSchema, id);
    const input = parse(userAssignSchema, body);
    assertCanAssignRole(actor, input.role, input.departmentId, input.teamId);
    await this.refuseSuperAdminTarget(userId);
    await this.profiles.assign(userId, input.role, input.departmentId, input.teamId);
    return this.profiles.findById(userId);
  }

  /** Give a Sales team member a Sales role (Telecaller, ...) or clear it. The database lets only the Super Admin and the Department Head of that department do it. */
  async setSalesSubRole(actor: Actor, id: string, body: unknown): Promise<Profile> {
    assertManager(actor);
    const userId = parse(uuidSchema, id);
    const { role } = parse(salesSubRoleSchema, body);
    await this.refuseSuperAdminTarget(userId);
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

  /** What is attached to a person before they leave (read-only). The database decides who may ask. */
  offboardingImpact(id: string): Promise<OffboardingImpact> {
    return this.profiles.offboardingImpact(parse(uuidSchema, id));
  }

  /**
   * One transaction in the database: the work moves to the chosen colleague (or waits in the Reassignment Required queue), the account is suspended or revoked, and it is audited.
   * Then the sign-in is blocked, as for any status change.
   */
  async offboard(actor: Actor, id: string, body: unknown): Promise<OffboardingResult> {
    assertManager(actor);
    const userId = parse(uuidSchema, id);
    const input = parse(offboardSchema, body);
    await this.refuseSuperAdminTarget(userId);
    const result = await this.profiles.offboard(userId, input.replacementId ?? null, input.status, input.reason ?? null);
    await this.authAdmin.setSignInBlocked(userId, true);
    return result;
  }

  reassignmentQueue(): Promise<ReassignmentItem[]> {
    return this.profiles.reassignmentQueue();
  }

  reassignmentResolve(item: string, body: unknown) {
    return this.profiles.reassignmentResolve(parse(uuidSchema, item), parse(reassignResolveSchema, body ?? {}).toId ?? null);
  }

  /** The departments a Meta Verifier verifies for. Readable by the person, the Super Admin and the Operations Head who owns it; the database decides. */
  verifierDepartments(id: string): Promise<VerifierDepartments> {
    return this.profiles.verifierDepartments(parse(uuidSchema, id));
  }

  /** Save a Meta Verifier's EXTRA departments (Super Admin, or the Operations Head who owns the verifier's department and every department added - the database checks). */
  setVerifierDepartments(id: string, body: unknown): Promise<VerifierDepartments> {
    return this.profiles.setVerifierDepartments(parse(uuidSchema, id), parse(verifierDepartmentsSchema, body).departmentIds);
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
    await this.refuseSuperAdminTarget(userId);
    await this.profiles.setTechnicalConsultant(userId, value);
    return this.profiles.findById(userId);
  }

  /** Removal follows the hierarchy; delete_user() enforces who may remove whom. */
  async delete(actor: Actor, id: string): Promise<void> {
    assertManager(actor);
    const userId = parse(uuidSchema, id);
    await this.refuseSuperAdminTarget(userId);
    await this.profiles.delete(userId);
  }
}
