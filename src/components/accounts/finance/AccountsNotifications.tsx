import React, { useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useNotifications } from '../../../context/NotificationContext';
import { Empty, Loading, PageHeader } from '../../support-member/SupportParts';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Notification Center: every notification of the signed-in user, with read / unread state. */
export const AccountsNotifications: React.FC = () => {
  const { notifications, unreadCount, loading, markAsRead, markAllAsRead } = useNotifications();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const shown = filter === 'unread' ? notifications.filter(n => !n.isRead) : notifications;

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
            {f === 'all' ? `All (${notifications.length})` : `Unread (${unreadCount})`}
          </button>
        ))}
      </div>
      {loading && notifications.length === 0 ? (
        <Loading label="Loading notifications..." />
      ) : shown.length === 0 ? (
        <Empty title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'} hint="New payment and follow-up alerts show up here." />
      ) : (
        <ul className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden" aria-label="Notifications">
          {shown.map(n => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => !n.isRead && markAsRead(n.id)}
                className={`w-full text-left px-5 py-3.5 flex gap-3 hover:bg-slate-50 ${n.isRead ? '' : 'bg-blue-50/40'}`}
                aria-label={`${n.isRead ? '' : 'Unread: '}${n.title}`}
              >
                <span className={`mt-0.5 w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${n.isRead ? 'bg-slate-100 text-slate-400' : 'bg-blue-100 text-blue-600'}`}>
                  <Bell className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className={`text-sm truncate ${n.isRead ? 'font-medium text-slate-700' : 'font-bold text-slate-900'}`}>{n.title}</span>
                    <span className="text-[11px] text-slate-400 shrink-0">{when(n.timestamp)}</span>
                  </span>
                  <span className="block text-xs text-slate-500 mt-0.5">{n.message}</span>
                </span>
                {!n.isRead && <span className="mt-2 w-2 h-2 rounded-full bg-blue-600 shrink-0" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
