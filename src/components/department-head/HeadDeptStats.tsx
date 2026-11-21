import React from 'react';
import { CalendarCheck, FileText, Plus, UserPlus, Users } from 'lucide-react';
import { Card, CardHead, ghostBtn, StatCard } from '../tasks/head/headParts';
import { headApi, inr, useHeadData } from '../../lib/headDashboard';
import type { HeadPage } from '../tasks/head/HeadOverview';

/**
 * The top of the Department Head's Overview: the department's people and today's attendance, then its customers, leads and invoices. Everything comes from
 * one read-only database function that works out the head's department itself. If the database does not have it yet (before the migration), this section says
 * so and the rest of the Overview works as before.
 */
export const HeadDeptStats: React.FC<{ go: (p: HeadPage) => void; /** The Overview's "Add lead": opens the Leads page with the lead form open. */ onAddLead?: () => void }> = ({ go, onAddLead }) => {
  const { data, error, loading, reload } = useHeadData(() => headApi.overview(), []);
  if (error) {
    return (
      <p className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-sm flex flex-wrap items-center justify-between gap-2" role="status">
        <span>Department statistics are not available right now. {error}</span>
        <button type="button" className={`${ghostBtn} !h-9`} onClick={reload}>Try again</button>
      </p>
    );
  }
  if (loading && !data) return <p className="text-sm text-slate-500" role="status">Loading department statistics…</p>;
  if (!data) return null;
  const a = data.attendance;
  const link = (page: HeadPage, label: string, Icon: React.ElementType) => (
    <button type="button" className="inline-flex items-center gap-1.5 text-[13px] font-bold text-blue-700 hover:underline" onClick={() => go(page)}><Icon className="w-3.5 h-3.5" aria-hidden="true" /> {label}</button>
  );
  return (
    <div className="space-y-4" data-testid="dept-stats">
      <Card label="Department attendance today">
        <CardHead title={data.department?.name ?? 'Your department'} hint="Today's attendance, from Punch In and Punch Out records and approved leave" right={link('team-attendance', 'Open Team Attendance', CalendarCheck)} />
        <div className="px-5 pb-5 grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard label="Employees" value={a.employees} testId="ov-employees" />
          <StatCard label="Present today" value={a.present} tone="green" testId="ov-present" />
          <StatCard label="Absent today" value={a.absent} tone={a.absent ? 'red' : 'neutral'} foot="No punch-in yet" testId="ov-absent" />
          <StatCard label="On leave" value={a.onLeave} tone="amber" testId="ov-leave" />
          <StatCard label="Attendance" value={a.rate === null ? '-' : `${a.rate}%`} tone="blue" foot="Present out of those not on leave" testId="ov-rate" />
        </div>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card label="Customers">
          <div className="p-5">
            <div className="flex items-center justify-between"><span className="text-[13px] font-semibold text-slate-500">Customers</span>{link('customers', 'View', Users)}</div>
            <div className="mt-1.5 text-[32px] leading-none font-extrabold text-slate-900" data-testid="ov-customers">{data.customers.total}</div>
            <div className="mt-2 text-xs text-slate-500">{data.customers.active} active · {data.customers.new} new in 30 days{data.customers.withPendingInvoices ? ` · ${data.customers.withPendingInvoices} with a pending invoice` : ''}</div>
          </div>
        </Card>
        <Card label="Leads">
          <div className="p-5">
            <div className="flex items-center justify-between"><span className="text-[13px] font-semibold text-slate-500">Leads</span><span className="flex items-center gap-3">{onAddLead && <button type="button" className="inline-flex items-center gap-1.5 text-[13px] font-bold text-blue-700 hover:underline" onClick={onAddLead}><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add lead</button>}{link('leads', 'View', UserPlus)}</span></div>
            <div className="mt-1.5 text-[32px] leading-none font-extrabold text-slate-900" data-testid="ov-leads">{data.leads.total}</div>
            <div className="mt-2 text-xs text-slate-500">{data.leads.new} new · {data.leads.inProgress} in progress · {data.leads.converted} converted · {data.leads.lost} lost</div>
          </div>
        </Card>
        <Card label="Invoices">
          <div className="p-5">
            <div className="flex items-center justify-between"><span className="text-[13px] font-semibold text-slate-500">Invoices</span>{link('invoices', 'View', FileText)}</div>
            <div className="mt-1.5 text-[32px] leading-none font-extrabold text-slate-900" data-testid="ov-invoices">{data.invoices.count}</div>
            <div className="mt-2 text-xs text-slate-500">{inr(data.invoices.amount)} invoiced · {inr(data.invoices.pendingAmount)} pending{data.invoices.overdue ? ` · ${data.invoices.overdue} overdue` : ''}</div>
          </div>
        </Card>
      </div>
    </div>
  );
};
