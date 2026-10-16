import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUpCircle, Check, CheckCheck, ChevronDown, Clock, Lock, RotateCcw, Search, Send, SlidersHorizontal, UserCog } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { Person, TeamRef } from '../../lib/workTasks';
import {
  fmtWhen,
  isAwaitingReply,
  isTicketOpen,
  isTicketOverdue,
  slaText,
  ticketApi,
  unreadCount,
  TICKET_CATEGORY_LABELS,
  TICKET_LEVEL_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  type SupportTicket,
  type TicketData,
  type TicketLevel,
  type TicketPriority,
  type TicketStatus,
  type TicketUpdateRow
} from '../../lib/support';
import { ago, displayTicketNo, initialsOf, newMessageKey, ticketNoSearchText } from '../../lib/ticketFormat';
import { inputClass, TicketPriorityPill, TicketStatusPill } from './SupportParts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export const personName = (people: Person[], id: string | null) => (id ? people.find(p => p.id === id)?.fullName || 'Team member' : 'Unassigned');
const PRIORITY_RANK: Record<TicketPriority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
/** Who handles the ticket now: the RM (assignee) until it is escalated to a Team Lead / Department Head. */
export const handlerId = (t: SupportTicket) => (t.escalationLevel === 'RM' ? t.assigneeId : t.escalatedTo);
const lastActivity = (t: SupportTicket) => (t.lastMessageAt && t.lastMessageAt > t.updatedAt ? t.lastMessageAt : t.updatedAt);
const isEscalatedNow = (t: SupportTicket) => isTicketOpen(t.status) && (t.status === 'ESCALATED' || t.escalationLevel !== 'RM');
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const teamName = (teams: TeamRef[] | undefined, id: string | null) => (id ? teams?.find(t => t.id === id)?.name ?? null : null);

const Avatar: React.FC<{ name: string; size?: 'sm' | 'md'; tone?: 'green' | 'grey' }> = ({ name, size = 'sm', tone = 'green' }) => (
  <span
    className={`shrink-0 inline-flex items-center justify-center rounded-full font-bold ${size === 'sm' ? 'w-5 h-5 text-[9px]' : 'w-9 h-9 text-xs'} ${
      tone === 'green' ? 'bg-emerald-700 text-white' : 'bg-slate-200 text-slate-600'
    }`}
    aria-hidden="true"
  >
    {initialsOf(name)}
  </span>
);

const Chip: React.FC<{ children: React.ReactNode; tone?: 'grey' | 'amber' | 'rose' | 'green' }> = ({ children, tone = 'grey' }) => (
  <span
    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${
      tone === 'amber'
        ? 'bg-amber-50 border-amber-200 text-amber-900'
        : tone === 'rose'
          ? 'bg-rose-50 border-rose-200 text-rose-800'
          : tone === 'green'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-slate-50 border-slate-200 text-slate-600'
    }`}
  >
    {children}
  </span>
);

/** Small markers on a ticket: escalation level and overdue SLA. */
export const TicketFlags: React.FC<{ ticket: SupportTicket }> = ({ ticket: t }) => (
  <span className="inline-flex flex-wrap items-center gap-1">
    {t.escalationLevel !== 'RM' && isTicketOpen(t.status) && (
      <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 text-[10px] font-bold">With {TICKET_LEVEL_LABELS[t.escalationLevel]}</span>
    )}
    {isTicketOverdue(t) && <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold">Overdue</span>}
  </span>
);

// ---------------------------------------------------------------------------
// Inbox (left panel)
// ---------------------------------------------------------------------------
type Tab = 'OPEN' | 'UNASSIGNED' | 'MINE' | 'TEAM' | 'ESCALATED' | 'DONE';
interface Scope {
  me: string | undefined;
  role: string | undefined;
  teamId: string | null | undefined;
}
/** The tabs a role gets. A plain team member only ever sees their own tickets, so "Unassigned" and "My team" would be empty. */
const tabsFor = (role: string | undefined): { id: Tab; label: string }[] => {
  const all = { id: 'OPEN' as Tab, label: 'All open' };
  const unassigned = { id: 'UNASSIGNED' as Tab, label: 'Unassigned' };
  const mine = { id: 'MINE' as Tab, label: 'My tickets' };
  const team = { id: 'TEAM' as Tab, label: 'My team' };
  const esc = { id: 'ESCALATED' as Tab, label: 'Escalated' };
  const done = { id: 'DONE' as Tab, label: 'Resolved / closed' };
  if (role === 'TEAM_HEAD') return [all, unassigned, mine, team, esc, done];
  if (role === 'DEPARTMENT_HEAD' || role === 'SUPER_ADMIN') return [all, unassigned, mine, esc, done];
  return [all, mine, esc, done];
};
const inTab = (tab: Tab, t: SupportTicket, s: Scope) => {
  switch (tab) {
    case 'OPEN':
      return isTicketOpen(t.status);
    case 'UNASSIGNED':
      return isTicketOpen(t.status) && !t.assigneeId;
    case 'MINE':
      return isTicketOpen(t.status) && !!s.me && handlerId(t) === s.me;
    case 'TEAM':
      return isTicketOpen(t.status) && !!s.teamId && t.teamId === s.teamId;
    case 'ESCALATED':
      return isEscalatedNow(t);
    default:
      return !isTicketOpen(t.status);
  }
};
const PAGE = 30;

/** "Sneha Rao is working on this" - who has the ticket now. */
const OwnerLine: React.FC<{ ticket: SupportTicket; people: Person[] }> = ({ ticket: t, people }) => {
  if (!isTicketOpen(t.status)) {
    return t.resolvedBy ? (
      <span className="flex items-center gap-1.5 text-xs text-slate-500">
        <Avatar name={personName(people, t.resolvedBy)} tone="grey" /> Resolved by {personName(people, t.resolvedBy)}
      </span>
    ) : null;
  }
  const owner = handlerId(t);
  if (!t.assigneeId || !owner) {
    return (
      <span className="text-xs font-medium text-amber-700">
        Nobody is working on this yet{owner ? ` · with ${TICKET_LEVEL_LABELS[t.escalationLevel]} ${personName(people, owner)}` : ''}
      </span>
    );
  }
  const name = personName(people, owner);
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-800 min-w-0">
      <Avatar name={name} />
      <span className="truncate">
        {name}
        {t.escalationLevel !== 'RM' ? ` (${TICKET_LEVEL_LABELS[t.escalationLevel]})` : ''} is working on this
      </span>
    </span>
  );
};

export const TicketInbox: React.FC<{
  data: TicketData;
  people: Person[];
  teams?: TeamRef[];
  manager: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}> = ({ data, people, teams, manager, selectedId, onSelect }) => {
  const { profile } = useAuth();
  const scope: Scope = useMemo(() => ({ me: profile?.id, role: profile?.role, teamId: profile?.teamId }), [profile?.id, profile?.role, profile?.teamId]);
  const tabs = useMemo(() => tabsFor(scope.role), [scope.role]);
  const [tab, setTab] = useState<Tab>('OPEN');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<'activity' | 'created' | 'priority' | 'sla'>('activity');
  const [status, setStatus] = useState<TicketStatus | 'ANY'>('ANY');
  const [priority, setPriority] = useState<TicketPriority | 'ANY'>('ANY');
  const [level, setLevel] = useState<TicketLevel | 'ANY'>('ANY');
  const [person, setPerson] = useState('ANY');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [tab, search, sort, status, priority, level, person, unreadOnly, overdueOnly]);

  const unread = useMemo(() => {
    const m = new Map<string, number>();
    data.tickets.forEach(t => m.set(t.id, unreadCount(t, data.updates, data.reads)));
    return m;
  }, [data.tickets, data.updates, data.reads]);
  const counts = useMemo(() => Object.fromEntries(tabs.map(x => [x.id, data.tickets.filter(t => inTab(x.id, t, scope)).length])) as Record<Tab, number>, [tabs, data.tickets, scope]);
  const staffIds = useMemo(
    () =>
      [...new Set(data.tickets.flatMap(t => [t.assigneeId, t.escalatedTo, t.resolvedBy]).filter((x): x is string => !!x))].sort((a, b) =>
        personName(people, a).localeCompare(personName(people, b))
      ),
    [data.tickets, people]
  );
  const activeFilters = [status !== 'ANY', priority !== 'ANY', level !== 'ANY', person !== 'ANY', unreadOnly, overdueOnly].filter(Boolean).length;

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.tickets
      .filter(t => {
        if (!inTab(tab, t, scope)) return false;
        if (status !== 'ANY' && t.status !== status) return false;
        if (priority !== 'ANY' && t.priority !== priority) return false;
        if (level !== 'ANY' && (t.escalationLevel !== level || !isTicketOpen(t.status))) return false;
        if (person !== 'ANY' && t.assigneeId !== person && t.escalatedTo !== person && t.resolvedBy !== person) return false;
        if (unreadOnly && !(unread.get(t.id) || 0)) return false;
        if (overdueOnly && !isTicketOverdue(t)) return false;
        if (!q) return true;
        return (
          ticketNoSearchText(t.ticketNo).includes(q) ||
          [t.subject, t.customerName, t.customerCode, t.customerCompany || '', t.lastMessagePreview || ''].some(v => v.toLowerCase().includes(q))
        );
      })
      .sort((a, b) =>
        sort === 'priority'
          ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || lastActivity(b).localeCompare(lastActivity(a))
          : sort === 'created'
            ? b.createdAt.localeCompare(a.createdAt)
            : sort === 'sla'
              ? (a.slaDueAt || '9999').localeCompare(b.slaDueAt || '9999') || lastActivity(b).localeCompare(lastActivity(a))
              : lastActivity(b).localeCompare(lastActivity(a))
      );
  }, [data.tickets, tab, scope, status, priority, level, person, unreadOnly, overdueOnly, search, sort, unread]);

  const sel = 'text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white min-w-0';
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-3 pb-2 space-y-2.5 border-b border-slate-100">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Ticket filters">
          {tabs.map(x => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => setTab(x.id)}
              className={`px-3 py-1.5 rounded-full text-[13px] font-semibold transition ${
                tab === x.id ? 'bg-emerald-100 text-emerald-900' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {x.label} <span className={tab === x.id ? 'text-emerald-800' : 'text-slate-400'}>{counts[x.id]}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search ticket, customer, message"
              aria-label="Search tickets"
              className={`${inputClass} pl-9`}
            />
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen(o => !o)}
            aria-expanded={filtersOpen}
            className={`shrink-0 inline-flex items-center gap-1.5 px-3 rounded-xl border text-xs font-semibold ${
              filtersOpen || activeFilters ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" /> Filters{activeFilters ? ` (${activeFilters})` : ''}
          </button>
        </div>
        {filtersOpen && (
          <div className="grid grid-cols-2 gap-2">
            <select value={status} onChange={e => setStatus(e.target.value as any)} aria-label="Filter by status" className={sel}>
              <option value="ANY">Any status</option>
              {(Object.keys(TICKET_STATUS_LABELS) as TicketStatus[]).map(s => (
                <option key={s} value={s}>
                  {TICKET_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select value={priority} onChange={e => setPriority(e.target.value as any)} aria-label="Filter by priority" className={sel}>
              <option value="ANY">Any priority</option>
              {(Object.keys(TICKET_PRIORITY_LABELS) as TicketPriority[]).map(p => (
                <option key={p} value={p}>
                  {TICKET_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
            {manager && (
              <>
                <select value={level} onChange={e => setLevel(e.target.value as any)} aria-label="Filter by escalation level" className={sel}>
                  <option value="ANY">Any level</option>
                  {(Object.keys(TICKET_LEVEL_LABELS) as TicketLevel[]).map(l => (
                    <option key={l} value={l}>
                      With {TICKET_LEVEL_LABELS[l]}
                    </option>
                  ))}
                </select>
                <select value={person} onChange={e => setPerson(e.target.value)} aria-label="Filter by team member" className={sel}>
                  <option value="ANY">Everyone</option>
                  {staffIds.map(id => (
                    <option key={id} value={id}>
                      {personName(people, id)}
                    </option>
                  ))}
                </select>
              </>
            )}
            <select value={sort} onChange={e => setSort(e.target.value as any)} aria-label="Sort tickets" className={sel}>
              <option value="activity">Last activity</option>
              <option value="created">Newest</option>
              <option value="priority">Priority</option>
              <option value="sla">SLA deadline</option>
            </select>
            <div className="flex items-center gap-3 text-xs text-slate-600">
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} className="rounded border-slate-300" /> Unread
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} className="rounded border-slate-300" /> Overdue
              </label>
            </div>
            {activeFilters > 0 && (
              <button
                type="button"
                onClick={() => {
                  setStatus('ANY');
                  setPriority('ANY');
                  setLevel('ANY');
                  setPerson('ANY');
                  setUnreadOnly(false);
                  setOverdueOnly(false);
                }}
                className="col-span-2 text-xs font-semibold text-emerald-800 hover:underline text-left"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" aria-label="Tickets">
        {data.loading && data.tickets.length === 0 ? (
          <div className="p-3 space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-28 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-semibold text-slate-700">{data.tickets.length === 0 ? 'No tickets yet' : 'Nothing here'}</p>
            <p className="text-xs text-slate-500 mt-1">
              {data.tickets.length === 0 ? 'Customer tickets you can see appear here.' : 'Try another tab, filter or search.'}
            </p>
          </div>
        ) : (
          <ul>
            {list.slice(0, shown).map(t => {
              const n = unread.get(t.id) || 0;
              const active = t.id === selectedId;
              const team = teamName(teams, t.teamId);
              return (
                <li key={t.id} className="border-b border-slate-100">
                  <button
                    type="button"
                    onClick={() => onSelect(t.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full text-left px-4 py-3 border-l-4 transition ${
                      active ? 'bg-emerald-50 border-emerald-600' : n ? 'border-emerald-400 bg-white hover:bg-slate-50' : 'border-transparent hover:bg-slate-50'
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-bold text-sm text-slate-900 tracking-tight">{displayTicketNo(t.ticketNo)}</span>
                      <span className={`shrink-0 text-xs ${n ? 'text-emerald-700 font-bold' : 'text-slate-400'}`}>{ago(lastActivity(t))}</span>
                    </span>
                    <span className="block truncate text-sm font-semibold text-slate-800 mt-0.5">
                      {t.customerName}
                      {t.customerCompany && <span className="font-normal text-slate-500"> · {t.customerCompany}</span>}
                    </span>
                    <span className="flex items-center justify-between gap-2 mt-0.5">
                      <span className={`truncate text-[13px] ${n ? 'text-slate-800 font-medium' : 'text-slate-500'}`}>
                        <span className="text-slate-700">{t.subject}</span>
                        {t.lastMessagePreview && (
                          <>
                            {' · '}
                            {t.lastMessageFrom === 'STAFF' ? 'You: ' : ''}
                            {t.lastMessagePreview}
                          </>
                        )}
                      </span>
                      {n > 0 && (
                        <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-emerald-600 text-white text-[11px] font-bold flex items-center justify-center" aria-label={`${n} unread`}>
                          {n}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 mt-2">
                      <TicketStatusPill status={t.status} />
                      <TicketPriorityPill priority={t.priority} />
                      <span className="inline-flex px-2 py-0.5 rounded-full border border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                        {team || TICKET_CATEGORY_LABELS[t.category]}
                      </span>
                      <TicketFlags ticket={t} />
                    </span>
                    <span className="block mt-2 space-y-1">
                      <OwnerLine ticket={t} people={people} />
                      {t.escalationLevel !== 'RM' && isTicketOpen(t.status) && t.assigneeId && (
                        <span className="block text-[11px] text-slate-400">Relationship Manager: {personName(people, t.assigneeId)}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {list.length > shown && (
          <div className="p-3">
            <button type="button" onClick={() => setShown(s => s + PAGE)} className="w-full py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50">
              Show more ({list.length - shown})
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Conversation entries
// ---------------------------------------------------------------------------
interface Pending {
  key: string;
  text: string;
  internal: boolean;
  state: 'sending' | 'failed';
  error?: string;
}
type Entry =
  | { type: 'day'; id: string; label: string }
  | { type: 'msg'; id: string; side: 'customer' | 'staff' | 'note'; name: string; role?: string; text: string; at: string; seen?: boolean; mine: boolean }
  | { type: 'event'; id: string; text: string; detail?: string | null; at: string; tone: 'neutral' | 'warn' | 'good' };

function buildEntries(ticket: SupportTicket, history: TicketUpdateRow[], people: Person[], me: string | undefined): Entry[] {
  const out: Entry[] = [];
  let day = '';
  const raisedByCustomer = !ticket.createdBy;
  for (const u of history) {
    const d = new Date(u.createdAt).toDateString();
    if (d !== day) {
      day = d;
      out.push({ type: 'day', id: `d-${u.id}`, label: dayLabel(u.createdAt) });
    }
    const who = personName(people, u.authorId);
    if (u.clientAuthor && (u.kind === 'CLIENT_REPLY' || u.kind === 'CREATED') && u.note) {
      out.push({ type: 'msg', id: u.id, side: 'customer', name: ticket.customerName, role: 'Customer', text: u.note, at: u.createdAt, mine: false });
    } else if (u.kind === 'NOTE' && u.note) {
      const reply = u.clientVisible;
      out.push({
        type: 'msg',
        id: u.id,
        side: reply ? 'staff' : 'note',
        name: u.authorId ? who : 'Support',
        role: u.authorLabel || undefined,
        text: u.note,
        at: u.createdAt,
        mine: !!me && u.authorId === me,
        seen: reply && raisedByCustomer ? !!ticket.clientReadAt && ticket.clientReadAt >= u.createdAt : undefined
      });
    } else if (u.kind === 'CREATED') {
      out.push({ type: 'event', id: u.id, text: `${u.authorId ? who : 'Support'} opened the ticket`, detail: u.note, at: u.createdAt, tone: 'neutral' });
    } else if (u.kind === 'ASSIGNED') {
      out.push({ type: 'event', id: u.id, text: `Assigned to ${personName(people, u.assigneeId)}`, detail: u.authorId ? `by ${who}${u.note ? `: ${u.note}` : ''}` : u.note, at: u.createdAt, tone: 'neutral' });
    } else if (u.kind === 'ESCALATED') {
      out.push({ type: 'event', id: u.id, text: u.note?.split(':')[0] || 'Escalated', detail: u.note?.includes(':') ? u.note.slice(u.note.indexOf(':') + 1).trim() : null, at: u.createdAt, tone: 'warn' });
    } else if (u.kind === 'PRIORITY_CHANGED') {
      out.push({ type: 'event', id: u.id, text: u.note || 'Priority changed', detail: u.authorId ? `by ${who}` : null, at: u.createdAt, tone: 'neutral' });
    } else if (u.kind === 'STATUS_CHANGED') {
      const by = u.authorId ? who : u.clientAuthor ? ticket.customerName : 'System';
      const text =
        u.toStatus === 'RESOLVED'
          ? `${by} resolved the ticket`
          : u.toStatus === 'CLOSED'
            ? `${by} closed the ticket`
            : u.fromStatus === 'RESOLVED' || u.fromStatus === 'CLOSED'
              ? `${by} reopened the ticket`
              : `${by} set the status to ${u.toStatus ? TICKET_STATUS_LABELS[u.toStatus] : '-'}`;
      out.push({ type: 'event', id: u.id, text, detail: u.note, at: u.createdAt, tone: u.toStatus === 'RESOLVED' || u.toStatus === 'CLOSED' ? 'good' : 'neutral' });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The selected ticket (right panel): header, context banner, controls, chat, composer
// ---------------------------------------------------------------------------
type Banner = { tone: 'attention' | 'info' | 'good' | 'danger'; text: string };
const BANNER_CLS: Record<Banner['tone'], string> = {
  attention: 'bg-amber-50 border-amber-200 text-amber-900',
  info: 'bg-slate-50 border-slate-200 text-slate-700',
  good: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  danger: 'bg-rose-50 border-rose-200 text-rose-900'
};

function contextBanner(t: SupportTicket, people: Person[], me: string | undefined, updates: TicketUpdateRow[]): Banner {
  const owner = handlerId(t);
  const ownerName = personName(people, owner);
  const level = TICKET_LEVEL_LABELS[t.escalationLevel];
  if (!isTicketOpen(t.status)) {
    return {
      tone: 'good',
      text: `${t.status === 'CLOSED' ? 'Closed' : 'Resolved'}${t.resolvedBy ? ` by ${personName(people, t.resolvedBy)}` : ''}${t.resolvedAt ? ` on ${fmtWhen(t.resolvedAt)}` : ''}. The conversation stays here${t.status === 'CLOSED' ? '.' : '; a reply from the customer reopens it.'}`
    };
  }
  const overdue = isTicketOverdue(t);
  const awaiting = isAwaitingReply(t);
  if (t.escalationLevel !== 'RM') {
    const esc = [...updates].reverse().find(u => u.ticketId === t.id && u.kind === 'ESCALATED');
    const rm = t.assigneeId && t.assigneeId !== owner ? ` ${personName(people, t.assigneeId)} (Relationship Manager) stays informed.` : '';
    const attention = owner === me && awaiting ? ' A new customer message requires your attention.' : owner === me ? ' It is with you.' : '';
    if (!esc) {
      // never escalated: the customer had no Relationship Manager, so the ticket started with the Team Lead / Department Head
      if (!t.assigneeId) {
        return { tone: owner === me && awaiting ? 'attention' : 'info', text: `This customer has no Relationship Manager yet, so the ticket is with ${level} ${ownerName}.${attention}` };
      }
      return { tone: owner === me && awaiting ? 'attention' : 'info', text: `This ticket is currently assigned to ${ownerName}${owner === me ? ' (you)' : ''}.${attention}` };
    }
    const why = esc.authorId ? ` by ${personName(people, esc.authorId)}` : ' because the response SLA was exceeded';
    return { tone: owner === me && awaiting ? 'attention' : overdue ? 'danger' : 'info', text: `Escalated to ${level} ${ownerName}${why}.${attention}${rm}` };
  }
  if (!owner) return { tone: 'attention', text: 'Nobody is working on this yet. If it is for your team, pick it up or just reply.' };
  if (t.status === 'WAITING_CUSTOMER') return { tone: 'info', text: `Waiting for the customer to reply. ${ownerName} is handling this ticket.` };
  if (awaiting) {
    if (owner === me) return { tone: overdue ? 'danger' : 'attention', text: `A new customer message requires your attention${overdue ? ` (reply ${slaText(t.slaDueAt)})` : ''}.` };
    return { tone: overdue ? 'danger' : 'info', text: `Waiting for the Relationship Manager ${ownerName} to respond${overdue ? ` (reply ${slaText(t.slaDueAt)})` : ''}.` };
  }
  return { tone: 'info', text: `This ticket is currently assigned to ${ownerName}${owner === me ? ' (you)' : ''}.` };
}

export const TicketPane: React.FC<{
  ticket: SupportTicket;
  data: TicketData;
  people: Person[];
  teams?: TeamRef[];
  /** View only (e.g. a Team Lead reading another team's ticket on one of their customers). */
  readOnly?: boolean;
  /** Shown in a dialog: leave room for its close button. */
  inModal?: boolean;
  onBack?: () => void;
  onOpenCustomer?: (customerId: string) => void;
}> = ({ ticket, data, people, teams, readOnly = false, inModal = false, onBack, onOpenCustomer }) => {
  const { profile } = useAuth();
  const me = profile?.id;
  const role = profile?.role;
  const managerRole = role === 'TEAM_HEAD' || role === 'DEPARTMENT_HEAD' || role === 'SUPER_ADMIN';
  const canAct = !readOnly && (managerRole || ticket.assigneeId === me || ticket.escalatedTo === me);
  const open = isTicketOpen(ticket.status);
  const customerConversation = !ticket.createdBy;
  const history = useMemo(() => data.updates.filter(u => u.ticketId === ticket.id), [data.updates, ticket.id]);
  const entries = useMemo(() => buildEntries(ticket, history, people, me), [ticket, history, people, me]);
  const banner = contextBanner(ticket, people, me, data.updates);
  const nextLevel: TicketLevel | null = ticket.escalationLevel === 'RM' ? 'TL' : ticket.escalationLevel === 'TL' ? 'DH' : null;
  const escalations = history.filter(u => u.kind === 'ESCALATED');
  const teamPeople = people.filter(p => (p.role === 'TEAM_MEMBER' || p.role === 'TEAM_HEAD') && p.status === 'ACTIVE' && p.teamId === ticket.teamId);
  // Only a Team Lead of the ticket's own team may pick up an unassigned ticket (the database enforces it as well).
  const canClaim = canAct && role === 'TEAM_HEAD' && !ticket.assigneeId && open && !!profile?.teamId && ticket.teamId === profile.teamId;
  const canAssign = canAct && managerRole && open;

  const [panel, setPanel] = useState<null | 'resolve' | 'escalate' | 'assign'>(null);
  const [details, setDetails] = useState(false);
  const [targetStatus, setTargetStatus] = useState<TicketStatus>('RESOLVED');
  const [resolution, setResolution] = useState('');
  const [reason, setReason] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(false);
  const unread = unreadCount(ticket, data.updates, data.reads);

  useEffect(() => {
    setPanel(null);
    setDetails(false);
    setError(null);
    setDone(null);
    setResolution('');
    setReason('');
    setAssignee('');
    setText('');
    setPending([]);
    setInternal(!customerConversation);
  }, [ticket.id, customerConversation]);
  // Drop pending bubbles once the stored message arrives (Realtime / reload).
  useEffect(() => {
    const stored = new Set(history.map(u => u.clientMsgId).filter(Boolean));
    setPending(p => p.filter(x => !stored.has(x.key)));
  }, [history]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    setNewBelow(false);
  }, [ticket.id]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (atBottom) el.scrollTop = el.scrollHeight;
    else setNewBelow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length, pending.length]);

  // Reading the conversation marks it read (only while the tab is visible).
  const marking = useRef('');
  useEffect(() => {
    if (!unread || document.visibilityState !== 'visible') return;
    const key = `${ticket.id}:${ticket.lastMessageAt}`;
    if (marking.current === key) return;
    marking.current = key;
    ticketApi.markRead(ticket.id).catch(() => {
      marking.current = '';
    });
  }, [unread, ticket.id, ticket.lastMessageAt]);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      await data.reload();
      setPanel(null);
      setResolution('');
      setReason('');
      setDone(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the change.');
    } finally {
      setBusy(false);
    }
  };
  const onStatusChange = (s: TicketStatus) => {
    if (s === ticket.status) return;
    if (s === 'RESOLVED' || s === 'CLOSED') {
      setTargetStatus(s);
      setPanel('resolve');
      return;
    }
    void run(() => ticketApi.update(ticket.id, { status: s }), `Status set to ${TICKET_STATUS_LABELS[s]}.`);
  };

  const deliver = useCallback(
    async (p: Pending) => {
      setPending(list => list.map(x => (x.key === p.key ? { ...x, state: 'sending', error: undefined } : x)));
      try {
        await ticketApi.send(ticket.id, p.text, p.internal, p.key);
        await data.reload();
      } catch (err) {
        setPending(list => list.map(x => (x.key === p.key ? { ...x, state: 'failed', error: err instanceof Error ? err.message : 'Not sent.' } : x)));
      }
    },
    [ticket.id, data]
  );
  const send = () => {
    const body = text.trim();
    if (!body) return;
    const p: Pending = { key: newMessageKey(), text: body, internal: internal || !customerConversation, state: 'sending' };
    setPending(list => [...list, p]);
    setText('');
    setAtBottom(true);
    void deliver(p);
  };

  const owner = handlerId(ticket);
  const ctl = 'text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:bg-slate-50 disabled:text-slate-500';
  const statusOptions = (Object.keys(TICKET_STATUS_LABELS) as TicketStatus[]).filter(s => s === ticket.status || (s !== 'ESCALATED' && (s !== 'CLOSED' || managerRole)));
  const team = teamName(teams, ticket.teamId);

  return (
    <div className="flex flex-col h-full min-h-0 bg-white">
      <header className={`pl-4 ${inModal ? 'pr-12' : 'pr-4'} pt-3 pb-3 border-b border-slate-100 space-y-2.5`}>
        <div className="flex items-center gap-2 flex-wrap">
          {onBack && (
            <button type="button" onClick={onBack} className="lg:hidden p-1.5 -ml-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Back to tickets">
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <h2 className="text-xl font-extrabold text-slate-900 tracking-tight" title={ticket.ticketNo}>
            {displayTicketNo(ticket.ticketNo)}
          </h2>
          <TicketStatusPill status={ticket.status} />
          {ticket.customerPhone && <span className="text-sm text-slate-500">{ticket.customerPhone}</span>}
          <TicketFlags ticket={ticket} />
          <button
            type="button"
            onClick={() => setDetails(d => !d)}
            aria-expanded={details}
            className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:underline"
          >
            Details <ChevronDown className={`w-3.5 h-3.5 transition ${details ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{ticket.subject}</p>
          <p className="text-xs text-slate-500 truncate">
            {onOpenCustomer ? (
              <button type="button" className="text-emerald-800 hover:underline font-medium" onClick={() => onOpenCustomer(ticket.customerId)}>
                {ticket.customerName}
              </button>
            ) : (
              ticket.customerName
            )}
            {ticket.customerCompany ? ` · ${ticket.customerCompany}` : ''}
            {ticket.customerEmail ? ` · ${ticket.customerEmail}` : ''}
          </p>
        </div>

        <div className={`rounded-xl border px-3.5 py-3 ${BANNER_CLS[banner.tone]}`} role="status">
          <p className="text-sm">{banner.text}</p>
          {canClaim && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => ticketApi.assign(ticket.id, me!, 'Picked up'), 'You picked up this ticket.')}
              className="mt-2.5 px-4 py-2 rounded-xl bg-emerald-700 text-white text-sm font-bold hover:bg-emerald-800 disabled:opacity-50"
            >
              {busy ? 'Picking up…' : 'Pick up this ticket'}
            </button>
          )}
          {!open && canAct && ticket.status === 'RESOLVED' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => ticketApi.update(ticket.id, { status: 'OPEN', note: 'Reopened' }), 'Ticket reopened.')}
              className="mt-2.5 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-emerald-300 bg-white text-emerald-900 text-sm font-bold hover:bg-emerald-50 disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Reopen
            </button>
          )}
          {!open && canAct && ticket.status === 'CLOSED' && managerRole && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => ticketApi.update(ticket.id, { status: 'OPEN', note: 'Reopened' }), 'Ticket reopened.')}
              className="mt-2.5 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-emerald-300 bg-white text-emerald-900 text-sm font-bold hover:bg-emerald-50 disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Reopen
            </button>
          )}
        </div>

        <div className={`${details ? 'flex' : 'hidden'} lg:flex flex-wrap items-center gap-2`}>
          {(team || teams) && <Chip>{team || 'No team yet'}</Chip>}
          <Chip tone={ticket.assigneeId ? 'grey' : 'amber'}>{ticket.assigneeId ? `RM: ${personName(people, ticket.assigneeId)}` : 'Unassigned'}</Chip>
          {open && owner && ticket.escalationLevel !== 'RM' && <Chip tone="rose">With {TICKET_LEVEL_LABELS[ticket.escalationLevel]}: {personName(people, owner)}</Chip>}
          <label className="sr-only" htmlFor="tp-priority">
            Priority
          </label>
          <select
            id="tp-priority"
            value={ticket.priority}
            disabled={!canAct || busy || ticket.status === 'CLOSED'}
            onChange={e => void run(() => ticketApi.setPriority(ticket.id, e.target.value as TicketPriority), `Priority set to ${TICKET_PRIORITY_LABELS[e.target.value as TicketPriority]}.`)}
            className={ctl}
          >
            {(Object.keys(TICKET_PRIORITY_LABELS) as TicketPriority[]).map(p => (
              <option key={p} value={p}>
                {TICKET_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="tp-status">
            Status
          </label>
          <select id="tp-status" value={ticket.status} disabled={!canAct || busy} onChange={e => onStatusChange(e.target.value as TicketStatus)} className={ctl}>
            {statusOptions.map(s => (
              <option key={s} value={s} disabled={s === 'ESCALATED'}>
                {TICKET_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {canAct && open && nextLevel && (
            <button
              type="button"
              onClick={() => setPanel(panel === 'escalate' ? null : 'escalate')}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 text-sm font-semibold text-rose-700 hover:bg-rose-50"
            >
              <ArrowUpCircle className="w-4 h-4" aria-hidden="true" /> Escalate
            </button>
          )}
          {canAssign && (
            <button
              type="button"
              onClick={() => setPanel(panel === 'assign' ? null : 'assign')}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <UserCog className="w-4 h-4" aria-hidden="true" /> {ticket.assigneeId ? 'Reassign' : 'Assign'}
            </button>
          )}
        </div>

        {panel === 'resolve' && (
          <form
            className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2"
            onSubmit={e => {
              e.preventDefault();
              if (!ticket.resolutionNotes && !resolution.trim()) return setError('Add the resolution notes first.');
              void run(() => ticketApi.update(ticket.id, { status: targetStatus, resolution: resolution.trim() || undefined }), `Ticket ${targetStatus === 'CLOSED' ? 'closed' : 'resolved'}.`);
            }}
          >
            <label className="text-xs font-bold text-slate-800" htmlFor="tp-res">
              Resolution notes {ticket.resolutionNotes ? '(optional)' : ''}
            </label>
            <textarea id="tp-res" rows={2} value={resolution} onChange={e => setResolution(e.target.value)} maxLength={4000} className={inputClass} placeholder="How was it resolved?" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPanel(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="px-4 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-bold disabled:opacity-50">
                {busy ? 'Saving…' : targetStatus === 'CLOSED' ? 'Close ticket' : 'Resolve ticket'}
              </button>
            </div>
          </form>
        )}
        {panel === 'escalate' && nextLevel && (
          <form
            className="p-3 rounded-xl border border-rose-200 bg-rose-50/60 space-y-2"
            onSubmit={e => {
              e.preventDefault();
              if (!reason.trim()) return setError('Give the reason for escalating.');
              void run(() => ticketApi.escalate(ticket.id, reason.trim()), `Escalated to the ${TICKET_LEVEL_LABELS[nextLevel]}.`);
            }}
          >
            <label className="text-xs font-bold text-slate-800" htmlFor="tp-esc">
              Reason for escalating to the {TICKET_LEVEL_LABELS[nextLevel]}
            </label>
            <textarea id="tp-esc" rows={2} value={reason} onChange={e => setReason(e.target.value)} maxLength={4000} className={inputClass} />
            <p className="text-[11px] text-slate-500">The Relationship Manager stays on the ticket and keeps getting updates.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPanel(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="px-4 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold disabled:opacity-50">
                {busy ? 'Escalating…' : 'Escalate'}
              </button>
            </div>
          </form>
        )}
        {panel === 'assign' && canAssign && (
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-2">
            <select value={assignee} onChange={e => setAssignee(e.target.value)} aria-label="Assign ticket to" className={`${inputClass} flex-1`}>
              <option value="">Choose a team member</option>
              {teamPeople
                .filter(p => p.id !== ticket.assigneeId)
                .map(p => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
            </select>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setPanel(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !assignee}
                onClick={() => void run(() => ticketApi.assign(ticket.id, assignee), 'Ticket assigned.')}
                className="px-4 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold disabled:opacity-40"
              >
                Assign
              </button>
            </div>
          </div>
        )}
        {error && (
          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2" role="alert">
            {error}
          </p>
        )}
        {done && (
          <p className="text-xs text-emerald-700" role="status">
            {done}
          </p>
        )}

        {details && (
          <div className="rounded-xl border border-slate-200 p-3 max-h-56 overflow-y-auto space-y-3 text-xs">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div>
                <dt className="text-slate-400">Customer ID</dt>
                <dd className="font-mono text-slate-800">{ticket.customerCode}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Category</dt>
                <dd className="text-slate-800">{TICKET_CATEGORY_LABELS[ticket.category]}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Relationship Manager</dt>
                <dd className="text-slate-800">{personName(people, ticket.assigneeId)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Escalation level</dt>
                <dd className="text-slate-800">{TICKET_LEVEL_LABELS[ticket.escalationLevel]}</dd>
              </div>
              {open && (
                <div>
                  <dt className="text-slate-400">Reply due (SLA)</dt>
                  <dd className={`inline-flex items-center gap-1 ${isTicketOverdue(ticket) ? 'text-rose-700 font-bold' : 'text-slate-800'}`}>
                    <Clock className="w-3 h-3" aria-hidden="true" />
                    {ticket.slaDueAt ? `${fmtWhen(ticket.slaDueAt)} (${slaText(ticket.slaDueAt)})` : isAwaitingReply(ticket) ? 'No deadline' : 'Nobody waiting'}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-slate-400">Created</dt>
                <dd className="text-slate-800">{fmtWhen(ticket.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Last activity</dt>
                <dd className="text-slate-800">{fmtWhen(lastActivity(ticket))}</dd>
              </div>
              {(ticket.resolvedBy || ticket.resolvedAt) && (
                <div>
                  <dt className="text-slate-400">Resolved</dt>
                  <dd className="text-emerald-700">
                    {ticket.resolvedBy ? personName(people, ticket.resolvedBy) : '-'} · {fmtWhen(ticket.resolvedAt)}
                  </dd>
                </div>
              )}
            </dl>
            {ticket.resolutionNotes && <p className="text-emerald-800 bg-emerald-50 rounded-lg p-2.5 whitespace-pre-line">{ticket.resolutionNotes}</p>}
            {escalations.length > 0 && (
              <div>
                <div className="font-bold text-slate-700 mb-1">Escalation history</div>
                <ol className="space-y-1.5 border-l border-rose-200 pl-3">
                  {escalations.map(u => (
                    <li key={u.id}>
                      <div className="font-semibold text-slate-800">{u.note?.split(':')[0]}</div>
                      <div className="text-slate-500">
                        {u.authorId ? `by ${personName(people, u.authorId)}` : 'Automatic (SLA)'} · {fmtWhen(u.createdAt)}
                        {u.note?.includes(':') ? ` · ${u.note.slice(u.note.indexOf(':') + 1).trim()}` : ''}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </header>

      <div
        ref={scroller}
        onScroll={e => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          setAtBottom(bottom);
          if (bottom) setNewBelow(false);
        }}
        className="relative flex-1 min-h-0 overflow-y-auto bg-[#e9efec] px-3 sm:px-5 py-4 space-y-2"
        aria-live="polite"
        aria-label="Conversation"
      >
        {entries.length === 0 && pending.length === 0 && <p className="text-center text-xs text-slate-500 py-10">No messages yet.</p>}
        {entries.map(e =>
          e.type === 'day' ? (
            <div key={e.id} className="flex justify-center py-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 bg-white/80 rounded-full px-2.5 py-0.5 shadow-sm">{e.label}</span>
            </div>
          ) : e.type === 'event' ? (
            <div key={e.id} className="flex flex-col items-center py-0.5 text-center">
              <span
                className={`text-[11px] rounded-full px-2.5 py-0.5 ${
                  e.tone === 'warn' ? 'bg-rose-100 text-rose-800' : e.tone === 'good' ? 'bg-emerald-100 text-emerald-800' : 'bg-white/80 text-slate-600'
                }`}
              >
                {e.text} · {clock(e.at)}
              </span>
              {e.detail && <span className="text-[11px] text-slate-500 mt-0.5 max-w-md whitespace-pre-line">{e.detail}</span>}
            </div>
          ) : (
            <div key={e.id} className={`flex ${e.side === 'customer' ? 'justify-start' : 'justify-end'}`}>
              <div
                className={`max-w-[88%] sm:max-w-[68%] rounded-xl px-3 py-2 shadow-sm ${
                  e.side === 'customer'
                    ? 'bg-white text-slate-900 rounded-tl-sm'
                    : e.side === 'note'
                      ? 'bg-amber-50 border border-amber-200 text-amber-950 rounded-tr-sm'
                      : 'bg-[#d9f2e3] text-slate-900 rounded-tr-sm'
                }`}
              >
                <div className={`text-xs font-bold ${e.side === 'customer' ? 'text-slate-600' : e.side === 'note' ? 'text-amber-800' : 'text-emerald-800'}`}>
                  {e.mine ? 'You' : e.name}
                  {e.role && <span className="font-medium"> · {e.role}</span>}
                  {e.side === 'note' && (
                    <span className="inline-flex items-center gap-0.5 ml-1.5 font-semibold">
                      <Lock className="w-2.5 h-2.5" aria-hidden="true" /> Internal note
                    </span>
                  )}
                </div>
                <div className="text-sm whitespace-pre-wrap break-words mt-0.5">{e.text}</div>
                <div className="flex items-center justify-end gap-1 text-[11px] text-slate-500 mt-1">
                  {clock(e.at)}
                  {e.seen !== undefined &&
                    (e.seen ? (
                      <CheckCheck className="w-3.5 h-3.5 text-sky-600" aria-label="Seen by the customer" />
                    ) : (
                      <Check className="w-3.5 h-3.5" aria-label="Sent" />
                    ))}
                </div>
              </div>
            </div>
          )
        )}
        {pending.map(p => (
          <div key={p.key} className="flex justify-end">
            <div
              className={`max-w-[88%] sm:max-w-[68%] rounded-xl rounded-tr-sm px-3 py-2 shadow-sm ${p.internal ? 'bg-amber-50 border border-amber-200' : 'bg-[#d9f2e3]'} ${
                p.state === 'sending' ? 'opacity-70' : 'ring-2 ring-rose-400'
              }`}
            >
              <div className="text-sm whitespace-pre-wrap break-words text-slate-900">{p.text}</div>
              <div className="text-[11px] mt-1 text-right">
                {p.state === 'sending' ? (
                  <span className="text-slate-500">Sending…</span>
                ) : (
                  <span className="inline-flex items-center gap-2 text-rose-700">
                    {p.error || 'Not sent.'}
                    <button type="button" onClick={() => void deliver(p)} className="inline-flex items-center gap-0.5 font-bold underline">
                      <RotateCcw className="w-3 h-3" aria-hidden="true" /> Retry
                    </button>
                    <button type="button" onClick={() => setPending(l => l.filter(x => x.key !== p.key))} className="text-slate-500 underline">
                      Discard
                    </button>
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {newBelow && (
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              const el = scroller.current;
              if (el) el.scrollTop = el.scrollHeight;
              setNewBelow(false);
            }}
            className="absolute -top-12 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-slate-900 text-white text-xs font-semibold shadow-lg"
          >
            <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" /> New messages
          </button>
        </div>
      )}

      {canAct ? (
        ticket.status === 'CLOSED' && !internal ? (
          <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 flex items-center justify-between gap-2">
            This ticket is closed. Reopen it to reply to the customer.
            <button type="button" onClick={() => setInternal(true)} className="font-semibold text-amber-700 hover:underline">
              Add an internal note
            </button>
          </div>
        ) : (
          <form
            className="border-t border-slate-200 px-3 sm:px-4 pt-2.5 pb-3 bg-white"
            onSubmit={e => {
              e.preventDefault();
              send();
            }}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 text-xs">
              {customerConversation ? (
                <div className="flex gap-1" role="radiogroup" aria-label="Message type">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!internal}
                    onClick={() => setInternal(false)}
                    className={`px-2.5 py-1 rounded-full font-semibold ${!internal ? 'bg-emerald-100 text-emerald-900' : 'text-slate-500 hover:bg-slate-100'}`}
                  >
                    Reply to customer
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={internal}
                    onClick={() => setInternal(true)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-semibold ${internal ? 'bg-amber-100 text-amber-900' : 'text-slate-500 hover:bg-slate-100'}`}
                  >
                    <Lock className="w-3 h-3" aria-hidden="true" /> Internal note
                  </button>
                </div>
              ) : (
                <span className="font-semibold text-amber-800 inline-flex items-center gap-1">
                  <Lock className="w-3 h-3" aria-hidden="true" /> Internal ticket: notes are visible to staff only
                </span>
              )}
              {open && customerConversation && !internal && (
                <span className="inline-flex items-center gap-1 text-emerald-800 font-medium">
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  {ticket.slaDueAt ? `Reply due ${slaText(ticket.slaDueAt)}` : 'Replies reach the customer’s dashboard'}
                </span>
              )}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                rows={2}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send();
                  }
                }}
                maxLength={4000}
                aria-label={internal ? 'Internal note' : 'Reply to the customer'}
                placeholder={internal ? 'Note for the team (the customer does not see it)' : `Reply to ${ticket.customerName}`}
                className={`${inputClass} resize-none max-h-40 ${internal ? 'bg-amber-50/50 border-amber-200' : ''}`}
              />
              <button
                type="submit"
                disabled={!text.trim()}
                className={`shrink-0 h-12 px-5 rounded-xl text-sm font-bold text-white disabled:opacity-40 inline-flex items-center gap-1.5 ${internal ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-700 hover:bg-emerald-800'}`}
              >
                <Send className="w-4 h-4" aria-hidden="true" /> Send
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1 hidden sm:block">Enter to send, Shift+Enter for a new line.</p>
          </form>
        )
      ) : (
        <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">You are viewing this conversation. Only the people handling the ticket can write here.</div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// The workspace: inbox | selected ticket (collapses to one panel on small screens)
// ---------------------------------------------------------------------------
export const TicketWorkspace: React.FC<{
  data: TicketData;
  people: Person[];
  teams?: TeamRef[];
  manager: boolean;
  /** The page shows a summary strip above the workspace, so it gets a little less height. */
  compactTop?: boolean;
  onOpenCustomer?: (customerId: string) => void;
}> = ({ data, people, teams, manager, compactTop, onOpenCustomer }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ticket = data.tickets.find(t => t.id === selectedId) || null;
  return (
    <div
      className={`bg-white overflow-hidden grid grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[380px_minmax(0,1fr)] lg:rounded-2xl lg:border lg:border-slate-200/80 lg:min-h-[560px] ${
        compactTop ? 'lg:h-[calc(100vh-15rem)]' : 'lg:h-[calc(100vh-11rem)]'
      } ${
        // on a phone an open conversation takes the whole screen (Back returns to the list)
        ticket ? 'fixed inset-0 z-[60] lg:static lg:z-auto' : 'rounded-2xl border border-slate-200/80 h-[calc(100vh-14rem)] min-h-[420px]'
      }`}
    >
      <div className={`${ticket ? 'hidden lg:flex' : 'flex'} flex-col min-h-0 border-r border-slate-200`}>
        <TicketInbox data={data} people={people} teams={teams} manager={manager} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      <div className={`${ticket ? 'flex' : 'hidden lg:flex'} flex-col min-h-0`}>
        {ticket ? (
          <TicketPane key={ticket.id} ticket={ticket} data={data} people={people} teams={teams} onBack={() => setSelectedId(null)} onOpenCustomer={onOpenCustomer} />
        ) : (
          <div className="flex-1 flex items-center justify-center p-8 text-center bg-[#e9efec]">
            <div>
              <p className="text-sm font-semibold text-slate-700">Select a ticket</p>
              <p className="text-xs text-slate-500 mt-1">The conversation with the customer opens here.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
