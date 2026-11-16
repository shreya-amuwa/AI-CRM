// A signed-in session for the Upload Leads browser test, with a realtime channel that never fires (the API is answered by the harness).
const channel: any = { on: () => channel, subscribe: () => channel, unsubscribe: async () => 'ok' };
const client = {
  auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  channel: () => channel,
  removeChannel: async () => 'ok'
};
export const getSupabase = () => client as any;
export const requireSupabase = () => client as any;
export const getSupabaseConfig = () => ({ url: 'http://localhost', anonKey: 'anon' });
