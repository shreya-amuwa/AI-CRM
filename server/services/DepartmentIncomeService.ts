import type { AttributionReconciliation, ClientPurchaseRule, DepartmentIncomeReport } from '../../shared/contracts.js';
import { customerAcquisitionSchema, departmentIncomeQuerySchema, orderAttributionSchema, revenueSettingsSchema, uuidSchema } from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { DepartmentIncomeRepository } from '../repositories/DepartmentIncomeRepository.js';

/**
 * Department-wise income from the recorded attribution of each order (see docs/DEPARTMENT_INCOME.md). The validation here is only about
 * the shape of the request; who may read or change what, and every business rule, is enforced in the database.
 */
export class DepartmentIncomeService {
  constructor(private readonly repo: DepartmentIncomeRepository) {}

  report(query: unknown): Promise<DepartmentIncomeReport> {
    return this.repo.report(parse(departmentIncomeQuerySchema, query ?? {}));
  }

  reconciliation(): Promise<AttributionReconciliation> {
    return this.repo.reconciliation();
  }

  setOrderAttribution(body: unknown) {
    return this.repo.setOrderAttribution(parse(orderAttributionSchema, body));
  }

  setCustomerAcquisition(customerId: string, body: unknown) {
    const i = parse(customerAcquisitionSchema, body);
    return this.repo.setCustomerAcquisition(parse(uuidSchema, customerId), i.division, i.reason);
  }

  settings() {
    return this.repo.settings();
  }

  setSettings(body: unknown) {
    return this.repo.setSettings(parse(revenueSettingsSchema, body).clientPurchaseAttribution as ClientPurchaseRule);
  }
}
