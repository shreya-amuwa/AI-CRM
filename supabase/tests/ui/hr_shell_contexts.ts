// The HR dashboard shell browser test (supabase/tests/ui_hr_shell.test.mjs): stand-ins for the signed-in HR person, the lead store and the
// notification centre, so the real Header, Sidebar and HR panel can be mounted without a live database.
const w = window as any;
const profile = () => w.__hrProfile ?? { role: 'DEPARTMENT_HEAD', hrSubRole: 'HR_ASSISTANT' };
export const useAuth = () => ({
  activeDepartment: { id: 'hr', name: 'Human Resources', slug: 'hr', accentColor: '#2563eb' },
  activeDepartmentId: 'hr',
  user: { id: 'u-hr', role: 'hr', name: 'Hema Head', email: 'hema@example.com', departmentId: 'hr', profile: profile() },
  profile: null,
  logout: async () => { w.__loggedOut = true; }
});
export const useLeadStore = () => ({ getLeadsForDepartment: () => [] });
const notifications = {
  unreadCount: 0, notifications: [], loading: false, error: null,
  getUnreadCountForUser: () => 0, getNotificationsForUser: () => [],
  markAsRead: async () => undefined, markAllAsRead: async () => undefined, refresh: async () => undefined,
  sendNotification: async () => undefined, deleteNotification: async () => undefined
};
export const useNotifications = () => notifications;
