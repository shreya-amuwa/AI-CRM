import { getSupabase } from '../services/supabaseClient';

/**
 * Sales incentives and the "Income" page (migrations 20270119000100, 20270121000100; docs/SALES_INCENTIVES.md). Every figure comes from
 * the database, which decides who may read and set what: a person reads only their own earnings; the Super Admin sets the rules; each sales
 * head and Team Lead sets the amount for the people directly below them.
 */
export type IncentiveEvent = 'SALE_PAID' | 'DEMO_COMPLETED' | 'VISIT_COMPLETED';
export type IncentiveScope = 'OPERATIONS_HEAD' | 'LEVEL' | 'SUB_ROLE' | 'DEPARTMENT' | 'TEAM' | 'PERSON';
export type EarningRole = 'CLOSER' | 'TELECALLER' | 'BUSINESS_ASSOCIATE' | 'TEAM_LEAD' | 'DEPARTMENT_HEAD' | 'OPERATIONS_HEAD' | 'PARTICIPANT';

export interface IncomeTarget { ruleId: string; name: string; serviceName: string | null; targetUnits: number; unitsDone: number }
export interface IncomeSummary {
  startsOn: string; eligible: boolean;
  today: number; month: number; total: number; balance: number;
  /** Payouts (20270123000100): paid out so far; earned - paid - the open request (negative = to be recovered); when withdrawals open. */
  withdrawn?: number; available?: number; withdrawOpensOn?: string | null; withdrawOpen?: boolean; startAfterDays?: number;
  openRequest?: import('./payouts').PayoutRequest | null;
  targets: IncomeTarget[];
  activity: { businessThisMonth: number; demosCompletedThisMonth: number; visitsCompletedThisMonth: number };
}
export interface Earning {
  id: string; earnedAt: string; eventType: IncentiveEvent; role: EarningRole; amount: number; status: 'EARNED' | 'REVERSED';
  reversedAt: string | null; customerName: string | null; serviceName: string | null; ruleName: string;
}

export interface IncentiveRule {
  id: string; name: string; eventType: IncentiveEvent; serviceCode: string | null; serviceName: string | null; amount: number;
  targetUnits: number | null; scopeType: IncentiveScope; scopeValue: string | null; monthlyCap: number | null;
  activeFrom: string; activeTo: string | null; endedAt: string | null; active: boolean;
}
export interface GivenRow { recipientId: string; name: string; level: string; amount: number; kept: number }
/** current: not stopped and not past its end date (a rule that starts later is current, though not yet active). */
export interface SetupRule extends IncentiveRule { myAmount: number; given: GivenRow[]; kept: number; earnedCount: number | null; current?: boolean }
export interface IncentiveOptions {
  services: { code: string; name: string }[];
  operationsHeads: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  teams: { id: string; name: string; departmentId: string }[];
  people: { id: string; name: string }[];
}
export interface IncentiveSetupData {
  rules: SetupRule[];
  reports: { profileId: string; name: string; level: string }[];
  split: { departmentId: string | null; telecallerPct: number } | null;
  canSplit: boolean; isAdmin: boolean; startAfterDays: number;
  options: IncentiveOptions | null;
}
/** What the Super Admin's rule form sends (incentive_rule_create / incentive_rule_update). */
export interface RuleInput {
  name: string; eventType: IncentiveEvent; serviceCode?: string | null; amount: number; targetUnits?: number | null;
  scopeType: IncentiveScope; scopeValue?: string | null; monthlyCap?: number | null;
}

export const EVENT_LABEL: Record<IncentiveEvent, string> = { SALE_PAID: 'Sale paid', DEMO_COMPLETED: 'Demo completed', VISIT_COMPLETED: 'Field visit completed' };
export const ROLE_LABEL: Record<EarningRole, string> = {
  CLOSER: 'Your sale', TELECALLER: 'Telecaller share', BUSINESS_ASSOCIATE: 'Business Associate share', TEAM_LEAD: 'Team Lead share',
  DEPARTMENT_HEAD: 'Department Head share', OPERATIONS_HEAD: 'Operations Head share', PARTICIPANT: 'Reward'
};
export const SCOPE_LABEL: Record<IncentiveScope, string> = {
  OPERATIONS_HEAD: 'Operations Head', LEVEL: 'Everyone at a level', SUB_ROLE: 'A sales role', DEPARTMENT: 'A department', TEAM: 'A team', PERSON: 'One person'
};
export const LEVELS = [
  { value: 'TEAM_MEMBER', label: 'Team Members' }, { value: 'TEAM_HEAD', label: 'Team Leads' }, { value: 'DEPARTMENT_HEAD', label: 'Department Heads' }
];
export const SUB_ROLES = [
  { value: 'TELECALLER', label: 'Telecallers' }, { value: 'BUSINESS_ASSOCIATE', label: 'Business Associates' }, { value: 'VISIT_SALES', label: 'Visit Sales (field)' },
  { value: 'INFLUENCER', label: 'Influencers' }, { value: 'BUSINESS_PARTNER', label: 'Business Partners' }
];

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const rupees = (n: number | null | undefined) => inr.format(Number(n ?? 0));
const num = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
export const units = (n: number) => num.format(n);

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const db = getSupabase();
  if (!db) throw new Error('The CRM is not connected to its database.');
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message.replace(/^[A-Z_]+:\s*/, ''));
  return data as T;
}

export const incomeApi = {
  summary: () => rpc<IncomeSummary>('income_summary'),
  earnings: (from: string, to: string, limit = 200) => rpc<Earning[]>('income_earnings', { p_from: from, p_to: to, p_limit: limit }),
  setup: () => rpc<IncentiveSetupData>('incentive_setup'),
  createRule: (r: RuleInput) => rpc<string>('incentive_rule_create', { p: r }),
  updateRule: (id: string, changes: Partial<RuleInput>) => rpc<IncentiveRule>('incentive_rule_update', { p_rule: id, p: changes }),
  endRule: (id: string) => rpc<IncentiveRule>('incentive_rule_end', { p_rule: id }),
  deleteRule: (id: string) => rpc<{ id: string; deleted: boolean; ended: boolean }>('incentive_rule_delete', { p_rule: id }),
  setAllocation: (ruleId: string, recipientId: string, amount: number) =>
    rpc<unknown>('incentive_allocation_set', { p_rule: ruleId, p_recipient: recipientId, p_amount: amount }),
  setSplit: (departmentId: string, telecallerPct: number) => rpc<{ departmentId: string; telecallerPct: number }>('incentive_split_set', { p_department: departmentId, p_telecaller_pct: telecallerPct }),
  setStartAfterDays: (days: number) => rpc<{ startAfterDays: number }>('incentive_settings_set', { p_days: days }),
  setDemoAuthorised: (demoId: string, attended: boolean) =>
    rpc<{ id: string; status: string; authorisedPersonAttended: boolean }>('ba_demo_set_authorised', { p_demo: demoId, p_attended: attended })
};
