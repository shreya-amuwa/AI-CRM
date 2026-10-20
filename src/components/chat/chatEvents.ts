export type ChatTab = 'messages' | 'clients' | 'review';
/** Other screens (a notification, a customer page) can open the chat on a conversation. */
export const OPEN_CHAT_EVENT = 'crm:open-chat';
export interface OpenChatDetail { tab?: ChatTab; conversationId?: string; customerId?: string;
  /** A client chat known only by its conversation id (a notification): the chat finds the customer. */
  clientConversationId?: string }
export const openChat = (detail: OpenChatDetail = {}) => window.dispatchEvent(new CustomEvent<OpenChatDetail>(OPEN_CHAT_EVENT, { detail }));

