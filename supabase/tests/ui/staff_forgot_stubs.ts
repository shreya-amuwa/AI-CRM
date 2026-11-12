// A stand-in Supabase client for the staff "Forgot password?" browser test: verifyOtp records the token it was given.
(window as any).__verified = [];
const fake = {
  auth: {
    verifyOtp: async (args: any) => { (window as any).__verified.push(args); return args.token_hash === 'good-token' ? { data: { session: {} }, error: null } : { data: null, error: { message: 'expired' } }; },
    getSession: async () => ({ data: { session: { access_token: 'x' } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
  },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: async () => undefined
};
export const getSupabase = () => fake;
export const getSupabaseConfig = () => ({ url: 'http://test', isConfigured: true });
export const requireSupabase = () => fake;
