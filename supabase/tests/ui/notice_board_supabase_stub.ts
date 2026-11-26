// A stand-in browser Supabase client for the Notice Board / attendance overview browser test: a signed-in session, Realtime channels the
// test can fire (window.__fireRealtime(table)), and rpc() answering Today's Attendance Overview from a fixture (window.__overview).
const w = window as any;
w.__realtime = [] as { table: string; handler: () => void }[];
w.__fireRealtime = (table: string) => w.__realtime.filter((x: any) => x.table === table).forEach((x: any) => x.handler());
w.__rpc = [] as { fn: string; args: unknown }[];
const channel = () => {
  const api: any = { on: (_e: string, f: { table: string }, h: () => void) => { w.__realtime.push({ table: f.table, handler: h }); return api; }, subscribe: () => api };
  return api;
};
const handlers: Record<string, (a: any) => unknown> = {
  attendance_today_overview: () => w.__overview,
  hr_attendance_register: (a: any) => ({ date: a.p_date, today: a.p_date, serverTime: new Date().toISOString(), timeZone: 'Asia/Kolkata', allowanceMinutes: 45, maxAccuracyM: 1000, retentionDays: 90, geofence: null, rows: [] })
};
const fake = {
  rpc: async (fn: string, args: unknown) => {
    w.__rpc.push({ fn, args });
    const h = handlers[fn];
    return h ? { data: h(args), error: null } : { data: null, error: { message: `unexpected ${fn}` } };
  },
  auth: {
    getSession: async () => ({ data: { session: { access_token: 'test-token', user: { id: 'u1' } } } }),
    signOut: async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
  },
  channel,
  removeChannel: async () => undefined
};
export const getSupabase = () => fake;
export const getSupabaseConfig = () => ({ url: 'http://test', isConfigured: true });
export const requireSupabase = () => fake;
