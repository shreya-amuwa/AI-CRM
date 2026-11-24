import React, { Suspense, useEffect } from 'react';
import { registerServiceWorker } from '../../lib/push/registerServiceWorker';
import { useOpenAttendanceRequest } from './attendanceEvents';
import { OPEN_CHAT_EVENT, openChat, type OpenChatDetail } from '../chat/chatEvents';
import { openMeetingReport } from '../meetings/meetingEvents';

const ReminderBanner = React.lazy(() => import('./ReminderBanner'));

/**
 * The attendance reminders in a staff layout (DashboardShell, TeamMemberLayout, any future one): the service worker (public/sw.js), and
 * Attendance opening when a reminder asks for it (the bell, or a tapped notification while the CRM is open). Staff only: the client and
 * candidate portals never call this. supabase/tests/pwa_assets.test.ts checks every staff layout uses it with StaffReminderBanner.
 */
export function useStaffReminders(showAttendance: () => void, onOpenChat?: () => void) {
  useEffect(() => { void registerServiceWorker(); }, []);
  useOpenAttendanceRequest(showAttendance);
  // a chat being opened (a notification, the bell): a layout that shows Attendance on top of its pages closes it
  useEffect(() => {
    if (!onOpenChat) return;
    window.addEventListener(OPEN_CHAT_EVENT, onOpenChat);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpenChat);
  }, [onOpenChat]);
  useEffect(() => {
    // opened from a tapped notification: /?open=chat&conversation=… (colleague chat) or &client=… (client chat). The layouts read
    // ?open=attendance when they first render; here the address is cleaned so a reload does not open it again.
    const q = new URLSearchParams(window.location.search);
    if (q.get('open') === 'chat') {
      const detail = chatDetail(q.get('conversation'), q.get('client'));
      // next tick: a dashboard that wraps this layout attaches its "open chat" listener after this effect runs
      if (detail) window.setTimeout(() => openChat(detail), 0);
    }
    // a meeting notice (the Managing Director's, 20270206000100): /?open=meeting&id=<meeting>
    if (q.get('open') === 'meeting') {
      const id = q.get('id');
      if (id && UUIDISH.test(id)) window.setTimeout(() => openMeetingReport(id), 0);
    }
    if (q.has('open')) {
      for (const k of ['open', 'conversation', 'client', 'view', 'id']) q.delete(k);
      const rest = q.toString();
      window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
    }
    // a notification tapped while the CRM is already open (public/sw.js)
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    const fromWorker = (e: MessageEvent) => {
      if (e.data?.type === 'open-meeting') { if (typeof e.data.id === 'string' && UUIDISH.test(e.data.id)) openMeetingReport(e.data.id); return; }
      if (e.data?.type !== 'open-chat') return;
      const detail = chatDetail(e.data.conversationId ?? null, e.data.clientConversationId ?? null);
      if (detail) openChat(detail);
    };
    sw?.addEventListener('message', fromWorker);
    return () => sw?.removeEventListener('message', fromWorker);
  }, []);
}

const UUIDISH = /^[0-9A-Za-z-]{1,64}$/;
const chatDetail = (conversation: string | null, client: string | null): OpenChatDetail | null =>
  client && UUIDISH.test(client) ? { clientConversationId: client } : conversation && UUIDISH.test(conversation) ? { conversationId: conversation } : null;

/** "Turn on notifications" at the top of the page; hidden above a page that fills the screen (Chat). The Managing Director gets the
 *  meetings wording (they do not punch, but their meeting notices reach their phone only once a device is on). */
export const StaffReminderBanner: React.FC<{ hidden?: boolean; purpose?: 'attendance' | 'meetings' }> = ({ hidden = false, purpose = 'attendance' }) =>
  hidden ? null : <Suspense fallback={null}><ReminderBanner purpose={purpose} /></Suspense>;
