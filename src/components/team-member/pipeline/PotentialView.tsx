import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IndianRupee, Search, Undo2 } from 'lucide-react';
import type { Paginated, PaymentFilter, PaymentMethod, PipelineCounts, PipelineCustomer } from '../../../../shared/contracts';
import { PAYMENT_METHODS } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { pipelineApi, type PipelineQuery } from '../../../lib/api/endpoints';
import {
  Avatar,
  blockDecimals,
  btn,
  Card,
  dayDiff,
  Dialog,
  ErrorBanner,
  Field,
  inputCls,
  money,
  notifyPipelineChanged,
  PAYMENT_METHOD_LABEL,
  Pager,
  Pill,
  relativeDays,
  selectCls,
  ServiceChips,
  shortDate,
  Spinner,
  todayIso,
  useDebounced,
  usePipelineRealtime,
  useServiceCatalog
} from './shared';

/** Same rules as the database (customers.fully_paid, customer_pipeline_counts). */
const isFullyPaid = (c: PipelineCustomer) => !!c.dealAmount && c.dealAmount > 0 && c.amountReceived >= c.dealAmount;
const paymentState = (c: PipelineCustomer): PaymentFilter => {
  if (isFullyPaid(c)) return 'PAID';
  if (c.paymentDueDate && dayDiff(c.paymentDueDate) < 0) return 'OVERDUE';
  return c.amountReceived > 0 ? 'PART_PAID' : 'AWAITING';
};
const PAYMENT_PILL = {
  AWAITING: { tone: 'orange', label: 'Awaiting' },
  PART_PAID: { tone: 'indigo', label: 'Part paid' },
  OVERDUE: { tone: 'red', label: 'Overdue' },
  PAID: { tone: 'green', label: 'Paid in full' }
} as const;

function dueText(iso: string | null): { text: string; cls: string } {
  if (!iso) return { text: '', cls: '' };
  const d = dayDiff(iso);
  if (d < 0) return { text: `${-d} day${d === -1 ? '' : 's'} overdue`, cls: 'text-rose-700 font-semibold' };
  if (d === 0) return { text: 'Today', cls: 'text-orange-700 font-semibold' };
  if (d === 1) return { text: 'Tomorrow', cls: 'text-orange-700' };
  return { text: `In ${d} days`, cls: 'text-slate-500' };
}

export const PotentialView: React.FC<{ counts: PipelineCounts | null; ownOnly?: boolean; onStarted: (id: string) => void }> = ({ counts, ownOnly, onStarted }) => {
  const { items: services, byCode } = useServiceCatalog();
  const [filter, setFilter] = useState<'' | PaymentFilter>('');
  const [search, setSearch] = useState('');
  const [service, setService] = useState('');
  const [sort, setSort] = useState<PipelineQuery['sort']>('dueDate');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState<Paginated<PipelineCustomer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<PipelineCustomer | null>(null);
  const [paying, setPaying] = useState<PipelineCustomer | null>(null);
  const [backingOut, setBackingOut] = useState<PipelineCustomer | null>(null);
  const debounced = useDebounced(search.trim());
  const seqRef = useRef(0);

  const load = useCallback(() => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(null);
    pipelineApi
      .list({ stage: 'POTENTIAL', mine: ownOnly || undefined, page, pageSize, search: debounced || undefined, service: service || undefined, payment: filter || undefined, sort })
      .then(
        r => seq === seqRef.current && setData(r),
        e => seq === seqRef.current && setError(errorMessage(e))
      )
      .finally(() => seq === seqRef.current && setLoading(false));
  }, [page, pageSize, debounced, service, filter, sort, ownOnly]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [debounced, service, filter, sort, pageSize]);
  usePipelineRealtime(load);

  const cards: { key: '' | PaymentFilter; label: string; hint: string; dot: string }[] = [
    { key: '', label: 'All potential', hint: 'Every potential customer', dot: 'bg-slate-900' },
    { key: 'AWAITING', label: 'Awaiting payment', hint: 'No payment yet', dot: 'bg-orange-500' },
    { key: 'PART_PAID', label: 'Part paid', hint: 'Balance still due', dot: 'bg-indigo-500' },
    { key: 'OVERDUE', label: 'Overdue', hint: 'Past the due date', dot: 'bg-rose-500' },
    { key: 'PAID', label: 'Paid in full', hint: 'Ready to start onboarding', dot: 'bg-emerald-500' }
  ];
  const items = data?.items || [];
  const allChecked = items.length > 0 && items.every(i => selected.has(i.id));
  const reminderTargets = items.filter(i => selected.has(i.id) && (i.whatsapp || i.phone));

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-slate-500">Pipeline / Potential</p>
        <h1 className="text-2xl font-bold text-slate-900 mt-1">Potential customers</h1>
        <p className="text-sm text-slate-500 mt-0.5">Ready to buy. When payment is received, confirm it to start onboarding.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" role="group" aria-label="Payment filter">
        {cards.map(c => {
          const active = filter === c.key;
          const n = counts ? (c.key ? counts.potential[c.key] : counts.potential.all) : null;
          return (
            <button
              key={c.key || 'ALL'}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(c.key)}
              className={`text-left p-4 rounded-2xl bg-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                active ? 'border-2 border-slate-900' : 'border border-slate-200/80 hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                {c.label}
              </div>
              <div className="text-2xl font-bold text-slate-900 mt-1">{n === null ? '—' : n.toLocaleString('en-IN')}</div>
              <div className="text-[11px] text-slate-500">{c.hint}</div>
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 flex flex-col lg:flex-row gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search potential customers</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search customer, business, phone or service"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </label>
          <select aria-label="Filter by service" className={selectCls} value={service} onChange={e => setService(e.target.value)}>
            <option value="">All services</option>
            {services.map(s => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          <select aria-label="Sort" className={selectCls} value={sort} onChange={e => setSort(e.target.value as PipelineQuery['sort'])}>
            <option value="dueDate">Due date (soonest)</option>
            <option value="newest">Recently moved</option>
            <option value="amount">Amount (highest)</option>
            <option value="name">Business name</option>
          </select>
          {selected.size > 0 && (
            <button
              type="button"
              className={btn.secondary}
              disabled={reminderTargets.length === 0}
              onClick={() => {
                // Opens one WhatsApp chat per selected customer (no messages are sent automatically).
                for (const c of reminderTargets) {
                  const due = c.dealAmount !== null ? money(c.dealAmount - c.amountReceived) : '';
                  const text = `Hello ${c.name}, a gentle reminder about the pending payment of ${due} due on ${shortDate(c.paymentDueDate)}. Thank you!`;
                  window.open(`https://wa.me/${(c.whatsapp || c.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
                }
              }}
            >
              Send reminder ({reminderTargets.length})
            </button>
          )}
        </div>
        {error && (
          <div className="px-4 pb-4">
            <ErrorBanner message={error} onRetry={load} />
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[900px]">
            <thead className="text-[11px] text-slate-500 bg-slate-50/60">
              <tr>
                <th scope="col" className="px-4 py-2.5 w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    className="w-4 h-4 accent-indigo-600"
                    checked={allChecked}
                    onChange={() => setSelected(allChecked ? new Set() : new Set(items.map(i => i.id)))}
                  />
                </th>
                <th scope="col" className="px-2 py-2.5 font-medium">Customer</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Services</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Amount</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Due date</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Payment</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100" aria-busy={loading}>
              {loading && !data ? (
                <tr>
                  <td colSpan={7}>
                    <Spinner label="Loading potential customers…" />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-slate-500">
                    {filter || debounced || service ? 'No potential customers match these filters.' : 'No potential customers yet. Move a lead here once they are ready to buy.'}
                  </td>
                </tr>
              ) : (
                items.map(c => {
                  const st = paymentState(c);
                  const due = dueText(c.paymentDueDate);
                  const pct = c.dealAmount ? Math.min(100, Math.round((c.amountReceived / c.dealAmount) * 100)) : 0;
                  const fresh = dayDiff(c.stageChangedAt) === 0 && Date.now() - new Date(c.stageChangedAt).getTime() < 10 * 60000;
                  return (
                    <tr key={c.id} className={`${fresh ? 'bg-emerald-50/60' : 'hover:bg-slate-50/60'} ${loading ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${c.company || c.name}`}
                          className="w-4 h-4 accent-indigo-600"
                          checked={selected.has(c.id)}
                          onChange={() =>
                            setSelected(s => {
                              const n = new Set(s);
                              n.has(c.id) ? n.delete(c.id) : n.add(c.id);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={c.company || c.name} />
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 text-[13px]">{c.company || c.name}</div>
                            <div className="text-xs text-slate-500">
                              {c.name} · moved {fresh ? 'just now from Leads' : relativeDays(c.stageChangedAt)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ServiceChips codes={c.services} catalog={byCode} />
                      </td>
                      <td className="px-4 py-3 min-w-[170px]">
                        <div className="font-bold text-slate-900">{money(c.dealAmount)}</div>
                        <div
                          className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden"
                          role="progressbar"
                          aria-label="Amount received"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1">
                          {isFullyPaid(c)
                            ? `${money(c.amountReceived)} received · nothing due`
                            : c.amountReceived > 0
                              ? `${money(c.amountReceived)} received · ${money((c.dealAmount || 0) - c.amountReceived)} due`
                              : 'Nothing received yet'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        <div className="font-semibold text-slate-900">{shortDate(c.paymentDueDate)}</div>
                        {!isFullyPaid(c) && <div className={due.cls}>{due.text}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <Pill tone={PAYMENT_PILL[st].tone}>{PAYMENT_PILL[st].label}</Pill>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button type="button" className={`${btn.green} whitespace-nowrap`} onClick={() => setConfirming(c)}>
                            Confirm &amp; start onboarding
                          </button>
                          {!isFullyPaid(c) && (
                            <button
                              type="button"
                              className={`${btn.secondary} px-2`}
                              onClick={() => setPaying(c)}
                              aria-label={`Record the first payment for ${c.company || c.name}`}
                              title="Record first payment (starts onboarding)"
                            >
                              <IndianRupee className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {c.amountReceived === 0 && (
                            <button
                              type="button"
                              className={`${btn.secondary} px-2`}
                              onClick={() => setBackingOut(c)}
                              aria-label={`Customer backed out: ${c.company || c.name}`}
                              title="Customer backed out — move back to Leads"
                            >
                              <Undo2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {data && (
          <Pager page={page} pageSize={pageSize} total={data.total} noun="" onPage={setPage} onPageSize={setPageSize} sizes={[10, 20, 50]} />
        )}
      </Card>

      {confirming && (
        <PaymentDialog
          mode="onboard"
          customer={confirming}
          onClose={() => setConfirming(null)}
          onDone={c => {
            setConfirming(null);
            notifyPipelineChanged();
            onStarted(c.id);
          }}
        />
      )}
      {paying && (
        <PaymentDialog
          mode="part"
          customer={paying}
          onClose={() => setPaying(null)}
          onDone={c => {
            // The first payment starts onboarding.
            setPaying(null);
            notifyPipelineChanged();
            if (c.lifecycleStage === 'ONBOARDING') onStarted(c.id);
            else load();
          }}
        />
      )}
      {backingOut && (
        <BackOutDialog
          customer={backingOut}
          onClose={() => setBackingOut(null)}
          onDone={() => {
            setBackingOut(null);
            notifyPipelineChanged();
            load();
          }}
        />
      )}
    </div>
  );
};

export const PaymentDialog: React.FC<{
  mode: 'onboard' | 'part';
  customer: PipelineCustomer;
  onClose: () => void;
  onDone: (c: PipelineCustomer) => void;
}> = ({ mode, customer, onClose, onDone }) => {
  const deal = customer.dealAmount || 0;
  const already = customer.amountReceived;
  const balance = Math.max(0, deal - already);
  const firstPayment = customer.lifecycleStage === 'POTENTIAL';
  // Onboarding asks for the TOTAL received (prefilled with the deal amount); a
  // part payment asks for the amount received now.
  const [amount, setAmount] = useState(mode === 'onboard' ? String(deal || already) : '');
  const [method, setMethod] = useState<PaymentMethod>('UPI');
  const [handover, setHandover] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount || 0);
    if (!Number.isFinite(n) || n < 0) return setError('Enter the amount in rupees.');
    if (!Number.isInteger(n)) return setError('Enter whole rupees only (no paise), e.g. 15000.');
    let receivedNow = n;
    if (mode === 'onboard') {
      if (n > deal) return setError(`The total received can't be more than the deal amount (${money(deal)}).`);
      if (n < already) return setError(`${money(already)} has already been recorded for this customer. Enter the total received so far.`);
      receivedNow = n - already;
    } else {
      if (n <= 0) return setError('Enter the amount received.');
      if (n > balance) return setError(`Only ${money(balance)} is still due on this deal.`);
    }
    setBusy(true);
    setError(null);
    try {
      // Waits for the server to confirm before the customer moves (no optimistic update).
      const c =
        mode === 'onboard'
          ? await pipelineApi.startOnboarding(customer.id, { amountReceived: receivedNow, paymentMethod: method, targetHandoverDate: handover || null })
          : await pipelineApi.recordPayment(customer.id, { amount: receivedNow, method });
      onDone(c);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={mode === 'onboard' ? 'Confirm payment & start onboarding' : firstPayment ? 'Record first payment & start onboarding' : 'Record payment'}
      description={`${customer.company || customer.name} · deal ${money(customer.dealAmount)} · ${money(customer.amountReceived)} received so far`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label={mode === 'onboard' ? 'Total amount received (₹)' : 'Amount received now (₹)'} required htmlFor="pay-amount">
          <input id="pay-amount" type="number" min={0} step={1} inputMode="numeric" className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} onKeyDown={blockDecimals} />
        </Field>
        <p className="text-[11px] text-slate-500 -mt-1">
          {mode === 'onboard'
            ? balance === 0
              ? 'Paid in full.'
              : `Deal ${money(deal)}${already ? ` · ${money(already)} already recorded` : ''}. Enter everything received so far.`
            : `${money(balance)} still due.`}
        </p>
        <Field label="Payment method" required htmlFor="pay-method">
          <select id="pay-method" className={inputCls} value={method} onChange={e => setMethod(e.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map(m => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </Field>
        {mode === 'onboard' && (
          <Field label="Target handover date" htmlFor="pay-handover">
            <input id="pay-handover" type="date" min={todayIso()} className={inputCls} value={handover} onChange={e => setHandover(e.target.value)} />
          </Field>
        )}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={mode === 'onboard' ? btn.green : btn.primary} disabled={busy}>
            {busy ? 'Saving…' : mode === 'onboard' ? 'Confirm & start onboarding' : firstPayment ? 'Record & start onboarding' : 'Record payment'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

const BackOutDialog: React.FC<{ customer: PipelineCustomer; onClose: () => void; onDone: () => void }> = ({ customer, onClose, onDone }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.backOut(customer.id, reason.trim() || null);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="Customer backed out"
      description={`${customer.company || customer.name} goes back to Leads (deal ${money(customer.dealAmount)} is cleared) so you can follow up again.`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label="Reason (optional)" htmlFor="back-out-reason">
          <textarea id="back-out-reason" rows={2} maxLength={500} className={inputCls} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Found a cheaper option" />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btn.danger} disabled={busy}>
            {busy ? 'Moving…' : 'Move back to Leads'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};
