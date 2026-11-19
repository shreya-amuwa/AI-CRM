import { useEffect } from 'react';

/**
 * Meetings, kept current and opened from elsewhere:
 *   - "changed": a meeting notification just arrived (a request, an approval, a move, a cancellation), so an open Meetings page reloads
 *     at once (the Requests tab shows a new request without a refresh);
 *   - "open": a meeting notification was clicked (the bell, the notification centre), so the dashboard shows Meetings on that meeting.
 */
export const MEETINGS_CHANGED_EVENT = 'crm:meetings-changed';
export const OPEN_MEETING_EVENT = 'crm:open-meeting';

export const notifyMeetingsChanged = () => window.dispatchEvent(new CustomEvent(MEETINGS_CHANGED_EVENT));

/** For the Meetings page: reload when a meeting changes. */
export function useMeetingsChanged(cb: () => void) {
  useEffect(() => {
    window.addEventListener(MEETINGS_CHANGED_EVENT, cb);
    return () => window.removeEventListener(MEETINGS_CHANGED_EVENT, cb);
  }, [cb]);
}

let pending: string | null = null;

export const openMeeting = (id?: string) => {
  pending = id ?? null;
  window.dispatchEvent(new CustomEvent<{ id?: string }>(OPEN_MEETING_EVENT, { detail: { id } }));
};
/** The Meetings page takes the meeting asked for when it opens (once). */
export const takePendingMeeting = (): string | null => {
  const p = pending;
  pending = null;
  return p;
};

/** For a dashboard (to show Meetings) and for the Meetings page (to open the meeting). */
export function useOpenMeetingRequest(show: (id?: string) => void) {
  useEffect(() => {
    const on = (e: Event) => show((e as CustomEvent<{ id?: string }>).detail?.id);
    window.addEventListener(OPEN_MEETING_EVENT, on);
    return () => window.removeEventListener(OPEN_MEETING_EVENT, on);
  }, [show]);
}
