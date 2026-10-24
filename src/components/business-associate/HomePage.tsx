import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, ClipboardList, FileSignature, FileText, PlusCircle } from 'lucide-react';
import { BA_STAGE_LABELS, type BaHome } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { businessAssociateApi } from '../../lib/api/endpoints';
import { useAuth } from '../../context/AuthContext';
import { PageTitle } from '../layout/shell';
import { Avatar, ErrorBanner, Spinner } from '../team-member/pipeline/shared';
import { Card, CardHead } from '../tasks/head/headParts';
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
          <section aria-label="Summary" className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <StatCard label="Assigned Contacts" value={data.assignedContacts} tone="blue" hint={data.newContacts ? `${data.newContacts} new` : undefined} onClick={() => go('tasks')} />
            <StatCard label="Leads in Progress" value={data.leadsInProgress} tone="blue" onClick={() => go('leads')} />
            <StatCard label="Quotations Drafted" value={data.quotationsDrafted} tone="amber" onClick={() => go('quotation')} />
            <StatCard label="Quotations Awaiting Review" value={data.quotationsAwaitingReview} tone="amber" hint="AI drafts you have not reviewed" onClick={() => go('quotation')} />
            <StatCard label="Upcoming Demos" value={data.upcomingDemos} tone="blue" onClick={() => go('demos')} />
            <StatCard label="Scope Documents Generated" value={data.scopeDocumentsGenerated} tone="green" onClick={() => go('scope')} />
            <StatCard label="Follow-ups Due" value={data.followUpsDue} tone="red" hint="Contacts and leads, today or overdue" onClick={() => go('tasks')} />
            <StatCard label="Completed Contacts" value={data.stageCounts.COMPLETED ?? 0} tone="neutral" onClick={() => go('tasks', { stage: 'COMPLETED' })} />
          </section>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 space-y-4">
              <Card label="Upcoming demos">
                <CardHead title="Upcoming demos" />
                {data.upcoming.length === 0 ? (
                  <EmptyState title="No demo is scheduled">Book a demo from a contact's page, or from Demo Schedule.</EmptyState>
                ) : (
                  <ul className="divide-y divide-slate-100 border-t border-slate-100">
                    {data.upcoming.map(d => (
                      <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                        <Avatar name={d.client || d.title} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900 truncate">{d.title} · {d.client}</div>
                          <div className="text-xs text-slate-500">{dateTimeText(d.startsAt)} · {d.mode === 'ONLINE' ? 'Online' : 'In person'}{d.location ? ` · ${d.location}` : ''}</div>
                        </div>
                        <button type="button" className={tcBtn.row} onClick={() => go('demos', { contactId: d.contactId })}>Open</button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card label="Recent activity">
                <CardHead title="Recent activity" hint="The latest hand-overs and updates on your contacts." />
                {data.recent.length === 0 ? (
                  <EmptyState title="No activity yet">When a Telecaller hands a contact over, it appears here and in Tasks.</EmptyState>
                ) : (
                  <ul className="divide-y divide-slate-100 border-t border-slate-100">
                    {data.recent.map((e, i) => (
                      <li key={`${e.at}-${i}`} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                        <div className="min-w-0">
                          <span className="font-semibold text-slate-900">{e.client}</span> <span className="text-slate-600">· {e.note}</span>
                          <div className="text-xs text-slate-400">{dateTimeText(e.at)}</div>
                        </div>
                        <button type="button" className={`${tcBtn.row} shrink-0`} onClick={() => go('tasks', { contactId: e.contactId })}>Open</button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <div className="space-y-4 self-start">
              <Card label="Quick actions">
                <CardHead title="Quick actions" />
                <div className="px-5 pb-5 space-y-2.5">
                  <button type="button" className={`${tcBtn.primary} w-full`} onClick={() => go('tasks')}><ClipboardList className="w-4 h-4" aria-hidden="true" /> Open Tasks</button>
                  <button type="button" className={`${tcBtn.secondary} w-full`} onClick={() => go('leads', { addLead: true })}><PlusCircle className="w-4 h-4" aria-hidden="true" /> Add Lead</button>
                  <button type="button" className={`${tcBtn.secondary} w-full`} onClick={() => go('quotation')}><FileText className="w-4 h-4" aria-hidden="true" /> Generate Quotation</button>
                  <button type="button" className={`${tcBtn.secondary} w-full`} onClick={() => go('demos', { newDemo: true })}><CalendarClock className="w-4 h-4" aria-hidden="true" /> Schedule Demo</button>
                  <button type="button" className={`${tcBtn.secondary} w-full`} onClick={() => go('scope')}><FileSignature className="w-4 h-4" aria-hidden="true" /> Generate Scope of Project</button>
                </div>
              </Card>
              <Card label="Where your contacts are">
                <CardHead title="Where your contacts are" hint={`As of ${dateText(data.today)}`} />
                <ul className="px-5 pb-5 space-y-2 text-sm">
                  {(Object.keys(BA_STAGE_LABELS) as (keyof typeof BA_STAGE_LABELS)[]).map(s => (
                    <li key={s} className="flex items-center justify-between">
                      <button type="button" className="text-slate-600 hover:text-blue-700 text-left" onClick={() => go('tasks', { stage: s })}>{BA_STAGE_LABELS[s]}</button>
                      <span className="font-bold text-slate-900">{data.stageCounts[s] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
