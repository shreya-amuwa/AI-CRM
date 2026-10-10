import React, { useCallback, useEffect, useState } from 'react';
import type { FinanceSummary } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { financeApi } from '../../../lib/api/endpoints';
import { ErrorBanner, Loading, PageHeader } from '../../support-member/SupportParts';
import { money, SummaryCards, useFinanceRefresh } from './FinanceBits';

/**
 * Account Overview: the three company-wide totals, from the real records
 * (verified payments and recorded expenses). No department breakdown here.
 */
export const AccountsOverview: React.FC = () => {
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    financeApi.summary().then(
      s => {
        setSummary(s);
        setError(null);
      },
      e => setError(errorMessage(e))
    );
  }, []);
  useEffect(load, [load]);
  useFinanceRefresh(load);

  const empty = summary && summary.incomeCount === 0 && summary.expenseCount === 0;

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
          {empty && (
            <p className="text-sm text-slate-500 bg-white border border-dashed border-slate-300 rounded-2xl px-5 py-4" role="status">
              No financial records yet. Income appears here as soon as Accounts verifies a customer payment, and expenses as soon as they are added under Expenses.
            </p>
          )}
        </>
      )}
    </div>
  );
};
