// A fake Supabase client for the team attendance / corrections browser test: canned answers, every call recorded in window.__calls.
const calls: { fn: string; args: any }[] = [];
(window as any).__calls = calls;
const row = (id: string, name: string, dept: string, status: string, extra: Record<string, unknown> = {}) => ({
  profileId: id, name, avatarUrl: null, designation: 'Sales Executive', role: 'TEAM_MEMBER', departmentId: dept === 'Sales' ? 'd1' : 'd2', department: dept,
  teamId: 't1', team: 'Inside Sales', teamLead: 'Lata Lead', status, late: false, lateMinutes: 0, punchInAt: null, punchOutAt: null, dayStart: '10:00', dayEnd: '19:00',
  leave: null, onBreak: false, workedMinutes: null, earlyOutReason: null, correctionPending: false, available: ['PRESENT', 'LATE', 'HALF_DAY'].includes(status), ...extra });
const rows = [
  row('p1', 'Asha Absent', 'Sales', 'ABSENT'),
  row('p2', 'Nikhil Notin', 'Sales', 'NOT_PUNCHED_IN'),
  row('p3', 'Leena Leave', 'Support', 'APPROVED_LEAVE', { leave: 'FULL_DAY' }),
  row('p4', 'Lalit Late', 'Sales', 'LATE', { late: true, lateMinutes: 25, punchInAt: '2026-11-09T04:55:00Z' }),
  row('p5', 'Priya Present', 'Support', 'PRESENT', { punchInAt: '2026-11-09T04:25:00Z' }),
  row('p6', 'Esha Early', 'Sales', 'SHIFT_COMPLETED', { punchInAt: '2026-11-09T04:20:00Z', punchOutAt: '2026-11-09T10:00:00Z', earlyOutReason: 'Doctor appointment' })
];
const overview = (a: any) => {
  const shown = a.p_status === 'UNAVAILABLE' ? rows.filter(r => ['ABSENT', 'NOT_PUNCHED_IN', 'APPROVED_LEAVE'].includes(r.status))
    : a.p_status === 'PUNCHED_IN' ? rows.filter(r => r.punchInAt) : a.p_status === 'LATE_ARRIVALS' ? rows.filter(r => r.late)
      : a.p_status ? rows.filter(r => r.status === a.p_status) : rows;
  return {
    date: '2026-11-09', today: '2026-11-09', serverTime: '2026-11-09T06:30:00Z', workingDay: true, graceMinutes: 0, absentAfterMinutes: 60,
    totals: { total: 6, scheduled: 6, present: 3, absent: 1, notPunchedIn: 1, shiftNotStarted: 0, late: 1, onLeave: 1, halfDay: 0, onBreak: 0, shiftCompleted: 1, offToday: 0 },
    departments: [{ id: 'd1', name: 'Sales', total: 4, available: 1, present: 2, unavailable: 2, late: 1 }, { id: 'd2', name: 'Support', total: 2, available: 1, present: 1, unavailable: 1, late: 0 }],
    teams: [{ id: 't1', name: 'Inside Sales', departmentId: 'd1' }], departmentOptions: [{ id: 'd1', name: 'Sales' }, { id: 'd2', name: 'Support' }],
    rows: shown, shown: shown.length
  };
};
const corr = (id: string, mine: boolean, status = 'PENDING') => ({
  id, profileId: mine ? 'me' : 'p6', employee: mine ? 'Me Myself' : 'Esha Early', department: 'Sales', date: '2026-11-09', kind: 'RESUME_DAY', requestedTime: null,
  reason: 'Clicked Punch Out by mistake', details: null, status, original: { punchInAt: '2026-11-09T04:20:00Z', punchOutAt: '2026-11-09T10:00:00Z', punchOuts: 1 },
  applied: null, decidedBy: null, decidedAt: null, decisionNote: null, createdAt: '2026-11-09T10:01:00Z', canDecide: !mine && status === 'PENDING', canCancel: mine && status === 'PENDING' });
const state = { decided: false };
const handlers: Record<string, (a: any) => any> = {
  attendance_team_overview: overview,
  attendance_corrections: a => (a.p_scope === 'DECIDE' ? { items: [corr('c2', false, state.decided ? 'APPROVED' : 'PENDING')], pending: state.decided ? 0 : 1 } : { items: [corr('c1', true)], pending: 1 }),
  attendance_correction_decide: a => { state.decided = true; return { ...corr(a.p_id, false, a.p_approve ? 'APPROVED' : 'REJECTED') }; },
  attendance_correction_request: a => corr('c9', true),
  attendance_correction_cancel: a => corr(a.p_id, true, 'CANCELLED')
};
const chain: any = { on: () => chain, subscribe: () => chain };
const fake = {
  rpc: async (fn: string, args: any) => { calls.push({ fn, args }); const h = handlers[fn]; return h ? { data: h(args), error: null } : { data: null, error: { message: `unexpected ${fn}` } }; },
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  channel: () => chain, removeChannel: async () => undefined
};
export const getSupabase = () => fake;
export const getSupabaseConfig = () => ({ url: 'http://test', isConfigured: true });
export const requireSupabase = () => fake;
