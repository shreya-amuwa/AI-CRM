import React, { useEffect, useRef, useState } from 'react';
import { rupees } from '../../lib/income';
import { MIN_WITHDRAWAL, methodLine, newRequestId, payoutsApi, type PayoutMethod } from '../../lib/payouts';
import { Dialog } from '../team-member/pipeline/shared';
import { PayoutDetailsForm } from './PayoutDetailsForm';

/** Withdraw: the amount (₹500 up to what is available) to the saved payout details; one request id per opening, so a retry is one request. */
export const WithdrawDialog: React.FC<{ available: number; onClose: () => void; onDone: () => void; editOnly?: boolean }> = ({ available, onClose, onDone, editOnly }) => {
  const [method, setMethod] = useState<PayoutMethod | null | undefined>(undefined);
  const [editing, setEditing] = useState(!!editOnly);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const requestId = useRef(newRequestId());
  useEffect(() => { payoutsApi.method().then(m => setMethod(m ?? null), () => setMethod(null)); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Math.round(Number(amount) * 100) / 100;
    if (!Number.isFinite(n) || n < MIN_WITHDRAWAL) { setError(`Withdraw at least ${rupees(MIN_WITHDRAWAL)}.`); return; }
    if (saving) return;
    setSaving(true); setError(null);
    try { await payoutsApi.request(n, requestId.current); onDone(); }
    catch (err) { setError(err instanceof Error ? err.message : 'The request could not be sent.'); setSaving(false); }
  };

  return (
    <Dialog title={editOnly ? 'Payout details' : 'Withdraw'} description={editOnly ? 'Where Accounts sends your withdrawals.' : `Available to withdraw: ${rupees(available)}`} onClose={onClose}>
      {method === undefined && <p className="text-sm text-slate-500">Loading…</p>}
      {method !== undefined && editing && (
        <PayoutDetailsForm current={method} onCancel={() => (editOnly ? onClose() : setEditing(false))}
          onSaved={m => { setMethod(m); if (editOnly) onDone(); else setEditing(false); }} />
      )}
      {method === null && !editing && (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">Add your payout details first: the bank account or UPI ID the money goes to.</p>
          <button type="button" onClick={() => setEditing(true)} className="h-10 px-4 rounded-xl bg-blue-600 text-white text-sm font-bold">Add payout details</button>
        </div>
      )}
      {method && !editing && (
        <form onSubmit={submit} className="space-y-3" noValidate>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Paid to</p>
            <p className="font-semibold text-slate-900">{method.holderName}</p>
            <p className="text-slate-600 break-words">{methodLine({ ...method, accountNumber: method.accountNumber ? `••••${method.accountNumber.slice(-4)}` : method.accountNumber })}</p>
            <button type="button" onClick={() => setEditing(true)} className="mt-1 text-xs font-semibold text-blue-700 hover:underline">Edit payout details</button>
          </div>
          <label className="block text-sm font-medium text-slate-700">Amount (₹)
            <input aria-label="Amount (₹)" type="number" inputMode="decimal" min={MIN_WITHDRAWAL} step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm" required />
          </label>
          <p className="text-xs text-slate-500">At least {rupees(MIN_WITHDRAWAL)}. Accounts pays it and may deduct TDS; your slip shows both.</p>
          {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="h-10 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold" disabled={saving}>Close</button>
            <button type="submit" className="h-10 px-4 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-50" disabled={saving}>{saving ? 'Sending…' : 'Request withdrawal'}</button>
          </div>
        </form>
      )}
    </Dialog>
  );
};
