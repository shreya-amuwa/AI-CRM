import { useEffect, useState } from 'react';
// The bell's notification list for the notice popup test: the test pushes a new company-notice notification like Realtime would (window.__pushBell).
export const useNotifications = () => {
  const [list, setList] = useState<any[]>(() => (window as any).__bell ?? []);
  useEffect(() => {
    const on = () => setList([...((window as any).__bell ?? [])]);
    window.addEventListener('stub:bell', on);
    return () => window.removeEventListener('stub:bell', on);
  }, []);
  return { notifications: list, unreadCount: list.filter(n => !n.isRead).length, loading: false };
};
export const NotificationProvider = ({ children }: { children: unknown }) => children as never;
