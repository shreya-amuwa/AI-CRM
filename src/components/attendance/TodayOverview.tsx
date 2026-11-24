import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { attendanceApi, type AttendanceOverview, type OverviewCategory } from '../../lib/attendance';

/**
 * Today's Attendance Overview (migration 20270131000100): the Super Admin's 11:00 alert "Look at today's attendance." opens it directly.
 * Present, Absent, On leave, Not yet marked, Late and Total, per department, and the people in each group, the absent employees first.
 * HR and the Super Admin only (the database checks it; every read is audited like the register). Times are India Standard Time.
 */
const istDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '–');
const longDay = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

type Group = OverviewCategory | 'LATE' | 'ALL';
const CARDS: { id: Group; label: string; key: 'absent' | 'notMarked' | 'onLeave' | 'present' | 'late' | 'total'; tone: string }[] = [
  { id: 'ABSENT', label: 'Absent today', key: 'absent', tone: 'border-rose-300 bg-rose-50 text-rose-800' },
  { id: 'NOT_MARKED', label: 'Not yet marked', key: 'notMarked', tone: 'border-amber-300 bg-amber-50 text-amber-800' },
  { id: 'ON_LEAVE', label: 'On leave', key: 'onLeave', tone: 'border-sky-300 bg-sky-50 text-sky-800' },
  { id: 'PRESENT', label: 'Present today', key: 'present', tone: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  { id: 'LATE', label: 'Late arrivals', key: 'late', tone: 'border-orange-300 bg-orange-50 text-orange-800' },
  { id: 'ALL', label: 'Total employees', key: 'total', tone: 'border-slate-300 bg-white text-slate-800' }
];
const GROUP_TITLE: Record<Group, string> = {
  ABSENT: 'Absent today', NOT_MARKED: 'Not yet marked attendance', ON_LEAVE: 'On leave', PRESENT: 'Present today', LATE: 'Late arrivals', ALL: 'All employees'
};
const CATEGORY_LABEL: Record<OverviewCategory, string> = { PRESENT: 'Present', ABSENT: 'Absent', ON_LEAVE: 'On leave', NOT_MARKED: 'Not yet marked' };
const CATEGORY_TONE: Record<OverviewCategory, string> = {
  PRESENT: 'bg-emerald-50 text-emerald-800 border-emerald-200', ABSENT: 'bg-rose-50 text-rose-700 border-rose-200',
  ON_LEAVE: 'bg-sky-50 text-sky-800 border-sky-200', NOT_MARKED: 'bg-amber-50 text-amber-800 border-amber-200'
};

export const TodayOverview: React.FC = () => {
  const [date, setDate] = useState(istDay());
  const [data, setData] = useState<AttendanceOverview | null>(null);
  const [error, setError] = useState('');
  // the absent employees first: that is what the Super Admin opens this for
  const [group, setGroup] = useState<Group>('ABSENT');
  const [dept, setDept] = useState('');
  const listRef = useRef<HTMLHeadingElement>(null);
  const load = useCallback(() => {
    setError('');
    attendanceApi.todayOverview(date).then(setData, e => setError(e instanceof Error ? e.message : String(e)));
  }, [date]);
  useEffect(() => { setData(null); load(); }, [load]);
  const rows = useMemo(() => (data?.rows ?? []).filter(r => (!dept || (r.departmentId ?? '') === dept)
    && (group === 'ALL' || (group === 'LATE' ? r.late : r.category === group))), [data, group, dept]);
  const pick = (g: Group) => { setGroup(g); requestAnimationFrame(() => listRef.current?.focus()); };

  return (
    <section className="space-y-4" aria-label="Today's Attendance Overview" data-testid="today-overview">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-lg font-extrabold text-slate-900">Today&apos;s Attendance Overview</h2>
          <p className="text-xs text-slate-500">{data ? longDay(data.date) : longDay(date)} · India Standard Time · {data ? `as of ${clock(data.generatedAt)}` : 'loading'}
            {data && !data.workingDay ? ' · not a working day' : ''}</p>
        </div>
        <label className="text-xs font-semibold text-slate-600 flex flex-col gap-1">Date
          <input type="date" className="h-9 rounded-lg border border-slate-300 px-2 text-sm" value={date} max={istDay()} onChange={e => e.target.value && setDate(e.target.value)} data-testid="overview-date" />
        </label>
        <button type="button" onClick={load} className="inline-flex items-center gap-1.5 h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw className="w-4 h-4" aria-hidden /> Refresh
        </button>
      </div>
      {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      {!data && !error ? <p role="status" className="text-sm text-slate-500">Loading today&apos;s attendance…</p> : null}
      {data ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5" aria-label="Summary">
            {CARDS.map(c => (
              <button key={c.id} type="button" onClick={() => pick(c.id)} aria-pressed={group === c.id} data-testid={`overview-card-${c.id}`}
                className={`rounded-2xl border-2 p-3 text-left transition-shadow ${c.tone} ${group === c.id ? 'ring-2 ring-blue-400 shadow' : ''}`}>
                <span className="block text-[11px] font-bold uppercase tracking-wide">{c.label}</span>
                <span className="block text-2xl font-extrabold tabular-nums">{data.totals[c.key]}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">Absent: not punched in and not on leave, {data.absentAfterMinutes} minutes after their day start. Late: punched in after their day start.</p>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 ref={listRef} tabIndex={-1} className="mr-auto text-sm font-extrabold text-slate-900 focus:outline-none" data-testid="overview-list-title">
                {GROUP_TITLE[group]} ({rows.length})
              </h3>
              <label className="text-xs text-slate-600 flex items-center gap-1.5">Department
                <select className="h-8 rounded-lg border border-slate-300 px-2 text-xs" value={dept} onChange={e => setDept(e.target.value)}>
                  <option value="">All</option>
                  {data.departments.map(d => <option key={d.id ?? 'none'} value={d.id ?? ''}>{d.name}</option>)}
                </select>
              </label>
            </div>
            {rows.length === 0 ? <p className="text-sm text-slate-500" data-testid="overview-empty">Nobody in this group{dept ? ' in this department' : ''}.</p> : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm" data-testid="overview-list">
                  <thead className="text-xs text-slate-500"><tr>{['Employee', 'Department', 'Status', 'Day starts', 'Punched in'].map(h => <th key={h} scope="col" className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map(r => (
                      <tr key={r.profileId} data-testid="overview-row" data-category={r.category}>
                        <th scope="row" className="px-2 py-1.5 text-left font-semibold text-slate-900">{r.name}{r.designation ? <span className="block text-[11px] font-normal text-slate-500">{r.designation}</span> : null}</th>
                        <td className="px-2 py-1.5 text-slate-700">{r.department ?? '–'}</td>
                        <td className="px-2 py-1.5">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${CATEGORY_TONE[r.category]}`}>{CATEGORY_LABEL[r.category]}{r.leave && r.category === 'ON_LEAVE' && r.leave !== 'FULL_DAY' ? ' (half day)' : ''}</span>
                          {r.late ? <span className="ml-1 inline-flex rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-bold text-orange-800">Late {r.lateMinutes} min</span> : null}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums text-slate-600">{r.dayStart}</td>
                        <td className="px-2 py-1.5 tabular-nums text-slate-700">{clock(r.punchInAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-extrabold text-slate-900 mb-2">By department</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm" data-testid="overview-departments">
                <thead className="text-xs text-slate-500"><tr>{['Department', 'Total', 'Present', 'Absent', 'On leave', 'Not yet marked', 'Late'].map(h => <th key={h} scope="col" className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.departments.map(d => (
                    <tr key={d.id ?? 'none'}>
                      <th scope="row" className="px-2 py-1.5 text-left font-semibold">
                        <button type="button" className="hover:text-blue-700 hover:underline" onClick={() => { setDept(d.id ?? ''); pick('ABSENT'); }}>{d.name}</button>
                      </th>
                      <td className="px-2 py-1.5 tabular-nums">{d.total}</td>
                      <td className="px-2 py-1.5 tabular-nums text-emerald-700">{d.present}</td>
                      <td className={`px-2 py-1.5 tabular-nums ${d.absent ? 'font-bold text-rose-700' : ''}`}>{d.absent}</td>
                      <td className="px-2 py-1.5 tabular-nums">{d.onLeave}</td>
                      <td className="px-2 py-1.5 tabular-nums">{d.notMarked}</td>
                      <td className="px-2 py-1.5 tabular-nums">{d.late}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
};

export default TodayOverview;
