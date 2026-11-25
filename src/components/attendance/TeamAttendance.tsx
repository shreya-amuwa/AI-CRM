import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-react';
import {
  attendanceApi, istClock, istLongDate, istToday, TEAM_STATUS_LABEL, TEAM_STATUS_TONE,
  type TeamAttendance as TeamAttendanceData, type TeamAttendanceRow, type TeamStatus
} from '../../lib/attendance';
import { openAttendance } from './attendanceEvents';

/**
 * Team attendance for management (Task 01, migration 20270205000200). One status per employee (no double counting); the database decides
 * who is listed: HR and the Managing Director everyone, a CEO / Department Head the departments and functions of their own scope, a
 * Team Lead their team. No location is shown here. The summary cards filter the list; departments expand to their people.
 */

const FILTERS: { key: string; label: string; count: (t: TeamAttendanceData['totals']) => number; tone?: string }[] = [
  { key: '', label: 'Scheduled', count: t => t.scheduled },
  { key: 'PUNCHED_IN', label: 'Present', count: t => t.present, tone: 'text-emerald-700' },
  { key: 'ABSENT', label: 'Absent', count: t => t.absent, tone: 'text-rose-700' },
  { key: 'NOT_PUNCHED_IN', label: 'Not punched in', count: t => t.notPunchedIn, tone: 'text-orange-700' },
  { key: 'LATE_ARRIVALS', label: 'Late arrivals', count: t => t.late, tone: 'text-amber-700' },
  { key: 'APPROVED_LEAVE', label: 'On leave', count: t => t.onLeave, tone: 'text-sky-700' },
  { key: 'ON_BREAK', label: 'On break', count: t => t.onBreak },
  { key: 'SHIFT_COMPLETED', label: 'Shift completed', count: t => t.shiftCompleted }
];
const UNAVAILABLE: TeamStatus[] = ['ABSENT', 'NOT_PUNCHED_IN', 'APPROVED_LEAVE'];
// unavailable people stand out in red, late arrivals (the database's company-wide rule: after 10:30) in amber
const rowTone = (r: TeamAttendanceRow) => (UNAVAILABLE.includes(r.status) ? 'bg-rose-50/40' : r.late ? 'bg-amber-50/60' : '');

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('');
const minsLate = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

function remarks(r: TeamAttendanceRow): string[] {
  const out: string[] = [];
  if (r.leave === 'FULL_DAY') out.push('Approved leave (full day)');
  if (r.leave === 'MORNING') out.push('Half-day leave (morning)');
  if (r.leave === 'AFTERNOON') out.push('Half-day leave (afternoon)');
  if (r.late) out.push(`Late by ${minsLate(r.lateMinutes)}`);
  if (r.onBreak) out.push('On lunch / break');
  if (r.earlyOutReason) out.push(`Left early: ${r.earlyOutReason}`);
  if (r.correctionPending) out.push('Correction requested');
  if (r.status === 'NOT_PUNCHED_IN' && r.dayStart) out.push(`Day started ${r.dayStart}`);
  return out;
}

const Avatar: React.FC<{ r: TeamAttendanceRow }> = ({ r }) => (
  r.avatarUrl
    ? <img src={r.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover bg-slate-100" loading="lazy" />
    : <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">{initials(r.name)}</span>
);
export const TeamStatusBadge: React.FC<{ status: TeamStatus }> = ({ status }) => (
  <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TEAM_STATUS_TONE[status]}`}>{TEAM_STATUS_LABEL[status]}</span>
);

function useTeamAttendance(q: { date: string; departmentId: string; teamId: string; status: string; search: string }) {
  const [data, setData] = useState<TeamAttendanceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    attendanceApi.teamOverview({ date: q.date, departmentId: q.departmentId, teamId: q.teamId, status: q.status, search: q.search })
      .then(d => { if (n === seq.current) { setData(d); setError(null); } })
      .catch(e => { if (n === seq.current) setError(e instanceof Error ? e.message : 'Could not load team attendance.'); })
      .finally(() => { if (n === seq.current) setLoading(false); });
  }, [q.date, q.departmentId, q.teamId, q.status, q.search]);
  useEffect(() => {
    load();
    // today's view follows punches as they happen: when the tab comes back, and every 2 minutes while it is visible
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = q.date === istToday() ? window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, 120_000) : undefined;
    return () => { document.removeEventListener('visibilitychange', onVisible); if (timer) window.clearInterval(timer); };
  }, [load, q.date]);
  return { data, error, loading, reload: load };
}

/** "Today's Team Attendance" on a management dashboard: the counts and each department's availability; the full list is one tap away. */
export const TeamAttendanceSummary: React.FC = () => {
  const today = istToday();
  const { data, error, loading, reload } = useTeamAttendance({ date: today, departmentId: '', teamId: '', status: '', search: '' });
  if (error && /FORBIDDEN|managers and HR/i.test(error)) return null;
  const t = data?.totals;
  return (
    <section aria-label="Today's Team Attendance" className="rounded-xl border border-slate-200 bg-white" data-testid="team-attendance-summary">
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <h2 className="text-sm font-semibold text-slate-900">Today&apos;s Team Attendance</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={reload} aria-label="Refresh attendance" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
          <button type="button" onClick={() => openAttendance('team')} className="h-8 rounded-lg px-2.5 text-xs font-semibold text-blue-700 hover:bg-blue-50">View all</button>
        </div>
      </div>
      {error ? <p role="alert" className="mx-4 my-3 rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700">{error}</p> : null}
      {!data && !error ? <p className="px-4 py-3 text-xs text-slate-500" role="status">Loading attendance…</p> : null}
      {t ? <>
        <dl className="grid grid-cols-3 sm:grid-cols-6 gap-px bg-slate-100 border-y border-slate-100 mt-3">
          {[['Scheduled', t.scheduled, ''], ['Present', t.present, 'text-emerald-700'], ['Absent', t.absent, 'text-rose-700'], ['Not punched in', t.notPunchedIn, 'text-orange-700'],
            ['Late', t.late, 'text-amber-700'], ['On leave', t.onLeave, 'text-sky-700']].map(([label, n, tone]) => (
            <div key={label as string} className="bg-white px-3 py-2">
              <dt className="text-[11px] text-slate-500 truncate">{label}</dt>
              <dd className={`text-lg font-semibold ${tone || 'text-slate-900'}`}>{n}</dd>
            </div>
          ))}
        </dl>
        {data.departments.length ? (
          <ul className="divide-y divide-slate-100 px-4 py-1 text-sm">
            {data.departments.map(d => (
              <li key={d.id ?? 'none'} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate text-slate-800">{d.name}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  <span className="font-semibold text-slate-900">{d.available}</span>/{d.total} available
                  {d.unavailable ? <span className="ml-2 font-semibold text-rose-700">{d.unavailable} unavailable</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : <p className="px-4 py-3 text-xs text-slate-500">No employees in your scope.</p>}
      </> : null}
    </section>
  );
};

/** The full team attendance view (Attendance → Team attendance). */
export const TeamAttendance: React.FC = () => {
  const today = istToday();
  const [date, setDate] = useState(today);
  const [departmentId, setDepartmentId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [status, setStatus] = useState('');
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => { const t = window.setTimeout(() => setSearch(typed.trim()), 300); return () => window.clearTimeout(t); }, [typed]);
  const { data, error, loading, reload } = useTeamAttendance({ date, departmentId, teamId, status, search });
  const teams = useMemo(() => (data?.teams ?? []).filter(t => !departmentId || t.departmentId === departmentId).sort((a, b) => a.name.localeCompare(b.name)), [data, departmentId]);
  const depts = useMemo(() => [...(data?.departmentOptions ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [data]);
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const field = 'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm';

  return (
    <div className="space-y-4" data-testid="team-attendance">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">Date
          <input type="date" className={field} value={date} max={today} onChange={e => e.target.value && setDate(e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">Department
          <select className={field} value={departmentId} onChange={e => { setDepartmentId(e.target.value); setTeamId(''); }}>
            <option value="">All in my scope</option>{depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">Team
          <select className={field} value={teamId} onChange={e => setTeamId(e.target.value)}>
            <option value="">All teams</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">Status
          <select className={field} value={status} onChange={e => setStatus(e.target.value)} data-testid="team-status-filter">
            <option value="">Every status</option>
            <option value="UNAVAILABLE">Unavailable for work</option>
            <option value="PUNCHED_IN">Present (punched in)</option>
            <option value="LATE_ARRIVALS">Late arrivals</option>
            {(Object.keys(TEAM_STATUS_LABEL) as TeamStatus[]).map(s => <option key={s} value={s}>{TEAM_STATUS_LABEL[s]}</option>)}
          </select></label>
        <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1 text-xs font-semibold text-slate-600">Employee
          <span className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input type="search" className={`${field} w-full pl-8`} value={typed} onChange={e => setTyped(e.target.value)} placeholder="Name or designation" maxLength={100} />
          </span></label>
        <button type="button" onClick={reload} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </button>
      </div>
      <p className="text-xs text-slate-500">
        {data ? `${istLongDate(data.date)}${data.workingDay ? '' : ' · not a working day'} · ` : ''}
        Reporting time {data?.reportingTime ?? '10:00'}; Late = punched in after {data?.lateAfter ?? '10:30'} (late minutes counted from {data?.lateAfter ?? '10:30'}), the same for every department; absent {data?.absentAfterMinutes ?? 60} min after the person&apos;s start time without a Punch In. Each person has one status.
      </p>
      {error ? <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {!data && !error ? <p role="status" className="text-sm text-slate-500">Loading team attendance…</p> : null}

      {data ? <>
        <div role="group" aria-label="Attendance summary" className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {FILTERS.map(f => (
            <button key={f.key || 'all'} type="button" aria-pressed={status === f.key} onClick={() => setStatus(status === f.key ? '' : f.key)} data-testid={`team-card-${f.key || 'all'}`}
              className={`rounded-lg border px-3 py-2 text-left ${status === f.key ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
              <span className="block truncate text-[11px] text-slate-500">{f.label}</span>
              <span className={`block text-xl font-semibold ${f.tone ?? 'text-slate-900'}`}>{f.count(data.totals)}</span>
            </button>
          ))}
        </div>

        <section aria-label="Departments" className="rounded-xl border border-slate-200 bg-white">
          <h3 className="px-4 pt-3 text-sm font-semibold text-slate-900">Availability by department</h3>
          {!data.departments.length ? <p className="px-4 py-3 text-sm text-slate-500">No employees in your scope.</p> : (
            <ul className="divide-y divide-slate-100">
              {data.departments.map(d => {
                const key = d.id ?? 'none';
                const people = data.rows.filter(r => (r.departmentId ?? 'none') === key);
                return (
                  <li key={key}>
                    <button type="button" onClick={() => toggle(key)} aria-expanded={open.has(key)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-slate-50">
                      {open.has(key) ? <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{d.name}</span>
                      <span className="shrink-0 text-xs text-slate-500"><span className="font-semibold text-slate-900">{d.available}</span>/{d.total} available
                        {d.unavailable ? <span className="ml-2 font-semibold text-rose-700">{d.unavailable} unavailable</span> : null}</span>
                    </button>
                    {open.has(key) ? (
                      <ul className="bg-slate-50/60 px-4 pb-2">
                        {people.length ? people.map(r => (
                          <li key={r.profileId} className="flex items-center gap-2 py-1.5 text-sm">
                            <span className="min-w-0 flex-1 truncate">{r.name}{r.team ? <span className="text-xs text-slate-500"> · {r.team}</span> : null}</span>
                            <TeamStatusBadge status={r.status} />
                          </li>
                        )) : <li className="py-1.5 text-xs text-slate-500">Nobody matches the filters here.</li>}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Employees" className="rounded-xl border border-slate-200 bg-white">
          <h3 className="px-4 pt-3 text-sm font-semibold text-slate-900">Employees <span className="font-normal text-slate-500">({data.shown})</span></h3>
          {!data.rows.length ? <p className="px-4 py-4 text-sm text-slate-500">Nobody matches these filters.</p> : <>
            {/* phones: a compact list (each person's details stay one tap away) */}
            <ul className="md:hidden divide-y divide-slate-100" data-testid="team-list">
              {data.rows.map(r => (
                <li key={r.profileId} className={`px-4 py-2.5 ${rowTone(r)}`} data-late={r.late ? 'true' : undefined}>
                  <details>
                    <summary className="flex cursor-pointer list-none items-center gap-2">
                      <Avatar r={r} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">{r.name}</span>
                        <span className="block truncate text-xs text-slate-500">{r.designation || r.role}{r.department ? ` · ${r.department}` : ''}</span>
                      </span>
                      <TeamStatusBadge status={r.status} />
                    </summary>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 pl-10 text-xs">
                      <dt className="text-slate-500">Team Lead</dt><dd>{r.teamLead ?? '-'}</dd>
                      <dt className="text-slate-500">Punch In</dt><dd>{istClock(r.punchInAt)}</dd>
                      <dt className="text-slate-500">Punch Out</dt><dd>{istClock(r.punchOutAt)}</dd>
                      {remarks(r).length ? <><dt className="text-slate-500">Remarks</dt><dd>{remarks(r).join(' · ')}</dd></> : null}
                    </dl>
                  </details>
                </li>
              ))}
            </ul>
            {/* tablets and desktops: the table (scrolls inside its box if the screen is narrow) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full text-sm" data-testid="team-table">
                <thead className="text-left text-xs text-slate-500">
                  <tr>{['Employee', 'Designation', 'Department', 'Team Lead', 'Status', 'Punch In', 'Punch Out', 'Remarks'].map(h => <th key={h} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map(r => (
                    <tr key={r.profileId} className={rowTone(r)} data-late={r.late ? 'true' : undefined}>
                      <td className="px-3 py-2"><span className="flex items-center gap-2"><Avatar r={r} /><span className="font-medium text-slate-900">{r.name}</span></span></td>
                      <td className="px-3 py-2 text-slate-600">{r.designation || r.role}</td>
                      <td className="px-3 py-2 text-slate-600">{r.department ?? '-'}{r.team ? <span className="block text-xs text-slate-500">{r.team}</span> : null}</td>
                      <td className="px-3 py-2 text-slate-600">{r.teamLead ?? '-'}</td>
                      <td className="px-3 py-2"><TeamStatusBadge status={r.status} /></td>
                      <td className="px-3 py-2 whitespace-nowrap">{istClock(r.punchInAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{istClock(r.punchOutAt)}</td>
                      <td className="px-3 py-2 text-xs text-slate-600">{remarks(r).join(' · ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>}
        </section>
      </> : null}
    </div>
  );
};

export default TeamAttendance;
