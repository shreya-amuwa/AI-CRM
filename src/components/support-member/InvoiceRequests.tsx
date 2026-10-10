import React, { useState } from 'react';
import { FilePlus2 } from 'lucide-react';
import { fmtMonth, fmtWhen, invoiceRequestApi, useCustomerOptions, useInvoiceRequests } from '../../lib/support';
import { ErrorBanner, FormField, inputClass, Loading } from './SupportParts';

const STATUS_LABEL = { REQUESTED: 'Requested', RAISED: 'Invoice raised', CANCELLED: 'Cancelled' } as const;
const STATUS_CLS = {
  REQUESTED: 'bg-amber-50 text-amber-800 border-amber-200',
  RAISED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-slate-100 text-slate-600 border-slate-200'
} as const;

const thisMonth = () => new Date().toISOString().slice(0, 7);

/**
 * Invoice requests: ask Sales / Accounts to raise an invoice for a customer for
 * a period (from month → to month) with an optional note, and see every
 * request made. The team lead, department head and the customer's owner are
 * notified by the database.
 */
export const InvoiceRequests: React.FC<{ canRequest?: boolean; onOpenCustomer?: (id: string) => void }> = ({ canRequest = true, onOpenCustomer }) => {
  const data = useInvoiceRequests();
  const customers = useCustomerOptions();
  const [customerId, setCustomerId] = useState('');
  const [fromMonth, setFromMonth] = useState(thisMonth());
  const [toMonth, setToMonth] = useState(thisMonth());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (!customerId) return setError('Choose the customer.');
    if (!fromMonth || !toMonth) return setError('Choose the from and to month.');
    if (toMonth < fromMonth) return setError('The "to" month must be the same as or after the "from" month.');
    setBusy(true);
    try {
      await invoiceRequestApi.create({ customerId, fromMonth, toMonth, note: note.trim() });
      const c = customers.find(x => x.id === customerId);
      setDone(`Invoice requested for ${c?.name || 'the customer'} (${fmtMonth(fromMonth)}${fromMonth === toMonth ? '' : ` – ${fmtMonth(toMonth)}`}).`);
      setNote('');
      setCustomerId('');
      await data.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-white rounded-2xl border border-slate-200/80" aria-label="Invoice requests">
      <div className="px-5 pt-5 pb-3 flex items-center gap-2">
        <FilePlus2 className="w-4 h-4 text-blue-600" aria-hidden="true" />
        <h2 className="text-sm font-bold text-slate-900">Invoice requests</h2>
      </div>
      {canRequest && (
        <form onSubmit={submit} className="px-5 pb-5 border-b border-slate-100 space-y-3" aria-label="Request an invoice">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <FormField label="Customer" htmlFor="ir-customer" required>
              <select id="ir-customer" value={customerId} onChange={e => setCustomerId(e.target.value)} className={inputClass}>
                <option value="">Choose a customer</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.code}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="From month" htmlFor="ir-from" required>
              <input id="ir-from" type="month" value={fromMonth} onChange={e => setFromMonth(e.target.value)} className={inputClass} />
            </FormField>
            <FormField label="To month" htmlFor="ir-to" required>
              <input id="ir-to" type="month" value={toMonth} min={fromMonth} onChange={e => setToMonth(e.target.value)} className={inputClass} />
            </FormField>
            <FormField label="Note (optional)" htmlFor="ir-note">
              <input id="ir-note" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} className={inputClass} placeholder="e.g. include GST number" />
            </FormField>
          </div>
          {error && (
            <p className="text-xs text-rose-700" role="alert">
              {error}
            </p>
          )}
          {done && (
            <p className="text-xs text-emerald-700" role="status">
              {done}
            </p>
          )}
          <div className="flex justify-end">
            <button type="submit" disabled={busy} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Sending…' : 'Request invoice'}
            </button>
          </div>
        </form>
      )}
      {data.error && (
        <div className="p-4">
          <ErrorBanner message={data.error} onRetry={() => void data.reload()} />
        </div>
      )}
      {data.loading ? (
        <Loading label="Loading requests…" />
      ) : data.requests.length === 0 ? (
        <p className="px-5 py-6 text-xs text-slate-400">No invoice requests yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th className="py-2.5 px-5 font-semibold">Customer</th>
                <th className="py-2.5 px-3 font-semibold">From month</th>
                <th className="py-2.5 px-3 font-semibold">To month</th>
                <th className="py-2.5 px-3 font-semibold">Note</th>
                <th className="py-2.5 px-3 font-semibold">Requested by</th>
                <th className="py-2.5 px-3 font-semibold">Requested on</th>
                <th className="py-2.5 px-5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.requests.map(r => (
                <tr key={r.id}>
                  <td className="py-3 px-5">
                    {onOpenCustomer ? (
                      <button type="button" onClick={() => onOpenCustomer(r.customerId)} className="font-semibold text-blue-700 hover:underline text-left">
                        {r.customerName}
                      </button>
                    ) : (
                      <span className="font-semibold text-slate-800">{r.customerName}</span>
                    )}
                    <div className="text-[11px] text-slate-400 font-mono">{r.customerCode}</div>
                  </td>
                  <td className="py-3 px-3 text-xs text-slate-700 whitespace-nowrap">{fmtMonth(r.fromMonth)}</td>
                  <td className="py-3 px-3 text-xs text-slate-700 whitespace-nowrap">{fmtMonth(r.toMonth)}</td>
                  <td className="py-3 px-3 text-xs text-slate-600 max-w-[16rem]">{r.note || '-'}</td>
                  <td className="py-3 px-3 text-xs text-slate-600">{r.requestedByName || '-'}</td>
                  <td className="py-3 px-3 text-xs text-slate-500 whitespace-nowrap">{fmtWhen(r.createdAt)}</td>
                  <td className="py-3 px-5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full border text-[11px] font-semibold ${STATUS_CLS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
