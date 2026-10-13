import React from 'react';
import { Award, Eye, Flag, Target, TrendingUp, Users } from 'lucide-react';
import type { DivisionMemberStats } from '../../../../../shared/contracts';
import { Avatar, btn, Card, ErrorBanner, Pill, Spinner } from '../../../team-member/pipeline/shared';
import { useSalesOverview } from './useSalesOverview';

const dateText = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

const Tile: React.FC<{ icon: React.ReactNode; label: string; value: number; hint?: string; tone?: string; testId: string }> = ({
  icon,
  label,
  value,
  hint,
  tone = 'text-slate-900',
  testId
}) => (
  <Card className="p-4">
    <div className="flex items-center justify-between text-slate-500">
      <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      {icon}
    </div>
    <div className={`mt-2 text-3xl font-bold ${tone}`} data-testid={testId}>
      {value}
    </div>
    {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
  </Card>
);

const STATUS_BARS: { key: 'NEW' | 'CONTACTED' | 'INTERESTED' | 'READY_TO_BUY' | 'WITH_ACCOUNTS' | 'RETURNED'; label: string; bar: string }[] = [
  { key: 'NEW', label: 'New', bar: 'bg-slate-400' },
  { key: 'CONTACTED', label: 'Contacted', bar: 'bg-indigo-500' },
  { key: 'INTERESTED', label: 'Interested', bar: 'bg-orange-500' },
  { key: 'READY_TO_BUY', label: 'Ready to buy', bar: 'bg-emerald-500' },
  { key: 'WITH_ACCOUNTS', label: 'With Accounts', bar: 'bg-sky-500' },
  { key: 'RETURNED', label: 'Returned from Accounts', bar: 'bg-rose-400' }
];

/** Wabastore Sales - Team Performance, every number is a count of real records. */
export const SalesTeamPerformance: React.FC<{ departmentId: string | undefined; onViewLeads: (memberId?: string) => void }> = ({ departmentId, onViewLeads }) => {
  const { data, error, loading, reload } = useSalesOverview(departmentId);

  if (error) return <ErrorBanner message={error} onRetry={reload} />;
  if (!data || loading) return <Spinner label="Loading team performance…" />;

  const { totals, leads, members } = data;
  const moved = totals.potential + totals.onboarding + totals.customers;
  const statusTotal = leads.all + leads.WITH_ACCOUNTS;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-slate-500">Wabastore / Sales</p>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Team Performance</h1>
        <p className="text-sm text-slate-500 mt-0.5">Live numbers from the leads your Sales team has added. Nothing here is estimated.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile testId="kpi-members" icon={<Users className="w-4 h-4" />} label="Team members" value={totals.members} hint="Active team leads and members" />
        <Tile testId="kpi-added" icon={<Target className="w-4 h-4" />} label="Leads added" value={totals.leadsAdded} hint="Every lead the team created" />
        <Tile testId="kpi-leads" icon={<TrendingUp className="w-4 h-4" />} label="Open leads" value={totals.leads} hint="Still in the Leads stage" />
        <Tile testId="kpi-moved" icon={<Award className="w-4 h-4" />} label="Moved on" value={moved} tone="text-emerald-700" hint="Potential, onboarding or customer" />
        <Tile testId="kpi-overdue" icon={<Flag className="w-4 h-4" />} label="Overdue follow-ups" value={totals.followUpsOverdue} tone={totals.followUpsOverdue ? 'text-rose-700' : 'text-slate-900'} hint={`${totals.followUpsToday} due today · ${totals.noFollowUp} with none set`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h2 className="text-sm font-bold text-slate-900">Lead status</h2>
          <p className="text-xs text-slate-500 mb-3">Open leads by status</p>
          <ul className="space-y-2.5" data-testid="status-breakdown">
            {STATUS_BARS.map(b => {
              const n = leads[b.key];
              const pct = statusTotal ? Math.round((n / statusTotal) * 100) : 0;
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
          <h2 className="text-sm font-bold text-slate-900">Pipeline</h2>
          <p className="text-xs text-slate-500 mb-3">Where the team's customers are now</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Leads', totals.leads],
              ['Potential', totals.potential],
              ['Onboarding', totals.onboarding],
              ['Customers', totals.customers]
            ].map(([label, n]) => (
              <div key={label as string} className="rounded-xl border border-slate-200 p-3">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="text-2xl font-bold text-slate-900">{n}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-3">
            The CRM has no "converted" lead status. A lead counts as moved on once it reaches Potential, Onboarding or Customer.
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-sm font-bold text-slate-900">Team members</h2>
          <p className="text-xs text-slate-500">Who added each lead, and how their leads are progressing.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[980px]" data-testid="member-performance">
            <thead className="text-[11px] text-slate-500 bg-slate-50/60">
              <tr>
                <th className="px-4 py-2.5 font-medium">Member</th>
                <th className="px-4 py-2.5 font-medium">Leads added</th>
                <th className="px-4 py-2.5 font-medium">Open leads</th>
                <th className="px-4 py-2.5 font-medium">New / Contacted / Interested / Ready</th>
                <th className="px-4 py-2.5 font-medium">Moved on</th>
                <th className="px-4 py-2.5 font-medium">Follow-ups</th>
                <th className="px-4 py-2.5 font-medium">Last lead added</th>
                <th className="px-4 py-2.5 font-medium">Leads</th>
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
              {members.map((m: DivisionMemberStats) => (
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
                  <td className="px-4 py-3 font-semibold" data-col="added">{m.leadsAdded}</td>
                  <td className="px-4 py-3" data-col="open">{m.leads}</td>
                  <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">
                    {m.new} / {m.contacted} / {m.interested} / {m.readyToBuy}
                  </td>
                  <td className="px-4 py-3" data-col="moved">{m.potential + m.onboarding + m.customers}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    <span className={m.followUpsOverdue ? 'text-rose-700 font-bold' : 'text-slate-700'}>{m.followUpsOverdue} overdue</span>
                    <span className="text-slate-500"> · {m.followUpsToday} today · {m.noFollowUp} none</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">{dateText(m.lastLeadAt)}</td>
                  <td className="px-4 py-3">
                    <button type="button" className={btn.secondary} onClick={() => onViewLeads(m.id)} aria-label={`View leads of ${m.fullName}`}>
                      <Eye className="w-3.5 h-3.5" /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-slate-500">
        Not tracked yet: a history of lead re-assignments and of completed follow-ups. The CRM stores each lead's current owner and its next follow-up date only, so those two cannot be reported.
      </p>
    </div>
  );
};
