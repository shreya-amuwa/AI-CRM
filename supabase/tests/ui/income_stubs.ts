// A stand-in Supabase client for the Income browser test: the person's income, the incentive setup (Super Admin, Team Lead, Department
// Head), the demo tick, and a record of every call. Synthetic data only.
const calls: { fn: string; args: any }[] = [];
(window as any).__calls = calls;
const OH = '00000000-0000-4000-8000-0000000000a1';
const state: any = (window as any).__state = {
  role: 'tl',   // 'sa' | 'tl' | 'dh'
  eligible: true,
  rules: [] as any[],
  alloc: { m1: 100 } as Record<string, number>,
  split: 50,
  days: 15,
  earnings: [
    { id: 'e1', earnedAt: '2026-11-20T06:00:00Z', eventType: 'SALE_PAID', role: 'CLOSER', amount: 50, status: 'EARNED', reversedAt: null, customerName: 'Acme Traders', serviceName: 'WhatsApp API', ruleName: 'WA 500' },
    { id: 'e2', earnedAt: '2026-11-19T06:00:00Z', eventType: 'SALE_PAID', role: 'TEAM_LEAD', amount: 25, status: 'REVERSED', reversedAt: '2026-11-19T09:00:00Z', customerName: 'Beta Foods', serviceName: 'WhatsApp API', ruleName: 'WA 500' },
    { id: 'e3', earnedAt: '2026-11-18T06:00:00Z', eventType: 'DEMO_COMPLETED', role: 'PARTICIPANT', amount: 50, status: 'EARNED', reversedAt: null, customerName: null, serviceName: null, ruleName: 'Demo reward' }
  ]
};
let n = 0;
const ruleJson = (r: any) => ({ ...r, serviceName: r.serviceCode === 'WA_API' ? 'WhatsApp API' : r.serviceCode ? 'Website' : null, activeFrom: '2026-11-21', activeTo: null });
// a rule whose Operations Head has left (no longer in the option lists)
state.rules.push({ id: 'r-old', name: 'Old OH rule', eventType: 'SALE_PAID', serviceCode: 'WEB', amount: 300, targetUnits: 50, scopeType: 'OPERATIONS_HEAD', scopeValue: 'oh-gone', monthlyCap: null, endedAt: null, active: true, earned: 0 });
state.rules.push({ id: 'r-wa', name: 'WA 500', eventType: 'SALE_PAID', serviceCode: 'WA_API', amount: 500, targetUnits: 1000, scopeType: 'OPERATIONS_HEAD', scopeValue: OH, monthlyCap: null, endedAt: null, active: true, earned: 2 });
const fail = (message: string) => { throw new Error(message); };
const setup = () => {
  const admin = state.role === 'sa';
  const myAmount = state.role === 'tl' ? 150 : state.role === 'dh' ? 300 : 0;
  const reports = state.role === 'tl' ? [{ profileId: 'm1', name: 'Meera Member', level: 'TEAM_MEMBER' }] : state.role === 'dh' ? [{ profileId: 't1', name: 'Tarun Lead', level: 'TEAM_HEAD' }] : [];
  return {
    rules: state.rules.filter((r: any) => admin || (r.active && r.eventType === 'SALE_PAID')).map((r: any) => ({
      ...ruleJson(r), myAmount, kept: myAmount - Math.max(0, ...reports.map(p => state.alloc[p.profileId] ?? 0)), earnedCount: admin ? r.earned : null,
      given: r.eventType === 'SALE_PAID' ? reports.map(p => ({ recipientId: p.profileId, name: p.name, level: p.level, amount: state.alloc[p.profileId] ?? 0, kept: myAmount - (state.alloc[p.profileId] ?? 0) })) : []
    })),
    reports, split: { departmentId: 'dep-1', telecallerPct: state.split }, canSplit: admin || state.role === 'dh', isAdmin: admin, startAfterDays: state.days,
    options: admin ? {
      services: [{ code: 'WA_API', name: 'WhatsApp API' }, { code: 'WEB', name: 'Website' }],
      operationsHeads: [{ id: OH, name: 'Omkar Ops' }],
      departments: [{ id: 'dep-1', name: 'Sales' }], teams: [{ id: 'team-1', name: 'Sales A', departmentId: 'dep-1' }], people: [{ id: 'm1', name: 'Meera Member' }]
    } : null
  };
};
const handlers: Record<string, (a: any) => any> = {
  income_summary: () => ({
    startsOn: state.eligible ? '2026-10-01' : '2026-12-05', eligible: state.eligible, today: 50, month: 100, total: 1250.5, balance: 1250.5,
    targets: [{ ruleId: 'r-wa', name: 'WA 500', serviceName: 'WhatsApp API', targetUnits: 1000, unitsDone: 412 }],
    activity: { businessThisMonth: 240000, demosCompletedThisMonth: 3, visitsCompletedThisMonth: 2 }
  }),
  income_earnings: () => state.earnings,
  incentive_setup: () => setup(),
  incentive_rule_create: a => {
    const p = a.p;
    if (p.eventType === 'SALE_PAID' && (!p.serviceCode || !p.scopeValue)) fail('VALIDATION_ERROR: A sales incentive needs a product and the Operations Head it is given to.');
    const id = `r-${++n}`;
    state.rules.unshift({ id, name: p.name, eventType: p.eventType, serviceCode: p.serviceCode ?? null, amount: p.amount, targetUnits: p.targetUnits ?? null, scopeType: p.scopeType, scopeValue: p.scopeValue, monthlyCap: p.monthlyCap ?? null, endedAt: null, active: true, earned: 0 });
    return id;
  },
  incentive_rule_update: a => {
    const r = state.rules.find((x: any) => x.id === a.p_rule);
    if ('amount' in a.p && a.p.amount !== r.amount) {
      r.active = false; r.endedAt = '2026-11-21T06:00:00Z';
      const id = `r-${++n}`;
      state.rules.unshift({ ...r, ...a.p, id, active: true, endedAt: null, earned: 0 });
      return ruleJson(state.rules[0]);
    }
    Object.assign(r, a.p);
    return ruleJson(r);
  },
  incentive_rule_end: a => { const r = state.rules.find((x: any) => x.id === a.p_rule); r.active = false; r.endedAt = 'now'; return ruleJson(r); },
  incentive_rule_delete: a => {
    const r = state.rules.find((x: any) => x.id === a.p_rule);
    if (r.earned) { r.active = false; r.endedAt = 'now'; return { id: r.id, deleted: false, ended: true }; }
    state.rules = state.rules.filter((x: any) => x.id !== a.p_rule);
    return { id: r.id, deleted: true, ended: false };
  },
  incentive_allocation_set: a => {
    const mine = state.role === 'tl' ? 150 : 300;
    if (a.p_amount > mine) fail(`VALIDATION_ERROR: The amount must be between 0 and ${mine.toFixed(2)}, what you get per unit (it cannot be more than you get).`);
    state.alloc[a.p_recipient] = a.p_amount;
    return { ruleId: a.p_rule, recipientId: a.p_recipient, amount: a.p_amount };
  },
  incentive_split_set: a => { state.split = a.p_telecaller_pct; return { departmentId: a.p_department, telecallerPct: a.p_telecaller_pct }; },
  incentive_settings_set: a => { state.days = a.p_days; return { startAfterDays: a.p_days }; },
  ba_demo_set_authorised: a => ({ id: a.p_demo, status: 'COMPLETED', authorisedPersonAttended: !!a.p_attended })
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
