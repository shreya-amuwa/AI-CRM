import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { Pager, useDebounced } from '../team-member/pipeline/shared';
import { Avatar, Card, CardHead, fieldCls, ghostBtn, LoadingLine, StatCard, Tabs } from '../tasks/head/headParts';
import { clock, dayText, headApi, hours, useHeadData, type AttendanceState } from '../../lib/headDashboard';
import { ATTENDANCE_BADGE, Badge, EmptyRow, officeToday, PageError, Th } from './headBits';

type Filter = 'ALL' | AttendanceState;
const PAGE = 20;

/**
 * Team Attendance: the department's employees for one day, from the CRM's own attendance records (manual Punch In / Punch Out) and approved leave.
 * The database decides which employees the head may see; nothing here sends a department. A past date shows that day.
 */
export const HeadAttendancePage: React.FC = () => {
  const [date, setDate] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search, 300);
  const { data, error, loading, reload } = useHeadData(
    () => headApi.attendance({ date: date || null, status: filter === 'ALL' ? null : filter, search: q, limit: PAGE, offset: (page - 1) * PAGE }),
    [date, filter, q, page]
  );
  const s = data?.summary;
  const today = officeToday();
  const shownDate = data?.date ?? (date || today);
  const isToday = !date || date === today;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900">Team Attendance</h1>
        <p className="mt-1.5 text-[15px] text-slate-600 max-w-2xl">
          Your department's attendance from the CRM's Punch In and Punch Out records and approved leave. Signing in to the CRM does not count as attendance.
        </p>
      </div>
      {error && <PageError message={error} onRetry={reload} />}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" aria-label="Attendance summary">
        <StatCard label="Employees" value={s?.employees ?? '-'} testId="att-employees" />
        <StatCard label="Present" value={s?.present ?? '-'} tone="green" testId="att-present" />
        <StatCard label="Absent" value={s?.absent ?? '-'} tone="red" testId="att-absent" foot={isToday ? 'No punch-in yet today' : 'No punch-in that day'} />
        <StatCard label="On leave" value={s?.onLeave ?? '-'} tone="amber" testId="att-leave" />
        <StatCard label="Attendance" value={s?.rate === null || s?.rate === undefined ? '-' : `${s.rate}%`} tone="blue" foot="Present out of those not on leave" testId="att-rate" />
      </div>
      <Card label="Attendance register">
        <CardHead title={isToday ? `Today · ${dayText(shownDate)}` : dayText(shownDate)} hint={data ? `${data.total} employee${data.total === 1 ? '' : 's'} shown` : undefined}
          right={
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[13px] font-semibold text-slate-600 flex items-center gap-2">
                Date
                <input type="date" aria-label="Attendance date" className={`${fieldCls} !h-10 w-44`} value={date || today} max={today} onChange={e => { setDate(e.target.value === today ? '' : e.target.value); setPage(1); }} />
              </label>
              <button type="button" className={`${ghostBtn} !h-10`} onClick={() => { setDate(''); setPage(1); }} disabled={isToday}>Today</button>
            </div>
          } />
        <div className="px-5 pb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <Tabs<Filter> label="Attendance filter" value={filter} onChange={f => { setFilter(f); setPage(1); }} options={[
            { id: 'ALL', label: 'All', count: s?.employees }, { id: 'PRESENT', label: 'Present', count: s?.present },
            { id: 'ABSENT', label: 'Absent', count: s?.absent }, { id: 'ON_LEAVE', label: 'On leave', count: s?.onLeave }]} />
          <label className="relative lg:w-72">
            <span className="sr-only">Search employees</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search name or designation" className={`${fieldCls} pl-9 !h-10 text-[13px]`} />
          </label>
        </div>
        {loading && !data ? <LoadingLine label="Loading attendance…" /> : (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><Th>Employee</Th><Th>Designation</Th><Th>Date</Th><Th>Status</Th><Th>Punch in</Th><Th>Punch out</Th><Th>Worked</Th><Th>Leave</Th></tr></thead>
              <tbody className="divide-y divide-slate-100" data-testid="attendance-rows">
                {data?.items.length === 0 && <EmptyRow cols={8} title="No employees match" hint={filter === 'ALL' && !q ? 'There are no active employees in your department.' : 'Try another filter or search.'} />}
                {data?.items.map(r => (
                  <tr key={r.profileId} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3"><div className="flex items-center gap-2.5"><Avatar name={r.name} /><span className="font-semibold text-slate-900">{r.name}</span></div></td>
                    <td className="px-4 py-3 text-slate-600">{r.designation || (r.role === 'TEAM_HEAD' ? 'Team Lead' : r.role === 'TEAM_MEMBER' ? 'Team Member' : 'Department Head')}{r.team ? <span className="block text-[11px] text-slate-400">{r.team}</span> : null}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dayText(r.date)}</td>
                    <td className="px-4 py-3"><Badge tone={ATTENDANCE_BADGE[r.status].tone}>{ATTENDANCE_BADGE[r.status].label}</Badge></td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{clock(r.punchIn)}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{r.punchIn && !r.punchOut && isToday ? <span className="text-slate-400">Working</span> : clock(r.punchOut)}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{hours(r.workedMinutes)}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.leave ? (r.leave.type === 'HALF_DAY' ? `Half day${r.leave.halfDayShift ? ` (${r.leave.halfDayShift.toLowerCase()})` : ''}` : 'Full day') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > PAGE && <Pager page={page} pageSize={PAGE} total={data.total} noun="employees" onPage={setPage} sizes={[PAGE]} />}
      </Card>
    </div>
  );
};
