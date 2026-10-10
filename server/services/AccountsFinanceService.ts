import type { ExpensesPage, FinanceSummary, FinanceTrend, IncomePage } from '../../shared/contracts.js';
import {
  expenseImportSchema,
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

  income(query: unknown): Promise<IncomePage> {
    return this.repo.income(parse(incomeQuerySchema, query ?? {}));
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
