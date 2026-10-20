import type {
  ChatAttachment, ChatClientView, ChatConversation, ChatDirectoryPerson, ChatMessage, ChatMessagePage, ChatMyClient, ChatReviewList,
  ChatUnreadSummary, ChatUploadTicket, ClientDocumentUrl
} from '../../../shared/contracts';
import { api } from '../api/client';

export interface SendInput {
  body: string;
  clientMsgId: string;
  replyTo?: string;
  attachmentIds: string[];
}
export interface UploadInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Everything one conversation screen needs, whoever is looking at it. A client's transport has no conversation id (the
 * server works it out from the login); an employee's names the conversation, and the server decides if they may.
 */
export interface ChatTransport {
  /** Stable key: the screen reloads when it changes. */
  key: string;
  open(limit: number): Promise<ChatClientView>;
  detail(): Promise<ChatConversation>;
  messages(q: { before?: number; after?: number; limit?: number }): Promise<ChatMessagePage>;
  send(i: SendInput): Promise<ChatMessage>;
  markRead(seq: number): Promise<unknown>;
  beginUpload(i: UploadInput): Promise<ChatUploadTicket>;
  completeUpload(id: string): Promise<ChatAttachment>;
  abortUpload(id: string): Promise<unknown>;
  attachmentUrl(id: string, action: 'view' | 'download'): Promise<ClientDocumentUrl>;
}

export const clientTransport: ChatTransport = {
  key: 'client',
  open: limit => api.get<ChatClientView>('/client/chat', { limit }),
  detail: async () => (await api.get<ChatClientView>('/client/chat', { limit: 1 })).conversation,
  messages: q => api.get<ChatMessagePage>('/client/chat/messages', q),
  send: i => api.post<ChatMessage>('/client/chat/messages', i),
  markRead: seq => api.post('/client/chat/read', { seq }),
  beginUpload: i => api.post<ChatUploadTicket>('/client/chat/uploads', i),
  completeUpload: id => api.post<ChatAttachment>(`/client/chat/uploads/${id}/complete`, {}),
  abortUpload: id => api.post(`/client/chat/uploads/${id}/abort`, {}),
  attachmentUrl: (id, action) => api.get<ClientDocumentUrl>(`/client/chat/attachments/${id}/url`, { action })
};

/** An employee's view of one conversation (a direct chat, a group, a customer's chat, or one under review). */
export function staffTransport(conversationId: string, opts: { review?: boolean } = {}): ChatTransport {
  const base = `/chat/conversations/${conversationId}`;
  return {
    key: `staff:${conversationId}`,
    open: async limit => {
      // Opening someone else's client chat as a reviewer is written to the audit log by the server.
      if (opts.review) await api.post(`${base}/review-open`, {});
      const [conversation, page] = await Promise.all([api.get<ChatConversation>(base), api.get<ChatMessagePage>(`${base}/messages`, { limit })]);
      return { conversation, page };
    },
    detail: () => api.get<ChatConversation>(base),
    messages: q => api.get<ChatMessagePage>(`${base}/messages`, q),
    send: i => api.post<ChatMessage>(`${base}/messages`, i),
    markRead: seq => api.post(`${base}/read`, { seq }),
    beginUpload: i => api.post<ChatUploadTicket>(`${base}/uploads`, i),
    completeUpload: id => api.post<ChatAttachment>(`/chat/uploads/${id}/complete`, {}),
    abortUpload: id => api.post(`/chat/uploads/${id}/abort`, {}),
    attachmentUrl: (id, action) => api.get<ClientDocumentUrl>(`/chat/attachments/${id}/url`, { action })
  };
}

/** Lists, people and group management for employees. */
export const chatApi = {
  internal: (q?: string) => api.get<ChatConversation[]>('/chat/internal', { q }),
  myClients: (q?: string) => api.get<ChatMyClient[]>('/chat/my-clients', { q }),
  review: (q: string | undefined, page: number, pageSize = 30) => api.get<ChatReviewList>('/chat/review', { q, page, pageSize }),
  unread: () => api.get<ChatUnreadSummary>('/chat/unread'),
  clientUnread: () => api.get<ChatUnreadSummary>('/client/chat/unread'),
  directory: (q: string | undefined, limit = 30) => api.get<ChatDirectoryPerson[]>('/chat/directory', { q, limit }),
  openDirect: (profileId: string) => api.post<ChatConversation>('/chat/direct', { profileId }),
  createGroup: (title: string, memberIds: string[]) => api.post<ChatConversation>('/chat/groups', { title, memberIds }),
  customer: (customerId: string) => api.get<ChatConversation>(`/chat/customers/${customerId}`),
  detail: (id: string) => api.get<ChatConversation>(`/chat/conversations/${id}`),
  renameGroup: (id: string, title: string) => api.patch<ChatConversation>(`/chat/groups/${id}`, { title }),
  addMembers: (id: string, profileIds: string[]) => api.post<ChatConversation>(`/chat/groups/${id}/members`, { profileIds }),
  removeMember: (id: string, profileId: string) => api.delete<ChatConversation>(`/chat/groups/${id}/members/${profileId}`),
  setAdmin: (id: string, profileId: string, admin: boolean) => api.post<ChatConversation>(`/chat/groups/${id}/admins`, { profileId, admin }),
  leave: (id: string) => api.post<null>(`/chat/groups/${id}/leave`, {})
};
