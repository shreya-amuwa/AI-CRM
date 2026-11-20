import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ChatReceipt,
  ClientSupportGroup,
  ChatConversation,
  ChatDeleteResult, ChatInboxDeleteResult, ChatTaggedPerson, ChatReaction, ChatReactResult,
  ChatDirectoryPerson,
  ChatKeyBackup,
  ChatKeyBackupBlob,
  ChatKeyStatus,
  ChatInternalMode,
  ChatMemberKey,
  ChatMessage,
  ChatMessagePage,
  ChatMyClient,
  ChatPublicKey,
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
  clientTab() { return this.rpc<{ eligible: boolean; count: number }>('chat_client_tab', {}); }
  clientTeam(conversationId: string) { return this.rpc<{ id: string; name: string; role: string }[]>('chat_client_team', { p_conversation: conversationId }); }
  escalate(conversationId: string, messageId: string | null, targetId: string, note: string | null) {
    return this.rpc<{ sentTo: string; conversationId: string }>('chat_escalate_client_message', { p_conversation: conversationId, p_message: messageId, p_target: targetId, p_note: note });
  }
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
  sendEncrypted(id: string, i: { clientMsgId: string; replyTo?: string; attachmentIds: string[]; e2ee: unknown }) {
    return this.rpc<ChatMessage>('chat_send_encrypted', { p_conversation: id, p_client_msg_id: i.clientMsgId, p_e2ee: i.e2ee, p_reply_to: i.replyTo ?? null, p_attachments: i.attachmentIds });
  }
  deleteForMe(messageId: string) { return this.rpc<ChatDeleteResult>('chat_delete_for_me', { p_message: messageId }); }
  deleteForEveryone(messageId: string) {
    return this.rpc<{ id: string; deleted: boolean; files: { id: string; bucket: string; path: string; provider: 'R2' | 'SUPABASE' | null }[] }>('chat_delete_for_everyone', { p_message: messageId });
  }
  async attachmentsRemoved(ids: string[]) { await this.rpc<null>('chat_attachments_removed', { p_ids: ids }); }

  // ---- @mentions, reactions, Delete Inbox (migration 20270116000300; the database decides who may)
  mention(messageId: string, profileIds: string[]) {
    return this.rpc<{ messageId: string; mentions: ChatTaggedPerson[] }>('chat_message_mention', { p_message: messageId, p_profiles: profileIds });
  }
  react(messageId: string, emoji: string | null) { return this.rpc<ChatReactResult>('chat_message_react', { p_message: messageId, p_emoji: emoji }); }
  reactions(conversationId: string, messageIds: string[]) {
    return this.rpc<Record<string, ChatReaction[]>>('chat_reactions_for', { p_conversation: conversationId, p_messages: messageIds });
  }
  inboxClear() { return this.rpc<ChatInboxDeleteResult>('chat_inbox_clear'); }
  inboxPurge(confirm: string) {
    return this.rpc<{ scope: 'ALL_INTERNAL'; conversations: number; messages: number; files: { id: string; bucket: string; path: string; provider: 'R2' | 'SUPABASE' | null }[] }>(
      'chat_inbox_purge', { p_confirm: confirm });
  }
  async purgedFilesRemoved(ids: string[]) { await this.rpc<null>('chat_purged_files_removed', { p_ids: ids }); }

  // ---- end-to-end encryption keys (public keys and the passphrase-encrypted private-key backup; no secret is ever in these calls)
  keyStatus() { return this.rpc<ChatKeyStatus>('chat_key_status'); }
  /** How new direct / group messages are sent: STANDARD (readable by the company) or E2EE (sealed in the browser). */
  internalMode() { return this.rpc<ChatInternalMode>('chat_internal_mode', {}); }
  setInternalMode(mode: ChatInternalMode['mode']) { return this.rpc<ChatInternalMode>('chat_set_internal_mode', { p_mode: mode }); }
  keySetup(publicKey: string, backup: ChatKeyBackupBlob) { return this.rpc<{ version: number; fingerprint: string }>('chat_key_setup', { p_public: publicKey, p_backup: backup }); }
  keyRegister(publicKey: string) { return this.rpc<{ version: number; fingerprint: string; created: boolean }>('chat_key_register', { p_public: publicKey }); }
  keyRotate(publicKey: string) { return this.rpc<{ version: number; fingerprint: string; created: boolean }>('chat_key_rotate', { p_public: publicKey }); }
  keyReset(publicKey: string, backup: ChatKeyBackupBlob) { return this.rpc<{ version: number; fingerprint: string }>('chat_key_reset', { p_public: publicKey, p_backup: backup }); }
  keyBackupGet() { return this.rpc<ChatKeyBackup | null>('chat_key_backup_get'); }
  async keyBackupSet(backup: ChatKeyBackupBlob, version: number) { await this.rpc<null>('chat_key_backup_set', { p_backup: backup, p_version: version }); }
  memberKeys(conversationId: string) { return this.rpc<ChatMemberKey[]>('chat_member_keys', { p_conversation: conversationId }); }
  keyLookup(profileId: string, version: number) { return this.rpc<ChatPublicKey | null>('chat_key_lookup', { p_profile: profileId, p_version: version }); }

  markRead(id: string, seq?: number) { return this.rpc<{ readSeq: number }>('chat_mark_read', { p_conversation: id, p_seq: seq ?? null }); }
  // ---- Delivered / Seen and client support groups (20261230000500)
  ackDelivered(id: string, seq: number) { return this.rpc<{ deliveredSeq: number }>('chat_ack_delivered', { p_conversation: id, p_seq: seq }); }
  receipts(id: string, after: number) { return this.rpc<ChatReceipt[]>('chat_message_receipts', { p_conversation: id, p_after_seq: after }); }
  supportGroup(customerId: string) { return this.rpc<ClientSupportGroup>('client_support_group', { p_customer: customerId }); }
  supportGroupSave(customerId: string, b: { name?: string | null; add?: string[]; remove?: string[] }) {
    return this.rpc<ClientSupportGroup>('client_support_group_save', { p_customer: customerId, p_name: b.name ?? null, p_add: b.add ?? null, p_remove: b.remove ?? null });
  }

  // ---- people, direct messages, groups
  // p_department exists from migration 20261228000300; without a department filter the older two-argument call keeps working
  directory(q: string | null, limit: number, department: string | null = null) {
    return this.rpc<ChatDirectoryPerson[]>('chat_directory', department ? { p_search: q, p_limit: limit, p_department: department } : { p_search: q, p_limit: limit });
  }
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
