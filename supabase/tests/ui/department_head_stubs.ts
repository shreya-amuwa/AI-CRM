// A stand-in Supabase client for the Department Head dashboard browser test. rpc() answers the head_* functions from data made in the page, applying the
// filters, the search and the paging the real functions apply, and records every call so the test can check what was sent (never a department, role or user).
const calls: { fn: string; args: any }[] = [];
(window as any).__calls = calls;
const state: any = { delay: 0, fail: {} as Record<string, string>, owners: [], attendance: [], leads: [], customers: [], invoices: [], today: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) };
(window as any).__state = state;

const page = (rows: any[], a: any) => rows.slice(a.p_offset ?? 0, (a.p_offset ?? 0) + (a.p_limit ?? 20));
const has = (v: any, t: string | null) => !t || String(v ?? '').toLowerCase().includes(t.toLowerCase());

const attendanceSummary = (rows: any[]) => {
  const present = rows.filter(r => r.status === 'PRESENT').length, leave = rows.filter(r => r.status === 'ON_LEAVE').length;
  return { employees: rows.length, present, absent: rows.filter(r => r.status === 'ABSENT').length, onLeave: leave, rate: rows.length - leave > 0 ? Math.round((1000 * present) / (rows.length - leave)) / 10 : null };
};
const answers: Record<string, (a: any) => any> = {
  head_dashboard_overview: () => ({
    department: { id: 'd1', name: 'Wabastore Sales' }, today: state.today, attendance: attendanceSummary(state.attendance),
    customers: { total: state.customers.length, active: state.customers.filter((c: any) => c.status === 'ACTIVE').length, inactive: state.customers.filter((c: any) => c.status === 'INACTIVE').length, new: 2, withPendingInvoices: 1 },
    leads: { total: state.leads.length, new: 1, inProgress: 1, converted: 1, lost: 0 },
    invoices: { count: 3, amount: 7000, paid: 1, paidAmount: 1000, pending: 2, pendingAmount: 6000, overdue: 1, overdueAmount: 2000 }
  }),
  head_attendance_list: a => {
    if (a.p_date && a.p_date > state.today) throw new Error('VALIDATION_ERROR: Choose a date up to today (at most two years back).');
    const day = a.p_date || state.today;
    const rows = state.attendance.map((r: any) => ({ ...r, date: day }));
    const shown = rows.filter((r: any) => (!a.p_status || r.status === a.p_status) && (has(r.name, a.p_search) || has(r.designation, a.p_search)));
    return { date: day, today: state.today, timeZone: 'Asia/Kolkata', summary: attendanceSummary(rows), total: shown.length, items: page(shown, a) };
  },
  head_lead_list: a => {
    const shown = state.leads.filter((l: any) => (!a.p_status || l.state === a.p_status) && (!a.p_source || (l.source ?? 'Not recorded') === a.p_source) && (has(l.name, a.p_search) || has(l.company, a.p_search) || has(l.phone, a.p_search)));
    const c = (s: string) => state.leads.filter((l: any) => l.state === s).length;
    const sources: Record<string, number> = {};
    state.leads.forEach((l: any) => { const k = l.source ?? 'Not recorded'; sources[k] = (sources[k] ?? 0) + 1; });
    return { summary: { total: state.leads.length, new: c('NEW'), inProgress: c('IN_PROGRESS'), converted: c('CONVERTED'), lost: c('LOST') }, sources: Object.entries(sources).map(([source, count]) => ({ source, count })), total: shown.length, items: page(shown, a) };
  },
  head_lead_owners: () => state.owners,
  head_customer_list: a => {
    const shown = state.customers.filter((c: any) => (!a.p_status || c.status === a.p_status) && (has(c.name, a.p_search) || has(c.company, a.p_search)));
    return { summary: answers.head_dashboard_overview({}).customers, total: shown.length, items: page(shown, a) };
  },
  head_customer_detail: a => {
    const c = state.customers.find((x: any) => x.id === a.p_customer);
    if (!c) throw new Error('NOT_FOUND: Customer not found.');
    const invs = state.invoices.filter((i: any) => i.customerId === c.id);
    return {
      customer: { ...c, address: null, whatsapp: null, customerSince: null, teamLead: { id: 'tl', name: 'Tara Lead' }, teamMember: null, hasClientLogin: true },
      services: c.services, origin: { leadSource: 'Referral', expectedBudget: 50000, leadCreatedAt: '2026-10-01T10:00:00Z' },
      payments: { dealAmount: 20000, amountReceived: 5000, fullyPaid: false },
      invoices: invs.map((i: any) => ({ id: i.id, number: i.number, kind: i.kind, amount: i.amount, status: i.status, overdue: i.overdue, issueDate: i.issueDate, dueDate: i.dueDate })),
      invoiceSummary: { count: invs.length, invoiced: invs.reduce((n: number, i: any) => n + i.amount, 0), paid: invs.filter((i: any) => i.status === 'Paid').reduce((n: number, i: any) => n + i.amount, 0), outstanding: invs.filter((i: any) => i.status === 'Pending').reduce((n: number, i: any) => n + i.amount, 0) }
    };
  },
  head_customer_tickets: () => [{ id: 't1', ticketNo: 'TKT-1', subject: 'Template rejected', status: 'OPEN', priority: 'HIGH', createdAt: '2026-11-01T10:00:00Z', assignee: { id: 'm', name: 'Mia Member' } }],
  head_customer_directory: () => ({ total: 0, items: [] }),
  head_invoice_list: a => {
    if (a.p_from && a.p_to && a.p_to < a.p_from) throw new Error('VALIDATION_ERROR: The end date is before the start date.');
    const st = (i: any) => (a.p_status === 'OVERDUE' ? i.status === 'Pending' && i.overdue : a.p_status ? i.status.toUpperCase() === a.p_status : true);
    const shown = state.invoices.filter((i: any) => st(i) && (!a.p_from || i.issueDate >= a.p_from) && (!a.p_to || i.issueDate <= a.p_to) && (has(i.number, a.p_search) || has(i.customer, a.p_search)));
    const act = state.invoices.filter((i: any) => i.status !== 'Cancelled');
    return { summary: { count: act.length, amount: act.reduce((n: number, i: any) => n + i.amount, 0), paid: act.filter((i: any) => i.status === 'Paid').length, paidAmount: 1000, pending: act.filter((i: any) => i.status === 'Pending').length, pendingAmount: 6000, overdue: act.filter((i: any) => i.overdue).length, overdueAmount: 2000 }, total: shown.length, items: page(shown, a) };
  }
};
const chain: any = { on: () => chain, subscribe: () => chain };
const fake = {
  rpc: async (fn: string, args: any) => {
    calls.push({ fn, args });
    if (state.delay) await new Promise(r => setTimeout(r, state.delay));
    if (state.fail[fn]) return { data: null, error: { message: state.fail[fn] } };
    if (!(fn in answers)) return { data: null, error: { message: `unexpected ${fn}` } };
    try { return { data: JSON.parse(JSON.stringify(answers[fn](args))), error: null }; } catch (e) { return { data: null, error: { message: (e as Error).message } }; }
  },
  from: () => { const c: any = { select: () => c, order: () => c, limit: () => c, eq: () => c, then: (res: any) => Promise.resolve({ data: [], error: null }).then(res) }; return c; },
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  channel: () => chain, removeChannel: async () => undefined
};
export const getSupabase = () => fake;
export const getSupabaseConfig = () => ({ url: 'http://test', isConfigured: true });
export const requireSupabase = () => fake;
