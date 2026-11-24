// The signed-in person for the CEO Availability browser test: the page sets window.__profile / window.__user before it mounts.
export const useAuth = () => ({ profile: (window as any).__profile, user: (window as any).__user, activeDepartment: { id: 'hr', name: 'HR' }, activeDepartmentId: 'hr',
  logout: async () => undefined, loading: false });
