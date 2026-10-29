// A stand-in for the browser Supabase client: a signed-in session, no realtime.
const chain: any = { on: () => chain, subscribe: () => chain };
const fake = {
  auth: {
    getSession: async () => ({ data: { session: { access_token: 'test-token', user: { id: 'u1' } } } }),
    signOut: async () => ({ error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
  },
  channel: () => chain,
  removeChannel: async () => undefined
};
export const getSupabase = () => fake;
export const getSupabaseConfig = () => ({ url: 'http://test', isConfigured: true });
export const requireSupabase = () => fake;
