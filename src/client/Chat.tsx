import React, { useCallback } from 'react';
import { ShieldCheck, Users } from 'lucide-react';
import type { ChatChannel, ChatConversation } from '../../shared/contracts';
import { ChatThread } from '../components/chat/ChatThread';
import { useFillViewport } from '../lib/chat/useFillViewport';
import { clientTransport } from '../lib/chat/api';
import { dashboardPath, useShell } from './shell';
import { initials } from './ui';

const who = (p: { name: string; position: string | null } | null | undefined) => (p ? p.name : null);

/**
 * The client's chat. Before Meta verification is completed they talk to their Meta Verifier; afterwards to their Relationship Manager
 * (and Team Lead). The Meta conversation is kept, readable and closed. The client only picks a channel: who answers is set by the server
 * from the customer's assignment, and a channel that is not open at this stage is refused there.
 */
export const Chat: React.FC = () => {
  const { refreshChatUnread, journey, sub, go } = useShell();
  // on a phone the dashboard has a tab bar fixed to the bottom of the window
  const card = useFillViewport<HTMLDivElement>(() => document.querySelector<HTMLElement>('.cd-tabbar')?.offsetHeight ?? 0);
  const onConversation = useCallback(() => refreshChatUnread(), [refreshChatUnread]);

  const info = journey.data?.chat;
  const visible = (info?.channels ?? []).filter(c => c.visible);
  const wanted = sub.toLowerCase() === 'meta' ? 'META' : sub.toLowerCase() === 'rm' ? 'RM' : null;
  const channel: ChatChannel = (wanted && visible.some(c => c.channel === wanted) ? wanted : info?.active) ?? 'RM';

  // the channel is decided by the server's journey answer: ask for no conversation before it is known
  if (!info) {
    return (
      <div className="cd-chat-page">
        <div className="cd-chat-card" ref={card} role="status" aria-label={journey.error ? 'Unavailable' : 'Loading'}>
          {journey.error ? <p className="cd-muted" style={{ padding: 24 }}>The chat could not be opened right now. Please try again in a moment.</p> : null}
        </div>
      </div>
    );
  }

  const header = (c: ChatConversation | null) => {
    if (channel === 'META') {
      const v = c?.verifier ?? info?.channels.find(x => x.channel === 'META')?.with ?? null;
      return (
        <div className="ch-head">
          <span className="ch-avatar group" aria-hidden><ShieldCheck size={18} /></span>
          <div className="ch-head-main">
            <h2>Meta verification</h2>
            <p>{c ? (v ? `${v.name}${v.position ? `, ${v.position}` : ''} (Meta Verifier)` : 'A Meta Verifier will be assigned to you soon') : 'Loading'}</p>
          </div>
          {v ? <span className="ch-avatar" style={{ width: 32, height: 32, fontSize: 11 }} aria-hidden>{initials(v.name)}</span> : null}
        </div>
      );
    }
    const tm = who(c?.team?.teamMember);
    const tl = who(c?.team?.teamLead);
    const names = [tm ? `${tm} (Relationship Manager)` : null, tl ? `${tl} (Team Lead)` : null].filter(Boolean).join(' and ');
    return (
      <div className="ch-head">
        <span className="ch-avatar group" aria-hidden><Users size={18} /></span>
        <div className="ch-head-main">
          <h2>Your Amuwa team</h2>
          <p>{c ? (names || 'A Relationship Manager will be assigned to you soon') : 'Loading'}</p>
        </div>
        {c?.team ? (
          <div style={{ display: 'flex' }} aria-hidden>
            {[c.team.teamMember, c.team.teamLead].filter(Boolean).map((p, i) => (
              <span key={i} className="ch-avatar" style={{ marginLeft: i ? -8 : 0, border: '2px solid var(--card, #fff)', width: 32, height: 32, fontSize: 11 }}>{initials(p!.name)}</span>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="cd-chat-page">
      {visible.length > 1 ? (
        <div className="cd-chat-tabs" role="tablist" aria-label="Conversations">
          {visible.map(c => (
            <button key={c.channel} role="tab" aria-selected={c.channel === channel} className="cd-chat-tab" onClick={() => go(dashboardPath('chat', `/${c.channel.toLowerCase()}`))}>
              {c.label}{!c.open && c.channel === 'META' ? <small> · closed</small> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className="cd-chat-card" ref={card}>
        <ChatThread
          transport={clientTransport(channel)}
          header={header}
          onConversation={onConversation}
          showNames
          emptyTitle="Start the conversation"
          emptyText={channel === 'META'
            ? 'Ask about your Meta verification or about the documents we need. Your Meta Verifier will reply here.'
            : 'Ask a question or share an update. Your Relationship Manager and Team Lead will reply here.'}
          readOnlyText={c => c.blockReason ?? (c.assigned === false ? 'Nobody has been assigned to this conversation yet.' : null)}
        />
      </div>
    </div>
  );
};
export default Chat;
