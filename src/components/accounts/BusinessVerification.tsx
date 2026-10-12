import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BadgeCheck, CheckCircle2, FileText, IndianRupee, MessageSquareWarning, Search, UploadCloud, XCircle } from 'lucide-react';
import type { AddonRequest, AddonRequestPage, AddonRequestStatus, PaymentMethod } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { addonsApi } from '../../lib/api/endpoints';
import { rowOpen } from '../../lib/rowClick';
import {
  btn,
  Dialog,
  ErrorBanner,
  Field,
  inputCls,
  longDate,
  notifyPipelineChanged,
  Pager,
  PAYMENT_METHOD_LABEL,
  Pill,
  selectCls,
  Spinner,
  useDebounced,
  usePipelineRealtime
} from '../team-member/pipeline/shared';
import { addonPaymentState, ADDON_STATUS_LABEL, AddonStatusPill, InvoiceDetail, rupees, Totals } from '../invoices/invoiceShared';
import { UploadInvoiceDialog } from '../invoices/invoiceFiles';
import { AddonEvents } from '../support/consultant/AddonRequestPanel';

const PAGE_SIZE = 20;
const TABS: { key: AddonRequestStatus | ''; label: string }[] = [
  { key: 'PENDING_VERIFICATION', label: 'Pending verification' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'INVOICE_GENERATED', label: 'Pending payment' },
  { key: 'CHANGES_REQUESTED', label: 'Changes requested' },
  { key: 'PAYMENT_CONFIRMED', label: 'Payment confirmed' },
  { key: 'IN_PROGRESS', label: 'Onboarding in progress' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: '', label: 'All' }
];
const METHODS: PaymentMethod[] = ['UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER'];

/**
 * Accounts: "Business Verification". Add-on services the Technical Consultants priced for their
 * customers. Accounts approves, rejects or asks for changes; uploads the add-on invoice PDF for the
 * approved prices; records, verifies and confirms the add-on payment. Each is a separate step, and the
 * database checks every one (role, state, version, amounts) so nothing is approved or invoiced twice.
 */
export const BusinessVerification: React.FC<{ onCountsChanged?: () => void }> = ({ onCountsChanged }) => {
  const [tab, setTab] = useState<AddonRequestStatus | ''>('PENDING_VERIFICATION');
  const [search, setSearch] = useState('');
  const [consultant, setConsultant] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AddonRequestPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const debounced = useDebounced(search.trim());
  const seq = useRef(0);

  const load = useCallback(() => {
    const n = ++seq.current;
    setError(null);
    addonsApi
      .list({ status: tab || undefined, search: debounced || undefined, consultant: consultant || undefined, from: from || undefined, to: to || undefined, page, pageSize: PAGE_SIZE })
      .then(
        r => n === seq.current && setData(r),
        e => n === seq.current && setError(errorMessage(e))
      )
      .finally(() => n === seq.current && setLoading(false));
  }, [tab, debounced, consultant, from, to, page]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [tab, debounced, consultant, from, to]);
  usePipelineRealtime(load);

  const counts = data?.counts || {};
  const total = (k: AddonRequestStatus | '') => (k ? counts[k] ?? 0 : Object.values(counts).reduce((a, b) => a + (b ?? 0), 0));

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Business Verification</h1>
        <p className="text-sm text-slate-500 mt-1">
          Add-on services the Technical Consultants priced for their customers. Verify the business and the prices, then upload the invoice and confirm the payment.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Verification status">
        {TABS.map(t => (
          <button
            key={t.key || 'all'}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${tab === t.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
          >
            {t.label}
            <span className={`ml-1.5 ${tab === t.key ? 'text-blue-100' : 'text-slate-400'}`}>{total(t.key)}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <label className="relative">
          <span className="sr-only">Search business, customer or customer ID</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Business, customer or customer ID"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </label>
        <select aria-label="Technical Consultant" value={consultant} onChange={e => setConsultant(e.target.value)} className={selectCls}>
          <option value="">All consultants</option>
          {data?.consultants.map(c => (
            <option key={c.id} value={c.id}>
              {c.fullName}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          From
          <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className={selectCls} />
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          To
          <input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} className={selectCls} />
        </label>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && !data ? (
        <Spinner label="Loading requests…" />
      ) : data && data.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <BadgeCheck className="w-6 h-6 mx-auto text-slate-300" aria-hidden="true" />
          <div className="text-sm font-bold text-slate-800 mt-2">Nothing here</div>
          <p className="text-xs text-slate-500 mt-1">
            {tab === 'PENDING_VERIFICATION' ? 'No add-on request is waiting for verification.' : 'No request matches these filters.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm min-w-[72rem]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 bg-slate-50/60">
                  <th scope="col" className="px-4 py-3 font-semibold">Client / business</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Client ID</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Original onboarding</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Technical Consultant</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Requested add-ons</th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">Price</th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">Tax / discount</th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">Total</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Payment</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Verification</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Submitted</th>
                  <th scope="col" className="px-4 py-3 font-semibold text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className={loading ? 'opacity-60' : ''}>
                {data?.items.map(r => {
                  const pay = addonPaymentState(r);
                  return (
                    <tr key={r.id} {...rowOpen(() => setOpenId(r.id))} className="border-b border-slate-50 last:border-0 align-top hover:bg-slate-50/50 focus-visible:bg-blue-50/50 focus-visible:outline-none">
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-slate-900">{r.customer}</div>
                        <div className="text-[11px] text-slate-500">{r.contact}</div>
                      </td>
                      <td className="px-3 py-3.5 text-xs text-slate-700">{r.customerCode || '-'}</td>
                      <td className="px-3 py-3.5 text-xs text-slate-700">
                        <div>{r.onboardingReference || '-'}</div>
                        <div className="text-[11px] text-slate-500">{r.originalServices.join(', ')}</div>
                      </td>
                      <td className="px-3 py-3.5 text-xs text-slate-700">{r.consultant?.fullName || '-'}</td>
                      <td className="px-3 py-3.5 text-xs text-slate-700">{r.items.map(i => (i.quantity > 1 ? `${i.name} × ${i.quantity}` : i.name)).join(', ')}</td>
                      <td className="px-3 py-3.5 text-xs text-right">{rupees(r.subtotal)}</td>
                      <td className="px-3 py-3.5 text-xs text-right text-slate-600">
                        +{rupees(r.tax)} / -{rupees(r.discount)}
                      </td>
                      <td className="px-3 py-3.5 text-right font-bold text-slate-900">{rupees(r.total)}</td>
                      <td className="px-3 py-3.5">
                        <Pill tone={pay.tone}>{pay.label}</Pill>
                      </td>
                      <td className="px-3 py-3.5">
                        <AddonStatusPill status={r.status} />
                      </td>
                      <td className="px-3 py-3.5 text-xs text-slate-600 whitespace-nowrap">{longDate(r.submittedAt)}</td>
                      <td className="px-4 py-3.5 text-right">
                        <button type="button" className={btn.secondary} onClick={() => setOpenId(r.id)} aria-label={`Open the request of ${r.customer}`}>
                          Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data && data.total > PAGE_SIZE && <Pager page={page} pageSize={PAGE_SIZE} total={data.total} noun="requests" onPage={setPage} />}
        </div>
      )}

      {openId && (
        <RequestDialog
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => {
            notifyPipelineChanged();
            onCountsChanged?.();
            load();
          }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// One request: verify, invoice, payment
// ---------------------------------------------------------------------------
const RequestDialog: React.FC<{ id: string; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const [r, setR] = useState<AddonRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<null | 'REJECT' | 'CHANGES'>(null);
  const [reason, setReason] = useState('');
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [pay, setPay] = useState({ amount: '', method: 'UPI' as PaymentMethod, reference: '', note: '', verify: true });
  const [rejectPayment, setRejectPayment] = useState<{ id: string; reason: string } | null>(null);
  const [confirmNote, setConfirmNote] = useState('');

  const load = useCallback(() => {
    addonsApi.get(id).then(
      x => {
        setR(x);
        setError(null);
      },
      e => setError(errorMessage(e))
    );
  }, [id]);
  useEffect(load, [load]);
  usePipelineRealtime(() => !busy && load());

  const act = async (fn: () => Promise<AddonRequest>, after?: () => void) => {
    setBusy(true);
    setActionError(null);
    try {
      setR(await fn());
      after?.();
      onChanged();
    } catch (e) {
      setActionError(errorMessage(e));
      load();
    } finally {
      setBusy(false);
    }
  };

  if (!r) {
    return (
      <Dialog title="Add-on request" onClose={onClose} wide>
        {error ? <ErrorBanner message={error} onRetry={load} /> : <Spinner label="Loading request…" />}
      </Dialog>
    );
  }
  const open = Math.max(0, Math.round((r.total - r.paid - r.pendingPayments) * 100) / 100);
  const pState = addonPaymentState(r);
  const pending = (r.payments || []).filter(p => p.status === 'PENDING');

  return (
    <Dialog title={r.customer} description={`Add-on request · ${ADDON_STATUS_LABEL[r.status]}`} onClose={onClose} wide>
      <div className="flex flex-wrap items-center gap-2">
        <AddonStatusPill status={r.status} />
        <Pill tone={pState.tone}>{pState.label}</Pill>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        {(
          [
            ['Client / business', r.customer],
            ['Contact', [r.contact, r.phone].filter(Boolean).join(' · ')],
            ['Client ID', r.customerCode || '-'],
            ['Department', r.department || '-'],
            ['Technical Consultant', r.consultant?.fullName || '-'],
            ['Sold by', r.salesperson || '-'],
            ['Original services', r.originalServices.join(', ') || '-'],
            ['Original deal', `${rupees(r.originalAmount)}${r.onboardingStartedAt ? ` · onboarding since ${longDate(r.onboardingStartedAt)}` : ''}`]
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <dt className="text-[11px] text-slate-500">{k}</dt>
            <dd className="mt-0.5 font-semibold text-slate-800 break-words">{v}</dd>
          </div>
        ))}
      </dl>

      <section aria-label="Requested add-ons" className="space-y-2">
        <h3 className="text-sm font-bold text-slate-900">Requested add-ons</h3>
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="text-left font-semibold px-3 py-2">Service</th>
                <th className="text-right font-semibold px-3 py-2">Qty</th>
                <th className="text-right font-semibold px-3 py-2">Agreed price</th>
                <th className="text-right font-semibold px-3 py-2">Discount</th>
                <th className="text-right font-semibold px-3 py-2">Tax</th>
                <th className="text-right font-semibold px-3 py-2">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.items.map(i => (
                <tr key={i.id || i.name}>
                  <td className="px-3 py-2 text-slate-800">
                    {i.name}
                    {!i.serviceCode && <span className="ml-1 text-[10px] text-slate-400">(typed by the consultant)</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{i.quantity}</td>
                  <td className="px-3 py-2 text-right">{rupees(i.unitPrice)}</td>
                  <td className="px-3 py-2 text-right">{i.discount ? rupees(i.discount) : '-'}</td>
                  <td className="px-3 py-2 text-right">
                    {i.taxPercent}% ({rupees(i.tax ?? 0)})
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{rupees(i.lineTotal ?? null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Totals subtotal={r.subtotal} discount={r.discount} tax={r.tax} total={r.total} />
        {r.notes && <p className="text-xs text-slate-600 whitespace-pre-line">Consultant's notes: {r.notes}</p>}
        {r.decisionNote && (
          <p className="text-xs text-slate-600">
            Last decision by {r.decidedBy || 'Accounts'} on {longDate(r.decidedAt)}: {r.decisionNote}
          </p>
        )}
      </section>

      {actionError && <ErrorBanner message={actionError} />}

      {/* Step 1: verification */}
      {r.status === 'PENDING_VERIFICATION' && (
        <section aria-label="Verify" className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Verify the business and the prices</h3>
          {deciding ? (
            <div className="space-y-2">
              <Field label={deciding === 'REJECT' ? 'Reason for rejecting' : 'What should the consultant change?'} htmlFor="bv-reason" required>
                <textarea id="bv-reason" rows={2} maxLength={1000} className={inputCls} value={reason} onChange={e => setReason(e.target.value)} autoFocus />
              </Field>
              <div className="flex justify-end gap-2">
                <button type="button" className={btn.secondary} disabled={busy} onClick={() => setDeciding(null)}>
                  Back
                </button>
                <button
                  type="button"
                  className={deciding === 'REJECT' ? btn.danger : btn.primary}
                  disabled={busy || !reason.trim()}
                  onClick={() =>
                    void act(
                      () => addonsApi.decide(r.id, { decision: deciding, note: reason.trim(), expectedVersion: r.version }),
                      () => {
                        setDeciding(null);
                        setReason('');
                      }
                    )
                  }
                >
                  {busy ? 'Saving…' : deciding === 'REJECT' ? 'Reject request' : 'Send back for changes'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={btn.danger} disabled={busy} onClick={() => setDeciding('REJECT')}>
                <XCircle className="w-3.5 h-3.5" aria-hidden="true" /> Reject
              </button>
              <button type="button" className={btn.secondary} disabled={busy} onClick={() => setDeciding('CHANGES')}>
                <MessageSquareWarning className="w-3.5 h-3.5" aria-hidden="true" /> Request changes
              </button>
              <button type="button" className={btn.green} disabled={busy} onClick={() => setConfirmApprove(true)}>
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Approve
              </button>
            </div>
          )}
        </section>
      )}

      {/* Step 2: invoice */}
      {r.status === 'APPROVED' && (
        <section aria-label="Upload the add-on invoice" className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Upload the add-on invoice</h3>
          <p className="text-xs text-slate-500">
            The add-ons are approved ({rupees(r.total)}). Upload the invoice PDF for them (PDF only, up to 500 KB). The consultant is told, and the customer can then pay.
          </p>
          <div className="flex justify-end">
            <button type="button" className={btn.primary} disabled={busy} onClick={() => setUploadingInvoice(true)}>
              <UploadCloud className="w-3.5 h-3.5" aria-hidden="true" /> Upload invoice PDF
            </button>
          </div>
        </section>
      )}

      {r.invoice && (
        <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-white border border-slate-200 text-xs">
          <FileText className="w-4 h-4 text-slate-400" aria-hidden="true" />
          <span className="font-semibold text-slate-800">Invoice {r.invoice.number}</span>
          <span className="text-slate-500">
            dated {longDate(r.invoice.issueDate)}
            {r.invoice.dueDate ? ` · due ${longDate(r.invoice.dueDate)}` : ''}
          </span>
          <span className="font-bold text-slate-900">{rupees(r.invoice.total)}</span>
          <button type="button" className={`${btn.secondary} ml-auto`} onClick={() => setShowInvoice(true)}>
            View / download
          </button>
        </div>
      )}

      {/* Step 3: payment (recorded, verified, then confirmed - as for the original payment) */}
      {r.invoice && (
        <section aria-label="Add-on payment" className="space-y-3">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
            <IndianRupee className="w-4 h-4 text-slate-400" aria-hidden="true" /> Add-on payment
          </h3>
          <div className="grid grid-cols-3 gap-3 text-xs">
            {(
              [
                ['Invoice total', rupees(r.total)],
                ['Verified', rupees(r.paid)],
                ['Awaiting verification', rupees(r.pendingPayments)]
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="text-[11px] text-slate-500">{k}</div>
                <div className="text-sm font-bold text-slate-900 mt-0.5">{v}</div>
              </div>
            ))}
          </div>
          {(r.payments || []).length > 0 && (
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl text-xs" aria-label="Payments">
              {(r.payments || []).map(p => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                  <span className="font-bold text-slate-900">{rupees(p.amount)}</span>
                  <span className="text-slate-600">{p.method ? PAYMENT_METHOD_LABEL[p.method] || p.method : '-'}</span>
                  {p.reference && <span className="text-slate-500">Ref {p.reference}</span>}
                  <span className="text-slate-500">{longDate(p.paidAt)}</span>
                  <span className="text-slate-400">recorded by {p.recordedBy || '-'}</span>
                  <span className="ml-auto">
                    {p.status === 'VERIFIED' ? (
                      <Pill tone="green">Verified{p.verifiedBy ? ` by ${p.verifiedBy}` : ''}</Pill>
                    ) : p.status === 'REJECTED' ? (
                      <Pill tone="red">Rejected{p.reason ? `: ${p.reason}` : ''}</Pill>
                    ) : (
                      <Pill tone="orange">Awaiting verification</Pill>
                    )}
                  </span>
                  {p.status === 'PENDING' && r.status === 'INVOICE_GENERATED' && (
                    <span className="flex gap-1.5">
                      <button type="button" className={btn.green} disabled={busy} onClick={() => void act(() => addonsApi.decidePayment(p.id, { decision: 'VERIFY' }))}>
                        Verify
                      </button>
                      <button type="button" className={btn.danger} disabled={busy} onClick={() => setRejectPayment({ id: p.id, reason: '' })}>
                        Reject
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {r.status === 'INVOICE_GENERATED' && open > 0 && (
            <form
              className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3"
              onSubmit={e => {
                e.preventDefault();
                const amount = Number(pay.amount);
                if (!(amount > 0) || Math.round(amount * 100) / 100 !== amount) return setActionError('Enter the amount received in rupees (up to 2 decimals).');
                if (amount > open) return setActionError(`At most ${rupees(open)} is still open on this invoice.`);
                void act(
                  () => addonsApi.recordPayment(r.id, { amount, method: pay.method, reference: pay.reference.trim() || null, note: pay.note.trim() || null, verify: pay.verify }),
                  () => setPay({ amount: '', method: pay.method, reference: '', note: '', verify: pay.verify })
                );
              }}
              aria-label="Record a payment"
            >
              <div className="text-xs font-bold text-slate-800">Record a payment ({rupees(open)} open)</div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Field label="Amount (Rs.)" htmlFor="bv-amount" required>
                  <input id="bv-amount" inputMode="decimal" className={inputCls} value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value.replace(/[^\d.]/g, '') })} placeholder={String(open)} />
                </Field>
                <Field label="Method" htmlFor="bv-method" required>
                  <select id="bv-method" className={inputCls} value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value as PaymentMethod })}>
                    {METHODS.map(m => (
                      <option key={m} value={m}>
                        {PAYMENT_METHOD_LABEL[m] || m}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Reference / UTR" htmlFor="bv-ref">
                  <input id="bv-ref" className={inputCls} maxLength={120} value={pay.reference} onChange={e => setPay({ ...pay, reference: e.target.value })} />
                </Field>
                <Field label="Note" htmlFor="bv-note">
                  <input id="bv-note" className={inputCls} maxLength={1000} value={pay.note} onChange={e => setPay({ ...pay, note: e.target.value })} />
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={pay.verify} onChange={e => setPay({ ...pay, verify: e.target.checked })} className="accent-emerald-600" />
                  I checked it in the bank: mark it verified now
                </label>
                <button type="submit" className={btn.primary} disabled={busy || !pay.amount}>
                  {busy ? 'Saving…' : 'Record payment'}
                </button>
              </div>
            </form>
          )}

          {r.status === 'INVOICE_GENERATED' && (
            <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-2">
              <div className="text-xs font-bold text-slate-800">Confirm the add-on payment</div>
              <p className="text-[11px] text-slate-600">
                Possible once the verified payments cover the invoice and nothing waits for verification. The consultant is then told to start the add-on documents.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <input aria-label="Confirmation note" className={`${inputCls} flex-1 min-w-[12rem]`} maxLength={1000} placeholder="Note (optional)" value={confirmNote} onChange={e => setConfirmNote(e.target.value)} />
                <button
                  type="button"
                  className={btn.green}
                  disabled={busy || pending.length > 0 || r.paid < r.total}
                  title={pending.length > 0 ? 'Verify or reject the waiting payments first' : r.paid < r.total ? 'The verified payments do not cover the invoice yet' : undefined}
                  onClick={() => void act(() => addonsApi.confirmPayment(r.id, confirmNote.trim() || null), () => setConfirmNote(''))}
                >
                  <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Confirming…' : 'Confirm payment'}
                </button>
              </div>
            </div>
          )}
          {r.paymentConfirmedAt && (
            <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              Payment confirmed {longDate(r.paymentConfirmedAt)} by {r.paymentConfirmedBy || 'Accounts'}. The Technical Consultant continues with the add-on onboarding.
            </p>
          )}
        </section>
      )}

      <AddonEvents events={r.events} />
      <div className="flex justify-end pt-2 border-t border-slate-100">
        <button type="button" className={btn.secondary} onClick={onClose}>
          Close
        </button>
      </div>

      {confirmApprove && (
        <Dialog title="Approve these add-ons?" description={`${r.customer}: ${rupees(r.total)}. You are recorded as the verifier. The next step is the invoice.`} onClose={() => setConfirmApprove(false)}>
          <div className="flex justify-end gap-2">
            <button type="button" className={btn.secondary} disabled={busy} onClick={() => setConfirmApprove(false)}>
              Back
            </button>
            <button
              type="button"
              className={btn.green}
              disabled={busy}
              onClick={() => void act(() => addonsApi.decide(r.id, { decision: 'APPROVE', expectedVersion: r.version }), () => setConfirmApprove(false))}
            >
              {busy ? 'Approving…' : 'Approve'}
            </button>
          </div>
        </Dialog>
      )}
      {rejectPayment && (
        <Dialog title="Reject this payment?" description="Say why (e.g. not received in the bank)." onClose={() => setRejectPayment(null)}>
          <textarea aria-label="Reason" rows={2} maxLength={500} className={inputCls} value={rejectPayment.reason} onChange={e => setRejectPayment({ ...rejectPayment, reason: e.target.value })} />
          <div className="flex justify-end gap-2">
            <button type="button" className={btn.secondary} onClick={() => setRejectPayment(null)}>
              Back
            </button>
            <button
              type="button"
              className={btn.danger}
              disabled={busy || !rejectPayment.reason.trim()}
              onClick={() => void act(() => addonsApi.decidePayment(rejectPayment.id, { decision: 'REJECT', reason: rejectPayment.reason.trim() }), () => setRejectPayment(null))}
            >
              Reject payment
            </button>
          </div>
        </Dialog>
      )}
      {showInvoice && r.invoice && (
        <InvoiceDetail
          invoice={r.invoice}
          canManage
          onChanged={() => {
            load();
            onChanged();
          }}
          onClose={() => setShowInvoice(false)}
        />
      )}
      {uploadingInvoice && (
        <UploadInvoiceDialog
          addon={{ requestId: r.id, customerId: r.customerId, label: r.customer, total: r.total }}
          onClose={() => setUploadingInvoice(false)}
          onUploaded={() => {
            setUploadingInvoice(false);
            load();
            onChanged();
          }}
        />
      )}
    </Dialog>
  );
};
