import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, ClipboardList, FileSignature, FileText, Hourglass, PlusCircle, Target, Users, AlarmClock, CheckCheck } from 'lucide-react';
import { BA_STAGE_LABELS, type BaHome } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { businessAssociateApi } from '../../lib/api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { PageTitle } from '../layout/shell';
import { ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { EmptyState, StatCard, dateText, dateTimeText, tcBtn } from '../telecaller/ui';
import type { BaNavigate } from './BusinessAssociateDashboard';
import { BA_CHANGED } from './ui';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** Home: live counts for the Business Associate, the next demos, recent activity and the quick actions. */
export const HomePage: React.FC<{ go: BaNavigate }> = ({ go }) => {
  const { profile } = useAuth();
  const [data, setData] = useState<BaHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const load = useCallback(() => {
    setError(null);
    businessAssociateApi.home().then(d => alive.current && setData(d), err => alive.current && setError(errorMessage(err)));
  }, []);
  useEffect(() => {
    alive.current = true;
    load();
    const onVisible = () => document.visibilityState === 'visible' && load();
    window.addEventListener(BA_CHANGED, load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false;
      window.removeEventListener(BA_CHANGED, load);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const first = (profile?.fullName || '').split(' ')[0];
  return (
    <div className="space-y-6">
      <PageTitle title={`${greeting()}${first ? `, ${first}` : ''}`} subtitle="Your contacts, quotations, demos and project scopes." />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data && !error && <Spinner label="Loading your day…" />}
      {data && (
        <>
          <section aria-label="Summary" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard label="Assigned Contacts" value={data.assignedContacts} icon={Users} tone="bg-blue-50 text-blue-600" hint={data.newContacts ? `${data.newContacts} new` : undefined} onClick={() => go('tasks')} />
            <StatCard label="Leads in Progress" value={data.leadsInProgress} icon={Target} tone="bg-indigo-50 text-indigo-600" onClick={() => go('leads')} />
            <StatCard label="Quotations Drafted" value={data.quotationsDrafted} icon={FileText} tone="bg-amber-50 text-amber-600" onClick={() => go('quotation')} />
            <StatCard label="Quotations Awaiting Review" value={data.quotationsAwaitingReview} icon={Hourglass} tone="bg-orange-50 text-orange-600" hint="AI drafts you have not reviewed" onClick={() => go('quotation')} />
            <StatCard label="Upcoming Demos" value={data.upcomingDemos} icon={CalendarClock} tone="bg-violet-50 text-violet-600" onClick={() => go('demos')} />
            <StatCard label="Scope Documents Generated" value={data.scopeDocumentsGenerated} icon={FileSignature} tone="bg-emerald-50 text-emerald-600" onClick={() => go('scope')} />
            <StatCard label="Follow-ups Due" value={data.followUpsDue} icon={AlarmClock} tone="bg-rose-50 text-rose-600" hint="Contacts and leads, today or overdue" onClick={() => go('tasks')} />
            <StatCard label="Completed Contacts" value={data.stageCounts.COMPLETED ?? 0} icon={CheckCheck} tone="bg-slate-100 text-slate-600" onClick={() => go('tasks', { stage: 'COMPLETED' })} />
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2 space-y-6">
              <section aria-labelledby="ba-upcoming" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <h2 id="ba-upcoming" className="px-5 py-4 border-b border-slate-100 text-base font-extrabold text-slate-900 flex items-center gap-2"><CalendarClock className="w-5 h-5 text-blue-600" aria-hidden="true" /> Upcoming demos</h2>
                {data.upcoming.length === 0 ? (
                  <EmptyState icon={CalendarClock} title="No demo is scheduled">Book a demo from a contact's page, or from Demo Schedule.</EmptyState>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {data.upcoming.map(d => (
                      <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900 truncate">{d.title} · {d.client}</div>
                          <div className="text-xs text-slate-500">{dateTimeText(d.startsAt)} · {d.mode === 'ONLINE' ? 'Online' : 'In person'}{d.location ? ` · ${d.location}` : ''}</div>
                        </div>
                        <button type="button" className={tcBtn.link} onClick={() => go('demos', { contactId: d.contactId })}>Open</button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section aria-labelledby="ba-recent" className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <h2 id="ba-recent" className="px-5 py-4 border-b border-slate-100 text-base font-extrabold text-slate-900">Recent activity</h2>
                {data.recent.length === 0 ? (
                  <EmptyState icon={ClipboardList} title="No activity yet">When a Telecaller hands a contact over, it appears here and in Tasks.</EmptyState>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {data.recent.map((e, i) => (
                      <li key={`${e.at}-${i}`} className="px-5 py-3 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <span className="font-semibold text-slate-900">{e.client}</span> <span className="text-slate-600">· {e.note}</span>
                          </div>
                          <button type="button" className={`${tcBtn.link} shrink-0`} onClick={() => go('tasks', { contactId: e.contactId })}>Open</button>
                        </div>
                        <div className="text-xs text-slate-400">{dateTimeText(e.at)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <div className="space-y-6 self-start">
              <section aria-labelledby="ba-quick" className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5 space-y-3">
                <h2 id="ba-quick" className="text-base font-extrabold text-slate-900">Quick actions</h2>
                <button type="button" className={`${tcBtn.primary} w-full justify-start`} onClick={() => go('tasks')}><ClipboardList className="w-4 h-4" aria-hidden="true" /> Open Tasks</button>
                <button type="button" className={`${tcBtn.secondary} w-full justify-start`} onClick={() => go('leads', { addLead: true })}><PlusCircle className="w-4 h-4 text-blue-600" aria-hidden="true" /> Add Lead</button>
                <button type="button" className={`${tcBtn.secondary} w-full justify-start`} onClick={() => go('quotation')}><FileText className="w-4 h-4 text-blue-600" aria-hidden="true" /> Generate Quotation</button>
                <button type="button" className={`${tcBtn.secondary} w-full justify-start`} onClick={() => go('demos', { newDemo: true })}><CalendarClock className="w-4 h-4 text-blue-600" aria-hidden="true" /> Schedule Demo</button>
                <button type="button" className={`${tcBtn.secondary} w-full justify-start`} onClick={() => go('scope')}><FileSignature className="w-4 h-4 text-blue-600" aria-hidden="true" /> Generate Scope of Project</button>
              </section>
              <section aria-labelledby="ba-stages" className="rounded-2xl border border-slate-200 bg-white shadow-sm p-5">
                <h2 id="ba-stages" className="text-base font-extrabold text-slate-900 mb-3">Where your contacts are</h2>
                <ul className="space-y-1.5 text-sm">
                  {(Object.keys(BA_STAGE_LABELS) as (keyof typeof BA_STAGE_LABELS)[]).map(s => (
                    <li key={s} className="flex items-center justify-between">
                      <button type="button" className="text-slate-600 hover:text-blue-700 text-left" onClick={() => go('tasks', { stage: s })}>{BA_STAGE_LABELS[s]}</button>
                      <span className="font-bold text-slate-900">{data.stageCounts[s] ?? 0}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[11px] text-slate-400">As of {dateText(data.today)}</p>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
