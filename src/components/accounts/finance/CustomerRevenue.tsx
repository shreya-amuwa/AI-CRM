import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import type { CustomerRevenuePage, CustomerRevenueSort } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { financeApi, pipelineApi } from '../../../lib/api/endpoints';
import { Empty, ErrorBanner, inputClass, Loading, PageHeader, Pager } from '../../support-member/SupportParts';
import { money, useFinanceRefresh } from './FinanceBits';
import { useRevenueDepartments } from './AccountsIncome';

const PAGE = 25;
const COLUMNS: { key: CustomerRevenueSort; label: string; hint: string; right?: boolean }[] = [
  { key: 'PURCHASED', label: 'Purchased', hint: 'What the customer ordered (not income)', right: true },
  { key: 'INVOICED', label: 'Invoiced', hint: 'Non-cancelled invoices (not income)', right: true },
  { key: 'COLLECTED', label: 'Collected', hint: 'Verified payments received', right: true },
  { key: 'PENDING', label: 'Pending', hint: 'Recorded, not yet verified', right: true },
  { key: 'OUTSTANDING', label: 'Outstanding', hint: 'Ordered minus collected, per order', right: true }
];

const useDebounced = <T,>(value: T, ms = 300): T => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
};

const Stat: React.FC<{ label: string; value: string; hint: string; tone?: string; testId: string }> = ({ label, value, hint, tone = 'text-slate-900', testId }) => (
  <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
    <div className="text-[11px] font-bold tracking-wide text-slate-500 uppercase">{label}</div>
    <div className={`text-xl font-bold mt-1 ${tone}`} data-testid={testId}>{value}</div>
    <div className="text-[11px] text-slate-500 mt-0.5">{hint}</div>
  </div>
);

/**
 * Accounts: Customer-wise Revenue. Who bought the most, and how much of it has actually been paid. The five money columns are never merged:
 * Purchased (ordered) and Invoiced are not income; only Collected (verified payments) is. The table is the database's own aggregation of the order
 * and payment records (each payment counted once, on its own order), searchable, sortable and paginated.
 */
export const CustomerRevenue: React.FC = () => {
  const departments = useRevenueDepartments();
  const [services, setServices] = useState<{ code: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [service, setService] = useState('');
  const [department, setDepartment] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState<CustomerRevenueSort>('PURCHASED');
  const [dir, setDir] = useState<'ASC' | 'DESC'>('DESC');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CustomerRevenuePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const term = useDebounced(search.trim());
  const seq = useRef(0);
  useEffect(() => {
    pipelineApi.services().then(r => setServices(r.map(s => ({ code: s.code, name: s.name }))), () => setServices([]));
  }, []);

  const load = useCallback(() => {
    const n = ++seq.current;
    financeApi
      .customerRevenue({ search: term || undefined, from: from || undefined, to: to || undefined, serviceCode: service || undefined, departmentId: department || undefined, sort, dir, page, pageSize: PAGE })
      .then(
        r => {
          if (n !== seq.current) return;
          setData(r);
          setError(null);
        },
        e => n === seq.current && setError(errorMessage(e))
      );
  }, [term, from, to, service, department, sort, dir, page]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [term, from, to, service, department, sort, dir]);
  useFinanceRefresh(load);

  const sortBy = (key: CustomerRevenueSort) => {
    if (key === sort) setDir(d => (d === 'DESC' ? 'ASC' : 'DESC'));
    else {
      setSort(key);
      setDir(key === 'NAME' ? 'ASC' : 'DESC');
    }
  };
  const t = data?.totals;

  return (
    <div className="space-y-5">
      <PageHeader title="Customer-wise Revenue" subtitle="Which customers buy the most, and how much of it they have paid. Purchased and invoiced values are not income; collected is verified money received." />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Purchased" value={money(t?.purchased)} hint={`${t?.orders ?? 0} orders · not income`} testId="cr-purchased" />
        <Stat label="Invoiced" value={money(t?.invoiced)} hint="non-cancelled invoices · not income" testId="cr-invoiced" />
        <Stat label="Collected" value={money(t?.collected)} hint="verified payments" tone="text-emerald-700" testId="cr-collected" />
        <Stat label="Pending verification" value={money(t?.pending)} hint="recorded, not yet verified" tone="text-amber-700" testId="cr-pending" />
        <Stat label="Outstanding" value={money(t?.outstanding)} hint="ordered minus collected" tone="text-rose-700" testId="cr-outstanding" />
      </div>
      {!!t?.receiptsWithoutOrder && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" role="note">
          {money(t.receiptsWithoutOrder)} of verified receipts sit on no order (shown on the customer's row, and not added to any order). Check the customer's agreed amount.
        </p>
      )}

      {data && data.top.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4" aria-label="Top customers">
          <div className="text-xs font-bold text-slate-700 mb-2">Top customers by purchase value</div>
          <ol className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {data.top.map((c, i) => (
              <li key={c.customerId} className="rounded-xl bg-slate-50 px-3 py-2 min-w-0">
                <div className="text-[11px] text-slate-500">#{i + 1}</div>
                <div className="text-sm font-semibold text-slate-900 truncate">{c.name}</div>
                <div className="text-xs text-slate-600">Bought {money(c.purchased)} · paid {money(c.collected)}</div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 flex flex-col lg:flex-row gap-2 lg:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search customers</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Customer, business or customer ID" className={`${inputClass} pl-9`} />
        </label>
        <select aria-label="Filter by service" className={`${inputClass} lg:w-56`} value={service} onChange={e => setService(e.target.value)}>
          <option value="">All services</option>
          {services.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
        </select>
        <select aria-label="Filter by department" className={`${inputClass} lg:w-48`} value={department} onChange={e => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          From
          <input type="date" aria-label="From date" className={`${inputClass} !w-auto !py-1.5`} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          To
          <input type="date" aria-label="To date" className={`${inputClass} !w-auto !py-1.5`} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
        </label>
      </div>
      <p className="text-[11px] text-slate-500 -mt-2">The dates select orders by their order date; the figures are those orders' invoices and payments. Department is the one the order's revenue is attributed to.</p>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data && !error ? (
        <Loading label="Loading customer revenue..." />
      ) : data && data.items.length === 0 ? (
        <Empty title="No customers" hint={term || from || to || service || department ? 'Nothing matches these filters.' : 'Customers appear here once they have an order.'} />
      ) : (
        data && (
          <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]" data-testid="customer-revenue-table">
                <thead>
                  <tr className="bg-slate-50/70 text-[11px] font-medium text-slate-500 text-left">
                    <th scope="col" className="px-4 py-2.5">
                      <button type="button" className="inline-flex items-center gap-1 font-medium" onClick={() => sortBy('NAME')} aria-label="Sort by customer name">
                        Customer {sort === 'NAME' && (dir === 'ASC' ? <ArrowUp className="w-3 h-3" aria-hidden="true" /> : <ArrowDown className="w-3 h-3" aria-hidden="true" />)}
                      </button>
                    </th>
                    <th scope="col" className="px-2 py-2.5">Services</th>
                    <th scope="col" className="px-2 py-2.5 text-right">
                      <button type="button" className="inline-flex items-center gap-1 font-medium" onClick={() => sortBy('ORDERS')} aria-label="Sort by number of orders">
                        Orders {sort === 'ORDERS' && (dir === 'ASC' ? <ArrowUp className="w-3 h-3" aria-hidden="true" /> : <ArrowDown className="w-3 h-3" aria-hidden="true" />)}
                      </button>
                    </th>
                    {COLUMNS.map(c => (
                      <th key={c.key} scope="col" className="px-2 py-2.5 text-right" aria-sort={sort === c.key ? (dir === 'ASC' ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" className="inline-flex items-center gap-1 font-medium" onClick={() => sortBy(c.key)} title={c.hint} aria-label={`Sort by ${c.label}`}>
                          {c.label} {sort === c.key && (dir === 'ASC' ? <ArrowUp className="w-3 h-3" aria-hidden="true" /> : <ArrowDown className="w-3 h-3" aria-hidden="true" />)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map(r => (
                    <tr key={r.customerId} data-testid="customer-revenue-row">
                      <td className="px-4 py-3 min-w-0">
                        <div className="font-semibold text-slate-900 truncate max-w-[220px]">{r.company || r.name}</div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[220px]">{r.code ? `${r.code} · ` : ''}{r.name}</div>
                        {r.receiptsWithoutOrder > 0 && <div className="text-[11px] text-amber-700">+ {money(r.receiptsWithoutOrder)} received on no order</div>}
                      </td>
                      <td className="px-2 py-3 text-xs text-slate-600 max-w-[220px]">{r.services.length ? r.services.join(', ') : '-'}</td>
                      <td className="px-2 py-3 text-right tabular-nums">{r.orders}</td>
                      <td className="px-2 py-3 text-right tabular-nums font-semibold">{money(r.purchased)}</td>
                      <td className="px-2 py-3 text-right tabular-nums">
                        {money(r.invoiced)}
                        {r.invoiceCount > 0 && <div className="text-[11px] text-slate-500">{r.invoiceCount} invoice{r.invoiceCount === 1 ? '' : 's'}{r.gstInvoiced > 0 ? ` · GST ${money(r.gstInvoiced)}` : ''}</div>}
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums font-semibold text-emerald-700">{money(r.collected)}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-amber-700">{money(r.pending)}</td>
                      <td className="px-2 py-3 text-right tabular-nums font-semibold text-rose-700">{money(r.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )
      )}
    </div>
  );
};
