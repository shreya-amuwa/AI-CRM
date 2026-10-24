import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import type { SalesReport, SalesReportRow } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { salesHeadApi } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { Card, CardHead } from '../tasks/head/headParts';
import { ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { EmptyState, tcBtn, tcSelect } from '../telecaller/ui';
import { PeriodBar, lastDays, type Range } from './periodBar';

const COLS_COMMON: { key: keyof SalesReportRow; label: string }[] = [
  { key: 'leadsAssigned', label: 'Leads assigned' }, { key: 'leadsContacted', label: 'Leads contacted' }, { key: 'hot', label: 'Hot' }, { key: 'warm', label: 'Warm' }, { key: 'cold', label: 'Cold' },
  { key: 'followUps', label: 'Follow-ups' }, { key: 'conversions', label: 'Conversions' }, { key: 'tasksAssigned', label: 'Tasks assigned' }, { key: 'tasksCompleted', label: 'Tasks completed' },
  { key: 'tasksPending', label: 'Tasks pending' }, { key: 'tasksOverdue', label: 'Overdue' }
];

const csv = (rows: SalesReportRow[], who: SalesReport['who']) => {
  const head = [who === 'TEAM_LEAD' ? 'Team Lead' : 'Team Member', 'Team', ...(who === 'TEAM_LEAD' ? ['Members'] : []), ...COLS_COMMON.map(c => c.label)];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [head, ...rows.map(r => [r.name, r.team, ...(who === 'TEAM_LEAD' ? [r.members ?? ''] : []), ...COLS_COMMON.map(c => r[c.key] as number)])].map(l => l.map(esc).join(',')).join('\n');
};

/** Reports: per Team Lead (their team) or per Team Member, for a period, from the leads and tasks of the Sales teams. */
export const SalesReports: React.FC = () => {
  const [who, setWho] = useState<'TEAM_LEAD' | 'TEAM_MEMBER'>('TEAM_MEMBER');
  const [range, setRange] = useState<Range>(lastDays(30));
  const [taskStatus, setTaskStatus] = useState('');
  const [data, setData] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    salesHeadApi.reports({ who, from: range.from, to: range.to, taskStatus: taskStatus || undefined }).then(
      d => (setData(d), setLoading(false)),
      e => (setError(errorMessage(e)), setLoading(false))
    );
  }, [who, range, taskStatus]);
  useEffect(load, [load]);

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of COLS_COMMON) t[c.key] = (data?.rows ?? []).reduce((n, r) => n + (r[c.key] as number), 0);
    return t;
  }, [data]);
  // the table follows what was loaded, never the dropdown that is still being answered
  const kind = data?.who ?? who;
  const maxLeads = Math.max(1, ...(data?.rows ?? []).map(r => r.leadsAssigned));

  const download = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([csv(data.rows, data.who)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-${who === 'TEAM_LEAD' ? 'team-lead' : 'team-member'}-report-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <PageTitle title="Reports" subtitle="Work and results of the Sales teams, counted from their leads and tasks." actions={<button type="button" className={tcBtn.secondary} onClick={download} disabled={!data || data.rows.length === 0}><Download className="w-4 h-4" aria-hidden="true" /> Export CSV</button>} />
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="text-xs font-semibold text-slate-700">Report for
            <select id="sr-who" className={`${tcSelect} mt-1 block h-11`} value={who} onChange={e => setWho(e.target.value as typeof who)} aria-label="Report for">
              <option value="TEAM_LEAD">Team Lead</option>
              <option value="TEAM_MEMBER">Team Member</option>
            </select>
          </label>
          <PeriodBar value={range} onChange={setRange} extra={
            <label className="text-xs font-semibold text-slate-700">Task status
              <select className={`${tcSelect} mt-1 block h-11`} value={taskStatus} onChange={e => setTaskStatus(e.target.value)} aria-label="Task status">
                <option value="">All tasks</option><option value="PENDING">Pending</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option><option value="OVERDUE">Overdue</option>
              </select>
            </label>
          } />
        </div>
      </Card>
      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && !data ? <Spinner label="Loading the report…" /> : !data || data.rows.length === 0 ? (
        <Card><EmptyState title={who === 'TEAM_LEAD' ? 'No Sales Team Leads yet' : 'No Sales Team Members yet'}>Add people in Team Members &amp; Access to see their reports.</EmptyState></Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <CardHead title={kind === 'TEAM_LEAD' ? 'Team Lead report' : 'Team Member report'} hint={`Tasks counted by deadline from ${range.from} to ${range.to}. Lead figures follow the person's current leads; "assigned" and "contacted" are counted inside the period.`} />
            <div className="overflow-x-auto" aria-busy={loading}>
              <table className="w-full text-left text-sm min-w-[1100px]">
                <thead><tr className="text-left text-[11px] text-slate-500 bg-slate-50/60"><th className="px-4 py-2.5 font-medium">{kind === 'TEAM_LEAD' ? 'Team Lead' : 'Team Member'}</th>{kind === 'TEAM_LEAD' && <th className="px-4 py-2.5 font-medium">Members</th>}{COLS_COMMON.map(c => <th key={c.key} className="px-3 py-2.5 font-medium whitespace-nowrap">{c.label}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2.5"><div className="font-semibold text-slate-900">{r.name}</div><div className="text-xs text-slate-500">{r.team}</div></td>
                      {kind === 'TEAM_LEAD' && <td className="px-4 py-2.5">{r.members}</td>}
                      {COLS_COMMON.map(c => <td key={c.key} className={`px-3 py-2.5 ${c.key === 'tasksOverdue' && (r[c.key] as number) > 0 ? 'font-bold text-rose-700' : ''}`}>{r[c.key] as number}</td>)}
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-bold text-slate-900"><td className="px-4 py-2.5">Total</td>{kind === 'TEAM_LEAD' && <td className="px-4 py-2.5" />}{COLS_COMMON.map(c => <td key={c.key} className="px-3 py-2.5">{totals[c.key]}</td>)}</tr>
                </tbody>
              </table>
            </div>
          </Card>
          <Card>
            <CardHead title="Leads and conversions" hint="Each bar is the person's leads assigned; the green part is converted" />
            <ul className="px-5 pb-5 space-y-2.5">
              {data.rows.map(r => (
                <li key={r.id} className="grid grid-cols-[10rem_1fr_6rem] items-center gap-3 text-sm">
                  <span className="truncate font-medium text-slate-800">{r.name}</span>
                  <div className="h-3 rounded-full bg-slate-100 overflow-hidden" role="img" aria-label={`${r.name}: ${r.leadsAssigned} leads, ${r.conversions} converted`}>
                    <div className="h-full bg-blue-200 relative" style={{ width: `${(r.leadsAssigned / maxLeads) * 100}%` }}><div className="absolute inset-y-0 left-0 bg-emerald-500" style={{ width: r.leadsAssigned ? `${Math.min(100, (r.conversions / r.leadsAssigned) * 100)}%` : 0 }} /></div>
                  </div>
                  <span className="text-xs text-slate-600 text-right">{r.leadsAssigned} · {r.conversions} won</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
};
