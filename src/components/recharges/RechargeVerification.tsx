import React, { useState } from 'react';
import { BadgeCheck, Search, X } from 'lucide-react';
import type { RechargeKind } from '../../../shared/contracts';
import { Card, ErrorBanner, Field, Pager, Spinner, btn, inputCls, selectCls } from '../team-member/pipeline/shared';
import { RechargeDetail } from './RechargeDetail';
import { RechargeTable, Stat } from './RechargeTable';
import { KIND_LABEL, rechargeMoney } from './rechargeParts';
import { useRecharges } from './useRecharges';

/** The queues Accounts work through. Each is a filter of the same persistent records (nothing here depends on an e-mail or a notification). */
const SECTIONS = [
  { id: 'pending', label: 'Pending verification', payment: 'PENDING_VERIFICATION', invoice: '' },
  { id: 'received', label: 'Payment received', payment: 'PAYMENT_RECEIVED', invoice: '' },
  { id: 'not-received', label: 'Payment not received', payment: 'PAYMENT_NOT_RECEIVED', invoice: '' },
  { id: 'rejected', label: 'Rejected', payment: 'REJECTED', invoice: '' },
  { id: 'ready', label: 'Ready for invoice', payment: 'PAYMENT_RECEIVED', invoice: 'NOT_GENERATED' },
  { id: 'invoiced', label: 'Invoices generated', payment: '', invoice: 'GENERATED_ANY' },
  { id: 'delivery', label: 'Invoice delivery', payment: '', invoice: 'DELIVERY_ANY' }
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

/** Accounts dashboard: verify that the payment really arrived, correct the billing details, and see what is ready for an invoice. */
export const RechargeVerification: React.FC = () => {
  const [section, setSection] = useState<SectionId>('pending');
  const [kind, setKind] = useState<'' | RechargeKind>('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [openId, setOpenId] = useState<string | null>(null);
  const sec = SECTIONS.find(s => s.id === section)!;
  const { data, error, loading, reload } = useRecharges({
    kind: kind || undefined, search, paymentStatus: sec.payment, invoiceStatus: sec.invoice, from, to, min: min === '' ? '' : Number(min), max: max === '' ? '' : Number(max), limit: pageSize, offset: (page - 1) * pageSize
  });
  const sum = data?.summary;
  const counts: Record<SectionId, number | undefined> = {
    pending: sum?.pending, received: sum?.received, 'not-received': sum?.notReceived, rejected: sum?.rejected, ready: sum?.readyForInvoice, invoiced: sum?.invoiced, delivery: sum?.delivered === undefined ? undefined : sum.delivered + sum.deliveryFailed
  };
  const dirty = kind || search || from || to || min || max;
  const reset = (fn: () => void) => { fn(); setPage(1); };
  return (
    <div className="space-y-4" data-testid="recharge-verification">
      <div className="min-w-0">
        <h1 className="text-lg font-extrabold text-slate-900 flex items-center gap-2"><BadgeCheck className="w-5 h-5 text-indigo-600" aria-hidden /> Recharge verification</h1>
        <p className="text-xs text-slate-500 mt-0.5">Panel and Message recharges submitted by Support. Check that each payment really arrived: the screenshot is only proof, never confirmation.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3" data-testid="recharge-summary">
        <Stat testId="stat-pending" label="Pending verification" value={sum ? sum.pending.toLocaleString('en-IN') : '–'} hint={sum ? rechargeMoney(sum.pendingAmount) : undefined} />
        <Stat testId="stat-received" label="Payment received" value={sum ? sum.received.toLocaleString('en-IN') : '–'} hint={sum ? rechargeMoney(sum.receivedAmount) : undefined} />
        <Stat testId="stat-not-received" label="Payment not received" value={sum ? sum.notReceived.toLocaleString('en-IN') : '–'} />
        <Stat testId="stat-rejected" label="Rejected" value={sum ? sum.rejected.toLocaleString('en-IN') : '–'} />
        <Stat testId="stat-ready" label="Ready for invoice" value={sum ? sum.readyForInvoice.toLocaleString('en-IN') : '–'} />
        <Stat testId="stat-invoiced" label="Invoices generated" value={sum ? sum.invoiced.toLocaleString('en-IN') : '–'} />
      </div>

      <div role="tablist" aria-label="Recharge queues" className="flex gap-1 p-1 rounded-xl bg-slate-100 overflow-x-auto">
        {SECTIONS.map(s => (
          <button key={s.id} type="button" role="tab" aria-selected={section === s.id} data-testid={`section-${s.id}`} onClick={() => { setSection(s.id); setPage(1); }}
            className={`px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap ${section === s.id ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}>
            {s.label}{counts[s.id] !== undefined ? <>{' '}<span className="ml-0.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700">{counts[s.id]}</span></> : null}
          </button>
        ))}
      </div>

      <Card className="p-3 sm:p-4">
        <form className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" role="search" aria-label="Filter recharges" onSubmit={e => e.preventDefault()}>
          <Field label="Customer, e-mail or payment reference" htmlFor="rv-f-search">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <input id="rv-f-search" className={`${inputCls} pl-8`} type="search" placeholder="Search" value={search} maxLength={100} onChange={e => reset(() => setSearch(e.target.value))} />
            </div>
          </Field>
          <Field label="Type" htmlFor="rv-f-kind">
            <select id="rv-f-kind" className={`${selectCls} w-full`} value={kind} onChange={e => reset(() => setKind(e.target.value as '' | RechargeKind))}>
              <option value="">Panel and Message</option><option value="PANEL">{KIND_LABEL.PANEL}</option><option value="MESSAGE">{KIND_LABEL.MESSAGE}</option>
            </select>
          </Field>
          <Field label="From date" htmlFor="rv-f-from"><input id="rv-f-from" type="date" className={inputCls} value={from} max={to || undefined} onChange={e => reset(() => setFrom(e.target.value))} /></Field>
          <Field label="To date" htmlFor="rv-f-to"><input id="rv-f-to" type="date" className={inputCls} value={to} min={from || undefined} onChange={e => reset(() => setTo(e.target.value))} /></Field>
          <Field label="Min total (₹)" htmlFor="rv-f-min"><input id="rv-f-min" className={inputCls} inputMode="decimal" placeholder="0" value={min} onChange={e => reset(() => setMin(e.target.value.replace(/[^0-9.]/g, '')))} /></Field>
          <Field label="Max total (₹)" htmlFor="rv-f-max"><input id="rv-f-max" className={inputCls} inputMode="decimal" placeholder="Any" value={max} onChange={e => reset(() => setMax(e.target.value.replace(/[^0-9.]/g, '')))} /></Field>
          <div className="flex items-end">
            <button type="button" className={`${btn.secondary} w-full sm:w-auto`} disabled={!dirty} onClick={() => { setKind(''); setSearch(''); setFrom(''); setTo(''); setMin(''); setMax(''); setPage(1); }}><X className="w-3.5 h-3.5" aria-hidden /> Clear filters</button>
          </div>
        </form>
      </Card>

      {error && <ErrorBanner message={error} onRetry={reload} />}
      <Card className="overflow-hidden">
        {loading && !data ? <Spinner label="Loading recharges…" /> : data && data.items.length === 0 && !error ? (
          <div className="py-12 px-4 text-center" data-testid="recharge-empty">
            <BadgeCheck className="w-8 h-8 mx-auto text-slate-300" aria-hidden />
            <p className="mt-2 text-sm font-semibold text-slate-700">{dirty ? 'No recharges match these filters.' : `Nothing in “${sec.label}”.`}</p>
          </div>
        ) : data && (
          <div className={loading ? 'opacity-60 transition-opacity' : ''} aria-busy={loading}>
            <RechargeTable items={data.items} showKind showRecorder onView={setOpenId} />
            <Pager page={page} pageSize={pageSize} total={data.total} noun="recharges" onPage={setPage} onPageSize={n => { setPageSize(n); setPage(1); }} />
          </div>
        )}
      </Card>
      {openId && <RechargeDetail id={openId} onClose={() => setOpenId(null)} onEdit={() => undefined} onChanged={reload} />}
    </div>
  );
};
