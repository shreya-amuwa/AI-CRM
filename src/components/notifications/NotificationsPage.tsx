import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import type { Notification, Paginated } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { notificationsApi } from '../../lib/api/endpoints';
import { useNotifications } from '../../context/NotificationContext';
import { Empty, ErrorBanner, Loading, PageHeader, Pager } from '../support-member/SupportParts';

export const NOTIFICATIONS_PAGE_SIZE = 10;

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });

/**
 * Notification Center for every dashboard: the signed-in user's own notifications,
 * newest first, ten per page (the server pages them, so page 2 is really the next ten).
 */
export const NotificationsPage: React.FC = () => {
  const { unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<Notification> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    const n = ++seq.current;
    notificationsApi.list({ unreadOnly: filter === 'unread' || undefined, page, pageSize: NOTIFICATIONS_PAGE_SIZE }).then(
      r => {
        if (n !== seq.current) return;
        // A page that no longer exists (items were read or removed): go back to the last one.
        if (r.items.length === 0 && page > 1) return setPage(Math.max(1, Math.ceil(r.total / NOTIFICATIONS_PAGE_SIZE)));
        setData(r);
        setError(null);
      },
      e => n === seq.current && setError(errorMessage(e))
    );
  }, [filter, page]);
  // Reload on page / filter change and whenever the notification context sees a change (realtime or read state).
  useEffect(load, [load, unreadCount]);
  useEffect(() => setPage(1), [filter]);

  const open = (n: Notification) => {
    if (n.readAt) return;
    markAsRead(n.id);
    setData(d => (d ? { ...d, items: d.items.map(i => (i.id === n.id ? { ...i, readAt: new Date().toISOString() } : i)) } : d));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notification Center"
        subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'You are all caught up.'}
        action={
          unreadCount > 0 ? (
            <button type="button" onClick={() => markAllAsRead()} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <CheckCheck className="w-4 h-4" aria-hidden="true" /> Mark all read
            </button>
          ) : undefined
        }
      />
      <div className="flex gap-2" role="tablist" aria-label="Filter notifications">
        {(['all', 'unread'] as const).map(f => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold ${filter === f ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {f === 'all' ? 'All' : `Unread (${unreadCount})`}
          </button>
        ))}
      </div>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data && !error ? (
        <Loading label="Loading notifications..." />
      ) : data && data.items.length === 0 ? (
        <Empty title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'} hint="New alerts show up here." />
      ) : (
        data && (
          <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
            <ul className="divide-y divide-slate-100" aria-label="Notifications">
              {data.items.map(n => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => open(n)}
                    className={`w-full text-left px-5 py-3.5 flex gap-3 hover:bg-slate-50 ${n.readAt ? '' : 'bg-blue-50/40'}`}
                    aria-label={`${n.readAt ? '' : 'Unread: '}${n.title}`}
                  >
                    <span className={`mt-0.5 w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${n.readAt ? 'bg-slate-100 text-slate-400' : 'bg-blue-100 text-blue-600'}`}>
                      <Bell className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={`text-sm truncate ${n.readAt ? 'font-medium text-slate-700' : 'font-bold text-slate-900'}`}>{n.title}</span>
                        <span className="text-[11px] text-slate-400 shrink-0">{when(n.createdAt)}</span>
                      </span>
                      <span className="block text-xs text-slate-500 mt-0.5">{n.body}</span>
                    </span>
                    {!n.readAt && <span className="mt-2 w-2 h-2 rounded-full bg-blue-600 shrink-0" aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
            <Pager page={data.page ?? page} pageSize={NOTIFICATIONS_PAGE_SIZE} total={data.total} onPage={setPage} />
          </div>
        )
      )}
    </div>
  );
};
