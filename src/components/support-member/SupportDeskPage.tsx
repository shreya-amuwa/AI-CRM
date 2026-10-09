import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, Headset, Users } from 'lucide-react';
import { summarize, useWorkTasks } from '../../lib/workTasks';
import { isTicketOpen, useCustomerStats, useSupportInvoices, useTickets } from '../../lib/support';
import { getSupabase } from '../../services/supabaseClient';
import { CustomerProfile } from './CustomersPage';
import { TicketsPage } from './TicketsPage';
import { KpiCard, PageHeader } from './SupportParts';

/**
 * Department Head: how the Support team is doing — customers, tickets, pending
 * issues, escalations, task completion and each member's activity.
 */
export const SupportDeskPage: React.FC = () => {
  const tickets = useTickets();
  const tasks = useWorkTasks();
  const invoices = useSupportInvoices();
  const { stats, recent } = useCustomerStats(undefined);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [owned, setOwned] = useState<Record<string, number>>({});

  const supportTeamIds = useMemo(() => new Set(tasks.teams.filter(t => t.division === 'SUPPORT').map(t => t.id)), [tasks.teams]);
  const supportPeople = useMemo(
    () => tasks.people.filter(p => p.status === 'ACTIVE' && (p.role === 'TEAM_MEMBER' || p.role === 'TEAM_HEAD') && p.teamId && supportTeamIds.has(p.teamId)),
    [tasks.people, supportTeamIds]
  );
  const memberTasks = useMemo(
    () => tasks.tasks.filter(t => supportPeople.some(p => p.id === t.assigneeId && p.role === 'TEAM_MEMBER')),
    [tasks.tasks, supportPeople]
  );

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

  if (customerId) {
    return <CustomerProfile customerId={customerId} tickets={tickets} tasks={tasks} invoices={invoices.invoices} people={tasks.people} onBack={() => setCustomerId(null)} />;
  }

  const t = tickets.tickets;
  const ts = summarize(memberTasks);
  const open = t.filter(x => isTicketOpen(x.status));
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
      <PageHeader title="Support Desk" subtitle="Customers, tickets, pending issues and task completion for your Support team." />
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Customers" value={stats.total} icon={Users} hint={`${stats.newThisMonth} new in 30 days`} />
        <KpiCard label="Open tickets" value={open.length} icon={Headset} tone="text-blue-700" hint={`${open.filter(x => !x.assigneeId).length} unassigned`} />
        <KpiCard label="Escalated" value={t.filter(x => x.status === 'ESCALATED').length} icon={Headset} tone="text-rose-700" />
        <KpiCard label="Resolved / closed" value={t.length - open.length} icon={CheckCircle2} tone="text-emerald-700" hint={`${t.length ? Math.round(((t.length - open.length) / t.length) * 100) : 0}% of all tickets`} />
        <KpiCard label="Tasks completed" value={`${ts.completed}/${ts.total}`} icon={ClipboardList} tone="text-emerald-700" hint={`${ts.pct}% done`} />
        <KpiCard label="Blocked / overdue tasks" value={`${ts.blocked} / ${ts.overdue}`} icon={ClipboardList} tone="text-amber-700" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-200/80 p-5">
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
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-3">Recent customers</h2>
          {recent.length === 0 ? (
            <p className="text-xs text-slate-400">No customers yet.</p>
          ) : (
            <ul className="space-y-3">
              {recent.map(c => (
                <li key={c.id}>
                  <button type="button" onClick={() => setCustomerId(c.id)} className="text-left w-full group">
                    <div className="text-sm font-semibold text-slate-800 group-hover:text-blue-700">{c.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {c.ownerName || 'Team member'} · {c.code}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <TicketsPage mode="manager" data={tickets} people={tasks.people} onOpenCustomer={setCustomerId} />
    </div>
  );
};
