// The signed-in person for the Department Head dashboard navigation test: the page sets window.__profile before it mounts.
export const useAuth = () => ({ profile: (window as any).__profile, user: { name: 'Dev Head' }, logout: async () => undefined, loading: false });
