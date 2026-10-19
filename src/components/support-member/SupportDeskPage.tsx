import React, { useState } from 'react';
import { CheckCircle2, ClipboardList, Headset, Users } from 'lucide-react';
import { summarize, useWorkTasks } from '../../lib/workTasks';
import { isTicketOpen, useCustomerStats, useSupportInvoices, useTickets } from '../../lib/support';
import { CustomerProfile } from './CustomersPage';
import { TicketsPage } from './TicketsPage';
import { InvoiceRequests } from './InvoiceRequests';
import { KpiCard, PageHeader } from './SupportParts';
import { useSupportTeam } from './TeamActivityPage';

/**
 * Department Head: how the Support team is doing - customers, tickets, pending
 * issues, escalations, task completion and each member's activity.
 */
export const SupportDeskPage: React.FC = () => {
  const tickets = useTickets();
  const tasks = useWorkTasks();
  const invoices = useSupportInvoices();
  const { stats, recent } = useCustomerStats(undefined);
  const [customerId, setCustomerId] = useState<string | null>(null);

  const { memberTasks } = useSupportTeam(tasks);

  if (customerId) {
    return <CustomerProfile customerId={customerId} tickets={tickets} tasks={tasks} invoices={invoices.invoices} people={tasks.people} onBack={() => setCustomerId(null)} />;
  }

  const t = tickets.tickets;
  const ts = summarize(memberTasks);
  const open = t.filter(x => isTicketOpen(x.status));

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

      <div className="grid grid-cols-1 gap-5">
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

      <TicketsPage mode="manager" data={tickets} people={tasks.people} teams={tasks.teams} onOpenCustomer={setCustomerId} />
      <InvoiceRequests canRequest={false} onOpenCustomer={setCustomerId} />
    </div>
  );
};
