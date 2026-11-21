// The signed-in person for the task workspace browser test: the harness sets window.__profile before it mounts.
export const useAuth = () => ({ profile: (window as any).__profile, user: null, logout: async () => undefined });
