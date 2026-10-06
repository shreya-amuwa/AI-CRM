import type { ApprovalRequest, Paginated } from '../../shared/contracts.js';
import { approvalDecisionSchema, approvalListQuerySchema, uuidSchema } from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { assertManager } from '../authz/policies.js';
import { parse } from '../http/validate.js';
import { ApprovalRepository } from '../repositories/ApprovalRepository.js';
import { AuthAdminRepository } from '../repositories/AuthAdminRepository.js';

/**
 * Registration approvals. Requests are created by the database on sign-up;
 * decisions run in `approve_registration` / `reject_registration`, which
 * check the hierarchy, flip the account status and write audit +
 * notifications atomically.
 */
export class ApprovalService {
  constructor(
    private readonly approvals: ApprovalRepository,
    private readonly authAdmin = new AuthAdminRepository()
  ) {}

  list(actor: Actor, query: unknown): Promise<Paginated<ApprovalRequest>> {
    assertManager(actor);
    const { status, page, pageSize } = parse(approvalListQuerySchema, query);
    return this.approvals.list(status, { page, pageSize });
  }

  async approve(actor: Actor, id: string, body: unknown): Promise<ApprovalRequest> {
    assertManager(actor);
    const requestId = parse(uuidSchema, id);
    const { teamId, note } = parse(approvalDecisionSchema, body ?? {});
    await this.approvals.approve(requestId, teamId, note);
    return this.approvals.findById(requestId);
  }

  async reject(actor: Actor, id: string, body: unknown): Promise<ApprovalRequest> {
    assertManager(actor);
    const requestId = parse(uuidSchema, id);
    const { note } = parse(approvalDecisionSchema, body ?? {});
    await this.approvals.reject(requestId, note);
    const request = await this.approvals.findById(requestId);
    if (request.subject) await this.authAdmin.setSignInBlocked(request.subject.id, true);
    return request;
  }
}
