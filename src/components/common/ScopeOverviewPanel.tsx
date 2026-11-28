import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { ScopeOverview } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { dashboardApi } from '../../lib/api/endpoints';
import { money } from '../accounts/finance/FinanceBits';
import { Avatar, Card, CardHead, ghostBtn, LoadingLine, StatCard } from '../tasks/head/headParts';
import { Paged } from './Paged';

/**
 * The customers, people and work of the signed-in Team Lead (their team) or Department Head (their department).
 * Every figure is worked out by the database from the real records and limited to the caller's scope there
 * (GET /dashboard/scope-overview): nothing here is calculated or invented in the browser.
 */
const num = (n: number) => new Intl.NumberFormat('en-IN').format(n);
const ago = (iso: string | null) => {
  if (!iso) return 'No activity yet';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)} days ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const ROLE_LABEL: Record<string, string> = { TEAM_HEAD: 'Team Lead', TEAM_MEMBER: 'Team Member' };

export function useScopeOverview() {
  const [data, setData] = useState<ScopeOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    dashboardApi.scope().then(
      d => {
        setData(d);
        setError(null);
        setLoading(false);
      },
      e => {
        setError(errorMessage(e));
        setLoading(false);
      }
    );
  }, []);
  useEffect(() => {
    load();
    const run = () => load();
    const onVisible = () => document.visibilityState === 'visible' && load();
    window.addEventListener('crm:pipeline-changed', run);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('crm:pipeline-changed', run);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);
  return { data, error, loading, reload: load };
}

export const ScopeOverviewPanel: React.FC<{ heading?: string; hint?: string }> = ({ heading = 'Customers and team', hint }) => {
  const { data, error, loading, reload } = useScopeOverview();
  const isLead = data?.scope.role === 'TEAM_HEAD';

  return (
    <section className="space-y-5" aria-label={heading}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">{heading}</h2>
          {hint && <p className="text-sm text-slate-500 mt-0.5">{hint}</p>}
        </div>
        <button type="button" className={ghostBtn} onClick={reload} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
        </button>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-sm text-rose-800 flex flex-wrap items-center gap-3">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-0">These figures could not be loaded: {error}</span>
          <button type="button" className={ghostBtn} onClick={reload}>
            Try again
          </button>
        </div>
      )}
      {!data && !error && <LoadingLine label="Loading…" />}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Customers and leads"
              value={num(data.customers.total - data.customers.lost)}
              foot={`${num(data.customers.leads)} leads · ${num(data.customers.potential)} potential · ${num(data.customers.onboarding)} onboarding · ${num(data.customers.customers)} customers`}
            />
            <StatCard
              label="Follow-ups overdue"
              value={num(data.pipeline.followUpsOverdue)}
              tone={data.pipeline.followUpsOverdue ? 'red' : 'neutral'}
              foot={`${num(data.pipeline.followUpsToday)} due today · ${num(data.pipeline.leadsWithoutFollowUp)} leads with none set`}
            />
            <StatCard
              label="With Accounts"
              value={num(data.money.pendingConfirmations)}
              tone={data.money.pendingConfirmations ? 'amber' : 'neutral'}
              foot={`${money(data.money.outstandingBalance)} balance due from ${num(data.money.customersWithBalance)} customer${data.money.customersWithBalance === 1 ? '' : 's'}`}
            />
            <StatCard
              label="Onboarding"
              value={num(data.onboarding.inProgress)}
              foot={`${num(data.onboarding.waitingForDepartmentHead)} waiting for the head · ${num(data.onboarding.waitingForTeamLead)} for a lead · ${num(data.onboarding.stalled)} stalled`}
            />
          </div>

          <Card label="People">
            <CardHead title={isLead ? 'Team workload' : 'People and workload'} hint="Customers each person owns, follow-ups past due and open tasks." />
            {data.members.length === 0 ? (
              <p className="px-5 pb-6 text-sm text-slate-500" role="status">No active team members in this scope yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[46rem]">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-y border-slate-100 bg-slate-50">
                      <th className="py-2.5 pl-5 pr-3 font-semibold">Person</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Leads</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Potential</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Onboarding</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Customers</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Follow-ups overdue</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Open tasks</th>
                      <th className="py-2.5 pl-3 pr-5 font-semibold">Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.members.map(m => (
                      <tr key={m.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 pl-5 pr-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={m.name} />
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 truncate">{m.name}</div>
                              <div className="text-xs text-slate-500 truncate">{ROLE_LABEL[m.role] ?? m.role} · {m.team}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">{num(m.leads)}</td>
                        <td className="py-3 px-3 text-right">{num(m.potential)}</td>
                        <td className="py-3 px-3 text-right">{num(m.onboarding)}</td>
                        <td className="py-3 px-3 text-right">{num(m.customers)}</td>
                        <td className={`py-3 px-3 text-right ${m.followUpsOverdue ? 'font-bold text-rose-700' : 'text-slate-500'}`}>{num(m.followUpsOverdue)}</td>
                        <td className="py-3 px-3 text-right">
                          {num(m.openTasks)}
                          {m.overdueTasks > 0 && <span className="block text-xs text-rose-700">{m.overdueTasks} overdue</span>}
                        </td>
                        <td className="py-3 pl-3 pr-5 text-slate-600 whitespace-nowrap">{ago(m.lastActivityAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {!isLead && data.teams.length > 1 && (
            <Card label="Teams">
              <CardHead title="Teams" hint="Customers per team in the department." />
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[32rem]">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-y border-slate-100 bg-slate-50">
                      <th className="py-2.5 pl-5 pr-3 font-semibold">Team</th>
                      <th className="py-2.5 px-3 font-semibold text-right">People</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Leads</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Onboarding</th>
                      <th className="py-2.5 pl-3 pr-5 font-semibold text-right">Customers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.teams.map(t => (
                      <tr key={t.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 pl-5 pr-3 font-bold text-slate-900">{t.name}</td>
                        <td className="py-3 px-3 text-right">{num(t.members)}</td>
                        <td className="py-3 px-3 text-right">{num(t.leads)}</td>
                        <td className="py-3 px-3 text-right">{num(t.onboarding)}</td>
                        <td className="py-3 pl-3 pr-5 text-right">{num(t.customers)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <section aria-label="Open work" className="space-y-3">
            <h3 className="text-base font-extrabold text-slate-900">Open work</h3>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              <Metric k="Open tasks" v={num(data.tasks.open)} />
              <Metric k="Overdue tasks" v={num(data.tasks.overdue)} alert={data.tasks.overdue > 0} />
              <Metric k="Blocked tasks" v={num(data.tasks.blocked)} alert={data.tasks.blocked > 0} />
              <Metric k="Completed in the last 7 days" v={num(data.tasks.completedThisWeek)} />
              <Metric k="Open tickets" v={num(data.tickets.open)} />
              <Metric k="Tickets past their SLA" v={num(data.tickets.pastSla)} alert={data.tickets.pastSla > 0} />
              <Metric k="New leads this week" v={num(data.pipeline.newLeadsThisWeek)} />
              <Metric k="Won this month" v={num(data.pipeline.wonThisMonth)} />
            </dl>
          </section>

          <section aria-label="Recent activity" className="space-y-3">
            <div>
              <h3 className="text-base font-extrabold text-slate-900">Recent activity</h3>
              <p className="text-[13px] text-slate-500 mt-0.5">The latest notes and updates logged on these customers.</p>
            </div>
            {data.recentActivity.length === 0 ? (
              <p className="p-5 rounded-2xl bg-white border border-slate-200 text-sm text-slate-500" role="status">No activity has been logged yet.</p>
            ) : (
              <Paged items={data.recentActivity} pageSize={5} noun="updates">{rows => (
              <ul className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {rows.map((a, i) => (
                  <li
                    key={`${a.at}-${i}`}
                    className="px-4 sm:px-5 py-3 grid gap-x-4 gap-y-0.5 grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,15rem)_minmax(0,12rem)_minmax(0,1fr)_6rem] md:items-baseline"
                  >
                    <span className="text-sm font-bold text-slate-900 truncate">{a.customer}</span>
                    <span className="text-xs text-slate-500 text-right md:text-right md:order-4 whitespace-nowrap">{ago(a.at)}</span>
                    <span className="col-span-2 md:col-span-1 md:order-2 text-xs text-slate-500 truncate">
                      {[a.type.toLowerCase().replace(/_/g, ' '), a.actor].filter(Boolean).join(' · ')}
                    </span>
                    {a.note ? (
                      <p className="col-span-2 md:col-span-1 md:order-3 text-[13px] text-slate-700 line-clamp-2 md:line-clamp-1 break-words" title={a.note}>{a.note}</p>
                    ) : (
                      <span className="hidden md:block md:order-3" />
                    )}
                  </li>
                ))}
              </ul>
              )}</Paged>
            )}
          </section>
        </>
      )}
    </section>
  );
};

/** One Open work figure: a compact block, with a quiet rose accent only while something needs attention. */
const Metric: React.FC<{ k: string; v: string; alert?: boolean }> = ({ k, v, alert }) => (
  <div className={`rounded-2xl border p-4 min-w-0 ${alert ? 'bg-rose-50/60 border-rose-200' : 'bg-white border-slate-200'}`}>
    <dt className="text-[13px] font-semibold text-slate-500 leading-snug min-h-[2.5em]">{k}</dt>
    <dd className={`mt-1 text-[28px] leading-none font-extrabold tabular-nums ${alert ? 'text-rose-700' : 'text-slate-900'}`}>{v}</dd>
  </div>
);
