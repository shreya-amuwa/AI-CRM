import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlarmClock, ClipboardList, PlusCircle } from 'lucide-react';
import type { TelecallerHome } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { telecallerApi } from '../../lib/api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { PageTitle } from '../layout/shell';
import { Avatar, ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { Card, CardHead } from '../tasks/head/headParts';
import type { TelecallerNavigate } from './TelecallerDashboard';
import { EmptyState, StatCard, TELECALLER_CHANGED, dateText, tcBtn } from './ui';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** Home: the live counts, today's focus and the quick actions. Everything comes from the database. */
export const HomePage: React.FC<{ go: TelecallerNavigate }> = ({ go }) => {
  const { profile } = useAuth();
  const [data, setData] = useState<TelecallerHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  const load = useCallback(() => {
    setError(null);
    telecallerApi.home().then(
      d => alive.current && (setData(d), setLoading(false)),
      err => alive.current && (setError(errorMessage(err)), setLoading(false))
    );
  }, []);
  useEffect(() => {
    alive.current = true;
    load();
    // refresh when something changes in this tab, and when the tab comes back into view
    const onVisible = () => document.visibilityState === 'visible' && load();
    window.addEventListener(TELECALLER_CHANGED, load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false;
      window.removeEventListener(TELECALLER_CHANGED, load);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const first = (profile?.fullName || '').split(' ')[0];
  const followUps = data?.focus.followUps ?? [];
  const pending = data?.focus.pendingCalls ?? [];
  const nothing = !!data && followUps.length === 0 && pending.length === 0;

  return (
    <div className="space-y-6">
      <PageTitle title={`${greeting()}${first ? `, ${first}` : ''}`} subtitle="Your calls, follow-ups and leads for today." />

      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && !data && <Spinner label="Loading your day…" />}

      {data && (
        <>
          <section aria-label="Summary" className="grid grid-cols-2 xl:grid-cols-5 gap-4">
            <StatCard label="Total Assigned Contacts" value={data.totalAssigned} tone="blue" onClick={() => go('tasks')} />
            <StatCard label="Calls Pending" value={data.callsPending} tone="amber" onClick={() => go('tasks', { status: 'PENDING' })} />
            <StatCard label="Calls Completed" value={data.callsCompleted} tone="green" onClick={() => go('tasks')} />
            <StatCard label="Total Leads" value={data.totalLeads} tone="blue" hint={data.hotLeads ? `${data.hotLeads} hot` : undefined} onClick={() => go('leads')} />
            <StatCard
              label="Follow-ups Due Today"
              value={data.followUpsDueToday}
              tone="red"
              hint={data.followUpsOverdue ? `${data.followUpsOverdue} overdue` : undefined}
              onClick={() => go('tasks', { status: 'FOLLOW_UP_REQUIRED' })}
            />
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <Card className="xl:col-span-2" label="Today's Focus">
              <CardHead title="Today's Focus" hint={dateText(data.today)} />
              {nothing ? (
                <EmptyState title="Nothing waiting right now">
                  No follow-ups are due and no calls are pending. When the Department Head assigns you a contact sheet, your calls will show up here.
                </EmptyState>
              ) : (
                <div>
                  {followUps.length > 0 && (
                    <>
                      <div className="px-5 py-2 text-xs font-semibold text-slate-500 bg-slate-50 border-y border-slate-100">Follow-ups</div>
                      <ul className="divide-y divide-slate-100">
                        {followUps.map(f => (
                          <li key={`${f.kind}-${f.id}`} className="flex items-center gap-3 px-5 py-3">
                            <Avatar name={f.name} />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-slate-900 truncate">{f.name}{f.company ? <span className="font-normal text-slate-500"> · {f.company}</span> : null}</div>
                              <div className="text-xs text-slate-500">{f.kind === 'LEAD' ? 'Lead' : 'Contact'} · {f.overdue ? 'Overdue since' : 'Due'} {dateText(f.date)}</div>
                            </div>
                            {f.phone && <a href={`tel:${f.phone}`} className={tcBtn.link}>{f.phone}</a>}
                            <button type="button" className={tcBtn.row} onClick={() => go(f.kind === 'LEAD' ? 'leads' : 'tasks', f.kind === 'LEAD' ? undefined : { status: 'FOLLOW_UP_REQUIRED' })}>Open</button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {pending.length > 0 && (
                    <>
                      <div className="px-5 py-2 text-xs font-semibold text-slate-500 bg-slate-50 border-y border-slate-100">Next calls</div>
                      <ul className="divide-y divide-slate-100">
                        {pending.map(c => (
                          <li key={c.id} className="flex items-center gap-3 px-5 py-3">
                            <Avatar name={c.name} />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-slate-900 truncate">{c.name}{c.company ? <span className="font-normal text-slate-500"> · {c.company}</span> : null}</div>
                              <div className="text-xs text-slate-500">Assigned {dateText(c.assignedAt)}</div>
                            </div>
                            <a href={`tel:${c.phone}`} className={tcBtn.link}>{c.phone}</a>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </Card>

            <Card className="self-start" label="Quick actions">
              <CardHead title="Quick actions" />
              <div className="px-5 pb-5 space-y-2.5">
                <button type="button" className={`${tcBtn.primary} w-full`} onClick={() => go('tasks')}><ClipboardList className="w-4 h-4" aria-hidden="true" /> View Assigned Tasks</button>
                <button type="button" className={`${tcBtn.secondary} w-full`} onClick={() => go('leads', { addLead: true })}><PlusCircle className="w-4 h-4" aria-hidden="true" /> Add Lead</button>
                <button type="button" className={`${tcBtn.secondary} w-full`} onClick={() => go('tasks', { status: 'FOLLOW_UP_REQUIRED' })}><AlarmClock className="w-4 h-4" aria-hidden="true" /> View Follow-ups</button>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};
