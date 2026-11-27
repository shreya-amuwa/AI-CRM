// A stand-in Supabase client for the wallet browser test: the wallet functions (summary, ledger, monthly, credits, report) and the payout functions the
// Withdrawals tab uses, with a record of every call. The ledger is built the way the database builds it (earnings, credits, withdrawals), so the balance is
// always the sum of its counted rows. Synthetic data only.
const calls: { fn: string; args: any }[] = [];
(window as any).__calls = calls;
const state: any = (window as any).__state = {
  eligible: true, fail: false, open: true, opensOn: '2026-01-16', startAfterDays: 15, salaryText: '₹25,000 per month', salary: 25000,
  earnings: [
    { id: 'e1', at: '2026-11-18T06:00:00Z', amount: 5000, reversed: false, desc: 'Sale incentive · WhatsApp API · Acme Traders' },
    { id: 'e2', at: '2026-11-10T06:00:00Z', amount: 800, reversed: true, desc: 'Demo reward · Beta Stores' }
  ],
  credits: [
    { id: 'c1', kind: 'BONUS', amount: 2000, status: 'CREDITED', at: '2026-11-15T06:00:00Z', desc: 'Diwali bonus', createdBy: 'Anil Accounts', approvedBy: 'Dev Accounts' },
    { id: 'c2', kind: 'BONUS', amount: 1500, status: 'PENDING_APPROVAL', at: '2026-11-19T06:00:00Z', desc: 'Target bonus', createdBy: 'Anil Accounts', approvedBy: null }
  ],
  requests: [] as any[], method: null as any, extraRows: 0,
  // Accounts side
  queue: [] as any[], people: [{ id: 'p1', name: 'Meera Member', email: 'meera@x.in', role: 'TEAM_MEMBER', department: 'Sales' }, { id: 'p2', name: 'Meena Support', email: 'meena@x.in', role: 'TEAM_MEMBER', department: 'Support' }],
  decideError: null as string | null
};
let n = 0;
const fail = (m: string) => { throw new Error(m); };
const paid = () => state.requests.filter((r: any) => r.status === 'PAID').reduce((s: number, r: any) => s + r.amount, 0);
const openReq = () => state.requests.find((r: any) => r.status === 'REQUESTED' || r.status === 'PROCESSING') ?? null;
const incentives = () => state.earnings.filter((e: any) => !e.reversed).reduce((s: number, e: any) => s + e.amount, 0);
const credited = () => state.credits.filter((c: any) => c.status === 'CREDITED').reduce((s: number, c: any) => s + c.amount, 0);
const balance = () => incentives() + credited() - paid();
const available = () => balance() - (openReq()?.amount ?? 0);
const ledger = () => {
  const rows: any[] = [];
  state.earnings.forEach((e: any) => {
    rows.push({ id: `E-${e.id}`, type: 'INCENTIVE_CREDIT', amount: e.amount, status: 'CREDITED', countsInBalance: true, source: 'SALE_PAID', description: e.desc, date: e.at, reference: `EARN-${e.id}`, createdBy: null, approvedBy: null });
    if (e.reversed) rows.push({ id: `R-${e.id}`, type: 'REVERSAL', amount: -e.amount, status: 'POSTED', countsInBalance: true, source: 'SALE_PAID', description: `Reversed: ${e.desc}`, date: '2026-11-12T06:00:00Z', reference: `EARN-${e.id}`, createdBy: null, approvedBy: null });
  });
  state.credits.forEach((c: any) => rows.push({ id: `C-${c.id}`, type: c.kind === 'BONUS' ? 'BONUS_CREDIT' : c.kind === 'REFUND' ? 'REFUND' : 'WALLET_ADJUSTMENT', amount: c.amount, status: c.status, countsInBalance: c.status === 'CREDITED',
    source: 'MANUAL', description: c.desc, date: c.at, reference: null, createdBy: c.createdBy, approvedBy: c.approvedBy }));
  state.requests.forEach((r: any) => rows.push({ id: `W-${r.id}`, type: r.status === 'PAID' ? 'WITHDRAWAL_PAYMENT' : 'WITHDRAWAL_REQUEST', amount: -r.amount, status: r.status, countsInBalance: r.status === 'PAID', source: 'WITHDRAWAL',
    description: r.reason ? `Withdrawal · Reason: ${r.reason}` : 'Withdrawal', date: r.requestedAt, reference: r.reference, createdBy: 'Meera Member', approvedBy: r.decidedBy }));
  for (let i = 0; i < state.extraRows; i++) rows.push({ id: `X-${i}`, type: 'INCENTIVE_CREDIT', amount: 10 + i, status: 'CREDITED', countsInBalance: true, source: 'VISIT_COMPLETED', description: `Extra row ${i}`, date: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T06:00:00Z`, reference: null, createdBy: null, approvedBy: null });
  return rows.map(r => ({ employeeId: 'me', department: 'Sales', team: 'Sales A', updatedAt: r.date, ...r })).sort((a, b) => b.date.localeCompare(a.date));
};
const mask = (m: any) => m;
const month = (ym: string, inc: number, bon: number, rev: number, wd: number) => ({ month: ym, incentives: inc, reversed: rev, bonuses: bon, adjustments: 0, withdrawn: wd });
// the Wallet PIN (20270222000100, 4 digits since 20270228000100): by default set and unlocked, so the wallet's own checks run as before; the PIN section of the test changes it
state.pin = { hasPin: true, pin: '4829', unlocked: true, fails: 0, lockedUntil: null as string | null, code: 'ABCD2345', legacy: false };
const locked = () => { if (!state.pin.unlocked) fail('WALLET_LOCKED: Enter your Wallet PIN.'); };
const pinCheck = (p: string, c: string) => {
  if (!/^[0-9]{4}$/.test(p ?? '')) fail('VALIDATION_ERROR: The PIN must be exactly 4 digits.');
  if (p !== c) fail('VALIDATION_ERROR: The two PINs do not match.');
  if (/^(.)\1{3}$/.test(p) || p === '1234') fail('VALIDATION_ERROR: Choose a PIN that is harder to guess (not the same digit four times or a simple sequence).');
};
const handlers: Record<string, (a: any) => any> = {
  wallet_pin_status: () => ({ hasPin: state.pin.hasPin, legacy: state.pin.legacy, pinLength: state.pin.legacy ? 6 : 4, unlocked: state.pin.unlocked && !state.pin.legacy, unlockExpiresAt: null, lockedUntil: state.pin.lockedUntil, triesLeft: 5 - state.pin.fails }),
  wallet_pin_set: (a: any) => { pinCheck(a.p_pin, a.p_confirm); if (state.pin.hasPin) fail('CONFLICT: Your Wallet PIN is already set.'); Object.assign(state.pin, { hasPin: true, pin: a.p_pin, unlocked: true }); return { unlocked: true }; },
  wallet_pin_unlock: (a: any) => {
    if (state.pin.lockedUntil) return { unlocked: false, triesLeft: 0, lockedUntil: state.pin.lockedUntil };
    if (a.p_pin === state.pin.pin) { if (state.pin.legacy) return { unlocked: false, mustChange: true, triesLeft: 5 }; Object.assign(state.pin, { unlocked: true, fails: 0 }); return { unlocked: true, triesLeft: 5 }; }
    state.pin.fails++;
    if (state.pin.fails >= 5) { state.pin.fails = 0; state.pin.lockedUntil = '2026-11-21T10:15:00Z'; return { unlocked: false, triesLeft: 0, lockedUntil: state.pin.lockedUntil }; }
    return { unlocked: false, triesLeft: 5 - state.pin.fails };
  },
  wallet_pin_change: (a: any) => { pinCheck(a.p_new, a.p_confirm); if (a.p_old !== state.pin.pin) { state.pin.fails++; return { unlocked: false, changed: false, triesLeft: 5 - state.pin.fails }; } state.pin.pin = a.p_new; state.pin.legacy = false; state.pin.unlocked = true; return { unlocked: true, changed: true }; },
  wallet_pin_lock: () => { state.pin.unlocked = false; return null; },
  wallet_pin_reset_finish: (a: any) => { pinCheck(a.p_pin, a.p_confirm); if (String(a.p_code).toUpperCase() !== state.pin.code) return { reset: false, triesLeft: 4 }; Object.assign(state.pin, { pin: a.p_pin, unlocked: true, lockedUntil: null, fails: 0 }); return { reset: true, unlocked: true }; },
  wallet_summary: () => {
    locked();
    if (state.fail) fail('The wallet is unavailable right now.');
    if (!state.eligible) return { eligible: false };
    const op = openReq();
    return {
      eligible: true, balance: balance(), availableToWithdraw: Math.max(available(), 0), toRecover: Math.max(-available(), 0), reserved: op?.amount ?? 0,
      pending: { credits: state.credits.filter((c: any) => c.status === 'PENDING_APPROVAL' && c.amount > 0).reduce((s: number, c: any) => s + c.amount, 0), creditCount: state.credits.filter((c: any) => c.status === 'PENDING_APPROVAL').length, withdrawal: op?.amount ?? 0 },
      thisMonth: { incentives: incentives(), bonuses: credited(), salaryExpected: state.salary },
      incentives: { credited: incentives(), reversed: 800, pendingApproval: 0, approved: 0, paidOut: paid() },
      bonuses: { credited: credited(), pending: 1500 }, adjustments: { net: 0, refunds: 0 },
      salary: { monthly: state.salary, monthlyText: state.salaryText, source: state.salaryText ? 'HR_RECORD' : null, expected: state.salary, approved: null, credited: null, withdrawable: 0, lastPaidOn: null, breakup: null, history: [], payrollTracked: false },
      withdrawals: { total: paid(), minimum: 500, opensOn: state.opensOn, open: state.open, startAfterDays: state.startAfterDays, openRequest: op }
    };
  },
  wallet_transactions: a => {
    locked();
    if (state.fail) fail('The transactions are unavailable.');
    let rows = ledger();
    if (a.p_type) rows = rows.filter(r => r.type === a.p_type);
    if (a.p_from) rows = rows.filter(r => r.date.slice(0, 10) >= a.p_from);
    if (a.p_to) rows = rows.filter(r => r.date.slice(0, 10) <= a.p_to);
    return { items: rows.slice(a.p_offset, a.p_offset + a.p_limit), total: rows.length, balance: balance() };
  },
  wallet_monthly: a => (locked(), [month('2026-11', incentives(), credited(), 800, paid()), month('2026-10', 1200, 0, 0, 0), month('2026-09', 0, 0, 0, 0)].slice(0, a.p_months)),
  payout_method_get: () => state.method,
  payout_method_save: a => { state.method = { ...a.p, ifsc: a.p.ifsc ? String(a.p.ifsc).toUpperCase() : null }; return state.method; },
  payout_request: a => {
    if (!state.method) fail('VALIDATION_ERROR: Add your payout details first.');
    if (a.p_amount > available()) fail(`VALIDATION_ERROR: You can withdraw up to ₹${available()}.`);
    if (openReq()) fail('CONFLICT: You already have a withdrawal waiting. Cancel it or wait until Accounts pays it.');
    const r = { id: `pr-${++n}`, profileId: 'me', name: 'Meera Member', department: 'Sales', amount: a.p_amount, status: 'REQUESTED', requestedAt: '2026-11-21T06:00:00Z', decidedAt: null, decidedBy: null,
      channel: null, reference: null, paidOn: null, tdsAmount: 0, netAmount: null, reason: null, finalSettlement: false, method: state.method };
    state.requests.unshift(r);
    return r;
  },
  payout_cancel: a => { const r = state.requests.find((x: any) => x.id === a.p_id); Object.assign(r, { status: 'CANCELLED', decidedAt: '2026-11-21T07:00:00Z' }); return r; },
  payout_my_requests: () => state.requests,
  // Accounts
  wallet_people: a => state.people.filter((p: any) => p.name.toLowerCase().includes(String(a.p_search).toLowerCase())),
  wallet_credit_create: a => {
    if (a.p_kind !== 'ADJUSTMENT' && a.p_amount < 0) fail('VALIDATION_ERROR: A bonus or a refund is a positive amount.');
    const p = state.people.find((x: any) => x.id === a.p_profile);
    const c = { id: `wc-${++n}`, profileId: a.p_profile, name: p.name, department: p.department, kind: a.p_kind, amount: a.p_amount, description: a.p_description, reference: a.p_reference, status: 'PENDING_APPROVAL',
      createdAt: '2026-11-21T06:00:00Z', createdBy: 'Anil Accounts', decidedAt: null, decidedBy: null, decisionNote: null, requestId: a.p_request_id };
    state.queue.unshift(c);
    return c;
  },
  wallet_credit_queue: a => state.queue.filter((c: any) => !a.p_status || c.status === a.p_status),
  wallet_credit_decide: a => {
    if (state.decideError) fail(state.decideError);
    const c = state.queue.find((x: any) => x.id === a.p_id);
    Object.assign(c, { status: a.p_approve ? 'CREDITED' : 'REJECTED', decidedAt: '2026-11-21T08:00:00Z', decidedBy: 'Dev Accounts', decisionNote: a.p_note });
    return c;
  },
  wallet_report: a => ({
    from: a.p_from ?? '2026-11-01', to: a.p_to ?? '2026-11-21',
    salary: { monthlyPayable: 250000, employeesWithSalary: 10, employeesWithoutSalary: 2, payrollTracked: false },
    incentives: { generated: 90000, reversed: 5000, pendingApproval: 0, credited: 85000 },
    credits: { pendingCount: 2, pendingAmount: 3500, credited: 12000 },
    withdrawals: { requestedCount: 7, requestedAmount: 40000, pendingCount: 2, pendingAmount: 9000, paidCount: 4, paidAmount: 30000, rejectedCount: 1 },
    departments: [{ departmentId: 'd1', department: 'Sales', employees: 6, incentives: 70000, credits: 8000, withdrawn: 25000 }, { departmentId: 'd2', department: 'Support', employees: 4, incentives: 15000, credits: 4000, withdrawn: 5000 }],
    employees: [{ profileId: 'p1', name: 'Meera Member', department: 'Sales', incentives: 40000, credits: 2000, withdrawn: 10000, available: 32000 }],
    months: [{ month: '2026-11', incentives: 90000, credits: 12000, withdrawn: 30000 }, { month: '2026-10', incentives: 60000, credits: 1000, withdrawn: 20000 }]
  })
};
const chain: any = { on: () => chain, subscribe: () => chain };
const fake = {
  rpc: async (fn: string, args: any) => {
    calls.push({ fn, args });
    const h = handlers[fn];
    if (!h) return { data: null, error: { message: `unexpected ${fn}` } };
    try { return { data: h(args), error: null }; } catch (e: any) { return { data: null, error: { message: e.message } }; }
  },
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  channel: () => chain, removeChannel: async () => undefined
};
void mask;
export const getSupabase = () => fake;
export const getSupabaseConfig = () => ({ url: 'http://test', isConfigured: true });
export const requireSupabase = () => fake;
