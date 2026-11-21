import type { Notification } from '../../../shared/contracts';
import type { SoundCategory } from './notificationSound';

/**
 * The pure rules of the Notification Center's sync (context/NotificationContext.tsx), kept apart so they can be tested without a browser.
 */

/** Wait before the n-th retry (1-based): 2 s, 4 s, 8 s ... at most 60 s, with a little jitter so many tabs do not retry together. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(60_000, 2000 * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.85 + random() * 0.3));
}

/** Which sound a notification type makes. Chat notifications have their own chime (the chat unread count), so they make none here. */
export function soundCategoryOf(type: string): Exclude<SoundCategory, 'chat'> | null {
  if (type === 'ATTENDANCE_REMINDER') return 'attendance';
  if (type.startsWith('CHAT_')) return null;
  return 'general';
}

/**
 * The one notification (if any) that should chime after a refresh: only rows not seen before in this session (`seen` is filled with every
 * row of the first load, so nothing loaded at sign-in chimes), unread, recent (the last 15 minutes: an old row that arrives late is shown,
 * silently), not caused by the person themselves, and with a sound. Attendance reminders win over other notifications.
 */
export function pickNotificationToChime(items: Notification[], seen: ReadonlySet<string>, meId: string | null, now = Date.now()):
  { id: string; category: Exclude<SoundCategory, 'chat'> } | null {
  let pick: { id: string; category: Exclude<SoundCategory, 'chat'> } | null = null;
  for (const n of items) {
    if (seen.has(n.id) || n.readAt || (meId && n.actorId === meId)) continue;
    const at = Date.parse(n.createdAt);
    if (!Number.isFinite(at) || now - at > 15 * 60_000) continue;
    const category = soundCategoryOf(n.type);
    if (!category) continue;
    if (!pick || (category === 'attendance' && pick.category !== 'attendance')) pick = { id: n.id, category };
  }
  return pick;
}
