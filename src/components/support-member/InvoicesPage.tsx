import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { fmtDay, fmtMoney, type SupportInvoice } from '../../lib/support';
import { InvoiceRequests } from './InvoiceRequests';
import { Empty, ErrorBanner, inputClass, KpiCard, Loading, Modal, outstandingOf, PageHeader, Pager, PaymentPill, paymentStatus } from './SupportParts';

const PAGE_SIZE = 10;

interface InvoicesPageProps {
  data: { invoices: SupportInvoice[]; loading: boolean; error: string | null; reload: () => Promise<void> };
  onOpenCustomer?: (id: string) => void;
}

/** Invoices of the customers this member looks after. Read-only: Sales and Accounts raise them. */
export const InvoicesPage: React.FC<InvoicesPageProps> = ({ data, onOpenCustomer }) => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | 'Issued' | 'Paid' | 'Overdue'>('ALL');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.invoices.filter(i => {
      if (status !== 'ALL' && paymentStatus(i) !== status) return false;
      return !q || [i.invoiceNumber, i.customerName, i.customerCode || ''].some(v => v.toLowerCase().includes(q));
    });
  }, [data.invoices, search, status]);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const open = data.invoices.find(i => i.id === openId) || null;
  const outstanding = data.invoices.reduce((n, i) => n + outstandingOf(i), 0);
  const overdue = data.invoices.filter(i => paymentStatus(i) === 'Overdue');

  return (
    <div className="space-y-5">
      <PageHeader title="Invoices" subtitle="Invoices raised for your customers. You can view them here; invoices are created and edited by Sales and Accounts." />
      {data.error && <ErrorBanner message={data.error} onRetry={() => void data.reload()} />}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Invoices" value={data.invoices.length} />
        <KpiCard label="Paid" value={data.invoices.filter(i => i.status === 'Paid').length} tone="text-emerald-700" />
        <KpiCard label="Overdue" value={overdue.length} tone="text-rose-700" />
        <KpiCard label="Outstanding" value={fmtMoney(outstanding)} tone="text-amber-700" />
      </div>

      <InvoiceRequests onOpenCustomer={onOpenCustomer} />

      <div className="bg-white rounded-2xl border border-slate-200/80">
        <div className="px-4 pt-4 text-sm font-bold text-slate-900">Invoices</div>
        <div className="p-4 flex flex-col sm:flex-row gap-3 border-b border-slate-100">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search invoice number, customer or customer ID"
              aria-label="Search invoices"
              className={`${inputClass} pl-9`}
            />
          </div>
          <select
            value={status}
            onChange={e => {
              setStatus(e.target.value as any);
              setPage(1);
            }}
            aria-label="Filter by payment status"
            className={`${inputClass} sm:w-48`}
          >
            <option value="ALL">All payment statuses</option>
            <option value="Issued">Issued</option>
            <option value="Paid">Paid</option>
            <option value="Overdue">Overdue</option>
          </select>
        </div>
        {data.loading ? (
          <Loading label="Loading invoices…" />
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <Empty
              title={data.invoices.length === 0 ? 'No invoices yet' : 'No invoices match these filters'}
              hint={data.invoices.length === 0 ? 'Invoices linked to your customers will appear here once Sales or Accounts issue them.' : undefined}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="py-2.5 px-4 font-semibold">Invoice</th>
                  <th className="py-2.5 px-3 font-semibold">Customer</th>
                  <th className="py-2.5 px-3 font-semibold">Dates</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Amount</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Tax</th>
                  <th className="py-2.5 px-3 font-semibold">Payment</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Outstanding</th>
                  <th className="py-2.5 px-3 font-semibold">Service</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map(i => (
                  <tr key={i.id} className="hover:bg-slate-50/70 cursor-pointer" onClick={() => setOpenId(i.id)}>
                    <td className="py-3 px-4">
                      <button type="button" className="font-mono text-xs font-bold text-blue-700 hover:underline" onClick={() => setOpenId(i.id)}>
                        {i.invoiceNumber}
                      </button>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-800">{i.customerName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{i.customerCode}</div>
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-600 whitespace-nowrap">
                      <div>Issued {fmtDay(i.issueDate)}</div>
                      <div className="text-slate-400">Due {fmtDay(i.dueDate)}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-semibold">{fmtMoney(i.amount)}</td>
                    <td className="py-3 px-3 text-right text-xs text-slate-500">{i.taxAmount !== null ? fmtMoney(i.taxAmount) : '-'}</td>
                    <td className="py-3 px-3">
                      <PaymentPill invoice={i} />
                    </td>
                    <td className="py-3 px-3 text-right text-xs">{fmtMoney(outstandingOf(i))}</td>
                    <td className="py-3 px-3 text-xs text-slate-600 max-w-[12rem] truncate">{i.service || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
      </div>

      {open && (
        <Modal title={`Invoice ${open.invoiceNumber}`} onClose={() => setOpenId(null)} wide>
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-bold text-slate-900">{open.customerName}</div>
                <div className="text-xs text-slate-500">
                  {open.company || 'No company'} ·{' '}
                  {onOpenCustomer && open.customerId ? (
                    <button type="button" className="font-mono text-blue-700 hover:underline" onClick={() => onOpenCustomer(open.customerId!)}>
                      {open.customerCode}
                    </button>
                  ) : (
                    <span className="font-mono">{open.customerCode}</span>
                  )}
                </div>
              </div>
              <PaymentPill invoice={open} />
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <dt className="text-slate-400">Invoice date</dt>
                <dd className="font-semibold mt-0.5">{fmtDay(open.issueDate)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Due date</dt>
                <dd className="font-semibold mt-0.5">{fmtDay(open.dueDate)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Tax / GST</dt>
                <dd className="font-semibold mt-0.5">{open.taxAmount !== null ? fmtMoney(open.taxAmount) : '-'}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Outstanding</dt>
                <dd className="font-semibold mt-0.5">{fmtMoney(outstandingOf(open))}</dd>
              </div>
            </dl>
            {open.items.length > 0 && (
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500">
                      <th className="py-2 px-3 font-semibold">Description</th>
                      <th className="py-2 px-3 font-semibold text-right">Qty</th>
                      <th className="py-2 px-3 font-semibold text-right">Rate</th>
                      <th className="py-2 px-3 font-semibold text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {open.items.map((it, idx) => (
                      <tr key={idx}>
                        <td className="py-2 px-3">{it.description}</td>
                        <td className="py-2 px-3 text-right">{it.quantity}</td>
                        <td className="py-2 px-3 text-right">{fmtMoney(it.rate)}</td>
                        <td className="py-2 px-3 text-right">{fmtMoney(it.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 font-bold">
                      <td colSpan={3} className="py-2 px-3 text-right">
                        Total
                      </td>
                      <td className="py-2 px-3 text-right">{fmtMoney(open.amount)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {open.billingAddress && (
              <div className="text-xs">
                <div className="text-slate-400">Billing address</div>
                <p className="text-slate-700 whitespace-pre-line">{open.billingAddress}</p>
              </div>
            )}
            {open.terms && (
              <div className="text-xs">
                <div className="text-slate-400">Terms</div>
                <p className="text-slate-700 whitespace-pre-line">{open.terms}</p>
              </div>
            )}
            <p className="text-[11px] text-slate-400">View only. Payment status is updated by Sales or Accounts once a payment is verified.</p>
          </div>
        </Modal>
      )}
    </div>
  );
};
