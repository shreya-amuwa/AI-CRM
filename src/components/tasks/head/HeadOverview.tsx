import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, Headset, MessageSquareWarning, UserCheck } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { pipelineApi } from '../../../lib/api/endpoints';
import { isTicketOpen, useTickets } from '../../../lib/support';
import { isDirectMemberTask, isOverdue, localDateKey, summarize, type WorkTaskData } from '../../../lib/workTasks';
import { fmtDate } from '../TaskParts';
import { Avatar, Card, CardHead, healthOf, HealthBadge, LoadingLine, primaryBtn, ghostBtn, StatCard } from './headParts';
import { dayLabelsOfWeek } from './weekChart';

export type HeadPage = 'overview' | 'assign' | 'reports' | 'daily' | 'activity' | 'clients' | 'customers' | 'import' | 'support' | 'notices' | 'team' | 'notifications' | 'payments' | 'plans';

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

/** Customers the Technical Consultant has handed to this department that still wait for a Team Lead. */
export function useWaitingForLead(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    pipelineApi
      .list({ stage: 'ONBOARDING', handover: 'DEPARTMENT_HEAD', page: 1, pageSize: 1 })
      .then(r => live && setCount(r.total))
      .catch(() => live && setCount(null));
    return () => {
      live = false;
    };
  }, []);
  return count;
}

interface Attention {
  id: string;
  title: string;
  sub: string;
  icon: React.ElementType;
  tone: string;
  go: HeadPage;
}

export const HeadOverview: React.FC<{ data: WorkTaskData; go: (p: HeadPage) => void }> = ({ data, go }) => {
  const { user, profile } = useAuth();
  const waiting = useWaitingForLead();
  const tickets = useTickets();

  const mine = data.tasks.filter(t => t.parentId === null && t.assignedBy === profile?.id);
  const leadTasks = data.tasks.filter(t => t.parentId === null && !isDirectMemberTask(t, data.people));
  const s = summarize(leadTasks);
  const today = localDateKey();
  const updatesToday = data.updates.filter(u => localDateKey(new Date(u.createdAt)) === today).length;

  const week = useMemo(() => dayLabelsOfWeek(), []);
  const bars = week.map(d => ({
    ...d,
    due: data.tasks.filter(t => t.dueDate === d.key).length,
    done: data.tasks.filter(t => t.completedAt && localDateKey(new Date(t.completedAt)) === d.key).length
  }));
  const maxBar = Math.max(1, ...bars.map(b => Math.max(b.due, b.done)));
  const weekDone = bars.reduce((n, b) => n + b.done, 0);

  const escalated = tickets.tickets.filter(t => isTicketOpen(t.status) && t.escalationLevel === 'DH').length;
  const unassigned = tickets.tickets.filter(t => isTicketOpen(t.status) && !t.assigneeId).length;
  const overdueTasks = data.tasks.filter(isOverdue);

  const attention: Attention[] = [];
  if (waiting) attention.push({ id: 'wait', title: `${waiting} customer${waiting === 1 ? '' : 's'} waiting for a team lead`, sub: 'Handed over by the Technical Consultant', icon: UserCheck, tone: 'bg-amber-50 text-amber-700', go: 'clients' });
  if (overdueTasks.length) attention.push({ id: 'over', title: `${overdueTasks.length} task${overdueTasks.length === 1 ? ' is' : 's are'} overdue`, sub: `Oldest due ${fmtDate([...overdueTasks].sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))[0].dueDate)}`, icon: AlertTriangle, tone: 'bg-rose-50 text-rose-700', go: 'assign' });
  if (escalated) attention.push({ id: 'esc', title: `${escalated} ticket${escalated === 1 ? '' : 's'} escalated to you`, sub: 'Open for your reply', icon: MessageSquareWarning, tone: 'bg-rose-50 text-rose-700', go: 'support' });
  if (unassigned) attention.push({ id: 'una', title: `${unassigned} open ticket${unassigned === 1 ? '' : 's'} with nobody assigned`, sub: 'Customers are waiting for a reply', icon: Headset, tone: 'bg-amber-50 text-amber-700', go: 'support' });
  if (updatesToday) attention.push({ id: 'upd', title: `${updatesToday} task update${updatesToday === 1 ? '' : 's'} today`, sub: 'From team leads and members', icon: ChevronRight, tone: 'bg-blue-50 text-blue-700', go: 'daily' });

  const leads = data.people.filter(p => p.role === 'TEAM_HEAD' && p.status === 'ACTIVE' && p.departmentId === profile?.departmentId);
  const rows = leads.map(l => {
    const own = mine.filter(t => t.assigneeId === l.id);
    const sm = summarize(own);
    return { lead: l, team: data.teams.find(t => t.id === l.teamId)?.name || '-', ...sm, health: healthOf(sm) };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900">
            {greeting()}, {user?.name?.split(' ')[0] || 'there'}
          </h1>
          <p className="mt-1.5 text-[15px] text-slate-600">Here is how your department is doing today.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={ghostBtn} onClick={() => go('reports')}>
            View reports
          </button>
          <button type="button" className={primaryBtn} onClick={() => go('assign')}>
            Assign a task
          </button>
        </div>
      </div>

      {data.loading ? (
        <LoadingLine label="Loading your department…" />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Assigned" value={s.total} foot="Tasks with team leads" />
            <StatCard label="In progress" value={s.inProgress} tone="blue" foot={s.blocked ? `${s.blocked} blocked` : 'Being worked on'} />
            <StatCard label="Completed" value={s.completed} tone="green" foot={`${s.pct}% completion`} />
            <StatCard label="Overdue" value={s.overdue} tone={s.overdue ? 'red' : 'neutral'} foot="Past their due date" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-4 items-start">
            <Card label="Tasks this week">
              <CardHead
                title="Tasks completed this week"
                hint="By team leads and their members"
                right={
                  <div className="flex items-center gap-3 text-xs text-slate-600" aria-hidden="true">
                    <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-blue-600" /> Completed</span>
                    <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-blue-200" /> Due</span>
                  </div>
                }
              />
              <div className="px-5 pb-5">
                <div className="flex items-end gap-2 sm:gap-4 h-44" role="img" aria-label={`${weekDone} tasks completed this week`}>
                  {bars.map(b => (
                    <div key={b.key} className="flex-1 min-w-0 h-full flex flex-col justify-end items-center gap-2">
                      <div className="w-full flex items-end justify-center gap-1 flex-1" title={`${b.label}: ${b.done} completed, ${b.due} due`}>
                        <div className="w-1/2 max-w-[18px] rounded-t-md bg-blue-200" style={{ height: `${(b.due / maxBar) * 100}%`, minHeight: b.due ? 4 : 0 }} />
                        <div className="w-1/2 max-w-[18px] rounded-t-md bg-blue-600" style={{ height: `${(b.done / maxBar) * 100}%`, minHeight: b.done ? 4 : 0 }} />
                      </div>
                      <span className={`text-xs ${b.key === today ? 'font-extrabold text-blue-700' : 'font-semibold text-slate-500'}`}>{b.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            <Card label="Needs your attention">
              <CardHead title="Needs your attention" />
              <div className="px-3 pb-3">
                {attention.length === 0 ? (
                  <p className="px-2 py-8 text-center text-sm text-slate-500">Nothing is waiting on you right now.</p>
                ) : (
                  <ul className="space-y-1">
                    {attention.map(a => {
                      const Icon = a.icon;
                      return (
                        <li key={a.id}>
                          <button type="button" onClick={() => go(a.go)} className="w-full flex items-center gap-3 p-2.5 rounded-xl text-left hover:bg-slate-50">
                            <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${a.tone}`}>
                              <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-bold text-slate-900">{a.title}</span>
                              <span className="block text-xs text-slate-500">{a.sub}</span>
                            </span>
                            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Card>
          </div>

          <Card label="Team lead progress">
            <CardHead
              title="Team lead progress"
              right={
                <button type="button" onClick={() => go('reports')} className="text-[13px] font-bold text-blue-700 hover:text-blue-800">
                  See full report
                </button>
              }
            />
            {rows.length === 0 ? (
              <p className="px-5 pb-6 text-sm text-slate-500">No active team leads in your department yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-y border-slate-100 bg-slate-50">
                      <th className="py-2.5 pl-5 pr-3 font-semibold">Team lead</th>
                      <th className="py-2.5 px-3 font-semibold">Team</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Tasks</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Done</th>
                      <th className="py-2.5 px-3 font-semibold w-44">Completion</th>
                      <th className="py-2.5 pl-3 pr-5 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.lead.id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 pl-5 pr-3">
                          <div className="flex items-center gap-2.5 font-bold text-slate-900">
                            <Avatar name={r.lead.fullName} /> {r.lead.fullName}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-slate-600">{r.team}</td>
                        <td className="py-3 px-3 text-right font-semibold">{r.total}</td>
                        <td className="py-3 px-3 text-right font-semibold">{r.completed}</td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-label={`Completion of ${r.lead.fullName}`} aria-valuenow={r.pct} aria-valuemin={0} aria-valuemax={100}>
                              <div className="h-full rounded-full bg-blue-600" style={{ width: `${r.pct}%` }} />
                            </div>
                            <span className="w-10 text-right text-xs font-bold">{r.pct}%</span>
                          </div>
                        </td>
                        <td className="py-3 pl-3 pr-5"><HealthBadge health={r.health} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
};
