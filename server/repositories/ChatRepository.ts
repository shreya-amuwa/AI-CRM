import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ChatConversation,
  ChatDirectoryPerson,
  ChatMessage,
  ChatMessagePage,
  ChatMyClient,
  ChatReviewList,
  ChatUnreadSummary
} from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** A row of chat_attachments as the upload / download functions return it. */
export interface ChatAttachmentRow {
  id: string;
  conversation_id: string;
  uploader_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  storage_bucket: string;
  storage_path: string;
  storage_provider: 'R2' | 'SUPABASE' | null;
}

/**
 * Chat. Every call is a database function that decides, from the caller's own login, whether they are a client, an
 * assigned employee, a member or a reviewer; nothing here names a sender or grants access. The caller's own database
 * client is used (row level security applies), never the service key.
 */
export class ChatRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  // ---- opening conversations
  clientConversation(channel?: string | null) { return this.rpc<ChatConversation>('chat_client_conversation', { p_channel: channel ?? null }); }
  customerConversation(customerId: string, channel?: string | null) { return this.rpc<ChatConversation>('chat_customer_conversation', { p_customer: customerId, p_channel: channel ?? null }); }
  detail(id: string) { return this.rpc<ChatConversation>('chat_conversation_detail', { p_conversation: id }); }
  myClients(q: string | null) { return this.rpc<ChatMyClient[]>('chat_my_clients', { p_search: q }); }
  internalList(q: string | null) { return this.rpc<ChatConversation[]>('chat_internal_list', { p_search: q }); }
  reviewList(q: string | null, limit: number, offset: number) { return this.rpc<ChatReviewList>('chat_review_list', { p_search: q, p_limit: limit, p_offset: offset }); }
  async reviewOpen(id: string) { await this.rpc<null>('chat_review_open', { p_conversation: id }); }
  unread() { return this.rpc<ChatUnreadSummary>('chat_unread_summary'); }

  // ---- messages
  messages(id: string, q: { before?: number; after?: number; limit: number }) {
    return this.rpc<ChatMessagePage>('chat_messages_page', { p_conversation: id, p_before_seq: q.before ?? null, p_after_seq: q.after ?? null, p_limit: q.limit });
  }
  send(id: string, i: { body: string; clientMsgId: string; replyTo?: string; attachmentIds: string[] }) {
    return this.rpc<ChatMessage>('chat_send_message', { p_conversation: id, p_body: i.body, p_client_msg_id: i.clientMsgId, p_reply_to: i.replyTo ?? null, p_attachments: i.attachmentIds });
  }
  markRead(id: string, seq?: number) { return this.rpc<{ readSeq: number }>('chat_mark_read', { p_conversation: id, p_seq: seq ?? null }); }

  // ---- people, direct messages, groups
  directory(q: string | null, limit: number) { return this.rpc<ChatDirectoryPerson[]>('chat_directory', { p_search: q, p_limit: limit }); }
  openDirect(profileId: string) { return this.rpc<ChatConversation>('chat_open_direct', { p_profile: profileId }); }
  createGroup(title: string, memberIds: string[]) { return this.rpc<ChatConversation>('chat_create_group', { p_title: title, p_members: memberIds }); }
  renameGroup(id: string, title: string) { return this.rpc<ChatConversation>('chat_group_rename', { p_conversation: id, p_title: title }); }
  addMembers(id: string, profileIds: string[]) { return this.rpc<ChatConversation>('chat_group_add_members', { p_conversation: id, p_members: profileIds }); }
  removeMember(id: string, profileId: string) { return this.rpc<ChatConversation>('chat_group_remove_member', { p_conversation: id, p_profile: profileId }); }
  setAdmin(id: string, profileId: string, admin: boolean) { return this.rpc<ChatConversation>('chat_group_set_admin', { p_conversation: id, p_profile: profileId, p_admin: admin }); }
  async leave(id: string) { await this.rpc<null>('chat_group_leave', { p_conversation: id }); }

  // ---- attachments
  beginUpload(id: string, fileName: string, mime: string, size: number) {
    return this.rpc<ChatAttachmentRow>('chat_begin_upload', { p_conversation: id, p_file_name: fileName, p_mime: mime, p_size: size });
  }
  pendingUpload(id: string) { return this.rpc<ChatAttachmentRow>('chat_pending_upload', { p_attachment: id }); }
  completeUpload(id: string, size: number, etag: string | null) {
    return this.rpc<{ id: string; name: string; mime: string; size: number }>('chat_complete_upload', { p_attachment: id, p_size: size, p_etag: etag });
  }
  async abortUpload(id: string) { await this.rpc<null>('chat_abort_upload', { p_attachment: id }); }
  attachmentFile(id: string) { return this.rpc<ChatAttachmentRow>('chat_attachment_download', { p_attachment: id }); }
}
