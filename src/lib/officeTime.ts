/** Office time (India). Attendance days and leave counting follow the office calendar, not the browser's. */
export const OFFICE_TZ = 'Asia/Kolkata';

/** Today as YYYY-MM-DD in office time. */
export const officeToday = (): string => new Date().toLocaleDateString('en-CA', { timeZone: OFFICE_TZ });

/** Current month as YYYY-MM in office time. */
export const officeMonth = (): string => officeToday().slice(0, 7);

/** "09:08 AM" for an ISO time, in office time. */
export const formatClock = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: OFFICE_TZ }).toUpperCase() : '';

/** An office-time date and HH:MM as an ISO instant. */
export const officeInstant = (date: string, time: string): string => new Date(`${date}T${time}:00+05:30`).toISOString();

/** "October 2026" for YYYY-MM. */
export const monthLabel = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** "02 Nov 2026" for YYYY-MM-DD. */
export const formatDay = (day: string): string =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
