// A stand-in Supabase client for the attendance browser test: a small in-page "database" with the server's clock 3 minutes AHEAD of the
// device (so the test proves the lunch timer uses the server's time), and a record of every call.
const calls: { fn: string; args: any }[] = [];
(window as any).__calls = calls;
const skew = 3 * 60 * 1000;
const serverNow = () => new Date(Date.now() + skew).toISOString();
const state: any = { punchIn: null, punchOut: null, punchOutCount: 0, lunchOpen: null, sessions: [] as any[] };
const day = () => ({
  date: '2026-11-09', serverTime: serverNow(), punchIn: state.punchIn, punchOut: state.punchOut, punchOutCount: state.punchOutCount, workedMinutes: state.punchIn ? 0 : null,
  lunch: { allowanceMinutes: 50, minutes: 0, exceededMinutes: 0, open: state.lunchOpen, sessions: state.sessions }
});
const punch = (a: any) => ({ at: '2026-11-09T03:35:00Z', locationStatus: a.p_location_status, latitude: a.p_lat, longitude: a.p_lng, accuracy: a.p_accuracy });
const handlers: Record<string, (a: any) => any> = {
  attendance_today: () => day(),
  // HR's list, as the database returns it (numbers for the coordinates)
  hr_attendance_punches: () => ({ allowanceMinutes: 50, retentionDays: 90, rows: [
    { profileId: 'p1', name: 'Asha Staff', department: 'Wabastore', date: '2026-11-09',
      punchIn: { at: '2026-11-09T03:35:00Z', locationStatus: 'CAPTURED', latitude: 18.520431, longitude: 73.856743, accuracy: 113 },
      punchOut: null, punchOutHistory: [], missingPunchOut: false, workedMinutes: null, locationUnavailable: false, lunchMinutes: 0, lunchExceededMinutes: 0 },
    { profileId: 'p2', name: 'Ravi Staff', department: 'Wabastore', date: '2026-11-09',
      punchIn: { at: '2026-11-09T04:00:00Z', locationStatus: 'DENIED', latitude: null, longitude: null, accuracy: null },
      punchOut: null, punchOutHistory: [], missingPunchOut: false, workedMinutes: null, locationUnavailable: true, lunchMinutes: 0, lunchExceededMinutes: 0 }] }),
  my_attendance: () => [],
  attendance_punch_in: a => { state.punchIn = state.punchIn ?? punch(a); return day(); },
  attendance_punch_out: a => { state.punchOut = { ...punch(a), at: '2026-11-09T12:40:00Z' }; state.punchOutCount += 1; return day(); },
  // the lunch "started" 52 minutes ago on the SERVER clock
  attendance_lunch: a => {
    if (a.p_action === 'START') { state.lunchOpen = { id: 'l1', startedAt: new Date(Date.now() + skew - 52 * 60000).toISOString() }; state.sessions = [{ startedAt: state.lunchOpen.startedAt, endedAt: null, endedBy: null, minutes: 52 }]; }
    else { state.lunchOpen = null; state.sessions = [{ ...state.sessions[0], endedAt: serverNow(), minutes: 52 }]; }
    return day();
  }
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
