import React, { useEffect, useMemo, useState } from 'react';
import { summarize, useWorkTasks, type WorkTaskData } from '../../lib/workTasks';
import { isTicketOpen, useTickets } from '../../lib/support';
import { getSupabase } from '../../services/supabaseClient';
import { PageHeader } from './SupportParts';

/** The active members and leads of the Support teams, and the tasks given to the members. */
export function useSupportTeam(tasks: WorkTaskData) {
  const supportTeamIds = useMemo(() => new Set(tasks.teams.filter(t => t.division === 'SUPPORT').map(t => t.id)), [tasks.teams]);
  const supportPeople = useMemo(
    () => tasks.people.filter(p => p.status === 'ACTIVE' && (p.role === 'TEAM_MEMBER' || p.role === 'TEAM_HEAD') && p.teamId && supportTeamIds.has(p.teamId)),
    [tasks.people, supportTeamIds]
  );
  const memberTasks = useMemo(
    () => tasks.tasks.filter(t => supportPeople.some(p => p.id === t.assigneeId && p.role === 'TEAM_MEMBER')),
    [tasks.tasks, supportPeople]
  );
  return { supportPeople, memberTasks };
}

/**
 * Department Head: what each Support team member is doing - customers, open / escalated / resolved tickets and
 * task completion. (This used to sit inside the Support Desk page; it is its own page under Work now.)
 */
export const TeamActivityPage: React.FC = () => {
  const tickets = useTickets();
  const tasks = useWorkTasks();
  const { supportPeople, memberTasks } = useSupportTeam(tasks);
  const [owned, setOwned] = useState<Record<string, number>>({});

  useEffect(() => {
    const supabase = getSupabase();
    const ids = supportPeople.map(p => p.id);
    if (!supabase || !ids.length) return;
    supabase
      .from('customers')
      .select('owner_id')
      .in('owner_id', ids)
      .limit(5000)
      .then(({ data }) => {
        const counts: Record<string, number> = {};
        (data || []).forEach((r: any) => (counts[r.owner_id] = (counts[r.owner_id] || 0) + 1));
        setOwned(counts);
      });
  }, [supportPeople]);

  const t = tickets.tickets;
  const rows = supportPeople.map(p => {
    const mine = t.filter(x => x.assigneeId === p.id);
    const myTasks = summarize(memberTasks.filter(x => x.assigneeId === p.id));
    return {
      id: p.id,
      name: p.fullName,
      customers: owned[p.id] || 0,
      open: mine.filter(x => isTicketOpen(x.status)).length,
      escalated: mine.filter(x => x.status === 'ESCALATED').length,
      resolved: mine.filter(x => !isTicketOpen(x.status)).length,
      tasksDone: myTasks.completed,
      tasksTotal: myTasks.total
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Team Activity" subtitle="What each member of your Support team is working on." />
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5">
        <h2 className="text-sm font-bold text-slate-900 mb-3">Team activity</h2>
        {rows.length === 0 ? (
          <p className="text-xs text-slate-400">No active Support team members yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-3 font-semibold">Team member</th>
                  <th className="py-2 px-3 font-semibold text-right">Customers</th>
                  <th className="py-2 px-3 font-semibold text-right">Open tickets</th>
                  <th className="py-2 px-3 font-semibold text-right">Escalated</th>
                  <th className="py-2 px-3 font-semibold text-right">Resolved</th>
                  <th className="py-2 pl-3 font-semibold text-right">Tasks done</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 font-medium text-slate-800">{r.name}</td>
                    <td className="py-2 px-3 text-right">{r.customers}</td>
                    <td className="py-2 px-3 text-right">{r.open}</td>
                    <td className="py-2 px-3 text-right text-rose-700">{r.escalated}</td>
                    <td className="py-2 px-3 text-right text-emerald-700">{r.resolved}</td>
                    <td className="py-2 pl-3 text-right">
                      {r.tasksDone}/{r.tasksTotal}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
