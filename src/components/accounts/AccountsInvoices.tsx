import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FilePlus2, FileText, Search, UploadCloud } from 'lucide-react';
import type { Invoice, InvoiceCustomer, InvoiceKind, InvoicePage } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { invoicesApi } from '../../lib/api/endpoints';
import { rowOpen } from '../../lib/rowClick';
import {
  btn,
  Dialog,
  ErrorBanner,
  Field,
  inputCls,
  longDate,
  notifyPipelineChanged,
  Pager,
  selectCls,
  Spinner,
  todayIso,
  useDebounced,
  usePipelineRealtime,
  useServiceCatalog
} from '../team-member/pipeline/shared';
import { fmtBytes, UploadInvoiceDialog } from '../invoices/invoiceFiles';
import {
  INVOICE_KIND_LABEL,
  InvoiceDetail,
  InvoiceRowActions,
  InvoiceStatusPill,
  type LineDraft,
  newLine,
  PricedLinesEditor,
  rupees,
  toInput,
  validateLines
} from '../invoices/invoiceShared';

const PAGE_SIZE = 20;

/**
 * Accounts: every invoice, in one place. Accounts is the only department that issues invoices: for
 * a customer's original services (here) and for approved add-ons (from Business Verification). The
 * database numbers each invoice, works out the totals and refuses changes from anyone else.
 */
export const AccountsInvoices: React.FC = () => {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'' | InvoiceKind>('');
  const [status, setStatus] = useState<'' | 'Paid' | 'Pending'>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<InvoicePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Invoice | null>(null);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const debounced = useDebounced(search.trim());
  const seq = useRef(0);

  const load = useCallback(() => {
    const n = ++seq.current;
    setError(null);
    invoicesApi
      .list({ search: debounced || undefined, kind: kind || undefined, status: status || undefined, page, pageSize: PAGE_SIZE })
      .then(
        r => n === seq.current && setData(r),
        e => n === seq.current && setError(errorMessage(e))
      )
      .finally(() => n === seq.current && setLoading(false));
  }, [debounced, kind, status, page]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [debounced, kind, status]);
  usePipelineRealtime(load);

  const setPaid = async (inv: Invoice, next: 'Paid' | 'Pending') => {
    setBusy(true);
    setActionError(null);
    try {
      const fresh = await invoicesApi.setStatus(inv.id, next);
      setOpen(fresh);
      notifyPipelineChanged();
      load();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Invoices</h1>
          <p className="text-sm text-slate-500 mt-1">Upload existing invoice PDFs or issue invoices for original services and add-ons. Only Accounts uploads and manages them; every employee who may see the customer can view and download them.</p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button type="button" className={btn.primary} onClick={() => setUploading(true)}>
            <UploadCloud className="w-4 h-4" aria-hidden="true" /> Upload Invoice PDF
          </button>
          <button type="button" className={btn.secondary} onClick={() => setCreating(true)}>
            <FilePlus2 className="w-4 h-4" aria-hidden="true" /> New invoice
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <label className="relative w-full sm:w-72">
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
        <select aria-label="Invoice type" value={kind} onChange={e => setKind(e.target.value as typeof kind)} className={selectCls}>
          <option value="">All types</option>
          <option value="SERVICE">Services</option>
          <option value="ADDON">Add-on services</option>
          <option value="UPLOADED">Uploaded PDFs</option>
          <option value="MANUAL">Earlier invoices</option>
        </select>
        <select aria-label="Payment status" value={status} onChange={e => setStatus(e.target.value as typeof status)} className={selectCls}>
          <option value="">All statuses</option>
          <option value="Pending">Pending</option>
          <option value="Paid">Paid</option>
        </select>
      </div>

      {notice && (
        <p role="status" className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          {notice}
        </p>
      )}
      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && !data ? (
        <Spinner label="Loading invoices…" />
      ) : data && data.items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <FileText className="w-6 h-6 mx-auto text-slate-300" aria-hidden="true" />
          <div className="text-sm font-bold text-slate-800 mt-2">{debounced || kind || status ? 'No invoice matches' : 'No invoices yet'}</div>
          <p className="text-xs text-slate-500 mt-1">{debounced || kind || status ? 'Try another search or filter.' : 'Create the first invoice with New invoice.'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm min-w-[64rem]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100 bg-slate-50/60">
                  <th scope="col" className="px-5 py-3 font-semibold">Invoice</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Customer</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Issue date</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Due date</th>
                  <th scope="col" className="px-3 py-3 font-semibold text-right">Total</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-3 font-semibold">PDF file</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Uploaded / issued by</th>
                  <th scope="col" className="px-5 py-3 font-semibold text-right">
                    <span className="sr-only">Download</span>
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
                          <div className="text-[11px] text-slate-500">{fmtBytes(i.file.sizeBytes)}</div>
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-xs text-slate-600">
                      <div>{i.issuedBy || '-'}</div>
                      <div className="text-[11px] text-slate-500">
                        {new Date(i.file?.uploadedAt || i.issuedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                      </div>
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

      {open && (
        <InvoiceDetail
          invoice={open}
          canManage
          onChanged={inv => {
            setOpen(inv);
            notifyPipelineChanged();
            load();
          }}
          onClose={() => {
            setOpen(null);
            setActionError(null);
          }}
          actions={
            <>
              {actionError && <span className="w-full"><ErrorBanner message={actionError} /></span>}
              {open.kind === 'ADDON' ? (
                <span className="text-[11px] text-slate-500 self-center">Add-on invoices are paid through the payment confirmation in Business Verification.</span>
              ) : open.status === 'Paid' ? (
                <button type="button" className={btn.secondary} disabled={busy} onClick={() => void setPaid(open, 'Pending')}>
                  Mark as pending
                </button>
              ) : (
                <button type="button" className={btn.green} disabled={busy} onClick={() => void setPaid(open, 'Paid')}>
                  {busy ? 'Saving…' : 'Mark as paid'}
                </button>
              )}
            </>
          }
        />
      )}
      {uploading && (
        <UploadInvoiceDialog
          onClose={() => setUploading(false)}
          onUploaded={inv => {
            setUploading(false);
            setNotice(`Invoice ${inv.number} was uploaded for ${inv.customer}. Everyone who may see this customer can now open it.`);
            notifyPipelineChanged();
            load();
            setOpen(inv);
          }}
        />
      )}
      {creating && (
        <NewInvoiceDialog
          onClose={() => setCreating(false)}
          onCreated={inv => {
            setCreating(false);
            setNotice(`Invoice ${inv.number} issued to ${inv.customer} (${rupees(inv.total)}). Sales can now see it.`);
            notifyPipelineChanged();
            load();
            setOpen(inv);
          }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// New invoice for a customer's original services
// ---------------------------------------------------------------------------
const NewInvoiceDialog: React.FC<{ onClose: () => void; onCreated: (i: Invoice) => void }> = ({ onClose, onCreated }) => {
  const { items: catalog } = useServiceCatalog();
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<InvoiceCustomer[] | null>(null);
  const [customer, setCustomer] = useState<InvoiceCustomer | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounced(search.trim());

  useEffect(() => {
    let live = true;
    invoicesApi.customers(debounced || undefined).then(
      c => live && setCustomers(c),
      e => live && setError(errorMessage(e))
    );
    return () => {
      live = false;
    };
  }, [debounced]);

  const pick = (c: InvoiceCustomer) => {
    setCustomer(c);
    setError(null);
    // One line per service sold; with a single service the deal amount is a sensible start.
    setLines(
      c.services.length
        ? c.services.map(s => ({ ...newLine(s.code), taxPercent: '0', unitPrice: c.services.length === 1 && c.dealAmount ? String(c.dealAmount) : '' }))
        : [newLine(catalog[0]?.code || '')]
    );
  };

  const submit = async () => {
    if (!customer) return;
    const problem = validateLines(lines);
    if (problem) return setError(problem);
    if (dueDate && dueDate < issueDate) return setError('The due date cannot be before the issue date.');
    setBusy(true);
    setError(null);
    try {
      onCreated(await invoicesApi.create({ customerId: customer.id, items: toInput(lines), issueDate, dueDate: dueDate || null, note: note.trim() || null }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="New invoice" description="For a customer's original services. Add-on invoices are generated from Business Verification after approval." onClose={onClose} wide>
      {!customer ? (
        <div className="space-y-3">
          <label className="relative block">
            <span className="sr-only">Search customer</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, business or customer ID" className={`${inputCls} pl-9`} />
          </label>
          {error && <ErrorBanner message={error} />}
          {!customers ? (
            <Spinner label="Loading customers…" />
          ) : customers.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">No customer to invoice. Customers appear here once they reach onboarding or are sent to Accounts.</p>
          ) : (
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl max-h-80 overflow-y-auto" aria-label="Customers">
              {customers.map(c => (
                <li key={c.id}>
                  <button type="button" onClick={() => pick(c)} className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-left text-xs hover:bg-slate-50">
                    <span className="font-semibold text-slate-800">{c.company || c.name}</span>
                    <span className="text-slate-500">{[c.customerCode, c.department].filter(Boolean).join(' · ')}</span>
                    <span className="text-slate-500">{c.services.map(s => s.name).join(', ')}</span>
                    <span className="ml-auto text-slate-600">Deal {rupees(c.dealAmount)}</span>
                    {c.hasServiceInvoice && <span className="text-[11px] font-semibold text-amber-700">Already invoiced</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs">
            <div>
              <div className="font-bold text-slate-900">{customer.company || customer.name}</div>
              <div className="text-slate-500">
                {[customer.customerCode, customer.department].filter(Boolean).join(' · ')} · deal {rupees(customer.dealAmount)} · verified {rupees(customer.amountVerified)}
              </div>
            </div>
            <button type="button" className={btn.secondary} disabled={busy} onClick={() => setCustomer(null)}>
              Change customer
            </button>
          </div>
          {customer.hasServiceInvoice && (
            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">This customer already has a services invoice. Issue another only if it is a separate bill.</p>
          )}
          <PricedLinesEditor lines={lines} onChange={setLines} catalog={catalog} disabled={busy} idPrefix="ni" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Issue date" htmlFor="ni-issue" required>
              <input id="ni-issue" type="date" value={issueDate} max={todayIso()} onChange={e => setIssueDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Due date" htmlFor="ni-due">
              <input id="ni-due" type="date" value={dueDate} min={issueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Note" htmlFor="ni-note">
              <input id="ni-note" value={note} maxLength={1000} onChange={e => setNote(e.target.value)} className={inputCls} placeholder="Optional" />
            </Field>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2">
            <button type="button" className={btn.secondary} disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={btn.primary} disabled={busy} onClick={() => void submit()}>
              {busy ? 'Issuing…' : 'Issue invoice'}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
};
