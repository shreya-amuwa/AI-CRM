import type { AuditLog, Paginated } from '../../shared/contracts.js';
import { auditListQuerySchema } from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { assertManager } from '../authz/policies.js';
import { parse } from '../http/validate.js';
import { AuditRepository } from '../repositories/AuditRepository.js';

export class AuditService {
  constructor(private readonly audit: AuditRepository) {}

  list(actor: Actor, query: unknown): Promise<Paginated<AuditLog>> {
    assertManager(actor);
    return this.audit.list(parse(auditListQuerySchema, query));
  }
}
