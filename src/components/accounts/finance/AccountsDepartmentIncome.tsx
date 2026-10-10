import React, { useCallback, useEffect, useState } from 'react';
import type { FinanceSummary } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { financeApi } from '../../../lib/api/endpoints';
import { Empty, ErrorBanner, inputClass, Loading, PageHeader } from '../../support-member/SupportParts';
import { money, SummaryCards, useFinanceRefresh } from './FinanceBits';
import { useDepartments } from './AccountsIncome';

/** Department Income: income and expenses of one department, picked from the real department records. */
export const AccountsDepartmentIncome: React.FC = () => {
  const departments = useDepartments();
  const [department, setDepartment] = useState('');
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!department) return setSummary(null);
    financeApi.summary({ departmentId: department }).then(
      s => {
        setSummary(s);
        setError(null);
      },
      e => setError(errorMessage(e))
    );
  }, [department]);
  useEffect(() => {
    setSummary(null);
    setError(null);
    load();
  }, [load]);
  useFinanceRefresh(load);

  const name = departments.find(d => d.id === department)?.name ?? '';
  const empty = summary && summary.incomeCount === 0 && summary.expenseCount === 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Department Income" subtitle="Pick a department to see only its own income and expenses." />
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 max-w-md">
        <label htmlFor="dept-income-select" className="block text-xs font-semibold text-slate-600 mb-1.5">
          Department
        </label>
        <select id="dept-income-select" className={inputClass} value={department} onChange={e => setDepartment(e.target.value)}>
          <option value="">Select a department</option>
          {departments.map(d => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        {departments.length === 0 && <p className="mt-2 text-[11px] text-slate-500">No departments found.</p>}
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {!department ? (
        <Empty title="Select a department" hint="Its income and expenses are shown here once you pick one." />
      ) : !summary && !error ? (
        <Loading label="Loading department figures..." />
      ) : (
        summary && (
          <>
            <SummaryCards
              summary={summary}
              labels={{ income: `${name.toUpperCase()} INCOME`, expenses: `${name.toUpperCase()} EXPENSES`, net: '' }}
              incomeNote={`${summary.incomeCount} verified payment${summary.incomeCount === 1 ? '' : 's'} from ${name} customers`}
              expenseNote={`${summary.expenseCount} expense record${summary.expenseCount === 1 ? '' : 's'} booked to ${name}${summary.expensesPending > 0 ? `, ${money(summary.expensesPending)} pending` : ''}`}
              netNote=""
            />
            {empty && (
              <p className="text-sm text-slate-500 bg-white border border-dashed border-slate-300 rounded-2xl px-5 py-4" role="status">
                {name} has no income or expense records yet.
              </p>
            )}
          </>
        )
      )}
    </div>
  );
};
