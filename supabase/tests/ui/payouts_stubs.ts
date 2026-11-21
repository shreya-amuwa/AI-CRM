// A stand-in Supabase client for the payouts browser test: My Income with the payout figures, payout details, withdrawal requests and the
// Accounts queue, with a record of every call. Synthetic data only.
const calls: { fn: string; args: any }[] = [];
(window as any).__calls = calls;
const state: any = (window as any).__state = {
  opensOn: '2026-01-16', open: true, startAfterDays: 15,
  earned: 3000, method: null as any, requests: [] as any[], leavers: [{ profileId: 'gone-1', name: 'Gita Gone', department: 'Sales', status: 'SUSPENDED', available: 900, method: { kind: 'UPI', holderName: 'Gita Gone', upiId: 'gita@okaxis' } }]
};
let n = 0;
const fail = (m: string) => { throw new Error(m); };
const paid = () => state.requests.filter((r: any) => r.status === 'PAID').reduce((s: number, r: any) => s + r.amount, 0);
const openReq = () => state.requests.find((r: any) => r.status === 'REQUESTED' || r.status === 'PROCESSING') ?? null;
const available = () => state.earned - paid() - (openReq()?.amount ?? 0);
const mask = (m: any) => m && ({ ...m, accountNumber: m.accountNumber ? `••••${m.accountNumber.slice(-4)}` : null, upiId: m.upiId ? `••••${m.upiId.slice(-4)}` : null });
const handlers: Record<string, (a: any) => any> = {
  income_summary: () => ({
    startsOn: '2026-01-16', eligible: true, today: 50, month: 400, total: state.earned, balance: state.earned - paid(),
    withdrawn: paid(), available: available(), withdrawOpensOn: state.opensOn, withdrawOpen: state.open, startAfterDays: state.startAfterDays, openRequest: openReq(),
    targets: [], activity: { businessThisMonth: 0, demosCompletedThisMonth: 0, visitsCompletedThisMonth: 0 }
  }),
  income_earnings: () => [],
  payout_method_get: () => state.method,
  payout_method_save: a => {
    const p = a.p;
    if (p.kind === 'BANK' && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(p.ifsc || '').toUpperCase())) fail('VALIDATION_ERROR: Enter the IFSC (11 characters, for example HDFC0001234).');
    state.method = { kind: p.kind, holderName: p.holderName, accountNumber: p.accountNumber ?? null, ifsc: p.ifsc ? String(p.ifsc).toUpperCase() : null, upiId: p.upiId ?? null, otherDetails: p.otherDetails ?? null, pan: p.pan || null };
    return state.method;
  },
  payout_request: a => {
    if (!state.method) fail('VALIDATION_ERROR: Add your payout details first.');
    if (a.p_amount > available()) fail(`VALIDATION_ERROR: You can withdraw up to ₹${available()}.`);
    const r = { id: `pr-${++n}`, profileId: 'me', name: 'Meera Member', department: 'Sales', amount: a.p_amount, status: 'REQUESTED', requestedAt: '2026-11-21T06:00:00Z',
      decidedAt: null, decidedBy: null, channel: null, reference: null, paidOn: null, tdsAmount: 0, netAmount: null, reason: null, finalSettlement: false, method: state.method };
    state.requests.unshift(r);
    return r;
  },
  payout_cancel: a => { const r = state.requests.find((x: any) => x.id === a.p_id); r.status = 'CANCELLED'; return r; },
  payout_my_requests: () => state.requests,
  payout_queue: a => state.requests.filter((r: any) => r.status === a.p_status).map((r: any) => ({ ...r, method: mask(r.method), available: available() })),
  payout_counts: () => ({ requested: state.requests.filter((r: any) => r.status === 'REQUESTED').length, processing: 0 }),
  payout_detail: a => ({ ...state.requests.find((x: any) => x.id === a.p_id), available: available(), withdrawn: paid(), personActive: true,
    recentEarnings: [{ earnedAt: '2026-11-20T06:00:00Z', eventType: 'SALE_PAID', role: 'CLOSER', amount: 100, status: 'EARNED', ruleName: 'WA 500' }] }),
  payout_mark_paid: a => {
    const r = state.requests.find((x: any) => x.id === a.p_id);
    if (r.status !== 'REQUESTED') fail('CONFLICT: This withdrawal was already handled.');
    Object.assign(r, { status: 'PAID', reference: a.p_reference, paidOn: a.p_paid_on, tdsAmount: a.p_tds, netAmount: Math.round((r.amount - a.p_tds) * 100) / 100, channel: 'MANUAL' });
    return r;
  },
  payout_reject: a => { const r = state.requests.find((x: any) => x.id === a.p_id); Object.assign(r, { status: 'REJECTED', reason: a.p_reason }); return r; },
  payout_leavers: () => state.leavers,
  payout_final_settlement: a => {
    const l = state.leavers.find((x: any) => x.profileId === a.p_profile);
    state.leavers = state.leavers.filter((x: any) => x !== l);
    const r = { id: `pr-${++n}`, profileId: l.profileId, name: l.name, department: l.department, amount: l.available, status: 'PAID', finalSettlement: true,
      reference: a.p_reference, paidOn: a.p_paid_on, tdsAmount: a.p_tds, netAmount: l.available - a.p_tds, method: l.method, requestedAt: '2026-11-21T06:00:00Z' };
    state.requests.unshift(r);
    return r;
  }
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
export const getSupabase = () => fake;
export const getSupabaseConfig = () => ({ url: 'http://test', isConfigured: true });
export const requireSupabase = () => fake;
