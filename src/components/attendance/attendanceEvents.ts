import { useEffect } from 'react';

/**
 * Opening the Attendance page from elsewhere: a reminder in the CRM bell, a tapped phone/laptop notification (public/sw.js posts
 * "open-attendance" to an open CRM window, or opens /?open=attendance). The page then shows the person's own day ("My attendance").
 */
export const OPEN_ATTENDANCE_EVENT = 'crm:open-attendance';
/** 'mine': the person's own day (a reminder); 'today': Today's Attendance Overview (the Super Admin's 11:00 alert, 20270131000100) */
export type AttendanceView = 'mine' | 'today' | 'team' | 'corrections';
let pending: AttendanceView | null = null;

export const openAttendance = (view: AttendanceView = 'mine') => {
  pending = view;
  window.dispatchEvent(new CustomEvent(OPEN_ATTENDANCE_EVENT, { detail: { view } }));
};
/** The page takes the request when it opens (once): which view to show, or null. */
export const takePendingAttendance = (): AttendanceView | null => {
  const p = pending;
  pending = null;
  return p;
};
/** The CRM was opened from a notification (/?open=attendance, or /?open=attendance&view=today). */
export const attendanceRequested = () => {
  if (typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  if (q.get('open') !== 'attendance') return false;
  const v = q.get('view');
  pending = v === 'today' || v === 'team' || v === 'corrections' ? v : 'mine';
  return true;
};

/** For the dashboard shell: show Attendance when something asks for it (the bell, or a tapped notification while the CRM is open). */
export function useOpenAttendanceRequest(show: () => void) {
  useEffect(() => {
    const on = () => show();
    const fromWorker = (e: MessageEvent) => { if (e.data?.type === 'open-attendance') openAttendance(e.data.view === 'today' ? 'today' : 'mine'); };
    window.addEventListener(OPEN_ATTENDANCE_EVENT, on);
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
    sw?.addEventListener('message', fromWorker);
    return () => {
      window.removeEventListener(OPEN_ATTENDANCE_EVENT, on);
      sw?.removeEventListener('message', fromWorker);
    };
  }, [show]);
}
