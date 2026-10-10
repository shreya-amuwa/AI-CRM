import React, { useEffect, useState } from 'react';
import { RotateCcw, Search, UserCog } from 'lucide-react';
import { CUSTOMER_STATUS_LABELS, fmtWhen, type CustomerStatusValue } from '../../../lib/support';
import { rowOpen } from '../../../lib/rowClick';
import { teamLeadApi, useServerList, type Assignment, type CustomerQuery, type TlCustomer, type TlMemberLoad } from '../../../lib/teamLead';
import { CustomerStatusPill, Empty, ErrorBanner, inputClass, Loading, Modal, Pager } from '../../support-member/SupportParts';

export interface CustomerFilters {
  search: string;
  status: CustomerStatusValue | '';
  assignment: Assignment | '';
  memberId: string;
  sort: NonNullable<CustomerQuery['sort']>;
}
export const EMPTY_CUSTOMER_FILTERS: CustomerFilters = { search: '', status: '', assignment: '', memberId: '', sort: 'newest' };

const STAGE_LABEL: Record<TlCustomer['lifecycleStage'], string> = {
  LEAD: 'Lead',
  POTENTIAL: 'Potential',
  ONBOARDING: 'Onboarding',
  CUSTOMER: 'Customer',
  LOST: 'Lost'
};
const PAGE_SIZE = 10;

/** "Assigned to Me" / the member's name / "Needs decision". */
export const AssigneeCell: React.FC<{ c: TlCustomer }> = ({ c }) =>
  c.assignment === 'DECISION' ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">Needs decision</span>
  ) : (
    <div>
      <div className="font-semibold text-slate-800">{c.assignment === 'MINE' ? 'Me' : c.assigneeName || 'Team member'}</div>
      <div className="text-[11px] text-slate-400">{c.assignment === 'MINE' ? 'Team Lead' : 'Team Member'}</div>
    </div>
  );

export const TlCustomersSection: React.FC<{
  filters: CustomerFilters;
  onFilters: (f: CustomerFilters) => void;
  members: TlMemberLoad[];
  leadId: string;
  leadName: string;
  version: number;
  onOpenCustomer: (c: TlCustomer) => void;
  onChanged: (message: string) => void;
}> = ({ filters, onFilters, members, leadId, leadName, version, onOpenCustomer, onChanged }) => {
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState(filters.search);
  const [reassigning, setReassigning] = useState<TlCustomer | null>(null);

  // Debounce typing; other filters apply at once.
  useEffect(() => setSearchText(filters.search), [filters.search]);
  useEffect(() => {
    const t = setTimeout(() => searchText !== filters.search && onFilters({ ...filters, search: searchText }), 300);
    return () => clearTimeout(t);
  }, [searchText, filters, onFilters]);
  useEffect(() => setPage(1), [filters]);

  const query: CustomerQuery = {
    search: filters.search.trim() || undefined,
    status: filters.status || undefined,
    assignment: filters.assignment || undefined,
    memberId: filters.memberId || undefined,
    sort: filters.sort,
    page,
    pageSize: PAGE_SIZE
  };
  const list = useServerList(teamLeadApi.customers, query, version);
  const filtered = filters.search || filters.status || filters.assignment || filters.memberId;

  return (
    <section aria-labelledby="tl-customers-heading" className="bg-white rounded-2xl border border-slate-200/80">
      <div className="p-5 border-b border-slate-100 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="tl-customers-heading" className="text-base font-bold text-slate-900">
              Customers
            </h2>
            <p className="text-xs text-slate-500">Everyone you manage - your own customers and your team's.</p>
          </div>
          {list.data && <span className="text-xs text-slate-500">{list.data.total} customer{list.data.total === 1 ? '' : 's'}</span>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto] gap-2">
          <label className="relative">
            <span className="sr-only">Search customers</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="search"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="Name, company, e-mail, phone or ID"
              className={`${inputClass} pl-9`}
            />
          </label>
          <select aria-label="Filter by status" className={inputClass} value={filters.status} onChange={e => onFilters({ ...filters, status: e.target.value as CustomerFilters['status'] })}>
            <option value="">All statuses</option>
            {(Object.keys(CUSTOMER_STATUS_LABELS) as CustomerStatusValue[]).map(s => (
              <option key={s} value={s}>
                {CUSTOMER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by assignment"
            className={inputClass}
            value={filters.assignment}
            onChange={e => onFilters({ ...filters, assignment: e.target.value as CustomerFilters['assignment'] })}
          >
            <option value="">All assignments</option>
            <option value="MINE">My customers</option>
            <option value="TEAM">Team customers</option>
            <option value="DECISION">Needs decision</option>
          </select>
          <select aria-label="Filter by team member" className={inputClass} value={filters.memberId} onChange={e => onFilters({ ...filters, memberId: e.target.value })}>
            <option value="">All team members</option>
            {members.map(m => (
              <option key={m.id} value={m.id}>
                {m.fullName}
              </option>
            ))}
          </select>
          <select aria-label="Sort customers" className={inputClass} value={filters.sort} onChange={e => onFilters({ ...filters, sort: e.target.value as CustomerFilters['sort'] })}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name">Name A–Z</option>
            <option value="activity">Recent activity</option>
            <option value="tickets">Most open tickets</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setSearchText('');
              onFilters(EMPTY_CUSTOMER_FILTERS);
            }}
            disabled={!filtered && filters.sort === 'newest'}
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
        <Loading label="Loading customers…" />
      ) : list.data && list.data.items.length === 0 ? (
        <div className="p-5">
          <Empty
            title={filtered ? 'No customers match these filters' : 'No customers yet'}
            hint={filtered ? 'Change or reset the filters.' : 'Add a customer, or wait for the Department Head to pass one to you.'}
          />
        </div>
      ) : (
        <div className={`relative overflow-x-auto ${list.loading ? 'opacity-60' : ''}`} aria-busy={list.loading}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-100">
                <th scope="col" className="px-5 py-3 font-semibold">Customer</th>
                <th scope="col" className="px-3 py-3 font-semibold hidden md:table-cell">Contact</th>
                <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                <th scope="col" className="px-3 py-3 font-semibold">Assigned to</th>
                <th scope="col" className="px-3 py-3 font-semibold text-right hidden sm:table-cell">Tickets</th>
                <th scope="col" className="px-3 py-3 font-semibold hidden lg:table-cell">Last activity</th>
                <th scope="col" className="px-5 py-3 font-semibold text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.data?.items.map(c => (
                <tr key={c.id} {...rowOpen(() => onOpenCustomer(c))} className="border-b border-slate-50 last:border-0 align-top hover:bg-slate-50/50 focus-visible:bg-blue-50/50 focus-visible:outline-none">
                  <td className="px-5 py-3">
                    <button type="button" onClick={() => onOpenCustomer(c)} className="text-left group" aria-label={`Open ${c.name}`}>
                      <div className="font-semibold text-slate-900 group-hover:text-blue-700">{c.name}</div>
                      <div className="text-xs text-slate-500">
                        {c.company ? `${c.company} · ` : ''}
                        <span className="font-mono">{c.code}</span>
                      </div>
                    </button>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-600 hidden md:table-cell">
                    <div className="break-all">{c.email || '-'}</div>
                    <div>{c.phone || ''}</div>
                  </td>
                  <td className="px-3 py-3">
                    <CustomerStatusPill status={c.status} />
                    <div className="text-[11px] text-slate-400 mt-1">{STAGE_LABEL[c.lifecycleStage] || c.lifecycleStage}{c.handedOver ? ' · from Department Head' : ''}</div>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    <AssigneeCell c={c} />
                  </td>
                  <td className="px-3 py-3 text-xs text-right hidden sm:table-cell">
                    <span className={c.openTickets ? 'font-semibold text-slate-900' : 'text-slate-500'}>{c.openTickets} open</span>
                    <div className="text-[11px] text-slate-400">{c.totalTickets} total</div>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-500 hidden lg:table-cell whitespace-nowrap">{c.lastActivityAt ? fmtWhen(c.lastActivityAt) : '-'}</td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setReassigning(c)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      aria-label={`${c.assignment === 'DECISION' ? 'Decide assignment for' : 'Change assignment of'} ${c.name}`}
                    >
                      <UserCog className="w-3.5 h-3.5" aria-hidden="true" /> {c.assignment === 'DECISION' ? 'Assign' : 'Change'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data && list.data.total > PAGE_SIZE && (
        <div className="border-t border-slate-100">
          <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPage={setPage} />
        </div>
      )}

      {reassigning && (
        <ReassignModal
          customer={reassigning}
          members={members}
          leadId={leadId}
          leadName={leadName}
          onClose={() => setReassigning(null)}
          onDone={message => {
            setReassigning(null);
            onChanged(message);
          }}
        />
      )}
    </section>
  );
};

/** Keep with me / assign to a member of my team. The server re-checks scope and team. */
export const ReassignModal: React.FC<{
  customer: TlCustomer;
  members: TlMemberLoad[];
  leadId: string;
  leadName: string;
  onClose: () => void;
  onDone: (message: string) => void;
}> = ({ customer, members, leadId, leadName, onClose, onDone }) => {
  const current = customer.assignment === 'DECISION' ? '' : customer.assigneeId || '';
  const [mode, setMode] = useState<'me' | 'member'>(customer.assignment === 'TEAM' ? 'member' : 'me');
  const [memberId, setMemberId] = useState(customer.assignment === 'TEAM' ? customer.assigneeId || '' : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = mode === 'me' ? leadId : memberId;
  const unchanged = !!target && target === current;

  const save = async () => {
    if (!target) return setError('Choose a team member.');
    setBusy(true);
    setError(null);
    try {
      await teamLeadApi.assign(customer.id, target);
      const name = mode === 'me' ? 'you' : members.find(m => m.id === target)?.fullName || 'the team member';
      onDone(`${customer.name} is now assigned to ${name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the assignment.');
      setBusy(false);
    }
  };

  return (
    <Modal title={customer.assignment === 'DECISION' ? 'Decide who handles this customer' : 'Change assignment'} onClose={() => !busy && onClose()}>
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-slate-400">Customer</dt>
            <dd className="font-semibold text-slate-900 mt-0.5">{customer.name}</dd>
          </div>
          <div>
            <dt className="text-slate-400">Currently</dt>
            <dd className="mt-0.5">
              <AssigneeCell c={customer} />
            </dd>
          </div>
        </dl>
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-slate-700 mb-1">Assign to</legend>
          <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${mode === 'me' ? 'border-blue-300 bg-blue-50/50' : 'border-slate-200'}`}>
            <input type="radio" name="tl-assign" checked={mode === 'me'} onChange={() => setMode('me')} className="accent-blue-600" />
            <span className="text-sm">
              <span className="font-semibold text-slate-900">Keep with me</span>
              <span className="block text-xs text-slate-500">{leadName} handles this customer.</span>
            </span>
          </label>
          <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${mode === 'member' ? 'border-blue-300 bg-blue-50/50' : 'border-slate-200'}`}>
            <input type="radio" name="tl-assign" checked={mode === 'member'} onChange={() => setMode('member')} className="accent-blue-600 mt-1" disabled={!members.length} />
            <span className="text-sm flex-1">
              <span className="font-semibold text-slate-900">Assign to a team member</span>
              {members.length ? (
                <select
                  aria-label="Team member"
                  className={`${inputClass} mt-2`}
                  value={memberId}
                  onChange={e => {
                    setMode('member');
                    setMemberId(e.target.value);
                  }}
                >
                  <option value="">Choose…</option>
                  {members.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.fullName} · {m.customers} customer{m.customers === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="block text-xs text-slate-500">Your team has no active members yet.</span>
              )}
            </span>
          </label>
        </fieldset>
        {customer.handedOver && (
          <p className="text-[11px] text-slate-500">Passed to you by the Department Head. The sales owner stays the same; only who handles it changes.</p>
        )}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy || unchanged || !target}
            className="px-3.5 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-40"
          >
            {busy ? 'Saving…' : unchanged ? 'Already assigned' : 'Save assignment'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
