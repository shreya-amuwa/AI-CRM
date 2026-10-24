import React, { useCallback, useEffect, useState } from 'react';
import { Link2, RefreshCw } from 'lucide-react';
import { CALL_STATUS_LABELS, type CallStatus, type SalesOverview as Overview } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { salesHeadApi } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { Card, CardHead } from '../tasks/head/headParts';
import { ErrorBanner, Spinner, money } from '../team-member/pipeline/shared';
import { Avatar } from '../tasks/head/headParts';
import { EmptyState, StatCard, TemperatureBadge, dateText, dateTimeText, tcBtn, TEMPERATURE_DOT, TEMPERATURE_LABELS } from '../telecaller/ui';
import type { SalesHeadNavigate } from './SalesHeadDashboard';

const ACTIVITY_LABEL: Record<string, string> = { LEAD_CREATED: 'Lead added', LEAD_UPDATED: 'Lead updated', CUSTOMER_CREATED: 'Customer added', NOTE: 'Note' };
const activityLabel = (t: string) => ACTIVITY_LABEL[t] ?? t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, ' ');

/** Overview: the whole Sales department at a glance, counted by the database from the Sales teams' own records. */
export const SalesOverview: React.FC<{ go: SalesHeadNavigate }> = ({ go }) => {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    salesHeadApi.overview().then(setData, e => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  if (!data) return error ? <ErrorBanner message={error} onRetry={load} /> : <Spinner label="Loading the Sales overview…" />;
  const c = data.cards;
  const dist = data.statusDistribution;
  const totalTemp = Math.max(1, dist.temperature.HOT + dist.temperature.WARM + dist.temperature.COLD + dist.temperature.NONE);
  const calls = Object.entries(dist.callStatus);

  return (
    <div className="space-y-6">
      <PageTitle
        title="Sales overview"
        subtitle="Leads, tasks and team activity of the Sales department."
        actions={<button type="button" className={tcBtn.secondary} onClick={load}><RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh</button>}
      />
      {error && <ErrorBanner message={error} onRetry={load} />}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 [&>button]:h-full [&>button>div]:h-full [&>div]:h-full">
        <StatCard label="Total Leads" value={c.totalLeads} onClick={() => go('leads-list', { filter: 'ALL' })} />
        <StatCard label="Hot Leads" value={c.hot} tone="red" onClick={() => go('leads-list', { filter: 'HOT' })} />
        <StatCard label="Warm Leads" value={c.warm} tone="amber" onClick={() => go('leads-list', { filter: 'WARM' })} />
        <StatCard label="Cold Leads" value={c.cold} tone="blue" onClick={() => go('leads-list', { filter: 'COLD' })} />
        <StatCard label="Leads Assigned" value={c.assigned} onClick={() => go('leads-list', { filter: 'ASSIGNED' })} />
        <StatCard label="Pending Assignment" value={c.pendingAssignment} tone={c.pendingAssignment ? 'amber' : 'neutral'} hint="Enquiries nobody has taken" onClick={() => go('leads-list', { filter: 'UNASSIGNED' })} />
        <StatCard label="Team Members" value={c.teamMembers} onClick={() => go('team')} />
        <StatCard label="Tasks Pending" value={c.tasksPending} tone={c.tasksPending ? 'amber' : 'neutral'} onClick={() => go('tasks', { filter: 'PENDING' })} />
        <StatCard label="Tasks Completed" value={c.tasksCompleted} tone="green" onClick={() => go('tasks', { filter: 'COMPLETED' })} />
        <StatCard label="Follow-ups Due" value={c.followUpsDue} tone={c.followUpsDue ? 'red' : 'neutral'} hint="Today or earlier" onClick={() => go('leads-list', { filter: 'FOLLOW_UP' })} />
        <StatCard label="Converted Leads" value={c.converted} tone="green" onClick={() => go('leads-list', { filter: 'CONVERTED' })} />
        <StatCard label="Department Income" value={c.income === null ? 'Not available' : money(c.income)} hint={c.income === null ? 'Collected Sales payments appear here' : 'Collected, Sales side'} onClick={() => go('income')} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card className="xl:col-span-1">
          <CardHead title="Lead status distribution" hint="By temperature and call status" />
          <div className="px-5 pb-5 space-y-4">
            <div className="flex h-3 rounded-full overflow-hidden bg-slate-100" role="img" aria-label="Lead temperature split">
              {(['HOT', 'WARM', 'COLD'] as const).map(k => (
                <div key={k} className={TEMPERATURE_DOT[k]} style={{ width: `${(dist.temperature[k] / totalTemp) * 100}%` }} title={`${TEMPERATURE_LABELS[k]}: ${dist.temperature[k]}`} />
              ))}
            </div>
            <ul className="space-y-1.5 text-sm">
              {(['HOT', 'WARM', 'COLD'] as const).map(k => (
                <li key={k} className="flex items-center justify-between"><TemperatureBadge value={k} /><span className="font-bold text-slate-800">{dist.temperature[k]}</span></li>
              ))}
              <li className="flex items-center justify-between text-slate-500"><span>No temperature yet</span><span className="font-bold">{dist.temperature.NONE}</span></li>
            </ul>
            <div className="border-t border-slate-100 pt-3">
              <div className="text-xs font-semibold text-slate-500 mb-1.5">Call status</div>
              {calls.length === 0 ? <p className="text-sm text-slate-500">No leads yet.</p> : (
                <ul className="space-y-1 text-sm">
                  {calls.map(([k, n]) => <li key={k} className="flex justify-between"><span className="text-slate-600">{k === 'NONE' ? 'Not recorded' : CALL_STATUS_LABELS[k as CallStatus] ?? k}</span><span className="font-semibold text-slate-800">{n}</span></li>)}
                </ul>
              )}
            </div>
          </div>
        </Card>

        <Card className="xl:col-span-2 overflow-hidden">
          <CardHead title="Team activity summary" hint="Sales Team Leads and Team Members" />
          {data.teamActivity.length === 0 ? <EmptyState title="No Sales team members yet" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[36rem]">
                <thead><tr className="text-left text-[11px] text-slate-500 bg-slate-50/60">{['Person', 'Role', 'Leads', 'Contacted (7 days)', 'Open tasks', 'Done tasks'].map(h => <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.teamActivity.map(p => (
                    <tr key={p.id}>
                      <td className="px-4 py-2.5"><div className="flex items-center gap-2.5"><Avatar name={p.name} size={28} /><span className="font-semibold text-slate-900">{p.name}</span></div></td>
                      <td className="px-4 py-2.5 text-slate-600">{p.role} <span className="text-slate-400">· {p.team}</span></td>
                      <td className="px-4 py-2.5 font-semibold">{p.leads}</td><td className="px-4 py-2.5">{p.contacted7d}</td>
                      <td className="px-4 py-2.5">{p.tasksOpen}</td><td className="px-4 py-2.5">{p.tasksDone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHead title="Upcoming follow-ups" right={<button type="button" className={tcBtn.link} onClick={() => go('leads-list', { filter: 'FOLLOW_UP' })}>See all</button>} />
          {data.upcomingFollowUps.length === 0 ? <EmptyState title="No follow-ups scheduled" /> : (
            <ul className="divide-y divide-slate-100">
              {data.upcomingFollowUps.map(f => (
                <li key={f.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0"><div className="font-semibold text-slate-900 truncate">{f.name}</div><div className="text-xs text-slate-500 truncate">{f.company || 'No company'} · {f.assignee || 'Unassigned'}</div></div>
                  <div className="text-right shrink-0"><div className="text-xs font-semibold text-slate-700">{dateTimeText(f.followUp)}</div><TemperatureBadge value={f.temperature} /></div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHead title="Pending tasks" right={<button type="button" className={tcBtn.link} onClick={() => go('tasks')}>See all</button>} />
          {data.pendingTasks.length === 0 ? <EmptyState title="No pending tasks" /> : (
            <ul className="divide-y divide-slate-100">
              {data.pendingTasks.map(t => (
                <li key={t.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0"><div className="font-semibold text-slate-900 truncate">{t.title}</div><div className="text-xs text-slate-500">{t.assignee} · {t.priority.toLowerCase()} priority</div></div>
                  <span className={`shrink-0 inline-flex px-2.5 py-1 rounded-full text-xs font-bold ${t.overdue ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>{t.dueDate ? (t.overdue ? 'Overdue · ' : 'Due ') + dateText(t.dueDate) : 'No deadline'}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHead title="Recent Sales activities" />
          {data.recentActivities.length === 0 ? <EmptyState title="No activity yet" /> : (
            <ul className="divide-y divide-slate-100">
              {data.recentActivities.map((a, i) => (
                <li key={i} className="px-5 py-3 text-sm"><div className="flex justify-between gap-3"><span className="font-semibold text-slate-900">{activityLabel(a.type)} · {a.customer}</span><span className="text-xs text-slate-500 shrink-0">{dateTimeText(a.at)}</span></div>{a.note && <div className="text-xs text-slate-500 truncate">{a.note}</div>}</li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHead title="Recently assigned Excel sheets" right={<button type="button" className={tcBtn.link} onClick={() => go('leads-assign')}>Lead Assign</button>} />
          {data.recentSheets.length === 0 ? <EmptyState title="No sheets assigned yet" /> : (
            <ul className="divide-y divide-slate-100">
              {data.recentSheets.map(s => (
                <li key={s.id} className="px-5 py-3 flex items-center justify-between gap-3 text-sm"><div className="min-w-0"><div className="font-semibold text-slate-900 truncate flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />{s.fileName}</div><div className="text-xs text-slate-500">{s.valid} {s.mode === 'TELECALLER' ? 'contacts' : 'leads'} → {s.assignedTo}</div></div><span className="text-xs text-slate-500 shrink-0">{dateText(s.assignedAt)}</span></li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHead title="Recent lead conversions" />
          {data.recentConversions.length === 0 ? <EmptyState title="No conversions yet" /> : (
            <ul className="divide-y divide-slate-100">
              {data.recentConversions.map(c2 => (
                <li key={c2.id} className="px-5 py-3 flex items-center justify-between gap-3 text-sm"><div className="min-w-0"><div className="font-semibold text-slate-900 truncate">{c2.name}</div><div className="text-xs text-slate-500">{c2.company || 'No company'} · {c2.owner || '-'}</div></div><span className="text-xs text-slate-500 shrink-0">{c2.stage.charAt(0) + c2.stage.slice(1).toLowerCase()} · {dateText(c2.at)}</span></li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHead title="Team performance highlights" hint="Completed tasks and converted leads, as recorded" />
          {data.highlights.length === 0 ? <EmptyState title="Nothing to highlight yet" /> : (
            <ul className="divide-y divide-slate-100">
              {data.highlights.map(h => (
                <li key={h.id} className="px-5 py-3 flex items-center justify-between gap-3 text-sm"><div className="flex items-center gap-2.5"><Avatar name={h.name} size={28} /><span className="font-semibold text-slate-900">{h.name}</span></div><span className="text-xs text-slate-600">{h.tasksDone} tasks done · {h.converted} converted</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
};
