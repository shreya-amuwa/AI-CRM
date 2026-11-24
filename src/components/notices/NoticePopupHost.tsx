import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompanyNotice } from '../../../shared/contracts';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { ApiError } from '../../lib/api/client';
import { noticesApi } from '../../lib/api/notices';
import { NOTICES_CHANGED_EVENT, noticesChanged } from './noticeEvents';
import { indexAfterChange, visibleQueue } from './noticeQueue';

const Viewer = React.lazy(() => import('./NoticePopupViewer').then(m => ({ default: m.NoticePopupViewer })));

/**
 * The company-notice popup (20270202000100). Mounted once for every signed-in employee. What it shows is the database's list of notices this person has not acknowledged
 * (GET /notices/pending), read when the CRM opens, when the tab comes back, when the network returns, when a notice is published or read elsewhere, and when the bell
 * receives a new company-notice notification (Realtime). So an employee who was offline gets the notice at the next opening, and one who is online gets it at once.
 * An acknowledged notice is gone from that list for good; a notice put off with "Remind me later" is not shown again until the CRM is reopened (Urgent ones cannot be put off).
 */
export const NoticePopupHost: React.FC = () => {
  const { profile } = useAuth();
  const { notifications } = useNotifications();
  const me = profile?.id ?? null;
  const [pending, setPending] = useState<CompanyNotice[]>([]);
  const [postponed, setPostponed] = useState<ReadonlySet<string>>(new Set());
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!me) return;
    const mine = ++seq.current;
    try {
      const r = await noticesApi.pending();
      if (mine === seq.current) setPending(r.items);
    } catch {
      // not an employee, signed out, or offline: nothing to show now; the next trigger tries again
    }
  }, [me]);

  // a different person (sign-in, sign-out): start clean, then read
  useEffect(() => {
    seq.current++;
    setPending([]); setPostponed(new Set()); setIndex(0); setError('');
    void load();
  }, [me, load]);

  useEffect(() => {
    if (!me) return undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    const onNow = () => void load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onNow);
    window.addEventListener('online', onNow);
    window.addEventListener(NOTICES_CHANGED_EVENT, onNow);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onNow);
      window.removeEventListener('online', onNow);
      window.removeEventListener(NOTICES_CHANGED_EVENT, onNow);
    };
  }, [me, load]);

  // a company-notice notification reached the bell (Realtime or a later read): read the queue again
  const unreadNoticeBells = useMemo(() => notifications.filter(n => n.type === 'COMPANY_NOTICE' && !n.isRead).map(n => n.id).sort().join(','), [notifications]);
  useEffect(() => { if (unreadNoticeBells) void load(); }, [unreadNoticeBells, load]);

  const queue = useMemo(() => visibleQueue(pending, postponed), [pending, postponed]);
  const shown = useRef<CompanyNotice[]>([]);
  // when the list changes (one acknowledged, a new one arrived) stay on the notice being read
  useEffect(() => {
    setIndex(i => indexAfterChange(shown.current, i, queue));
    shown.current = queue;
  }, [queue]);

  const acknowledge = useCallback(async (n: CompanyNotice) => {
    setBusy(true); setError('');
    try {
      await noticesApi.acknowledge(n.id);
      setPending(list => list.filter(x => x.id !== n.id));
      noticesChanged();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'The notice could not be acknowledged. Please try again.');
    } finally {
      setBusy(false);
    }
  }, []);
  const later = useCallback((n: CompanyNotice) => setPostponed(s => new Set(s).add(n.id)), []);

  if (!me || queue.length === 0) return null;
  return (
    <Suspense fallback={null}>
      <Viewer queue={queue} index={Math.min(index, queue.length - 1)} busy={busy} error={error} onIndex={setIndex} onAcknowledge={n => void acknowledge(n)} onLater={later} />
    </Suspense>
  );
};

export default NoticePopupHost;
