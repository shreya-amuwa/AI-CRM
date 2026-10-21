import type { AuditEvent, CompanyOverview, Paginated, ScopeOverview } from '../../shared/contracts.js';
import { auditSearchQuerySchema, dashboardScopeQuerySchema, dataExportSchema } from '../../shared/validation.js';
import type { Actor } from '../auth/authenticate.js';
import { assertManager, assertSuperAdmin } from '../authz/policies.js';
import { parse } from '../http/validate.js';
import { DashboardRepository } from '../repositories/DashboardRepository.js';

/**
 * The dashboards' figures and the audit viewer. These checks only fail fast with a clear message: the database functions check the
 * caller again (the company overview is Super Admin only there; the scoped overview and the audit search read through row-level security).
 */
export class DashboardService {
  constructor(private readonly repo: DashboardRepository) {}

  companyOverview(actor: Actor): Promise<CompanyOverview> {
    assertSuperAdmin(actor);
    return this.repo.companyOverview();
  }

  scopeOverview(actor: Actor, query: unknown): Promise<ScopeOverview> {
    assertManager(actor);
    const q = parse(dashboardScopeQuerySchema, query ?? {});
    // only the Super Admin chooses a department; for everyone else the database uses their own
    return this.repo.scopeOverview(actor.role === 'SUPER_ADMIN' ? q.departmentId : undefined);
  }

  auditSearch(actor: Actor, query: unknown): Promise<Paginated<AuditEvent>> {
    assertManager(actor);
    return this.repo.auditSearch(parse(auditSearchQuerySchema, query ?? {}));
  }

  auditActions(actor: Actor): Promise<string[]> {
    assertManager(actor);
    return this.repo.auditActions();
  }

  async recordExport(body: unknown): Promise<null> {
    const input = parse(dataExportSchema, body);
    await this.repo.recordExport(input.dataset, input.rows, input.note ?? null);
    return null;
  }
}
