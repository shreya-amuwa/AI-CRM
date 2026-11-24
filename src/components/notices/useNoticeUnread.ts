import { useCallback, useEffect, useState } from 'react';
import { noticesApi } from '../../lib/api/notices';
import { listenToTables } from '../../lib/realtimeShared';
import { NOTICES_CHANGED_EVENT } from './noticeEvents';

/**
 * The unread notice count for the side panel's "Notice Board" badge (20270131000200). Reloads when a notice notification arrives
 * (Realtime on notifications), when a notice is opened, and when the tab is shown again. Silent when the API is not reachable.
 */
export function useNoticeUnread(enabled = true): number {
  const [unread, setUnread] = useState(0);
  const reload = useCallback(() => { if (enabled) noticesApi.unreadCount().then(setUnread, () => undefined); }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    reload();
    let stop: () => void = () => undefined;
    try { stop = listenToTables(['notifications'], reload); } catch { /* without Realtime: reloads on the events below */ }
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener(NOTICES_CHANGED_EVENT, reload);
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop(); window.removeEventListener(NOTICES_CHANGED_EVENT, reload); document.removeEventListener('visibilitychange', onVisible); };
  }, [enabled, reload]);
  return unread;
}
