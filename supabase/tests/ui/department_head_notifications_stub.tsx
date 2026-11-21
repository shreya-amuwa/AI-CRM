// The notification centre for the Department Head dashboard navigation test: nothing to show.
const base: Record<string, unknown> = { notifications: [], unreadCount: 0, loading: false, hasMore: false };
export const useNotifications = () => new Proxy(base, { get: (t, k) => (k in t ? t[k as string] : () => undefined) });
export const NotificationProvider = ({ children }: { children: unknown }) => children as never;
