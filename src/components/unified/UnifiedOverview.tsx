import React, { useEffect, useMemo, useState } from 'react';
import type { DivisionLeadsOverview, DivisionSupportOverview } from '../../../shared/contracts';
import { useAuth } from '../../context/AuthContext';
import { pipelineApi } from '../../lib/api/endpoints';
import { useTickets } from '../../lib/support';
import { useWorkTasks } from '../../lib/workTasks';
import { ScopeOverviewPanel } from '../common/ScopeOverviewPanel';
import { PageTitle } from '../layout/shell';
import { StatCard } from '../tasks/head/headParts';
import { usePipelineCounts } from '../team-member/pipeline/shared';
import type { UnifiedPage, UnifiedWho } from './unifiedNav';

const OPEN_TICKET = ['OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED'];

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-3" aria-label={title}>
    <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
    <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">{children}</div>
  </section>
);

/** What the signed-in person's own tasks look like (every task the database lets them see, assigned to them). */
function useMyTasks() {
  const { profile } = useAuth();
  const data = useWorkTasks();
  const mine = useMemo(() => data.tasks.filter(t => t.assigneeId === profile?.id), [data.tasks, profile?.id]);
  return {
    loading: data.loading,
    assigned: mine.length,
    ongoing: mine.filter(t => t.status === 'IN_PROGRESS').length,
    completed: mine.filter(t => t.status === 'COMPLETED').length,
    pending: data.tasks.filter(t => t.status === 'ASSIGNED' || t.status === 'IN_PROGRESS').length
  };
}

/** Department Head: the whole department, Sales and Support side by side. */
const HeadOverview: React.FC<{ go: (p: UnifiedPage) => void }> = ({ go }) => {
  const { profile } = useAuth();
  const departmentId = profile?.department?.id;
  const [sales, setSales] = useState<DivisionLeadsOverview | null>(null);
  const [support, setSupport] = useState<DivisionSupportOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tasks = useMyTasks();
  useEffect(() => {
    if (!departmentId) return;
    // a unified department has one team that does both, so both reads cover it (migration 20270130000100)
    pipelineApi.divisionOverview(departmentId, 'SALES').then(setSales, e => setError(e instanceof Error ? e.message : 'Could not load the Sales figures.'));
    pipelineApi.divisionSupportOverview(departmentId, 'SUPPORT').then(setSupport, e => setError(e instanceof Error ? e.message : 'Could not load the Support figures.'));
  }, [departmentId]);
  const active = support ? support.totals.open + support.totals.inProgress + support.totals.waiting + support.totals.escalated : 0;
  const supportById = new Map((support?.members ?? []).map(m => [m.id, m]));
  return (
    <div className="space-y-8">
      <PageTitle title={`${profile?.department?.name ?? 'Department'} overview`} subtitle="Sales and Support of your whole department, from the real records." />
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <Section title="Sales">
        <StatCard label="Total leads" value={sales?.totals.leads ?? '-'} testId="ov-total-leads" />
        <StatCard label="New leads" value={sales?.leads.NEW ?? '-'} tone="blue" testId="ov-new-leads" />
        <StatCard label="Converted leads" value={sales?.totals.customers ?? '-'} tone="green" testId="ov-converted" />
        <StatCard label="Follow-ups overdue" value={sales?.totals.followUpsOverdue ?? '-'} tone="amber" />
      </Section>
      <Section title="Support">
        <StatCard label="Total customers" value={support?.totals.customers ?? '-'} testId="ov-customers" />
        <StatCard label="Active support tickets" value={support ? active : '-'} tone="amber" testId="ov-active-tickets" />
        <StatCard label="Resolved tickets" value={support?.totals.resolved ?? '-'} tone="green" testId="ov-resolved" />
        <StatCard label="Unassigned tickets" value={support?.totals.unassigned ?? '-'} tone="red" />
      </Section>
      <Section title="Work">
        <StatCard label="Pending tasks" value={tasks.loading ? '-' : tasks.pending} tone="amber" testId="ov-pending-tasks" />
        <StatCard label="Team members" value={sales?.totals.members ?? '-'} />
      </Section>
      <section className="space-y-3" aria-label="Team performance">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Team performance</h2>
          <button type="button" onClick={() => go('sales-performance')} className="text-sm font-medium text-sky-700 hover:underline">Sales performance</button></div>
        <div className="overflow-x-auto bg-white rounded-2xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500"><tr><th className="px-4 py-3">Person</th><th className="px-4 py-3">Leads added</th><th className="px-4 py-3">Leads</th><th className="px-4 py-3">Customers</th><th className="px-4 py-3">Tickets assigned</th><th className="px-4 py-3">Tickets open</th></tr></thead>
            <tbody>
              {(sales?.members ?? []).map(m => {
                const s = supportById.get(m.id);
                return (
                  <tr key={m.id} className="border-t border-slate-100" data-testid="ov-member-row">
                    <td className="px-4 py-3 font-medium text-slate-900">{m.fullName}</td><td className="px-4 py-3">{m.leadsAdded}</td><td className="px-4 py-3">{m.leads}</td>
                    <td className="px-4 py-3">{s?.customersOwned ?? 0}</td><td className="px-4 py-3">{s?.ticketsAssigned ?? 0}</td><td className="px-4 py-3">{s?.ticketsOpen ?? 0}</td>
                  </tr>
                );
              })}
              {sales && sales.members.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No team members yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

/** Team Lead: their team's Sales and Support, from the database scope of their own team. */
const LeadOverview: React.FC = () => {
  const { profile } = useAuth();
  const tasks = useMyTasks();
  const tickets = useTickets();
  const { counts } = usePipelineCounts();
  const active = tickets.tickets.filter(t => OPEN_TICKET.includes(t.status)).length;
  return (
    <div className="space-y-8">
      <PageTitle title={`Hello, ${profile?.fullName?.split(' ')[0] || 'there'}`} subtitle="Your team's Sales and Support, from the real records of the people who report to you." />
      <Section title="Sales">
        <StatCard label="My leads" value={counts?.leads.all ?? '-'} testId="ov-my-leads" />
        <StatCard label="Potential" value={counts?.potential.all ?? '-'} tone="blue" />
        <StatCard label="Customer onboarding" value={counts?.onboarding.all ?? '-'} tone="green" />
      </Section>
      <Section title="Support">
        <StatCard label="Pending support tickets" value={tickets.loading ? '-' : active} tone="amber" testId="ov-active-tickets" />
        <StatCard label="Resolved tickets" value={tickets.loading ? '-' : tickets.tickets.filter(t => t.status === 'RESOLVED' || t.status === 'CLOSED').length} tone="green" />
      </Section>
      <Section title="Work">
        <StatCard label="My tasks" value={tasks.loading ? '-' : tasks.assigned} />
        <StatCard label="Completed tasks" value={tasks.loading ? '-' : tasks.completed} tone="green" />
      </Section>
      <ScopeOverviewPanel heading="Your team" hint="Counted from your team's real records." />
    </div>
  );
};

/** Team Member: only their own leads, customers, tickets and tasks. */
const MemberOverview: React.FC<{ go: (p: UnifiedPage) => void }> = ({ go }) => {
  const { profile } = useAuth();
  const tasks = useMyTasks();
  const tickets = useTickets();
  const { counts } = usePipelineCounts();
  const active = tickets.tickets.filter(t => OPEN_TICKET.includes(t.status)).length;
  return (
    <div className="space-y-8">
      <PageTitle title={`Hello, ${profile?.fullName?.split(' ')[0] || 'there'}`} subtitle="Your leads, your customers, your tickets and your tasks." />
      <Section title="Sales">
        <StatCard label="My leads" value={counts?.leads.all ?? '-'} testId="ov-my-leads" />
        <StatCard label="Potential" value={counts?.potential.all ?? '-'} tone="blue" />
        <StatCard label="My customers" value={counts?.onboarding.all ?? '-'} tone="green" testId="ov-my-customers" />
      </Section>
      <Section title="Support">
        <StatCard label="My active tickets" value={tickets.loading ? '-' : active} tone="amber" testId="ov-active-tickets" />
        <StatCard label="Resolved" value={tickets.loading ? '-' : tickets.tickets.filter(t => t.status === 'RESOLVED' || t.status === 'CLOSED').length} tone="green" />
      </Section>
      <Section title="Tasks">
        <StatCard label="Assigned" value={tasks.loading ? '-' : tasks.assigned} testId="ov-assigned" />
        <StatCard label="Ongoing" value={tasks.loading ? '-' : tasks.ongoing} tone="blue" />
        <StatCard label="Completed" value={tasks.loading ? '-' : tasks.completed} tone="green" />
      </Section>
      <button type="button" onClick={() => go('daily-reports')} className="inline-flex items-center rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700">Open my daily report</button>
    </div>
  );
};

export const UnifiedOverview: React.FC<{ who: UnifiedWho; go: (p: UnifiedPage) => void }> = ({ who, go }) =>
  who === 'HEAD' ? <HeadOverview go={go} /> : who === 'LEAD' ? <LeadOverview /> : <MemberOverview go={go} />;
