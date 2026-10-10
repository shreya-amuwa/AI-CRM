import React, { useCallback, useEffect, useState } from 'react';
import type { FinanceSummary, FinanceTrend } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { financeApi } from '../../../lib/api/endpoints';
import { Empty, ErrorBanner, Loading, PageHeader } from '../../support-member/SupportParts';
import { money, useFinanceRefresh } from './FinanceBits';

const monthLabel = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
const pct = (cur: number, prev: number) => (prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 100));

const Stat: React.FC<{ label: string; value: string; tone?: string; note?: string }> = ({ label, value, tone = 'text-slate-900', note }) => (
  <div className="bg-white rounded-2xl border border-slate-200/80 p-5">
    <span className="text-[11px] font-bold font-mono tracking-wider text-slate-500 uppercase block mb-1">{label}</span>
    <div className={`text-2xl font-extrabold tracking-tight ${tone}`}>{value}</div>
    {note && <p className="text-xs text-slate-500 mt-1">{note}</p>}
  </div>
);

/** Overall Analytics: company-wide income, expenses and net over time, from the real records. */
export const AccountsAnalytics: React.FC = () => {
  const [trend, setTrend] = useState<FinanceTrend | null>(null);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([financeApi.trend(12), financeApi.summary()]).then(
      ([t, s]) => {
        setTrend(t);
        setSummary(s);
        setError(null);
      },
      e => setError(errorMessage(e))
    );
  }, []);
  useEffect(load, [load]);
  useFinanceRefresh(load);

  const months = trend?.months ?? [];
  const hasData = !!summary && (summary.incomeCount > 0 || summary.expenseCount > 0);
  const max = Math.max(1, ...months.flatMap(m => [m.income, m.expenses]));
  const cur = months[months.length - 1];
  const prev = months[months.length - 2];
  const incomeChange = cur && prev ? pct(cur.income, prev.income) : null;
  const catTotal = (trend?.expenseCategories ?? []).reduce((a, c) => a + c.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Overall Analytics" subtitle="How the whole company is performing: income, expenses and net earnings, month by month." />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!trend && !error ? (
        <Loading label="Loading analytics..." />
      ) : !hasData ? (
        trend && <Empty title="No data to analyse yet" hint="Charts appear once customer payments are verified or expenses are recorded." />
      ) : (
        summary && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <Stat label="Gross income" value={money(summary.income)} tone="text-emerald-600" note="All verified payments" />
              <Stat label="Expenses" value={money(summary.expenses)} tone="text-rose-600" note={`${summary.expenseCount} record${summary.expenseCount === 1 ? '' : 's'}`} />
              <Stat label="Net earnings" value={money(summary.net)} tone={summary.net < 0 ? 'text-rose-600' : 'text-blue-600'} note="Income minus expenses" />
              <Stat
                label="Income this month"
                value={money(cur?.income ?? 0)}
                note={incomeChange === null ? 'No previous month to compare' : `${incomeChange >= 0 ? '+' : ''}${incomeChange}% vs last month`}
              />
            </div>

            <section className="bg-white rounded-2xl border border-slate-200/80 p-5" aria-label="Monthly income and expenses">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <h2 className="text-sm font-bold text-slate-900">Income vs expenses, last 12 months</h2>
                <div className="flex gap-4 text-[11px] text-slate-600">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" aria-hidden="true" /> Income
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-rose-400" aria-hidden="true" /> Expenses
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <ul className="flex items-end gap-3 h-52 min-w-[34rem]" data-testid="trend-chart">
                  {months.map(m => (
                    <li key={m.month} className="flex-1 flex flex-col items-center justify-end h-full gap-1 min-w-0" title={`${monthLabel(m.month)}: income ${money(m.income)}, expenses ${money(m.expenses)}, net ${money(m.net)}`}>
                      <div className="flex items-end gap-1 w-full justify-center flex-1">
                        <div className="w-1/2 max-w-[18px] rounded-t bg-emerald-500" style={{ height: `${(m.income / max) * 100}%`, minHeight: m.income > 0 ? 2 : 0 }} />
                        <div className="w-1/2 max-w-[18px] rounded-t bg-rose-400" style={{ height: `${(m.expenses / max) * 100}%`, minHeight: m.expenses > 0 ? 2 : 0 }} />
                      </div>
                      <span className="text-[10px] text-slate-500">{monthLabel(m.month)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <section className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden" aria-label="Monthly net">
                <h2 className="text-sm font-bold text-slate-900 px-5 pt-5 pb-3">Monthly net earnings</h2>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50/70 text-[11px] text-slate-500">
                      <th className="text-left font-medium px-5 py-2">Month</th>
                      <th className="text-right font-medium px-3 py-2">Income</th>
                      <th className="text-right font-medium px-3 py-2">Expenses</th>
                      <th className="text-right font-medium px-5 py-2">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[...months].reverse().map(m => (
                      <tr key={m.month}>
                        <td className="px-5 py-2 text-slate-700">{monthLabel(m.month)}</td>
                        <td className="px-3 py-2 text-right text-emerald-700">{money(m.income)}</td>
                        <td className="px-3 py-2 text-right text-rose-700">{money(m.expenses)}</td>
                        <td className={`px-5 py-2 text-right font-semibold ${m.net < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{money(m.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="bg-white rounded-2xl border border-slate-200/80 p-5" aria-label="Expenses by category">
                <h2 className="text-sm font-bold text-slate-900 mb-3">Where the money goes</h2>
                {trend && trend.expenseCategories.length === 0 ? (
                  <p className="text-xs text-slate-500">No expenses recorded in this period.</p>
                ) : (
                  <ul className="space-y-3">
                    {trend?.expenseCategories.map(c => (
                      <li key={c.category}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-700 truncate pr-2">{c.category}</span>
                          <span className="font-semibold text-slate-900">{money(c.amount)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-rose-400" style={{ width: `${catTotal > 0 ? (c.amount / catTotal) * 100 : 0}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )
      )}
    </div>
  );
};
