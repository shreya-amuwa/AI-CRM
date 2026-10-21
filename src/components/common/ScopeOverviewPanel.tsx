import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { ScopeOverview } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { dashboardApi } from '../../lib/api/endpoints';
import { money } from '../accounts/finance/FinanceBits';
import { Avatar, Card, CardHead, ghostBtn, LoadingLine, StatCard } from '../tasks/head/headParts';

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

          {/* side by side whenever both fit (the sidebar drawer frees the full width below lg); stacked only on narrow screens */}
          <div className="grid grid-cols-1 min-[720px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-4 sm:gap-5 items-start">
            <Card label="Open work">
              <CardHead title="Open work" />
              <dl className="px-5 pb-5 text-sm space-y-1.5">
                <Row k="Open tasks" v={num(data.tasks.open)} />
                <Row k="Overdue tasks" v={num(data.tasks.overdue)} red={data.tasks.overdue > 0} />
                <Row k="Blocked tasks" v={num(data.tasks.blocked)} red={data.tasks.blocked > 0} />
                <Row k="Completed in the last 7 days" v={num(data.tasks.completedThisWeek)} />
                <Row k="Open tickets" v={num(data.tickets.open)} />
                <Row k="Tickets past their SLA" v={num(data.tickets.pastSla)} red={data.tickets.pastSla > 0} />
                <Row k="New leads this week" v={num(data.pipeline.newLeadsThisWeek)} />
                <Row k="Won this month" v={num(data.pipeline.wonThisMonth)} />
              </dl>
            </Card>
            <Card label="Recent activity">
              <CardHead title="Recent activity" hint="The latest notes and updates logged on these customers." />
              {data.recentActivity.length === 0 ? (
                <p className="px-5 pb-6 text-sm text-slate-500" role="status">No activity has been logged yet.</p>
              ) : (
                <ul className="px-3 pb-3 divide-y divide-slate-100">
                  {data.recentActivity.map((a, i) => (
                    <li key={`${a.at}-${i}`} className="px-2.5 py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-bold text-slate-900 truncate">{a.customer}</span>
                        <span className="text-xs text-slate-500 shrink-0">{ago(a.at)}</span>
                      </div>
                      <div className="text-xs text-slate-500">{[a.type.toLowerCase().replace(/_/g, ' '), a.actor].filter(Boolean).join(' · ')}</div>
                      {a.note && <p className="mt-0.5 text-[13px] text-slate-700 line-clamp-2">{a.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </section>
  );
};

const Row: React.FC<{ k: string; v: string; red?: boolean }> = ({ k, v, red }) => (
  <div className="flex items-baseline justify-between gap-4">
    <dt className="text-slate-600">{k}</dt>
    <dd className={`font-bold ${red ? 'text-rose-700' : 'text-slate-900'}`}>{v}</dd>
  </div>
);
