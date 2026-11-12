// A signed-in session for the Meetings browser test (the API itself is answered by the test's own server).
const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
export const getSupabase = () => client as any;
export const requireSupabase = () => client as any;
export const getSupabaseConfig = () => ({ url: 'http://localhost', anonKey: 'anon' });
