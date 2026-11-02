import React, { useCallback, useEffect, useState } from 'react';
import type { Leaderboard, LeaderboardDepartment, LeaderboardRow } from '../../../../shared/contracts';
import { ApiError } from '../../../lib/api/client';
import { reportPerformanceApi } from '../../../lib/api/reportPerformance';
import { Card, ErrorBanner, selectCls, Spinner } from '../../team-member/pipeline/shared';
import { dateLabel, pctLabel, todayIso } from '../../reports/reportUi';
import { LeaderboardTable } from './parts';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');

const DepartmentPeople: React.FC<{ department: LeaderboardDepartment; period: Leaderboard['period']; onOpenEmployee: (id: string, p: { type: string; from?: string; to?: string }) => void }> = ({ department, period, onOpenEmployee }) => {
  const [heads, setHeads] = useState<LeaderboardRow[] | null>(null);
  const [leads, setLeads] = useState<LeaderboardRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const base = { periodType: 'CUSTOM', from: period.from, to: period.to, department: department.departmentId, category: 'ALL', limit: 200 };
    reportPerformanceApi.leaderboard({ ...base, role: 'DEPARTMENT_HEAD' }).then(d => setHeads(d.rows as LeaderboardRow[]), e => setError(errText(e)));
    reportPerformanceApi.leaderboard({ ...base, role: 'TEAM_LEAD' }).then(d => setLeads(d.rows as LeaderboardRow[]), e => setError(errText(e)));
  }, [department.departmentId, period.from, period.to]);
  if (error) return <ErrorBanner message={error} />;
  if (!heads || !leads) return <Spinner />;
  const open = (id: string) => onOpenEmployee(id, { type: 'CUSTOM', from: period.from, to: period.to });
  return (
    <div className="space-y-4">
      <section aria-label="Department Head performance"><h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Department Head performance</h4><LeaderboardTable rows={heads} onOpen={open} empty="No Department Head in this department." /></section>
      <section aria-label="Team Lead performance"><h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Team Lead performance</h4><LeaderboardTable rows={leads} onOpen={open} empty="No Team Lead in this department." /></section>
    </div>
  );
};

/** Departments side by side for a period; open one for its Department Head and Team Leads. */
export const DepartmentPerformance: React.FC<{ reloadKey: number; onOpenEmployee: (id: string, p: { type: string; from?: string; to?: string }) => void }> = ({ reloadKey, onOpenEmployee }) => {
  const [periodType, setPeriodType] = useState<'WEEKLY' | 'MONTHLY'>('MONTHLY');
  const [data, setData] = useState<Leaderboard | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    reportPerformanceApi.leaderboard({ periodType, from: todayIso(), category: 'ALL', limit: 1 }).then(d => { setError(''); setData(d); }, e => setError(errText(e)));
  }, [periodType]);
  useEffect(() => { setData(null); }, [periodType]);
  useEffect(load, [load, reloadKey]);
  const rows = [...(data?.departments ?? [])].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div><h2 className="text-base font-bold text-slate-900">Department Performance</h2><p className="text-xs text-slate-500">{data ? `${dateLabel(data.period.from)} to ${dateLabel(data.period.to)}` : 'Departments compared from the records.'}</p></div>
        <label className="text-[11px] font-semibold text-slate-500">Period
          <select className={`${selectCls} mt-1 block`} value={periodType} onChange={e => setPeriodType(e.target.value as 'WEEKLY' | 'MONTHLY')}><option value="WEEKLY">This week</option><option value="MONTHLY">This month</option></select>
        </label>
      </div>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {!data && !error ? <Spinner /> : null}
      {data ? (
        rows.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No department has people to measure.</p> : (
          <div className="space-y-2" data-testid="department-performance">
            {rows.map(d => (
              <div key={d.departmentId} className="rounded-2xl border border-slate-200">
                <button type="button" className="w-full text-left px-4 py-3 flex flex-wrap items-center justify-between gap-2 hover:bg-slate-50 rounded-2xl" aria-expanded={open === d.departmentId} onClick={() => setOpen(o => (o === d.departmentId ? null : d.departmentId))}>
                  <span className="text-sm font-bold text-slate-900">{d.department}</span>
                  <span className="text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                    <span>Score <b className="tabular-nums">{d.status === 'RANKED' ? d.score : 'Insufficient data'}</b></span>
                    <span>Completion <b>{pctLabel(d.completionRate)}</b></span><span>Compliance <b>{pctLabel(d.compliance)}</b></span><span>HR rating <b>{d.hrRating ?? 'none'}</b></span>
                    <span>{d.ranked} ranked, {d.insufficient} insufficient data</span>
                  </span>
                </button>
                {open === d.departmentId ? <div className="px-4 pb-4"><DepartmentPeople department={d} period={data.period} onOpenEmployee={onOpenEmployee} /></div> : null}
              </div>
            ))}
          </div>
        )
      ) : null}
    </Card>
  );
};

/** Every employee for a period with a name search; opens the employee profile. */
export const EmployeePerformance: React.FC<{ reloadKey: number; onOpenEmployee: (id: string, p: { type: string; from?: string; to?: string }) => void }> = ({ reloadKey, onOpenEmployee }) => {
  const [periodType, setPeriodType] = useState<'WEEKLY' | 'MONTHLY'>('MONTHLY');
  const [role, setRole] = useState('');
  const [data, setData] = useState<Leaderboard | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => {
    reportPerformanceApi.leaderboard({ periodType, from: todayIso(), category: 'ALL', limit: 200, role: role || undefined }).then(d => { setError(''); setData(d); }, e => setError(errText(e)));
  }, [periodType, role]);
  useEffect(() => { setData(null); }, [periodType, role]);
  useEffect(load, [load, reloadKey]);
  const rows = ((data?.rows ?? []) as LeaderboardRow[]).filter(r => !search.trim() || r.name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div><h2 className="text-base font-bold text-slate-900">Employee Performance</h2><p className="text-xs text-slate-500">Open a name for the score breakdown, the weekly history, the HR reviews and the reports.</p></div>
        <div className="flex flex-wrap items-end gap-2">
          <input className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm" placeholder="Search by name" aria-label="Search employees by name" value={search} onChange={e => setSearch(e.target.value)} />
          <select className={selectCls} aria-label="Role" value={role} onChange={e => setRole(e.target.value)}><option value="">All roles</option><option value="TEAM_MEMBER">Team Members</option><option value="TEAM_LEAD">Team Leads</option><option value="DEPARTMENT_HEAD">Department Heads</option></select>
          <select className={selectCls} aria-label="Period" value={periodType} onChange={e => setPeriodType(e.target.value as 'WEEKLY' | 'MONTHLY')}><option value="WEEKLY">This week</option><option value="MONTHLY">This month</option></select>
        </div>
      </div>
      {error ? <ErrorBanner message={error} onRetry={load} /> : null}
      {!data && !error ? <Spinner /> : null}
      {data ? <LeaderboardTable rows={rows} onOpen={id => onOpenEmployee(id, { type: data.period.type, from: data.period.from, to: data.period.to })} empty="Nobody matches." /> : null}
    </Card>
  );
};
