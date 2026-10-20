import React, { useCallback } from 'react';
import { Users } from 'lucide-react';
import type { ChatConversation } from '../../shared/contracts';
import { ChatThread } from '../components/chat/ChatThread';
import { useFillViewport } from '../lib/chat/useFillViewport';
import { clientTransport } from '../lib/chat/api';
import { initials } from './ui';
import { useShell } from './shell';

const who = (p: { name: string; position: string | null } | null | undefined) => (p ? p.name : null);

/** The client's chat with the Team Member and Team Lead who look after them. One shared conversation. */
export const Chat: React.FC = () => {
  const { refreshChatUnread } = useShell();
  // on a phone the dashboard has a tab bar fixed to the bottom of the window
  const card = useFillViewport<HTMLDivElement>(() => document.querySelector<HTMLElement>('.cd-tabbar')?.offsetHeight ?? 0);
  const onConversation = useCallback(() => refreshChatUnread(), [refreshChatUnread]);

  const header = (c: ChatConversation | null) => {
    const tm = who(c?.team?.teamMember);
    const tl = who(c?.team?.teamLead);
    const names = [tm ? `${tm} (Team Member)` : null, tl ? `${tl} (Team Lead)` : null].filter(Boolean).join(' and ');
    return (
      <div className="ch-head">
        <span className="ch-avatar group" aria-hidden><Users size={18} /></span>
        <div className="ch-head-main">
          <h2>Your Amuwa team</h2>
          <p>{c ? (names || 'A Team Member will be assigned to you soon') : 'Loading'}</p>
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
      <div className="cd-chat-card" ref={card}>
        <ChatThread
          transport={clientTransport}
          header={header}
          onConversation={onConversation}
          showNames
          emptyTitle="Start the conversation"
          emptyText="Ask a question or share an update. Your Team Member and Team Lead will reply here."
          readOnlyText={c => (c.assigned === false ? 'Your team has not been assigned yet. You will be able to write as soon as a Team Member is assigned.' : null)}
        />
      </div>
    </div>
  );
};
export default Chat;
