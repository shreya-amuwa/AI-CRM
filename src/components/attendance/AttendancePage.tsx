import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Coffee, LogIn, LogOut, MapPin } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { isOperationsHead } from '../../lib/auth/roleMapping';
import {
  attendanceApi, captureLocation, istDate, istTime, istToday, locationLabel, minutesLabel, shiftDate,
  type AttendanceDayData, type HrPunchRow, type LunchRow
} from '../../lib/attendance';

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

/** The employee's own day: Punch In, Start / End Lunch, Punch Out. Location is asked only when a punch button is pressed. */
export const MyAttendance: React.FC = () => {
  const [day, setDay] = useState<AttendanceDayData | null>(null);
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

  const punch = async (kind: 'in' | 'out') => {
    setBusy(kind);
    setNotice(null);
    try {
      const loc = await captureLocation();
      const d = kind === 'in' ? await attendanceApi.punchIn(loc) : await attendanceApi.punchOut(loc);
      accept(d);
      const when = istTime(kind === 'in' ? d.punchIn?.at : d.punchOut?.at);
      setNotice({ ok: true, text: `${kind === 'in' ? 'Punched in' : 'Punched out'} at ${when}.${loc.status === 'CAPTURED' ? '' : ' Your location was not available, so it is recorded as "location unavailable".'}` });
      load();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : 'Could not record the punch.' });
    } finally {
      setBusy('');
    }
  };
  const lunch = async (action: 'START' | 'END') => {
    setBusy('lunch');
    setNotice(null);
    try { accept(await attendanceApi.lunch(action)); } catch (e) { setNotice({ ok: false, text: e instanceof Error ? e.message : 'Could not update lunch.' }); } finally { setBusy(''); }
  };

  const allowance = day?.lunch.allowanceMinutes ?? 50;
  const over = Math.max(0, lunchMinutes - allowance);
  const punchedIn = !!day?.punchIn;
  const punchedOut = !!day?.punchOut;

  return (
    <div className="space-y-4" data-testid="my-attendance">
      <section className={card} aria-label="Today">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">Today{day ? ` - ${istDate(day.date)}` : ''}</h2>
          </div>
        </div>
        {notice && <p role={notice.ok ? 'status' : 'alert'} className={`mt-3 p-3 rounded-xl text-sm font-semibold ${notice.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'}`}>{notice.text}</p>}
        <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl bg-slate-50 px-3 py-2"><dt className="text-[11px] font-bold uppercase text-slate-500">Punch In</dt><dd className="text-lg font-extrabold text-slate-900" data-testid="punch-in-time">{istTime(day?.punchIn?.at)}</dd><dd className="text-[11px] text-slate-500">{locationLabel(day?.punchIn ?? null)}</dd></div>
          <div className="rounded-xl bg-slate-50 px-3 py-2"><dt className="text-[11px] font-bold uppercase text-slate-500">Punch Out</dt><dd className="text-lg font-extrabold text-slate-900" data-testid="punch-out-time">{istTime(day?.punchOut?.at)}</dd><dd className="text-[11px] text-slate-500">{locationLabel(day?.punchOut ?? null)}{(day?.punchOutCount ?? 0) > 1 ? ` · latest of ${day?.punchOutCount}` : ''}</dd></div>
          <div className="rounded-xl bg-slate-50 px-3 py-2"><dt className="text-[11px] font-bold uppercase text-slate-500">Worked</dt><dd className="text-lg font-extrabold text-slate-900">{minutesLabel(day?.workedMinutes)}</dd></div>
          <div className={`rounded-xl px-3 py-2 ${over ? 'bg-rose-50' : 'bg-slate-50'}`}><dt className="text-[11px] font-bold uppercase text-slate-500">Lunch ({allowance} min allowed)</dt>
            <dd className={`text-lg font-extrabold ${over ? 'text-rose-700' : 'text-slate-900'}`} data-testid="lunch-minutes">{minutesLabel(lunchMinutes)}{day?.lunch.open ? ' (on lunch)' : ''}</dd>
            <dd className={`text-[11px] ${over ? 'text-rose-700 font-bold' : 'text-slate-500'}`}>{over ? `Exceeded by ${over} min` : `${Math.max(0, allowance - lunchMinutes)} min left`}</dd></div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" data-testid="punch-in" className={`${btnBase} bg-emerald-600 text-white hover:bg-emerald-700`} disabled={!day || punchedIn || !!busy} onClick={() => void punch('in')}>
            <LogIn className="w-4 h-4" aria-hidden="true" /> {busy === 'in' ? 'Getting location…' : punchedIn ? 'Punched in' : 'Punch In'}
          </button>
          {day?.lunch.open ? (
            <button type="button" data-testid="lunch-end" className={`${btnBase} bg-amber-500 text-white hover:bg-amber-600`} disabled={!!busy} onClick={() => void lunch('END')}><Coffee className="w-4 h-4" aria-hidden="true" /> End Lunch</button>
          ) : (
            <button type="button" data-testid="lunch-start" className={`${btnBase} border border-amber-300 text-amber-800 bg-white hover:bg-amber-50`} disabled={!punchedIn || punchedOut || !!busy} onClick={() => void lunch('START')}><Coffee className="w-4 h-4" aria-hidden="true" /> Start Lunch</button>
          )}
          <button type="button" data-testid="punch-out" className={`${btnBase} bg-slate-900 text-white hover:bg-slate-800`} disabled={!punchedIn || !!busy} onClick={() => void punch('out')}>
            <LogOut className="w-4 h-4" aria-hidden="true" /> {busy === 'out' ? 'Getting location…' : punchedOut ? 'Punch Out again' : 'Punch Out'}
          </button>
        </div>
        {punchedOut ? <p className="mt-2 text-[11px] text-slate-500">Punching out again later replaces your Punch Out time with the later one; every punch stays in the record.</p> : null}
      </section>
      <section className={card} aria-label="Last two weeks">
        <h3 className="text-sm font-extrabold text-slate-900 mb-2">Last two weeks</h3>
        {history === null ? <p className="text-xs text-slate-500">Loading…</p> : history.length === 0 ? <p className="text-xs text-slate-500">No attendance recorded yet.</p> : (
          <div className="overflow-x-auto"><table className="min-w-full text-xs">
            <thead className="text-slate-500"><tr>{['Day', 'Punch In', 'Punch Out', 'Worked', 'Lunch'].map(h => <th key={h} scope="col" className="px-2 py-1.5 text-left font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{history.map(h => (
              <tr key={h.date}><th scope="row" className="px-2 py-1.5 text-left font-semibold">{istDate(h.date)}</th><td className="px-2 py-1.5">{istTime(h.punchIn?.at)}</td><td className="px-2 py-1.5">{istTime(h.punchOut?.at)}</td>
                <td className="px-2 py-1.5">{minutesLabel(h.workedMinutes)}</td><td className={`px-2 py-1.5 ${h.lunch.exceededMinutes ? 'text-rose-700 font-semibold' : ''}`}>{minutesLabel(h.lunch.minutes)}{h.lunch.exceededMinutes ? ` (+${h.lunch.exceededMinutes})` : ''}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
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
              <td className="px-2 py-1.5">{istTime(r.firstStart)}</td><td className="px-2 py-1.5">{istTime(r.lastEnd)}</td><td className="px-2 py-1.5">{minutesLabel(r.minutes)}</td>
              <td className="px-2 py-1.5">{r.exceededMinutes ? `${r.exceededMinutes} min` : '-'}</td><td className={`px-2 py-1.5 font-bold ${r.flagged ? 'text-rose-700' : 'text-emerald-700'}`}>{r.flagged ? 'Exceeded' : 'Within'}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
};

/** HR / Super Admin: Punch In / Out with location, worked time, missing Punch Out, location unavailable, lunch. Each load is audited. */
export const HrPunchRecords: React.FC = () => {
  const [to, setTo] = useState(istToday());
  const [from, setFrom] = useState(shiftDate(istToday(), -6));
  const [data, setData] = useState<{ allowanceMinutes: number; retentionDays: number; rows: HrPunchRow[] } | null>(null);
  const [error, setError] = useState('');
  const [find, setFind] = useState('');
  const [dept, setDept] = useState('');
  const [problem, setProblem] = useState<'' | 'missing' | 'nolocation' | 'lunch'>('');
  useEffect(() => { setData(null); attendanceApi.hrPunches(from, to).then(d => { setError(''); setData(d); }, e => setError(e instanceof Error ? e.message : String(e))); }, [from, to]);
  const departments = useMemo(() => [...new Set((data?.rows ?? []).map(r => r.department).filter(Boolean) as string[])].sort(), [data]);
  const rows = (data?.rows ?? []).filter(r =>
    (!find.trim() || r.name.toLowerCase().includes(find.trim().toLowerCase())) && (!dept || r.department === dept)
    && (problem === 'missing' ? r.missingPunchOut : problem === 'nolocation' ? r.locationUnavailable : problem === 'lunch' ? r.lunchExceededMinutes > 0 : true));
  const loc = (p: HrPunchRow['punchIn']) => {
    const lat = p?.latitude == null ? null : Number(p.latitude);
    const lng = p?.longitude == null ? null : Number(p.longitude);
    return p?.locationStatus === 'CAPTURED' && lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
      ? (
        <a className="inline-flex flex-col text-blue-700 hover:underline" data-testid="hr-location" href={`https://www.google.com/maps?q=${lat},${lng}`} target="_blank" rel="noreferrer">
          <span className="inline-flex items-center gap-1 font-semibold"><MapPin className="w-3.5 h-3.5" aria-hidden="true" /> View on map</span>
          <span className="text-[11px] text-slate-500">{lat.toFixed(5)}, {lng.toFixed(5)}{p.accuracy != null ? ` (±${p.accuracy} m)` : ''}</span>
        </a>
      )
      : <span className="text-slate-500">{locationLabel(p)}</span>;
  };
  return (
    <section className={card} aria-label="Punch records" data-testid="hr-punch-records">
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div className="mr-auto"><h2 className="text-base font-extrabold text-slate-900">Punch In / Punch Out</h2>
          <p className="text-[11px] text-slate-500">Locations are kept for {data?.retentionDays ?? 90} days. Opening this list is recorded in the audit log.</p></div>
        <RangePicker from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <label className="text-xs font-semibold text-slate-600 flex flex-col gap-1">Department<select className={field} value={dept} onChange={e => setDept(e.target.value)}><option value="">All</option>{departments.map(d => <option key={d}>{d}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600 flex flex-col gap-1">Show<select className={field} value={problem} onChange={e => setProblem(e.target.value as typeof problem)}>
          <option value="">Everyone</option><option value="missing">Missing Punch Out</option><option value="nolocation">Location unavailable</option><option value="lunch">Lunch exceeded</option></select></label>
        <input className={`${field} w-44`} placeholder="Search employee" aria-label="Search employee" value={find} onChange={e => setFind(e.target.value)} />
      </div>
      {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : !data ? <p className="text-xs text-slate-500">Loading…</p> : rows.length === 0 ? <p className="text-xs text-slate-500">No punches in this period.</p> : (
        <div className="overflow-x-auto"><table className="min-w-full text-xs">
          <thead className="text-slate-500"><tr>{['Employee', 'Department', 'Day', 'Punch In', 'In location', 'Punch Out', 'Out location', 'Worked', 'Lunch', 'Notes'].map(h => <th key={h} scope="col" className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map(r => (
            <tr key={`${r.profileId}:${r.date}`} className="align-top"><th scope="row" className="px-2 py-1.5 text-left font-semibold">{r.name}</th><td className="px-2 py-1.5">{r.department ?? '-'}</td><td className="px-2 py-1.5 whitespace-nowrap">{istDate(r.date)}</td>
              <td className="px-2 py-1.5">{istTime(r.punchIn?.at)}</td><td className="px-2 py-1.5">{loc(r.punchIn)}</td>
              <td className="px-2 py-1.5">{istTime(r.punchOut?.at)}{r.punchOutHistory.length > 1 ? <span className="block text-[11px] text-slate-500">earlier: {r.punchOutHistory.slice(0, -1).map(h => istTime(h.at)).join(', ')}</span> : null}</td>
              <td className="px-2 py-1.5">{r.punchOut ? loc(r.punchOut) : '-'}</td><td className="px-2 py-1.5">{minutesLabel(r.workedMinutes)}</td>
              <td className={`px-2 py-1.5 ${r.lunchExceededMinutes ? 'text-rose-700 font-semibold' : ''}`}>{minutesLabel(r.lunchMinutes)}{r.lunchExceededMinutes ? ` (+${r.lunchExceededMinutes})` : ''}</td>
              <td className="px-2 py-1.5">{[r.missingPunchOut ? 'Missing Punch Out' : '', r.locationUnavailable ? 'Location unavailable' : ''].filter(Boolean).join(' · ') || '-'}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
};

/** The Attendance section of the side panel: what each person sees follows their role (the database checks again). */
export const AttendancePage: React.FC<{ hrView?: boolean }> = ({ hrView = false }) => {
  const { profile } = useAuth();
  const isSa = profile?.role === 'SUPER_ADMIN';
  // HR staff (not the recruiters) and the Super Admin; the database checks it again
  // hrView: opened from HR's own panel (only HR staff reach it), so the HR tabs do not depend on the profile's department being loaded
  const isHr = hrView || (!!profile && (isSa || (profile.department?.slug === 'hr' && profile.hrSubRole !== 'HR_RECRUITER')));
  const isOh = !!profile && isOperationsHead(profile);
  const tabs = [
    ...(isHr ? [{ id: 'punches', label: 'Punch records (all staff)' }] : []),
    ...(isSa ? [] : [{ id: 'mine', label: 'My attendance' }]),
    ...(isHr || isOh ? [{ id: 'lunch', label: 'Lunch breaks' }] : [])
  ];
  const [tab, setTab] = useState(tabs[0]?.id ?? 'mine');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900">Attendance</h1>
        <p className="mt-1 text-sm text-slate-600">Punch in when you start and punch out when you finish. Times are the server's, shown in India time.</p>
      </div>
      {tabs.length > 1 ? (
        <div role="tablist" aria-label="Attendance views" className="flex flex-wrap gap-2">
          {tabs.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => setTab(t.id)}
            className={`px-3.5 h-9 rounded-xl text-sm font-bold border ${tab === t.id ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-600'}`}>{t.label}</button>)}
        </div>
      ) : null}
      {tab === 'mine' ? <MyAttendance /> : tab === 'lunch' ? <LunchOverview /> : <HrPunchRecords />}
    </div>
  );
};

export default AttendancePage;
