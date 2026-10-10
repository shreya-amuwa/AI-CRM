import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Notification, TeamDivision } from '../../shared/contracts';
import { notificationsApi } from '../lib/api/endpoints';
import { errorMessage } from '../lib/api/client';
import { getSupabase } from '../services/supabaseClient';
import { useAuth } from './AuthContext';
import { useDepartments } from './DepartmentContext';

/**
 * Notifications are rows in Supabase, one per recipient. The server returns
 * only the signed-in user's notifications (RLS), so no client-side privacy
 * filtering is needed. Realtime changes trigger a refetch.
 */
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  senderName: string;
  senderDept: string;
  /** Kept for the existing filter UI: 'all' | 'sales' | 'support'. */
  targetKey: string;
  targetLabel: string;
  priority: 'normal' | 'urgent' | 'announcement';
  timestamp: string;
  isRead: boolean;
  entityType: string | null;
  entityId: string | null;
}

export interface SendNotificationInput {
  title: string;
  message: string;
  /** 'all' | 'sales' | 'support' | '<departmentSlug>' | '<departmentSlug>_sales' | '<departmentSlug>_support' */
  targetKey: string;
  priority: AppNotification['priority'];
  // Legacy fields still passed by callers; the server derives the sender itself.
  senderName?: string;
  senderDept?: string;
  senderDeptKey?: string;
  targetLabel?: string;
}

type SubDept = 'sales' | 'support' | 'education_training' | 'product_training' | null;

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  loading: boolean;
  refresh: () => Promise<void>;
  getNotificationsForUser: (currentDeptKey?: string, currentSubDept?: SubDept) => AppNotification[];
  getUnreadCountForUser: (currentDeptKey?: string, currentSubDept?: SubDept) => number;
  sendNotification: (notification: SendNotificationInput) => Promise<{ ok: boolean; message: string }>;
  markAsRead: (id: string) => void;
  markAllAsRead: (currentDeptKey?: string, currentSubDept?: SubDept) => void;
  deleteNotification: (id: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  USER_REGISTRATION_REQUEST: 'Account approval request',
  USER_APPROVED: 'Account update',
  USER_REJECTED: 'Account update',
  USER_SUSPENDED: 'Account update',
  USER_REVOKED: 'Account update',
  USER_REINSTATED: 'Account update',
  ROLE_CHANGED: 'Account update',
  CUSTOMER_CREATED: 'Customer activity',
  CUSTOMER_UPDATED: 'Customer activity',
  CUSTOMER_ASSIGNED: 'Customer activity',
  ANNOUNCEMENT: 'Announcement'
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `${time} Today`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${time}`;
}

function toAppNotification(n: Notification): AppNotification {
  const division = typeof n.data.division === 'string' ? (n.data.division as string).toLowerCase() : null;
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.body,
    senderName: (n.data.sender_name as string) || (n.type === 'ANNOUNCEMENT' ? 'Management' : 'CRM System'),
    senderDept: (n.data.sender_department as string) || '',
    targetKey: division || 'all',
    targetLabel: TYPE_LABELS[n.type] || n.type.replace(/_/g, ' ').toLowerCase(),
    priority: n.priority,
    timestamp: formatTimestamp(n.createdAt),
    isRead: !!n.readAt,
    entityType: n.entityType,
    entityId: n.entityId
  };
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);
const PAGE_SIZE = 100;

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const { departments } = useDepartments();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!profile) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    setLoading(true);
    try {
      const [page, unread] = await Promise.all([notificationsApi.list({ pageSize: PAGE_SIZE }), notificationsApi.unreadCount()]);
      setNotifications(page.items.map(toAppNotification));
      setUnreadCount(unread.count);
    } catch {
      /* keep last known state */
    } finally {
      setLoading(false);
    }
  }, [profile]);

  // Initial load + Realtime: new rows for this recipient trigger a refetch.
  useEffect(() => {
    void refresh();
    if (!profile) return;
    const supabase = getSupabase();
    const channel = supabase
      ?.channel(`notifications-${profile.id}`)
      .on(
        'postgres_changes',
        // Any change (new, read on another device, deleted) keeps every device in sync.
        { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${profile.id}` },
        () => void refresh()
      )
      .subscribe();
    return () => {
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [profile, refresh]);

  const markAsRead = (id: string) => {
    const target = notifications.find(n => n.id === id);
    if (!target || target.isRead) return;
    void notificationsApi
      .markRead(id)
      .then(updated => {
        setNotifications(prev => prev.map(n => (n.id === id ? toAppNotification(updated) : n)));
        setUnreadCount(c => Math.max(0, c - 1));
      })
      .catch(() => void refresh());
  };

  const markAllAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    setUnreadCount(0);
    void notificationsApi.markAllRead().then(refresh).catch(() => void refresh());
  };

  const deleteNotification = (id: string) => {
    void notificationsApi
      .remove(id)
      .then(refresh)
      .catch(() => void refresh());
  };

  /** Announcements are fanned out by the database within the sender's scope. */
  const sendNotification = async (input: SendNotificationInput) => {
    const [deptPart, divisionPart] = input.targetKey.split('_');
    let departmentId: string | undefined;
    let division: TeamDivision | undefined;
    if (input.targetKey === 'sales' || input.targetKey === 'support') {
      division = input.targetKey.toUpperCase() as TeamDivision;
    } else if (input.targetKey !== 'all') {
      departmentId = departments.find(d => d.id === deptPart)?.dbId;
      if (divisionPart === 'sales' || divisionPart === 'support') division = divisionPart.toUpperCase() as TeamDivision;
    }
    try {
      const { recipients } = await notificationsApi.broadcast({
        title: input.title,
        body: input.message,
        priority: input.priority,
        departmentId,
        division
      });
      return { ok: true, message: `Announcement delivered to ${recipients} recipient(s).` };
    } catch (err) {
      return { ok: false, message: errorMessage(err) };
    }
  };

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        refresh,
        getNotificationsForUser: () => notifications,
        getUnreadCountForUser: () => unreadCount,
        sendNotification,
        markAsRead,
        markAllAsRead,
        deleteNotification
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider');
  return context;
};
