import { getSupabase } from '../services/supabaseClient';
import { api } from './api/client';

/**
 * Attendance (migration 20261230000400): Punch In / Punch Out with the device location, and lunch breaks. Every time is the server's; the
 * database decides who may read what (own days; HR and the Super Admin everyone; an Operations Head lunch durations of their scope only).
 */
export type LocationStatus = 'CAPTURED' | 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED' | 'PURGED';
export interface PunchInfo { at: string; locationStatus: LocationStatus; latitude: number | null; longitude: number | null; accuracy: number | null; place?: string | null }
export interface AttendanceDayData {
  date: string; serverTime: string;
  punchIn: PunchInfo | null; punchOut: PunchInfo | null; punchOutCount: number; workedMinutes: number | null;
  lunch: {
    allowanceMinutes: number; minutes: number; exceededMinutes: number;
    open: { id: string; startedAt: string } | null;
    sessions: { startedAt: string; endedAt: string | null; endedBy: string | null; minutes: number }[];
  };
}
export interface HrPunchRow {
  profileId: string; name: string; department: string | null; date: string;
  punchIn: PunchInfo | null; punchOut: PunchInfo | null; punchOutHistory: { at: string; locationStatus: LocationStatus }[];
  missingPunchOut: boolean; workedMinutes: number | null; locationUnavailable: boolean; lunchMinutes: number; lunchExceededMinutes: number;
}
export interface LunchRow { profileId: string; name: string; department: string | null; date: string; firstStart: string; lastEnd: string | null; minutes: number; exceededMinutes: number; flagged: boolean }

export interface CapturedLocation { status: LocationStatus; latitude: number | null; longitude: number | null; accuracy: number | null }

/** Asks the browser for the current position once (only when the person presses a punch button). Never invents a position. */
export function captureLocation(timeoutMs = 15000): Promise<CapturedLocation> {
  return new Promise(resolve => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve({ status: 'UNSUPPORTED', latitude: null, longitude: null, accuracy: null });
    navigator.geolocation.getCurrentPosition(
      p => resolve({ status: 'CAPTURED', latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      e => resolve({ status: e.code === 1 ? 'DENIED' : e.code === 3 ? 'TIMEOUT' : 'UNAVAILABLE', latitude: null, longitude: null, accuracy: null }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const db = getSupabase();
  if (!db) throw new Error('The CRM is not connected to its database.');
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message.replace(/^[A-Z_]+:\s*/, ''));
  return data as T;
}
const newRequestId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const punchArgs = (l: CapturedLocation, request: string) => ({ p_location_status: l.status, p_lat: l.latitude, p_lng: l.longitude, p_accuracy: l.accuracy, p_request: request });

export const attendanceApi = {
  today: () => rpc<AttendanceDayData>('attendance_today'),
  /** One request id per press: a network retry of the same press is never a second punch. */
  punchIn: (l: CapturedLocation, request = newRequestId()) => rpc<AttendanceDayData>('attendance_punch_in', punchArgs(l, request)),
  punchOut: (l: CapturedLocation, request = newRequestId()) => rpc<AttendanceDayData>('attendance_punch_out', punchArgs(l, request)),
  lunch: (action: 'START' | 'END') => rpc<AttendanceDayData>('attendance_lunch', { p_action: action }),
  mine: (from: string, to: string) => rpc<AttendanceDayData[]>('my_attendance', { p_from: from, p_to: to }),
  hrPunches: (from: string, to: string, departmentId?: string | null) =>
    rpc<{ allowanceMinutes: number; retentionDays: number; rows: HrPunchRow[] }>('hr_attendance_punches', { p_from: from, p_to: to, p_department: departmentId || null, p_profile: null }),
  /** Ask the server to look up the place names still missing (a few at a time); harmless to call often. */
  resolvePlaces: () => api.post<{ looked: number; named: number; failed: number }>('/attendance/resolve-places', {}),
  lunchOverview: (from: string, to: string) => rpc<{ allowanceMinutes: number; rows: LunchRow[] }>('attendance_lunch_overview', { p_from: from, p_to: to })
};

const IST_TIME = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
const IST_DATE = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
/** 12-hour India time, e.g. "9:05 am". */
export const istTime = (iso: string | null | undefined) => (iso ? IST_TIME.format(new Date(iso)) : '-');
export const istDate = (isoDate: string) => { const [y, m, d] = isoDate.split('-').map(Number); return IST_DATE.format(new Date(Date.UTC(y, m - 1, d, 6))); };
export const minutesLabel = (m: number | null | undefined) => (m == null ? '-' : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
export const locationLabel = (p: PunchInfo | null) =>
  !p ? '-' : p.locationStatus === 'CAPTURED' ? (p.place || 'Finding the place name…')
  : p.locationStatus === 'PURGED' ? 'Location erased after 90 days'
  : p.locationStatus === 'DENIED' ? 'Location unavailable (permission denied)'
  : p.locationStatus === 'TIMEOUT' ? 'Location unavailable (timed out)'
  : p.locationStatus === 'UNSUPPORTED' ? 'Location unavailable (not supported)' : 'Location unavailable';
export const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
export const shiftDate = (iso: string, days: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
