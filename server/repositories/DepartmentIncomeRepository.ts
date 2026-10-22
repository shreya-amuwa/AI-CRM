import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttributionReconciliation, ClientPurchaseRule, DepartmentIncomeReport } from '../../shared/contracts.js';
import type { DepartmentIncomeQuery, OrderAttributionInput } from '../../shared/validation.js';
import { unwrap } from './base.js';

/**
 * Department income: every call is a database function that decides from the caller's own login what they may read or change
 * (the Super Admin and Accounts: every department; a Department Head: their own). Nothing here names a department for anybody.
 */
export class DepartmentIncomeRepository {
  constructor(private readonly db: SupabaseClient) {}

  async report(q: DepartmentIncomeQuery): Promise<DepartmentIncomeReport> {
    return unwrap(await this.db.rpc('department_income_report', { p_department: q.departmentId ?? null, p_from: q.from ?? null, p_to: q.to ?? null })) as DepartmentIncomeReport;
  }

  async reconciliation(): Promise<AttributionReconciliation> {
    return unwrap(await this.db.rpc('attribution_reconciliation')) as AttributionReconciliation;
  }

  async setOrderAttribution(i: OrderAttributionInput) {
    return unwrap(await this.db.rpc('set_order_attribution', { p_order_key: i.orderKey, p_division: i.division, p_department: i.departmentId, p_reason: i.reason }));
  }

  async setCustomerAcquisition(customerId: string, division: string, reason: string) {
    return unwrap(await this.db.rpc('set_customer_acquisition', { p_customer: customerId, p_division: division, p_reason: reason }));
  }

  async settings(): Promise<{ clientPurchaseAttribution: ClientPurchaseRule; updatedAt: string }> {
    return unwrap(await this.db.rpc('revenue_attribution_settings_get')) as { clientPurchaseAttribution: ClientPurchaseRule; updatedAt: string };
  }

  async setSettings(rule: ClientPurchaseRule) {
    return unwrap(await this.db.rpc('set_revenue_attribution_settings', { p_client_purchase: rule }));
  }
}
