import type { SupabaseClient } from '@supabase/supabase-js';
import type { DepartmentFinance, ExpensesPage, FinanceSummary, FinanceTrend, IncomePage } from '../../shared/contracts.js';
import type { ExpenseInput } from '../../shared/validation.js';
import { unwrap } from './base.js';

/** Accounts finance: every call is a database function that checks Accounts access itself. */
export class AccountsFinanceRepository {
  constructor(private readonly db: SupabaseClient) {}

  async summary(q: { departmentId?: string; from?: string; to?: string }): Promise<FinanceSummary> {
    return unwrap(await this.db.rpc('accounts_finance_summary', { p_department: q.departmentId ?? null, p_from: q.from ?? null, p_to: q.to ?? null })) as FinanceSummary;
  }

  async byDepartment(): Promise<DepartmentFinance[]> {
    return unwrap(await this.db.rpc('accounts_finance_by_department')) as DepartmentFinance[];
  }

  async income(q: { search?: string; departmentId?: string; from?: string; to?: string; page: number; pageSize: number }): Promise<IncomePage> {
    return unwrap(
      await this.db.rpc('accounts_income_list', {
        p_search: q.search ?? null,
        p_department: q.departmentId ?? null,
        p_from: q.from ?? null,
        p_to: q.to ?? null,
        p_page: q.page,
        p_page_size: q.pageSize
      })
    ) as IncomePage;
  }

  async expenses(q: {
    search?: string;
    departmentId?: string;
    companyWide?: boolean;
    category?: string;
    status?: string;
    from?: string;
    to?: string;
    page: number;
    pageSize: number;
  }): Promise<ExpensesPage> {
    return unwrap(
      await this.db.rpc('accounts_expenses_list', {
        p_search: q.search ?? null,
        p_department: q.departmentId ?? null,
        p_company_wide: q.companyWide ?? false,
        p_category: q.category ?? null,
        p_status: q.status ?? null,
        p_from: q.from ?? null,
        p_to: q.to ?? null,
        p_page: q.page,
        p_page_size: q.pageSize
      })
    ) as ExpensesPage;
  }

  async addExpense(e: ExpenseInput): Promise<string> {
    return unwrap(
      await this.db.rpc('accounts_add_expense', {
        p_date: e.date,
        p_description: e.description,
        p_department: e.departmentId ?? null,
        p_category: e.category,
        p_amount: e.amount,
        p_status: e.status,
        p_notes: e.notes ?? null
      })
    ) as string;
  }

  async updateExpense(id: string, e: ExpenseInput): Promise<void> {
    unwrap(
      await this.db.rpc('accounts_update_expense', {
        p_id: id,
        p_date: e.date,
        p_description: e.description,
        p_department: e.departmentId ?? null,
        p_category: e.category,
        p_amount: e.amount,
        p_status: e.status,
        p_notes: e.notes ?? null
      })
    );
  }

  async deleteExpense(id: string): Promise<void> {
    unwrap(await this.db.rpc('accounts_delete_expense', { p_id: id }));
  }

  async importExpenses(source: string, rows: unknown[]): Promise<{ inserted: number; updated: number }> {
    return unwrap(await this.db.rpc('accounts_import_expenses', { p_rows: rows, p_source: source })) as { inserted: number; updated: number };
  }

  async trend(months: number): Promise<FinanceTrend> {
    return unwrap(await this.db.rpc('accounts_finance_trend', { p_months: months })) as FinanceTrend;
  }
}
