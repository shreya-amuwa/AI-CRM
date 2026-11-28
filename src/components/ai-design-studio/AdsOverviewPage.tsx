import React from 'react';
import { Bell, ClipboardList, FileText, MessageSquareWarning, UserPlus } from 'lucide-react';
import type { AdsActivity } from '../../../shared/contracts';
import { ADS_ASSIGNMENT_STATUS_LABELS, ADS_ISSUE_STATUS_LABELS, ADS_NOTICE_CATEGORY_LABELS, ADS_NOTICE_STATUS_LABELS, ADS_REPORT_STATUS_LABELS } from '../../../shared/contracts';
import {
  aiDesignStudioApi, AssignmentStatusBadge, Badge, Card, CardHead, EmptyState, ErrorLine, EVENT_LABEL, fmtDate, fmtDateTime, ghostBtn, isHead, isLead, isMember, LoadingLine,
  NoticeStatusBadge, primaryBtn, PriorityBadge, ROLE_TITLE, StatCard, useAdsData, useAdsSession
} from './adsUi';
import { Paged } from '../common/Paged';

type Page = 'client-add' | 'client-notice' | 'assign' | 'report' | 'issue';

const STATUS_WORDS: Record<string, string> = {
  ...ADS_ASSIGNMENT_STATUS_LABELS, ...ADS_ISSUE_STATUS_LABELS, ...ADS_NOTICE_STATUS_LABELS, ...ADS_REPORT_STATUS_LABELS
};
const ENTITY_NOUN: Record<AdsActivity['entityType'], string> = { assignment: 'assignment', report: 'daily report', issue: 'issue', notice: 'client notice', client: 'client' };

/** The history event of the database in words: "Status changed to In Progress". */
function activityText(a: AdsActivity): string {
  if (a.event === 'STATUS' && a.toValue) return `Status changed to ${STATUS_WORDS[a.toValue] || a.toValue}`;
  return EVENT_LABEL[a.event] || a.event;
}

export const AdsOverviewPage: React.FC<{ onNavigate: (page: Page) => void }> = ({ onNavigate }) => {
  const { ctx, people } = useAdsSession();
  const { data, loading, error, reload } = useAdsData(() => aiDesignStudioApi.overview(), []);

  const reportsLabel = isMember(ctx) ? 'Reports returned to you' : 'Reports waiting for your decision';
  const leads = people.filter(p => p.role === 'TEAM_HEAD');
  const members = people.filter(p => p.role === 'TEAM_MEMBER');
  const unassigned = members.filter(p => !p.hasLead);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 font-heading">Hello, {ctx.name}</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          AI Design Studio · {ROLE_TITLE[ctx.role]}
          {isMember(ctx) && (ctx.leadName ? ` · Team Lead: ${ctx.leadName}` : '')}
        </p>
        {isMember(ctx) && ctx.unassigned && (
          <div role="note" className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
            No Team Lead assigned yet — your reports and issues go straight to the Department Head.
          </div>
        )}
      </div>

      <ErrorLine message={error} onRetry={reload} />
      {loading && !data ? <LoadingLine label="Loading your overview…" /> : null}

      {data && (
        <>
          <section aria-label="Figures" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Assigned clients" value={data.clients} foot={data.clients === 0 ? 'No clients yet' : undefined} testId="ads-stat-clients" />
            <StatCard label="Assignments" value={data.assignments.total} foot={data.assignments.total === 0 ? 'Nothing assigned yet' : undefined} testId="ads-stat-total" />
            <StatCard label="Ongoing" value={data.assignments.ongoing} tone="blue" testId="ads-stat-ongoing" />
            <StatCard label="Pending" value={data.assignments.pending} tone="amber" foot="Assigned, in review or sent back" testId="ads-stat-pending" />
            <StatCard label="Completed" value={data.assignments.completed} tone="green" testId="ads-stat-completed" />
            <StatCard label="Overdue" value={data.assignments.overdue} tone={data.assignments.overdue > 0 ? 'red' : 'neutral'} testId="ads-stat-overdue" />
            <StatCard label="Open issues" value={data.openIssues} tone={data.openIssues > 0 ? 'amber' : 'neutral'} testId="ads-stat-issues" />
            <StatCard label={reportsLabel} value={data.pendingReports} tone={data.pendingReports > 0 ? 'amber' : 'neutral'} testId="ads-stat-reports" />
          </section>

          {data.reportToday !== null && (
            <Card label="Today's report" className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-extrabold text-slate-900">Today's report</h2>
                  <p className="text-[13px] text-slate-500 mt-0.5">{data.reportToday ? 'You have submitted a report today.' : 'Not submitted yet'}</p>
                </div>
                {!data.reportToday && <button type="button" className={primaryBtn} onClick={() => onNavigate('report')}><FileText className="w-4 h-4" aria-hidden="true" /> Write today's report</button>}
              </div>
            </Card>
          )}

          <div className="flex flex-wrap gap-2" aria-label="Quick actions">
            <button type="button" className={ghostBtn} onClick={() => onNavigate('assign')}><ClipboardList className="w-4 h-4" aria-hidden="true" /> Assignments</button>
            <button type="button" className={ghostBtn} onClick={() => onNavigate('client-add')}><UserPlus className="w-4 h-4" aria-hidden="true" /> Add a client</button>
            <button type="button" className={ghostBtn} onClick={() => onNavigate('report')}><FileText className="w-4 h-4" aria-hidden="true" /> Reports</button>
            <button type="button" className={ghostBtn} onClick={() => onNavigate('issue')}><MessageSquareWarning className="w-4 h-4" aria-hidden="true" /> Issues</button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Card label="Upcoming deadlines">
              <CardHead title="Upcoming deadlines" hint="The next due dates of your open work" />
              <div className="px-5 pb-5">
                {data.upcoming.length === 0 ? <EmptyState title="No upcoming deadlines" hint="Open work with a deadline appears here." /> : (
                  <ul className="divide-y divide-slate-100">
                    {data.upcoming.map(a => (
                      <li key={a.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 truncate">{a.title}</div>
                          <div className="text-xs text-slate-500">{a.clientName || 'No client'} · {a.assigneeName || '–'}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-slate-700">{fmtDate(a.dueDate)}</span>
                          <PriorityBadge priority={a.priority} />
                          <AssignmentStatusBadge status={a.status} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            <Card label="Recent client notices">
              <CardHead title="Recent client notices" right={<button type="button" className={`${ghostBtn} !h-9 !text-[13px]`} onClick={() => onNavigate('client-notice')}><Bell className="w-4 h-4" aria-hidden="true" /> All notices</button>} />
              <div className="px-5 pb-5">
                {data.notices.length === 0 ? <EmptyState title="No open client notices" /> : (
                  <ul className="divide-y divide-slate-100">
                    {data.notices.map(n => (
                      <li key={n.id} className="py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-slate-900">{n.title}</div>
                          <div className="flex items-center gap-2"><PriorityBadge priority={n.priority} /><NoticeStatusBadge status={n.status} /></div>
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{n.clientName || 'Client'} · {ADS_NOTICE_CATEGORY_LABELS[n.category]} · {n.createdByName || 'Someone'} · {fmtDate(n.createdAt)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>

            <Card label="Recent activity" className="xl:col-span-2">
              <CardHead title="Recent activity" hint="What changed lately in your work" />
              <div className="px-5 pb-5">
                {data.activity.length === 0 ? <EmptyState title="No activity yet" /> : (
                  <Paged items={data.activity} pageSize={5} noun="updates">{rows => (
                  <ul className="divide-y divide-slate-100">
                    {rows.map(a => (
                      <li key={a.id} className="py-2.5 text-sm">
                        <span className="font-semibold text-slate-900">{a.actorName || 'Someone'}</span>{' '}
                        <span className="text-slate-700">· {activityText(a)} · {ENTITY_NOUN[a.entityType]}{a.title ? ` “${a.title}”` : ''}</span>
                        <div className="text-xs text-slate-500">{fmtDateTime(a.createdAt)}</div>
                      </li>
                    ))}
                  </ul>
                  )}</Paged>
                )}
              </div>
            </Card>

            {isLead(ctx) && (
              <Card label="My team" className="xl:col-span-2">
                <CardHead title="My team" hint="Team Members who report to you" />
                <div className="px-5 pb-5">
                  {members.length === 0 ? <EmptyState title="No Team Members are assigned to you yet" hint="The Department Head names the Team Members who work under you." /> : (
                    <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {members.map(m => <li key={m.id} className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800">{m.name}</li>)}
                    </ul>
                  )}
                </div>
              </Card>
            )}

            {isHead(ctx) && (
              <Card label="Team" className="xl:col-span-2">
                <CardHead title="Team" hint="Team Leads and the Team Members who work under them" />
                <div className="px-5 pb-5 space-y-4">
                  {unassigned.length > 0 && (
                    <div role="note" className="p-3 rounded-xl bg-amber-50 border border-amber-200">
                      <div className="text-sm font-bold text-amber-900">Team Members with no Team Lead yet</div>
                      <p className="text-[13px] text-amber-800 mt-0.5">Their work, reports and issues go directly to you until a Team Lead is named.</p>
                      <ul className="mt-2 flex flex-wrap gap-2">{unassigned.map(m => <li key={m.id}><Badge tone="amber">{m.name}</Badge></li>)}</ul>
                    </div>
                  )}
                  {leads.length === 0 && members.length === 0 ? <EmptyState title="No Team Leads or Team Members yet" /> : null}
                  {leads.length > 0 && (
                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {leads.map(l => {
                        const own = members.filter(m => m.leadId === l.id);
                        return (
                          <li key={l.id} className="p-3 rounded-xl border border-slate-200">
                            <div className="text-sm font-bold text-slate-900">{l.name} <span className="text-xs font-semibold text-slate-500">· Team Lead</span></div>
                            <div className="text-xs text-slate-500 mt-1">{own.length ? own.map(m => m.name).join(', ') : 'No Team Members yet'}</div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
};
