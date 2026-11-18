import { useEffect } from 'react';

/**
 * Opening the Attendance page from elsewhere: a reminder in the CRM bell, a tapped phone/laptop notification (public/sw.js posts
 * "open-attendance" to an open CRM window, or opens /?open=attendance). The page then shows the person's own day ("My attendance").
 */
export const OPEN_ATTENDANCE_EVENT = 'crm:open-attendance';
let pending = false;

export const openAttendance = () => {
  pending = true;
  window.dispatchEvent(new CustomEvent(OPEN_ATTENDANCE_EVENT));
};
/** The page takes the request when it opens (once): true = show "My attendance". */
export const takePendingAttendance = (): boolean => {
  const p = pending;
  pending = false;
  return p;
};
/** The CRM was opened from a notification (/?open=attendance). */
export const attendanceRequested = () => {
  if (typeof window === 'undefined' || new URLSearchParams(window.location.search).get('open') !== 'attendance') return false;
  pending = true;
  return true;
};

/** For the dashboard shell: show Attendance when something asks for it (the bell, or a tapped notification while the CRM is open). */
export function useOpenAttendanceRequest(show: () => void) {
  useEffect(() => {
    const on = () => show();
    const fromWorker = (e: MessageEvent) => { if (e.data?.type === 'open-attendance') openAttendance(); };
    window.addEventListener(OPEN_ATTENDANCE_EVENT, on);
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    sw?.addEventListener('message', fromWorker);
    return () => {
      window.removeEventListener(OPEN_ATTENDANCE_EVENT, on);
      sw?.removeEventListener('message', fromWorker);
    };
  }, [show]);
}
