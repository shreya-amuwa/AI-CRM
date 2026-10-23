import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlarmClock, CalendarClock, CheckCircle2, ClipboardList, Flame, PhoneCall, PhoneIncoming, PlusCircle, Target, Users } from 'lucide-react';
import type { TelecallerHome } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { telecallerApi } from '../../lib/api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { PageTitle } from '../layout/shell';
import { ErrorBanner, Spinner } from '../team-member/pipeline/shared';
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
          <section aria-label="Summary" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <StatCard label="Total Assigned Contacts" value={data.totalAssigned} icon={Users} tone="bg-blue-50 text-blue-600" onClick={() => go('tasks')} />
            <StatCard label="Calls Pending" value={data.callsPending} icon={PhoneIncoming} tone="bg-amber-50 text-amber-600" onClick={() => go('tasks', { status: 'PENDING' })} />
            <StatCard label="Calls Completed" value={data.callsCompleted} icon={CheckCircle2} tone="bg-emerald-50 text-emerald-600" onClick={() => go('tasks')} />
            <StatCard label="Total Leads" value={data.totalLeads} icon={Target} tone="bg-indigo-50 text-indigo-600" hint={data.hotLeads ? `${data.hotLeads} hot` : undefined} onClick={() => go('leads')} />
            <StatCard
              label="Follow-ups Due Today"
              value={data.followUpsDueToday}
              icon={AlarmClock}
              tone="bg-rose-50 text-rose-600"
              hint={data.followUpsOverdue ? `${data.followUpsOverdue} overdue` : undefined}
              onClick={() => go('tasks', { status: 'FOLLOW_UP_REQUIRED' })}
            />
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <section aria-labelledby="focus-title" className="xl:col-span-2 rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-blue-600" aria-hidden="true" />
                <h2 id="focus-title" className="text-base font-extrabold text-slate-900">Today&apos;s Focus</h2>
                <span className="ml-auto text-xs text-slate-500">{dateText(data.today)}</span>
              </div>
              {nothing ? (
                <EmptyState icon={PhoneCall} title="Nothing waiting right now">
                  No follow-ups are due and no calls are pending. When the Department Head assigns you a contact sheet, your calls will show up here.
                </EmptyState>
              ) : (
                <div className="divide-y divide-slate-100">
                  {followUps.length > 0 && (
                    <div className="px-5 py-3">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Follow-ups</h3>
                      <ul className="space-y-1.5">
                        {followUps.map(f => (
                          <li key={`${f.kind}-${f.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${f.overdue ? 'bg-rose-500' : 'bg-amber-500'}`} aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-slate-900 truncate">{f.name}{f.company ? <span className="font-normal text-slate-500"> · {f.company}</span> : null}</div>
                              <div className="text-xs text-slate-500">{f.kind === 'LEAD' ? 'Lead' : 'Contact'} · {f.overdue ? 'Overdue since' : 'Due'} {dateText(f.date)}</div>
                            </div>
                            {f.phone && <a href={`tel:${f.phone}`} className={tcBtn.link}>{f.phone}</a>}
                            <button type="button" className={tcBtn.link} onClick={() => go(f.kind === 'LEAD' ? 'leads' : 'tasks', f.kind === 'LEAD' ? undefined : { status: 'FOLLOW_UP_REQUIRED' })}>Open</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {pending.length > 0 && (
                    <div className="px-5 py-3">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">Next calls</h3>
                      <ul className="space-y-1.5">
                        {pending.map(c => (
                          <li key={c.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50">
                            <PhoneCall className="w-4 h-4 text-blue-500 shrink-0" aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-slate-900 truncate">{c.name}{c.company ? <span className="font-normal text-slate-500"> · {c.company}</span> : null}</div>
                              <div className="text-xs text-slate-500">Assigned {dateText(c.assignedAt)}</div>
                            </div>
                            <a href={`tel:${c.phone}`} className={tcBtn.link}>{c.phone}</a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section aria-labelledby="quick-title" className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-3 self-start">
              <h2 id="quick-title" className="text-base font-extrabold text-slate-900 flex items-center gap-2"><Flame className="w-5 h-5 text-blue-600" aria-hidden="true" /> Quick actions</h2>
              <button type="button" className={`${tcBtn.primary} w-full justify-start`} onClick={() => go('tasks')}><ClipboardList className="w-4 h-4" aria-hidden="true" /> View Assigned Tasks</button>
              <button type="button" className={`${tcBtn.secondary} w-full justify-start`} onClick={() => go('leads', { addLead: true })}><PlusCircle className="w-4 h-4 text-blue-600" aria-hidden="true" /> Add Lead</button>
              <button type="button" className={`${tcBtn.secondary} w-full justify-start`} onClick={() => go('tasks', { status: 'FOLLOW_UP_REQUIRED' })}><AlarmClock className="w-4 h-4 text-blue-600" aria-hidden="true" /> View Follow-ups</button>
            </section>
          </div>
        </>
      )}
    </div>
  );
};
