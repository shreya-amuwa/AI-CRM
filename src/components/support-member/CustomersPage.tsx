import React, { useEffect, useState } from 'react';
import { ArrowLeft, ClipboardList, Headset, Plus, Search, UserCheck, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { WorkTaskData } from '../../lib/workTasks';
import {
  CHANNELS,
  CUSTOMER_STATUS_LABELS,
  fmtDay,
  fmtMoney,
  fmtWhen,
  isTicketOpen,
  loadCustomerActivities,
  SEGMENT_LABELS,
  useCustomerStats,
  useSupportCustomers,
  type CustomerActivityRow,
  type CustomerStatusValue,
  type SupportCustomer,
  type SupportInvoice,
  type TicketData
} from '../../lib/support';
import {
  CustomerStatusPill,
  Empty,
  ErrorBanner,
  inputClass,
  KpiCard,
  Loading,
  outstandingOf,
  PageHeader,
  Pager,
  PaymentPill,
  TicketPriorityPill,
  TicketStatusPill
} from './SupportParts';
import { NewTicketModal } from './TicketsPage';
import { DueLabel, PriorityPill, ProgressBar, StatusPill } from '../tasks/TaskParts';
import { getSupabase } from '../../services/supabaseClient';

const PAGE_SIZE = 10;

interface CustomersPageProps {
  /** member: "assigned to me" cards; supervisor: the whole team / department. */
  mode: 'member' | 'supervisor';
  tickets: TicketData;
  tasks: WorkTaskData;
  onOpenCustomer: (id: string) => void;
  onAddCustomer?: () => void;
}

/** Dashboard — Existing Customers (the landing page) and the supervisor's customer list. */
export const CustomersPage: React.FC<CustomersPageProps> = ({ mode, tickets, tasks, onOpenCustomer, onAddCustomer }) => {
  const { profile } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CustomerStatusValue | 'ALL'>('ALL');
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [page, setPage] = useState(1);
  const list = useSupportCustomers({ search, status, scope, page, pageSize: PAGE_SIZE }, profile?.id);
  const { stats, recent } = useCustomerStats(profile?.id);

  const myOpenTickets = tickets.tickets.filter(t => (mode === 'member' ? t.assigneeId === profile?.id : true) && isTicketOpen(t.status)).length;
  const myPendingTasks = tasks.tasks.filter(t => t.assigneeId === profile?.id && t.status !== 'COMPLETED' && t.status !== 'NOT_COMPLETED').length;
  const firstLoad = list.loading && list.items.length === 0 && !list.error;

  return (
    <div className="space-y-5">
      <PageHeader
        title={mode === 'member' ? 'Existing Customers' : 'Support Customers'}
        subtitle={
          mode === 'member'
            ? 'Customers already registered in the CRM, and the ones assigned to you.'
            : 'Every customer your support team handles, including the ones team members add.'
        }
        action={
          onAddCustomer && (
            <button type="button" onClick={onAddCustomer} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 self-start">
              <Plus className="w-4 h-4" aria-hidden="true" /> Add customer
            </button>
          )
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {mode === 'member' ? (
          <KpiCard label="Assigned to me" value={stats.assigned} icon={UserCheck} tone="text-blue-700" />
        ) : (
          <KpiCard label="Total customers" value={stats.total} icon={Users} />
        )}
        <KpiCard label="New (last 30 days)" value={stats.newThisMonth} icon={UserPlus} tone="text-indigo-700" />
        <KpiCard label="Active customers" value={stats.active} icon={Users} tone="text-emerald-700" />
        {mode === 'member' && <KpiCard label="All customers" value={stats.total} icon={Users} />}
        <KpiCard label="Open tickets" value={myOpenTickets} icon={Headset} tone="text-rose-700" />
        <KpiCard label="Pending tasks" value={myPendingTasks} icon={ClipboardList} tone="text-amber-700" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
        <div className="xl:col-span-3 bg-white rounded-2xl border border-slate-200/80">
          <div className="p-4 flex flex-col lg:flex-row gap-3 border-b border-slate-100">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search name, company, phone, e-mail or customer ID"
                aria-label="Search customers"
                className={`${inputClass} pl-9`}
              />
            </div>
            <select
              value={status}
              onChange={e => {
                setStatus(e.target.value as any);
                setPage(1);
              }}
              aria-label="Filter by status"
              className={`${inputClass} lg:w-44`}
            >
              <option value="ALL">All statuses</option>
              {(Object.keys(CUSTOMER_STATUS_LABELS) as CustomerStatusValue[]).map(s => (
                <option key={s} value={s}>
                  {CUSTOMER_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              value={scope}
              onChange={e => {
                setScope(e.target.value as any);
                setPage(1);
              }}
              aria-label="Filter by assignment"
              className={`${inputClass} lg:w-44`}
            >
              <option value="all">All customers</option>
              <option value="mine">Assigned to me</option>
            </select>
          </div>

          {list.error && (
            <div className="p-4">
              <ErrorBanner message={list.error} onRetry={() => void list.reload()} />
            </div>
          )}
          {firstLoad ? (
            <Loading label="Loading customers…" />
          ) : list.items.length === 0 && !list.error ? (
            <div className="p-6">
              <Empty
                title={search || status !== 'ALL' || scope === 'mine' ? 'No customers match these filters' : 'No customers yet'}
                hint={search || status !== 'ALL' || scope === 'mine' ? 'Clear the search or filters to see everyone.' : 'Add the first customer to get started.'}
                action={
                  onAddCustomer && (
                    <button type="button" onClick={onAddCustomer} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold">
                      Add customer
                    </button>
                  )
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                    <th className="py-2.5 px-4 font-semibold">Customer</th>
                    <th className="py-2.5 px-3 font-semibold">Contact</th>
                    <th className="py-2.5 px-3 font-semibold">Company</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-3 font-semibold">Assigned to</th>
                    <th className="py-2.5 px-3 font-semibold">Last interaction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {list.items.map(c => (
                    <tr key={c.id} className="hover:bg-slate-50/70 cursor-pointer" onClick={() => onOpenCustomer(c.id)}>
                      <td className="py-3 px-4">
                        <button type="button" className="font-semibold text-blue-700 hover:underline text-left" onClick={() => onOpenCustomer(c.id)}>
                          {c.name}
                        </button>
                        <div className="text-[11px] text-slate-400 font-mono">{c.code}</div>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600">
                        <div>{c.phone || '—'}</div>
                        <div className="text-slate-400">{c.email || ''}</div>
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600">{c.company || '—'}</td>
                      <td className="py-3 px-3">
                        <CustomerStatusPill status={c.status} />
                      </td>
                      <td className="py-3 px-3 text-xs text-slate-600">{c.ownerId === profile?.id ? 'You' : c.ownerName || 'Team member'}</td>
                      <td className="py-3 px-3 text-xs text-slate-500 whitespace-nowrap">{fmtWhen(c.lastInteractionAt || c.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={page} pageSize={PAGE_SIZE} total={list.total} onPage={setPage} />
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 self-start">
          <h2 className="text-sm font-bold text-slate-900 mb-3">Recently added or updated</h2>
          {recent.length === 0 ? (
            <p className="text-xs text-slate-400">Nothing yet.</p>
          ) : (
            <ul className="space-y-3">
              {recent.map(c => (
                <li key={c.id}>
                  <button type="button" onClick={() => onOpenCustomer(c.id)} className="text-left w-full group">
                    <div className="text-sm font-semibold text-slate-800 group-hover:text-blue-700">{c.name}</div>
                    <div className="text-[11px] text-slate-400">
                      {c.company || 'No company'} · {fmtWhen(c.updatedAt)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Customer profile
// ---------------------------------------------------------------------------
const ACTIVITY_LABELS: Record<string, string> = {
  CUSTOMER_CREATED: 'Customer added',
  TICKET_OPENED: 'Ticket opened'
};

const TABS = ['Overview', 'Communication', 'Tickets', 'Tasks', 'Invoices'] as const;

export const CustomerProfile: React.FC<{
  customerId: string;
  tickets: TicketData;
  tasks: WorkTaskData;
  invoices: SupportInvoice[];
  people: import('../../lib/workTasks').Person[];
  onBack: () => void;
}> = ({ customerId, tickets, tasks, invoices, people, onBack }) => {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const [customer, setCustomer] = useState<SupportCustomer | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [activities, setActivities] = useState<CustomerActivityRow[]>([]);
  const [newTicket, setNewTicket] = useState(false);

  useEffect(() => {
    let live = true;
    setState('loading');
    const supabase = getSupabase();
    if (!supabase) {
      setState('error');
      return;
    }
    supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (!live) return;
        if (error) return setState('error');
        if (!data) return setState('missing');
        const { data: owner } = await supabase.from('profiles').select('full_name').eq('id', data.owner_id).maybeSingle();
        if (!live) return;
        setCustomer({
          id: data.id,
          code: data.customer_code,
          name: data.name,
          company: data.company,
          email: data.email,
          phone: data.phone,
          segment: data.segment,
          status: data.status,
          ownerId: data.owner_id,
          ownerName: owner?.full_name ?? null,
          channel: data.channel,
          service: data.service_interest,
          requirement: data.requirement,
          notes: data.notes,
          createdAt: data.created_at,
          updatedAt: data.updated_at,
          lastInteractionAt: null
        });
        setState('ready');
      });
    loadCustomerActivities(customerId).then(a => live && setActivities(a), () => undefined);
    return () => {
      live = false;
    };
  }, [customerId, tickets.tickets.length]);

  const myTickets = tickets.tickets.filter(t => t.customerId === customerId);
  const myTasks = tasks.tasks.filter(t => t.customerId === customerId);
  const myInvoices = invoices.filter(i => i.customerId === customerId);
  const { profile } = useAuth();

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800">
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Back
      </button>
      {state === 'loading' && <Loading label="Loading customer…" />}
      {state === 'missing' && <Empty title="Customer not found" hint="It may have been removed, or you may not have access to it." />}
      {state === 'error' && <ErrorBanner message="Could not load this customer." />}
      {state === 'ready' && customer && (
        <>
          <div className="bg-white rounded-2xl border border-slate-200/80 p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold font-heading text-slate-900">{customer.name}</h1>
                <CustomerStatusPill status={customer.status} />
              </div>
              <p className="text-xs text-slate-500 mt-1">
                <span className="font-mono">{customer.code}</span> · {customer.company || 'No company'} · {SEGMENT_LABELS[customer.segment]}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {customer.phone || 'No phone'} · {customer.email || 'No e-mail'}
              </p>
            </div>
            <button type="button" onClick={() => setNewTicket(true)} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 self-start shrink-0">
              <Plus className="w-4 h-4" aria-hidden="true" /> New ticket
            </button>
          </div>

          <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200">
            {TABS.map(t => {
              const n = t === 'Tickets' ? myTickets.length : t === 'Tasks' ? myTasks.length : t === 'Invoices' ? myInvoices.length : t === 'Communication' ? activities.length : null;
              return (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`px-4 py-2.5 text-xs font-bold whitespace-nowrap border-b-2 -mb-px ${tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                >
                  {t}
                  {n !== null && <span className="ml-1.5 text-[10px] bg-slate-100 text-slate-600 rounded-full px-1.5 py-0.5">{n}</span>}
                </button>
              );
            })}
          </div>

          {tab === 'Overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5">
                <h2 className="text-sm font-bold text-slate-900 mb-3">Details</h2>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                  {[
                    ['Assigned to', customer.ownerId === profile?.id ? 'You' : customer.ownerName || 'Team member'],
                    ['Customer type', SEGMENT_LABELS[customer.segment]],
                    ['Service / product', customer.service || '—'],
                    ['Channel', customer.channel && (CHANNELS as readonly string[]).includes(customer.channel) ? customer.channel : customer.channel || '—'],
                    ['Added', fmtDay(customer.createdAt)],
                    ['Last updated', fmtWhen(customer.updatedAt)]
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-slate-400">{k}</dt>
                      <dd className="font-semibold text-slate-800 mt-0.5">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="bg-white rounded-2xl border border-slate-200/80 p-5 space-y-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 mb-1">Query / requirement</h2>
                  <p className="text-sm text-slate-600 whitespace-pre-line">{customer.requirement || 'Nothing recorded.'}</p>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 mb-1">Notes</h2>
                  <p className="text-sm text-slate-600 whitespace-pre-line">{customer.notes || 'No notes.'}</p>
                </div>
              </div>
            </div>
          )}

          {tab === 'Communication' && (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-5">
              {activities.length === 0 ? (
                <p className="text-xs text-slate-400">No communication recorded yet.</p>
              ) : (
                <ol className="space-y-3 border-l border-slate-200 pl-4">
                  {activities.map(a => (
                    <li key={a.id} className="text-xs relative">
                      <span className="absolute -left-[21px] top-1 w-2 h-2 rounded-full bg-blue-400" aria-hidden="true" />
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-slate-800">{ACTIVITY_LABELS[a.type] || a.type.replace(/_/g, ' ').toLowerCase()}</span>
                        {a.actorName && <span className="text-slate-500">by {a.actorName}</span>}
                        <span className="text-[10px] text-slate-400">{fmtWhen(a.occurredAt)}</span>
                      </div>
                      {a.note && <p className="text-slate-600 mt-0.5 whitespace-pre-line">{a.note}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {tab === 'Tickets' &&
            (myTickets.length === 0 ? (
              <Empty title="No tickets for this customer" hint="Create one when the customer raises a query or issue." />
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100">
                {myTickets.map(t => (
                  <div key={t.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-800">
                        <span className="font-mono text-xs text-blue-700 mr-2">{t.ticketNo}</span>
                        {t.subject}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">Updated {fmtWhen(t.updatedAt)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <TicketPriorityPill priority={t.priority} />
                      <TicketStatusPill status={t.status} />
                    </div>
                  </div>
                ))}
              </div>
            ))}

          {tab === 'Tasks' &&
            (myTasks.length === 0 ? (
              <Empty title="No tasks for this customer" />
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100">
                {myTasks.map(t => (
                  <div key={t.id} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{t.title}</span>
                        <PriorityPill priority={t.priority} />
                      </div>
                      <StatusPill status={t.status} />
                    </div>
                    <ProgressBar value={t.progress} label={`Progress of ${t.title}`} />
                    <div className="text-[11px] text-slate-500 flex flex-wrap gap-3">
                      <span>{people.find(p => p.id === t.assigneeId)?.fullName || 'Team member'}</span>
                      <DueLabel task={t} />
                    </div>
                  </div>
                ))}
              </div>
            ))}

          {tab === 'Invoices' &&
            (myInvoices.length === 0 ? (
              <Empty title="No invoices for this customer" hint="Invoices raised by Sales or Accounts for this customer appear here." />
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100">
                {myInvoices.map(i => (
                  <div key={i.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-800 font-mono">{i.invoiceNumber}</div>
                      <div className="text-[11px] text-slate-400">
                        Issued {fmtDay(i.issueDate)} · due {fmtDay(i.dueDate)}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-slate-800">{fmtMoney(i.amount)}</span>
                      <PaymentPill invoice={i} />
                      {outstandingOf(i) > 0 && <span className="text-[11px] text-slate-500">{fmtMoney(outstandingOf(i))} outstanding</span>}
                    </div>
                  </div>
                ))}
              </div>
            ))}

          {newTicket && (
            <NewTicketModal
              people={people}
              customerId={customer.id}
              onClose={() => setNewTicket(false)}
              onCreated={() => {
                setNewTicket(false);
                setTab('Tickets');
                void tickets.reload();
              }}
            />
          )}
        </>
      )}
    </div>
  );
};
