import React, { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Building2, CheckCircle2, IndianRupee, Phone, Search } from 'lucide-react';
import type { AccountsConfirmation } from '../../../shared/contracts';
import { pipelineApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { fmtDay, fmtMoney, fmtWhen } from '../../lib/support';
import { Empty, ErrorBanner, inputClass, Loading, Modal, PageHeader } from '../support-member/SupportParts';
import { AccountsPaymentRequests } from './AccountsPaymentRequests';

type Tab = 'PENDING' | 'CONFIRMED';

const Row: React.FC<{ k: string; v: React.ReactNode }> = ({ k, v }) => (
  <div>
    <dt className="text-[11px] text-slate-400">{k}</dt>
    <dd className="text-sm font-semibold text-slate-900 mt-0.5 break-words">{v || '—'}</dd>
  </div>
);

const METHOD_LABELS: Record<string, string> = { UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CASH: 'Cash', CARD: 'Card', CHEQUE: 'Cheque', OTHER: 'Other' };

interface DetailProps {
  selected: AccountsConfirmation;
  note: string;
  onNote: (v: string) => void;
  busy: boolean;
  actionError: string | null;
  onConfirm: () => void;
  /** Inside a pop-up: no outer card. */
  bare?: boolean;
}

/** Business details, the amount and the Confirm button for one customer. */
const ConfirmationDetail: React.FC<DetailProps> = ({ selected, note, onNote, busy, actionError, onConfirm, bare }) => (
            <section aria-label={`Details of ${selected.company || selected.name}`} className={bare ? '' : 'bg-white rounded-2xl border border-slate-200/80'}>
              <div className="p-5 border-b border-slate-100 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-slate-900">{selected.company || selected.name}</h2>
                  <p className="text-xs text-slate-500">
                    {selected.code} · sent {fmtWhen(selected.sentAt)}
                    {selected.sentBy ? ` by ${selected.sentBy}` : ''}
                  </p>
                </div>
                {selected.confirmedAt && (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
                    <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> Confirmed
                  </span>
                )}
              </div>

              <div className="p-5 space-y-6">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 mb-3 flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-slate-400" aria-hidden="true" /> Business details
                  </h3>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                    <Row k="Business / company" v={selected.company} />
                    <Row k="Contact person" v={selected.name} />
                    <Row k="Phone" v={selected.phone && (<span className="inline-flex items-center gap-1"><Phone className="w-3 h-3 text-slate-400" aria-hidden="true" />{selected.phone}</span>)} />
                    <Row k="E-mail" v={selected.email} />
                    <Row k="Customer type" v={selected.segment ? selected.segment.charAt(0) + selected.segment.slice(1).toLowerCase() : null} />
                    <Row k="Department" v={selected.department} />
                    <Row k="Sold by" v={selected.salesperson} />
                    <Row k="Services" v={selected.services.length ? selected.services.join(', ') : null} />
                  </dl>
                  {selected.notes && <p className="text-xs text-slate-600 mt-3 whitespace-pre-line">Notes: {selected.notes}</p>}
                </div>

                <div>
                  <h3 className="text-xs font-bold text-slate-800 mb-3 flex items-center gap-1.5">
                    <IndianRupee className="w-4 h-4 text-slate-400" aria-hidden="true" /> Amount to confirm
                  </h3>
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {(
                      [
                        ['Deal amount', selected.dealAmount !== null ? fmtMoney(selected.dealAmount) : '—'],
                        ['Amount received', fmtMoney(selected.amountReceived)],
                        ['Balance', fmtMoney(selected.balance)],
                        ['Payment method', (selected.paymentMethod && METHOD_LABELS[selected.paymentMethod]) || '—']
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k} className="rounded-xl bg-slate-50 p-3">
                        <dt className="text-[11px] text-slate-400">{k}</dt>
                        <dd className="text-base font-bold text-slate-900 mt-0.5">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  {selected.paymentDueDate && selected.balance > 0 && (
                    <p className="text-xs text-slate-500 mt-2">Balance due {fmtDay(selected.paymentDueDate)}.</p>
                  )}
                </div>

                {selected.confirmedAt && (
                  <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                    Confirmed {fmtWhen(selected.confirmedAt)}
                    {selected.confirmedBy ? ` by ${selected.confirmedBy}` : ''}
                    {selected.note ? ` · ${selected.note}` : ''}.
                    {selected.sentToConsultantAt ? ' Sent to the Technical Consultant.' : ''}
                  </p>
                )}
              </div>

              {!selected.confirmedAt && (
                <div className="p-5 border-t border-slate-100 space-y-3 bg-slate-50/60 rounded-b-2xl">
                  <label className="block text-xs font-semibold text-slate-700">
                    Note (optional)
                    <textarea
                      value={note}
                      onChange={e => onNote(e.target.value)}
                      rows={2}
                      maxLength={1000}
                      className={`${inputClass} mt-1`}
                      placeholder="e.g. Received in the HDFC account, ref 12345"
                    />
                  </label>
                  {actionError && (
                    <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2" role="alert">
                      {actionError}
                    </p>
                  )}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={onConfirm}
                      disabled={busy}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 disabled:opacity-60"
                    >
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {busy ? 'Confirming…' : 'Confirm amount'}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 text-right">After you confirm, the customer goes to the Technical Consultant for onboarding.</p>
                </div>
              )}
            </section>
);

/**
 * Accounts: customers Sales sent for payment confirmation. Pick one, check the
 * business details and the amount, press Confirm — the customer then goes to
 * the Technical Consultant for onboarding. Every call is checked by the
 * database (Accounts staff only).
 */
const OnboardingConfirmations: React.FC<{
  /** 'split': list on the left, details on the right. 'popup': list of businesses; details open in a pop-up. */
  layout?: 'split' | 'popup';
  onCountsChanged?: () => void;
}> = ({ layout = 'split', onCountsChanged }) => {
  const [tab, setTab] = useState<Tab>('PENDING');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<AccountsConfirmation[]>([]);
  const [total, setTotal] = useState(0);
  const [pendingTotal, setPendingTotal] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [page, pending] = await Promise.all([
        pipelineApi.accountsConfirmations({ status: tab, search: term || undefined, pageSize: 50 }),
        pipelineApi.accountsConfirmations({ status: 'PENDING', pageSize: 1 })
      ]);
      setItems(page.items);
      setTotal(page.total);
      setPendingTotal(pending.total);
      setSelectedId(cur => (cur && page.items.some(i => i.id === cur) ? cur : layout === 'split' ? page.items[0]?.id ?? null : null));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [tab, term, layout]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setNote('');
    setActionError(null);
  }, [selectedId]);

  const selected = items.find(i => i.id === selectedId) || null;

  const confirm = async () => {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      await pipelineApi.confirmAccountsPayment(selected.id, note);
      setNotice(`${selected.company || selected.name} confirmed and sent to the Technical Consultant.`);
      setNote('');
      if (layout === 'popup') setSelectedId(null);
      onCountsChanged?.();
      await load();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Confirmation status" className="flex p-1 rounded-xl bg-slate-100 text-xs font-semibold">
          {(
            [
              ['PENDING', `To confirm${pendingTotal !== null ? ` ${pendingTotal}` : ''}`],
              ['CONFIRMED', 'Confirmed']
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
          title={tab === 'PENDING' ? 'Nothing waiting for confirmation' : 'No confirmed customers yet'}
          hint={tab === 'PENDING' ? 'When Sales sends a customer to Accounts it appears here.' : 'Customers you confirm are listed here.'}
        />
      ) : (
        <div className={layout === 'split' ? 'grid grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)] gap-5 items-start' : ''}>
          <ul className={layout === 'split' ? 'space-y-2' : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3'} aria-label="Customers">
            {items.map(i => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(i.id)}
                  aria-current={i.id === selectedId ? 'true' : undefined}
                  className={`w-full text-left rounded-xl border p-3 transition-colors ${
                    i.id === selectedId ? 'border-blue-400 bg-blue-50/60' : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="text-sm font-bold text-slate-900 truncate">{i.company || i.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {i.company ? `${i.name} · ` : ''}
                    {i.code}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-800">{i.dealAmount !== null ? fmtMoney(i.dealAmount) : '—'}</span>
                    <span className="text-slate-400">{fmtDay(tab === 'PENDING' ? i.sentAt : i.confirmedAt)}</span>
                  </div>
                </button>
              </li>
            ))}
            {total > items.length && <li className="text-[11px] text-slate-400 text-center">Showing {items.length} of {total}. Search to narrow down.</li>}
          </ul>

          {selected && layout === 'popup' && (
            <Modal title={selected.company || selected.name} onClose={() => setSelectedId(null)} wide>
              <ConfirmationDetail bare selected={selected} note={note} onNote={setNote} busy={busy} actionError={actionError} onConfirm={() => void confirm()} />
            </Modal>
          )}
          {selected && layout === 'split' && (
            <ConfirmationDetail selected={selected} note={note} onNote={setNote} busy={busy} actionError={actionError} onConfirm={() => void confirm()} />
          )}
        </div>
      )}
    </div>
  );
};


/**
 * Accounts → Payment confirmations. Two queues, both answered by Accounts:
 *  - New customers: leads Sales sent for payment. Record and verify the payment, then return the customer to Sales
 *    onboarding, or back to Leads if they back off.
 *  - Onboarding amount checks: customers Sales onboarded themselves and sent to Accounts to confirm the amount
 *    before the Technical Consultant gets them.
 */
export const AccountsConfirmations: React.FC<{ layout?: 'split' | 'popup'; onCountsChanged?: () => void }> = ({ layout = 'split', onCountsChanged }) => {
  const [kind, setKind] = useState<'REQUESTS' | 'ONBOARDING'>('REQUESTS');
  const [counts, setCounts] = useState<{ requestsPending: number; onboardingPending: number } | null>(null);
  const refreshCounts = useCallback(() => {
    pipelineApi.accountsCounts().then(setCounts, () => setCounts(null));
    onCountsChanged?.();
  }, [onCountsChanged]);
  // Open on whichever queue has something waiting (new customers first).
  useEffect(() => {
    pipelineApi.accountsCounts().then(c => {
      setCounts(c);
      if (c.requestsPending === 0 && c.onboardingPending > 0) setKind('ONBOARDING');
    }, () => setCounts(null));
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Payment confirmations"
        subtitle="Customers Sales sent to Accounts. Record and verify the payment, then return the customer to Sales for onboarding — or back to Leads if they back off."
      />
      <div role="tablist" aria-label="Confirmation queue" className="flex flex-wrap p-1 rounded-xl bg-slate-100 text-xs font-semibold self-start w-fit">
        {(
          [
            ['REQUESTS', 'New customers', counts?.requestsPending],
            ['ONBOARDING', 'Onboarding amount checks', counts?.onboardingPending]
          ] as const
        ).map(([k, label, n]) => (
          <button key={k} role="tab" type="button" aria-selected={kind === k} onClick={() => setKind(k)} className={`px-3.5 py-1.5 rounded-lg ${kind === k ? 'bg-white shadow-xs text-slate-900' : 'text-slate-600'}`}>
            {label}
            {typeof n === 'number' && n > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-blue-600 text-white text-[10px]">{n}</span>}
          </button>
        ))}
      </div>
      {kind === 'REQUESTS' ? (
        <AccountsPaymentRequests layout={layout} onCountsChanged={refreshCounts} />
      ) : (
        <OnboardingConfirmations layout={layout} onCountsChanged={refreshCounts} />
      )}
    </div>
  );
};
