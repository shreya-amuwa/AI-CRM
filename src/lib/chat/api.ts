import type { ChatReceipt, ClientSupportGroup } from '../../../shared/contracts';
import type {
  ChatAttachment, ChatChannel, ChatClientView, ChatConversation, ChatDeleteResult, ChatDirectoryPerson, ChatE2eeWrap, ChatKeyBackup, ChatKeyBackupBlob, ChatKeyStatus, ChatMemberKey, ChatMessage,
  ChatMessagePage, ChatMyClient, ChatDeskClient, ChatHandler, ChatPublicKey, ChatReviewList, ChatUnreadSummary, ChatUploadTicket, ClientDocumentUrl,
  ChatInboxDeleteResult, ChatReaction, ChatReactResult
} from '../../../shared/contracts';
import { api } from '../api/client';

export interface SendInput {
  body: string;
  clientMsgId: string;
  replyTo?: string;
  attachmentIds: string[];
  /** Group members tagged with @ (the server refuses anyone outside the group). */
  mentions?: string[];
}
/** The envelope of an end-to-end encrypted message (what the server stores). */
export interface SecureSendInput {
  clientMsgId: string;
  replyTo?: string;
  attachmentIds: string[];
  e2ee: { v: 1; sv: number; iv: string; ct: string; wraps: ChatE2eeWrap[] };
  mentions?: string[];
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
  /** Internal chats only (the other transports do not have it): the message goes as an encrypted envelope. */
  sendSecure?(i: SecureSendInput): Promise<ChatMessage>;
  /** Internal chats only: hide a message for the signed-in person / remove it for everybody (sender only). */
  deleteForMe?(messageId: string): Promise<ChatDeleteResult>;
  deleteForEveryone?(messageId: string): Promise<ChatDeleteResult>;
  /** Internal chats only: add / change / remove (null) my reaction, and the reactions of the messages on screen. */
  react?(messageId: string, emoji: string | null): Promise<ChatReactResult>;
  reactions?(messageIds: string[]): Promise<Record<string, ChatReaction[]>>;
  markRead(seq: number): Promise<unknown>;
  /** 20261230000500: this device has received everything up to seq (Delivered), and the status of my own messages. Optional: older servers. */
  ackDelivered?(seq: number): Promise<unknown>;
  receipts?(after: number): Promise<ChatReceipt[]>;
  beginUpload(i: UploadInput): Promise<ChatUploadTicket>;
  completeUpload(id: string): Promise<ChatAttachment>;
  abortUpload(id: string): Promise<unknown>;
  attachmentUrl(id: string, action: 'view' | 'download'): Promise<ClientDocumentUrl>;
}

/**
 * The client's conversation of one channel (the Meta Verifier's or the Relationship Manager's). The client only names the channel: who is on
 * the other side comes from the customer's assignment on the server, and a channel that is not open at their stage is refused there.
 * No channel: the server picks the one in use now.
 */
const clientTransports = new Map<string, ChatTransport>();
export function clientTransport(channel?: ChatChannel): ChatTransport {
  const known = clientTransports.get(channel ?? 'current');
  if (known) return known;
  const ch = channel ? { channel } : {};
  const made: ChatTransport = {
    key: `client:${channel ?? 'current'}`,
    open: limit => api.get<ChatClientView>('/client/chat', { limit, ...ch }),
    detail: async () => (await api.get<ChatClientView>('/client/chat', { limit: 1, ...ch })).conversation,
    messages: q => api.get<ChatMessagePage>('/client/chat/messages', { ...q, ...ch }),
    send: i => api.post<ChatMessage>('/client/chat/messages', { ...i, ...ch }),
    markRead: seq => api.post('/client/chat/read', { seq, ...ch }),
    ackDelivered: seq => api.post('/client/chat/delivered', { seq, ...ch }),
    receipts: after => api.get<ChatReceipt[]>('/client/chat/receipts', { after, ...ch }),
    beginUpload: i => api.post<ChatUploadTicket>('/client/chat/uploads', { ...i, ...ch }),
    completeUpload: id => api.post<ChatAttachment>(`/client/chat/uploads/${id}/complete`, {}),
    abortUpload: id => api.post(`/client/chat/uploads/${id}/abort`, {}),
    attachmentUrl: (id, action) => api.get<ClientDocumentUrl>(`/client/chat/attachments/${id}/url`, { action })
  };
  clientTransports.set(channel ?? 'current', made);
  return made;
}

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
    sendSecure: i => api.post<ChatMessage>(`${base}/secure-messages`, i),
    deleteForMe: id => api.delete<ChatDeleteResult>(`/chat/messages/${id}/for-me`),
    deleteForEveryone: id => api.delete<ChatDeleteResult>(`/chat/messages/${id}/for-everyone`),
    react: (id, emoji) => api.post<ChatReactResult>(`/chat/messages/${id}/reaction`, { emoji }),
    reactions: ids => api.get<Record<string, ChatReaction[]>>(`${base}/reactions`, { ids: ids.join(',') }),
    markRead: seq => api.post(`${base}/read`, { seq }),
    ackDelivered: seq => api.post(`${base}/delivered`, { seq }),
    receipts: after => api.get<ChatReceipt[]>(`${base}/receipts`, { after }),
    beginUpload: i => api.post<ChatUploadTicket>(`${base}/uploads`, i),
    completeUpload: id => api.post<ChatAttachment>(`/chat/uploads/${id}/complete`, {}),
    abortUpload: id => api.post(`/chat/uploads/${id}/abort`, {}),
    attachmentUrl: (id, action) => api.get<ClientDocumentUrl>(`/chat/attachments/${id}/url`, { action })
  };
}

/** Keys for end-to-end encryption: public keys and the passphrase-encrypted backup. No secret is ever sent through these calls. */
export const chatKeysApi = {
  status: () => api.get<ChatKeyStatus>('/chat/keys/status'),
  setup: (publicKey: string, backup: ChatKeyBackupBlob) => api.post<{ version: number; fingerprint: string }>('/chat/keys', { publicKey, backup }),
  register: (publicKey: string) => api.post<{ version: number; fingerprint: string; created: boolean }>('/chat/keys/register', { publicKey }),
  rotate: (publicKey: string) => api.post<{ version: number; fingerprint: string; created: boolean }>('/chat/keys/rotate', { publicKey }),
  reset: (publicKey: string, backup: ChatKeyBackupBlob) => api.post<{ version: number; fingerprint: string }>('/chat/keys/reset', { publicKey, backup }),
  backup: () => api.get<ChatKeyBackup | null>('/chat/keys/backup'),
  setBackup: (backup: ChatKeyBackupBlob, version: number) => api.post<null>('/chat/keys/backup', { backup, version }),
  members: (conversationId: string) => api.get<ChatMemberKey[]>(`/chat/conversations/${conversationId}/keys`),
  lookup: (profileId: string, version: number) => api.get<ChatPublicKey | null>('/chat/keys/lookup', { profileId, version })
};

/** Lists, people and group management for employees. */
export const chatApi = {
  internal: (q?: string) => api.get<ChatConversation[]>('/chat/internal', { q }),
  myClients: (q?: string) => api.get<ChatMyClient[]>('/chat/my-clients', { q }),
  /** The shared Support desk (20270129000100): the department's client conversations for Support employees covering for a colleague. */
  deskClients: (q?: string) => api.get<ChatDeskClient[]>('/chat/desk-clients', { q }),
  /** Take over or release "currently handling" on a client conversation (information only; the Relationship Manager is never changed). */
  setHandling: (conversationId: string, action: 'TAKE' | 'RELEASE') => api.post<ChatHandler | null>(`/chat/conversations/${conversationId}/handling`, { action }),
  /** The customer's support group (20261230000500): who is in it, and (for the Team Lead / Department Head) who can be added. */
  supportGroup: (customerId: string) => api.get<ClientSupportGroup>(`/chat/customers/${customerId}/support-group`),
  saveSupportGroup: (customerId: string, b: { name?: string | null; add?: string[]; remove?: string[] }) => api.post<ClientSupportGroup>(`/chat/customers/${customerId}/support-group`, b),
  /** Whether the client conversations tab belongs to this person (the server decides) and how many they have. */
  clientTab: () => api.get<{ eligible: boolean; count: number }>('/chat/client-tab'),
  clientTeam: (conversationId: string) => api.get<{ id: string; name: string; role: string }[]>(`/chat/conversations/${conversationId}/client-team`),
  escalate: (conversationId: string, body: { messageId?: string | null; targetId: string; note?: string | null }) =>
    api.post<{ sentTo: string; conversationId: string }>(`/chat/conversations/${conversationId}/escalate`, body),
  review: (q: string | undefined, page: number, pageSize = 30) => api.get<ChatReviewList>('/chat/review', { q, page, pageSize }),
  unread: () => api.get<ChatUnreadSummary>('/chat/unread'),
  clientUnread: () => api.get<ChatUnreadSummary>('/client/chat/unread'),
  directory: (q: string | undefined, limit = 30, department?: string) => api.get<ChatDirectoryPerson[]>('/chat/directory', department ? { q, limit, department } : { q, limit }),
  openDirect: (profileId: string) => api.post<ChatConversation>('/chat/direct', { profileId }),
  createGroup: (title: string, memberIds: string[]) => api.post<ChatConversation>('/chat/groups', { title, memberIds }),
  customer: (customerId: string) => api.get<ChatConversation>(`/chat/customers/${customerId}`),
  detail: (id: string) => api.get<ChatConversation>(`/chat/conversations/${id}`),
  renameGroup: (id: string, title: string) => api.patch<ChatConversation>(`/chat/groups/${id}`, { title }),
  addMembers: (id: string, profileIds: string[]) => api.post<ChatConversation>(`/chat/groups/${id}/members`, { profileIds }),
  removeMember: (id: string, profileId: string) => api.delete<ChatConversation>(`/chat/groups/${id}/members/${profileId}`),
  setAdmin: (id: string, profileId: string, admin: boolean) => api.post<ChatConversation>(`/chat/groups/${id}/admins`, { profileId, admin }),
  leave: (id: string) => api.post<null>(`/chat/groups/${id}/leave`, {}),
  /** Delete Inbox: my own direct chats and groups, for me only. */
  inboxClear: () => api.post<ChatInboxDeleteResult>('/chat/inbox/clear', {}),
  /** The Super Admin: every internal chat message for everybody (the confirmation text is checked by the server). */
  inboxPurge: (confirm: string) => api.post<ChatInboxDeleteResult>('/chat/inbox/purge', { confirm })
};
