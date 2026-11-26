import { useCallback, useEffect, useState } from 'react';
import { noticesApi } from '../../lib/api/notices';
import { NOTIFICATIONS_CHANGED_EVENT } from '../../lib/notifications/notificationsChanged';
import { NOTICES_CHANGED_EVENT } from './noticeEvents';

/**
 * The unread notice count for the side panel's "Notice Board" badge (20270131000200). Reloads when a notice notification arrives
 * (the bell's own filtered Realtime channel announces it), when a notice is opened, and when the tab is shown again. Silent when the API is
 * not reachable.
 */
export function useNoticeUnread(enabled = true): number {
  const [unread, setUnread] = useState(0);
  const reload = useCallback(() => { if (enabled) noticesApi.unreadCount().then(setUnread, () => undefined); }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    reload();
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    // a burst of notifications (e.g. the backlog after a stall) reloads the count once, 1 s after the last one
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(reload, 1000); };
    window.addEventListener(NOTICES_CHANGED_EVENT, reload);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, soon);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener(NOTICES_CHANGED_EVENT, reload);
      if (timer) clearTimeout(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, soon);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, reload]);
  return unread;
}
