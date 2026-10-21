import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuditEvent, CompanyOverview, Paginated, ScopeOverview } from '../../shared/contracts.js';
import { unwrap } from './base.js';

export interface AuditSearch {
  q?: string;
  action?: string;
  outcome?: string;
  entityType?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

/**
 * Dashboards and the audit viewer: read-only database functions. The company overview is checked inside the database (Super Admin only);
 * the scoped overview and the audit search run as the caller, so row-level security decides what they see.
 */
export class DashboardRepository {
  constructor(private readonly db: SupabaseClient) {}

  async companyOverview(): Promise<CompanyOverview> {
    return unwrap(await this.db.rpc('dashboard_company_overview')) as CompanyOverview;
  }

  async scopeOverview(departmentId?: string): Promise<ScopeOverview> {
    return unwrap(await this.db.rpc('dashboard_scope_overview', { p_department: departmentId ?? null })) as ScopeOverview;
  }

  async auditSearch(f: AuditSearch): Promise<Paginated<AuditEvent>> {
    const r = unwrap(
      await this.db.rpc('audit_log_search', {
        p_search: f.q ?? null,
        p_action: f.action ?? null,
        p_outcome: f.outcome ?? null,
        p_entity_type: f.entityType ?? null,
        p_from: f.from ?? null,
        p_to: f.to ?? null,
        p_page: f.page,
        p_page_size: f.pageSize
      })
    ) as { items: AuditEvent[]; total: number; page: number; pageSize: number };
    return { items: r.items, total: r.total, page: r.page, pageSize: r.pageSize };
  }

  async auditActions(): Promise<string[]> {
    return unwrap(await this.db.rpc('audit_log_actions')) as string[];
  }

  async recordExport(dataset: string, rows: number, note: string | null): Promise<void> {
    unwrap(await this.db.rpc('record_data_export', { p_dataset: dataset, p_rows: rows, p_note: note }));
  }
}
