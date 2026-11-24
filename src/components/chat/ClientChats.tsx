import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, Share2, Users } from 'lucide-react';
import type { ChatConversation, ChatDeskClient, ChatHandler, ChatMyClient, ClientSupportGroup } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { useAuth } from '../../context/AuthContext';
import { chatApi, staffTransport } from '../../lib/chat/api';
import { useChatLive } from '../../lib/chat/useChatLive';
import { Avatar, ConversationItem, Split } from './ChatBits';
import { ChatThread } from './ChatThread';
import { DESK_FILTERS, deskSub, filterDesk, handlerName, type DeskFilter } from './deskView';

/** Share this client with the people of the client's own team (Team Member, Team Lead, Meta Verifier). A notification only: the conversation is not copied or changed. */
const ShareWithTeam: React.FC<{ conversationId: string }> = ({ conversationId }) => {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<{ id: string; name: string; role: string }[] | null>(null);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!open || people) return;
    chatApi.clientTeam(conversationId).then(setPeople, e => setMsg({ ok: false, text: errorMessage(e) }));
  }, [open, people, conversationId]);
  const send = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await chatApi.escalate(conversationId, { targetId: target, note: note.trim() || null });
      setMsg({ ok: true, text: `Shared with ${r.sentTo}. They were notified.` }); setNote(''); setTarget('');
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }); } finally { setBusy(false); }
  };
  return (
    <div className="ch-locked" role="group" aria-label="Share this client with their team" style={{ borderTop: 0, borderBottom: '1px solid var(--ch-border)', display: 'block' }}>
      <button type="button" className="ch-btn" aria-expanded={open} onClick={() => setOpen(o => !o)}><Share2 size={13} aria-hidden /> Share with this client&apos;s team</button>
      {open && (
        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          {people && people.length === 0 ? <p>Nobody else is assigned to this client yet.</p> : (
            <>
              <label>Share with
                <select value={target} onChange={e => setTarget(e.target.value)} style={{ marginLeft: 6 }}>
                  <option value="">Choose…</option>
                  {(people ?? []).map(p => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
                </select>
              </label>
              <label>Note (optional)
                <input value={note} maxLength={500} onChange={e => setNote(e.target.value)} style={{ marginLeft: 6, width: '70%' }} />
              </label>
              <div><button type="button" className="ch-btn" disabled={!target || busy} onClick={() => void send()}>{busy ? 'Sending…' : 'Send'}</button></div>
            </>
          )}
          {msg && <p role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
        </div>
      )}
    </div>
  );
};

/** The customers this employee looks after (as Team Member or Team Lead), each with the shared chat the client sees. */
/**
 * The client's support group (20261230000500): the client, the assigned Relationship Manager and Team Lead, and the Support employees added to it.
 * The Team Lead (or a Support Department Head) names it and adds / removes people; everyone in it sees who is there. The database decides.
 */
const SupportGroupPanel: React.FC<{ customerId: string }> = ({ customerId }) => {
  const [g, setG] = useState<ClientSupportGroup | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = React.useCallback(() => { chatApi.supportGroup(customerId).then(x => { setG(x); setName(x.named ? x.name : ''); }, () => setG(null)); }, [customerId]);
  React.useEffect(load, [load]);
  if (!g) return null;
  const save = async (b: { name?: string | null; add?: string[]; remove?: string[] }, done: string) => {
    setBusy(true); setMsg(null);
    try { const x = await chatApi.saveSupportGroup(customerId, b); setG(x); setPick(''); setMsg({ ok: true, text: done }); }
    catch (e) { setMsg({ ok: false, text: errorMessage(e) }); }
    finally { setBusy(false); }
  };
  const people = [...g.assigned.map(a => `${a.name} (${a.role})`), ...g.members.filter(m => m.active).map(m => m.name)];
  return (
    <div className="ch-locked" role="group" aria-label="Support group" data-testid="support-group" style={{ borderTop: 0, borderBottom: '1px solid var(--ch-border)', display: 'block' }}>
      <button type="button" className="ch-btn" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Users size={14} aria-hidden /> {g.name} - {people.length + (g.client.hasLogin ? 1 : 0)} in the group
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <p>In the group: {g.client.hasLogin ? 'the client, ' : ''}{people.join(', ')}</p>
          {g.canManage && (
            <>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                <input aria-label="Group name" placeholder={g.name} maxLength={80} value={name} onChange={e => setName(e.target.value)} />
                <button type="button" className="ch-btn" disabled={busy || !name.trim()} onClick={() => void save({ name: name.trim() }, 'Group name saved.')}>Rename</button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                <select aria-label="Support employee to add" value={pick} onChange={e => setPick(e.target.value)}>
                  <option value="">Add a Support employee</option>
                  {(g.candidates ?? []).map(c => <option key={c.id} value={c.id}>{c.name}{c.team ? ` - ${c.team}` : ''}</option>)}
                </select>
                <button type="button" className="ch-btn" disabled={busy || !pick} onClick={() => void save({ add: [pick] }, 'Added to the group.')}>Add</button>
              </div>
              {g.members.length > 0 && (
                <ul style={{ marginTop: 6 }}>
                  {g.members.map(m => (
                    <li key={m.id}>{m.name}{m.active ? '' : ' (no longer has access)'}{' '}
                      <button type="button" className="ch-btn" disabled={busy} onClick={() => void save({ remove: [m.id] }, `${m.name} was removed.`)}>Remove</button></li>
                  ))}
                </ul>
              )}
            </>
          )}
          {msg && <p role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
        </div>
      )}
    </div>
  );
};

/**
 * Who is handling this client chat now (20270129000100). Information only: it never changes the Relationship Manager and nobody is locked out.
 * A colleague covering for the Relationship Manager can take it over; whoever replies is shown as handling it.
 */
const HandlingBar: React.FC<{ conversationId: string; handler: ChatHandler | null; rmName: string | null; covering: boolean; onChange: (h: ChatHandler | null) => void }> = ({ conversationId, handler, rmName, covering, onChange }) => {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const act = async (action: 'TAKE' | 'RELEASE') => {
    setBusy(true); setMsg('');
    try { onChange(await chatApi.setHandling(conversationId, action)); } catch (e) { setMsg(errorMessage(e)); } finally { setBusy(false); }
  };
  const who = handlerName(handler);
  return (
    <div className="ch-locked" role="group" aria-label="Who is handling this chat" data-testid="handling-bar" style={{ borderTop: 0, borderBottom: '1px solid var(--ch-border)', display: 'block' }}>
      <span data-testid="handling-text">
        {who ? <>Currently handling: <b>{who}</b></> : 'Nobody is handling this chat right now.'}
        {rmName ? <> &middot; Relationship Manager: <b>{rmName}</b></> : null}
      </span>{' '}
      {handler?.active && handler.me
        ? <button type="button" className="ch-btn" disabled={busy} onClick={() => void act('RELEASE')}>Release</button>
        : <button type="button" className="ch-btn" disabled={busy} onClick={() => void act('TAKE')}>{who ? 'Take over' : 'I am handling this'}</button>}
      {covering && <p style={{ margin: '4px 0 0' }}>You are covering this client. Your replies show your own name{rmName ? `; ${rmName} stays the Relationship Manager` : ''}.</p>}
      {msg && <p role="alert">{msg}</p>}
    </div>
  );
};

export const ClientChats: React.FC<{ active: boolean; onUnreadChange: () => void; initialCustomer?: string | null }> = ({ active, onUnreadChange, initialCustomer }) => {
  const [items, setItems] = useState<ChatMyClient[]>([]);
  // the shared Support desk (20270129000100): every client of the department, for Support employees covering for a colleague
  const [desk, setDesk] = useState<ChatDeskClient[]>([]);
  const [scope, setScope] = useState<'mine' | 'desk'>('mine');
  const [deskFilter, setDeskFilter] = useState<DeskFilter>('ALL');
  const [handler, setHandler] = useState<ChatHandler | null>(null);
  // the handler of the last conversation snapshot the server sent: a snapshot the thread only patched locally (a new message) carries the SAME object and says nothing new
  const seenHandler = React.useRef<ChatHandler | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [term, setTerm] = useState('');
  const [customerId, setCustomerId] = useState<string | null>(initialCustomer ?? null);
  const [conv, setConv] = useState<ChatConversation | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');

  const load = useCallback(() => {
    chatApi.myClients(term.trim() || undefined).then(
      list => { setItems(list); setError(''); setLoading(false); },
      e => { setError(errorMessage(e)); setLoading(false); }
    );
    // not everybody has a desk (the database returns an empty list); a failed call simply hides it
    chatApi.deskClients(term.trim() || undefined).then(setDesk, () => setDesk([]));
  }, [term]);
  useEffect(() => { const t = setTimeout(load, term ? 250 : 0); return () => clearTimeout(t); }, [load, term]);
  useChatLive(load, active);

  // choosing a customer opens (or creates) the one conversation for them
  useEffect(() => {
    setConv(null); setOpenError('');
    if (!customerId) return undefined;
    let live = true;
    setOpening(true);
    chatApi.customer(customerId).then(
      c => { if (live) { setConv(c); seenHandler.current = c.handler ?? null; setHandler(c.handler ?? null); setOpening(false); } },
      e => { if (live) { setOpenError(errorMessage(e)); setOpening(false); } }
    );
    return () => { live = false; };
  }, [customerId]);

  const { profile } = useAuth();
  const base = useMemo(() => (conv ? staffTransport(conv.id) : null), [conv?.id]);
  // whoever replies in the Relationship Manager channel becomes the one handling the chat (the database does the same); shown at once, the server stays the truth
  const transport = useMemo(() => (base ? {
    ...base,
    send: async (i: Parameters<typeof base.send>[0]) => {
      const m = await base.send(i);
      if (profile && (conv?.channel ?? 'RM') === 'RM') setHandler({ id: profile.id, name: profile.fullName, at: new Date().toISOString(), active: true, me: true });
      return m;
    }
  } : null), [base, profile?.id, conv?.channel]);
  const deskRow = desk.find(i => i.customerId === customerId) || null;
  const row: (ChatMyClient | ChatDeskClient) | null = items.find(i => i.customerId === customerId) || deskRow;

  const patch = useCallback((c: ChatConversation) => {
    setItems(list => list.map(x => (x.conversationId === c.id ? { ...x, unread: c.unread, lastMessageAt: c.lastMessageAt, lastMessagePreview: c.lastMessagePreview } : x)));
    setDesk(list => list.map(x => (x.conversationId === c.id ? { ...x, unread: c.unread, lastMessageAt: c.lastMessageAt, lastMessagePreview: c.lastMessagePreview } : x)));
    if ((c.handler ?? null) !== seenHandler.current) { seenHandler.current = c.handler ?? null; setHandler(c.handler ?? null); }
    onUnreadChange();
  }, [onUnreadChange]);

  const header = (c: ChatConversation | null) => {
    const cust = c?.customer || null;
    return (
      <div className="ch-head">
        <button type="button" className="ch-icon ch-back" onClick={() => setCustomerId(null)} aria-label="Back to customers">&larr;</button>
        <Avatar name={cust?.business || cust?.name || row?.business || '?'} />
        <div className="ch-head-main">
          <h2>{cust?.business || cust?.name || row?.business || 'Customer'}</h2>
          <p>{[cust?.name, cust?.code].filter(Boolean).join(' - ')}{row ? (row.role === 'Support desk' ? ' - shared Support desk' : ` - you are their ${row.role}`) : ''}</p>
        </div>
      </div>
    );
  };

  const deskShown = filterDesk(desk, deskFilter);
  const list = (
    <>
      {desk.length > 0 && (
        <div className="ch-tabs" role="tablist" aria-label="Which customers" style={{ borderBottom: '1px solid var(--ch-border)' }}>
          <button type="button" role="tab" className="ch-tab" aria-selected={scope === 'mine'} onClick={() => setScope('mine')}>My customers</button>
          <button type="button" role="tab" className="ch-tab" aria-selected={scope === 'desk'} data-testid="desk-tab" onClick={() => setScope('desk')}>Support desk ({desk.length})</button>
        </div>
      )}
      <div className="ch-search"><input type="search" value={term} onChange={e => setTerm(e.target.value)} placeholder={scope === 'desk' ? 'Search the Support desk' : 'Search your customers'} aria-label={scope === 'desk' ? 'Search the Support desk' : 'Search your customers'} /></div>
      {scope === 'desk' && desk.length > 0 && (
        <div role="group" aria-label="Filter the Support desk" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '4px 10px' }}>
          {DESK_FILTERS.map(f => <button key={f.id} type="button" className="ch-btn" aria-pressed={deskFilter === f.id} onClick={() => setDeskFilter(f.id)}>{f.label}</button>)}
        </div>
      )}
      {error ? (
        <div className="ch-list-empty" role="alert"><p>{error}</p><button type="button" className="ch-btn" onClick={load}><RefreshCw size={13} aria-hidden /> Try again</button></div>
      ) : loading ? (
        <div className="ch-list-empty" role="status"><Loader2 className="ch-spin" size={18} aria-hidden /></div>
      ) : scope === 'desk' && desk.length > 0 ? (
        deskShown.length === 0 ? (
          <div className="ch-list-empty"><p><b>No customers match</b></p><p>Try another filter or name.</p></div>
        ) : (
          <ul className="ch-list" aria-label="Support desk customers" data-testid="desk-list">
            {deskShown.map(i => (
              <ConversationItem key={i.customerId} selected={i.customerId === customerId} onClick={() => setCustomerId(i.customerId)}
                item={{ id: i.customerId, name: i.business || i.name, preview: i.lastMessagePreview || '', sub: deskSub(i), meta: deskSub(i), time: i.lastMessageAt, unread: i.unread }} />
            ))}
          </ul>
        )
      ) : items.length === 0 ? (
        <div className="ch-list-empty"><p><b>{term ? 'No customers match' : 'No customers yet'}</b></p><p>{term ? 'Try another name.' : 'Customers assigned to you as Team Member or Team Lead appear here.'}</p></div>
      ) : (
        <ul className="ch-list" aria-label="Customers">
          {items.map(i => (
            <ConversationItem key={i.customerId} selected={i.customerId === customerId} onClick={() => setCustomerId(i.customerId)}
              item={{ id: i.customerId, name: i.groupName || i.business || i.name, preview: i.lastMessagePreview || '', sub: `${i.name} - ${i.role}`, time: i.lastMessageAt, unread: i.unread }} />
          ))}
        </ul>
      )}
    </>
  );

  return (
    <Split
      open={Boolean(customerId)}
      list={list}
      empty={<div><p><b>Select a customer</b></p><p>The client sees this chat in their dashboard, together with the other person on their team.</p></div>}
      detail={opening ? (
        <div className="ch-state" role="status"><Loader2 className="ch-spin" size={22} aria-hidden /></div>
      ) : openError || !transport ? (
        <div className="ch-state" role="alert"><AlertCircle size={26} aria-hidden /><p>{openError || 'This chat could not be opened.'}</p><button type="button" className="ch-btn" onClick={() => setCustomerId(null)}>Back</button></div>
      ) : (
        <>
          {row && !row.hasLogin && <div className="ch-locked" role="note" style={{ borderTop: 0, borderBottom: '1px solid var(--ch-border)' }}><AlertCircle size={16} aria-hidden /> This customer has no dashboard login yet, so they cannot see messages until one is created.</div>}
          {conv && conv.access === 'STAFF' && (row?.channel ?? 'RM') === 'RM' && customerId && <SupportGroupPanel customerId={customerId} />}
          {conv && conv.access === 'STAFF' && (row?.channel ?? 'RM') === 'RM' && (
            <HandlingBar conversationId={conv.id} handler={handler} rmName={deskRow?.rm?.name ?? null} covering={row?.role === 'Support desk'} onChange={setHandler} />
          )}
          {conv && conv.access === 'STAFF' && <ShareWithTeam conversationId={conv.id} />}
          <ChatThread key={transport.key} transport={transport} active={active} header={header} onConversation={patch} showNames
            emptyTitle="No messages yet" emptyText="Write to the client. Your co-worker on this account will see the conversation too."
            readOnlyText={() => 'You can read this chat, but only the assigned Team Member and Team Lead can write in it.'} />
        </>
      )}
    />
  );
};
