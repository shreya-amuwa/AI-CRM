import React, { useEffect, useRef } from 'react';
import { Coins, CreditCard, TrendingUp } from 'lucide-react';
import type { FinanceSummary } from '../../../../shared/contracts';

/** Rupees; paise (always two digits) only when the amount has some. */
const whole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const paise = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n: number | null | undefined) => {
  const v = n ?? 0;
  return Math.abs(v * 100 - Math.round(v) * 100) < 0.5 ? whole.format(v) : paise.format(v);
};

/** Re-run `load` when payments / expenses change somewhere in the app, when the tab is shown again, and every minute. */
export function useFinanceRefresh(load: () => void) {
  const ref = useRef(load);
  ref.current = load;
  useEffect(() => {
    const run = () => ref.current();
    const onVisible = () => document.visibilityState === 'visible' && run();
    window.addEventListener('crm:pipeline-changed', run);
    window.addEventListener('crm:finance-changed', run);
    document.addEventListener('visibilitychange', onVisible);
    const t = setInterval(onVisible, 60000);
    return () => {
      window.removeEventListener('crm:pipeline-changed', run);
      window.removeEventListener('crm:finance-changed', run);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(t);
    };
  }, []);
}
export const notifyFinanceChanged = () => window.dispatchEvent(new CustomEvent('crm:finance-changed'));

const CARD = 'p-6 rounded-3xl border shadow-2xs hover:shadow-xs transition-all space-y-4';
const LABEL = 'text-[11px] font-bold font-mono tracking-wider text-slate-500 uppercase block mb-1';

/** The three pastel summary cards (same look as the Superadmin Accounts Department). */
export const SummaryCards: React.FC<{
  summary: FinanceSummary | null;
  incomeNote: string;
  expenseNote: string;
  netNote: string;
  labels?: { income: string; expenses: string; net: string };
}> = ({ summary, incomeNote, expenseNote, netNote, labels = { income: 'TOTAL GROSS INCOME', expenses: 'TOTAL EXPENSES', net: 'TOTAL NET EARNINGS' } }) => (
  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
    <div className={`${CARD} bg-emerald-50/40 border-emerald-100`}>
      <div className="w-11 h-11 rounded-2xl bg-emerald-100/80 text-emerald-600 flex items-center justify-center">
        <TrendingUp className="w-5 h-5 stroke-[2.5]" aria-hidden="true" />
      </div>
      <div>
        <span className={LABEL}>{labels.income}</span>
        <h3 className="text-3xl font-extrabold font-heading text-emerald-600 tracking-tight" data-testid="card-income">
          {summary ? money(summary.income) : '-'}
        </h3>
        <p className="text-xs text-slate-500 mt-1.5">{incomeNote}</p>
      </div>
    </div>
    <div className={`${CARD} bg-rose-50/40 border-rose-100`}>
      <div className="w-11 h-11 rounded-2xl bg-rose-100/80 text-rose-600 flex items-center justify-center">
        <CreditCard className="w-5 h-5 stroke-[2.5]" aria-hidden="true" />
      </div>
      <div>
        <span className={LABEL}>{labels.expenses}</span>
        <h3 className="text-3xl font-extrabold font-heading text-rose-600 tracking-tight" data-testid="card-expenses">
          {summary ? money(summary.expenses) : '-'}
        </h3>
        <p className="text-xs text-slate-500 mt-1.5">{expenseNote}</p>
      </div>
    </div>
    {labels.net && (
      <div className={`${CARD} bg-blue-50/40 border-blue-100`}>
        <div className="w-11 h-11 rounded-2xl bg-blue-100/80 text-blue-600 flex items-center justify-center">
          <Coins className="w-5 h-5 stroke-[2.5]" aria-hidden="true" />
        </div>
        <div>
          <span className={LABEL}>{labels.net}</span>
          <h3 className={`text-3xl font-extrabold font-heading tracking-tight ${summary && summary.net < 0 ? 'text-rose-600' : 'text-blue-600'}`} data-testid="card-net">
            {summary ? money(summary.net) : '-'}
          </h3>
          <p className="text-xs text-slate-500 mt-1.5">{netNote}</p>
        </div>
      </div>
    )}
  </div>
);

export const fmtDay = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
