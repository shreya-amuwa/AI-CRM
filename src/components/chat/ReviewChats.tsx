import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, Loader2, RefreshCw } from 'lucide-react';
import type { ChatConversation } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { chatApi, staffTransport } from '../../lib/chat/api';
import { useChatLive } from '../../lib/chat/useChatLive';
import { Avatar, ConversationItem, Split } from './ChatBits';
import { ChatThread } from './ChatThread';

const PAGE = 30;

/**
 * A Department Head reads the client chats of their own department. Read only: the database refuses a message from here, and
 * opening a chat is written to the audit log. The Head is never a member of the conversation.
 */
export const ReviewChats: React.FC<{ active: boolean }> = ({ active }) => {
  const [items, setItems] = useState<ChatConversation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback((upTo = page) => {
    chatApi.review(term.trim() || undefined, 1, PAGE * upTo).then(
      r => { setItems(r.items); setTotal(r.total); setError(''); setLoading(false); },
      e => { setError(errorMessage(e)); setLoading(false); }
    );
  }, [term, page]);
  useEffect(() => { const t = setTimeout(() => load(), term ? 250 : 0); return () => clearTimeout(t); }, [load, term]);
  useChatLive(() => load(), active);

  const current = items.find(c => c.id === selected) || null;
  const transport = useMemo(() => (selected ? staffTransport(selected, { review: true }) : null), [selected]);

  const header = (c: ChatConversation | null) => {
    const base = c || current;
    const cust = base?.customer;
    const tm = base?.team?.teamMember?.name;
    const tl = base?.team?.teamLead?.name;
    return (
      <div className="ch-head">
        <button type="button" className="ch-icon ch-back" onClick={() => setSelected(null)} aria-label="Back to conversations">&larr;</button>
        <Avatar name={cust?.business || cust?.name || '?'} />
        <div className="ch-head-main">
          <h2>{cust?.business || cust?.name || 'Client conversation'}</h2>
          <p>{[tm ? `Team Member: ${tm}` : null, tl ? `Team Lead: ${tl}` : null].filter(Boolean).join(' - ') || cust?.name}</p>
        </div>
        <span className="ch-chip"><Eye size={11} aria-hidden /> Review only</span>
      </div>
    );
  };

  const list = (
    <>
      <div className="ch-search"><input type="search" value={term} onChange={e => { setTerm(e.target.value); setPage(1); }} placeholder="Search by customer" aria-label="Search client conversations" /></div>
      {error ? (
        <div className="ch-list-empty" role="alert"><p>{error}</p><button type="button" className="ch-btn" onClick={() => load()}><RefreshCw size={13} aria-hidden /> Try again</button></div>
      ) : loading ? (
        <div className="ch-list-empty" role="status"><Loader2 className="ch-spin" size={18} aria-hidden /></div>
      ) : items.length === 0 ? (
        <div className="ch-list-empty"><p><b>{term ? 'No conversations match' : 'No client conversations yet'}</b></p><p>{term ? 'Try another customer.' : 'Conversations between your department\'s clients and their team appear here once they start.'}</p></div>
      ) : (
        <>
          <ul className="ch-list" aria-label="Client conversations">
            {items.map(c => (
              <ConversationItem key={c.id} selected={c.id === selected} onClick={() => setSelected(c.id)}
                item={{ id: c.id, name: c.customer?.business || c.customer?.name || 'Client', preview: c.lastMessagePreview || '', time: c.lastMessageAt, unread: 0 }} />
            ))}
            {items.length < total && (
              <li style={{ padding: 10, textAlign: 'center' }}><button type="button" className="ch-btn" onClick={() => { const n = page + 1; setPage(n); load(n); }}>Show more ({total - items.length} more)</button></li>
            )}
          </ul>
        </>
      )}
    </>
  );

  return (
    <Split
      open={Boolean(selected)}
      list={list}
      empty={<div><p><b>Client conversations</b></p><p>Pick one to read it. You can read but not write: the team member and team lead answer the client.</p></div>}
      detail={transport ? (
        <ChatThread key={transport.key} transport={transport} active={active} header={header} showNames
          emptyTitle="No messages yet" readOnlyText={() => 'Review only. You can read this conversation but not write in it. Opening it is recorded in the audit log.'} />
      ) : null}
    />
  );
};
