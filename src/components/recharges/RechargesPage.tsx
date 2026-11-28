import React, { useState } from 'react';
import { Plus, Receipt, Search, X } from 'lucide-react';
import type { RechargeKind, RechargeInvoiceStatus, RechargePaymentStatus, SupportRecharge } from '../../../shared/contracts';
import { Card, ErrorBanner, Field, Pager, Spinner, btn, inputCls, selectCls } from '../team-member/pipeline/shared';
import { RechargeDetail } from './RechargeDetail';
import { RechargeForm } from './RechargeForm';
import { RechargeTable, Stat } from './RechargeTable';
import { RmPerformance } from './RmPerformance';
import { INVOICE_LABEL, KIND_LABEL, PAYMENT_LABEL, PAYMENT_STATUSES, rechargeMoney } from './rechargeParts';
import { useRecharges } from './useRecharges';

interface Filters { search: string; payment: '' | RechargePaymentStatus; invoice: '' | RechargeInvoiceStatus; from: string; to: string; min: string; max: string; page: number; pageSize: number }
const EMPTY: Filters = { search: '', payment: '', invoice: '', from: '', to: '', min: '', max: '', page: 1, pageSize: 20 };
type Tab = RechargeKind | 'PERFORMANCE';
const TABS: { id: Tab; label: string }[] = [{ id: 'PANEL', label: KIND_LABEL.PANEL }, { id: 'MESSAGE', label: KIND_LABEL.MESSAGE }, { id: 'PERFORMANCE', label: 'RM performance' }];

/** The list of one kind (Panel or Message): its own filters, summary cards and records. */
const KindTab: React.FC<{ kind: RechargeKind; f: Filters; setF: (p: Partial<Filters>, keepPage?: boolean) => void; clear: () => void }> = ({ kind, f, setF, clear }) => {
  const { data, error, loading, reload } = useRecharges({
    kind, search: f.search, paymentStatus: f.payment, invoiceStatus: f.invoice, from: f.from, to: f.to, min: f.min === '' ? '' : Number(f.min), max: f.max === '' ? '' : Number(f.max),
    limit: f.pageSize, offset: (f.page - 1) * f.pageSize
  });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SupportRecharge | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const dirty = f.search || f.payment || f.invoice || f.from || f.to || f.min || f.max;
  const sum = data?.summary;
  const roleHint = data?.role === 'MEMBER' ? 'Your recharges, and the recharges made for your customers' : data?.role === 'LEAD' ? 'Your team’s recharges' : data?.role === 'HEAD' ? 'The department’s recharges' : data ? 'All recharges' : '';
  const saved = (r: SupportRecharge, was: 'submitted to Accounts' | 'updated') => { setCreating(false); setEditing(null); setOpenId(null); setNotice(`${r.reference} was ${was}.`); reload(); };
  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-xs text-slate-500">{roleHint || ' '}</p>
        {data?.canCreate && (
          <button type="button" className={`${btn.primary} w-full sm:w-auto`} onClick={() => { setNotice(''); setCreating(true); }}>
            <Plus className="w-3.5 h-3.5" aria-hidden /> Create {KIND_LABEL[kind]}
          </button>
        )}
      </div>
      {notice && <div role="status" className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-3 py-2" data-testid="recharge-notice">{notice}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-3" data-testid="recharge-summary">
        <Stat testId="stat-total" label="Total recharges" value={sum ? sum.totalRecharges.toLocaleString('en-IN') : '–'} />
        <Stat testId="stat-amount" label="Total recharge amount" value={sum ? rechargeMoney(sum.totalAmount) : '–'} />
        <Stat testId="stat-gst" label="Total GST" value={sum ? rechargeMoney(sum.totalGst) : '–'} />
        <Stat testId="stat-non-gst" label="Total Non-GST" value={sum ? rechargeMoney(sum.totalNonGst) : '–'} />
        <Stat testId="stat-pending" label="Pending verification" value={sum ? sum.pending.toLocaleString('en-IN') : '–'} hint={sum ? rechargeMoney(sum.pendingAmount) : undefined} />
        <Stat testId="stat-received" label="Payment received" value={sum ? sum.received.toLocaleString('en-IN') : '–'} hint={sum ? rechargeMoney(sum.receivedAmount) : undefined} />
      </div>

      <Card className="p-3 sm:p-4">
        <form className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" role="search" aria-label="Filter recharges" onSubmit={e => e.preventDefault()}>
          <Field label="Customer or reference" htmlFor="rc-f-search">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
              <input id="rc-f-search" className={`${inputCls} pl-8`} type="search" placeholder="Search by customer" value={f.search} maxLength={100} onChange={e => setF({ search: e.target.value })} />
            </div>
          </Field>
          <Field label="Payment status" htmlFor="rc-f-payment">
            <select id="rc-f-payment" className={`${selectCls} w-full`} value={f.payment} onChange={e => setF({ payment: e.target.value as Filters['payment'] })}>
              <option value="">All</option>
              {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{PAYMENT_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Invoice status" htmlFor="rc-f-invoice">
            <select id="rc-f-invoice" className={`${selectCls} w-full`} value={f.invoice} onChange={e => setF({ invoice: e.target.value as Filters['invoice'] })}>
              <option value="">All</option>
              {(Object.keys(INVOICE_LABEL) as RechargeInvoiceStatus[]).map(s => <option key={s} value={s}>{INVOICE_LABEL[s]}</option>)}
            </select>
          </Field>
          <div className="hidden lg:block" />
          <Field label="From date" htmlFor="rc-f-from"><input id="rc-f-from" type="date" className={inputCls} value={f.from} max={f.to || undefined} onChange={e => setF({ from: e.target.value })} /></Field>
          <Field label="To date" htmlFor="rc-f-to"><input id="rc-f-to" type="date" className={inputCls} value={f.to} min={f.from || undefined} onChange={e => setF({ to: e.target.value })} /></Field>
          <Field label="Min amount (₹)" htmlFor="rc-f-min"><input id="rc-f-min" className={inputCls} inputMode="decimal" placeholder="0" value={f.min} onChange={e => setF({ min: e.target.value.replace(/[^0-9.]/g, '') })} /></Field>
          <Field label="Max amount (₹)" htmlFor="rc-f-max"><input id="rc-f-max" className={inputCls} inputMode="decimal" placeholder="Any" value={f.max} onChange={e => setF({ max: e.target.value.replace(/[^0-9.]/g, '') })} /></Field>
          <div className="flex items-end">
            <button type="button" className={`${btn.secondary} w-full sm:w-auto`} disabled={!dirty} onClick={clear}><X className="w-3.5 h-3.5" aria-hidden /> Clear filters</button>
          </div>
        </form>
      </Card>

      {error && <ErrorBanner message={error} onRetry={reload} />}
      <Card className="overflow-hidden">
        {loading && !data ? <Spinner label="Loading recharges…" /> : data && data.items.length === 0 && !error ? (
          <div className="py-12 px-4 text-center" data-testid="recharge-empty">
            <Receipt className="w-8 h-8 mx-auto text-slate-300" aria-hidden />
            <p className="mt-2 text-sm font-semibold text-slate-700">{dirty ? 'No recharges match these filters.' : `No ${KIND_LABEL[kind].toLowerCase()}s yet.`}</p>
            <p className="text-xs text-slate-500">{dirty ? 'Change or clear the filters.' : data.canCreate ? 'Use the Create button to record the first one.' : ''}</p>
          </div>
        ) : data && (
          <div className={loading ? 'opacity-60 transition-opacity' : ''} aria-busy={loading}>
            <RechargeTable items={data.items} showRecorder={data.role !== 'MEMBER'} onView={setOpenId} onEdit={setEditing} />
            <Pager page={f.page} pageSize={f.pageSize} total={data.total} noun="recharges" onPage={p => setF({ page: p }, true)} onPageSize={n => setF({ pageSize: n })} />
          </div>
        )}
      </Card>

      {creating && <RechargeForm kind={kind} onClose={() => setCreating(false)} onSaved={r => saved(r, 'submitted to Accounts')} />}
      {editing && <RechargeForm kind={editing.kind} existing={editing} onClose={() => setEditing(null)} onSaved={r => saved(r, 'updated')} />}
      {openId && !editing && <RechargeDetail id={openId} onClose={() => setOpenId(null)} onEdit={r => setEditing(r)} onChanged={reload} />}
    </div>
  );
};

/**
 * Recharges (Support dashboards): Panel Recharge and Message Recharge are two tabs over the same screen, each with its own records, summary and filters, plus the
 * Relationship Managers' verified totals. Who sees what and what each person may do is decided by the database; this screen only shows what it was given.
 */
export const RechargesPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('PANEL');
  const [filters, setFilters] = useState<Record<RechargeKind, Filters>>({ PANEL: EMPTY, MESSAGE: EMPTY });
  const setF = (kind: RechargeKind) => (patch: Partial<Filters>, keepPage?: boolean) => setFilters(s => ({ ...s, [kind]: { ...s[kind], ...(keepPage ? {} : { page: 1 }), ...patch } }));
  const clear = (kind: RechargeKind) => () => setFilters(s => ({ ...s, [kind]: { ...EMPTY, pageSize: s[kind].pageSize } }));
  return (
    <div className="space-y-4" data-testid="recharges-page">
      <div className="min-w-0">
        <h1 className="text-lg font-extrabold text-slate-900 flex items-center gap-2"><Receipt className="w-5 h-5 text-indigo-600" aria-hidden /> Recharges</h1>
        <p className="text-xs text-slate-500 mt-0.5">Record a recharge for a customer. It goes to Accounts, who check the payment; the Relationship Manager of the customer gets the credit once it is confirmed.</p>
      </div>
      <div role="tablist" aria-label="Recharge type" className="flex gap-1 p-1 rounded-xl bg-slate-100 w-full sm:w-fit overflow-x-auto">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" id={`rc-tab-${t.id}`} aria-selected={tab === t.id} aria-controls="rc-panel" data-testid={`tab-${t.id}`}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap ${tab === t.id ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
            onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div id="rc-panel" role="tabpanel" aria-labelledby={`rc-tab-${tab}`}>
        {tab === 'PERFORMANCE' ? <RmPerformance /> : <KindTab key={tab} kind={tab} f={filters[tab]} setF={setF(tab)} clear={clear(tab)} />}
      </div>
    </div>
  );
};
