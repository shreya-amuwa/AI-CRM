import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Search } from 'lucide-react';
import type { DepartmentFinance } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { financeApi } from '../../../lib/api/endpoints';
import { Empty, ErrorBanner, inputClass, Loading, PageHeader } from '../../support-member/SupportParts';
import { money, useFinanceRefresh } from './FinanceBits';
import { useDepartments } from './AccountsIncome';

/**
 * Department Income: one box per department in the CRM, with that department's
 * own earnings (verified customer payments) on the left and its expenses on the
 * right. Nothing else (no margins, invoices or quotations).
 */
export const AccountsDepartmentIncome: React.FC = () => {
  const departments = useDepartments();
  const [rows, setRows] = useState<DepartmentFinance[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(() => {
    financeApi.departments().then(
      r => {
        setRows(r);
        setError(null);
      },
      e => setError(errorMessage(e))
    );
  }, []);
  useEffect(load, [load]);
  useFinanceRefresh(load);

  const look = useMemo(() => new Map(departments.map(d => [d.id, d])), [departments]);
  const q = search.trim().toLowerCase();
  const shown = (rows ?? []).filter(r => !q || r.name.toLowerCase().includes(q));

  return (
    <div className="space-y-6">
      <PageHeader title="Department Income" subtitle="Each department's own earnings and expenses, from verified customer payments and recorded expenses." />
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!rows && !error ? (
        <Loading label="Loading departments..." />
      ) : rows && rows.length === 0 ? (
        <Empty title="No departments found" hint="Departments appear here once they are set up in the CRM." />
      ) : (
        rows && (
          <>
            <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
              <div className="relative max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search department..."
                  aria-label="Search department"
                  className={`${inputClass} pl-9`}
                />
              </div>
            </div>
            {shown.length === 0 ? (
              <Empty title="No department matches your search" />
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5" aria-label="Department earnings and expenses">
                {shown.map(r => {
                  const meta = look.get(r.departmentId);
                  const accent = meta?.accentColor || '#64748b';
                  const empty = r.incomeCount === 0 && r.expenseCount === 0;
                  return (
                    <li
                      key={r.departmentId}
                      className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:shadow-md transition-all space-y-4 relative overflow-hidden"
                      aria-label={r.name}
                      data-testid="department-box"
                    >
                      <div className="h-1 w-full absolute top-0 left-0 right-0" style={{ backgroundColor: accent }} aria-hidden="true" />
                      <div className="flex items-center gap-3 pt-1">
                        {meta?.logoUrl ? (
                          <div className="w-10 h-10 rounded-xl bg-slate-50 p-1 border border-slate-200 flex items-center justify-center shrink-0">
                            <img src={meta.logoUrl} alt="" className="max-h-full max-w-full object-contain" />
                          </div>
                        ) : (
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0" style={{ backgroundColor: accent }} aria-hidden="true">
                            <Building2 className="w-5 h-5" />
                          </div>
                        )}
                        <h3 className="text-base font-bold font-heading text-slate-900 truncate">{r.name}</h3>
                      </div>
                      <div className="grid grid-cols-2 rounded-xl bg-slate-50 border border-slate-100 text-center font-mono">
                        <div className="p-3">
                          <span className="text-[10px] font-bold uppercase text-slate-400 block">Earnings</span>
                          <p className="text-base sm:text-lg font-bold text-emerald-700" data-testid="dept-earnings">
                            {money(r.income)}
                          </p>
                          <span className="text-[10px] text-slate-400">
                            {r.incomeCount} verified payment{r.incomeCount === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="p-3 border-l border-slate-200">
                          <span className="text-[10px] font-bold uppercase text-slate-400 block">Expenses</span>
                          <p className="text-base sm:text-lg font-bold text-rose-700" data-testid="dept-expenses">
                            {money(r.expenses)}
                          </p>
                          <span className="text-[10px] text-slate-400">
                            {r.expenseCount} record{r.expenseCount === 1 ? '' : 's'}
                            {r.expensesPending > 0 ? `, ${money(r.expensesPending)} pending` : ''}
                          </span>
                        </div>
                      </div>
                      {empty && <p className="text-[11px] text-slate-400 text-center">No income or expense records yet.</p>}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-[11px] text-slate-400">Company-wide expenses that are not booked to a department are counted in Account Overview only.</p>
          </>
        )
      )}
    </div>
  );
};
