import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import type { Invoice, InvoicePage } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { invoicesApi } from '../../lib/api/endpoints';
import { rowOpen } from '../../lib/rowClick';
import { btn, ErrorBanner, longDate, Pager, selectCls, Spinner, useDebounced, usePipelineRealtime } from '../team-member/pipeline/shared';
import { fmtBytes } from './invoiceFiles';
import { INVOICE_KIND_LABEL, InvoiceDetail, InvoiceRowActions, InvoiceStatusPill, rupees } from './invoiceShared';

const PAGE_SIZE = 20;

/**
 * Read-only invoice list for everyone outside Accounts: the database returns only the invoices of
 * customers the viewer may see (Sales: their customers; Technical Consultant: assigned customers).
 */
export const InvoiceBrowser: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'Paid' | 'Pending'>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<InvoicePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Invoice | null>(null);
  const debounced = useDebounced(search.trim());
  const seq = useRef(0);

  const load = useCallback(() => {
    const n = ++seq.current;
    setError(null);
    invoicesApi
      .visible({ search: debounced || undefined, status: status || undefined, page, pageSize: PAGE_SIZE })
      .then(
        r => n === seq.current && setData(r),
        e => n === seq.current && setError(errorMessage(e))
      )
      .finally(() => n === seq.current && setLoading(false));
  }, [debounced, status, page]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [debounced, status]);
  usePipelineRealtime(load);

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">{title}</h1>
          <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Search invoice number or customer</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Invoice number or customer"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </label>
          <select aria-label="Payment status" value={status} onChange={e => setStatus(e.target.value as typeof status)} className={selectCls}>
            <option value="">All statuses</option>
            <option value="Pending">Pending</option>
            <option value="Paid">Paid</option>
          </select>
        </div>
      </div>

      {data && data.total > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(
            [
              ['Invoices', data.total.toLocaleString('en-IN')],
              ['Invoiced', rupees(data.sum ?? 0)],
              ['Paid', rupees(data.paid ?? 0)]
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="bg-white rounded-2xl border border-slate-200/80 p-4">
              <div className="text-xs text-slate-500">{k}</div>
              <div className="text-lg font-bold text-slate-900 mt-0.5">{v}</div>
            </div>
          ))}
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && !data ? (
        <Spinner label="Loading invoices…" />
      ) : data && data.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <FileText className="w-6 h-6 mx-auto text-slate-300" aria-hidden="true" />
          <div className="text-sm font-bold text-slate-800 mt-2">{debounced || status ? 'No invoice matches' : 'No invoices yet'}</div>
          <p className="text-xs text-slate-500 mt-1">
            {debounced || status ? 'Try another search or status.' : 'Invoices appear here once the Accounts department uploads them for your customers.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm min-w-[58rem]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 bg-slate-50/60">
                  <th scope="col" className="px-5 py-3 font-semibold">Invoice</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Customer</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Issue date</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Due date</th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">Amount</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-3 font-semibold">PDF file</th>
                  <th scope="col" className="px-5 py-3 font-semibold text-right">
                    <span className="sr-only">Preview and download</span>
                  </th>
                </tr>
              </thead>
              <tbody className={loading ? 'opacity-60' : ''}>
                {data?.items.map(i => (
                  <tr key={i.id} {...rowOpen(() => setOpen(i))} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 focus-visible:bg-blue-50/50 focus-visible:outline-none">
                    <td className="px-5 py-3.5">
                      <div className="font-bold text-slate-900">{i.number}</div>
                      <div className="text-[11px] text-slate-500">{INVOICE_KIND_LABEL[i.kind]}</div>
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="font-semibold text-slate-800">{i.customer}</div>
                      <div className="text-[11px] text-slate-500">{[i.customerCode, i.department].filter(Boolean).join(' · ') || '-'}</div>
                    </td>
                    <td className="px-3 py-3.5 text-xs text-slate-600">{longDate(i.issueDate)}</td>
                    <td className="px-3 py-3.5 text-xs text-slate-600">{i.dueDate ? longDate(i.dueDate) : '-'}</td>
                    <td className="px-3 py-3.5 text-right font-bold text-slate-900">{rupees(i.total)}</td>
                    <td className="px-3 py-3.5">
                      <InvoiceStatusPill invoice={i} />
                    </td>
                    <td className="px-3 py-3.5 text-xs text-slate-600 max-w-[14rem]">
                      {i.file ? (
                        <>
                          <div className="font-semibold text-slate-800 truncate" title={i.file.fileName}>
                            {i.file.fileName}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {fmtBytes(i.file.sizeBytes)} · {longDate(i.file.uploadedAt)} · {i.file.uploadedBy || 'Accounts'}
                          </div>
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <InvoiceRowActions invoice={i} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data && data.total > PAGE_SIZE && <Pager page={page} pageSize={PAGE_SIZE} total={data.total} noun="invoices" onPage={setPage} />}
        </div>
      )}
      {open && <InvoiceDetail invoice={open} onClose={() => setOpen(null)} />}
    </div>
  );
};
