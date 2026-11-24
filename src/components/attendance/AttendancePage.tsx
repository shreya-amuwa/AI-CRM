import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Coffee, LogIn, LogOut, MapPin, Play } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { OPEN_ATTENDANCE_EVENT, takePendingAttendance, type AttendanceView } from './attendanceEvents';
import { TodayOverview } from './TodayOverview';
import { BottomSheet } from '../common/BottomSheet';
import { TeamAttendance } from './TeamAttendance';
import { AttendanceCorrections, CorrectionRequestForm } from './AttendanceCorrections';
import { isOperationsHead } from '../../lib/auth/roleMapping';
import {
  attendanceApi, captureLocation, coords, isLowPrecision, istClock, istDate, istLongDate, istStamp, istToday, locationHelp, locationLabel, mapsUrl, minutesLabel, shiftDate,
  STATUS_LABEL, STATUS_TONE, newPunchRequestId, type PunchOutPreview, type AttendanceDayData, type AttendanceRegister, type AttendanceStatus, type LunchRow, type PunchInfo, type RegisterRow
} from '../../lib/attendance';
const RemindersPanel = React.lazy(() => import('./RemindersPanel'));
const NotificationHealth = React.lazy(() => import('../notifications/NotificationHealth'));

const card = 'bg-white rounded-2xl border border-slate-200 p-5';
const btnBase = 'inline-flex items-center justify-center gap-2 px-4 h-11 rounded-xl text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed';
const field = 'h-10 px-3 rounded-xl border border-slate-200 text-sm bg-white';

/** The running lunch in whole minutes, from the server's start and the server's clock (corrected for the device clock). */
function useLunchMinutes(day: AttendanceDayData | null, offsetMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!day?.lunch.open) return;
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [day?.lunch.open]);
  return useMemo(() => {
    if (!day) return 0;
    if (!day.lunch.open) return day.lunch.minutes;
    const closed = day.lunch.sessions.filter(s => s.endedAt).reduce((a, s) => a + s.minutes, 0);
    const running = Math.floor((Date.now() + offsetMs - new Date(day.lunch.open.startedAt).getTime()) / 60000);
    return closed + Math.max(0, running);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, offsetMs, tick]);
}

/** A badge with the attendance state. */
export const StatusBadge: React.FC<{ status: AttendanceStatus; testId?: string }> = ({ status, testId }) => (
  <span data-testid={testId} className={`inline-flex items-center px-2.5 py-1 rounded-full border text-[11px] font-bold whitespace-nowrap ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
);

/** Where a punch was made: the device coordinates and their accuracy, a Google Maps link, and the looked-up nearest address when there is one. */
export const PunchLocation: React.FC<{ p: PunchInfo | null | undefined; testId?: string }> = ({ p, testId }) => {
  const c = coords(p);
  if (!p) return <span className="text-slate-400">-</span>;
  if (!c) return <span className="text-slate-500">{locationLabel(p)}</span>;
  return (
    <span className="inline-flex flex-col max-w-[17rem]" data-testid={testId}>
      <span className="inline-flex items-start gap-1 font-semibold text-slate-800"><MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
        <span data-testid="coords">{c.lat.toFixed(6)}, {c.lng.toFixed(6)}</span></span>
      <span className="text-[11px] text-slate-500">
        {p.accuracy != null ? <>within {p.accuracy} m{isLowPrecision(p.accuracy) ? <> · <span className="font-semibold text-amber-700" title="Less precise than 100 m: the device located itself from Wi-Fi or the network">low precision</span></> : null} · </> : null}
        <a className="text-blue-700 font-semibold hover:underline" href={mapsUrl(c.lat, c.lng)} target="_blank" rel="noreferrer">Google Maps</a>
      </span>
      {p.place ? <span className="text-[11px] text-slate-500" data-testid="place" title="Nearest address looked up from the coordinates (approximate)">Near: {p.place}</span> : null}
    </span>
  );
};

const mins = (m: number | null | undefined) => (m == null ? '-' : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`);
const IST_NOW = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
const clock12 = (hhmm: string | null) => {
  if (!hhmm) return '-';
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'} IST`;
};

/** "Start your workday?" / "End your workday?": nothing is recorded until Confirm, and success is shown only after the server's answer. */
const PunchConfirm: React.FC<{
  confirm: { kind: 'in' } | { kind: 'out'; preview: PunchOutPreview | null }; name: string | null; day: AttendanceDayData | null; offsetMs: number;
  busy: boolean; error: string | null; reason: string; onReason: (v: string) => void; onCancel: () => void; onConfirm: () => void;
}> = ({ confirm, name, day, offsetMs, busy, error, reason, onReason, onCancel, onConfirm }) => {
  const now = new Date(Date.now() + offsetMs);
  const out = confirm.kind === 'out';
  const p = out ? confirm.preview : null;
  const needReason = !!p?.reasonRequired;
  const row = 'flex items-baseline justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0';
  return (
    <BottomSheet
      alert
      testId={out ? 'punch-out-confirm' : 'punch-in-confirm'}
      title={out ? 'End your workday?' : 'Start your workday?'}
      subtitle={out ? 'Punching out will end your current working session. Please make sure you have completed your work for today.'
        : 'You are about to punch in. Your working hours will start once you confirm.'}
      onClose={onCancel}
      dismissible={!busy}
      maxPhoneHeight="max-h-[70vh]"
      size="sm"
      footer={<>
        <button type="button" className={`${btnBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`} onClick={onCancel} disabled={busy}>
          {out ? 'Continue Working' : 'Cancel'}
        </button>
        <button type="button" data-testid={out ? 'confirm-punch-out' : 'confirm-punch-in'} onClick={onConfirm}
          disabled={busy || (needReason && reason.trim().length < 3)}
          className={`${btnBase} text-white ${out ? 'bg-slate-900 hover:bg-slate-800' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
          {out ? <LogOut className="w-4 h-4" aria-hidden="true" /> : <LogIn className="w-4 h-4" aria-hidden="true" />}
          {busy ? 'Recording…' : out ? 'Confirm Punch Out' : 'Confirm Punch In'}
        </button>
      </>}
    >
      <dl className="text-sm">
        {!out && name ? <div className={row}><dt className="text-slate-500">Employee</dt><dd className="font-medium text-slate-900">{name}</dd></div> : null}
        {!out ? <div className={row}><dt className="text-slate-500">Date</dt><dd className="font-medium text-slate-900">{day ? istLongDate(day.date) : '-'}</dd></div> : null}
        {out ? <div className={row}><dt className="text-slate-500">Punch In</dt><dd className="font-medium text-slate-900">{istClock(p?.punchInAt ?? day?.punchIn?.at)}</dd></div> : null}
        <div className={row}><dt className="text-slate-500">Current time</dt><dd className="font-medium text-slate-900">{IST_NOW.format(now).toUpperCase()} IST</dd></div>
        {out ? <>
          <div className={row}><dt className="text-slate-500">Total working time</dt><dd className="font-medium text-slate-900">{mins(p?.workedMinutes ?? day?.workedMinutes)}</dd></div>
          <div className={row}><dt className="text-slate-500">Breaks</dt><dd className="font-medium text-slate-900">{mins(p?.breakMinutes ?? day?.lunch.minutes)}</dd></div>
          <div className={row}><dt className="text-slate-500">Net working time</dt><dd className="font-semibold text-slate-900">{p ? mins(p.netMinutes) : '-'}</dd></div>
          {p?.shiftEnd ? <div className={row}><dt className="text-slate-500">Scheduled shift end</dt><dd className="font-medium text-slate-900">{clock12(p.shiftEnd)}</dd></div> : null}
        </> : null}
      </dl>
      {out && p?.early ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900" role="note">
          <p className="font-semibold">You are punching out before your scheduled shift end time.</p>
          {needReason ? (
            <label className="mt-2 block text-xs font-semibold text-amber-900">Reason for leaving early (required)
              <textarea rows={2} maxLength={480} value={reason} onChange={e => onReason(e.target.value)} data-testid="early-reason"
                className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </label>
          ) : null}
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm font-medium text-rose-700" data-testid="punch-dialog-error">{error}</p> : null}
    </BottomSheet>
  );
};

/** The employee's own day: Punch In, Start Lunch / Resume Work, Punch Out. The location is asked only when a punch button is pressed. */
export const MyAttendance: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  // the name in the Punch In dialog when there is a signed-in account (the card is also mounted on its own)
  let profile: ReturnType<typeof useAuth>['profile'] | null = null;
  try { profile = useAuth().profile; } catch { profile = null; }
  const [day, setDay] = useState<AttendanceDayData | null>(null);
  // the confirmation before a punch (Task 02): one request id per dialog, so pressing Confirm twice or retrying is the same punch
  const [confirm, setConfirm] = useState<null | { kind: 'in'; request: string } | { kind: 'out'; request: string; preview: PunchOutPreview | null }>(null);
  const [reason, setReason] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [askCorrection, setAskCorrection] = useState(false);
  const [offsetMs, setOffsetMs] = useState(0);
  const [busy, setBusy] = useState<'' | 'in' | 'out' | 'lunch'>('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [history, setHistory] = useState<AttendanceDayData[] | null>(null);

  const accept = (d: AttendanceDayData) => { setDay(d); setOffsetMs(new Date(d.serverTime).getTime() - Date.now()); };
  const load = useCallback(() => {
    attendanceApi.today().then(accept, e => setNotice({ ok: false, text: e instanceof Error ? e.message : String(e) }));
    const today = istToday();
    attendanceApi.mine(shiftDate(today, -13), today).then(setHistory, () => setHistory([]));
  }, []);
  useEffect(load, [load]);
  const lunchMinutes = useLunchMinutes(day, offsetMs);

  const openPunch = (kind: 'in' | 'out') => {
    setReason('');
    setDialogError(null);
    const request = newPunchRequestId();
    if (kind === 'in') { setConfirm({ kind: 'in', request }); return; }
    setConfirm({ kind: 'out', request, preview: null });
    // the figures (worked, break, net, shift end) come from the server's clock; without them the dialog still confirms
    attendanceApi.punchOutPreview().then(p => setConfirm(c => (c && c.kind === 'out' && c.request === request ? { ...c, preview: p } : c)), () => { /* figures unavailable */ });
  };
  const punch = async (kind: 'in' | 'out', request: string, earlyReason: string | null) => {
    setBusy(kind);
    setNotice(null);
    setDialogError(null);
    try {
      // a fresh position for every punch (Punch Out never reuses the Punch In one); nothing is sent without one
      const max = day?.maxAccuracyM ?? 1000;
      const loc = await captureLocation({ maxM: max });
      if (loc.status !== 'CAPTURED') { setDialogError(locationHelp(loc.status)); return; }
      if (loc.accuracy != null && loc.accuracy > max) { setDialogError(locationHelp('CAPTURED', loc.accuracy, max)); return; }
      const d = kind === 'in' ? await attendanceApi.punchIn(loc, request) : await attendanceApi.punchOutConfirmed(loc, earlyReason, request);
      accept(d);
      // only now, with the server's answer: success
      setConfirm(null);
      const at = kind === 'in' ? d.punchIn?.at : d.punchOut?.at;
      setNotice({ ok: true, text: `${kind === 'in' ? 'Punched in' : 'Punched out'} at ${istClock(at)} (location within ${loc.accuracy} m${isLowPrecision(loc.accuracy) ? ' · low precision' : ''}).` });
      // the punch's answer is already today's day; the place-name lookup refreshes the rest afterwards
      attendanceApi.resolvePlaces().then(load, () => { /* the nearest address comes later */ });
    } catch (e) {
      // the dialog stays open with the reason; pressing Confirm again sends the same request (never a second punch)
      setDialogError(e instanceof Error ? e.message : 'Could not record the punch. Check your connection and try again.');
    } finally {
      setBusy('');
    }
  };
  const lunch = async (action: 'START' | 'END') => {
    setBusy('lunch');
    setNotice(null);
    try { accept(await attendanceApi.lunch(action)); } catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : 'Could not update lunch.' }); } finally { setBusy(''); }
  };

  const allowance = day?.lunch.allowanceMinutes ?? 45;
  const over = Math.max(0, lunchMinutes - allowance);
  const remaining = Math.max(0, allowance - lunchMinutes);
  const status: AttendanceStatus = day?.status ?? (!day?.punchIn ? 'NOT_PUNCHED_IN' : day.punchOut ? 'PUNCHED_OUT' : day.lunch.open ? 'ON_LUNCH' : 'PUNCHED_IN');
  // which actions the state allows (the database checks every one again)
  const canIn = !!day && status === 'NOT_PUNCHED_IN';
  const canLunch = status === 'PUNCHED_IN' || status === 'RESUMED_WORK';
  const onLunch = status === 'ON_LUNCH';
  const canOut = status === 'PUNCHED_IN' || status === 'RESUMED_WORK' || status === 'INCOMPLETE';
  const box = 'rounded-xl bg-slate-50 px-3 py-2';
  const label = 'text-[11px] font-bold uppercase text-slate-500';

  return (
    <div className="space-y-4" data-testid="my-attendance">
      <section className={card} aria-label="Today">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-extrabold text-slate-900">{compact ? 'My attendance today' : 'Today'}{day ? ` – ${istLongDate(day.date)}` : ''}</h2>
          {day ? <StatusBadge status={status} testId="attendance-status" /> : null}
        </div>
        {notice && <p role={notice.ok ? 'status' : 'alert'} data-testid="attendance-notice" className={`mt-3 p-3 rounded-xl text-sm font-semibold ${notice.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>{notice.text}</p>}
        <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className={box}><dt className={label}>Punch In</dt><dd className="text-lg font-extrabold text-slate-900" data-testid="punch-in-time">{istClock(day?.punchIn?.at)}</dd>
            <dd className="text-xs mt-0.5"><PunchLocation p={day?.punchIn} testId="punch-in-location" /></dd></div>
          <div className={box}><dt className={label}>Punch Out</dt><dd className="text-lg font-extrabold text-slate-900" data-testid="punch-out-time">{istClock(day?.punchOut?.at)}</dd>
            <dd className="text-xs mt-0.5"><PunchLocation p={day?.punchOut} testId="punch-out-location" /></dd></div>
          <div className={box}><dt className={label}>Working time</dt><dd className="text-lg font-extrabold text-slate-900" data-testid="worked">{minutesLabel(day?.workedMinutes)}</dd>
            <dd className="text-[11px] text-slate-500">{status === 'PUNCHED_OUT' ? 'Punch In to Punch Out' : day?.punchIn ? 'so far (lunch shown separately)' : ''}</dd></div>
          <div className={`${box} ${over ? '!bg-rose-50' : ''}`}><dt className={label}>Lunch taken ({allowance} min allowed)</dt>
            <dd className={`text-lg font-extrabold ${over ? 'text-rose-700' : 'text-slate-900'}`} data-testid="lunch-minutes">{minutesLabel(lunchMinutes)}{onLunch ? ' (on lunch)' : ''}</dd></div>
          <div className={box}><dt className={label}>Lunch remaining</dt><dd className="text-lg font-extrabold text-slate-900" data-testid="lunch-remaining">{remaining} min</dd></div>
          <div className={`${box} ${over ? '!bg-rose-50' : ''}`}><dt className={label}>Extra lunch</dt><dd className={`text-lg font-extrabold ${over ? 'text-rose-700' : 'text-slate-900'}`} data-testid="lunch-extra">{over ? `${over} min` : '-'}</dd></div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" data-testid="punch-in" className={`${btnBase} bg-emerald-600 text-white hover:bg-emerald-700`} disabled={!canIn || !!busy} onClick={() => openPunch('in')}>
            <LogIn className="w-4 h-4" aria-hidden="true" /> {busy === 'in' ? 'Getting your location…' : day?.punchIn ? 'Punched in' : 'Punch In'}
          </button>
          {onLunch ? (
            <button type="button" data-testid="lunch-end" className={`${btnBase} bg-amber-500 text-white hover:bg-amber-600`} disabled={!!busy} onClick={() => void lunch('END')}><Play className="w-4 h-4" aria-hidden="true" /> Resume Work</button>
          ) : (
            <button type="button" data-testid="lunch-start" className={`${btnBase} border border-amber-300 text-amber-800 bg-white hover:bg-amber-50`} disabled={!canLunch || !!busy} onClick={() => void lunch('START')}><Coffee className="w-4 h-4" aria-hidden="true" /> Start Lunch</button>
          )}
          <button type="button" data-testid="punch-out" className={`${btnBase} bg-slate-900 text-white hover:bg-slate-800`} disabled={!canOut || !!busy} onClick={() => openPunch('out')}>
            <LogOut className="w-4 h-4" aria-hidden="true" /> {busy === 'out' ? 'Getting your location…' : status === 'PUNCHED_OUT' ? 'Punched out' : 'Punch Out'}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Signing in or out of the CRM does not mark attendance. Punch In and Punch Out record your current location; times are the server's, in India Standard Time.</p>
        {status === 'PUNCHED_OUT' && !compact ? (
          <p className="mt-2 text-xs text-slate-600">Punched out by mistake?{' '}
            <button type="button" className="font-semibold text-blue-700 hover:underline" onClick={() => setAskCorrection(true)} data-testid="ask-resume">Ask to resume your day</button></p>
        ) : null}
      </section>
      {askCorrection && day ? <CorrectionRequestForm date={day.date} kind="RESUME_DAY" onClose={() => setAskCorrection(false)} onSent={() => { setAskCorrection(false); setNotice({ ok: true, text: 'Correction requested. You are told when it is decided.' }); }} /> : null}
      {confirm ? (
        <PunchConfirm confirm={confirm} name={profile?.fullName ?? null} day={day} offsetMs={offsetMs} busy={busy === confirm.kind} error={dialogError}
          reason={reason} onReason={setReason} onCancel={() => { if (!busy) setConfirm(null); }}
          onConfirm={() => void punch(confirm.kind, confirm.request, confirm.kind === 'out' && reason.trim() ? reason.trim() : null)} />
      ) : null}
      {compact ? null : <section className={card} aria-label="Last two weeks">
        <h3 className="text-sm font-extrabold text-slate-900 mb-2">Last two weeks</h3>
        {history === null ? <p className="text-xs text-slate-500">Loading…</p> : history.length === 0 ? <p className="text-xs text-slate-500">No attendance recorded yet.</p> : (
          <div className="overflow-x-auto"><table className="min-w-full text-xs">
            <thead className="text-slate-500"><tr>{['Day', 'Status', 'Punch In', 'Punch Out', 'Worked', 'Lunch'].map(h => <th key={h} scope="col" className="px-2 py-1.5 text-left font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{history.map(h => (
              <tr key={h.date}><th scope="row" className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{istDate(h.date)}</th>
                <td className="px-2 py-1.5">{h.status ? <StatusBadge status={h.status} /> : '-'}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{istClock(h.punchIn?.at)}</td><td className="px-2 py-1.5 whitespace-nowrap">{istClock(h.punchOut?.at)}</td>
                <td className="px-2 py-1.5">{minutesLabel(h.workedMinutes)}</td><td className={`px-2 py-1.5 ${h.lunch.exceededMinutes ? 'text-rose-700 font-semibold' : ''}`}>{minutesLabel(h.lunch.minutes)}{h.lunch.exceededMinutes ? ` (+${h.lunch.exceededMinutes})` : ''}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>}
    </div>
  );
};

const RangePicker: React.FC<{ from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }> = ({ from, to, onFrom, onTo }) => (
  <>
    <label className="text-xs font-semibold text-slate-600 flex flex-col gap-1">From<input type="date" className={field} value={from} max={to} onChange={e => onFrom(e.target.value)} /></label>
    <label className="text-xs font-semibold text-slate-600 flex flex-col gap-1">To<input type="date" className={field} value={to} min={from} onChange={e => onTo(e.target.value)} /></label>
  </>
);

/** Lunch durations and flags (HR / Super Admin: everyone; Operations Head: their departments and functions). No punch times, no locations. */
export const LunchOverview: React.FC = () => {
  const [to, setTo] = useState(istToday());
  const [from, setFrom] = useState(shiftDate(istToday(), -6));
  const [data, setData] = useState<{ allowanceMinutes: number; rows: LunchRow[] } | null>(null);
  const [error, setError] = useState('');
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  useEffect(() => { setData(null); attendanceApi.lunchOverview(from, to).then(d => { setError(''); setData(d); }, e => setError(e instanceof Error ? e.message : String(e))); }, [from, to]);
  const rows = (data?.rows ?? []).filter(r => !onlyFlagged || r.flagged);
  return (
    <section className={card} aria-label="Lunch overview" data-testid="lunch-overview">
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <h2 className="text-base font-extrabold text-slate-900 mr-auto">Lunch breaks{data ? ` (${data.allowanceMinutes} min allowed)` : ''}</h2>
        <RangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <label className="text-xs font-semibold text-slate-600 inline-flex items-center gap-1.5 h-10"><input type="checkbox" checked={onlyFlagged} onChange={e => setOnlyFlagged(e.target.checked)} /> Exceeded only</label>
      </div>
      {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : !data ? <p className="text-xs text-slate-500">Loading…</p> : rows.length === 0 ? <p className="text-xs text-slate-500">No lunch breaks in this period.</p> : (
        <div className="overflow-x-auto"><table className="min-w-full text-xs">
          <thead className="text-slate-500"><tr>{['Employee', 'Department', 'Day', 'Lunch start', 'Lunch end', 'Total', 'Excess', 'Flag'].map(h => <th key={h} scope="col" className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map(r => (
            <tr key={`${r.profileId}:${r.date}`}><th scope="row" className="px-2 py-1.5 text-left font-semibold">{r.name}</th><td className="px-2 py-1.5">{r.department ?? '-'}</td><td className="px-2 py-1.5">{istDate(r.date)}</td>
              <td className="px-2 py-1.5">{istClock(r.firstStart)}</td><td className="px-2 py-1.5">{istClock(r.lastEnd)}</td><td className="px-2 py-1.5">{minutesLabel(r.minutes)}</td>
              <td className="px-2 py-1.5">{r.exceededMinutes ? `${r.exceededMinutes} min` : '-'}</td><td className={`px-2 py-1.5 font-bold ${r.flagged ? 'text-rose-700' : 'text-emerald-700'}`}>{r.flagged ? 'Exceeded' : 'Within'}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
};

/** A small map of a punch (OpenStreetMap), shown only when HR opens a row. */
const PunchMap: React.FC<{ p: PunchInfo | null; title: string }> = ({ p, title }) => {
  const c = coords(p);
  if (!c) return null;
  const d = 0.004;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${c.lng - d},${c.lat - d},${c.lng + d},${c.lat + d}&layer=mapnik&marker=${c.lat},${c.lng}`;
  return <iframe title={title} src={src} loading="lazy" referrerPolicy="no-referrer" className="w-full h-44 rounded-xl border border-slate-200 bg-slate-50" />;
};

const PunchDetail: React.FC<{ title: string; p: PunchInfo | null }> = ({ title, p }) => {
  const c = coords(p);
  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-1.5 min-w-0">
      <h4 className="text-xs font-extrabold text-slate-900">{title}</h4>
      {!p ? <p className="text-xs text-rose-700 font-semibold">Not recorded</p> : (
        <>
          <p className="text-xs text-slate-800 font-semibold">{istStamp(p.at)}</p>
          {c ? (
            <dl className="text-[11px] text-slate-600 grid grid-cols-[auto_1fr] gap-x-2">
              <dt>Latitude</dt><dd className="font-mono">{c.lat.toFixed(6)}</dd>
              <dt>Longitude</dt><dd className="font-mono">{c.lng.toFixed(6)}</dd>
              <dt>Accuracy</dt><dd>{p.accuracy != null ? `${p.accuracy} m${isLowPrecision(p.accuracy) ? ' · low precision' : ''}` : '-'}</dd>
              {p.place ? <><dt>Near</dt><dd title="Nearest address looked up from the coordinates (approximate)">{p.place}</dd></> : null}
            </dl>
          ) : <p className="text-[11px] text-slate-500">{locationLabel(p)}</p>}
          {c ? <a className="text-[11px] text-blue-700 font-semibold hover:underline" href={mapsUrl(c.lat, c.lng)} target="_blank" rel="noreferrer">Open in Google Maps</a> : null}
          <PunchMap p={p} title={`${title} on the map`} />
        </>
      )}
    </div>
  );
};

const STATUSES: AttendanceStatus[] = ['NOT_PUNCHED_IN', 'PUNCHED_IN', 'ON_LUNCH', 'RESUMED_WORK', 'PUNCHED_OUT', 'INCOMPLETE'];

/** HR / Super Admin: every employee's attendance for one office day (India time). Each load is written to the audit log. */
export const HrAttendanceRegister: React.FC<{ defaultDepartment?: { id: string; name: string } }> = ({ defaultDepartment }) => {
  const [date, setDate] = useState(istToday());
  const [data, setData] = useState<AttendanceRegister | null>(null);
  const [error, setError] = useState('');
  // a workspace of one department (AI Studio) opens the register already narrowed to it
  const [dept, setDept] = useState(defaultDepartment?.id ?? '');
  const [emp, setEmp] = useState('');
  const [status, setStatus] = useState<'' | AttendanceStatus>('');
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    setOpen(null);
    const load = () => attendanceApi.register(date);
    load().then(d => {
      if (!alive) return;
      setError(''); setData(d);
      // punches with coordinates but no nearest address yet: ask the server to look them up, then reload once
      const missing = d.rows.some(r => [r.punchIn, r.punchOut].some(p => p?.locationStatus === 'CAPTURED' && !p.place));
      if (missing) attendanceApi.resolvePlaces().then(() => load()).then(d2 => { if (alive) setData(d2); }, () => { /* the addresses come with the next load */ });
    }, e => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [date]);
  const departments = useMemo(() => [...new Map([...(defaultDepartment ? [[defaultDepartment.id, defaultDepartment.name] as [string, string]] : []), ...(data?.rows ?? []).filter(r => r.departmentId).map(r => [r.departmentId!, r.department ?? '-'] as [string, string])]).entries()].sort((a, b) => a[1].localeCompare(b[1])), [data, defaultDepartment]);
  const employees = useMemo(() => (data?.rows ?? []).filter(r => !dept || r.departmentId === dept).map(r => ({ id: r.profileId, name: r.name })), [data, dept]);
  const counts = useMemo(() => Object.fromEntries(STATUSES.map(s => [s, (data?.rows ?? []).filter(r => r.status === s).length])) as Record<AttendanceStatus, number>, [data]);
  const rows = (data?.rows ?? []).filter(r => (!dept || r.departmentId === dept) && (!emp || r.profileId === emp) && (!status || r.status === status));
  const isToday = data ? data.date === data.today : date === istToday();
  const crmCell = (r: RegisterRow) => (
    <span className="inline-flex flex-col">
      <span className="font-semibold text-slate-800" data-testid="crm-login">{r.crm.firstLoginAt ? istClock(r.crm.firstLoginAt) : <span className="text-slate-400">No login</span>}</span>
      {r.crm.lastLogoutAt ? <span className="text-[11px] text-slate-500" data-testid="crm-logout">Logout {istClock(r.crm.lastLogoutAt)}</span>
        : r.crm.logoutMissing ? <span className="text-[11px] text-amber-700">{isToday ? 'No logout yet' : 'Logout not recorded'}</span> : null}
    </span>
  );
  const head = ['Employee', 'Department', 'CRM Login', 'Punch In', 'Punch In Location', 'Lunch Duration', 'Punch Out', 'Punch Out Location', 'Worked', 'Status'];
  return (
    <section className={card} aria-label="Attendance register" data-testid="hr-register">
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-base font-extrabold text-slate-900">Attendance register – {istLongDate(date)}</h2>
          <p className="text-[11px] text-slate-500">All employees · India Standard Time (Asia/Kolkata) · lunch allowance {data?.allowanceMinutes ?? 45} min · locations kept {data?.retentionDays ?? 90} days. Opening this register is recorded in the audit log.</p>
        </div>
        <label className="text-xs font-semibold text-slate-600 flex flex-col gap-1">Date<input type="date" data-testid="register-date" className={field} value={date} max={istToday()} onChange={e => e.target.value && setDate(e.target.value)} /></label>
        <label className="text-xs font-semibold text-slate-600 flex flex-col gap-1">Department<select className={field} value={dept} onChange={e => { setDept(e.target.value); setEmp(''); }}><option value="">All</option>{departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600 flex flex-col gap-1">Employee<select className={`${field} max-w-[12rem]`} value={emp} onChange={e => setEmp(e.target.value)}><option value="">All</option>{employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600 flex flex-col gap-1">Status<select data-testid="register-status" className={field} value={status} onChange={e => setStatus(e.target.value as typeof status)}><option value="">All</option>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
      </div>
      {data ? (
        <div className="flex flex-wrap gap-1.5 mb-3" aria-label="Summary">
          {STATUSES.map(s => <button key={s} type="button" onClick={() => setStatus(status === s ? '' : s)} aria-pressed={status === s}
            className={`px-2.5 py-1 rounded-full border text-[11px] font-bold ${STATUS_TONE[s]} ${status === s ? 'ring-2 ring-blue-300' : ''}`}>{STATUS_LABEL[s]}: {counts[s]}</button>)}
        </div>
      ) : null}
      {data && !data.geofence ? <p className="mb-3 text-[11px] text-slate-500">No office location or radius is configured, so punches are recorded with the device location but are not limited to a workplace.</p> : null}
      {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : !data ? <p className="text-xs text-slate-500">Loading…</p> : rows.length === 0 ? <p className="text-xs text-slate-500">No employees match these filters.</p> : (
        <div className="overflow-x-auto"><table className="min-w-full text-xs">
          <thead className="text-slate-500"><tr>{head.map(h => <th key={h} scope="col" className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map(r => {
            const expanded = open === r.profileId;
            return (
              <React.Fragment key={r.profileId}>
                <tr className="align-top" data-testid="register-row">
                  <th scope="row" className="px-2 py-1.5 text-left font-semibold">
                    <button type="button" className="inline-flex items-start gap-1 text-left hover:text-blue-700" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : r.profileId)}>
                      {expanded ? <ChevronDown className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />}
                      <span>{r.name}{r.designation ? <span className="block text-[11px] font-normal text-slate-500">{r.designation}</span> : null}</span>
                    </button>
                  </th>
                  <td className="px-2 py-1.5">{r.department ?? '-'}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{crmCell(r)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap" data-testid="register-in">{istClock(r.punchIn?.at)}</td>
                  <td className="px-2 py-1.5"><PunchLocation p={r.punchIn} testId="hr-location" /></td>
                  <td className={`px-2 py-1.5 whitespace-nowrap ${r.lunch.exceededMinutes ? 'text-rose-700 font-semibold' : ''}`} data-testid="register-lunch">
                    {r.lunch.sessions.length ? minutesLabel(r.lunch.minutes) : '-'}{r.lunch.exceededMinutes ? <span className="block text-[11px]">+{r.lunch.exceededMinutes} min over</span> : null}{r.lunch.open ? <span className="block text-[11px] text-amber-700">on lunch now</span> : null}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap" data-testid="register-out">{r.punchOut ? istClock(r.punchOut.at) : r.punchIn ? <span className="text-rose-700 font-semibold">Missing</span> : '-'}</td>
                  <td className="px-2 py-1.5"><PunchLocation p={r.punchOut} testId="hr-out-location" /></td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{minutesLabel(r.workedMinutes)}{r.workedMinutes != null && !r.punchOut ? <span className="block text-[11px] text-slate-500">so far</span> : null}</td>
                  <td className="px-2 py-1.5"><StatusBadge status={r.status} testId="register-status-badge" /></td>
                </tr>
                {expanded ? (
                  <tr data-testid="register-detail"><td colSpan={head.length} className="px-2 pb-4 bg-slate-50/60">
                    <div className="grid gap-3 lg:grid-cols-2 pt-2">
                      <PunchDetail title="Punch In" p={r.punchIn} />
                      <PunchDetail title="Punch Out" p={r.punchOut} />
                      <div className="rounded-xl border border-slate-200 p-3 min-w-0">
                        <h4 className="text-xs font-extrabold text-slate-900 mb-1">CRM sign-in / sign-out (separate from attendance)</h4>
                        <p className="text-[11px] text-slate-600">First CRM opening: {istStamp(r.crm.systemLoginAt)} · First login: {istClock(r.crm.firstLoginAt)} · Last logout: {r.crm.lastLogoutAt ? istClock(r.crm.lastLogoutAt) : 'not recorded'}</p>
                        {r.crm.sessions.length === 0 ? <p className="text-[11px] text-slate-500 mt-1">No sign-in session recorded on this day.</p> : (
                          <ul className="mt-1 space-y-0.5 text-[11px] text-slate-700">{r.crm.sessions.map((s, i) => (
                            <li key={i}>{s.startedAt ? istClock(s.startedAt) : 'earlier'} → {s.endedAt ? istClock(s.endedAt) : <span className="text-amber-700 font-semibold">{isToday ? 'still signed in / logout not recorded' : 'logout not recorded'}</span>}{s.device ? ` · ${s.device}` : ''}</li>
                          ))}</ul>
                        )}
                      </div>
                      <div className="rounded-xl border border-slate-200 p-3 min-w-0">
                        <h4 className="text-xs font-extrabold text-slate-900 mb-1">Lunch ({r.lunch.allowanceMinutes} min allowed)</h4>
                        {r.lunch.sessions.length === 0 ? <p className="text-[11px] text-slate-500">No lunch break.</p> : (
                          <ul className="space-y-0.5 text-[11px] text-slate-700">{r.lunch.sessions.map((l, i) => <li key={i}>{istClock(l.startedAt)} → {l.endedAt ? istClock(l.endedAt) : 'running'} · {l.minutes} min{l.endedBy === 'PUNCH_OUT' ? ' (ended by Punch Out)' : ''}</li>)}</ul>
                        )}
                        <p className="mt-1 text-[11px] font-semibold text-slate-800">Total {r.lunch.minutes} min · remaining {Math.max(0, r.lunch.allowanceMinutes - r.lunch.minutes)} min · extra {r.lunch.exceededMinutes} min</p>
                        {r.punchOutHistory.length > 1 ? <p className="mt-1 text-[11px] text-slate-500">Earlier Punch Outs: {r.punchOutHistory.slice(0, -1).map(h => istClock(h.at)).join(', ')}</p> : null}
                      </div>
                    </div>
                  </td></tr>
                ) : null}
              </React.Fragment>
            );
          })}</tbody>
        </table></div>
      )}
    </section>
  );
};

/** The Attendance section of the side panel: what each person sees follows their role (the database checks again). */
export const AttendancePage: React.FC<{ hrView?: boolean; defaultDepartment?: { id: string; name: string } }> = ({ hrView = false, defaultDepartment }) => {
  const { profile } = useAuth();
  const isSa = profile?.role === 'SUPER_ADMIN';
  // HR staff (not the recruiters) and the Super Admin; the database checks it again
  // hrView: opened from HR's own panel (only HR staff reach it), so the HR tabs do not depend on the profile's department being loaded
  const isHr = hrView || (!!profile && (isSa || (profile.department?.slug === 'hr' && profile.hrSubRole !== 'HR_RECRUITER')));
  const isOh = !!profile && isOperationsHead(profile);
  const isManager = isHr || isSa || profile?.role === 'DEPARTMENT_HEAD' || profile?.role === 'TEAM_HEAD';
  const tabs = [
    // HR and the Super Admin: Present / Absent / On leave / Not yet marked / Late today (20270131000100); the 11:00 alert opens it
    ...(isHr ? [{ id: 'today', label: "Today's overview" }] : []),
    ...(isHr ? [{ id: 'register', label: 'Attendance register (all staff)' }] : []),
    ...(isSa ? [] : [{ id: 'mine', label: 'My attendance' }]),
    // managers and HR: one status per person they may see (20270205000200; the database decides who)
    ...(isManager ? [{ id: 'team', label: 'Team attendance' }] : []),
    { id: 'corrections', label: 'Corrections' },
    ...(isHr || isOh ? [{ id: 'lunch', label: 'Lunch breaks' }] : []),
    // everyone: their own reminder times and devices; HR and the Super Admin also the company defaults
    { id: 'reminders', label: 'Reminders' },
    // HR and the Super Admin: who can receive the reminders (the database checks again)
    ...(isHr ? [{ id: 'health', label: 'Notification health' }] : [])
  ];
  // opened from a reminder (the bell or a notification): the person's own day; from the Super Admin's 11:00 alert: Today's overview
  const viewTab = (v: AttendanceView | null) => (v && tabs.some(t => t.id === v) ? v : null);
  const [tab, setTab] = useState(() => viewTab(takePendingAttendance()) ?? tabs[0]?.id ?? 'mine');
  // a notification tapped while Attendance is already open switches to its view
  useEffect(() => {
    const on = (e: Event) => { const v = viewTab(((e as CustomEvent).detail?.view ?? null) as AttendanceView | null); takePendingAttendance(); if (v) setTab(v); };
    window.addEventListener(OPEN_ATTENDANCE_EVENT, on);
    return () => window.removeEventListener(OPEN_ATTENDANCE_EVENT, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHr, isSa]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900">Attendance</h1>
        <p className="mt-1 text-sm text-slate-600">Punch in when you start and punch out when you finish; each punch records your current location. Times are the server's, in India Standard Time.</p>
      </div>
      {tabs.length > 1 ? (
        <div role="tablist" aria-label="Attendance views" className="flex flex-wrap gap-2">
          {tabs.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => setTab(t.id)}
            className={`px-3.5 h-9 rounded-xl text-sm font-bold border ${tab === t.id ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-600'}`}>{t.label}</button>)}
        </div>
      ) : null}
      {tab === 'today' ? <TodayOverview /> : tab === 'team' ? <TeamAttendance /> : tab === 'corrections' ? <AttendanceCorrections canDecide={isManager} /> : tab === 'mine' ? <MyAttendance /> : tab === 'lunch' ? <LunchOverview /> : tab === 'health'
        ? <React.Suspense fallback={<p role="status" className="text-sm text-slate-500">Loading…</p>}><NotificationHealth /></React.Suspense>
        : tab === 'reminders'
        ? <React.Suspense fallback={<p role="status" className="text-sm text-slate-500">Loading reminders…</p>}><RemindersPanel /></React.Suspense>
        : <HrAttendanceRegister defaultDepartment={defaultDepartment} />}
    </div>
  );
};

export default AttendancePage;
