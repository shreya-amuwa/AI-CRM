import React, { useCallback, useEffect, useRef, useState } from 'react';
import { displayTicketNo } from '../../lib/ticketFormat';
import { Search, Users } from 'lucide-react';
import { getSupabase } from '../../services/supabaseClient';
import { cleanDbError, fmtWhen, isTicketOpen, TICKET_STATUS_LABELS, useRealtime, type TicketStatus } from '../../lib/support';
import { rowOpen } from '../../lib/rowClick';
import { Avatar, Card, Dialog, ErrorBanner, Pager, Pill, Spinner, useDebounced, type Tone } from '../team-member/pipeline/shared';

/**
 * Department Head: the department's customers, who looks after each one (Team Lead and Team Member),
 * and the tickets they raised with their status and who is working on them.
 * Data comes from two read-only database functions that check the caller is a Department Head.
 */
interface Person {
  id: string;
  name: string;
}
interface DirectoryItem {
  id: string;
  code: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  lifecycleStage: 'ONBOARDING' | 'CUSTOMER';
  handoverStage: 'CONSULTANT' | 'DEPARTMENT_HEAD' | 'TEAM_LEAD' | 'TEAM_MEMBER';
  services: { code: string; name: string }[];
  teamLead: Person | null;
  teamMember: Person | null;
  tickets: { open: number; resolved: number };
  hasClientLogin: boolean;
}
interface Directory {
  total: number;
  items: DirectoryItem[];
}
interface CustomerTicket {
  id: string;
  ticketNo: string;
  subject: string;
  status: TicketStatus;
  priority: string;
  category: string;
  raisedByClient: boolean;
  createdAt: string;
  resolvedAt: string | null;
  assignee: Person | null;
  teamLead: Person | null;
  serviceName: string | null;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('The CRM is not connected to its database.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(cleanDbError(error.message));
  return data as T;
}

const STAGE: Record<DirectoryItem['handoverStage'], { label: string; tone: Tone }> = {
  CONSULTANT: { label: 'With consultant', tone: 'slate' },
  DEPARTMENT_HEAD: { label: 'Waiting for a team lead', tone: 'orange' },
  TEAM_LEAD: { label: 'Waiting for a team member', tone: 'indigo' },
  TEAM_MEMBER: { label: 'Assigned', tone: 'green' }
};
const statusTone = (s: TicketStatus): Tone => (s === 'RESOLVED' || s === 'CLOSED' ? 'green' : s === 'ESCALATED' ? 'red' : s === 'IN_PROGRESS' ? 'indigo' : 'orange');
const PAGE_SIZE = 10;

export const DepartmentCustomers: React.FC = () => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Directory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<DirectoryItem | null>(null);
  const debounced = useDebounced(search.trim());
  const seq = useRef(0);

  const load = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    rpc<Directory>('head_customer_directory', { p_search: debounced || null, p_limit: PAGE_SIZE, p_offset: (page - 1) * PAGE_SIZE })
      .then(d => {
        if (n !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch(e => n === seq.current && setError(e instanceof Error ? e.message : 'Could not load the customers.'))
      .finally(() => n === seq.current && setLoading(false));
  }, [debounced, page]);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [debounced]);
  // refreshed when something changes, not on a timer
  useRealtime('support_tickets', load);
  useRealtime('customer_onboarding', load);

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">Customers</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5 max-w-2xl">
            Every customer of your department, who looks after them (Team Lead and Team Member) and how their tickets are going.
          </p>
        </div>
        <label className="relative w-full md:w-72 shrink-0">
          <span className="sr-only">Search customers</span>
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search customer or business"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </label>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && !data ? (
        <Spinner label="Loading customers…" />
      ) : data && data.items.length === 0 ? (
        <Card className="py-12 text-center text-sm text-slate-500">
          <Users className="w-6 h-6 mx-auto mb-2 text-slate-300" aria-hidden="true" />
          {debounced ? 'No customer matches.' : 'No customers yet. They appear here once the Technical Consultant has sent them to you.'}
        </Card>
      ) : (
        <Card className={loading ? 'opacity-60' : ''}>
          <ul className="divide-y divide-slate-100" aria-busy={loading}>
            {data?.items.map(c => (
              <li
                key={c.id}
                {...rowOpen(() => setOpen(c))}
                className="p-4 flex flex-col lg:flex-row lg:items-center gap-3 cursor-pointer hover:bg-slate-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                <div className="flex items-center gap-3 lg:w-1/3 min-w-0">
                  <Avatar name={c.company || c.name} />
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 text-sm truncate">{c.company || c.name}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {c.name} · <span className="font-mono">{c.code}</span>
                    </div>
                  </div>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                  <div>
                    <span className="text-slate-400">Team Lead</span>
                    <div className="font-semibold text-slate-800">{c.teamLead?.name || '-'}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">Team Member</span>
                    <div className="font-semibold text-slate-800">{c.teamMember?.name || '-'}</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <Pill tone={STAGE[c.handoverStage].tone}>{STAGE[c.handoverStage].label}</Pill>
                  <span className="text-xs text-slate-600" title="Pending / resolved tickets">
                    <b className={c.tickets.open ? 'text-orange-700' : 'text-slate-700'}>{c.tickets.open}</b> pending ·{' '}
                    <b className="text-emerald-700">{c.tickets.resolved}</b> resolved
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {data && data.total > PAGE_SIZE && <Pager page={page} pageSize={PAGE_SIZE} total={data.total} noun="customers" onPage={setPage} />}
        </Card>
      )}
      {open && <CustomerDialog customer={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

const CustomerDialog: React.FC<{ customer: DirectoryItem; onClose: () => void }> = ({ customer: c, onClose }) => {
  const [tickets, setTickets] = useState<CustomerTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    rpc<CustomerTicket[]>('head_customer_tickets', { p_customer: c.id }).then(
      t => {
        setTickets(t);
        setError(null);
      },
      e => setError(e instanceof Error ? e.message : 'Could not load the tickets.')
    );
  }, [c.id]);
  useEffect(load, [load]);
  useRealtime('support_tickets', load);

  const detail = (label: string, value: React.ReactNode) => (
    <div>
      <dt className="text-[11px] text-slate-400">{label}</dt>
      <dd className="text-sm font-semibold text-slate-800 break-words">{value || '-'}</dd>
    </div>
  );

  return (
    <Dialog title={c.company || c.name} description={`${c.name} · ${c.code}`} onClose={onClose} wide>
      <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
        {detail('Customer name', c.name)}
        {detail('Mobile', c.phone)}
        {detail('Email', c.email)}
        {detail('City', c.city)}
        {detail('Address', c.address)}
        {detail('Client login', c.hasClientLogin ? 'Created' : 'Not created yet')}
        {detail('Team Lead', c.teamLead?.name)}
        {detail('Team Member', c.teamMember?.name)}
        {detail('Status', STAGE[c.handoverStage].label)}
      </dl>
      <div>
        <div className="text-[11px] text-slate-400 mb-1">Services</div>
        <div className="flex flex-wrap gap-1.5">
          {c.services.length === 0 ? <span className="text-sm text-slate-500">None</span> : c.services.map(s => (
            <span key={s.code} className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-semibold">
              {s.name}
            </span>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold text-slate-900 mb-2">Tickets</h3>
        {error && <ErrorBanner message={error} onRetry={load} />}
        {!tickets && !error ? (
          <Spinner label="Loading tickets…" />
        ) : tickets && tickets.length === 0 ? (
          <p className="text-sm text-slate-500">This customer has not raised any ticket.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl">
            {tickets?.map(t => (
              <li key={t.id} className="p-3 flex flex-col md:flex-row md:items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{t.subject}</div>
                  <div className="text-[11px] text-slate-500">
                    <span className="font-mono">{displayTicketNo(t.ticketNo)}</span> · {t.raisedByClient ? 'Raised by the client' : 'Raised by staff'} · {fmtWhen(t.createdAt)}
                    {t.serviceName ? ` · ${t.serviceName}` : ''}
                  </div>
                </div>
                <div className="text-xs text-slate-600 md:w-56">
                  <div>
                    <span className="text-slate-400">Team Member:</span> <b>{t.assignee?.name || 'Not assigned yet'}</b>
                  </div>
                  <div>
                    <span className="text-slate-400">Team Lead:</span> <b>{t.teamLead?.name || '-'}</b>
                  </div>
                </div>
                <div className="md:w-40 md:text-right">
                  <Pill tone={statusTone(t.status)}>{isTicketOpen(t.status) ? 'Pending · ' : 'Resolved · '}{TICKET_STATUS_LABELS[t.status]}</Pill>
                  {t.resolvedAt && <div className="text-[11px] text-slate-400 mt-0.5">{fmtWhen(t.resolvedAt)}</div>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex justify-end">
        <button type="button" className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
};
