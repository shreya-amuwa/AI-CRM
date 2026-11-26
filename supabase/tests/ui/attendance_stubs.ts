// A stand-in Supabase client for the attendance browser test: a small in-page "database" with the server's clock 3 minutes AHEAD of the
// device (so the test proves the lunch timer uses the server's time), and a record of every call.
const calls: { fn: string; args: any }[] = [];
(window as any).__calls = calls;
const skew = 3 * 60 * 1000;
const serverNow = () => new Date(Date.now() + skew).toISOString();
const state: any = { punchIn: null, punchOut: null, punchOutCount: 0, lunchOpen: null, sessions: [] as any[] };
const status = () => !state.punchIn ? 'NOT_PUNCHED_IN' : state.punchOut ? 'PUNCHED_OUT' : state.lunchOpen ? 'ON_LUNCH' : state.sessions.length ? 'RESUMED_WORK' : 'PUNCHED_IN';
const day = () => {
  const minutes = state.sessions.reduce((a: number, s: any) => a + s.minutes, 0);
  return {
    date: '2026-11-09', serverTime: serverNow(), timeZone: 'Asia/Kolkata', status: status(), maxAccuracyM: 1000,
    punchIn: state.punchIn, punchOut: state.punchOut, punchOutCount: state.punchOutCount, workedMinutes: state.punchIn ? 0 : null,
    lunch: { allowanceMinutes: 45, minutes, remainingMinutes: Math.max(0, 45 - minutes), exceededMinutes: Math.max(0, minutes - 45), open: state.lunchOpen, sessions: state.sessions }
  };
};
const punch = (a: any) => ({ at: '2026-11-09T03:35:00Z', locationStatus: a.p_location_status, latitude: a.p_lat, longitude: a.p_lng, accuracy: a.p_accuracy, place: null });
const lunch0 = { allowanceMinutes: 45, minutes: 0, remainingMinutes: 45, exceededMinutes: 0, open: null, sessions: [] };
const noCrm = { systemLoginAt: null, firstLoginAt: null, lastLogoutAt: null, logoutMissing: false, sessions: [] };
// HR's register, as the database returns it (numbers for the coordinates)
const register = (date: string) => ({
  date, today: date, serverTime: serverNow(), timeZone: 'Asia/Kolkata', allowanceMinutes: 45, maxAccuracyM: 1000, retentionDays: 90, geofence: null, rows: [
    { profileId: 'p1', name: 'Asha Staff', role: 'TEAM_MEMBER', designation: 'Executive', departmentId: 'd1', department: 'Wabastore', date, status: 'PUNCHED_OUT',
      crm: { systemLoginAt: '2026-11-09T03:30:00Z', firstLoginAt: '2026-11-09T03:30:00Z', lastLogoutAt: '2026-11-09T12:45:00Z', logoutMissing: false,
             sessions: [{ startedAt: '2026-11-09T03:30:00Z', endedAt: '2026-11-09T12:45:00Z', device: 'Chrome on Windows', method: 'password', logoutRecorded: true }] },
      punchIn: { at: '2026-11-09T03:35:00Z', locationStatus: 'CAPTURED', latitude: 18.520431, longitude: 73.856743, accuracy: 113, place: 'Baner Road, Baner, Pune, Maharashtra 411045' },
      punchOut: { at: '2026-11-09T12:40:00Z', locationStatus: 'CAPTURED', latitude: 18.559, longitude: 73.7868, accuracy: 9, place: null },
      punchOutHistory: [{ at: '2026-11-09T12:40:00Z', locationStatus: 'CAPTURED', latitude: 18.559, longitude: 73.7868, accuracy: 9 }],
      workedMinutes: 545,
      lunch: { allowanceMinutes: 45, minutes: 55, remainingMinutes: 0, exceededMinutes: 10, open: null,
               sessions: [{ startedAt: '2026-11-09T07:30:00Z', endedAt: '2026-11-09T07:50:00Z', endedBy: 'EMPLOYEE', minutes: 20 },
                          { startedAt: '2026-11-09T09:00:00Z', endedAt: '2026-11-09T09:35:00Z', endedBy: 'EMPLOYEE', minutes: 35 }] } },
    { profileId: 'p2', name: 'Ravi Staff', role: 'TEAM_MEMBER', designation: null, departmentId: 'd1', department: 'Wabastore', date, status: 'INCOMPLETE',
      crm: { systemLoginAt: '2026-11-09T04:30:00Z', firstLoginAt: '2026-11-09T04:30:00Z', lastLogoutAt: '2026-11-09T07:30:00Z', logoutMissing: false,
             sessions: [{ startedAt: '2026-11-09T04:30:00Z', endedAt: '2026-11-09T07:30:00Z', device: 'Safari on iOS', method: 'password', logoutRecorded: true }] },
      punchIn: { at: '2026-11-09T04:40:00Z', locationStatus: 'CAPTURED', latitude: 19.07609, longitude: 72.877426, accuracy: 30, place: null },
      punchOut: null, punchOutHistory: [], workedMinutes: null, lunch: lunch0 },
    { profileId: 'p3', name: 'Meera Staff', role: 'TEAM_LEAD', designation: null, departmentId: 'd2', department: 'Sales', date, status: 'NOT_PUNCHED_IN',
      crm: noCrm, punchIn: null, punchOut: null, punchOutHistory: [], workedMinutes: null, lunch: lunch0 },
    { profileId: 'p4', name: 'Old Record', role: 'TEAM_MEMBER', designation: null, departmentId: 'd2', department: 'Sales', date, status: 'PUNCHED_OUT',
      crm: { ...noCrm, systemLoginAt: '2026-11-09T03:00:00Z', firstLoginAt: '2026-11-09T03:00:00Z', logoutMissing: true,
             sessions: [{ startedAt: '2026-11-09T03:00:00Z', endedAt: null, device: null, method: null, logoutRecorded: false }] },
      // a punch from before location became mandatory (history is kept as it was)
      punchIn: { at: '2026-11-09T03:10:00Z', locationStatus: 'DENIED', latitude: null, longitude: null, accuracy: null },
      punchOut: { at: '2026-11-09T11:10:00Z', locationStatus: 'PURGED', latitude: null, longitude: null, accuracy: null },
      punchOutHistory: [], workedMinutes: 480, lunch: lunch0 }
  ]
});
const handlers: Record<string, (a: any) => any> = {
  attendance_today: () => day(),
  hr_attendance_register: a => register(a.p_date),
  my_attendance: () => [],
  attendance_punch_in: a => { state.punchIn = state.punchIn ?? punch(a); return day(); },
  attendance_punch_out: a => { state.punchOut = { ...punch(a), at: '2026-11-09T12:40:00Z' }; state.punchOutCount += 1; return day(); },
  // Task 02: the Punch Out dialog's figures (the shift ends at 19:00, after "now"), and the confirmed Punch Out that needs a reason when early
  attendance_punch_out_preview: () => ({ serverTime: serverNow(), punchInAt: state.punchIn?.at ?? null, punchedOut: false, workedMinutes: 485, breakMinutes: 52,
    netMinutes: 433, shiftEnd: '19:00', early: true, reasonRequired: true }),
  attendance_punch_out_confirmed: a => {
    if (!a.p_early_reason) throw new Error('VALIDATION_ERROR: You are punching out before your scheduled shift end (19:00). Say why.');
    return handlers.attendance_punch_out(a);
  },
  // the lunch "started" 52 minutes ago on the SERVER clock
  attendance_lunch: a => {
    if (a.p_action === 'START') { state.lunchOpen = { id: 'l1', startedAt: new Date(Date.now() + skew - 52 * 60000).toISOString() }; state.sessions = [{ startedAt: state.lunchOpen.startedAt, endedAt: null, endedBy: null, minutes: 52 }]; }
    else { state.lunchOpen = null; state.sessions = [{ ...state.sessions[0], endedAt: serverNow(), minutes: 52 }]; }
    return day();
  }
};
const chain: any = { on: () => chain, subscribe: () => chain };
const fake = {
  rpc: async (fn: string, args: any) => {
    calls.push({ fn, args });
    const h = handlers[fn];
    if (!h) return { data: null, error: { message: `unexpected ${fn}` } };
    try { return { data: h(args), error: null }; } catch (e) { return { data: null, error: { message: (e as Error).message } }; }
  },
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  channel: () => chain, removeChannel: async () => undefined
};
export const getSupabase = () => fake;
export const getSupabaseConfig = () => ({ url: 'http://test', isConfigured: true });
export const requireSupabase = () => fake;
