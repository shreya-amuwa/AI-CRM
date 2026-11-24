// Stand-ins for the HR Awards browser test (supabase/tests/ui_hr_awards.test.mjs): a signed-in HR session, the HR directory with one
// employee whose work anniversary is in 5 days (so the existing Anniversaries list has a card), and an inert Realtime.
const w = window as any;
const channel = () => {
  const api: any = { on: () => api, subscribe: () => api };
  return api;
};
const anniversary = () => {
  const d = new Date();
  d.setDate(d.getDate() + 5);
  return `${d.getFullYear() - 2}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const handlers: Record<string, () => unknown> = {
  hr_employee_directory: () => ({
    employees: [{ source: 'account', profileId: 'p-anniv', name: 'Anita Anniversary', email: 'anita@example.com', phone: null, designation: 'Executive',
      role: 'TEAM_MEMBER', accountStatus: 'ACTIVE', approvalStatus: 'APPROVED', createdAt: '2024-01-01T00:00:00Z', departmentSlug: 'wabastore',
      departmentName: 'Wabastore', hrRecordId: 'HR-1', hrStatus: 'Full-Time', joiningDate: anniversary(), monthlySalary: null, workingHours: null, hrData: {} }],
    departments: []
  }),
  hr_personal_details: () => []
};
const fake = {
  rpc: async (fn: string) => {
    const h = handlers[fn];
    return h ? { data: h(), error: null } : { data: [], error: null };
  },
  from: () => ({ select: () => ({ data: [], error: null }) }),
  auth: {
    getSession: async () => ({ data: { session: { access_token: 'test-token', user: { id: 'hr-1' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
  },
  channel,
  removeChannel: async () => undefined
};
w.__fake = fake;
export const getSupabase = () => fake;
export const requireSupabase = () => fake;
export const getSupabaseConfig = () => ({ url: 'http://test', isConfigured: true });
