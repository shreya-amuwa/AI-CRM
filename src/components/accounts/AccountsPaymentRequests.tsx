import React, { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Building2, CheckCircle2, MessageSquare, Phone, Search, Undo2 } from 'lucide-react';
import type { PaymentOverview, PaymentRequestItem } from '../../../shared/contracts';
import { pipelineApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { Empty, ErrorBanner, inputClass, Loading, Modal } from '../support-member/SupportParts';
import { fmtDate, fmtDateTime, PaymentStatusBadge, rupees } from '../payments/PaymentBits';
import { AccountsPaymentPanel, ReasonDialog } from './AccountsPaymentPanel';

type Tab = 'PENDING' | 'CONFIRMED' | 'RETURNED';

const Row: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div>
    <dt className="text-[11px] text-slate-400">{k}</dt>
    <dd className="text-sm font-semibold text-slate-900 mt-0.5 break-words">{v || '—'}</dd>
  </div>
);

/** Business details, the payments and the two outcomes (confirm & return · customer backed off) for one submission. */
const RequestDetail: React.FC<{
  item: PaymentRequestItem;
  bare?: boolean;
  onChanged: () => void;
  onResolved: (message: string) => void;
}> = ({ item, bare, onChanged, onResolved }) => {
  const [overview, setOverview] = useState<PaymentOverview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [backOpen, setBackOpen] = useState(false);
  const pending = item.status === 'PENDING';
  const name = item.company || item.name;
  const canConfirm = pending && (overview?.verified ?? 0) > 0;

  return (
    <section aria-label={`Details of ${name}`} className={bare ? '' : 'bg-white rounded-2xl border border-slate-200/80'}>
      <div className="p-5 border-b border-slate-100 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900">{name}</h2>
          <p className="text-xs text-slate-500">
            {item.code} · sent {fmtDateTime(item.sentAt)}
            {item.sentBy ? ` by ${item.sentBy}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PaymentStatusBadge status={item.paymentStatus} />
          {item.status === 'CONFIRMED' && (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
              <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> Returned to Sales onboarding
            </span>
          )}
          {item.status === 'RETURNED' && (
            <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2.5 py-1">
              <Undo2 className="w-3.5 h-3.5" aria-hidden="true" /> Backed off — returned to Leads
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-6">
        <div>
          <h3 className="text-xs font-bold text-slate-800 mb-3 flex items-center gap-1.5">
            <Building2 className="w-4 h-4 text-slate-400" aria-hidden="true" /> Customer
          </h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            <Row k="Business / company" v={item.company} />
            <Row k="Contact person" v={item.name} />
            <Row k="Phone" v={item.phone && (<span className="inline-flex items-center gap-1"><Phone className="w-3 h-3 text-slate-400" aria-hidden="true" />{item.phone}</span>)} />
            <Row k="WhatsApp" v={item.whatsapp} />
            <Row k="E-mail" v={item.email} />
            <Row k="City" v={item.city} />
            <Row k="Sold by" v={item.salesperson} />
            <Row k="Customer ID" v={item.code} />
            <Row k="Services" v={item.services.length ? item.services.join(', ') : null} />
            <Row k="Agreed amount" v={rupees(item.agreedAmount)} />
          </dl>
          {item.salesNote && (
            <p className="mt-3 text-xs text-slate-700 bg-slate-50 rounded-xl px-3 py-2">
              <span className="font-semibold">Note from Sales:</span> {item.salesNote}
            </p>
          )}
          {item.lastConversation && (
            <div className="mt-3 text-xs text-slate-700 bg-slate-50 rounded-xl px-3 py-2">
              <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                <MessageSquare className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" /> Last conversation with the customer · {fmtDate(item.lastConversation.at)}
              </div>
              <p className="mt-1 whitespace-pre-line break-words">{item.lastConversation.note}</p>
            </div>
          )}
        </div>

        <AccountsPaymentPanel customerId={item.id} readOnly={item.status === 'RETURNED'} onLoaded={setOverview} onChanged={onChanged} />

        {item.resolvedAt && (
          <p className={`text-xs rounded-xl px-3 py-2 border ${item.status === 'CONFIRMED' ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-rose-800 bg-rose-50 border-rose-200'}`}>
            {item.status === 'CONFIRMED' ? 'Confirmed' : 'Returned to Leads'} {fmtDateTime(item.resolvedAt)}
            {item.resolvedBy ? ` by ${item.resolvedBy}` : ''}
            {item.resolutionNote ? ` · ${item.resolutionNote}` : ''}.
          </p>
        )}
      </div>

      {pending && (
        <div className="p-5 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl space-y-3">
          <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2">
            <button
              type="button"
              onClick={() => setBackOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-rose-200 bg-white text-rose-700 text-sm font-bold hover:bg-rose-50"
            >
              <Undo2 className="w-4 h-4" aria-hidden="true" /> Customer Backed Off — Return to Leads
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={!canConfirm}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Confirm Payment &amp; Return to Sales
            </button>
          </div>
          <p className="text-[11px] text-slate-500 sm:text-right">
            {canConfirm
              ? 'The customer moves to Sales → Customer onboarding. A balance still due stays with you under Part payments.'
              : 'Record the payment and verify it first. Only verified money counts as received.'}
          </p>
        </div>
      )}

      {confirmOpen && (
        <ReasonDialog
          title="Confirm payment & return to Sales"
          description={`${name} moves to Customer onboarding with ${rupees(overview?.verified ?? 0)} verified${(overview?.balance ?? 0) > 0 ? ` and ${rupees(overview?.balance ?? 0)} still to collect` : ''}.`}
          label="Note (optional)"
          action="Confirm & return"
          required={false}
          onClose={() => setConfirmOpen(false)}
          onConfirm={async note => {
            await pipelineApi.confirmPaymentAndReturn(item.id, note);
            setConfirmOpen(false);
            onResolved(`${name} confirmed and returned to Sales for onboarding.`);
          }}
        />
      )}
      {backOpen && (
        <ReasonDialog
          title="Customer backed off"
          description={`${name} goes back to My Leads → Leads for the salesperson to follow up. Their details, conversations and any payment on record are kept.`}
          label="Reason (optional)"
          action="Return to Leads"
          danger
          required={false}
          onClose={() => setBackOpen(false)}
          onConfirm={async reason => {
            await pipelineApi.customerBackedOff(item.id, reason);
            setBackOpen(false);
            onResolved(`${name} returned to Leads.`);
          }}
        />
      )}
    </section>
  );
};

/**
 * Accounts: customers Sales sent for payment confirmation. Record the payment,
 * verify it, then confirm (the customer returns to Customer onboarding) or
 * return the customer to Leads if they back off.
 */
export const AccountsPaymentRequests: React.FC<{ layout?: 'split' | 'popup'; onCountsChanged?: () => void }> = ({ layout = 'split', onCountsChanged }) => {
  const [tab, setTab] = useState<Tab>('PENDING');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<PaymentRequestItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pendingTotal, setPendingTotal] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [page, pending] = await Promise.all([
        pipelineApi.paymentRequests({ status: tab, search: term || undefined, pageSize: 50 }),
        pipelineApi.paymentRequests({ status: 'PENDING', pageSize: 1 })
      ]);
      setItems(page.items);
      setTotal(page.total);
      setPendingTotal(pending.total);
      setSelectedId(cur => (cur && page.items.some(i => i.requestId === cur) ? cur : layout === 'split' ? page.items[0]?.requestId ?? null : null));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [tab, term, layout]);
  useEffect(() => {
    void load();
  }, [load]);

  const selected = items.find(i => i.requestId === selectedId) || null;
  const resolved = (message: string) => {
    setNotice(message);
    if (layout === 'popup') setSelectedId(null);
    onCountsChanged?.();
    void load();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Payment request status" className="flex p-1 rounded-xl bg-slate-100 text-xs font-semibold">
          {(
            [
              ['PENDING', `To confirm${pendingTotal !== null ? ` ${pendingTotal}` : ''}`],
              ['CONFIRMED', 'Confirmed'],
              ['RETURNED', 'Returned to Leads']
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={tab === k}
              onClick={() => {
                setTab(k);
                setNotice(null);
              }}
              className={`px-3.5 py-1.5 rounded-lg ${tab === k ? 'bg-white shadow-xs text-slate-900' : 'text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="relative flex-1 min-w-[12rem] max-w-md">
          <span className="sr-only">Search customers</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, company, phone or customer ID" className={`${inputClass} pl-9`} />
        </label>
      </div>

      {notice && (
        <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2" role="status">
          {notice}
        </p>
      )}
      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {loading && items.length === 0 ? (
        <Loading label="Loading customers…" />
      ) : items.length === 0 ? (
        <Empty
          title={tab === 'PENDING' ? 'Nothing waiting for payment confirmation' : tab === 'CONFIRMED' ? 'No confirmed customers yet' : 'No customer has backed off'}
          hint={tab === 'PENDING' ? 'When Sales sends a lead to Accounts it appears here.' : 'They are listed here once you have handled them.'}
        />
      ) : (
        <div className={layout === 'split' ? 'grid grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)] gap-5 items-start' : ''}>
          <ul className={layout === 'split' ? 'space-y-2' : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3'} aria-label="Customers">
            {items.map(i => (
              <li key={i.requestId}>
                <button
                  type="button"
                  onClick={() => setSelectedId(i.requestId)}
                  aria-current={i.requestId === selectedId ? 'true' : undefined}
                  className={`w-full text-left rounded-xl border p-3 transition-colors ${i.requestId === selectedId ? 'border-blue-400 bg-blue-50/60' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                >
                  <div className="text-sm font-bold text-slate-900 truncate">{i.company || i.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {i.company ? `${i.name} · ` : ''}
                    {i.code}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-800">{rupees(i.agreedAmount)}</span>
                    <span className="text-slate-400">{fmtDate(tab === 'PENDING' ? i.sentAt : i.resolvedAt)}</span>
                  </div>
                  {i.amountRecorded > 0 && (
                    <div className="mt-1 text-[11px] text-slate-500">
                      Verified {rupees(i.amountVerified)}
                      {i.amountRecorded > i.amountVerified ? ` · ${rupees(i.amountRecorded - i.amountVerified)} pending` : ''}
                    </div>
                  )}
                </button>
              </li>
            ))}
            {total > items.length && <li className="text-[11px] text-slate-400 text-center">Showing {items.length} of {total}. Search to narrow down.</li>}
          </ul>

          {selected && layout === 'popup' && (
            <Modal title={selected.company || selected.name} onClose={() => setSelectedId(null)} wide>
              <RequestDetail key={selected.requestId} bare item={selected} onChanged={() => void load()} onResolved={resolved} />
            </Modal>
          )}
          {selected && layout === 'split' && <RequestDetail key={selected.requestId} item={selected} onChanged={() => void load()} onResolved={resolved} />}
        </div>
      )}
    </div>
  );
};
