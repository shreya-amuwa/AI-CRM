import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronRight, Search } from 'lucide-react';
import type { PartPaymentItem, PartPaymentStatusFilter, PartPaymentsPage, PaymentOverview } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { pipelineApi, type PartPaymentsParams } from '../../lib/api/endpoints';
import { rowOpen } from '../../lib/rowClick';
import { AccountsPaymentPanel } from '../accounts/AccountsPaymentPanel';
import { Empty, ErrorBanner, inputClass, Loading, Modal, PageHeader, Pager } from '../support-member/SupportParts';
import { Badge, FollowUpBadge, fmtDate, fmtDateTime, MoneyTiles, PaymentHistory, PaymentStatusBadge, rupees } from './PaymentBits';

const PAGE_SIZE = 10;

const STATUS_TABS: { key: PartPaymentStatusFilter; label: string }[] = [
  { key: 'PARTIAL', label: 'Balance due' },
  { key: 'PAID', label: 'Fully paid' },
  { key: 'RETURNED', label: 'Returned to leads' },
  { key: 'ALL', label: 'All' }
];

const ONBOARDING_LABEL: Record<string, string> = {
  RETURNED: 'Returned by consultant',
  COLLECTING: 'Collecting documents',
  WAITING_ON_CLIENT: 'Waiting on client',
  READY_FOR_HANDOVER: 'Ready for hand-over'
};

const useDebounced = <T,>(value: T, ms = 300): T => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
};

const onboardingBadge = (c: PartPaymentItem) => {
  if (c.stage === 'LEAD' || c.stage === 'LOST') return <Badge tone="red">Back in Leads</Badge>;
  if (!c.onboarding) return <Badge tone="slate">-</Badge>;
  if (c.onboarding.getStarted) return <Badge tone="green">Get started</Badge>;
  return <Badge tone="slate">{ONBOARDING_LABEL[c.onboarding.state] ?? 'Onboarding'}</Badge>;
};

/** Read-only payment summary for Sales (never the Accounts follow-up notes). */
const SalesPaymentSummary: React.FC<{ customerId: string }> = ({ customerId }) => {
  const [o, setO] = useState<PaymentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    pipelineApi.paymentOverview(customerId).then(setO, e => setError(errorMessage(e)));
  }, [customerId]);
  if (error) return <ErrorBanner message={error} />;
  if (!o) return <Loading label="Loading payments…" />;
  return (
    <div className="space-y-3">
      <MoneyTiles deal={o.dealAmount} verified={o.verified} pending={o.pending} balance={o.balance} />
      <PaymentHistory payments={o.payments} />
      {o.balance > 0 && <p className="text-[11px] text-slate-500">Accounts follows up the remaining balance. Onboarding continues meanwhile.</p>}
    </div>
  );
};

const Detail: React.FC<{ item: PartPaymentItem; mode: 'sales' | 'accounts'; onChanged: () => void; onOpenOnboarding?: (id: string) => void }> = ({ item, mode, onChanged, onOpenOnboarding }) => {
  // The list behind this pop-up reloads after every change; keep showing this customer and its live status.
  const [live, setLive] = useState<PaymentOverview | null>(null);
  return (
  <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs text-slate-500">
          {item.code}
          {item.phone ? ` · ${item.phone}` : ''}
          {item.email ? ` · ${item.email}` : ''}
        </p>
        <p className="text-sm font-semibold text-slate-900 mt-0.5">{item.company ? `${item.company} · ${item.name}` : item.name}</p>
        <p className="text-xs text-slate-500 mt-0.5">{item.services.join(', ') || 'No services'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <PaymentStatusBadge status={live?.paymentStatus ?? item.paymentStatus} />
        {onboardingBadge(item)}
        {mode === 'sales' && onOpenOnboarding && item.stage === 'ONBOARDING' && (
          <button type="button" onClick={() => onOpenOnboarding(item.id)} className="inline-flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-800">
            Open onboarding <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
      <div>
        <dt className="text-[11px] text-slate-400">Salesperson</dt>
        <dd className="font-semibold text-slate-900">{item.salesperson?.fullName ?? '-'}</dd>
      </div>
      <div>
        <dt className="text-[11px] text-slate-400">Accountant</dt>
        <dd className="font-semibold text-slate-900">{item.accountsOwner?.fullName ?? 'Not assigned'}</dd>
      </div>
      <div>
        <dt className="text-[11px] text-slate-400">Last verified payment</dt>
        <dd className="font-semibold text-slate-900">{item.lastPaymentAt ? `${rupees(item.lastPaymentAmount)} · ${fmtDate(item.lastPaymentAt)}` : '-'}</dd>
      </div>
      <div>
        <dt className="text-[11px] text-slate-400">Verified by</dt>
        <dd className="font-semibold text-slate-900">{item.verifiedBy ?? '-'}</dd>
      </div>
    </dl>
    {mode === 'accounts' ? <AccountsPaymentPanel customerId={item.id} followUps readOnly={item.stage === 'LEAD' || item.stage === 'LOST'} onChanged={onChanged} onLoaded={setLive} /> : <SalesPaymentSummary customerId={item.id} />}
  </div>
  );
};

/**
 * Part payments. One list, two audiences:
 *  - Sales: customers with a verified part payment (read-only, onboarding continues).
 *  - Accounts: the same customers as pending-balance follow-ups, with the accountant, follow-up status and actions.
 * Both read the same customers and the same payment ledger.
 */
export const PartPaymentsView: React.FC<{ mode: 'sales' | 'accounts'; onOpenOnboarding?: (id: string) => void; onCountsChanged?: () => void }> = ({ mode, onOpenOnboarding, onCountsChanged }) => {
  const accounts = mode === 'accounts';
  const [status, setStatus] = useState<PartPaymentStatusFilter>('PARTIAL');
  const [search, setSearch] = useState('');
  const [salesperson, setSalesperson] = useState('');
  const [accountsOwner, setAccountsOwner] = useState('');
  const [followUp, setFollowUp] = useState<NonNullable<PartPaymentsParams['followUp']> | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<NonNullable<PartPaymentsParams['sort']>>('recent');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PartPaymentsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<PartPaymentItem | null>(null);
  const debounced = useDebounced(search.trim());
  const seq = useRef(0);

  const load = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    pipelineApi
      .partPayments({
        status,
        search: debounced || undefined,
        salesperson: salesperson || undefined,
        accountsOwner: accounts && accountsOwner ? accountsOwner : undefined,
        followUp: accounts && followUp ? followUp : undefined,
        from: from || undefined,
        to: to || undefined,
        sort,
        page,
        pageSize: PAGE_SIZE
      })
      .then(
        r => n === seq.current && setData(r),
        e => n === seq.current && setError(errorMessage(e))
      )
      .finally(() => n === seq.current && setLoading(false));
  }, [status, debounced, salesperson, accountsOwner, followUp, from, to, sort, page, accounts]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [status, debounced, salesperson, accountsOwner, followUp, from, to, sort]);

  const hasFilters = !!(debounced || salesperson || accountsOwner || followUp || from || to);

  return (
    <div className="space-y-5">
      <PageHeader
        title={accounts ? 'Part payments · balance follow-ups' : 'Part payments'}
        subtitle={
          accounts
            ? 'Customers who paid part of the agreed amount. They stay here while a balance remains, even though Sales is onboarding them. Record each follow-up and every further payment.'
            : 'Customers whose part payment Accounts has verified. Onboarding continues while Accounts collects the balance.'
        }
      />

      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 space-y-3">
        <div className="flex flex-col lg:flex-row gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search part payments</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by customer, business, phone or customer ID" className={`${inputClass} pl-9`} />
          </label>
          <select aria-label="Filter by salesperson" className={`${inputClass} lg:w-48`} value={salesperson} onChange={e => setSalesperson(e.target.value)}>
            <option value="">All salespeople</option>
            {data?.salespeople.map(p => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
          {accounts && (
            <select aria-label="Filter by accountant" className={`${inputClass} lg:w-48`} value={accountsOwner} onChange={e => setAccountsOwner(e.target.value)}>
              <option value="">All accountants</option>
              {data?.accountants.map(p => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                </option>
              ))}
            </select>
          )}
          {accounts && (
            <select aria-label="Filter by follow-up status" className={`${inputClass} lg:w-52`} value={followUp} onChange={e => setFollowUp(e.target.value as typeof followUp)}>
              <option value="">Any follow-up status</option>
              <option value="FOLLOW_UP_REQUIRED">Follow-up required</option>
              <option value="CONTACTED">Contacted</option>
              <option value="AWAITING_PAYMENT">Awaiting payment</option>
              <option value="FULLY_PAID">Fully paid</option>
            </select>
          )}
        </div>
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div role="tablist" aria-label="Payment status" className="flex flex-wrap p-1 rounded-xl bg-slate-100 text-xs font-semibold self-start">
            {STATUS_TABS.map(t => (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={status === t.key}
                onClick={() => setStatus(t.key)}
                className={`px-3.5 py-1.5 rounded-lg ${status === t.key ? 'bg-white shadow-xs text-slate-900' : 'text-slate-600'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <label className="flex items-center gap-1.5">
              Last payment from
              <input type="date" aria-label="Last payment from" className={`${inputClass} !w-auto !py-1.5`} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
            </label>
            <label className="flex items-center gap-1.5">
              to
              <input type="date" aria-label="Last payment to" className={`${inputClass} !w-auto !py-1.5`} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
            </label>
            <select aria-label="Sort" className={`${inputClass} !w-auto !py-1.5`} value={sort} onChange={e => setSort(e.target.value as typeof sort)}>
              <option value="recent">Latest payment first</option>
              <option value="balance">Highest balance first</option>
              <option value="name">Business name</option>
              {accounts && <option value="followUp">Next follow-up</option>}
            </select>
          </div>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}

      {loading && !data ? (
        <Loading label="Loading part payments…" />
      ) : data && data.items.length === 0 ? (
        <Empty
          title={hasFilters ? 'No customers match these filters' : status === 'PAID' ? 'No fully paid customers yet' : status === 'RETURNED' ? 'No returned customers with payments' : 'No part payments to follow up'}
          hint={hasFilters ? 'Clear the search or filters to see everyone.' : 'A customer appears here once Accounts verifies a part payment.'}
        />
      ) : (
        <div className={`bg-white rounded-2xl border border-slate-200/80 overflow-hidden ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <div className="hidden lg:grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.5fr)_1.25rem] gap-4 px-5 py-2.5 bg-slate-50/70 text-[11px] font-medium text-slate-500" aria-hidden="true">
            <span>Customer</span>
            <span>Amount</span>
            <span>Last payment</span>
            <span>Status</span>
            <span>{accounts ? 'Accountant and follow-up' : 'Salesperson'}</span>
            <span />
          </div>
          <ul className="divide-y divide-slate-100" aria-label="Part payments">
            {data?.items.map(c => (
              <li
                key={c.id}
                {...rowOpen(() => setOpen(c))}
                aria-label={`Open payments of ${c.company || c.name}`}
                className="grid grid-cols-1 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.5fr)_1.25rem] gap-2 lg:gap-4 items-center px-5 py-3.5 hover:bg-slate-50 focus-visible:bg-blue-50/50 focus-visible:outline-none"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 text-[13px] truncate">{c.company || c.name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {c.company ? `${c.name} · ` : ''}
                    {c.phone || c.email || ''}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate">{c.services.join(', ') || 'No services'}</div>
                </div>
                <div className="text-xs">
                  <div className="text-slate-900 font-semibold">
                    {rupees(c.amountVerified)} <span className="font-normal text-slate-500">of {rupees(c.dealAmount)}</span>
                  </div>
                  <div className={`font-bold ${c.balance > 0 ? 'text-orange-700' : 'text-emerald-700'}`}>Balance {rupees(c.balance)}</div>
                  {c.pendingAmount > 0 && <div className="text-[11px] text-amber-700">+{rupees(c.pendingAmount)} pending</div>}
                </div>
                <div className="text-xs text-slate-700">
                  {c.lastPaymentAt ? (
                    <>
                      {rupees(c.lastPaymentAmount)}
                      <div className="text-[11px] text-slate-500">{fmtDate(c.lastPaymentAt)}</div>
                    </>
                  ) : (
                    '-'
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <PaymentStatusBadge status={c.paymentStatus} />
                  {onboardingBadge(c)}
                </div>
                <div className="text-xs text-slate-700">
                  {accounts ? (
                    <div className="space-y-1">
                      <div>{c.accountsOwner?.fullName ?? <span className="text-slate-400">Not assigned</span>}</div>
                      {c.followUp && <FollowUpBadge status={c.followUp.status} />}
                      {c.followUp?.nextAt && c.followUp.status !== 'FULLY_PAID' && <div className="text-[11px] text-slate-500">Next {fmtDateTime(c.followUp.nextAt)}</div>}
                    </div>
                  ) : (
                    c.salesperson?.fullName ?? '-'
                  )}
                </div>
                <ChevronRight className="hidden lg:block w-4 h-4 text-slate-300" aria-hidden="true" />
              </li>
            ))}
          </ul>
          {data && <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />}
        </div>
      )}

      {open && (
        <Modal title={open.company || open.name} wide onClose={() => { setOpen(null); load(); }}>
          <Detail
            item={open}
            mode={mode}
            onOpenOnboarding={id => {
              setOpen(null);
              onOpenOnboarding?.(id);
            }}
            onChanged={() => {
              load();
              onCountsChanged?.();
            }}
          />
        </Modal>
      )}
    </div>
  );
};
