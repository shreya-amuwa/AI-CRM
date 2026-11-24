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

const MEETING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * The CRM was opened from a tapped meeting push (/?open=meeting&id=..., 20270208000100): Meetings opens on that meeting.
 * A malformed id still opens Meetings, on no particular meeting.
 */
export const meetingRequestedFromUrl = (search: string): boolean => {
  const q = new URLSearchParams(search);
  if (q.get('open') !== 'meeting') return false;
  const id = q.get('id');
  pending = id && MEETING_ID.test(id) ? id : null;
  return true;
};
/** A tapped meeting push while the CRM is open (public/sw.js posts "open-meeting"). True when the message was a meeting's. */
export const handleMeetingWorkerMessage = (data: unknown): boolean => {
  const d = data as { type?: string; id?: unknown } | null;
  if (d?.type !== 'open-meeting') return false;
  openMeeting(typeof d.id === 'string' && MEETING_ID.test(d.id) ? d.id : undefined);
  return true;
};
// one listener for the whole app (several screens use useOpenMeetingRequest; each must not open the meeting again)
let workerListening = false;
const listenToWorker = () => {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (workerListening || !sw) return;
  workerListening = true;
  sw.addEventListener('message', (e: MessageEvent) => { handleMeetingWorkerMessage(e.data); });
};

/** A meeting request to HR (Meetings > HR meeting requests): shows Meetings on that tab, on the request when one is named. */
let pendingHr: { id?: string } | null = null;
export const openHrMeetingRequest = (id?: string) => {
  pendingHr = { id };
  window.dispatchEvent(new CustomEvent<{ id?: string }>(OPEN_MEETING_EVENT, { detail: {} }));
};
export const takePendingHrMeetingRequest = (): { id?: string } | null => {
  const p = pendingHr;
  pendingHr = null;
  return p;
};

/** For a dashboard (to show Meetings) and for the Meetings page (to open the meeting). */
export function useOpenMeetingRequest(show: (id?: string) => void) {
  useEffect(() => {
    listenToWorker();
    const on = (e: Event) => show((e as CustomEvent<{ id?: string }>).detail?.id);
    window.addEventListener(OPEN_MEETING_EVENT, on);
    return () => window.removeEventListener(OPEN_MEETING_EVENT, on);
  }, [show]);
}

/**
 * A meeting summary / report notification (submitted, revised, an action item given) opens Meetings on that meeting's summary report:
 * the CEO in Meeting Decisions, everyone else in Meeting summaries (20270124000200).
 */
export const OPEN_MEETING_REPORT_EVENT = 'crm:open-meeting-report';
let pendingReport: string | null = null;
export const openMeetingReport = (meetingId?: string) => {
  pendingReport = meetingId ?? null;
  // the dashboards switch to Meetings on the plain "open meeting" event (without a meeting: the drawer is not opened)
  window.dispatchEvent(new CustomEvent<{ id?: string }>(OPEN_MEETING_EVENT, { detail: {} }));
  window.dispatchEvent(new CustomEvent(OPEN_MEETING_REPORT_EVENT));
};
export const takePendingMeetingReport = (): string | null => {
  const p = pendingReport;
  pendingReport = null;
  return p;
};
export function useOpenMeetingReportRequest(cb: (meetingId: string) => void) {
  useEffect(() => {
    const on = () => {
      const id = takePendingMeetingReport();
      if (id) cb(id);
    };
    window.addEventListener(OPEN_MEETING_REPORT_EVENT, on);
    return () => window.removeEventListener(OPEN_MEETING_REPORT_EVENT, on);
  }, [cb]);
}
