import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ApiError } from '../../lib/api/client';
import { performanceApi, type PerformanceReportKey } from '../../lib/api/endpoints';
import { fmtDay } from '../../lib/support';
import type { PerformanceListEntry, PerformancePeople } from '../../../shared/contracts';
import { PageTitle } from '../layout/shell';
import { Avatar, Card, CardHead, fieldCls, LoadingLine, StatCard, Tabs } from '../tasks/head/headParts';
import { defaultPeriod, periodLabel, resolvePeriod, type PeriodChoice } from './periods';
import { INSUFFICIENT, ReportView } from './ReportView';

/**
 * Performance Management (Team Lead and Department Head dashboards).
 * The list shows live figures calculated from the task records for the chosen period; opening a person, a team or the department shows
 * the stored report (figures, charts, written analysis, history) and lets the manager generate or refresh it. Who can see what is
 * decided by the database: a Team Lead only gets their own team, a Department Head their own department.
 * Loaded when the page opens and when the filters change; nothing polls.
 */
type View = 'people' | 'teams' | 'department';
const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong.');
const pctText = (v: number | null) => (v === null ? INSUFFICIENT : `${v}%`);

const ReportBadge: React.FC<{ stub: PerformanceListEntry['report'] }> = ({ stub }) =>
  stub ? (
    <span className="text-xs text-slate-600" title={`Last checked ${new Date(stub.checkedAt).toLocaleString('en-IN')}`}>
      {fmtDay(stub.generatedAt)}{stub.narrativeSource === 'AI' ? ' · AI' : ''}
    </span>
  ) : (
    <span className="text-xs text-slate-400">Not generated</span>
  );

export const PerformanceManagement: React.FC<{ mode: 'TEAM_LEAD' | 'DEPARTMENT_HEAD' }> = ({ mode }) => {
  const [period, setPeriod] = useState<PeriodChoice>(defaultPeriod);
  const [data, setData] = useState<PerformancePeople | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('people');
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'Team Lead' | 'Team Member'>('ALL');
  const [open, setOpen] = useState<{ key: PerformanceReportKey; title: string } | null>(null);

  const resolved = useMemo(() => resolvePeriod(period), [period]);
  const periodError = 'error' in resolved ? resolved.error : null;
  const kind = 'error' in resolved ? null : resolved.kind;
  const start = 'error' in resolved ? '' : resolved.start;
  const end = 'error' in resolved ? '' : resolved.end;

  const load = useCallback(async () => {
    if (!kind) return;
    setLoading(true);
    setError(null);
    try {
      setData(await performanceApi.people({ kind, start, end }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [kind, start, end]);
  useEffect(() => { void load(); }, [load]);

  const people = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.people ?? []).filter(p => (!q || p.name.toLowerCase().includes(q)) && (!teamFilter || p.teamId === teamFilter) && (roleFilter === 'ALL' || p.role === roleFilter));
  }, [data, query, teamFilter, roleFilter]);

  const totals = useMemo(() => {
    const sum = people.reduce((a, p) => {
      const s = p.summary;
      return { total: a.total + s.tasks.total, completed: a.completed + s.tasks.completed, overdue: a.overdue + s.tasks.overdue, onTime: a.onTime + s.timing.onTime, late: a.late + s.timing.late };
    }, { total: 0, completed: 0, overdue: 0, onTime: 0, late: 0 });
    return { ...sum, completionPct: sum.total ? Math.round((1000 * sum.completed) / sum.total) / 10 : null, onTimePct: sum.onTime + sum.late ? Math.round((1000 * sum.onTime) / (sum.onTime + sum.late)) / 10 : null };
  }, [people]);

  const openReport = (e: PerformanceListEntry) => {
    if (!kind) return;
    const key: PerformanceReportKey = { scope: e.scope, kind, start, end, ...(e.scope === 'MEMBER' ? { subjectId: e.id } : e.scope === 'TEAM' ? { teamId: e.id } : { departmentId: e.id }) };
    setOpen({ key, title: e.name });
  };

  const header = (
    <PageTitle
      title="Performance Management"
      subtitle={mode === 'TEAM_LEAD' ? "How your team members are doing against their task deadlines, from the real task records." : 'How your Team Leads, their teams and the department are doing against task deadlines, from the real task records.'}
    />
  );

  if (open) return <div className="space-y-6">{header}<ReportView reportKey={open.key} title={open.title} onBack={() => { setOpen(null); void load(); }} /></div>;

  const teams = data?.teams ?? [];
  const tabs: { id: View; label: string; count?: number }[] = mode === 'DEPARTMENT_HEAD'
    ? [{ id: 'people', label: 'People', count: data?.people.length }, { id: 'teams', label: 'Teams', count: teams.length }, ...(data?.department === null ? [] : [{ id: 'department' as const, label: 'Department' }])]
    : [{ id: 'people', label: 'Team members', count: data?.people.length }, { id: 'teams', label: 'My team' }];
  const entryRow = (e: PerformanceListEntry, extra: React.ReactNode) => (
    <tr key={e.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
      <td className="px-5 py-3"><div className="flex items-center gap-2.5 min-w-0"><Avatar name={e.name} /><div className="min-w-0"><div className="font-bold text-slate-900 truncate">{e.name}</div>{extra}</div></div></td>
      <td className="px-3 py-3 text-slate-700">{e.summary.tasks.total}</td>
      <td className="px-3 py-3 text-slate-700">{e.summary.tasks.completed} <span className="text-xs text-slate-500">({pctText(e.summary.completionPct)})</span></td>
      <td className="px-3 py-3 text-slate-700">{pctText(e.summary.timing.onTimePct)}</td>
      <td className={`px-3 py-3 font-bold ${e.summary.tasks.overdue ? 'text-rose-700' : 'text-slate-700'}`}>{e.summary.tasks.overdue}</td>
      <td className="px-3 py-3"><ReportBadge stub={e.report} /></td>
      <td className="px-5 py-3 text-right"><button type="button" onClick={() => openReport(e)} className="text-sm font-bold text-blue-700 hover:underline" aria-label={`Open the report of ${e.name}`}>Open report</button></td>
    </tr>
  );
  const head = (first: string) => (
    <thead>
      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-y border-slate-100 bg-slate-50/60">
        <th scope="col" className="px-5 py-2.5 font-semibold">{first}</th>
        <th scope="col" className="px-3 py-2.5 font-semibold">Tasks</th>
        <th scope="col" className="px-3 py-2.5 font-semibold">Completed</th>
        <th scope="col" className="px-3 py-2.5 font-semibold">On time</th>
        <th scope="col" className="px-3 py-2.5 font-semibold">Overdue</th>
        <th scope="col" className="px-3 py-2.5 font-semibold">Report</th>
        <th scope="col" className="px-5 py-2.5"><span className="sr-only">Open</span></th>
      </tr>
    </thead>
  );

  return (
    <div className="space-y-6">
      {header}

      <Card label="Reporting period" className="p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="text-xs font-semibold text-slate-500 mb-1.5">Period</div>
            <Tabs label="Reporting period" value={period.kind} onChange={k => setPeriod(p => ({ ...p, kind: k }))} options={[{ id: 'WEEK', label: 'Weekly' }, { id: 'MONTH', label: 'Monthly' }, { id: 'CUSTOM', label: 'Custom range' }]} />
          </div>
          {period.kind === 'WEEK' && (
            <label className="block"><span className="block text-xs font-semibold text-slate-500 mb-1.5">A day in the week</span>
              <input type="date" className={`${fieldCls} w-44`} value={period.weekDate} onChange={e => setPeriod(p => ({ ...p, weekDate: e.target.value }))} /></label>
          )}
          {period.kind === 'MONTH' && (
            <label className="block"><span className="block text-xs font-semibold text-slate-500 mb-1.5">Month</span>
              <input type="month" className={`${fieldCls} w-44`} value={period.month} onChange={e => setPeriod(p => ({ ...p, month: e.target.value }))} /></label>
          )}
          {period.kind === 'CUSTOM' && (
            <>
              <label className="block"><span className="block text-xs font-semibold text-slate-500 mb-1.5">From</span>
                <input type="date" className={`${fieldCls} w-44`} value={period.from} onChange={e => setPeriod(p => ({ ...p, from: e.target.value }))} /></label>
              <label className="block"><span className="block text-xs font-semibold text-slate-500 mb-1.5">To</span>
                <input type="date" className={`${fieldCls} w-44`} value={period.to} onChange={e => setPeriod(p => ({ ...p, to: e.target.value }))} /></label>
            </>
          )}
          <div className="text-sm text-slate-600 pb-2.5">{periodError ? <span className="text-rose-700" role="alert">{periodError}</span> : <>Showing <b className="text-slate-900">{periodLabel(start, end)}</b></>}</div>
        </div>
      </Card>

      {error && <div role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-center justify-between gap-3"><span>{error}</span><button type="button" onClick={() => void load()} className="font-bold underline">Retry</button></div>}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" aria-label="Summary">
        <StatCard label={mode === 'TEAM_LEAD' ? 'Team members' : 'People'} value={people.length} foot={roleFilter === 'ALL' && !teamFilter && !query ? 'in your scope' : 'matching the filters'} />
        <StatCard label="Tasks" value={totals.total} foot="due or assigned in the period" />
        <StatCard label="Completion" value={pctText(totals.completionPct)} tone={totals.completionPct === null ? 'neutral' : 'blue'} foot={`${totals.completed} completed`} />
        <StatCard label="On-time completion" value={pctText(totals.onTimePct)} tone={totals.onTimePct === null ? 'neutral' : totals.onTimePct >= 80 ? 'green' : 'amber'} foot={`${totals.onTime} on time · ${totals.late} late`} />
        <StatCard label="Overdue" value={totals.overdue} tone={totals.overdue ? 'red' : 'neutral'} foot="not completed, past deadline" />
      </div>

      <Tabs label="Performance views" value={view} onChange={setView} options={tabs} />

      {loading && !data ? <LoadingLine label="Loading performance figures…" /> : null}

      {data && view === 'people' && (
        <Card>
          <CardHead title={mode === 'TEAM_LEAD' ? 'Team members' : 'Team Leads and members'} hint="Live figures from the task records for the chosen period" />
          <div className="px-5 pb-4 flex flex-wrap gap-3">
            <label className="relative block flex-1 min-w-[12rem] max-w-sm"><span className="sr-only">Search by name</span>
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input className={`${fieldCls} pl-9`} placeholder="Search by name" value={query} onChange={e => setQuery(e.target.value)} /></label>
            {mode === 'DEPARTMENT_HEAD' && (
              <>
                <label className="block"><span className="sr-only">Team</span>
                  <select className={`${fieldCls} w-48`} value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
                    <option value="">All teams</option>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select></label>
                <label className="block"><span className="sr-only">Role</span>
                  <select className={`${fieldCls} w-44`} value={roleFilter} onChange={e => setRoleFilter(e.target.value as typeof roleFilter)}>
                    <option value="ALL">Leads and members</option>
                    <option value="Team Lead">Team Leads only</option>
                    <option value="Team Member">Members only</option>
                  </select></label>
              </>
            )}
          </div>
          {people.length === 0 ? (
            <p className="px-5 pb-8 text-sm text-slate-500">{data.people.length === 0 ? (mode === 'TEAM_LEAD' ? 'No team members are assigned to your team yet.' : 'No Team Leads or members in your department yet.') : 'Nobody matches these filters.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[44rem]">
                {head('Name')}
                <tbody className={loading ? 'opacity-60' : ''}>
                  {people.map(p => entryRow(p, <div className="text-xs text-slate-500 truncate">{[p.role, p.teamName].filter(Boolean).join(' · ')}</div>))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {data && view === 'teams' && (
        <Card>
          <CardHead title={mode === 'TEAM_LEAD' ? 'Your team' : 'Teams'} hint="Every task counted once: a task a Team Lead split between members is counted through the members" />
          {teams.length === 0 ? <p className="px-5 pb-8 text-sm text-slate-500">No team found.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[44rem]">
                {head('Team')}
                <tbody>{teams.map(t => entryRow(t, <div className="text-xs text-slate-500 truncate">{t.lead ? `Lead: ${t.lead} · ` : ''}{t.members} member{t.members === 1 ? '' : 's'}</div>))}</tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {data && view === 'department' && mode === 'DEPARTMENT_HEAD' && (
        <Card>
          <CardHead title="Department" hint="Overall task performance of the whole department" />
          {data.department ? (
            <div className="overflow-x-auto"><table className="w-full text-sm min-w-[44rem]">{head('Department')}<tbody>{entryRow(data.department, null)}</tbody></table></div>
          ) : <p className="px-5 pb-8 text-sm text-slate-500">No department found.</p>}
        </Card>
      )}
    </div>
  );
};
