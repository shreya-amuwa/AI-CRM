import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpCircle, Clock, Plus, Search, Send, Settings2, UserCog } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { Person } from '../../lib/workTasks';
import {
  fmtWhen,
  isAwaitingReply,
  isTicketOpen,
  isTicketOverdue,
  slaText,
  ticketApi,
  ticketSlaApi,
  TICKET_LEVEL_LABELS,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  useCustomerOptions,
  type SupportTicket,
  type TicketCategory,
  type TicketData,
  type TicketLevel,
  type TicketPriority,
  type TicketSla,
  type TicketStatus
} from '../../lib/support';
import {
  Empty,
  ErrorBanner,
  FormField,
  inputClass,
  KpiCard,
  Loading,
  Modal,
  PageHeader,
  Pager,
  TicketPriorityPill,
  TicketStatusPill
} from './SupportParts';

const personName = (people: Person[], id: string | null) => (id ? people.find(p => p.id === id)?.fullName || 'Team member' : 'Unassigned');
const PRIORITY_RANK: Record<TicketPriority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const PAGE_SIZE = 10;
/** Who handles the ticket now: the RM (assignee) until it is escalated to a Team Lead / Department Head. */
const handlerId = (t: SupportTicket) => (t.escalationLevel === 'RM' ? t.assigneeId : t.escalatedTo);

/** Small markers on a ticket row / card: escalation level, waiting for our reply, SLA. */
const TicketFlags: React.FC<{ ticket: SupportTicket }> = ({ ticket: t }) => (
  <span className="inline-flex flex-wrap items-center gap-1">
    {isAwaitingReply(t) && (
      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] font-bold" title="The customer is waiting for a reply">
        Awaiting reply
      </span>
    )}
    {t.escalationLevel !== 'RM' && isTicketOpen(t.status) && (
      <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 text-[10px] font-bold">With {TICKET_LEVEL_LABELS[t.escalationLevel]}</span>
    )}
    {isTicketOverdue(t) && <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold">Overdue</span>}
  </span>
);

interface TicketsPageProps {
  /** member: own tickets; manager: the team's / department's tickets (team lead, department head). */
  mode: 'member' | 'manager';
  data: TicketData;
  people: Person[];
  onOpenCustomer?: (customerId: string) => void;
}

/** Customer queries, complaints and service requests. Not tasks, not invoices. */
export const TicketsPage: React.FC<TicketsPageProps> = ({ mode, data, people, onOpenCustomer }) => {
  const { profile } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<TicketStatus | 'ALL' | 'OPEN_ONLY' | 'OVERDUE' | 'AWAITING'>('OPEN_ONLY');
  const [priority, setPriority] = useState<TicketPriority | 'ALL'>('ALL');
  const [level, setLevel] = useState<TicketLevel | 'ALL'>('ALL');
  const [person, setPerson] = useState<string>('ALL');
  const [slaOpen, setSlaOpen] = useState(false);
  const [sort, setSort] = useState<'updated' | 'created' | 'priority' | 'sla'>('updated');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const tickets = data.tickets;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = tickets.filter(t => {
      if (status === 'OPEN_ONLY' ? !isTicketOpen(t.status)
        : status === 'OVERDUE' ? !isTicketOverdue(t)
        : status === 'AWAITING' ? !isAwaitingReply(t)
        : status !== 'ALL' && t.status !== status) return false;
      if (priority !== 'ALL' && t.priority !== priority) return false;
      if (level !== 'ALL' && (t.escalationLevel !== level || !isTicketOpen(t.status))) return false;
      if (person !== 'ALL' && t.assigneeId !== person && t.escalatedTo !== person && t.resolvedBy !== person) return false;
      if (!q) return true;
      return [t.ticketNo, t.subject, t.customerName, t.customerCode].some(v => v.toLowerCase().includes(q));
    });
    return [...list].sort((a, b) =>
      sort === 'priority'
        ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.updatedAt.localeCompare(a.updatedAt)
        : sort === 'created'
          ? b.createdAt.localeCompare(a.createdAt)
          : sort === 'sla'
            ? (a.slaDueAt || '9999').localeCompare(b.slaDueAt || '9999') || b.updatedAt.localeCompare(a.updatedAt)
            : b.updatedAt.localeCompare(a.updatedAt)
    );
  }, [tickets, search, status, priority, level, person, sort]);
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const open = tickets.find(t => t.id === openId) || null;

  const count = (s: TicketStatus) => tickets.filter(t => t.status === s).length;
  const unassigned = tickets.filter(t => !t.assigneeId && isTicketOpen(t.status)).length;
  const overdue = tickets.filter(t => isTicketOverdue(t)).length;
  const awaiting = tickets.filter(t => isAwaitingReply(t)).length;
  const staffIds = useMemo(
    () => [...new Set(tickets.flatMap(t => [t.assigneeId, t.escalatedTo, t.resolvedBy]).filter((x): x is string => !!x))]
      .sort((a, b) => personName(people, a).localeCompare(personName(people, b))),
    [tickets, people]
  );
  const byMember = useMemo(() => {
    const map = new Map<string, SupportTicket[]>();
    tickets.forEach(t => map.set(t.assigneeId || 'none', [...(map.get(t.assigneeId || 'none') || []), t]));
    return [...map.entries()].map(([id, list]) => ({
      id,
      name: id === 'none' ? 'Unassigned' : personName(people, id),
      open: list.filter(t => isTicketOpen(t.status)).length,
      overdue: list.filter(t => isTicketOverdue(t)).length,
      escalated: list.filter(t => t.status === 'ESCALATED' || (t.escalationLevel !== 'RM' && isTicketOpen(t.status))).length,
      resolved: list.filter(t => t.status === 'RESOLVED' || t.status === 'CLOSED').length,
      // tickets this person closed themselves (wherever they were assigned)
      resolvedByThem: id === 'none' ? 0 : tickets.filter(t => t.resolvedBy === id).length,
      total: list.length
    }));
  }, [tickets, people]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={mode === 'member' ? 'Tickets' : 'Support Tickets'}
        subtitle={
          mode === 'member'
            ? 'Customer queries, complaints and service requests assigned to you.'
            : 'Monitor, assign and escalate your support team’s tickets.'
        }
        action={
          mode === 'manager' && (
            <div className="flex flex-wrap gap-2 self-start">
              <button
                type="button"
                onClick={() => setSlaOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-bold hover:bg-slate-50"
              >
                <Settings2 className="w-4 h-4" aria-hidden="true" /> SLA
              </button>
              {profile?.role !== 'DEPARTMENT_HEAD' && (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" /> New ticket
                </button>
              )}
            </div>
          )
        }
      />
      {data.error && <ErrorBanner message={data.error} onRetry={() => void data.reload()} />}

      {mode === 'member' ? (
        <TicketBoard tickets={tickets} loading={data.loading} people={people} onOpen={setOpenId} />
      ) : (
        <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Open" value={count('OPEN')} tone="text-blue-700" hint={`${awaiting} waiting for our reply`} />
        <KpiCard label="In progress" value={count('IN_PROGRESS') + count('WAITING_CUSTOMER')} tone="text-indigo-700" hint={`${count('WAITING_CUSTOMER')} waiting for customer`} />
        <KpiCard label="Escalated" value={count('ESCALATED')} tone="text-rose-700" />
        <KpiCard label="Overdue (SLA)" value={overdue} tone="text-rose-700" />
        <KpiCard label="Resolved / closed" value={count('RESOLVED') + count('CLOSED')} tone="text-emerald-700" />
        {mode === 'manager' ? <KpiCard label="Unassigned" value={unassigned} tone="text-amber-700" /> : <KpiCard label="All my tickets" value={tickets.length} />}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/80">
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
              placeholder="Search ticket ID, subject or customer"
              aria-label="Search tickets"
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
            className={`${inputClass} lg:w-48`}
          >
            <option value="OPEN_ONLY">Open tickets</option>
            <option value="OVERDUE">Overdue (SLA)</option>
            <option value="AWAITING">Waiting for our reply</option>
            <option value="ALL">All statuses</option>
            {(Object.keys(TICKET_STATUS_LABELS) as TicketStatus[]).map(s => (
              <option key={s} value={s}>
                {TICKET_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            value={priority}
            onChange={e => {
              setPriority(e.target.value as any);
              setPage(1);
            }}
            aria-label="Filter by priority"
            className={`${inputClass} lg:w-40`}
          >
            <option value="ALL">All priorities</option>
            {(Object.keys(TICKET_PRIORITY_LABELS) as TicketPriority[]).map(p => (
              <option key={p} value={p}>
                {TICKET_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
          <select
            value={level}
            onChange={e => {
              setLevel(e.target.value as any);
              setPage(1);
            }}
            aria-label="Filter by who handles the ticket"
            className={`${inputClass} lg:w-44`}
          >
            <option value="ALL">Any level</option>
            {(Object.keys(TICKET_LEVEL_LABELS) as TicketLevel[]).map(l => (
              <option key={l} value={l}>
                With {TICKET_LEVEL_LABELS[l]}
              </option>
            ))}
          </select>
          <select
            value={person}
            onChange={e => {
              setPerson(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by team member"
            className={`${inputClass} lg:w-44`}
          >
            <option value="ALL">Everyone</option>
            {staffIds.map(id => (
              <option key={id} value={id}>
                {personName(people, id)}
              </option>
            ))}
          </select>
          <select value={sort} onChange={e => setSort(e.target.value as any)} aria-label="Sort tickets" className={`${inputClass} lg:w-44`}>
            <option value="updated">Last updated</option>
            <option value="created">Newest first</option>
            <option value="priority">Priority</option>
            <option value="sla">SLA deadline</option>
          </select>
        </div>

        {data.loading ? (
          <Loading label="Loading tickets…" />
        ) : filtered.length === 0 ? (
          <div className="p-6">
            <Empty
              title={tickets.length === 0 ? 'No tickets yet' : 'No tickets match these filters'}
              hint={tickets.length === 0 ? 'Create a ticket for a customer to start tracking their query.' : 'Try a different status or search.'}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="py-2.5 px-4 font-semibold">Ticket</th>
                  <th className="py-2.5 px-3 font-semibold">Customer</th>
                  <th className="py-2.5 px-3 font-semibold">Subject</th>
                  <th className="py-2.5 px-3 font-semibold">Category</th>
                  <th className="py-2.5 px-3 font-semibold">Priority</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 px-3 font-semibold">Relationship Manager</th>
                  <th className="py-2.5 px-3 font-semibold">Handled by</th>
                  <th className="py-2.5 px-3 font-semibold">SLA</th>
                  <th className="py-2.5 px-3 font-semibold">Resolved by</th>
                  <th className="py-2.5 px-3 font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pageRows.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50/70 cursor-pointer" onClick={() => setOpenId(t.id)}>
                    <td className="py-3 px-4">
                      <button type="button" className="font-mono text-xs font-bold text-blue-700 hover:underline" onClick={() => setOpenId(t.id)}>
                        {t.ticketNo}
                      </button>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-800">{t.customerName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{t.customerCode}</div>
                    </td>
                    <td className="py-3 px-3 max-w-[16rem] text-slate-700">
                      <div className="truncate">{t.subject}</div>
                      <TicketFlags ticket={t} />
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-600">{TICKET_CATEGORY_LABELS[t.category]}</td>
                    <td className="py-3 px-3">
                      <TicketPriorityPill priority={t.priority} />
                    </td>
                    <td className="py-3 px-3">
                      <TicketStatusPill status={t.status} />
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-600">{personName(people, t.assigneeId)}</td>
                    <td className="py-3 px-3 text-xs text-slate-600">
                      {isTicketOpen(t.status) ? (
                        <>
                          <div className="font-semibold text-slate-700">{TICKET_LEVEL_LABELS[t.escalationLevel]}</div>
                          <div>{personName(people, handlerId(t))}</div>
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className={`py-3 px-3 text-xs whitespace-nowrap ${isTicketOverdue(t) ? 'text-rose-700 font-bold' : 'text-slate-500'}`}>
                      {isTicketOpen(t.status) ? slaText(t.slaDueAt) : '-'}
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-600">
                      {t.resolvedBy || t.resolvedAt ? (
                        <>
                          <div>{t.resolvedBy ? personName(people, t.resolvedBy) : '-'}</div>
                          <div className="text-[10px] text-slate-400">{fmtWhen(t.resolvedAt)}</div>
                        </>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-500 whitespace-nowrap">{fmtWhen(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
      </div>

        </>
      )}

      {mode === 'manager' && byMember.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-5">
          <h2 className="text-sm font-bold text-slate-900 mb-3">Workload by team member</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-3 font-semibold">Team member</th>
                  <th className="py-2 px-3 font-semibold text-right">Open</th>
                  <th className="py-2 px-3 font-semibold text-right">Overdue</th>
                  <th className="py-2 px-3 font-semibold text-right">Escalated</th>
                  <th className="py-2 px-3 font-semibold text-right">Resolved / closed</th>
                  <th className="py-2 px-3 font-semibold text-right">Resolved by them</th>
                  <th className="py-2 pl-3 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {byMember.map(r => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 font-medium text-slate-800">{r.name}</td>
                    <td className="py-2 px-3 text-right">{r.open}</td>
                    <td className="py-2 px-3 text-right text-rose-700">{r.overdue}</td>
                    <td className="py-2 px-3 text-right text-rose-700">{r.escalated}</td>
                    <td className="py-2 px-3 text-right text-emerald-700">{r.resolved}</td>
                    <td className="py-2 px-3 text-right text-emerald-700">{r.resolvedByThem}</td>
                    <td className="py-2 pl-3 text-right">{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && (
        <TicketDetail
          ticket={open}
          data={data}
          people={people}
          manager={mode === 'manager'}
          onClose={() => setOpenId(null)}
          onOpenCustomer={onOpenCustomer}
        />
      )}
      {slaOpen && <SlaSettingsModal onClose={() => setSlaOpen(false)} />}
      {creating && (
        <NewTicketModal
          people={people}
          onClose={() => setCreating(false)}
          onCreated={id => {
            setCreating(false);
            void data.reload().then(() => setOpenId(id));
          }}
        />
      )}
    </div>
  );
};

/** Create a ticket, optionally for a fixed customer (from the customer profile). */
export const NewTicketModal: React.FC<{
  people: Person[];
  customerId?: string;
  onClose: () => void;
  onCreated: (ticketId: string) => void;
}> = ({ people, customerId, onClose, onCreated }) => {
  const { profile } = useAuth();
  const customers = useCustomerOptions();
  const [customer, setCustomer] = useState(customerId || '');
  const [customerQuery, setCustomerQuery] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TicketCategory>('GENERAL');
  const [priority, setPriority] = useState<TicketPriority>('MEDIUM');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLead = profile?.role === 'TEAM_HEAD';
  const team = people.filter(p => (p.role === 'TEAM_MEMBER' || p.role === 'TEAM_HEAD') && p.status === 'ACTIVE' && p.teamId === profile?.teamId);
  const matches = customers
    .filter(c => {
      const q = customerQuery.trim().toLowerCase();
      return !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || (c.company || '').toLowerCase().includes(q);
    })
    .slice(0, 8);
  const chosen = customers.find(c => c.id === customer);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!customer) return setError('Choose the customer this ticket is for.');
    if (subject.trim().length < 3) return setError('Enter a subject (at least 3 characters).');
    setBusy(true);
    try {
      const id = await ticketApi.create({ customerId: customer, subject: subject.trim(), description: description.trim(), category, priority, assigneeId: assignee || undefined });
      onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the ticket.');
      setBusy(false);
    }
  };

  return (
    <Modal title="New ticket" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Customer" htmlFor="nt-customer" required>
          {customerId || chosen ? (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm">
              <span>
                <strong>{chosen?.name || 'Customer'}</strong> <span className="text-slate-400 font-mono text-xs">{chosen?.code}</span>
              </span>
              {!customerId && (
                <button type="button" className="text-xs text-blue-700 font-semibold" onClick={() => setCustomer('')}>
                  Change
                </button>
              )}
            </div>
          ) : (
            <div>
              <input
                id="nt-customer"
                value={customerQuery}
                onChange={e => setCustomerQuery(e.target.value)}
                placeholder="Search customer name, company or ID"
                className={inputClass}
                autoComplete="off"
              />
              <ul className="mt-1.5 border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-44 overflow-y-auto">
                {matches.length === 0 && <li className="px-3 py-2 text-xs text-slate-400">No customers found.</li>}
                {matches.map(c => (
                  <li key={c.id}>
                    <button type="button" onClick={() => setCustomer(c.id)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">
                      <span className="font-medium text-slate-800">{c.name}</span>
                      <span className="text-xs text-slate-400"> · {c.company || 'No company'} · </span>
                      <span className="text-xs text-slate-400 font-mono">{c.code}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </FormField>
        <FormField label="Subject" htmlFor="nt-subject" required>
          <input id="nt-subject" value={subject} onChange={e => setSubject(e.target.value)} maxLength={200} className={inputClass} placeholder="e.g. Templates stuck in review" />
        </FormField>
        <FormField label="Query or issue description" htmlFor="nt-desc">
          <textarea id="nt-desc" rows={4} value={description} onChange={e => setDescription(e.target.value)} maxLength={4000} className={inputClass} />
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Category" htmlFor="nt-cat">
            <select id="nt-cat" value={category} onChange={e => setCategory(e.target.value as TicketCategory)} className={inputClass}>
              {(Object.keys(TICKET_CATEGORY_LABELS) as TicketCategory[]).map(c => (
                <option key={c} value={c}>
                  {TICKET_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Priority" htmlFor="nt-pri">
            <select id="nt-pri" value={priority} onChange={e => setPriority(e.target.value as TicketPriority)} className={inputClass}>
              {(Object.keys(TICKET_PRIORITY_LABELS) as TicketPriority[]).map(p => (
                <option key={p} value={p}>
                  {TICKET_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        {isLead && (
          <FormField label="Assign to" htmlFor="nt-assignee" hint="Leave empty to assign it to yourself.">
            <select id="nt-assignee" value={assignee} onChange={e => setAssignee(e.target.value)} className={inputClass}>
              <option value="">Me</option>
              {team
                .filter(p => p.id !== profile?.id)
                .map(p => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
            </select>
          </FormField>
        )}
        {error && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
            {busy ? 'Creating…' : 'Create ticket'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

const KIND_TEXT: Record<string, string> = {
  CREATED: 'opened the ticket',
  STATUS_CHANGED: 'changed the status',
  ASSIGNED: 'assigned the ticket',
  ESCALATED: 'escalated the ticket',
  NOTE: 'added a note',
  CLIENT_REPLY: 'replied (customer)'
};

export const TicketDetail: React.FC<{
  ticket: SupportTicket;
  data: TicketData;
  people: Person[];
  manager: boolean;
  onClose: () => void;
  onOpenCustomer?: (customerId: string) => void;
  /** View only (e.g. a team lead reading another team's ticket on one of their customers). */
  readOnly?: boolean;
}> = ({ ticket, data, people, manager, onClose, onOpenCustomer, readOnly = false }) => {
  const { profile } = useAuth();
  const history = data.updates.filter(u => u.ticketId === ticket.id);
  const canManage = !readOnly && (manager || profile?.role === 'TEAM_HEAD' || profile?.role === 'DEPARTMENT_HEAD' || profile?.role === 'SUPER_ADMIN');
  const canAct = !readOnly && (canManage || ticket.assigneeId === profile?.id || ticket.escalatedTo === profile?.id);
  const nextLevel: TicketLevel | null = ticket.escalationLevel === 'RM' ? 'TL' : ticket.escalationLevel === 'TL' ? 'DH' : null;
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  useEffect(() => setStatus(ticket.status), [ticket.status]);
  const [note, setNote] = useState('');
  const [clientReply, setClientReply] = useState('');
  const [resolution, setResolution] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const teamPeople = people.filter(p => (p.role === 'TEAM_MEMBER' || p.role === 'TEAM_HEAD') && p.status === 'ACTIVE' && p.teamId === ticket.teamId);
  const needsResolution = (status === 'RESOLVED' || status === 'CLOSED') && !ticket.resolutionNotes;

  const run = async (fn: () => Promise<void>, message: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      await data.reload();
      setNote('');
      setResolution('');
      setDone(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the change.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${ticket.ticketNo} · ${ticket.subject}`} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <TicketStatusPill status={ticket.status} />
          <TicketPriorityPill priority={ticket.priority} />
          <span className="text-xs text-slate-500">{TICKET_CATEGORY_LABELS[ticket.category]}</span>
          <TicketFlags ticket={ticket} />
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-xs">
          <div>
            <dt className="text-slate-400">Customer</dt>
            <dd className="font-semibold text-slate-800 mt-0.5">
              {onOpenCustomer ? (
                <button type="button" className="text-blue-700 hover:underline text-left" onClick={() => onOpenCustomer(ticket.customerId)}>
                  {ticket.customerName}
                </button>
              ) : (
                ticket.customerName
              )}
              <span className="block font-mono text-slate-400 font-normal">{ticket.customerCode}</span>
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">Relationship Manager</dt>
            <dd className="font-semibold text-slate-800 mt-0.5">{personName(people, ticket.assigneeId)}</dd>
          </div>
          {isTicketOpen(ticket.status) && (
            <div>
              <dt className="text-slate-400">Handled by now</dt>
              <dd className={`font-semibold mt-0.5 ${ticket.escalationLevel === 'RM' ? 'text-slate-800' : 'text-rose-700'}`}>
                {TICKET_LEVEL_LABELS[ticket.escalationLevel]} · {personName(people, handlerId(ticket))}
              </dd>
            </div>
          )}
          {isTicketOpen(ticket.status) && (
            <div>
              <dt className="text-slate-400">Reply due (SLA)</dt>
              <dd className={`font-semibold mt-0.5 inline-flex items-center gap-1 ${isTicketOverdue(ticket) ? 'text-rose-700' : 'text-slate-800'}`}>
                <Clock className="w-3 h-3" aria-hidden="true" />
                {ticket.slaDueAt ? `${fmtWhen(ticket.slaDueAt)} (${slaText(ticket.slaDueAt)})` : isAwaitingReply(ticket) ? 'No deadline' : 'Nobody waiting'}
              </dd>
            </div>
          )}
          {(ticket.resolvedBy || ticket.resolvedAt) && (
            <div>
              <dt className="text-slate-400">Resolved by</dt>
              <dd className="font-semibold text-emerald-700 mt-0.5">
                {ticket.resolvedBy ? personName(people, ticket.resolvedBy) : '-'}
                <span className="block font-normal text-slate-400">{fmtWhen(ticket.resolvedAt)}</span>
              </dd>
            </div>
          )}
          <div>
            <dt className="text-slate-400">Created by</dt>
            <dd className="font-semibold text-slate-800 mt-0.5">{personName(people, ticket.createdBy)}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Date created</dt>
            <dd className="font-semibold text-slate-800 mt-0.5">{fmtWhen(ticket.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Last updated</dt>
            <dd className="font-semibold text-slate-800 mt-0.5">{fmtWhen(ticket.updatedAt)}</dd>
          </div>
          {ticket.escalatedAt && (
            <div>
              <dt className="text-slate-400">Escalated</dt>
              <dd className="font-semibold text-rose-700 mt-0.5">{fmtWhen(ticket.escalatedAt)}</dd>
            </div>
          )}
        </dl>
        {ticket.description && (
          <div>
            <div className="text-xs font-bold text-slate-800 mb-1">Query / issue</div>
            <p className="text-sm text-slate-600 whitespace-pre-line bg-slate-50 rounded-xl p-3">{ticket.description}</p>
          </div>
        )}
        {ticket.resolutionNotes && (
          <div>
            <div className="text-xs font-bold text-slate-800 mb-1">Resolution notes</div>
            <p className="text-sm text-emerald-800 whitespace-pre-line bg-emerald-50 border border-emerald-100 rounded-xl p-3">{ticket.resolutionNotes}</p>
          </div>
        )}

        {canAct && ticket.status !== 'CLOSED' && (
          <form
            className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3"
            onSubmit={e => {
              e.preventDefault();
              void run(() => ticketApi.update(ticket.id, { status, note, resolution }), 'Ticket updated.');
            }}
            aria-label="Update ticket"
          >
            <div className="text-xs font-bold text-slate-800">Update ticket</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="Status" htmlFor="td-status">
                <select id="td-status" value={status} onChange={e => setStatus(e.target.value as TicketStatus)} className={inputClass}>
                  {(Object.keys(TICKET_STATUS_LABELS) as TicketStatus[])
                    .filter(s => s !== 'CLOSED' || canManage)
                    .map(s => (
                      <option key={s} value={s}>
                        {TICKET_STATUS_LABELS[s]}
                      </option>
                    ))}
                </select>
              </FormField>
            </div>
            {(status === 'RESOLVED' || status === 'CLOSED') && (
              <FormField label="Resolution notes" htmlFor="td-resolution" required={needsResolution}>
                <textarea id="td-resolution" rows={2} value={resolution} onChange={e => setResolution(e.target.value)} maxLength={4000} className={inputClass} placeholder="How was it resolved?" />
              </FormField>
            )}
            <FormField label="Note" htmlFor="td-note">
              <textarea id="td-note" rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={4000} className={inputClass} placeholder="What happened, what is pending…" />
            </FormField>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                disabled={busy || !nextLevel || !isTicketOpen(ticket.status)}
                title={nextLevel ? undefined : 'Already with the Department Head'}
                onClick={() =>
                  void run(async () => {
                    await ticketApi.escalate(ticket.id, note);
                  }, `Ticket escalated to the ${nextLevel ? TICKET_LEVEL_LABELS[nextLevel] : ''}.`)
                }
                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-rose-200 text-rose-700 text-xs font-bold hover:bg-rose-50 disabled:opacity-40"
              >
                <ArrowUpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                {nextLevel ? `Escalate to ${TICKET_LEVEL_LABELS[nextLevel]}` : 'With the Department Head'}
              </button>
              <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50">
                <Send className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Saving…' : 'Save update'}
              </button>
            </div>
          </form>
        )}

        {canAct && ticket.status !== 'CLOSED' && ticket.createdBy === null && (
          <form
            className="p-4 rounded-xl border border-teal-200 bg-teal-50/40 space-y-2"
            onSubmit={e => {
              e.preventDefault();
              if (!clientReply.trim()) return;
              void run(async () => {
                await ticketApi.replyToClient(ticket.id, clientReply.trim());
                setClientReply('');
              }, 'Reply sent to the customer.');
            }}
          >
            <div className="text-xs font-bold text-slate-800">Reply to the customer</div>
            <p className="text-[11px] text-slate-500">The customer raised this in their dashboard. This reply appears there. Notes above stay internal.</p>
            <textarea rows={3} value={clientReply} onChange={e => setClientReply(e.target.value)} maxLength={4000} aria-label="Reply to the customer" className={inputClass} placeholder="Write your reply to the customer" />
            <div className="flex justify-end">
              <button type="submit" disabled={busy || !clientReply.trim()} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-bold hover:bg-teal-800 disabled:opacity-50">
                <Send className="w-3.5 h-3.5" aria-hidden="true" /> Send reply
              </button>
            </div>
          </form>
        )}

        {canManage && ticket.status !== 'CLOSED' && (
          <div className="p-4 rounded-xl border border-slate-200 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
              <UserCog className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" /> Assign / reassign
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <select value={assignee} onChange={e => setAssignee(e.target.value)} aria-label="Assign ticket to" className={inputClass}>
                <option value="">Choose a team member</option>
                {teamPeople
                  .filter(p => p.id !== ticket.assigneeId)
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                disabled={busy || !assignee}
                onClick={() => void run(() => ticketApi.assign(ticket.id, assignee, note), 'Ticket assigned.')}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold disabled:opacity-40 shrink-0"
              >
                Assign
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="text-xs text-emerald-700" role="status">
            {done}
          </p>
        )}

        <div>
          <div className="text-xs font-bold text-slate-800 mb-2">History</div>
          <ol className="space-y-3 border-l border-slate-200 pl-4">
            {[...history].reverse().map(u => (
              <li key={u.id} className="text-xs relative">
                <span className="absolute -left-[21px] top-1 w-2 h-2 rounded-full bg-blue-400" aria-hidden="true" />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-slate-800">
                    {u.authorId
                      ? personName(people, u.authorId)
                      : u.kind === 'CLIENT_REPLY' || (u.kind === 'CREATED' && !ticket.createdBy) || u.kind === 'STATUS_CHANGED'
                        ? 'Customer'
                        : u.kind === 'ESCALATED'
                          ? 'SLA (no reply in time)'
                          : 'System'}
                  </span>
                  <span className="text-slate-500">{KIND_TEXT[u.kind]}</span>
                  {u.kind === 'ASSIGNED' && <span className="text-slate-700">to {personName(people, u.assigneeId)}</span>}
                  {u.kind !== 'ASSIGNED' && u.toStatus && u.fromStatus && u.fromStatus !== u.toStatus && (
                    <span className="text-slate-500">
                      ({TICKET_STATUS_LABELS[u.fromStatus]} → {TICKET_STATUS_LABELS[u.toStatus]})
                    </span>
                  )}
                  {u.kind === 'NOTE' && u.clientVisible && <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 text-[10px] font-semibold">Shared with the customer</span>}
                  <span className="text-[10px] text-slate-400">{fmtWhen(u.createdAt)}</span>
                </div>
                {u.note && <p className="text-slate-600 mt-0.5 whitespace-pre-line break-words">{u.note}</p>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Modal>
  );
};

/** Member view: three columns - Pending, Waiting for customer reply, Complete. */
const BOARD: { id: string; title: string; statuses: TicketStatus[]; tone: string }[] = [
  { id: 'pending', title: 'Pending', statuses: ['OPEN', 'IN_PROGRESS', 'ESCALATED'], tone: 'border-t-blue-500' },
  { id: 'waiting', title: 'Waiting for customer reply', statuses: ['WAITING_CUSTOMER'], tone: 'border-t-amber-500' },
  { id: 'complete', title: 'Complete', statuses: ['RESOLVED', 'CLOSED'], tone: 'border-t-emerald-500' }
];

const TicketBoard: React.FC<{ tickets: SupportTicket[]; loading: boolean; people: Person[]; onOpen: (id: string) => void }> = ({ tickets, loading, onOpen }) => {
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const shown = tickets.filter(t => !q || [t.ticketNo, t.subject, t.customerName, t.customerCode].some(v => v.toLowerCase().includes(q)));
  if (loading) return <Loading label="Loading tickets…" />;
  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search ticket ID, subject or customer"
          aria-label="Search tickets"
          className={`${inputClass} pl-9`}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {BOARD.map(col => {
          const list = shown
            .filter(t => col.statuses.includes(t.status))
            .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.updatedAt.localeCompare(a.updatedAt));
          return (
            <section key={col.id} className={`bg-slate-100/70 rounded-2xl border border-slate-200 border-t-4 ${col.tone}`} aria-label={col.title}>
              <header className="flex items-center justify-between px-4 py-3">
                <h2 className="text-sm font-bold text-slate-900">{col.title}</h2>
                <span className="text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-full px-2 py-0.5">{list.length}</span>
              </header>
              <div className="px-3 pb-3 space-y-2.5 max-h-[70vh] overflow-y-auto">
                {list.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">No tickets here.</p>
                ) : (
                  list.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onOpen(t.id)}
                      className="w-full text-left bg-white rounded-xl border border-slate-200 p-3 hover:border-blue-300 hover:shadow-sm transition"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] font-bold text-blue-700">{t.ticketNo}</span>
                        <TicketPriorityPill priority={t.priority} />
                      </div>
                      <div className="text-sm font-semibold text-slate-800 mt-1.5 line-clamp-2">{t.subject}</div>
                      <div className="text-[11px] text-slate-500 mt-1">
                        {t.customerName} · <span className="font-mono">{t.customerCode}</span>
                      </div>
                      <div className="mt-1.5">
                        <TicketFlags ticket={t} />
                      </div>
                      {isTicketOpen(t.status) && t.slaDueAt && (
                        <div className={`text-[10px] mt-1 ${isTicketOverdue(t) ? 'text-rose-700 font-bold' : 'text-slate-500'}`}>Reply {slaText(t.slaDueAt)}</div>
                      )}
                      <div className="flex items-center justify-between gap-2 mt-2">
                        <TicketStatusPill status={t.status} />
                        <span className="text-[10px] text-slate-400">{fmtWhen(t.updatedAt)}</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
      {tickets.length === 0 && (
        <p className="text-xs text-slate-500 text-center">No tickets assigned to you yet. Tickets your team lead assigns, or that you open from a customer’s profile, appear here.</p>
      )}
    </div>
  );
};

/** How long the Relationship Manager, then the Team Lead, may take to answer the customer. */
const SlaSettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [sla, setSla] = useState<TicketSla | null>(null);
  const [rmHours, setRmHours] = useState('');
  const [tlHours, setTlHours] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    ticketSlaApi.get().then(
      s => {
        setSla(s);
        setRmHours(String(+(s.rmMinutes / 60).toFixed(2)));
        setTlHours(String(+(s.tlMinutes / 60).toFixed(2)));
      },
      e => setError(e instanceof Error ? e.message : 'Could not load the SLA.')
    );
  }, []);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const rm = Math.round(Number(rmHours) * 60);
    const tl = Math.round(Number(tlHours) * 60);
    if (!Number.isFinite(rm) || !Number.isFinite(tl) || rm < 5 || tl < 5) return setError('Enter the hours for each level (at least 5 minutes).');
    setBusy(true);
    setError(null);
    try {
      setSla(await ticketSlaApi.set(rm, tl));
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the SLA.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Ticket SLA" onClose={onClose}>
      {!sla && !error ? (
        <Loading label="Loading SLA…" />
      ) : (
        <form onSubmit={save} className="space-y-4">
          <p className="text-xs text-slate-500">
            A customer ticket goes to the customer's Relationship Manager. If the customer has no answer in time, it moves to the Team Lead, and then to the
            Department Head. The clock restarts with every new customer message and stops when the team replies, asks the customer something or resolves the ticket.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Relationship Manager (hours)" htmlFor="sla-rm">
              <input id="sla-rm" type="number" min={0.1} step={0.25} value={rmHours} disabled={!sla?.canEdit} onChange={e => setRmHours(e.target.value)} className={inputClass} />
            </FormField>
            <FormField label="Then the Team Lead (hours)" htmlFor="sla-tl">
              <input id="sla-tl" type="number" min={0.1} step={0.25} value={tlHours} disabled={!sla?.canEdit} onChange={e => setTlHours(e.target.value)} className={inputClass} />
            </FormField>
          </div>
          {sla && (
            <p className="text-[11px] text-slate-400">
              {sla.scope === 'DEPARTMENT' ? 'Set for your department.' : 'The default for every department.'} Last changed {fmtWhen(sla.updatedAt)}.
              {!sla.canEdit && ' Only a Department Head or the Super Admin can change it.'}
            </p>
          )}
          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2" role="alert">
              {error}
            </p>
          )}
          {done && (
            <p className="text-xs text-emerald-700" role="status">
              SLA saved. New deadlines use it from now on.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              Close
            </button>
            {sla?.canEdit && (
              <button type="submit" disabled={busy} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Saving…' : 'Save SLA'}
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
};
