import React from 'react';
import { ArrowDownLeft, ArrowUpRight, Clock3 } from 'lucide-react';
import { rupees } from '../../lib/income';
import { STATUS_LABEL, STATUS_TONE, TYPE_LABEL, signedRupees, type WalletTransaction } from '../../lib/wallet';

/** Small pieces shared by the employee wallet and the Accounts wallet screens. */
export const dayText = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
export const timeText = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

export const Tile: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: 'plain' | 'strong' | 'muted'; testId?: string }> = ({ label, value, hint, tone = 'plain', testId }) => (
  <div className={`rounded-2xl border p-4 ${tone === 'strong' ? 'border-emerald-200 bg-emerald-50' : tone === 'muted' ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'}`} data-testid={testId}>
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className={`mt-1 text-2xl font-extrabold tabular-nums ${tone === 'strong' ? 'text-emerald-800' : 'text-slate-900'}`}>{value}</p>
    {hint ? <p className="mt-0.5 text-xs text-slate-500">{hint}</p> : null}
  </div>
);

export const Section: React.FC<{ title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode; label?: string }> = ({ title, hint, right, children, label }) => (
  <section aria-label={label ?? title} className="rounded-2xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
      <div className="min-w-0"><h2 className="text-sm font-bold text-slate-900">{title}</h2>{hint ? <p className="text-xs text-slate-500 mt-0.5">{hint}</p> : null}</div>
      {right}
    </div>
    {children}
  </section>
);

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="px-4 py-8 text-center text-sm text-slate-500">{children}</p>;

export const Notice: React.FC<{ tone: 'ok' | 'warn' | 'error' | 'info'; children: React.ReactNode }> = ({ tone, children }) => (
  <div role={tone === 'error' ? 'alert' : 'status'}
    className={`rounded-xl border px-4 py-3 text-sm ${tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900'
      : tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-sky-200 bg-sky-50 text-sky-900'}`}>{children}</div>
);

export const StatusPill: React.FC<{ status: WalletTransaction['status'] }> = ({ status }) => (
  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
);

/** The money column: green and "Credit" for money in, red and "Debit" for money out; grey and struck through when it does not count (pending, rejected, cancelled). */
export const Amount: React.FC<{ t: WalletTransaction }> = ({ t }) => {
  const debit = t.amount < 0;
  const counts = t.countsInBalance || t.status === 'REQUESTED' || t.status === 'PROCESSING';
  const tone = !counts ? 'text-slate-400 line-through' : debit ? 'text-rose-700' : 'text-emerald-700';
  return (
    <span className={`inline-flex items-center gap-1 font-bold tabular-nums ${tone}`}>
      {t.status === 'PENDING_APPROVAL' || t.status === 'REQUESTED' || t.status === 'PROCESSING' ? <Clock3 className="w-3.5 h-3.5" aria-hidden /> : debit ? <ArrowUpRight className="w-3.5 h-3.5" aria-hidden /> : <ArrowDownLeft className="w-3.5 h-3.5" aria-hidden />}
      <span className="sr-only">{debit ? 'Debit' : 'Credit'}</span>{signedRupees(t.amount)}
    </span>
  );
};

/** The ledger as a table on a wide screen and as cards on a phone. */
export const TransactionList: React.FC<{ items: WalletTransaction[]; empty?: string }> = ({ items, empty = 'No transactions yet.' }) => {
  if (items.length === 0) return <Empty>{empty}</Empty>;
  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm" data-testid="wallet-table">
          <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th scope="col" className="px-4 py-2 font-semibold">Date</th><th scope="col" className="px-4 py-2 font-semibold">Type</th>
            <th scope="col" className="px-4 py-2 font-semibold">Description</th><th scope="col" className="px-4 py-2 font-semibold text-right">Amount</th><th scope="col" className="px-4 py-2 font-semibold">Status</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {items.map(t => (
              <tr key={t.id} data-testid="wallet-row" data-type={t.type} className="align-top">
                <td className="px-4 py-3 whitespace-nowrap text-slate-600">{dayText(t.date)}</td>
                <td className="px-4 py-3 whitespace-nowrap font-semibold text-slate-900">{TYPE_LABEL[t.type]}</td>
                <td className="px-4 py-3 text-slate-600 break-words max-w-[28rem]">{t.description || '–'}{t.reference ? <span className="block text-xs text-slate-400">Ref {t.reference}</span> : null}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap"><Amount t={t} /></td>
                <td className="px-4 py-3"><StatusPill status={t.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden divide-y divide-slate-100">
        {items.map(t => (
          <li key={t.id} data-testid="wallet-row" data-type={t.type} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><p className="text-sm font-semibold text-slate-900">{TYPE_LABEL[t.type]}</p><p className="text-xs text-slate-500">{dayText(t.date)}</p></div>
              <Amount t={t} />
            </div>
            <p className="mt-1 text-xs text-slate-600 break-words">{t.description || '–'}</p>
            <div className="mt-1.5"><StatusPill status={t.status} /></div>
          </li>
        ))}
      </ul>
    </>
  );
};

export { rupees };
