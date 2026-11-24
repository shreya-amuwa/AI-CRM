// The HR Awards browser test runs the real HR dashboard panel; these stand in for the signed-in HR person and the lead store it reads.
export const useAuth = () => ({ activeDepartment: { id: 'hr', name: 'HR', slug: 'hr' }, user: { role: 'hr', profile: { role: 'DEPARTMENT_HEAD' } }, profile: null });
export const useLeadStore = () => ({ getLeadsForDepartment: () => [] });
export const useNotifications = () => ({ unreadCount: 0, notifications: [] });
