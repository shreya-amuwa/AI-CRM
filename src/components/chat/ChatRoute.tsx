import React, { Suspense, lazy } from 'react';
import { MessageCircle } from 'lucide-react';
import { chatApi } from '../../lib/chat/api';
import { useChatUnread } from '../../lib/chat/useChatUnread';

// the chat screens are only downloaded when somebody opens the Chat page
const ChatPage = lazy(() => import('./ChatPage'));

/** What every dashboard needs to offer Chat: the menu item, with its unread count. */
export const CHAT_NAV = { id: 'chat', label: 'Chat', icon: MessageCircle } as const;

/** The unread count for the Chat menu item (live; no timer). */
export function useChatNavBadge(): number {
  const { summary } = useChatUnread(chatApi.unread);
  return summary.internal + summary.clients;
}

/** The Chat page for a dashboard's content area. */
export const ChatRoute: React.FC = () => {
  const { summary, refresh } = useChatUnread(chatApi.unread);
  return (
    <Suspense fallback={<div role="status" className="p-8 text-sm text-slate-500">Loading chat</div>}>
      <ChatPage summary={summary} refresh={refresh} />
    </Suspense>
  );
};
