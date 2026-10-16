import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCheck, ChevronDown, LifeBuoy, Plus, RotateCcw, Send } from 'lucide-react';
import type { ClientTicket, ClientTicketMessage } from '../../shared/contracts';
import { clientApi } from './api';
import { useClientLive, useLoad } from './hooks';
import { errorMessage } from '../lib/api/client';
import { ago, displayTicketNo, newMessageKey, ticketNoSearchText } from '../lib/ticketFormat';
import { dashboardPath, useShell } from './shell';
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingBlock, Modal, PageHeader, TICKET_CATEGORIES, TICKET_LABEL, categoryLabel, fmtDateTime } from './ui';

const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const dayLabel = (iso: string) => {
  const d = new Date(iso); const now = new Date(); const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const PRIORITY: Record<string, string> = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' };
const isDone = (s: string) => s === 'RESOLVED' || s === 'CLOSED';

const inFilter = (f: Filter, t: ClientTicket) =>
  f === 'ALL' ? true : f === 'UNREAD' ? t.unread > 0 : f === 'ESCALATED' ? t.escalated && !isDone(t.status) : f === 'DONE' ? isDone(t.status) : !isDone(t.status);
type Filter = 'OPEN' | 'UNREAD' | 'ESCALATED' | 'DONE' | 'ALL';

/** Tickets: the client's inbox on the left, the conversation of the open ticket on the right (one at a time on phones). */
export const Tickets: React.FC = () => {
  const { sub, go } = useShell();
  const openId = sub ? sub.split('/')[0] : null;
  const q = useLoad(() => clientApi.tickets());
  const services = useLoad(() => clientApi.services());
  useClientLive(q.reload);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [search, setSearch] = useState('');
  const all = q.data ?? [];
  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    return all
      .filter(t => inFilter(filter, t))
      .filter(t => !s || ticketNoSearchText(t.ticketNo).includes(s) || [t.subject, t.lastMessage?.text ?? ''].some(v => v.toLowerCase().includes(s)))
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }, [all, filter, search]);
  const open = (id: string) => go(dashboardPath('tickets', `/${id}`));

  const header = <PageHeader title="Tickets" subtitle="Chat with our support team about anything you need. Only you can see your tickets." action={<Button onClick={() => setCreating(true)}><Plus size={18} /> New ticket</Button>} />;
  const modal = creating && <NewTicket services={services.data ?? []} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); q.reload(); open(id); }} />;

  if (q.loading && !q.data) return <>{header}<LoadingBlock rows={3} /></>;
  if (q.error && !q.data) return <>{header}<Card><ErrorState message={q.error} forbidden={q.forbidden} onRetry={q.reload} /></Card></>;
  if (all.length === 0 && !openId) {
    return (
      <>
        {header}
        <Card><EmptyState icon={<LifeBuoy size={24} />} title="No tickets yet" text="If something is not working or you have a question, raise a ticket and chat with our support team here."
          action={<Button small onClick={() => setCreating(true)}>Raise a ticket</Button>} /></Card>
        {modal}
      </>
    );
  }
  return (
    <>
      <div className={`cd-tk-head ${openId ? 'is-open' : ''}`}>{header}</div>
      <div className={`cd-tk ${openId ? 'is-open' : ''}`}>
        <section className="cd-tk-list" aria-label="Your tickets">
          <div className="cd-tk-tools">
            <input type="search" className="cd-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search your tickets" aria-label="Search your tickets" />
            <div className="cd-chips" role="group" aria-label="Filter tickets">
              {([['OPEN', 'All open'], ['UNREAD', 'Unread'], ['ESCALATED', 'Escalated'], ['DONE', 'Resolved'], ['ALL', 'All']] as const).map(([v, l]) => (
                <button key={v} className="cd-chip sm" aria-pressed={filter === v} onClick={() => setFilter(v)}>
                  {l} <span className="n">{all.filter(t => inFilter(v, t)).length}</span>
                </button>
              ))}
            </div>
          </div>
          <ul className="cd-tk-items">
            {list.length === 0 && <li className="cd-small cd-muted" style={{ padding: 20, textAlign: 'center' }}>No tickets match.</li>}
            {list.map(t => <TicketRow key={t.id} t={t} active={t.id === openId} onOpen={() => open(t.id)} />)}
          </ul>
        </section>
        <section className="cd-tk-chat" aria-label="Conversation">
          {openId ? <TicketChat key={openId} id={openId} onChanged={q.reload} onBack={() => go(dashboardPath('tickets'))} />
            : <div className="cd-tk-placeholder"><LifeBuoy size={28} /><p>Choose a ticket to see the conversation.</p></div>}
        </section>
      </div>
      {modal}
    </>
  );
};

/** Who is looking after the ticket, in the client's words. */
const ownerLine = (t: ClientTicket) => {
  if (isDone(t.status)) return t.relationshipManager ? `Handled by ${t.relationshipManager}` : 'Resolved';
  if (t.handledBy === 'DEPARTMENT_HEAD') return 'Our Department Head is working on this';
  if (t.handledBy === 'TEAM_LEAD') return 'Our Team Lead is working on this';
  return t.relationshipManager ? `${t.relationshipManager} is working on this` : 'Our team will pick this up shortly';
};
const initialsOf = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';

const TicketRow: React.FC<{ t: ClientTicket; active: boolean; onOpen: () => void }> = ({ t, active, onOpen }) => (
  <li>
    <button className={`cd-tk-item ${active ? 'active' : ''} ${t.unread ? 'unread' : ''}`} onClick={onOpen} aria-current={active ? 'true' : undefined}>
      <span className="top">
        <span className="id">{displayTicketNo(t.ticketNo)}</span>
        <span className="time">{ago(t.lastActivityAt)}</span>
      </span>
      <span className="subject">{t.subject}</span>
      <span className="preview">
        <span>{t.lastMessage ? `${t.lastMessage.from === 'CLIENT' ? 'You: ' : ''}${t.lastMessage.text}` : t.description}</span>
        {t.unread > 0 && <span className="count" aria-label={`${t.unread} unread`}>{t.unread}</span>}
      </span>
      <span className="badges">
        <Badge tone={TICKET_LABEL[t.status].tone}>{TICKET_LABEL[t.status].label}</Badge>
        <span className="cd-pill">{PRIORITY[t.priority] ?? t.priority}</span>
        <span className="cd-pill">{categoryLabel(t.category)}</span>
      </span>
      <span className="owner"><span className="av" aria-hidden="true">{initialsOf(t.relationshipManager ?? 'A')}</span>{ownerLine(t)}</span>
    </button>
  </li>
);

interface Pending { key: string; text: string; state: 'sending' | 'failed'; error?: string }

const TicketChat: React.FC<{ id: string; onChanged: () => void; onBack: () => void }> = ({ id, onChanged, onBack }) => {
  const q = useLoad(() => clientApi.ticket(id), [id]);
  useClientLive(q.reload, id);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [info, setInfo] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const t = q.data;
  const messages = t?.messages ?? [];

  // Opening the ticket (and every new reply that arrives while it is open) marks it read.
  const unread = t?.unread ?? 0;
  useEffect(() => {
    if (unread > 0 && document.visibilityState === 'visible') clientApi.ticketSeen(id).then(onChanged, () => { /* the badge is a convenience */ });
  }, [id, unread, onChanged]);
  // A stored message replaces its "sending" bubble.
  useEffect(() => {
    const stored = new Set(messages.map(m => m.clientMsgId).filter(Boolean));
    setPending(p => p.filter(x => !stored.has(x.key)));
  }, [messages]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending.length, t?.id]);

  const deliver = useCallback(async (p: Pending) => {
    setPending(l => l.map(x => (x.key === p.key ? { ...x, state: 'sending', error: undefined } : x)));
    try { await clientApi.sendTicketMessage(id, p.text, p.key); q.reload(); onChanged(); }
    catch (e) { setPending(l => l.map(x => (x.key === p.key ? { ...x, state: 'failed', error: errorMessage(e) } : x))); }
  }, [id, q, onChanged]);
  const send = () => {
    const body = text.trim();
    if (!body) return;
    const p: Pending = { key: newMessageKey(), text: body, state: 'sending' };
    setPending(l => [...l, p]); setText(''); atBottom.current = true;
    void deliver(p);
  };

  if (q.loading && !t) return <div style={{ padding: 20 }}><LoadingBlock rows={2} /></div>;
  if (q.error && !t) return <div style={{ padding: 20 }}><button className="cd-link cd-tk-back" onClick={onBack}><ArrowLeft size={16} /> All tickets</button><ErrorState message={q.forbidden ? 'This ticket was not found.' : q.error} onRetry={q.forbidden ? undefined : q.reload} /></div>;
  if (!t) return null;
  const closed = t.status === 'CLOSED';
  const level = t.handledBy === 'DEPARTMENT_HEAD' ? 2 : t.handledBy === 'TEAM_LEAD' ? 1 : 0;
  let day = '';
  const lastFromClient = t.lastMessage?.from === 'CLIENT';
  const banner: { tone: 'info' | 'attention' | 'success'; text: string } = isDone(t.status)
    ? { tone: 'success', text: t.resolution ? `Resolved: ${t.resolution}` : 'This ticket is resolved. Write below if it is not solved and we will reopen it.' }
    : t.status === 'WAITING_CUSTOMER'
      ? { tone: 'attention', text: 'We are waiting for your reply.' }
      : t.escalated
        ? { tone: 'info', text: `Escalated: ${t.handledBy === 'DEPARTMENT_HEAD' ? 'our Department Head' : 'our Team Lead'} is now looking after it${t.relationshipManager ? `, and ${t.relationshipManager} stays informed` : ''}.` }
        : t.relationshipManager
          ? { tone: 'info', text: lastFromClient ? `Waiting for ${t.relationshipManager} to respond.` : `${t.relationshipManager} is looking after your ticket.` }
          : { tone: 'info', text: 'Our support team will pick this up shortly.' };
  return (
    <div className="cd-chat">
      <header className="cd-chat-head">
        <button className="cd-link cd-tk-back" onClick={onBack} aria-label="All tickets"><ArrowLeft size={16} /></button>
        <div className="cd-chat-titles">
          <div className="cd-chat-idrow">
            <h2 className="cd-chat-id" title={t.ticketNo}>{displayTicketNo(t.ticketNo)}</h2>
            <Badge tone={TICKET_LABEL[t.status].tone}>{TICKET_LABEL[t.status].label}</Badge>
          </div>
          <p className="cd-chat-title">{t.subject}</p>
        </div>
        <button className="cd-link" onClick={() => setInfo(v => !v)} aria-expanded={info} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Details <ChevronDown size={14} style={{ transform: info ? 'rotate(180deg)' : undefined }} />
        </button>
      </header>
      <div className={`cd-banner ${banner.tone} cd-chat-banner`} role="status"><span>{banner.text}</span></div>
      <div className="cd-chat-chips">
        <span className="cd-pill">{categoryLabel(t.category)}</span>
        {t.serviceName && <span className="cd-pill">{t.serviceName}</span>}
        <span className="cd-pill">{PRIORITY[t.priority] ?? t.priority} priority</span>
        <span className="cd-pill">{t.relationshipManager ? `Your Relationship Manager: ${t.relationshipManager}` : 'Relationship Manager: being assigned'}</span>
      </div>
      {info && (
        <div className="cd-chat-info">
          <dl>
            <div><dt>Status</dt><dd>{TICKET_LABEL[t.status].label}</dd></div>
            <div><dt>Priority</dt><dd>{PRIORITY[t.priority] ?? t.priority}</dd></div>
            <div><dt>Relationship Manager</dt><dd>{t.relationshipManager ?? 'Being assigned'}</dd></div>
            <div><dt>Opened</dt><dd>{fmtDateTime(t.createdAt)}</dd></div>
            <div><dt>Last activity</dt><dd>{fmtDateTime(t.lastActivityAt)}</dd></div>
          </dl>
          {!isDone(t.status) && (
            <ol className="cd-steps" aria-label="Who is looking after your ticket">
              {['Relationship Manager', 'Team Lead', 'Department Head'].map((s, i) => <li key={s} className={i < level ? 'done' : i === level ? 'now' : ''}>{s}</li>)}
            </ol>
          )}
        </div>
      )}
      <div className="cd-chat-scroll" ref={scroller} aria-live="polite"
        onScroll={e => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
        {messages.map(m => {
          const d = new Date(m.at).toDateString();
          const sep = d !== day ? (day = d, <div className="cd-chat-day" key={`d-${m.id}`}><span>{dayLabel(m.at)}</span></div>) : null;
          return <React.Fragment key={m.id}>{sep}<Entry m={m} /></React.Fragment>;
        })}
        {pending.map(p => (
          <div key={p.key} className={`cd-msg me ${p.state}`}>
            <div className="bubble">
              <div className="who">You</div>
              <div className="txt">{p.text}</div>
              <div className="foot">
                {p.state === 'sending' ? 'Sending…' : (
                  <span className="failed">{p.error || 'Not sent.'} <button className="cd-link" onClick={() => void deliver(p)}><RotateCcw size={12} /> Retry</button></span>
                )}
              </div>
            </div>
          </div>
        ))}
        {messages.length === 0 && pending.length === 0 && <p className="cd-small cd-muted" style={{ textAlign: 'center' }}>Our support team will reply here.</p>}
      </div>

      {closed ? <div className="cd-banner attention cd-chat-banner">This ticket is closed. Please raise a new ticket if you need more help.</div> : (
        <form className="cd-composer" onSubmit={e => { e.preventDefault(); send(); }}>
          <textarea className="cd-textarea" rows={1} maxLength={4000} value={text} onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
            aria-label={t.status === 'RESOLVED' ? 'Not solved? Write to reopen the ticket' : 'Your message'}
            placeholder={t.status === 'RESOLVED' ? 'Not solved? Write here to reopen the ticket' : 'Write a message'} />
          <button type="submit" className="cd-btn cd-send" disabled={!text.trim()}><Send size={16} /> Send</button>
        </form>
      )}
    </div>
  );
};

const EVENT_TEXT = (m: ClientTicketMessage) => {
  switch (m.event) {
    case 'CREATED': return 'Ticket opened';
    case 'ASSIGNED': return m.author ? `${m.author} (${m.role ?? 'Relationship Manager'}) is looking after your ticket` : 'Ticket assigned';
    case 'ESCALATED': return `Escalated to ${m.role === 'Department Head' ? 'our Department Head' : 'a Team Lead'}`;
    case 'REOPENED': return 'Ticket reopened';
    case 'RESOLVED': return 'Ticket resolved';
    case 'CLOSED': return 'Ticket closed';
    default: return `Status: ${m.status ? TICKET_LABEL[m.status].label : '-'}`;
  }
};

const Entry: React.FC<{ m: ClientTicketMessage }> = ({ m }) => {
  if (m.kind === 'EVENT') return <div className="cd-chat-event"><span>{EVENT_TEXT(m)} · {clock(m.at)}</span>{m.event === 'CREATED' && m.text ? <p>{m.text}</p> : null}</div>;
  const mine = m.from === 'CLIENT';
  return (
    <div className={`cd-msg ${mine ? 'me' : 'them'}`}>
      <div className="bubble">
        <div className="who">{mine ? 'You' : m.author ?? 'Amuwa Support'}{!mine && m.role ? <span> · {m.role}</span> : null}</div>
        <div className="txt">{m.text}</div>
        <div className="foot">
          {clock(m.at)}
          {mine && (m.seen ? <span className="seen" aria-label="Seen"><CheckCheck size={14} /></span> : <span aria-label="Sent"><Check size={14} /></span>)}
        </div>
      </div>
    </div>
  );
};

const NewTicket: React.FC<{ services: { code: string; name: string }[]; onClose: () => void; onCreated: (id: string) => void }> = ({ services, onClose, onCreated }) => {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [serviceCode, setServiceCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (subject.trim().length < 3) { setError('Enter a subject (at least 3 characters).'); return; }
    if (description.trim().length < 5) { setError('Describe the problem (at least 5 characters).'); return; }
    setBusy(true); setError('');
    try { const t = await clientApi.createTicket({ subject: subject.trim(), description: description.trim(), category, serviceCode: serviceCode || null }); onCreated(t.id); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  return (
    <Modal title="New ticket" onClose={onClose}>
      <div className="cd-stack">
        <Field label="Subject" htmlFor="cd-t-subject"><input id="cd-t-subject" className="cd-input" maxLength={200} value={subject} onChange={e => setSubject(e.target.value)} placeholder="What do you need help with?" /></Field>
        <div className="cd-grid c2">
          <Field label="Category" htmlFor="cd-t-cat"><select id="cd-t-cat" className="cd-select" value={category} onChange={e => setCategory(e.target.value)}>{TICKET_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
          <Field label="Related service (optional)" htmlFor="cd-t-svc"><select id="cd-t-svc" className="cd-select" value={serviceCode} onChange={e => setServiceCode(e.target.value)}><option value="">Not about one service</option>{services.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field>
        </div>
        <Field label="Describe the problem" htmlFor="cd-t-desc"><textarea id="cd-t-desc" className="cd-textarea" maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Tell us what happened and what you expected." /></Field>
        {error && <div className="cd-banner danger" role="alert">{error}</div>}
        <div className="cd-row" style={{ justifyContent: 'flex-end' }}><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Submit ticket</Button></div>
      </div>
    </Modal>
  );
};

