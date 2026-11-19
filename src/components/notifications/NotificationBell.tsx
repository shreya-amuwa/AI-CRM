import React, { useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';
import { SideDrawer } from '../common/SideDrawer';
import { openChat } from '../chat/chatEvents';
import { openFromNotification } from '../issues/issueEvents';
import { CeoAvailabilityBadge } from '../meetings/CeoPresence';

/**
 * The bell in the header: the unread count, and a side panel with the person's own notifications (newest first),
 * mark one / mark all as read. The list is the database (only the signed-in person's rows) and refreshes in real time.
 */
export const NotificationBell: React.FC = () => {
  const { notifications, unreadCount, markAsRead, markAllAsRead, loading } = useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* the CEO's live meeting availability, on every dashboard (Realtime) */}
      <CeoAvailabilityBadge />
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-haspopup="dialog"
        className="relative p-2 rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors cursor-pointer"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <SideDrawer
          title="Notifications"
          subtitle={unreadCount > 0 ? `${unreadCount} unread` : 'You are all caught up.'}
          onClose={() => setOpen(false)}
          actions={
            unreadCount > 0 ? (
              <button type="button" onClick={() => markAllAsRead()} className="text-xs font-semibold text-blue-600 hover:text-blue-700 cursor-pointer">
                Mark all as read
              </button>
            ) : undefined
          }
        >
          {notifications.length === 0 ? (
            <div className="py-16 px-6 text-center text-slate-400">
              <BellOff className="w-8 h-8 mx-auto mb-3" aria-hidden="true" />
              <p className="text-sm font-semibold text-slate-600">{loading ? 'Loading…' : 'No notifications yet'}</p>
              <p className="text-xs mt-1">New alerts show up here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {notifications.map(n => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => { markAsRead(n.id); if (n.entityType === 'chat' && n.entityId) { setOpen(false); openChat({ clientConversationId: n.entityId }); } else if (openFromNotification(n)) setOpen(false); }}
                    aria-label={`${n.isRead ? '' : 'Unread: '}${n.title}`}
                    className={`w-full text-left px-5 py-3.5 hover:bg-slate-50 transition-colors cursor-pointer ${n.isRead ? '' : 'bg-blue-50/50'}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.isRead ? 'bg-transparent' : 'bg-blue-500'}`} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className={`text-xs ${n.isRead ? 'font-medium text-slate-700' : 'font-bold text-slate-900'}`}>{n.title}</span>
                          {n.priority === 'urgent' && !n.isRead && (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 shrink-0">Action</span>
                          )}
                        </div>
                        {n.message && <p className="text-[11px] text-slate-500 mt-0.5 break-words">{n.message}</p>}
                        <p className="text-[10px] text-slate-400 mt-1">{n.timestamp}</p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SideDrawer>
      )}
    </>
  );
};
