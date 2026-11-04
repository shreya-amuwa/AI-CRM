import type { DepartmentEmployeeDirectory, EmployeeRequest, OperationsActivityEntry, OperationsDashboard, OperationsDepartmentDetail, OperationsHeadAdmin, OperationsHeadsAdmin, TeamAssignmentRecord } from '../../shared/contracts.js';
import {
  assignLeadSchema, employeeDecisionSchema, employeeRequestListQuerySchema, employeeRequestSchema, employeeResubmitSchema, operationsScopeApplySchema, operationsScopeSchema, uuidSchema,
  type EmployeeRequestInput
} from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { AuthAdminRepository } from '../repositories/AuthAdminRepository.js';
import type { EmployeeApprovalRepository } from '../repositories/EmployeeApprovalRepository.js';
import { temporaryPassword } from '../automations/secrets.js';

const DB_ROLE = { OPERATIONS_HEAD: 'DEPARTMENT_HEAD', DEPARTMENT_HEAD: 'DEPARTMENT_HEAD', TEAM_HEAD: 'TEAM_HEAD', TEAM_MEMBER: 'TEAM_MEMBER' } as const;

/**
 * Employee approval. HR submits (a Team Lead adds team members directly, through the account form, with no request); the database resolves the approver from the role and department, activates the
 * account only in the approval itself, and enforces every rule again. The server never trusts an approver, a role check or a status from the browser.
 */
export class EmployeeApprovalService {
  constructor(
    private readonly repo: EmployeeApprovalRepository,
    private readonly authAdmin = new AuthAdminRepository()
  ) {}

  /** Used by the HR form only: the database refuses everybody who is not HR. */
  async submit(actor: Actor, body: unknown): Promise<EmployeeRequest> {
    return this.create(actor, parse(employeeRequestSchema, body));
  }

  async create(actor: Actor, input: EmployeeRequestInput): Promise<EmployeeRequest> {
    await this.repo.assertCanSubmit({ email: input.email, role: input.role, departmentId: input.departmentId, division: input.division });
    // an HR request carries one of the three HR designations that matches its role (HR Admin Head = Department Head, still approved by the usual approver)
    await this.repo.assertDesignationAllowed({ role: input.role, departmentId: input.departmentId, designation: input.details.designation });
    const id = await this.authAdmin.createEmployeeRequestUser({
      email: input.email, password: input.password ?? temporaryPassword(28), fullName: input.fullName, position: input.details.designation, role: DB_ROLE[input.role],
      operationsHead: input.role === 'OPERATIONS_HEAD', departmentId: input.departmentId, division: input.division, employeeCode: input.employeeCode, requestedBy: actor.id
    });
    try {
      await this.authAdmin.savePersonalDetails(id, input.details);
      // no sign-in until the approval succeeds (the database already refuses a pending profile; this also stops a session being issued)
      await this.authAdmin.setSignInBlocked(id, true);
      const mine = (await this.repo.list('PENDING', false)).find(r => r.employee?.id === id);
      if (!mine) throw new AppError('INTERNAL', 'The request could not be read back.');
      return mine;
    } catch (err) {
      // never leave an employee who has no request, details or block
      await this.authAdmin.deleteUser(id).catch(() => undefined);
      throw err;
    }
  }

  list(_actor: Actor, query: unknown): Promise<EmployeeRequest[]> {
    const q = parse(employeeRequestListQuerySchema, query);
    return this.repo.list(q.status ?? null, q.toDecide === 'true');
  }

  get(id: string): Promise<EmployeeRequest> {
    return this.repo.get(parse(uuidSchema, id));
  }

  async decide(_actor: Actor, id: string, body: unknown): Promise<EmployeeRequest> {
    const requestId = parse(uuidSchema, id);
    const input = parse(employeeDecisionSchema, body);
    const before = input.approve ? await this.repo.get(requestId) : null;
    const subject = before?.employee?.id;
    // sign-in is opened just before an approval and closed again if the approval does not go through, so the account is never active and blocked
    if (subject) await this.authAdmin.setSignInBlocked(subject, false);
    try {
      const request = await this.repo.decide(requestId, input.approve, input.note ?? null, input.departmentIds ?? null, input.primaryDepartmentIds ?? null);
      if (!input.approve && request.employee) await this.authAdmin.setSignInBlocked(request.employee.id, true);
      return request;
    } catch (err) {
      if (subject) await this.authAdmin.setSignInBlocked(subject, true);
      throw err;
    }
  }

  async resubmit(_actor: Actor, id: string, body: unknown): Promise<EmployeeRequest> {
    const input = parse(employeeResubmitSchema, body);
    return this.repo.resubmit(parse(uuidSchema, id), input);
  }

  // Super Admin: Operations Heads
  operationsHeads(actor: Actor): Promise<OperationsHeadsAdmin> {
    this.requireSuperAdmin(actor);
    return this.repo.operationsHeads();
  }
  setScope(actor: Actor, id: string, body: unknown): Promise<OperationsHeadAdmin> {
    this.requireSuperAdmin(actor);
    const input = parse(operationsScopeSchema, body);
    return this.repo.setScope(parse(uuidSchema, id), input.departmentIds, input.primaryDepartmentIds ?? null);
  }
  applyScope(actor: Actor, id: string, body: unknown): Promise<OperationsHeadAdmin> {
    this.requireSuperAdmin(actor);
    const input = parse(operationsScopeApplySchema, body);
    return this.repo.applyScope(parse(uuidSchema, id), input.function, input.departments);
  }
  functionScopeReview(actor: Actor): Promise<Record<string, unknown>> {
    this.requireSuperAdmin(actor);
    return this.repo.functionScopeReview();
  }
  headActivity(actor: Actor, id: string): Promise<OperationsActivityEntry[]> {
    this.requireSuperAdmin(actor);
    return this.repo.headActivity(parse(uuidSchema, id));
  }
  private requireSuperAdmin(actor: Actor) {
    if (actor.role !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN', 'Only the Super Admin can do this.');
  }

  // Operations Head
  dashboard(): Promise<OperationsDashboard> { return this.repo.dashboard(); }
  departmentActivity(id: string): Promise<OperationsActivityEntry[]> { return this.repo.departmentActivity(parse(uuidSchema, id)); }
  departmentDetail(id: string): Promise<OperationsDepartmentDetail> { return this.repo.departmentDetail(parse(uuidSchema, id)); }

  // Department Head
  directory(query: unknown): Promise<DepartmentEmployeeDirectory> {
    const departmentId = (query as { departmentId?: string } | undefined)?.departmentId;
    return this.repo.directory(departmentId ? parse(uuidSchema, departmentId) : null);
  }
  async assignToLead(_actor: Actor, memberId: string, body: unknown): Promise<null> {
    const input = parse(assignLeadSchema, body);
    await this.repo.assignToLead(parse(uuidSchema, memberId), input.leadId, input.note ?? null);
    return null;
  }
  assignments(memberId: string): Promise<TeamAssignmentRecord[]> { return this.repo.assignments(parse(uuidSchema, memberId)); }
}
