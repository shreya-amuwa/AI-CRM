import React, { useEffect, useState } from 'react';
import { Eye, RotateCcw, Search } from 'lucide-react';
import { fmtWhen, TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS, type TicketPriority, type TicketStatus } from '../../../lib/support';
import { teamLeadApi, useServerList, type TicketQuery, type TlMemberLoad, type TlTicket } from '../../../lib/teamLead';
import { Empty, ErrorBanner, inputClass, Loading, Pager, TicketPriorityPill, TicketStatusPill } from '../../support-member/SupportParts';

export interface TicketFilters {
  search: string;
  status: NonNullable<TicketQuery['status']>;
  priority: TicketPriority | '';
  assigneeId: string;
  customerId: string;
  customerName: string;
}
export const EMPTY_TICKET_FILTERS: TicketFilters = { search: '', status: 'OPEN_ONLY', priority: '', assigneeId: '', customerId: '', customerName: '' };
const PAGE_SIZE = 10;

export const TlTicketsSection: React.FC<{
  filters: TicketFilters;
  onFilters: (f: TicketFilters) => void;
  members: TlMemberLoad[];
  leadId: string;
  version: number;
  onOpenTicket: (t: TlTicket) => void;
}> = ({ filters, onFilters, members, leadId, version, onOpenTicket }) => {
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState(filters.search);
  useEffect(() => setSearchText(filters.search), [filters.search]);
  useEffect(() => {
    const t = setTimeout(() => searchText !== filters.search && onFilters({ ...filters, search: searchText }), 300);
    return () => clearTimeout(t);
  }, [searchText, filters, onFilters]);
  useEffect(() => setPage(1), [filters]);

  const query: TicketQuery = {
    search: filters.search.trim() || undefined,
    status: filters.status,
    priority: filters.priority || undefined,
    customerId: filters.customerId || undefined,
    assigneeId: filters.assigneeId || undefined,
    sort: 'updated',
    page,
    pageSize: PAGE_SIZE
  };
  const list = useServerList(teamLeadApi.tickets, query, version);
  const changed = filters.search || filters.status !== 'OPEN_ONLY' || filters.priority || filters.assigneeId || filters.customerId;

  return (
    <section aria-labelledby="tl-tickets-heading" className="bg-white rounded-2xl border border-slate-200/80">
      <div className="p-5 border-b border-slate-100 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="tl-tickets-heading" className="text-base font-bold text-slate-900">
              Tickets
            </h2>
            <p className="text-xs text-slate-500">Tickets of every customer you manage, including your team members' customers.</p>
          </div>
          {list.data && <span className="text-xs text-slate-500">{list.data.total} ticket{list.data.total === 1 ? '' : 's'}</span>}
        </div>
        {filters.customerId && (
          <p className="text-xs text-slate-600">
            Customer: <b>{filters.customerName || 'selected customer'}</b>{' '}
            <button type="button" className="text-blue-700 font-semibold hover:underline" onClick={() => onFilters({ ...filters, customerId: '', customerName: '' })}>
              Show all customers
            </button>
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] gap-2">
          <label className="relative">
            <span className="sr-only">Search tickets</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input type="search" value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Ticket ID, subject or customer" className={`${inputClass} pl-9`} />
          </label>
          <select aria-label="Filter by ticket status" className={inputClass} value={filters.status} onChange={e => onFilters({ ...filters, status: e.target.value as TicketFilters['status'] })}>
            <option value="OPEN_ONLY">All open</option>
            <option value="ALL">All statuses</option>
            {(Object.keys(TICKET_STATUS_LABELS) as TicketStatus[]).map(s => (
              <option key={s} value={s}>
                {TICKET_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select aria-label="Filter by priority" className={inputClass} value={filters.priority} onChange={e => onFilters({ ...filters, priority: e.target.value as TicketFilters['priority'] })}>
            <option value="">All priorities</option>
            {(Object.keys(TICKET_PRIORITY_LABELS) as TicketPriority[]).map(p => (
              <option key={p} value={p}>
                {TICKET_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
          <select aria-label="Filter by assignee" className={inputClass} value={filters.assigneeId} onChange={e => onFilters({ ...filters, assigneeId: e.target.value })}>
            <option value="">Anyone</option>
            <option value={leadId}>Me</option>
            {members.map(m => (
              <option key={m.id} value={m.id}>
                {m.fullName}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setSearchText('');
              onFilters(EMPTY_TICKET_FILTERS);
            }}
            disabled={!changed}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Reset
          </button>
        </div>
      </div>

      {list.error && (
        <div className="p-5">
          <ErrorBanner message={list.error} onRetry={list.reload} />
        </div>
      )}
      {list.loading && !list.data ? (
        <Loading label="Loading tickets…" />
      ) : list.data && list.data.items.length === 0 ? (
        <div className="p-5">
          <Empty
            title={changed ? 'No tickets match these filters' : 'No open tickets'}
            hint={changed ? 'Change or reset the filters.' : 'Tickets raised on your customers appear here.'}
          />
        </div>
      ) : (
        <div className={`relative overflow-x-auto ${list.loading ? 'opacity-60' : ''}`} aria-busy={list.loading}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
                <th scope="col" className="px-5 py-3 font-semibold">Ticket</th>
                <th scope="col" className="px-3 py-3 font-semibold hidden md:table-cell">Customer</th>
                <th scope="col" className="px-3 py-3 font-semibold hidden sm:table-cell">Assigned to</th>
                <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                <th scope="col" className="px-3 py-3 font-semibold hidden lg:table-cell">Created</th>
                <th scope="col" className="px-3 py-3 font-semibold hidden lg:table-cell">Updated</th>
                <th scope="col" className="px-5 py-3 font-semibold text-right">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map(t => {
                const urgent = t.priority === 'URGENT' || t.priority === 'HIGH' || t.status === 'ESCALATED';
                return (
                  <tr key={t.id} className="border-b border-slate-50 last:border-0 align-top hover:bg-slate-50/50">
                    <td className={`px-5 py-3 ${urgent ? 'border-l-2 border-l-rose-300' : ''}`}>
                      <div className="font-mono text-[11px] text-slate-400">{t.ticketNo}</div>
                      <div className="font-semibold text-slate-900">{t.subject}</div>
                      <div className="text-xs text-slate-500 md:hidden">{t.customerName}</div>
                    </td>
                    <td className="px-3 py-3 text-xs hidden md:table-cell">
                      <div className="font-semibold text-slate-800">{t.customerName}</div>
                      <div className="font-mono text-slate-400">{t.customerCode}</div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-700 hidden sm:table-cell">{t.assigneeId === leadId ? 'Me' : t.assigneeName || 'Unassigned'}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <TicketStatusPill status={t.status} />
                        <TicketPriorityPill priority={t.priority} />
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500 hidden lg:table-cell whitespace-nowrap">{fmtWhen(t.createdAt)}</td>
                    <td className="px-3 py-3 text-xs text-slate-500 hidden lg:table-cell whitespace-nowrap">{fmtWhen(t.updatedAt)}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onOpenTicket(t)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        aria-label={`Open ticket ${t.ticketNo}`}
                      >
                        <Eye className="w-3.5 h-3.5" aria-hidden="true" /> {t.manageable ? 'Open' : 'View'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {list.data && list.data.total > PAGE_SIZE && (
        <div className="border-t border-slate-100">
          <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />
        </div>
      )}
    </section>
  );
};
