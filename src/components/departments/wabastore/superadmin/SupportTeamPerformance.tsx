import React from 'react';
import { CheckCircle2, ClipboardList, Flag, LifeBuoy, Users } from 'lucide-react';
import type { DivisionSupportMember } from '../../../../../shared/contracts';
import { Avatar, Card, ErrorBanner, Pill, Spinner } from '../../../team-member/pipeline/shared';
import { Tile } from './parts';
import { useSupportOverview } from './useSupportOverview';

const dateText = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

const STATUS_BARS: { key: 'open' | 'inProgress' | 'waiting' | 'escalated' | 'resolved'; label: string; bar: string }[] = [
  { key: 'open', label: 'Pending (open)', bar: 'bg-slate-400' },
  { key: 'inProgress', label: 'In progress', bar: 'bg-indigo-500' },
  { key: 'waiting', label: 'Waiting for customer reply', bar: 'bg-orange-500' },
  { key: 'escalated', label: 'Escalated', bar: 'bg-rose-500' },
  { key: 'resolved', label: 'Complete (resolved or closed)', bar: 'bg-emerald-500' }
];

/** Wabastore Support - Team Performance. Every number is a count of real customers, tickets and tasks. */
export const SupportTeamPerformance: React.FC<{ departmentId: string | undefined }> = ({ departmentId }) => {
  const { data, error, loading, reload } = useSupportOverview(departmentId);
  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data || loading) return <Spinner label="Loading team performance…" />;

  const { totals, members } = data;
  const openTickets = totals.open + totals.inProgress + totals.waiting + totals.escalated;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-slate-500">Wabastore / Support</p>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Team Performance</h1>
        <p className="text-sm text-slate-500 mt-0.5">Live numbers from the customers, tickets and tasks of your Support team. Nothing here is estimated.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile testId="kpi-members" icon={<Users className="w-4 h-4" />} label="Team members" value={totals.members} hint="Active team leads and members" />
        <Tile testId="kpi-customers" icon={<Users className="w-4 h-4" />} label="Customers" value={totals.customers} hint={`${totals.customersActive} active`} />
        <Tile testId="kpi-open" icon={<LifeBuoy className="w-4 h-4" />} label="Open tickets" value={openTickets} hint={`${totals.unassigned} not assigned yet`} />
        <Tile testId="kpi-resolved" icon={<CheckCircle2 className="w-4 h-4" />} label="Completed tickets" value={totals.resolved} tone="text-emerald-700" hint={`of ${totals.tickets} in total`} />
        <Tile testId="kpi-escalated" icon={<Flag className="w-4 h-4" />} label="Escalated" value={totals.escalated} tone={totals.escalated ? 'text-rose-700' : 'text-slate-900'} hint="Waiting on a senior" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-900">Ticket status</h2>
          <p className="text-xs text-slate-500 mb-3">All tickets of the Support team</p>
          <ul className="space-y-2.5" data-testid="status-breakdown">
            {STATUS_BARS.map(b => {
              const n = totals[b.key];
              const pct = totals.tickets ? Math.round((n / totals.tickets) * 100) : 0;
              return (
                <li key={b.key} data-status={b.key}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-slate-700">{b.label}</span>
                    <span className="text-slate-500">
                      <strong className="text-slate-900" data-count>{n}</strong> · {pct}%
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full ${b.bar}`} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-900">Tasks</h2>
          <p className="text-xs text-slate-500 mb-3">Work the Team Leads assigned to the Support team</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-xs text-slate-500 flex items-center gap-1"><ClipboardList className="w-3.5 h-3.5" /> Pending</div>
              <div className="text-2xl font-bold text-slate-900" data-testid="tasks-pending">{totals.tasksPending}</div>
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-xs text-slate-500 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Completed</div>
              <div className="text-2xl font-bold text-emerald-700" data-testid="tasks-done">{totals.tasksDone}</div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-sm font-bold text-slate-900">Team members</h2>
          <p className="text-xs text-slate-500">Who added each customer, and how their tickets and tasks are progressing.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[980px]" data-testid="member-performance">
            <thead className="text-[11px] text-slate-500 bg-slate-50/60">
              <tr>
                <th className="px-4 py-2.5 font-medium">Member</th>
                <th className="px-4 py-2.5 font-medium">Customers added</th>
                <th className="px-4 py-2.5 font-medium">Customers owned</th>
                <th className="px-4 py-2.5 font-medium">Tickets assigned</th>
                <th className="px-4 py-2.5 font-medium">Open / In progress / Waiting / Escalated</th>
                <th className="px-4 py-2.5 font-medium">Completed</th>
                <th className="px-4 py-2.5 font-medium">Tasks pending / done</th>
                <th className="px-4 py-2.5 font-medium">Last customer added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {members.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-slate-500">
                    No team members yet. Add them from Team Members.
                  </td>
                </tr>
              )}
              {members.map((m: DivisionSupportMember) => (
                <tr key={m.id} data-member={m.email}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={m.fullName} />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 text-[13px] truncate">{m.fullName}</div>
                        <div className="text-xs text-slate-500 truncate">
                          {m.role === 'TEAM_HEAD' ? 'Team Lead' : 'Team Member'} · {m.email}
                        </div>
                      </div>
                      {m.status !== 'ACTIVE' && <Pill tone="slate">{m.status.toLowerCase()}</Pill>}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-semibold" data-col="added">{m.customersAdded}</td>
                  <td className="px-4 py-3" data-col="owned">{m.customersOwned}</td>
                  <td className="px-4 py-3" data-col="tickets">{m.ticketsAssigned}</td>
                  <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">
                    {m.ticketsOpen} / {m.ticketsInProgress} / {m.ticketsWaiting} / <span className={m.ticketsEscalated ? 'text-rose-700 font-bold' : ''}>{m.ticketsEscalated}</span>
                  </td>
                  <td className="px-4 py-3" data-col="resolved">{m.ticketsResolved}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">{m.tasksPending} / {m.tasksDone}</td>
                  <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">{dateText(m.lastCustomerAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-slate-500">
        Not tracked yet: ticket response and resolution times. The CRM stores each ticket's status and its history entries, but no service-level targets, so averages are not shown.
      </p>
    </div>
  );
};
