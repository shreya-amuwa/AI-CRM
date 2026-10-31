import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { SubscriptionList, SubscriptionStatus } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { pipelineApi } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { ErrorBanner, inputCls, selectCls, Spinner } from '../team-member/pipeline/shared';
import { Card } from '../tasks/head/headParts';
import { EmptyState, StatCard, dateText, tcBtn } from '../telecaller/ui';

const PAGE_SIZE = 20;
const STATUS_LABEL: Record<SubscriptionStatus, string> = { NOT_STARTED: 'Not started', ACTIVE: 'Active', EXPIRED: 'Expired', PAUSED: 'Paused', CANCELLED: 'Cancelled' };
const STATUS_STYLE: Record<SubscriptionStatus, string> = {
  NOT_STARTED: 'bg-amber-50 text-amber-800', ACTIVE: 'bg-emerald-50 text-emerald-700', EXPIRED: 'bg-rose-50 text-rose-700', PAUSED: 'bg-slate-100 text-slate-700', CANCELLED: 'bg-slate-100 text-slate-700'
};
const PAYMENT_LABEL: Record<string, string> = {
  NO_PAYMENT: 'No payment', PENDING_VERIFICATION: 'Awaiting verification', PARTIALLY_PAID: 'Part paid', FULLY_PAID: 'Paid', OVERPAID: 'Paid'
};
const inr = (n: number | null | undefined) => (n === null || n === undefined ? '-' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n));

/**
 * Subscriptions & services of the signed-in employee's customers: plan, duration, payment status, panel creation and the dates. Read only: Sales
 * sets the plan and duration on the lead, the technical team confirms the panel activation, and the expiry is calculated (see docs/SUBSCRIPTION_ACTIVATION.md).
 * The database applies the same scope as the customer pages (a salesperson sees their own customers only).
 */
export const SubscriptionsPage: React.FC = () => {
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState<'' | SubscriptionStatus>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SubscriptionList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    const t = setTimeout(() => { setTerm(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setError(null);
    pipelineApi.subscriptionsList({ search: term || undefined, status: status || undefined, page, pageSize: PAGE_SIZE }).then(
      d => alive.current && setData(d),
      err => alive.current && setError(errorMessage(err))
    );
  }, [term, status, page]);
  useEffect(() => {
    alive.current = true;
    load();
    return () => { alive.current = false; };
  }, [load]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  return (
    <div className="space-y-6">
      <PageTitle title="Subscriptions" subtitle="The plan, duration, payment status and panel creation of your customers' services. The start and expiry dates appear once the panel is activated." />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {data && (
        <section aria-label="Summary" className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard label="Active subscriptions" value={data.counts.active} tone="green" />
          <StatCard label="Not started" value={data.counts.notStarted} tone="amber" hint="Waiting for the panel to be activated" />
          <StatCard label="Expired" value={data.counts.expired} tone="red" />
          <StatCard label="Customers with a payment pending" value={data.counts.pendingPayments} tone="blue" />
        </section>
      )}
      <Card label="Subscriptions">
        <div className="flex flex-wrap items-center gap-3 px-5 pt-5">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input aria-label="Search subscriptions" className={`${inputCls} pl-9`} value={search} placeholder="Customer, service or plan" onChange={e => setSearch(e.target.value)} />
          </div>
          <select aria-label="Status" className={selectCls} value={status} onChange={e => { setStatus(e.target.value as '' | SubscriptionStatus); setPage(1); }}>
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABEL) as SubscriptionStatus[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        {!data && !error && <Spinner label="Loading subscriptions…" />}
        {data && data.items.length === 0 && (
          <EmptyState title="No subscriptions found">A customer's services appear here once the lead has moved to Potential or later. Set the plan and duration on the lead.</EmptyState>
        )}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm" data-testid="subscriptions-table">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-y border-slate-100">
                  {['Customer', 'Service', 'Plan', 'Duration', 'Amount', 'Payment', 'Panel created', 'Status', 'Start', 'Expiry'].map(h => <th key={h} className="px-4 py-2.5 font-bold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map(r => (
                  <tr key={`${r.customerId}-${r.service}`}>
                    <td className="px-4 py-3"><div className="font-semibold text-slate-900">{r.customer}</div>{r.contact !== r.customer && <div className="text-xs text-slate-500">{r.contact}</div>}</td>
                    <td className="px-4 py-3 text-slate-700">{r.serviceName}</td>
                    <td className="px-4 py-3 text-slate-700">{r.plan ?? <span className="text-slate-400">not set</span>}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{r.durationLabel ?? <span className="text-slate-400">not set</span>}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{inr(r.amount)}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{r.paymentStatus ? PAYMENT_LABEL[r.paymentStatus] ?? r.paymentStatus : '-'}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{r.panelCreatedOn ? dateText(r.panelCreatedOn) : 'Pending'}</td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{r.startedOn ? dateText(r.startedOn) : '-'}</td>
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{r.expiresOn ? <>{dateText(r.expiresOn)}{r.daysLeft !== null && <div className="text-xs text-slate-500">{r.daysLeft} day{r.daysLeft === 1 ? '' : 's'} left</div>}</> : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-5 py-4 text-sm text-slate-600">
            <span>{data.total} subscriptions · page {page} of {pages}</span>
            <span className="flex gap-2">
              <button type="button" className={tcBtn.secondary} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
              <button type="button" className={tcBtn.secondary} disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button>
            </span>
          </div>
        )}
      </Card>
    </div>
  );
};
