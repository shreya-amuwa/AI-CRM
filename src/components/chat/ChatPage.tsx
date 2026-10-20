import React, { useEffect, useState } from 'react';
import { chatApi } from '../../lib/chat/api';
import { useFillViewport } from '../../lib/chat/useFillViewport';
import type { ChatUnreadSummary } from '../../../shared/contracts';
import { ClientChats } from './ClientChats';
import { InternalChats } from './InternalChats';
import { ReviewChats } from './ReviewChats';
import { OPEN_CHAT_EVENT, takePendingChat, type ChatTab, type OpenChatDetail } from './chatEvents';
import './chat.css';

const Badge: React.FC<{ n: number }> = ({ n }) => (n > 0 ? <span className="ch-count" aria-label={`${n} unread`}>{n > 99 ? '99+' : n}</span> : null);

/**
 * The Chat page of every employee dashboard (a menu item, like any other page): the person's own chats, the clients they
 * look after, and, for Department Heads, the review of their department's client chats. It fills the content area.
 */
const ChatPage: React.FC<{ summary?: ChatUnreadSummary; refresh?: () => void }> = ({ summary, refresh }) => {
  const [initial, setInitial] = useState<OpenChatDetail>(() => takePendingChat() || {});
  const [tab, setTab] = useState<ChatTab>(initial.tab || (initial.customerId || initial.clientConversationId ? 'clients' : 'messages'));
  const [customerId, setCustomerId] = useState<string | null>(initial.customerId ?? null);
  const [resolved, setResolved] = useState(!initial.clientConversationId);
  const [hasClients, setHasClients] = useState(false);
  const [canReview, setCanReview] = useState(false);
  const [version, setVersion] = useState(0);
  const page = useFillViewport<HTMLDivElement>();

  // already on the page when a notification asks for a conversation
  useEffect(() => {
    const on = () => {
      const next = takePendingChat();
      if (!next) return;
      setInitial(next);
      setTab(next.tab || (next.customerId || next.clientConversationId ? 'clients' : 'messages'));
      setCustomerId(next.customerId ?? null);
      setResolved(!next.clientConversationId);
      setVersion(v => v + 1);
    };
    window.addEventListener(OPEN_CHAT_EVENT, on);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, on);
  }, []);

  // which tabs this person has: found out from the server (it decides, not the screen)
  useEffect(() => {
    let live = true;
    chatApi.myClients().then(l => { if (live) setHasClients(l.length > 0); }, () => undefined);
    chatApi.review(undefined, 1, 1).then(() => { if (live) setCanReview(true); }, () => undefined);
    return () => { live = false; };
  }, []);

  // a notification names the conversation; the customer is found by asking the server (which checks access)
  useEffect(() => {
    if (!initial.clientConversationId) return undefined;
    let live = true;
    chatApi.detail(initial.clientConversationId).then(
      c => {
        if (!live) return;
        if (c.customer?.id) { setCustomerId(c.customer.id); setHasClients(true); setTab(c.access === 'REVIEWER' ? 'review' : 'clients'); }
        setResolved(true);
      },
      () => { if (live) { setTab('messages'); setResolved(true); } }
    );
    return () => { live = false; };
  }, [initial.clientConversationId, version]);

  const noop = () => undefined;
  const tabs: { id: ChatTab; label: string; n: number }[] = [
    { id: 'messages', label: 'Messages', n: summary?.internal ?? 0 },
    ...(hasClients ? [{ id: 'clients' as ChatTab, label: 'My clients', n: summary?.clients ?? 0 }] : []),
    ...(canReview ? [{ id: 'review' as ChatTab, label: 'Client conversations', n: 0 }] : [])
  ];

  return (
    <div className="ch-page" aria-label="Chat" ref={page}>
      {tabs.length > 1 && (
        <div className="ch-tabs" role="tablist" aria-label="Chat sections">
          {tabs.map(t => (
            <button key={t.id} type="button" role="tab" className="ch-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label} <Badge n={t.n} /></button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'messages' && <InternalChats key={`m${version}`} active initialId={initial.conversationId} onUnreadChange={refresh || noop} />}
        {tab === 'clients' && resolved && <ClientChats key={`c${version}`} active initialCustomer={customerId} onUnreadChange={refresh || noop} />}
        {tab === 'review' && canReview && <ReviewChats active />}
      </div>
    </div>
  );
};

export default ChatPage;
