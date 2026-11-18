import { getSupabase } from '../services/supabaseClient';
import { api } from './api/client';

/**
 * Attendance (migration 20261230000400): Punch In / Punch Out with the device location, and lunch breaks. Every time is the server's; the
 * database decides who may read what (own days; HR and the Super Admin everyone; an Operations Head lunch durations of their scope only).
 */
export type LocationStatus = 'CAPTURED' | 'DENIED' | 'UNAVAILABLE' | 'TIMEOUT' | 'UNSUPPORTED' | 'PURGED';
/** The state of a person's attendance day (computed by the database, migration 20261230000700). */
export type AttendanceStatus = 'NOT_PUNCHED_IN' | 'PUNCHED_IN' | 'ON_LUNCH' | 'RESUMED_WORK' | 'PUNCHED_OUT' | 'INCOMPLETE';
export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  NOT_PUNCHED_IN: 'Not Punched In', PUNCHED_IN: 'Punched In', ON_LUNCH: 'On Lunch', RESUMED_WORK: 'Resumed Work',
  PUNCHED_OUT: 'Punched Out', INCOMPLETE: 'Incomplete Attendance'
};
export const STATUS_TONE: Record<AttendanceStatus, string> = {
  NOT_PUNCHED_IN: 'bg-slate-100 text-slate-700 border-slate-200', PUNCHED_IN: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  ON_LUNCH: 'bg-amber-50 text-amber-800 border-amber-200', RESUMED_WORK: 'bg-sky-50 text-sky-800 border-sky-200',
  PUNCHED_OUT: 'bg-indigo-50 text-indigo-800 border-indigo-200', INCOMPLETE: 'bg-rose-50 text-rose-700 border-rose-200'
};
export interface PunchInfo { at: string; locationStatus: LocationStatus; latitude: number | null; longitude: number | null; accuracy: number | null; place?: string | null }
export interface LunchSession { startedAt: string; endedAt: string | null; endedBy: string | null; minutes: number }
export interface LunchInfo {
  allowanceMinutes: number; minutes: number; remainingMinutes?: number; exceededMinutes: number;
  open: { id: string; startedAt: string } | null;
  sessions: LunchSession[];
}
export interface AttendanceDayData {
  date: string; serverTime: string; timeZone?: string; status?: AttendanceStatus; maxAccuracyM?: number;
  punchIn: PunchInfo | null; punchOut: PunchInfo | null; punchOutCount: number; workedMinutes: number | null;
  lunch: LunchInfo;
}
export interface HrPunchRow {
  profileId: string; name: string; department: string | null; date: string;
  punchIn: PunchInfo | null; punchOut: PunchInfo | null; punchOutHistory: { at: string; locationStatus: LocationStatus }[];
  missingPunchOut: boolean; workedMinutes: number | null; locationUnavailable: boolean; lunchMinutes: number; lunchExceededMinutes: number;
}
export interface CrmSession { startedAt: string | null; endedAt: string | null; device: string | null; method: string | null; logoutRecorded: boolean }
export interface RegisterRow {
  profileId: string; name: string; role: string; designation: string | null; departmentId: string | null; department: string | null; date: string;
  status: AttendanceStatus;
  crm: { systemLoginAt: string | null; firstLoginAt: string | null; lastLogoutAt: string | null; logoutMissing: boolean; sessions: CrmSession[] };
  punchIn: PunchInfo | null; punchOut: PunchInfo | null; punchOutHistory: PunchInfo[];
  workedMinutes: number | null; lunch: LunchInfo;
}
export interface AttendanceRegister {
  date: string; today: string; serverTime: string; timeZone: string; allowanceMinutes: number; maxAccuracyM: number; retentionDays: number;
  geofence: null | Record<string, unknown>; rows: RegisterRow[];
}
export interface LunchRow { profileId: string; name: string; department: string | null; date: string; firstStart: string; lastEnd: string | null; minutes: number; exceededMinutes: number; flagged: boolean }

export interface CapturedLocation { status: LocationStatus; latitude: number | null; longitude: number | null; accuracy: number | null }

/**
 * Asks the browser for the device's current position (only when the person presses Punch In / Punch Out; never reused, never cached:
 * maximumAge 0). High accuracy is requested and readings are watched for a few seconds, keeping the most precise one, so a phone has time
 * to get a GPS fix. Never invents a position and never falls back to an address-based one.
 */
export function captureLocation(opts: { timeoutMs?: number; goodEnoughM?: number; settleMs?: number } = {}): Promise<CapturedLocation> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  const goodEnough = opts.goodEnoughM ?? 50;
  const settleMs = opts.settleMs ?? 8000;
  return new Promise(resolve => {
    const none = (status: LocationStatus): CapturedLocation => ({ status, latitude: null, longitude: null, accuracy: null });
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(none('UNSUPPORTED'));
    let best: GeolocationPosition | null = null;
    let done = false;
    let watch: number | null = null;
    let settling = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = (r: CapturedLocation) => {
      if (done) return;
      done = true;
      if (watch !== null) navigator.geolocation.clearWatch(watch);
      timers.forEach(clearTimeout);
      resolve(r);
    };
    const fromBest = () => best
      ? { status: 'CAPTURED' as const, latitude: best.coords.latitude, longitude: best.coords.longitude, accuracy: Math.max(0, Math.round(best.coords.accuracy)) }
      : none('TIMEOUT');
    try {
      watch = navigator.geolocation.watchPosition(
        p => {
          if (!best || p.coords.accuracy < best.coords.accuracy) best = p;
          if (p.coords.accuracy <= goodEnough) finish(fromBest());
          // a first reading arrived: wait a little for a better one, then take the best
          else if (!settling) { settling = true; timers.push(setTimeout(() => finish(fromBest()), settleMs)); }
        },
        e => { if (best) finish(fromBest()); else finish(none(e.code === 1 ? 'DENIED' : e.code === 3 ? 'TIMEOUT' : 'UNAVAILABLE')); },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
      );
    } catch {
      return finish(none('UNAVAILABLE'));
    }
    timers.push(setTimeout(() => finish(fromBest()), timeoutMs + 1000));
  });
}

/** What to tell the person when no usable location was obtained (nothing is recorded in that case). */
export function locationHelp(status: LocationStatus, accuracy?: number | null, maxM?: number): string {
  switch (status) {
    case 'DENIED': return 'Location permission is blocked, so attendance was not marked. Click the lock icon next to the address bar, set Location to "Allow" for this site, then press the button again.';
    case 'UNAVAILABLE': return 'Your device could not find its location, so attendance was not marked. Turn on location services (Windows: Settings → Privacy & security → Location; Mac: System Settings → Privacy & Security → Location Services; phone: turn on Location / GPS), then try again.';
    case 'TIMEOUT': return 'Getting your location took too long, so attendance was not marked. Make sure location services are on (and Wi-Fi on a laptop), then try again.';
    case 'UNSUPPORTED': return 'This browser cannot share its location, so attendance cannot be marked here. Use an up-to-date Chrome, Edge, Safari or Firefox.';
    case 'CAPTURED': return `Your location is not precise enough (within ${accuracy ?? '?'} m; at most ${maxM ?? 1000} m is accepted), so attendance was not marked. Turn on precise location (GPS, or Wi-Fi on a laptop) and try again.`;
    default: return 'Your location is required to mark attendance.';
  }
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
  /** HR / Super Admin: every employee of one office day (each read is audited). */
  register: (date: string) => rpc<AttendanceRegister>('hr_attendance_register', { p_date: date, p_department: null, p_profile: null, p_status: null }),
  hrPunches: (from: string, to: string, departmentId?: string | null) =>
    rpc<{ allowanceMinutes: number; retentionDays: number; rows: HrPunchRow[] }>('hr_attendance_punches', { p_from: from, p_to: to, p_department: departmentId || null, p_profile: null }),
  /** Ask the server to look up the place names still missing (a few at a time); harmless to call often. */
  resolvePlaces: () => api.post<{ looked: number; named: number; failed: number }>('/attendance/resolve-places', {}),
  lunchOverview: (from: string, to: string) => rpc<{ allowanceMinutes: number; rows: LunchRow[] }>('attendance_lunch_overview', { p_from: from, p_to: to }),

  // --- reminders (20270109000200): times, devices, the push key and a test notification
  /** The public key a browser needs to subscribe; null while push is not set up on the server. */
  pushKey: async () => (await api.get<{ publicKey: string | null }>('/attendance/push-key')).publicKey,
  saveDevice: (endpoint: string, p256dh: string, auth: string, label: string) =>
    rpc<string>('push_subscription_save', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_label: label }),
  removeDevice: (endpoint: string) => rpc<null>('push_subscription_remove', { p_endpoint: endpoint }),
  removeDeviceById: (id: string) => rpc<null>('push_subscription_remove_by_id', { p_id: id }),
  devices: () => rpc<PushDevice[]>('my_push_devices'),
  testPush: () => api.post<{ sent: number; gone: number; failed: number }>('/attendance/push-test', {}),
  reminderSettings: () => rpc<ReminderSettings>('attendance_reminder_settings'),
  saveMyReminders: (enabled: boolean, punchIn: string | null, lunch: string | null, punchOut: string | null) =>
    rpc<ReminderSettings>('attendance_reminder_save_mine', { p_enabled: enabled, p_punch_in: punchIn, p_lunch: lunch, p_punch_out: punchOut }),
  saveCompanyReminders: (c: ReminderCompany) =>
    rpc<ReminderSettings>('hr_attendance_reminder_defaults_save', { p_enabled: c.enabled, p_punch_in: c.punchIn, p_lunch: c.lunch, p_punch_out: c.punchOut,
      p_follow_up: c.followUpMinutes, p_warning: c.lunchWarningMinutes, p_days: c.days }),
  pauseToday: (paused: boolean) => rpc<ReminderSettings>('hr_attendance_reminders_pause_today', { p_paused: paused })
};

export interface PushDevice { id: string; label: string | null; createdAt: string; lastSuccessAt: string | null; active: boolean }
/** Reminder times are "HH:MM" (India time). Days are ISO weekdays: 1 = Monday ... 7 = Sunday. */
export interface ReminderCompany { enabled: boolean; punchIn: string; lunch: string; punchOut: string; followUpMinutes: number; lunchWarningMinutes: number; days: number[] }
export interface ReminderTimes { enabled: boolean; punchIn: string | null; lunch: string | null; punchOut: string | null }
export interface ReminderSettings {
  company: ReminderCompany;
  /** null for the Super Admin, who does not punch */
  mine: ReminderTimes | null;
  effective: ReminderTimes | null;
  pausedToday: boolean;
  canManage: boolean;
}

const IST_TIME = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
const IST_LONG_DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' });
const IST_CLOCK = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
const IST_DATE = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
/** 12-hour India time, e.g. "9:05 am". */
export const istTime = (iso: string | null | undefined) => (iso ? IST_TIME.format(new Date(iso)) : '-');
export const istDate = (isoDate: string) => { const [y, m, d] = isoDate.split('-').map(Number); return IST_DATE.format(new Date(Date.UTC(y, m - 1, d, 6))); };
/** "10 November 2026" for an office day (yyyy-mm-dd). */
export const istLongDate = (isoDate: string) => { const [y, m, d] = isoDate.split('-').map(Number); return IST_LONG_DATE.format(new Date(Date.UTC(y, m - 1, d, 6))); };
/** "10:57 AM IST" for a moment. */
export const istClock = (iso: string | null | undefined) => (iso ? `${IST_CLOCK.format(new Date(iso))} IST` : '-');
/** "10 November 2026 – 10:57 AM IST" for a moment (always India time, whatever the device's time zone). */
export const istStamp = (iso: string | null | undefined) => (iso ? `${IST_LONG_DATE.format(new Date(iso))} – ${istClock(iso)}` : '-');
export const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;
export const coords = (p: PunchInfo | null | undefined) => {
  const lat = p?.latitude == null ? NaN : Number(p.latitude);
  const lng = p?.longitude == null ? NaN : Number(p.longitude);
  return p?.locationStatus === 'CAPTURED' && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};
export const minutesLabel = (m: number | null | undefined) => (m == null ? '-' : m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
export const locationLabel = (p: PunchInfo | null) =>
  !p ? '-' : p.locationStatus === 'CAPTURED' ? (p.place || 'Location recorded')
  : p.locationStatus === 'PURGED' ? 'Location erased after 90 days'
  : p.locationStatus === 'DENIED' ? 'Location unavailable (permission denied)'
  : p.locationStatus === 'TIMEOUT' ? 'Location unavailable (timed out)'
  : p.locationStatus === 'UNSUPPORTED' ? 'Location unavailable (not supported)' : 'Location unavailable';
export const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
export const shiftDate = (iso: string, days: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
