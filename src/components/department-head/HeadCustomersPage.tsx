import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { DepartmentCustomers } from '../handover/DepartmentCustomers';
import { CustomerQuickView } from '../team-member/pipeline/CustomerQuickView';
import { Dialog, Pager, useDebounced } from '../team-member/pipeline/shared';
import { Avatar, Card, CardHead, fieldCls, ghostBtn, LoadingLine, StatCard, Tabs } from '../tasks/head/headParts';
import { dayText, headApi, inr, useHeadData, type CustomerStatus } from '../../lib/headDashboard';
import { Badge, CUSTOMER_BADGE, EmptyRow, InvoiceBadge, OpenInvoice, PageError, Th } from './headBits';

type Filter = 'ALL' | CustomerStatus;
type View = 'overview' | 'handover';
const PAGE = 15;

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 min-w-0">
    <div className="text-[11px] text-slate-500">{label}</div>
    <div className="mt-0.5 text-[13px] font-semibold text-slate-800 break-words">{children}</div>
  </div>
);

/** One customer of the department: profile, services, who looks after it, the payment summary, invoices (open one), where it came from and its tickets. */
const CustomerPanel: React.FC<{ id: string; onClose: () => void; onOpenRecord: (id: string) => void }> = ({ id, onClose, onOpenRecord }) => {
  const { data, error, loading, reload } = useHeadData(() => headApi.customer(id), [id]);
  const tickets = useHeadData(() => headApi.customerTickets(id), [id]);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const c = data?.customer;
  return (
    <>
      <Dialog title={c ? (c.company || c.name) : 'Customer'} description={c ? `${c.code ?? ''}${c.department ? ` · ${c.department}` : ''}` : undefined} onClose={onClose} wide>
        {error ? <PageError message={error} onRetry={reload} /> : loading && !data ? <LoadingLine label="Loading the customer…" /> : data && c && (
          <div className="space-y-5" data-testid="customer-panel">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={CUSTOMER_BADGE[c.status]?.tone ?? 'slate'}>{CUSTOMER_BADGE[c.status]?.label ?? c.status}</Badge>
              <span className="text-xs text-slate-500">Customer since {dayText(c.customerSince ?? c.createdAt)}</span>
              <button type="button" className={`${ghostBtn} !h-9 ml-auto`} onClick={() => onOpenRecord(c.id)}>Open full customer record</button>
            </div>
            <section aria-label="Profile">
              <h3 className="text-sm font-extrabold text-slate-900 mb-2">Profile</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                <Fact label="Contact person">{c.name}</Fact>
                <Fact label="Phone">{c.phone || '-'}</Fact>
                <Fact label="Email">{c.email || '-'}</Fact>
                <Fact label="City">{c.city || '-'}</Fact>
                <Fact label="Relationship manager">{c.relationshipManager?.name || '-'}</Fact>
                <Fact label="Team Lead">{c.teamLead?.name || '-'}</Fact>
                <Fact label="Team Member">{c.teamMember?.name || '-'}</Fact>
                <Fact label="Client login">{c.hasClientLogin ? 'Created' : 'Not created'}</Fact>
              </div>
            </section>
            <section aria-label="Services">
              <h3 className="text-sm font-extrabold text-slate-900 mb-2">Services purchased</h3>
              {data.services.length === 0 ? <p className="text-xs text-slate-500">No services are recorded.</p> : (
                <div className="flex flex-wrap gap-1.5">{data.services.map(s => <Badge key={s.code} tone="blue">{s.name}</Badge>)}</div>
              )}
            </section>
            <section aria-label="Payments and invoices">
              <h3 className="text-sm font-extrabold text-slate-900 mb-2">Invoices and payments</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-3">
                <Fact label="Invoiced">{inr(data.invoiceSummary.invoiced)}</Fact>
                <Fact label="Paid">{inr(data.invoiceSummary.paid)}</Fact>
                <Fact label="Outstanding">{inr(data.invoiceSummary.outstanding)}</Fact>
                <Fact label="Agreed amount / received">{data.payments.dealAmount === null ? '-' : `${inr(data.payments.dealAmount)} / ${inr(data.payments.amountReceived)}`}</Fact>
              </div>
              {data.invoices.length === 0 ? <p className="text-xs text-slate-500">No invoice has been issued to this customer yet.</p> : (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50"><tr><Th>Invoice</Th><Th>Date</Th><Th>Due</Th><Th right>Amount</Th><Th>Status</Th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.invoices.map(i => (
                        <tr key={i.id}>
                          <td className="px-4 py-2"><button type="button" className="font-semibold text-blue-700 hover:underline" onClick={() => setInvoiceId(i.id)} aria-label={`Open invoice ${i.number}`}>{i.number}</button></td>
                          <td className="px-4 py-2 text-slate-600">{dayText(i.issueDate)}</td>
                          <td className="px-4 py-2 text-slate-600">{dayText(i.dueDate)}</td>
                          <td className="px-4 py-2 text-right font-semibold">{inr(i.amount)}</td>
                          <td className="px-4 py-2"><InvoiceBadge status={i.status} overdue={i.overdue} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <section aria-label="Lead origin">
              <h3 className="text-sm font-extrabold text-slate-900 mb-2">Where it came from</h3>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
                <Fact label="Lead source">{data.origin.leadSource || 'Not recorded'}</Fact>
                <Fact label="Lead added">{data.origin.leadCreatedAt ? dayText(data.origin.leadCreatedAt) : 'Not recorded'}</Fact>
                <Fact label="Expected budget">{inr(data.origin.expectedBudget)}</Fact>
              </div>
            </section>
            <section aria-label="Support tickets">
              <h3 className="text-sm font-extrabold text-slate-900 mb-2">Support tickets</h3>
              {tickets.error ? <p className="text-xs text-rose-700" role="alert">{tickets.error}</p> : tickets.loading && !tickets.data ? <p className="text-xs text-slate-500">Loading…</p> : !tickets.data?.length ? <p className="text-xs text-slate-500">No tickets.</p> : (
                <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                  {tickets.data.slice(0, 8).map(t => (
                    <li key={t.id} className="px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0"><span className="font-semibold text-slate-800">{t.subject}</span><span className="block text-slate-500">{t.ticketNo} · {dayText(t.createdAt)}{t.assignee ? ` · ${t.assignee.name}` : ''}</span></span>
                      <Badge tone={t.status === 'RESOLVED' || t.status === 'CLOSED' ? 'green' : t.status === 'ESCALATED' ? 'red' : 'amber'}>{t.status.replace(/_/g, ' ').toLowerCase()}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </Dialog>
      {invoiceId && <OpenInvoice id={invoiceId} onClose={() => setInvoiceId(null)} />}
    </>
  );
};

/**
 * Customers of the department. "Overview": the summary cards, search, a status filter and the table; a click opens the customer. "Hand-overs & tickets" is
 * the page that was here before, unchanged. The numbers and rows come from read-only database functions scoped to the head's department.
 */
export const HeadCustomersPage: React.FC<{ initialSearch?: string; waitingForLead?: number | null; onOpenHandovers?: () => void }> = ({ initialSearch = '', waitingForLead, onOpenHandovers }) => {
  const [view, setView] = useState<View>(initialSearch ? 'handover' : 'overview');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [recordId, setRecordId] = useState<string | null>(null);
  const q = useDebounced(search, 300);
  const { data, error, loading, reload } = useHeadData(
    () => (view === 'overview' ? headApi.customers({ search: q, status: filter === 'ALL' ? null : filter, limit: PAGE, offset: (page - 1) * PAGE }) : Promise.resolve(null)),
    [q, filter, page, view]
  );
  const s = data?.summary;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900">Customers</h1>
        <p className="mt-1.5 text-[15px] text-slate-600 max-w-2xl">Your department's customers, who looks after them, their services and invoices.</p>
      </div>
      <Tabs<View> label="Customers view" value={view} onChange={setView} options={[{ id: 'overview', label: 'Overview' }, { id: 'handover', label: 'Hand-overs & tickets' }]} />
      {view === 'handover' ? (
        <DepartmentCustomers initialSearch={initialSearch} waitingForLead={waitingForLead} onOpenHandovers={onOpenHandovers} />
      ) : (
        <>
          {error && <PageError message={error} onRetry={reload} />}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" aria-label="Customer summary">
            <StatCard label="Total customers" value={s?.total ?? '-'} testId="cust-total" />
            <StatCard label="Active" value={s?.active ?? '-'} tone="green" testId="cust-active" />
            <StatCard label="New (30 days)" value={s?.new ?? '-'} tone="blue" testId="cust-new" />
            <StatCard label="Inactive" value={s?.inactive ?? '-'} testId="cust-inactive" />
            <StatCard label="Pending invoices" value={s?.withPendingInvoices ?? '-'} tone="amber" foot="Customers with an unpaid invoice" testId="cust-pending" />
          </div>
          <Card label="Customers">
            <CardHead title="Customer list" hint={data ? `${data.total} customer${data.total === 1 ? '' : 's'}` : undefined} />
            <div className="px-5 pb-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <Tabs<Filter> label="Customer status" value={filter} onChange={f => { setFilter(f); setPage(1); }} options={[
                { id: 'ALL', label: 'All', count: s?.total }, { id: 'ACTIVE', label: 'Active', count: s?.active }, { id: 'INACTIVE', label: 'Inactive', count: s?.inactive }, { id: 'PROSPECT', label: 'Prospect' }]} />
              <label className="relative lg:w-72">
                <span className="sr-only">Search customers</span>
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <input type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search customer name or company" className={`${fieldCls} pl-9 !h-10 text-[13px]`} />
              </label>
            </div>
            {loading && !data ? <LoadingLine label="Loading customers…" /> : (
              <div className="overflow-x-auto border-t border-slate-100">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50"><tr><Th>Customer</Th><Th>Contact</Th><Th>Status</Th><Th>Relationship manager</Th><Th>Services</Th><Th>Department</Th><Th>Created</Th><Th right>Pending</Th></tr></thead>
                  <tbody className="divide-y divide-slate-100" data-testid="customer-rows">
                    {data?.items.length === 0 && <EmptyRow cols={8} title={filter === 'ALL' && !q ? 'No customers yet' : 'No customers match'} hint={filter === 'ALL' && !q ? 'Customers of your department appear here.' : 'Try another filter or search.'} />}
                    {data?.items.map(c => (
                      <tr key={c.id} className="hover:bg-blue-50/40 cursor-pointer" onClick={() => setOpenId(c.id)} data-testid="customer-row">
                        <td className="px-4 py-3">
                          <button type="button" className="text-left font-semibold text-slate-900 hover:text-blue-700" onClick={e => { e.stopPropagation(); setOpenId(c.id); }} aria-label={`Open customer ${c.company || c.name}`}>{c.company || c.name}</button>
                          <span className="block text-[11px] text-slate-500">{c.company ? c.name : ''}{c.code ? `${c.company ? ' · ' : ''}${c.code}` : ''}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{c.phone || '-'}{c.email ? <span className="block text-[11px] text-slate-400">{c.email}</span> : null}</td>
                        <td className="px-4 py-3"><Badge tone={CUSTOMER_BADGE[c.status]?.tone ?? 'slate'}>{CUSTOMER_BADGE[c.status]?.label ?? c.status}</Badge></td>
                        <td className="px-4 py-3">{c.relationshipManager ? <span className="flex items-center gap-2"><Avatar name={c.relationshipManager.name} size={26} /><span className="text-slate-700">{c.relationshipManager.name}</span></span> : '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{c.services.length ? `${c.services[0]!.name}${c.services.length > 1 ? ` +${c.services.length - 1}` : ''}` : '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{c.department || '-'}</td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{dayText(c.createdAt)}</td>
                        <td className="px-4 py-3 text-right">{c.pendingInvoices > 0 ? <Badge tone="amber">{c.pendingInvoices}</Badge> : <span className="text-slate-400">-</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data && data.total > PAGE && <Pager page={page} pageSize={PAGE} total={data.total} noun="customers" onPage={setPage} sizes={[PAGE]} />}
          </Card>
        </>
      )}
      {openId && <CustomerPanel id={openId} onClose={() => setOpenId(null)} onOpenRecord={id => setRecordId(id)} />}
      {recordId && <CustomerQuickView id={recordId} onClose={() => setRecordId(null)} />}
    </div>
  );
};
