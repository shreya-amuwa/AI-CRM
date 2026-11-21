import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { Pager, useDebounced } from '../team-member/pipeline/shared';
import { Card, CardHead, fieldCls, ghostBtn, LoadingLine, StatCard, Tabs } from '../tasks/head/headParts';
import { dayText, headApi, inr, useHeadData } from '../../lib/headDashboard';
import { EmptyRow, InvoiceBadge, OpenInvoice, PageError, Th } from './headBits';

type Filter = 'ALL' | 'PAID' | 'PENDING' | 'OVERDUE';
const PAGE = 15;

/**
 * Invoices of the head's department's customers, read only: search, Paid / Pending / Overdue and a date range. Opening one uses the existing invoice
 * detail, which shows the PDF where the existing invoice permissions allow it. Creating, paying or changing an invoice stays with Accounts.
 */
export const HeadInvoicesPage: React.FC<{ initialSearch?: string }> = ({ initialSearch = '' }) => {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState(initialSearch);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounced(search, 300);
  const badRange = !!from && !!to && to < from;
  const { data, error, loading, reload } = useHeadData(
    () => (badRange ? Promise.resolve(null) : headApi.invoices({ search: q, status: filter === 'ALL' ? null : filter, from: from || null, to: to || null, limit: PAGE, offset: (page - 1) * PAGE })),
    [q, filter, from, to, page, badRange]
  );
  const s = data?.summary;
  const clear = () => { setFrom(''); setTo(''); setSearch(''); setFilter('ALL'); setPage(1); };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900">Invoices</h1>
        <p className="mt-1.5 text-[15px] text-slate-600 max-w-2xl">Invoices of your department's customers. You can view them here; invoices and payments are managed by Accounts.</p>
      </div>
      {error && <PageError message={error} onRetry={reload} />}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Invoice summary">
        <StatCard label="Invoices" value={s?.count ?? '-'} foot={s ? `${inr(s.amount)} invoiced` : undefined} testId="inv-count" />
        <StatCard label="Paid" value={s?.paid ?? '-'} tone="green" foot={s ? inr(s.paidAmount) : undefined} testId="inv-paid" />
        <StatCard label="Pending" value={s?.pending ?? '-'} tone="amber" foot={s ? `${inr(s.pendingAmount)} outstanding` : undefined} testId="inv-pending" />
        <StatCard label="Overdue" value={s?.overdue ?? '-'} tone="red" foot={s ? inr(s.overdueAmount) : undefined} testId="inv-overdue" />
      </div>
      <Card label="Invoices">
        <CardHead title="Invoice list" hint={data ? `${data.total} invoice${data.total === 1 ? '' : 's'}` : undefined} />
        <div className="px-5 pb-4 flex flex-col gap-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <Tabs<Filter> label="Invoice status" value={filter} onChange={f => { setFilter(f); setPage(1); }} options={[
              { id: 'ALL', label: 'All invoices' }, { id: 'PAID', label: 'Paid', count: s?.paid }, { id: 'PENDING', label: 'Pending', count: s?.pending }, { id: 'OVERDUE', label: 'Overdue', count: s?.overdue }]} />
            <label className="relative lg:w-72">
              <span className="sr-only">Search invoices</span>
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search invoice number or customer" className={`${fieldCls} pl-9 !h-10 text-[13px]`} />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[13px] font-semibold text-slate-600">From
              <input type="date" aria-label="Invoice date from" className={`${fieldCls} !h-10 w-44 mt-1`} value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} />
            </label>
            <label className="text-[13px] font-semibold text-slate-600">To
              <input type="date" aria-label="Invoice date to" className={`${fieldCls} !h-10 w-44 mt-1`} value={to} onChange={e => { setTo(e.target.value); setPage(1); }} />
            </label>
            {(from || to || search || filter !== 'ALL') && <button type="button" className={`${ghostBtn} !h-10`} onClick={clear}>Clear filters</button>}
            {badRange && <span className="text-xs font-semibold text-rose-700" role="alert">The end date is before the start date.</span>}
          </div>
        </div>
        {loading && !data ? <LoadingLine label="Loading invoices…" /> : (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full text-sm">
              <thead className="bg-slate-50"><tr><Th>Invoice</Th><Th>Customer</Th><Th>Service</Th><Th>Invoice date</Th><Th>Due date</Th><Th right>Amount</Th><Th right>Paid</Th><Th right>Outstanding</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-slate-100" data-testid="invoice-rows">
                {data?.items.length === 0 && <EmptyRow cols={9} title={filter === 'ALL' && !q && !from && !to ? 'No invoices yet' : 'No invoices match'} hint={filter === 'ALL' && !q && !from && !to ? 'Invoices of your department\'s customers appear here.' : 'Try another filter, search or date range.'} />}
                {data?.items.map(i => (
                  <tr key={i.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => setOpenId(i.id)} data-testid="invoice-row">
                    <td className="px-4 py-3"><button type="button" className="font-semibold text-blue-700 hover:underline" onClick={e => { e.stopPropagation(); setOpenId(i.id); }} aria-label={`Open invoice ${i.number}`}>{i.number}</button></td>
                    <td className="px-4 py-3 text-slate-800">{i.customer}</td>
                    <td className="px-4 py-3 text-slate-600">{i.services.length ? `${i.services[0]}${i.services.length > 1 ? ` +${i.services.length - 1}` : ''}` : '-'}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dayText(i.issueDate)}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dayText(i.dueDate)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 whitespace-nowrap">{inr(i.amount)}</td>
                    <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap">{inr(i.paidAmount)}</td>
                    <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap">{inr(i.outstanding)}</td>
                    <td className="px-4 py-3"><InvoiceBadge status={i.status} overdue={i.overdue} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > PAGE && <Pager page={page} pageSize={PAGE} total={data.total} noun="invoices" onPage={setPage} sizes={[PAGE]} />}
      </Card>
      {openId && <OpenInvoice id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
};
