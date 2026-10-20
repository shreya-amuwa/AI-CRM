import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, X } from 'lucide-react';
import { chatApi } from '../../lib/chat/api';
import { ClientChats } from './ClientChats';
import { InternalChats } from './InternalChats';
import { ReviewChats } from './ReviewChats';
import { type OpenChatDetail } from './chatEvents';
import './chat.css';

type Tab = 'messages' | 'clients' | 'review';

const Badge: React.FC<{ n: number }> = ({ n }) => (n > 0 ? <span className="ch-count" aria-label={`${n} unread`}>{n > 99 ? '99+' : n}</span> : null);

/** Full-screen chat for employees: their own chats, the clients they look after, and (Department Heads) the review of client chats. */
const ChatCenter: React.FC<{ onClose: () => void; initial: OpenChatDetail; summary: { internal: number; clients: number; review: number }; refresh: () => void }> = ({ onClose, initial, summary, refresh }) => {
  const [tab, setTab] = useState<Tab>(initial.tab || (initial.customerId || initial.clientConversationId ? 'clients' : 'messages'));
  const [customerId, setCustomerId] = useState<string | null>(initial.customerId ?? null);
  const [resolved, setResolved] = useState(!initial.clientConversationId);
  const [hasClients, setHasClients] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // which tabs this person has: found out from the server (it decides, not the screen)
  useEffect(() => {
    let live = true;
    chatApi.myClients().then(l => { if (live) setHasClients(l.length > 0 || Boolean(initial.customerId)); }, () => undefined);
    chatApi.review(undefined, 1, 1).then(() => { if (live) setCanReview(true); }, () => undefined);
    return () => { live = false; };
  }, [initial.customerId]);

  // a notification names the conversation; the customer is found by asking the server (which checks access)
  useEffect(() => {
    if (!initial.clientConversationId) return undefined;
    let live = true;
    chatApi.detail(initial.clientConversationId).then(
      c => { if (live) { if (c.customer?.id) { setCustomerId(c.customer.id); setHasClients(true); setTab(c.access === 'REVIEWER' ? 'review' : 'clients'); } setResolved(true); } },
      () => { if (live) { setTab('messages'); setResolved(true); } }
    );
    return () => { live = false; };
  }, [initial.clientConversationId]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: 'messages', label: 'Messages', n: summary.internal },
    ...(hasClients ? [{ id: 'clients' as Tab, label: 'My clients', n: summary.clients }] : []),
    ...(canReview ? [{ id: 'review' as Tab, label: 'Client conversations', n: 0 }] : [])
  ];

  return createPortal(
    <div className="ch-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ch-center" role="dialog" aria-modal="true" aria-label="Chat">
        <div className="ch-center-top">
          <MessageCircle size={20} aria-hidden />
          <h1>Chat</h1>
          <button ref={closeRef} type="button" className="ch-icon" onClick={onClose} aria-label="Close chat"><X size={18} /></button>
        </div>
        {tabs.length > 1 && (
          <div className="ch-tabs" role="tablist" aria-label="Chat sections">
            {tabs.map(t => (
              <button key={t.id} type="button" role="tab" className="ch-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label} <Badge n={t.n} /></button>
            ))}
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {tab === 'messages' && <InternalChats active initialId={initial.conversationId} onUnreadChange={refresh} />}
          {tab === 'clients' && hasClients && resolved && <ClientChats active initialCustomer={customerId} onUnreadChange={refresh} />}
          {tab === 'review' && canReview && <ReviewChats active />}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ChatCenter;
