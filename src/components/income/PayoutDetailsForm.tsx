import React, { useState } from 'react';
import { payoutsApi, type PayoutKind, type PayoutMethod } from '../../lib/payouts';

/** Where withdrawals are sent: a bank account, a UPI ID, or international details (paid by hand by Accounts). PAN is optional. */
const input = 'h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500';
const KINDS: { id: PayoutKind; label: string }[] = [{ id: 'BANK', label: 'Bank account' }, { id: 'UPI', label: 'UPI' }, { id: 'OTHER', label: 'Other (outside India)' }];

export const PayoutDetailsForm: React.FC<{ current: PayoutMethod | null; onSaved: (m: PayoutMethod) => void; onCancel: () => void }> = ({ current, onSaved, onCancel }) => {
  const [kind, setKind] = useState<PayoutKind>(current?.kind ?? 'BANK');
  const [f, setF] = useState({
    holderName: current?.holderName ?? '', accountNumber: current?.accountNumber ?? '', ifsc: current?.ifsc ?? '', upiId: current?.upiId ?? '',
    otherDetails: current?.otherDetails ?? '', pan: current?.pan ?? ''
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF(x => ({ ...x, [k]: e.target.value }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setError(null);
    try {
      onSaved(await payoutsApi.saveMethod({
        kind, holderName: f.holderName.trim(), pan: f.pan.trim() || undefined,
        ...(kind === 'BANK' ? { accountNumber: f.accountNumber.trim(), ifsc: f.ifsc.trim() } : kind === 'UPI' ? { upiId: f.upiId.trim() } : { otherDetails: f.otherDetails.trim() })
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The details could not be saved.');
      setSaving(false);
    }
  };
  return (
    <form onSubmit={save} aria-label="Payout details" className="space-y-3">
      <div role="radiogroup" aria-label="Paid to" className="flex flex-wrap gap-2">
        {KINDS.map(k => (
          <label key={k.id} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${kind === k.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200'}`}>
            <input type="radio" name="payout-kind" checked={kind === k.id} onChange={() => setKind(k.id)} /> {k.label}
          </label>
        ))}
      </div>
      <label className="block text-sm font-medium text-slate-700">Account holder name
        <input className={input} aria-label="Account holder name" value={f.holderName} onChange={set('holderName')} maxLength={120} required />
      </label>
      {kind === 'BANK' && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-sm font-medium text-slate-700">Account number
          <input className={input} aria-label="Account number" inputMode="numeric" value={f.accountNumber} onChange={set('accountNumber')} maxLength={18} required />
        </label>
        <label className="block text-sm font-medium text-slate-700">IFSC
          <input className={`${input} uppercase`} aria-label="IFSC" value={f.ifsc} onChange={set('ifsc')} maxLength={11} required />
        </label>
      </div>}
      {kind === 'UPI' && <label className="block text-sm font-medium text-slate-700">UPI ID
        <input className={input} aria-label="UPI ID" value={f.upiId} onChange={set('upiId')} maxLength={100} placeholder="name@okhdfcbank" required />
      </label>}
      {kind === 'OTHER' && <label className="block text-sm font-medium text-slate-700">Bank details
        <textarea className={`${input} h-24 py-2`} aria-label="Bank details" value={f.otherDetails} onChange={set('otherDetails')} maxLength={1000}
          placeholder="Bank name, account number or IBAN, SWIFT code, country" required />
        <span className="text-xs text-slate-500">Accounts pays international transfers by hand.</span>
      </label>}
      <label className="block text-sm font-medium text-slate-700">PAN (optional)
        <input className={`${input} uppercase`} aria-label="PAN (optional)" value={f.pan} onChange={set('pan')} maxLength={10} />
      </label>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-10 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold" disabled={saving}>Back</button>
        <button type="submit" className="h-10 px-4 rounded-xl bg-blue-600 text-white text-sm font-bold disabled:opacity-50" disabled={saving}>{saving ? 'Saving…' : 'Save details'}</button>
      </div>
    </form>
  );
};
