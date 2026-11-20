// A stand-in for the browser Supabase client: a signed-in session, and Realtime channels whose handlers the test can fire
// (window.__fireRealtime(table)), as Supabase does when a row of that table changes.
const w = window as any;
w.__realtime = [] as { table: string; handler: () => void }[];
w.__fireRealtime = (table: string) => w.__realtime.filter((x: any) => x.table === table).forEach((x: any) => x.handler());
const channel = () => {
  const api: any = {
    on: (_e: string, f: { table: string }, h: () => void) => { w.__realtime.push({ table: f.table, handler: h }); return api; },
    subscribe: () => api
  };
  return api;
};
const fake = {
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
