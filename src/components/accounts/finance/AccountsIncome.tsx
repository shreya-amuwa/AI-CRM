import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { Department, IncomePage } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { financeApi, organizationApi } from '../../../lib/api/endpoints';
import { Badge, METHOD_LABEL, TYPE_LABEL } from '../../payments/PaymentBits';
import { Empty, ErrorBanner, inputClass, Loading, PageHeader, Pager } from '../../support-member/SupportParts';
import { fmtDay, money, useFinanceRefresh } from './FinanceBits';

const PAGE = 15;

export const useDepartments = () => {
  const [items, setItems] = useState<Department[]>([]);
  useEffect(() => {
    organizationApi.departments().then(setItems, () => setItems([]));
  }, []);
  return items;
};

const useDebounced = <T,>(value: T, ms = 300): T => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
};

/** The verified payments (the income records), newest first. `fixedDepartment` hides the department filter. */
export const IncomeList: React.FC<{ fixedDepartment?: string; refreshKey?: number }> = ({ fixedDepartment, refreshKey = 0 }) => {
  const departments = useDepartments();
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<IncomePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const term = useDebounced(search.trim());
  const seq = useRef(0);
  const dept = fixedDepartment ?? department;

  const load = useCallback(() => {
    const n = ++seq.current;
    financeApi
      .income({ search: term || undefined, departmentId: dept || undefined, from: from || undefined, to: to || undefined, page, pageSize: PAGE })
      .then(
        r => {
          if (n !== seq.current) return;
          setData(r);
          setError(null);
        },
        e => n === seq.current && setError(errorMessage(e))
      );
  }, [term, dept, from, to, page, refreshKey]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [term, dept, from, to]);
  useFinanceRefresh(load);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 flex flex-col lg:flex-row gap-2 lg:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search income</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer, business, customer ID or payment reference" className={`${inputClass} pl-9`} />
        </label>
        {!fixedDepartment && (
          <select aria-label="Filter by department" className={`${inputClass} lg:w-56`} value={department} onChange={e => setDepartment(e.target.value)}>
            <option value="">All departments</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          From
          <input type="date" aria-label="From date" className={`${inputClass} !w-auto !py-1.5`} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          To
          <input type="date" aria-label="To date" className={`${inputClass} !w-auto !py-1.5`} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
        </label>
      </div>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data && !error ? (
        <Loading label="Loading income..." />
      ) : data && data.items.length === 0 ? (
        <Empty title="No income records" hint={term || from || to || dept ? 'Nothing matches these filters.' : 'Income appears here once Accounts verifies a customer payment.'} />
      ) : (
        data && (
          <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
            <div className="px-5 py-3 flex items-center justify-between text-xs border-b border-slate-100">
              <span className="text-slate-500">
                {data.total} verified payment{data.total === 1 ? '' : 's'}
              </span>
              <span className="font-bold text-emerald-700" data-testid="income-sum">
                Total {money(data.sum)}
              </span>
            </div>
            <div className="hidden md:grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)] gap-4 px-5 py-2.5 bg-slate-50/70 text-[11px] font-medium text-slate-500" aria-hidden="true">
              <span>Date</span>
              <span>Customer</span>
              <span>Department</span>
              <span>Payment</span>
              <span className="text-right">Amount</span>
            </div>
            <ul className="divide-y divide-slate-100" aria-label="Income records">
              {data.items.map(i => (
                <li key={i.id} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)] gap-1 md:gap-4 items-center px-5 py-3">
                  <span className="text-xs text-slate-600">{fmtDay(i.paidAt)}</span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 truncate">{i.customer}</span>
                    <span className="block text-[11px] text-slate-500 truncate">
                      {i.contact} · {i.customerCode}
                    </span>
                  </span>
                  <span className="text-xs text-slate-700 truncate">{i.department ?? '-'}</span>
                  <span className="text-xs text-slate-600">
                    <Badge tone={i.type === 'PART' ? 'blue' : 'green'}>{TYPE_LABEL[i.type]}</Badge>
                    <span className="block mt-0.5 text-[11px] text-slate-500">
                      {i.method ? METHOD_LABEL[i.method] ?? i.method : ''}
                      {i.reference ? ` · ${i.reference}` : ''}
                    </span>
                  </span>
                  <span className="text-sm font-bold text-emerald-700 md:text-right">{money(i.amount)}</span>
                </li>
              ))}
            </ul>
            <Pager page={page} pageSize={PAGE} total={data.total} onPage={setPage} />
          </div>
        )
      )}
    </div>
  );
};

/** Sidebar page "Income". */
export const AccountsIncome: React.FC = () => (
  <div className="space-y-5">
    <PageHeader title="Income" subtitle="Every customer payment Accounts has verified. Pending or rejected payments are not income." />
    <IncomeList />
  </div>
);
