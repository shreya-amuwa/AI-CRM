import { getSupabase } from '../services/supabaseClient';
import { rupees } from './income';
import type { PayoutRequest } from './payouts';

/**
 * Employee Wallet (migration 20270206000100; docs/EMPLOYEE_WALLET.md). Like My Income and the payouts it reads and writes through database functions that
 * check the signed-in person: nothing here takes an employee id for the wallet itself, so there is no other person's wallet to ask for. The wallet is a
 * view over the incentive earnings and the withdrawals that already exist, plus Accounts' manual credits; the ledger is derived from them.
 */
export type TransactionType = 'SALARY_CREDIT' | 'INCENTIVE_CREDIT' | 'BONUS_CREDIT' | 'WALLET_ADJUSTMENT' | 'WITHDRAWAL_REQUEST' | 'WITHDRAWAL_PAYMENT' | 'REFUND' | 'REVERSAL';
export type TransactionStatus = 'CREDITED' | 'POSTED' | 'PENDING_APPROVAL' | 'REJECTED' | 'REQUESTED' | 'PROCESSING' | 'PAID' | 'CANCELLED' | 'FAILED' | 'REVERSED';
export type CreditKind = 'BONUS' | 'ADJUSTMENT' | 'REFUND';
export type CreditStatus = 'PENDING_APPROVAL' | 'CREDITED' | 'REJECTED';

export interface WalletSummary {
  eligible: boolean;
  balance: number;
  availableToWithdraw: number;
  /** A clawback took the wallet below zero: this much is recovered from future earnings. */
  toRecover: number;
  reserved: number;
  pending: { credits: number; creditCount: number; withdrawal: number };
  thisMonth: { incentives: number; bonuses: number; salaryExpected: number | null };
  incentives: { credited: number; reversed: number; pendingApproval: number; approved: number; paidOut: number };
  bonuses: { credited: number; pending: number };
  adjustments: { net: number; refunds: number };
  salary: {
    monthly: number | null; monthlyText: string | null; source: 'HR_RECORD' | null; expected: number | null; approved: number | null; credited: number | null;
    withdrawable: number; lastPaidOn: string | null; breakup: unknown; history: unknown[]; payrollTracked: boolean;
  };
  withdrawals: { total: number; minimum: number; opensOn: string | null; open: boolean; startAfterDays: number; openRequest: PayoutRequest | null };
}
export interface WalletTransaction {
  id: string; employeeId: string; type: TransactionType; amount: number; status: TransactionStatus; countsInBalance: boolean; source: string;
  department: string | null; team: string | null; description: string | null; date: string; reference: string | null;
  createdBy: string | null; approvedBy: string | null; updatedAt: string;
}
export interface WalletTransactions { items: WalletTransaction[]; total: number; balance: number }
export interface WalletMonth { month: string; incentives: number; reversed: number; bonuses: number; adjustments: number; withdrawn: number }
export interface WalletCredit {
  id: string; profileId: string; name: string; department: string | null; kind: CreditKind; amount: number; description: string; reference: string | null;
  status: CreditStatus; createdAt: string; createdBy: string | null; decidedAt: string | null; decidedBy: string | null; decisionNote: string | null;
}
export interface WalletPerson { id: string; name: string; email: string; role: string; department: string | null }
export interface WalletReport {
  from: string; to: string;
  salary: { monthlyPayable: number; employeesWithSalary: number; employeesWithoutSalary: number; payrollTracked: boolean };
  incentives: { generated: number; reversed: number; pendingApproval: number; credited: number };
  credits: { pendingCount: number; pendingAmount: number; credited: number };
  withdrawals: { requestedCount: number; requestedAmount: number; pendingCount: number; pendingAmount: number; paidCount: number; paidAmount: number; rejectedCount: number };
  departments: { departmentId: string | null; department: string; employees: number; incentives: number; credits: number; withdrawn: number }[];
  employees: { profileId: string; name: string; department: string | null; incentives: number; credits: number; withdrawn: number; available: number }[];
  months: { month: string; incentives: number; credits: number; withdrawn: number }[];
}
export interface TransactionFilter { from?: string; to?: string; type?: TransactionType | ''; limit?: number; offset?: number }

export const TYPE_LABEL: Record<TransactionType, string> = {
  SALARY_CREDIT: 'Salary Credit', INCENTIVE_CREDIT: 'Incentive Credit', BONUS_CREDIT: 'Bonus Credit', WALLET_ADJUSTMENT: 'Wallet Adjustment',
  WITHDRAWAL_REQUEST: 'Withdrawal Request', WITHDRAWAL_PAYMENT: 'Withdrawal Payment', REFUND: 'Refund', REVERSAL: 'Reversal'
};
export const STATUS_LABEL: Record<TransactionStatus, string> = {
  CREDITED: 'Credited', POSTED: 'Posted', PENDING_APPROVAL: 'Pending approval', REJECTED: 'Rejected', REQUESTED: 'Requested · pending approval', PROCESSING: 'Processing',
  PAID: 'Paid', CANCELLED: 'Cancelled', FAILED: 'Failed', REVERSED: 'Reversed'
};
export const STATUS_TONE: Record<TransactionStatus, string> = {
  CREDITED: 'bg-emerald-50 text-emerald-800', POSTED: 'bg-slate-100 text-slate-700', PENDING_APPROVAL: 'bg-amber-50 text-amber-800', REJECTED: 'bg-rose-50 text-rose-700',
  REQUESTED: 'bg-amber-50 text-amber-800', PROCESSING: 'bg-sky-50 text-sky-800', PAID: 'bg-emerald-50 text-emerald-800', CANCELLED: 'bg-slate-100 text-slate-600',
  FAILED: 'bg-rose-50 text-rose-700', REVERSED: 'bg-rose-50 text-rose-700'
};
export const CREDIT_KIND_LABEL: Record<CreditKind, string> = { BONUS: 'Bonus', ADJUSTMENT: 'Adjustment', REFUND: 'Refund' };

/** "+₹5,000" for money that came in, "-₹1,000" for money that went out. */
export const signedRupees = (n: number) => `${n < 0 ? '-' : '+'}${rupees(Math.abs(n))}`;
/** "2026-11" as "Nov 2026". */
export const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const db = getSupabase();
  if (!db) throw new Error('The CRM is not connected to its database.');
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message.replace(/^[A-Z_]+:\s*/, ''));
  return data as T;
}

export const walletApi = {
  summary: () => rpc<WalletSummary>('wallet_summary'),
  transactions: (f: TransactionFilter = {}) =>
    rpc<WalletTransactions>('wallet_transactions', { p_from: f.from || null, p_to: f.to || null, p_type: f.type || null, p_limit: f.limit ?? 30, p_offset: f.offset ?? 0 }),
  monthly: (months = 12) => rpc<WalletMonth[]>('wallet_monthly', { p_months: months }),
  // Accounts (and the Super Admin): wallet credits, and the report for Accounts, HR and the Super Admin
  people: (search: string) => rpc<WalletPerson[]>('wallet_people', { p_search: search }),
  createCredit: (c: { profileId: string; kind: CreditKind; amount: number; description: string; reference?: string; requestId: string }) =>
    rpc<WalletCredit>('wallet_credit_create', { p_profile: c.profileId, p_kind: c.kind, p_amount: c.amount, p_description: c.description, p_reference: c.reference || null, p_request_id: c.requestId }),
  credits: (status: CreditStatus | null = 'PENDING_APPROVAL') => rpc<WalletCredit[]>('wallet_credit_queue', { p_status: status }),
  decideCredit: (id: string, approve: boolean, note?: string) => rpc<WalletCredit>('wallet_credit_decide', { p_id: id, p_approve: approve, p_note: note || null }),
  report: (from?: string, to?: string) => rpc<WalletReport>('wallet_report', { p_from: from || null, p_to: to || null })
};
