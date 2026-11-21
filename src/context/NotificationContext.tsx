import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Notification, TeamDivision } from '../../shared/contracts';
import { notificationsApi } from '../lib/api/endpoints';
import { errorMessage } from '../lib/api/client';
import { getSupabase } from '../services/supabaseClient';
import { useAuth } from './AuthContext';
import { useDepartments } from './DepartmentContext';
import { notifyMeetingsChanged } from '../components/meetings/meetingEvents';
import { notifyWorkUpdatesChanged } from '../lib/workUpdates';
import { attendanceApi } from '../lib/attendance';
import { applySoundPrefs, armAudioUnlock, onSoundPrefsChange, playNotificationSound } from '../lib/notifications/notificationSound';
import { backoffMs, pickNotificationToChime } from '../lib/notifications/notificationSync';

/**
 * Notifications are rows in Supabase, one per recipient. The server returns
 * only the signed-in user's notifications (RLS), so no client-side privacy
 * filtering is needed. Realtime changes trigger a refetch.
 *
 * Reliability (20270125000200): a Realtime channel can drop (network change, laptop sleep, token refresh, a phone suspending the tab).
 * Then the channel is opened again with growing pauses, and the list is read again when it is back, when the tab becomes visible or
 * focused, when the network returns and when a push notification arrives (public/sw.js). Only while Realtime is down and the tab is on
 * screen is the list also read every 30 seconds. One read at a time; a failed read is retried 2 s, 4 s ... 60 s later. A new notification
 * chimes once (lib/notifications/notificationSound.ts); nothing loaded at sign-in chimes.
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
  /** The message an @mention points at (chat_mention notifications). */
  messageId?: string;
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
  /** Live updates: 'live' (Realtime connected), 'connecting', or 'offline' (reconnecting; the list is read on a timer meanwhile). */
  realtimeStatus: RealtimeStatus;
  /** The last read failed: shown in the Notification Center (the last known list stays). */
  syncError: string | null;
}
export type RealtimeStatus = 'live' | 'connecting' | 'offline';

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
    entityId: n.entityId,
    ...(typeof n.data?.messageId === 'string' ? { messageId: n.data.messageId as string } : {})
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
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('connecting');
  const [syncError, setSyncError] = useState<string | null>(null);
  const profileId = profile?.id ?? null;
  // one read at a time; a read asked for meanwhile runs once more right after
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  // the account this state belongs to: an answer for a previous account (sign-out, another person on the same browser) is dropped
  const generation = useRef(0);
  const seen = useRef<Set<string> | null>(null);
  const retry = useRef<{ attempt: number; timer: ReturnType<typeof setTimeout> | null }>({ attempt: 0, timer: null });

  const readOnce = useCallback(async (gen: number) => {
    const [page, unread] = await Promise.all([notificationsApi.list({ pageSize: PAGE_SIZE }), notificationsApi.unreadCount()]);
    if (gen !== generation.current) return;
    // a new notification since the last read: one chime (the first read only remembers what is there)
    if (seen.current) {
      const pick = pickNotificationToChime(page.items, seen.current, profileId);
      if (pick) playNotificationSound(pick.category, pick.id);
    } else {
      seen.current = new Set();
    }
    for (const n of page.items) seen.current.add(n.id);
    setNotifications(page.items.map(toAppNotification));
    setUnreadCount(unread.count);
  }, [profileId]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!profileId) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    if (inFlight.current) {
      again.current = true;
      return inFlight.current;
    }
    const gen = generation.current;
    setLoading(true);
    const run = (async () => {
      try {
        do {
          again.current = false;
          await readOnce(gen);
        } while (again.current && gen === generation.current);
        if (gen !== generation.current) return;
        setSyncError(null);
        retry.current.attempt = 0;
      } catch (err) {
        if (gen !== generation.current) return;
        // keep the last known list; try again a little later (a network drop must not stop the bell for good)
        setSyncError(errorMessage(err));
        const r = retry.current;
        r.attempt += 1;
        if (r.timer) clearTimeout(r.timer);
        r.timer = setTimeout(() => { r.timer = null; void refreshRef.current(); }, backoffMs(r.attempt));
      } finally {
        inFlight.current = null;
        if (gen === generation.current) setLoading(false);
      }
    })();
    inFlight.current = run;
    return run;
  }, [profileId, readOnce]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // A new account: forget everything about the previous one.
  useEffect(() => {
    generation.current += 1;
    seen.current = null;
    inFlight.current = null;
    again.current = false;
    if (retry.current.timer) clearTimeout(retry.current.timer);
    retry.current = { attempt: 0, timer: null };
    setNotifications([]);
    setUnreadCount(0);
    setSyncError(null);
  }, [profileId]);

  // Initial load + Realtime: new rows for this recipient trigger a refetch. The channel is re-opened when it fails or closes.
  useEffect(() => {
    void refresh();
    if (!profileId) return;
    const supabase = getSupabase();
    if (!supabase) return;
    let stopped = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let attempt = 0;
    let reopen: ReturnType<typeof setTimeout> | null = null;
    let dropped = false;
    const open = () => {
      if (stopped) return;
      setRealtimeStatus('connecting');
      const ch = supabase
        .channel(`notifications-${profileId}-${Math.random().toString(36).slice(2, 8)}`)
        .on(
          'postgres_changes',
          // Any change (new, read on another device, deleted) keeps every device in sync.
          { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${profileId}` },
          (payload: { new?: { entity_type?: string | null; type?: string | null } | null }) => {
            // a meeting notification: an open Meetings page reloads at once (a new request shows without a refresh)
            if (payload?.new?.entity_type === 'meeting' || payload?.new?.entity_type === 'meeting_summary') notifyMeetingsChanged();
            // a work update notification (requested, reminder, submitted): open Work Updates / Update Requests reload at once
            if (payload?.new?.entity_type === 'work_task') notifyWorkUpdatesChanged();
            void refreshRef.current();
          }
        );
      channel = ch;
      ch.subscribe((status: string) => {
        if (stopped || channel !== ch) return;
        if (status === 'SUBSCRIBED') {
          attempt = 0;
          setRealtimeStatus('live');
          // events may have been missed while the channel was down
          if (dropped) void refreshRef.current();
          dropped = false;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          dropped = true;
          setRealtimeStatus('offline');
          channel = null;
          void supabase.removeChannel(ch).catch(() => undefined);
          attempt += 1;
          if (reopen) clearTimeout(reopen);
          reopen = setTimeout(open, backoffMs(attempt));
        }
      });
    };
    open();
    return () => {
      stopped = true;
      if (reopen) clearTimeout(reopen);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [profileId, refresh]);

  // Coming back: the tab is shown or focused again, the network is back, a push arrived. At most one read every 5 seconds.
  useEffect(() => {
    if (!profileId) return;
    let last = 0;
    const soon = () => {
      if (Date.now() - last < 5000) return;
      last = Date.now();
      void refreshRef.current();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') soon(); };
    const fromWorker = (e: MessageEvent) => { if (e.data?.type === 'push-received') soon(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', soon);
    window.addEventListener('online', soon);
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    sw?.addEventListener('message', fromWorker);
    armAudioUnlock();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', soon);
      window.removeEventListener('online', soon);
      sw?.removeEventListener('message', fromWorker);
    };
  }, [profileId]);

  // While Realtime is down: read every 30 seconds, only with the tab on screen (no polling when it works, none in the background).
  useEffect(() => {
    if (!profileId || realtimeStatus !== 'offline') return;
    const t = setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine !== false) void refreshRef.current(); }, 30_000);
    return () => clearInterval(t);
  }, [profileId, realtimeStatus]);

  // The person's sound settings follow them across browsers: read once per sign-in, saved when they change them (any screen).
  useEffect(() => {
    if (!profileId) return;
    let live = true;
    attendanceApi.reminderSettings().then(s => { if (live && s.sound) applySoundPrefs(s.sound); }, () => undefined);
    const off = onSoundPrefsChange(p => { void attendanceApi.saveSound(p.attendance, p.chat, p.general).catch(() => undefined); });
    // what this browser reports (permission, subscribed, sound allowed) for Notification Health: once a day or when it changes
    const check = setTimeout(() => { void import('../lib/push/pushSupport').then(m => m.reportDeviceCheck(profileId)); }, 4000);
    return () => { live = false; off(); clearTimeout(check); };
  }, [profileId]);

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
        deleteNotification,
        realtimeStatus,
        syncError
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
