import type { CustomerRevenuePage, FinanceMailList, DepartmentFinance, ExpensesPage, FinanceSummary, FinanceTrend, IncomePage } from '../../shared/contracts.js';
import {
  customerRevenueQuerySchema,
  expenseImportSchema,
  financeMailQuerySchema,
  expenseSchema,
  expensesQuerySchema,
  financeSummaryQuerySchema,
  incomeQuerySchema,
  trendQuerySchema,
  uuidSchema
} from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { AccountsFinanceRepository } from '../repositories/AccountsFinanceRepository.js';

/** Accounts finance: totals, income, expenses and analytics from the real records. */
export class AccountsFinanceService {
  constructor(private readonly repo: AccountsFinanceRepository) {}

  summary(query: unknown): Promise<FinanceSummary> {
    return this.repo.summary(parse(financeSummaryQuerySchema, query ?? {}));
  }

  /** Every department's earnings and expenses (one call). */
  byDepartment(): Promise<DepartmentFinance[]> {
    return this.repo.byDepartment();
  }

  income(query: unknown): Promise<IncomePage> {
    return this.repo.income(parse(incomeQuerySchema, query ?? {}));
  }

  /** Customer-wise revenue: what each customer ordered, was invoiced, paid (verified), has pending and still owes. */
  customerRevenue(query: unknown): Promise<CustomerRevenuePage> {
    return this.repo.customerRevenue(parse(customerRevenueQuerySchema, query ?? {}));
  }

  /** The Department Head e-mails about payments and expenses, with the status of each recipient. */
  financeMail(query: unknown): Promise<FinanceMailList> {
    const q = parse(financeMailQuerySchema, query ?? {});
    return this.repo.financeMail(q.status, q.limit);
  }

  retryFinanceMail(id: string): Promise<{ queued: number }> {
    return this.repo.retryFinanceMail(parse(uuidSchema, id));
  }

  expenses(query: unknown): Promise<ExpensesPage> {
    return this.repo.expenses(parse(expensesQuerySchema, query ?? {}));
  }

  async addExpense(body: unknown): Promise<{ id: string }> {
    return { id: await this.repo.addExpense(parse(expenseSchema, body)) };
  }

  async updateExpense(id: string, body: unknown): Promise<void> {
    await this.repo.updateExpense(parse(uuidSchema, id), parse(expenseSchema, body));
  }

  async deleteExpense(id: string): Promise<void> {
    await this.repo.deleteExpense(parse(uuidSchema, id));
  }

  importExpenses(body: unknown): Promise<{ inserted: number; updated: number }> {
    const input = parse(expenseImportSchema, body);
    return this.repo.importExpenses(input.source, input.rows);
  }

  trend(query: unknown): Promise<FinanceTrend> {
    return this.repo.trend(parse(trendQuerySchema, query ?? {}).months);
  }
}
