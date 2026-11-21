import React, { useCallback, useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { rupees } from '../../../lib/income';
import {
  STATUS_LABEL, STATUS_TONE, methodLine, officeToday, payoutsApi,
  type Leaver, type PayoutDetail, type PayoutMethod, type PayoutRequest, type PayoutStatus
} from '../../../lib/payouts';
import { PageTitle } from '../../layout/shell';

/**
 * Accounts > Finance > Payout requests (20270123000100): sales staff's incentive withdrawals. Accounts sends the money from the company's
 * bank or UPI, then records it here (reference, date, TDS); or rejects with a reason. People who left are paid a final settlement.
 * The database checks everything (Accounts only; nobody pays their own withdrawal; a request is handled once).
 */
type Tab = 'REQUESTED' | 'PAID' | 'REJECTED' | 'FAILED' | 'LEAVERS';
const TABS: { id: Tab; label: string }[] = [
  { id: 'REQUESTED', label: 'Requested' }, { id: 'PAID', label: 'Paid' }, { id: 'REJECTED', label: 'Rejected' }, { id: 'FAILED', label: 'Failed' }, { id: 'LEAVERS', label: 'Leavers' }
];
const input = 'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500';
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const CopyRow: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => !value ? null : (
  <div className="flex items-start justify-between gap-2 py-1">
    <div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="text-sm text-slate-900 break-all">{value}</p></div>
    <button type="button" aria-label={`Copy ${label}`} onClick={() => void navigator.clipboard?.writeText(value)} className="shrink-0 p-2 rounded-lg hover:bg-slate-100">
      <Copy className="w-4 h-4" aria-hidden="true" />
    </button>
  </div>
);
const MethodBox: React.FC<{ m: PayoutMethod | null }> = ({ m }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
    {!m ? <p className="text-sm text-slate-500">No payout details saved.</p> : <>
      <CopyRow label="Account holder" value={m.holderName} />
      <CopyRow label="Account number" value={m.accountNumber} />
      <CopyRow label="IFSC" value={m.ifsc} />
      <CopyRow label="UPI ID" value={m.upiId} />
      <CopyRow label="International details" value={m.otherDetails} />
      <CopyRow label="PAN" value={m.pan} />
    </>}
  </div>
);

/** Reference, date paid and TDS, with the net shown as it is typed. */
const PayForm: React.FC<{ amount: number; label: string; onPay: (reference: string, paidOn: string, tds: number) => Promise<void> }> = ({ amount, label, onPay }) => {
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(officeToday());
  const [tds, setTds] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const t = Math.round((Number(tds) || 0) * 100) / 100;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setError(null);
    try { await onPay(reference.trim(), paidOn, t); } catch (err) { setError(msg(err)); } finally { setSaving(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-2" aria-label={label}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="text-sm font-medium text-slate-700">Reference
          <input className={input} aria-label="Reference" value={reference} onChange={e => setReference(e.target.value)} maxLength={120} placeholder="UTR / UPI reference" />
        </label>
        <label className="text-sm font-medium text-slate-700">Paid on
          <input className={input} aria-label="Paid on" type="date" value={paidOn} max={officeToday()} onChange={e => setPaidOn(e.target.value)} />
        </label>
        <label className="text-sm font-medium text-slate-700">TDS (₹)
          <input className={input} aria-label="TDS (₹)" type="number" min="0" step="0.01" value={tds} onChange={e => setTds(e.target.value)} />
        </label>
      </div>
      <p className="text-sm text-slate-700" data-testid="net-to-pay">Net to pay: <strong>{rupees(Math.round((amount - t) * 100) / 100)}</strong> (send this amount)</p>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}
      <button type="submit" disabled={saving} className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-bold disabled:opacity-50">{saving ? 'Saving…' : label}</button>
    </form>
  );
};

const RejectForm: React.FC<{ onReject: (reason: string) => Promise<void> }> = ({ onReject }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="h-10 px-4 rounded-xl border border-rose-200 bg-white text-rose-700 text-sm font-semibold">Reject</button>;
  const submit = async () => {
    if (!reason.trim()) { setError('Say why the withdrawal is rejected.'); return; }
    setError(null);
    try { await onReject(reason.trim()); } catch (err) { setError(msg(err)); }
  };
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-slate-700">Reason
        <input className={input} aria-label="Reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} />
      </label>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}
      <button type="button" onClick={() => void submit()} className="h-10 px-4 rounded-xl bg-rose-600 text-white text-sm font-bold">Confirm reject</button>
    </div>
  );
};

export const PayoutRequests: React.FC = () => {
  const [tab, setTab] = useState<Tab>('REQUESTED');
  const [rows, setRows] = useState<PayoutRequest[] | null>(null);
  const [leavers, setLeavers] = useState<Leaver[] | null>(null);
  const [detail, setDetail] = useState<PayoutDetail | null>(null);
  const [leaver, setLeaver] = useState<Leaver | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    if (tab === 'LEAVERS') payoutsApi.leavers().then(setLeavers, e => setError(msg(e)));
    else payoutsApi.queue(tab as PayoutStatus).then(setRows, e => setError(msg(e)));
  }, [tab]);
  useEffect(() => { setDetail(null); setLeaver(null); load(); }, [load]);
  const open = (id: string) => { setLeaver(null); payoutsApi.detail(id).then(setDetail, e => setError(msg(e))); };
  const done = (text: string) => { setNotice(text); setDetail(null); setLeaver(null); load(); };

  return (
    <div className="space-y-5">
      <PageTitle title="Payout requests" subtitle="Sales staff's incentive withdrawals. Send the money from the company account, then record it here." />
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
      <div role="tablist" aria-label="Payout requests" className="flex flex-wrap gap-2">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`h-9 px-3 rounded-xl text-sm font-semibold ${tab === t.id ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>{t.label}</button>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4">
        <section aria-label="List" className="rounded-2xl border border-slate-200 bg-white">
          {tab !== 'LEAVERS' && (rows === null ? <p className="p-4 text-sm text-slate-500">Loading…</p> : rows.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">Nothing here.</p> : (
            <ul className="divide-y divide-slate-100">{rows.map(r => (
              <li key={r.id}><button type="button" onClick={() => open(r.id)} className={`w-full text-left px-4 py-3 hover:bg-slate-50 ${detail?.id === r.id ? 'bg-blue-50' : ''}`}>
                <span className="flex items-center justify-between gap-2"><span className="font-semibold text-slate-900 text-sm">{r.name}</span><span className="text-sm font-bold tabular-nums">{rupees(r.amount)}</span></span>
                <span className="block text-xs text-slate-500">{r.department ?? 'No department'} · {when(r.requestedAt)}{r.finalSettlement ? ' · final settlement' : ''}</span>
              </button></li>))}
            </ul>))}
          {tab === 'LEAVERS' && (leavers === null ? <p className="p-4 text-sm text-slate-500">Loading…</p> : leavers.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">Nobody who left has money to come.</p> : (
            <ul className="divide-y divide-slate-100">{leavers.map(l => (
              <li key={l.profileId}><button type="button" onClick={() => { setDetail(null); setLeaver(l); }} className="w-full text-left px-4 py-3 hover:bg-slate-50">
                <span className="flex items-center justify-between gap-2"><span className="font-semibold text-slate-900 text-sm">{l.name}</span><span className="text-sm font-bold tabular-nums">{rupees(l.available)}</span></span>
                <span className="block text-xs text-slate-500">{l.department ?? 'No department'} · left ({l.status.toLowerCase()})</span>
              </button></li>))}
            </ul>))}
        </section>

        {(detail || leaver) && (
          <section aria-label="Withdrawal details" className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
            {detail && <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><h2 className="text-base font-bold text-slate-900">{detail.name}</h2><p className="text-xs text-slate-500">{detail.department ?? 'No department'}{detail.personActive ? '' : ' · has left'}</p></div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[detail.status]}`}>{STATUS_LABEL[detail.status]}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div><p className="text-xs text-slate-500">Asked for</p><p className="font-bold tabular-nums">{rupees(detail.amount)}</p></div>
                <div><p className="text-xs text-slate-500">Withdrawn before</p><p className="font-bold tabular-nums">{rupees(detail.withdrawn)}</p></div>
                <div><p className="text-xs text-slate-500">Still available</p><p className="font-bold tabular-nums">{rupees(detail.available)}</p></div>
              </div>
              <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Pay to (the details given with this request)</p><MethodBox m={detail.method} /></div>
              {detail.status === 'REQUESTED' && <>
                <PayForm amount={detail.amount} label="Mark paid" onPay={async (ref, on, tds) => { await payoutsApi.markPaid(detail.id, ref, on, tds); done('Marked paid.'); }} />
                <RejectForm onReject={async reason => { await payoutsApi.reject(detail.id, reason); done('Rejected.'); }} />
              </>}
              {detail.status === 'PAID' && <div className="space-y-2 text-sm text-slate-700">
                <p>Paid {detail.paidOn} · ref {detail.reference} · TDS {rupees(detail.tdsAmount)} · net {rupees(detail.netAmount ?? 0)}{detail.decidedBy ? ` · by ${detail.decidedBy}` : ''}</p>
                <button type="button" onClick={() => payoutsApi.downloadSlip(detail.id).catch(e => setError(msg(e)))} className="h-9 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold">Download slip</button>
              </div>}
              {detail.reason && <p className="text-sm text-rose-700">{detail.reason}</p>}
              {detail.recentEarnings.length > 0 && <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent earnings</p>
                <ul className="text-xs text-slate-600 space-y-0.5">{detail.recentEarnings.slice(0, 8).map((e, i) => (
                  <li key={i} className={e.status === 'REVERSED' ? 'line-through' : ''}>{when(e.earnedAt)} · {e.ruleName} · {rupees(e.amount)}</li>))}
                </ul>
              </div>}
            </>}
            {leaver && <>
              <div><h2 className="text-base font-bold text-slate-900">{leaver.name}</h2><p className="text-xs text-slate-500">{leaver.department ?? 'No department'} · has left · final settlement {rupees(leaver.available)}</p></div>
              <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Pay to</p><MethodBox m={leaver.method} />
                {!leaver.method && <p className="mt-1 text-xs text-slate-500">{methodLine(null)}: contact them for their details before paying.</p>}</div>
              <PayForm amount={leaver.available} label="Pay final settlement" onPay={async (ref, on, tds) => { await payoutsApi.settle(leaver.profileId, ref, on, tds); done('Final settlement paid.'); }} />
            </>}
          </section>
        )}
      </div>
    </div>
  );
};

export default PayoutRequests;
