import { useEffect } from 'react';

export type ChatTab = 'messages' | 'clients' | 'review';
/** Other screens (a notification, a customer page) can open the chat page on a conversation. */
export const OPEN_CHAT_EVENT = 'crm:open-chat';
export interface OpenChatDetail {
  tab?: ChatTab;
  conversationId?: string;
  customerId?: string;
  /** A client chat known only by its conversation id (a notification): the chat finds the customer. */
  clientConversationId?: string;
  /** Open the conversation on this message (an @mention notification). */
  messageId?: string;
}

let pending: OpenChatDetail | null = null;

/** Ask the dashboard to show its Chat page, on a conversation when one is named. */
export const openChat = (detail: OpenChatDetail = {}) => {
  pending = detail;
  window.dispatchEvent(new CustomEvent<OpenChatDetail>(OPEN_CHAT_EVENT, { detail }));
};
/** The chat page takes what was asked for when it opens (once). */
export const takePendingChat = (): OpenChatDetail | null => {
  const p = pending;
  pending = null;
  return p;
};

/** For a dashboard: switch to its Chat page when something asks for it. */
export function useOpenChatRequest(show: () => void) {
  useEffect(() => {
    const on = () => show();
    window.addEventListener(OPEN_CHAT_EVENT, on);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, on);
  }, [show]);
}
