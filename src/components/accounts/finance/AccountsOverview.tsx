import React, { useCallback, useEffect, useState } from 'react';
import type { FinanceSummary, FinanceTrend } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { financeApi } from '../../../lib/api/endpoints';
import { ErrorBanner, Loading, PageHeader } from '../../support-member/SupportParts';
import { money, SummaryCards, useFinanceRefresh } from './FinanceBits';

const pct = (cur: number, prev: number) => (prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 100));
const monthLabel = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });

/**
 * Account Overview: the three company-wide totals and, below them, how income and
 * expenses moved month by month. Everything comes from the real records
 * (verified payments and recorded expenses); there is no department breakdown here.
 */
export const AccountsOverview: React.FC = () => {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [trend, setTrend] = useState<FinanceTrend | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([financeApi.summary(), financeApi.trend(12)]).then(
      ([s, t]) => {
        setSummary(s);
        setTrend(t);
        setError(null);
      },
      e => setError(errorMessage(e))
    );
  }, []);
  useEffect(load, [load]);
  useFinanceRefresh(load);

  const empty = summary && summary.incomeCount === 0 && summary.expenseCount === 0;
  const months = trend?.months ?? [];
  const max = Math.max(1, ...months.flatMap(m => [m.income, m.expenses]));
  const cur = months[months.length - 1];
  const prev = months[months.length - 2];
  const incomeChange = cur && prev ? pct(cur.income, prev.income) : null;

  return (
    <div className="space-y-6">
      <PageHeader title="Account Overview" subtitle="Company-wide financial summary from the actual records: verified customer payments and recorded expenses." />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!summary && !error ? (
        <Loading label="Loading totals..." />
      ) : (
        <>
          <SummaryCards
            summary={summary}
            incomeNote={summary ? `${summary.incomeCount} verified payment${summary.incomeCount === 1 ? '' : 's'}, whole company` : ''}
            expenseNote={summary ? `${summary.expenseCount} expense record${summary.expenseCount === 1 ? '' : 's'}${summary.expensesPending > 0 ? `, ${money(summary.expensesPending)} still pending` : ''}` : ''}
            netNote="Total gross income minus total expenses"
          />
          {empty ? (
            <p className="text-sm text-slate-500 bg-white border border-dashed border-slate-300 rounded-2xl px-5 py-4" role="status">
              No financial records yet. Income appears here as soon as Accounts verifies a customer payment, and expenses as soon as they are added under Expenses.
            </p>
          ) : (
            trend && (
              <>
                <p className="text-xs text-slate-500" data-testid="income-change">
                  Income this month: <strong className="text-slate-800">{money(cur?.income ?? 0)}</strong>
                  {incomeChange === null ? ' (no previous month to compare)' : ` (${incomeChange >= 0 ? '+' : ''}${incomeChange}% vs last month)`}
                </p>
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

                <section className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden" aria-label="Monthly net earnings">
                  <h2 className="text-sm font-bold text-slate-900 px-5 pt-5 pb-3">Monthly net earnings</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[28rem]">
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
                  </div>
                </section>
              </>
            )
          )}
        </>
      )}
    </div>
  );
};
