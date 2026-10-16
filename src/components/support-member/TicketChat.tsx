import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUpCircle, Check, CheckCheck, Clock, Info, Lock, RotateCcw, Search, Send, UserCog, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { Person } from '../../lib/workTasks';
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
import { FormField, inputClass, TicketPriorityPill, TicketStatusPill } from './SupportParts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export const personName = (people: Person[], id: string | null) => (id ? people.find(p => p.id === id)?.fullName || 'Team member' : 'Unassigned');
const PRIORITY_RANK: Record<TicketPriority, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
/** Who handles the ticket now: the RM (assignee) until it is escalated to a Team Lead / Department Head. */
export const handlerId = (t: SupportTicket) => (t.escalationLevel === 'RM' ? t.assigneeId : t.escalatedTo);
const lastActivity = (t: SupportTicket) => (t.lastMessageAt && t.lastMessageAt > t.updatedAt ? t.lastMessageAt : t.updatedAt);
const newKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase())
    .join('') || '?';
const timeShort = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
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

/** Small markers on a ticket: escalation level, waiting for our reply, SLA. */
export const TicketFlags: React.FC<{ ticket: SupportTicket }> = ({ ticket: t }) => (
  <span className="inline-flex flex-wrap items-center gap-1">
    {t.escalationLevel !== 'RM' && isTicketOpen(t.status) && (
      <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 text-[10px] font-bold">With {TICKET_LEVEL_LABELS[t.escalationLevel]}</span>
    )}
    {isTicketOverdue(t) && <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold">Overdue</span>}
  </span>
);

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
type Tab = 'ALL' | 'UNREAD' | 'OPEN' | 'IN_PROGRESS' | 'PENDING' | 'ESCALATED' | 'RESOLVED';
const TABS: { id: Tab; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'UNREAD', label: 'Unread' },
  { id: 'OPEN', label: 'Open' },
  { id: 'IN_PROGRESS', label: 'In progress' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'ESCALATED', label: 'Escalated' },
  { id: 'RESOLVED', label: 'Resolved' }
];
const inTab = (tab: Tab, t: SupportTicket, unread: number) => {
  switch (tab) {
    case 'UNREAD':
      return unread > 0;
    case 'OPEN':
      return t.status === 'OPEN';
    case 'IN_PROGRESS':
      return t.status === 'IN_PROGRESS';
    case 'PENDING':
      return t.status === 'WAITING_CUSTOMER';
    case 'ESCALATED':
      return isTicketOpen(t.status) && (t.status === 'ESCALATED' || t.escalationLevel !== 'RM');
    case 'RESOLVED':
      return !isTicketOpen(t.status);
    default:
      return true;
  }
};
const PAGE = 30;

export const TicketInbox: React.FC<{
  data: TicketData;
  people: Person[];
  manager: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}> = ({ data, people, manager, selectedId, onSelect }) => {
  const [tab, setTab] = useState<Tab>('ALL');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'activity' | 'created' | 'priority' | 'sla'>('activity');
  const [level, setLevel] = useState<TicketLevel | 'ALL'>('ALL');
  const [person, setPerson] = useState('ALL');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => setShown(PAGE), [tab, search, sort, level, person, overdueOnly]);

  const unread = useMemo(() => {
    const m = new Map<string, number>();
    data.tickets.forEach(t => m.set(t.id, unreadCount(t, data.updates, data.reads)));
    return m;
  }, [data.tickets, data.updates, data.reads]);
  const staffIds = useMemo(
    () =>
      [...new Set(data.tickets.flatMap(t => [t.assigneeId, t.escalatedTo, t.resolvedBy]).filter((x): x is string => !!x))].sort((a, b) =>
        personName(people, a).localeCompare(personName(people, b))
      ),
    [data.tickets, people]
  );

  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.tickets.filter(t => {
      if (level !== 'ALL' && (t.escalationLevel !== level || !isTicketOpen(t.status))) return false;
      if (person !== 'ALL' && t.assigneeId !== person && t.escalatedTo !== person && t.resolvedBy !== person) return false;
      if (overdueOnly && !isTicketOverdue(t)) return false;
      if (!q) return true;
      return [t.ticketNo, t.subject, t.customerName, t.customerCode, t.customerCompany || '', t.lastMessagePreview || ''].some(v => v.toLowerCase().includes(q));
    });
  }, [data.tickets, search, level, person, overdueOnly]);
  const counts = useMemo(() => Object.fromEntries(TABS.map(x => [x.id, base.filter(t => inTab(x.id, t, unread.get(t.id) || 0)).length])), [base, unread]);
  const list = useMemo(
    () =>
      base
        .filter(t => inTab(tab, t, unread.get(t.id) || 0))
        .sort((a, b) =>
          sort === 'priority'
            ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || lastActivity(b).localeCompare(lastActivity(a))
            : sort === 'created'
              ? b.createdAt.localeCompare(a.createdAt)
              : sort === 'sla'
                ? (a.slaDueAt || '9999').localeCompare(b.slaDueAt || '9999') || lastActivity(b).localeCompare(lastActivity(a))
                : lastActivity(b).localeCompare(lastActivity(a))
        ),
    [base, tab, sort, unread]
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 space-y-2.5 border-b border-slate-100">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tickets, customers, messages"
            aria-label="Search tickets"
            className={`${inputClass} pl-9`}
          />
        </div>
        <div className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-0.5" role="tablist" aria-label="Ticket filters">
          {TABS.map(x => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => setTab(x.id)}
              className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold transition ${
                tab === x.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {x.label}
              <span className={`ml-1 ${tab === x.id ? 'text-white/70' : 'text-slate-400'}`}>{counts[x.id]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={sort} onChange={e => setSort(e.target.value as any)} aria-label="Sort tickets" className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
            <option value="activity">Last activity</option>
            <option value="created">Newest</option>
            <option value="priority">Priority</option>
            <option value="sla">SLA deadline</option>
          </select>
          {manager && (
            <>
              <select value={level} onChange={e => setLevel(e.target.value as any)} aria-label="Filter by level" className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                <option value="ALL">Any level</option>
                {(Object.keys(TICKET_LEVEL_LABELS) as TicketLevel[]).map(l => (
                  <option key={l} value={l}>
                    With {TICKET_LEVEL_LABELS[l]}
                  </option>
                ))}
              </select>
              <select value={person} onChange={e => setPerson(e.target.value)} aria-label="Filter by team member" className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white max-w-[9rem]">
                <option value="ALL">Everyone</option>
                {staffIds.map(id => (
                  <option key={id} value={id}>
                    {personName(people, id)}
                  </option>
                ))}
              </select>
            </>
          )}
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} className="rounded border-slate-300" />
            Overdue
          </label>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" aria-label="Tickets">
        {data.loading && data.tickets.length === 0 ? (
          <div className="p-3 space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-semibold text-slate-700">{data.tickets.length === 0 ? 'No tickets yet' : 'Nothing here'}</p>
            <p className="text-xs text-slate-500 mt-1">{data.tickets.length === 0 ? 'Customer tickets you can see appear here.' : 'Try another filter or search.'}</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.slice(0, shown).map(t => {
              const n = unread.get(t.id) || 0;
              const active = t.id === selectedId;
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(t.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full text-left px-3 py-3 flex gap-3 transition ${active ? 'bg-blue-50/80' : 'hover:bg-slate-50'}`}
                  >
                    <span className="relative shrink-0 w-9 h-9 rounded-full bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center" aria-hidden="true">
                      {initials(t.customerName)}
                      {isTicketOverdue(t) && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-rose-600 ring-2 ring-white" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-sm ${n ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
                          {t.customerName}
                          {t.customerCompany && <span className="font-normal text-slate-400"> · {t.customerCompany}</span>}
                        </span>
                        <span className={`shrink-0 text-[11px] ${n ? 'text-blue-700 font-semibold' : 'text-slate-400'}`}>{timeShort(lastActivity(t))}</span>
                      </span>
                      <span className="block truncate text-xs text-slate-700 mt-0.5">
                        <span className="font-mono text-[10px] text-slate-400 mr-1">{t.ticketNo}</span>
                        {t.subject}
                      </span>
                      <span className="flex items-center justify-between gap-2 mt-0.5">
                        <span className={`truncate text-xs ${n ? 'text-slate-800' : 'text-slate-500'}`}>
                          {t.lastMessagePreview ? (
                            <>
                              {t.lastMessageFrom === 'STAFF' && <span className="text-slate-400">You: </span>}
                              {t.lastMessagePreview}
                            </>
                          ) : (
                            <span className="italic text-slate-400">{t.description || 'No messages yet'}</span>
                          )}
                        </span>
                        {n > 0 && (
                          <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center" aria-label={`${n} unread`}>
                            {n}
                          </span>
                        )}
                      </span>
                      <span className="flex flex-wrap items-center gap-1 mt-1.5">
                        <TicketStatusPill status={t.status} />
                        {(t.priority === 'HIGH' || t.priority === 'URGENT') && <TicketPriorityPill priority={t.priority} />}
                        <TicketFlags ticket={t} />
                        <span className="text-[10px] text-slate-400 truncate">
                          RM {personName(people, t.assigneeId)}
                          {t.escalationLevel !== 'RM' && isTicketOpen(t.status) ? ` · with ${personName(people, t.escalatedTo)}` : ''}
                        </span>
                      </span>
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
// Conversation
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
      out.push({ type: 'event', id: u.id, text: `Assigned to ${personName(people, u.assigneeId)}`, detail: u.authorId ? `by ${who}` : u.note, at: u.createdAt, tone: 'neutral' });
    } else if (u.kind === 'ESCALATED') {
      out.push({ type: 'event', id: u.id, text: u.note?.split(':')[0] || 'Escalated', detail: u.note?.includes(':') ? u.note.slice(u.note.indexOf(':') + 1).trim() : null, at: u.createdAt, tone: 'warn' });
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

export const TicketConversation: React.FC<{
  ticket: SupportTicket;
  data: TicketData;
  people: Person[];
  canWrite: boolean;
  onBack?: () => void;
  onToggleInfo?: () => void;
}> = ({ ticket, data, people, canWrite, onBack, onToggleInfo }) => {
  const { profile } = useAuth();
  const history = useMemo(() => data.updates.filter(u => u.ticketId === ticket.id), [data.updates, ticket.id]);
  const entries = useMemo(() => buildEntries(ticket, history, people, profile?.id), [ticket, history, people, profile?.id]);
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(false);
  const unread = unreadCount(ticket, data.updates, data.reads);
  const customerConversation = !ticket.createdBy;

  // Drop pending bubbles once the stored message arrives (Realtime / reload).
  useEffect(() => {
    const stored = new Set(history.map(u => u.clientMsgId).filter(Boolean));
    setPending(p => p.filter(x => !stored.has(x.key)));
  }, [history]);
  // A new ticket: fresh composer, scroll to the latest message.
  useEffect(() => {
    setText('');
    setPending([]);
    setInternal(!customerConversation);
  }, [ticket.id, customerConversation]);
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
    const p: Pending = { key: newKey(), text: body, internal: internal || !customerConversation, state: 'sending' };
    setPending(list => [...list, p]);
    setText('');
    setAtBottom(true);
    void deliver(p);
  };

  const owner = handlerId(ticket);
  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-start gap-2 px-4 py-3 border-b border-slate-100">
        {onBack && (
          <button type="button" onClick={onBack} className="lg:hidden p-1.5 -ml-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Back to tickets">
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="font-mono font-bold text-blue-700">{ticket.ticketNo}</span>
            <span>·</span>
            <span className="truncate">
              {ticket.customerName}
              {ticket.customerCompany ? ` · ${ticket.customerCompany}` : ''}
            </span>
          </div>
          <h2 className="text-base font-bold text-slate-900 truncate">{ticket.subject}</h2>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            <TicketStatusPill status={ticket.status} />
            <TicketPriorityPill priority={ticket.priority} />
            <TicketFlags ticket={ticket} />
            <span className="text-[11px] text-slate-500">
              {isTicketOpen(ticket.status) ? `${TICKET_LEVEL_LABELS[ticket.escalationLevel]}: ${personName(people, owner)}` : `RM: ${personName(people, ticket.assigneeId)}`}
            </span>
          </div>
        </div>
        {onToggleInfo && (
          <button type="button" onClick={onToggleInfo} className="xl:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Ticket details">
            <Info className="w-4 h-4" />
          </button>
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
        className="relative flex-1 min-h-0 overflow-y-auto bg-slate-50/60 px-4 py-4 space-y-2"
        aria-live="polite"
        aria-label="Conversation"
      >
        {entries.length === 0 && <p className="text-center text-xs text-slate-400 py-10">No messages yet.</p>}
        {entries.map(e =>
          e.type === 'day' ? (
            <div key={e.id} className="flex justify-center py-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-white border border-slate-200 rounded-full px-2.5 py-0.5">{e.label}</span>
            </div>
          ) : e.type === 'event' ? (
            <div key={e.id} className="flex flex-col items-center py-0.5 text-center">
              <span
                className={`text-[11px] rounded-full px-2.5 py-0.5 ${
                  e.tone === 'warn' ? 'bg-rose-50 text-rose-700' : e.tone === 'good' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {e.text} · {clock(e.at)}
              </span>
              {e.detail && <span className="text-[11px] text-slate-500 mt-0.5 max-w-md whitespace-pre-line">{e.detail}</span>}
            </div>
          ) : (
            <div key={e.id} className={`flex ${e.side === 'customer' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[85%] sm:max-w-[70%] ${e.side === 'customer' ? '' : 'text-right'}`}>
                <div className="text-[10px] text-slate-400 mb-0.5 px-1">
                  <span className="font-semibold text-slate-600">{e.mine ? 'You' : e.name}</span>
                  {e.role && <span> · {e.role}</span>}
                  {e.side === 'note' && (
                    <span className="inline-flex items-center gap-0.5 ml-1 text-amber-700">
                      <Lock className="w-2.5 h-2.5" aria-hidden="true" /> Internal note
                    </span>
                  )}
                </div>
                <div
                  className={`inline-block text-left text-sm whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 ${
                    e.side === 'customer'
                      ? 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'
                      : e.side === 'note'
                        ? 'bg-amber-50 border border-amber-200 text-amber-900 rounded-tr-sm'
                        : 'bg-blue-600 text-white rounded-tr-sm'
                  }`}
                >
                  {e.text}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 px-1 inline-flex items-center gap-1">
                  {clock(e.at)}
                  {e.seen !== undefined &&
                    (e.seen ? (
                      <span className="inline-flex items-center gap-0.5 text-blue-600" title="Seen by the customer">
                        <CheckCheck className="w-3 h-3" aria-hidden="true" /> Seen
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5" title="Delivered">
                        <Check className="w-3 h-3" aria-hidden="true" /> Sent
                      </span>
                    ))}
                </div>
              </div>
            </div>
          )
        )}
        {pending.map(p => (
          <div key={p.key} className="flex justify-end">
            <div className="max-w-[85%] sm:max-w-[70%] text-right">
              <div
                className={`inline-block text-left text-sm whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm px-3.5 py-2 ${
                  p.internal ? 'bg-amber-50 border border-amber-200 text-amber-900' : 'bg-blue-600 text-white'
                } ${p.state === 'sending' ? 'opacity-60' : ''} ${p.state === 'failed' ? 'ring-2 ring-rose-400' : ''}`}
              >
                {p.text}
              </div>
              <div className="text-[10px] mt-0.5 px-1">
                {p.state === 'sending' ? (
                  <span className="text-slate-400">Sending…</span>
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

      {canWrite ? (
        ticket.status === 'CLOSED' && !internal ? (
          <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 flex items-center justify-between gap-2">
            This ticket is closed. Reopen it to reply to the customer.
            <button type="button" onClick={() => setInternal(true)} className="font-semibold text-amber-700 hover:underline">
              Add an internal note
            </button>
          </div>
        ) : (
          <form
            className="border-t border-slate-100 p-3 bg-white"
            onSubmit={e => {
              e.preventDefault();
              send();
            }}
          >
            {customerConversation && (
              <div className="flex gap-1 mb-2" role="radiogroup" aria-label="Message type">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!internal}
                  onClick={() => setInternal(false)}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold ${!internal ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                  Reply to customer
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={internal}
                  onClick={() => setInternal(true)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${internal ? 'bg-amber-50 text-amber-800' : 'text-slate-500 hover:bg-slate-100'}`}
                >
                  <Lock className="w-3 h-3" aria-hidden="true" /> Internal note
                </button>
              </div>
            )}
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
                className={`${inputClass} resize-none max-h-40 ${internal ? 'bg-amber-50/40 border-amber-200' : ''}`}
              />
              <button
                type="submit"
                disabled={!text.trim()}
                className={`shrink-0 h-10 w-10 rounded-xl flex items-center justify-center text-white disabled:opacity-40 ${internal ? 'bg-amber-600 hover:bg-amber-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                aria-label="Send"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Enter to send, Shift+Enter for a new line.</p>
          </form>
        )
      ) : (
        <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">You are viewing this conversation. Only the people handling the ticket can write here.</div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Details and actions
// ---------------------------------------------------------------------------
export const TicketInfoPanel: React.FC<{
  ticket: SupportTicket;
  data: TicketData;
  people: Person[];
  canAct: boolean;
  canManage: boolean;
  onClose?: () => void;
  onOpenCustomer?: (customerId: string) => void;
}> = ({ ticket, data, people, canAct, canManage, onClose, onOpenCustomer }) => {
  const [panel, setPanel] = useState<null | 'status' | 'escalate' | 'assign'>(null);
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [resolution, setResolution] = useState('');
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    setPanel(null);
    setError(null);
    setDone(null);
    setNote('');
    setResolution('');
  }, [ticket.id]);
  useEffect(() => setStatus(ticket.status), [ticket.status]);

  const nextLevel: TicketLevel | null = ticket.escalationLevel === 'RM' ? 'TL' : ticket.escalationLevel === 'TL' ? 'DH' : null;
  const escalations = data.updates.filter(u => u.ticketId === ticket.id && u.kind === 'ESCALATED');
  const teamPeople = people.filter(p => (p.role === 'TEAM_MEMBER' || p.role === 'TEAM_HEAD') && p.status === 'ACTIVE' && p.teamId === ticket.teamId);
  const open = isTicketOpen(ticket.status);

  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      await data.reload();
      setPanel(null);
      setNote('');
      setResolution('');
      setDone(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the change.');
    } finally {
      setBusy(false);
    }
  };

  const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex justify-between gap-3 py-1.5 text-xs">
      <dt className="text-slate-500 shrink-0">{label}</dt>
      <dd className="text-slate-800 font-medium text-right min-w-0 break-words">{children}</dd>
    </div>
  );

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-900">Details</h3>
        {onClose && (
          <button type="button" onClick={onClose} className="xl:hidden p-1 rounded text-slate-400 hover:text-slate-700" aria-label="Close details">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="p-4 space-y-5">
        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Customer</h4>
          <dl className="divide-y divide-slate-50">
            <Row label="Name">
              {onOpenCustomer ? (
                <button type="button" className="text-blue-700 hover:underline" onClick={() => onOpenCustomer(ticket.customerId)}>
                  {ticket.customerName}
                </button>
              ) : (
                ticket.customerName
              )}
            </Row>
            {ticket.customerCompany && <Row label="Company">{ticket.customerCompany}</Row>}
            <Row label="Customer ID">
              <span className="font-mono">{ticket.customerCode}</span>
            </Row>
            {ticket.customerPhone && <Row label="Phone">{ticket.customerPhone}</Row>}
            {ticket.customerEmail && <Row label="E-mail">{ticket.customerEmail}</Row>}
          </dl>
        </section>

        <section>
          <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Ticket</h4>
          <dl className="divide-y divide-slate-50">
            <Row label="Status">
              <TicketStatusPill status={ticket.status} />
            </Row>
            <Row label="Priority">{TICKET_PRIORITY_LABELS[ticket.priority]}</Row>
            <Row label="Category">{TICKET_CATEGORY_LABELS[ticket.category]}</Row>
            <Row label="Relationship Manager">{personName(people, ticket.assigneeId)}</Row>
            {open && (
              <Row label="Handled by">
                <span className={ticket.escalationLevel === 'RM' ? '' : 'text-rose-700'}>
                  {personName(people, handlerId(ticket))} ({TICKET_LEVEL_LABELS[ticket.escalationLevel]})
                </span>
              </Row>
            )}
            {open && (
              <Row label="Reply due">
                <span className={`inline-flex items-center gap-1 ${isTicketOverdue(ticket) ? 'text-rose-700 font-bold' : ''}`}>
                  <Clock className="w-3 h-3" aria-hidden="true" />
                  {ticket.slaDueAt ? slaText(ticket.slaDueAt) : isAwaitingReply(ticket) ? 'No deadline' : 'Nobody waiting'}
                </span>
              </Row>
            )}
            <Row label="Created">{fmtWhen(ticket.createdAt)}</Row>
            <Row label="Last activity">{fmtWhen(lastActivity(ticket))}</Row>
            {(ticket.resolvedBy || ticket.resolvedAt) && (
              <Row label="Resolved">
                {ticket.resolvedBy ? personName(people, ticket.resolvedBy) : '-'}
                <span className="block text-[10px] text-slate-400 font-normal">{fmtWhen(ticket.resolvedAt)}</span>
              </Row>
            )}
          </dl>
          {ticket.resolutionNotes && <p className="mt-2 text-xs text-emerald-800 bg-emerald-50 rounded-lg p-2.5 whitespace-pre-line">{ticket.resolutionNotes}</p>}
        </section>

        {escalations.length > 0 && (
          <section>
            <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Escalation history</h4>
            <ol className="space-y-2 border-l border-rose-200 pl-3">
              {escalations.map(u => (
                <li key={u.id} className="text-xs">
                  <div className="font-semibold text-slate-800">{u.note?.split(':')[0]}</div>
                  <div className="text-slate-500">
                    {u.authorId ? `by ${personName(people, u.authorId)}` : 'Automatic (SLA)'} · {fmtWhen(u.createdAt)}
                  </div>
                  {u.note?.includes(':') && <div className="text-slate-600 mt-0.5">{u.note.slice(u.note.indexOf(':') + 1).trim()}</div>}
                </li>
              ))}
            </ol>
          </section>
        )}

        {canAct && (
          <section className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Actions</h4>
            <div className="flex flex-wrap gap-2">
              {open ? (
                <>
                  <button type="button" onClick={() => { setStatus('RESOLVED'); setPanel('status'); }} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700">
                    Resolve
                  </button>
                  <button type="button" onClick={() => setPanel(panel === 'status' ? null : 'status')} className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    Change status
                  </button>
                  {nextLevel && (
                    <button type="button" onClick={() => setPanel(panel === 'escalate' ? null : 'escalate')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 text-xs font-semibold text-rose-700 hover:bg-rose-50">
                      <ArrowUpCircle className="w-3.5 h-3.5" aria-hidden="true" /> Escalate
                    </button>
                  )}
                  {canManage && (
                    <button type="button" onClick={() => setPanel(panel === 'assign' ? null : 'assign')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                      <UserCog className="w-3.5 h-3.5" aria-hidden="true" /> Reassign
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy || (ticket.status === 'CLOSED' && !canManage)}
                  onClick={() => void run(() => ticketApi.update(ticket.id, { status: 'OPEN', note: 'Reopened' }), 'Ticket reopened.')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Reopen
                </button>
              )}
            </div>

            {panel === 'status' && (
              <form
                className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2.5"
                onSubmit={e => {
                  e.preventDefault();
                  void run(() => ticketApi.update(ticket.id, { status, note, resolution }), 'Status saved.');
                }}
              >
                <FormField label="Status" htmlFor="ti-status">
                  <select id="ti-status" value={status} onChange={e => setStatus(e.target.value as TicketStatus)} className={inputClass}>
                    {(Object.keys(TICKET_STATUS_LABELS) as TicketStatus[])
                      .filter(s => s !== 'ESCALATED' && (s !== 'CLOSED' || canManage))
                      .map(s => (
                        <option key={s} value={s}>
                          {TICKET_STATUS_LABELS[s]}
                        </option>
                      ))}
                  </select>
                </FormField>
                {(status === 'RESOLVED' || status === 'CLOSED') && (
                  <FormField label="Resolution notes" htmlFor="ti-res" required={!ticket.resolutionNotes}>
                    <textarea id="ti-res" rows={2} value={resolution} onChange={e => setResolution(e.target.value)} maxLength={4000} className={inputClass} placeholder="How was it resolved?" />
                  </FormField>
                )}
                <FormField label="Internal note (optional)" htmlFor="ti-note">
                  <textarea id="ti-note" rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={4000} className={inputClass} />
                </FormField>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setPanel(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600">
                    Cancel
                  </button>
                  <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-50">
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            )}

            {panel === 'escalate' && nextLevel && (
              <form
                className="p-3 rounded-xl border border-rose-200 bg-rose-50/40 space-y-2.5"
                onSubmit={e => {
                  e.preventDefault();
                  if (!note.trim()) return setError('Give the reason for escalating.');
                  void run(() => ticketApi.escalate(ticket.id, note.trim()), `Escalated to the ${TICKET_LEVEL_LABELS[nextLevel]}.`);
                }}
              >
                <FormField label={`Reason for escalating to the ${TICKET_LEVEL_LABELS[nextLevel]}`} htmlFor="ti-esc" required>
                  <textarea id="ti-esc" rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={4000} className={inputClass} />
                </FormField>
                <p className="text-[11px] text-slate-500">The Relationship Manager stays on the ticket and keeps getting updates.</p>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setPanel(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600">
                    Cancel
                  </button>
                  <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold disabled:opacity-50">
                    {busy ? 'Escalating…' : 'Escalate'}
                  </button>
                </div>
              </form>
            )}

            {panel === 'assign' && canManage && (
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
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
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setPanel(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy || !assignee}
                    onClick={() => void run(() => ticketApi.assign(ticket.id, assignee), 'Ticket reassigned.')}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold disabled:opacity-40"
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
          </section>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// The workspace: inbox | conversation | details (collapses on small screens)
// ---------------------------------------------------------------------------
export const TicketWorkspace: React.FC<{
  data: TicketData;
  people: Person[];
  manager: boolean;
  onOpenCustomer?: (customerId: string) => void;
}> = ({ data, people, manager, onOpenCustomer }) => {
  const { profile } = useAuth();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const ticket = data.tickets.find(t => t.id === selectedId) || null;
  const managerRole = profile?.role === 'TEAM_HEAD' || profile?.role === 'DEPARTMENT_HEAD' || profile?.role === 'SUPER_ADMIN';
  const canAct = !!ticket && (managerRole || ticket.assigneeId === profile?.id || ticket.escalatedTo === profile?.id);

  return (
    <div className="relative bg-white rounded-2xl border border-slate-200/80 overflow-hidden h-[calc(100vh-11rem)] min-h-[520px] grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_300px]">
      <div className={`${ticket ? 'hidden lg:flex' : 'flex'} flex-col min-h-0 border-r border-slate-100`}>
        <TicketInbox data={data} people={people} manager={manager} selectedId={selectedId} onSelect={id => { setSelectedId(id); setInfoOpen(false); }} />
      </div>
      <div className={`${ticket ? 'flex' : 'hidden lg:flex'} flex-col min-h-0`}>
        {ticket ? (
          <TicketConversation ticket={ticket} data={data} people={people} canWrite={canAct} onBack={() => setSelectedId(null)} onToggleInfo={() => setInfoOpen(o => !o)} />
        ) : (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div>
              <p className="text-sm font-semibold text-slate-700">Select a ticket</p>
              <p className="text-xs text-slate-500 mt-1">The conversation with the customer opens here.</p>
            </div>
          </div>
        )}
      </div>
      {ticket && (
        <aside
          className={`${infoOpen ? 'flex' : 'hidden'} xl:flex flex-col min-h-0 border-l border-slate-100 bg-white absolute inset-y-0 right-0 w-full sm:w-80 z-10 shadow-xl xl:static xl:w-auto xl:shadow-none`}
          aria-label="Ticket details"
        >
          <TicketInfoPanel ticket={ticket} data={data} people={people} canAct={canAct} canManage={managerRole} onClose={() => setInfoOpen(false)} onOpenCustomer={onOpenCustomer} />
        </aside>
      )}
    </div>
  );
};
