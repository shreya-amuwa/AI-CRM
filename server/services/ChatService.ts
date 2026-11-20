import type { ChatClientView, ChatConversation, ChatDeleteResult, ChatInboxDeleteResult, ChatMessage, ChatMessagePage, ChatReaction, ChatReactResult, ChatUploadTicket, ClientDocumentUrl } from '../../shared/contracts.js';
import {
  chatPurgeSchema, chatReactSchema, chatReactionsQuerySchema,
  chatReceiptsQuerySchema,
  clientSupportGroupSaveSchema,
  chatAdminSchema,
  chatDirectSchema,
  chatGroupCreateSchema,
  chatGroupRenameSchema,
  chatMembersSchema,
  chatMessagesQuerySchema,
  chatChannelSchema,
  chatKeyBackupSetSchema,
  chatKeyLookupQuerySchema,
  chatKeySetupSchema,
  chatKeyRegisterSchema,
  chatReadSchema,
  chatEscalateSchema,
  chatReviewQuerySchema,
  chatSearchQuerySchema,
  chatDirectoryQuerySchema,
  chatSendEncryptedSchema,
  chatInternalModeSchema,
  chatSendSchema,
  chatUploadSchema,
  clientFileQuerySchema,
  uuidSchema
} from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { ChatRepository, type ChatAttachmentRow } from '../repositories/ChatRepository.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

const FILE_URL_TTL_SECONDS = 120;

/**
 * Chat for employees (direct messages, groups, the clients they look after, review) and for clients (their one
 * conversation). The database decides who may do what; this layer validates input, issues upload / download links
 * AFTER the database allowed them, and never accepts a sender, a customer for a client, or a storage path from a request.
 */
/** The one thing a client may choose about a conversation: which channel (Meta verification or Relationship Manager). */
function channelOf(raw: unknown): string | null {
  return raw === undefined || raw === null || raw === '' ? null : parse(chatChannelSchema, String(raw).toUpperCase());
}
function splitChannel(input: unknown): { channel: string | null; rest: Record<string, unknown> } {
  const { channel, ...rest } = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return { channel: channelOf(channel), rest };
}

export class ChatService {
  constructor(
    private readonly repo: ChatRepository,
    private readonly storage: StorageRepository
  ) {}

  // ---------------------------------------------------------------- employees
  internalList(query: unknown) { return this.repo.internalList(parse(chatSearchQuerySchema, query ?? {}).q || null); }
  myClients(query: unknown) { return this.repo.myClients(parse(chatSearchQuerySchema, query ?? {}).q || null); }
  /** Whether this person can have client conversations (the database decides) and how many they have now. */
  clientTab() { return this.repo.clientTab(); }
  clientTeam(id: string) { return this.repo.clientTeam(parse(uuidSchema, id)); }
  /** Shares a client message with the people of that client's team: a notification only, the conversation is not copied or changed. */
  escalate(id: string, body: unknown) {
    const input = parse(chatEscalateSchema, body);
    return this.repo.escalate(parse(uuidSchema, id), input.messageId ?? null, input.targetId, input.note ?? null);
  }
  review(query: unknown) {
    const { q, page, pageSize } = parse(chatReviewQuerySchema, query ?? {});
    return this.repo.reviewList(q || null, pageSize, (page - 1) * pageSize);
  }
  /** A Department Head opening a client chat to review it: written to the audit log (at most once per 30 minutes). */
  async reviewOpen(id: string): Promise<null> {
    await this.repo.reviewOpen(parse(uuidSchema, id));
    return null;
  }
  unread() { return this.repo.unread(); }
  customerConversation(customerId: string, query?: unknown) {
    return this.repo.customerConversation(parse(uuidSchema, customerId), channelOf((query as Record<string, unknown> | undefined)?.channel));
  }
  detail(id: string): Promise<ChatConversation> { return this.repo.detail(parse(uuidSchema, id)); }
  directory(query: unknown) {
    const { q, limit, department } = parse(chatDirectoryQuerySchema, query ?? {});
    return this.repo.directory(q || null, limit, department ?? null);
  }
  openDirect(body: unknown) { return this.repo.openDirect(parse(chatDirectSchema, body).profileId); }
  createGroup(body: unknown) {
    const i = parse(chatGroupCreateSchema, body);
    return this.repo.createGroup(i.title, [...new Set(i.memberIds)]);
  }
  renameGroup(id: string, body: unknown) { return this.repo.renameGroup(parse(uuidSchema, id), parse(chatGroupRenameSchema, body).title); }
  addMembers(id: string, body: unknown) { return this.repo.addMembers(parse(uuidSchema, id), [...new Set(parse(chatMembersSchema, body).profileIds)]); }
  removeMember(id: string, profileId: string) { return this.repo.removeMember(parse(uuidSchema, id), parse(uuidSchema, profileId)); }
  setAdmin(id: string, body: unknown) {
    const i = parse(chatAdminSchema, body);
    return this.repo.setAdmin(parse(uuidSchema, id), i.profileId, i.admin);
  }
  async leave(id: string): Promise<null> {
    await this.repo.leave(parse(uuidSchema, id));
    return null;
  }
  messages(id: string, query: unknown): Promise<ChatMessagePage> { return this.repo.messages(parse(uuidSchema, id), parse(chatMessagesQuerySchema, query ?? {})); }
  async send(id: string, body: unknown): Promise<ChatMessage> {
    const input = parse(chatSendSchema, body);
    return this.withMentions(await this.repo.send(parse(uuidSchema, id), input), input.mentions);
  }
  /** The server stores the envelope as it is: it checks who it is sealed for, never what it says. */
  async sendEncrypted(id: string, body: unknown): Promise<ChatMessage> {
    const input = parse(chatSendEncryptedSchema, body);
    return this.withMentions(await this.repo.sendEncrypted(parse(uuidSchema, id), input), input.mentions);
  }
  /**
   * @mentions: right after the message is stored, the database records who it tags (only current members of that group) and notifies them.
   * A retry of the same send (same clientMsgId) tags nobody twice. If the tags are refused, the message stays sent and says why.
   */
  private async withMentions(m: ChatMessage, mentions: string[]): Promise<ChatMessage> {
    const ids = [...new Set(mentions)];
    if (!ids.length) return m;
    try {
      const r = await this.repo.mention(m.id, ids);
      return { ...m, mentions: r.mentions };
    } catch (err) {
      if (err instanceof AppError && (err.code === 'VALIDATION_ERROR' || err.code === 'FORBIDDEN')) return { ...m, mentionWarning: err.message };
      throw err;
    }
  }

  // ---------------------------------------------------------------- reactions (one per person and message; the database checks access)
  react(messageId: string, body: unknown): Promise<ChatReactResult> {
    return this.repo.react(parse(uuidSchema, messageId), parse(chatReactSchema, body).emoji);
  }
  reactions(conversationId: string, query: unknown): Promise<Record<string, ChatReaction[]>> {
    return this.repo.reactions(parse(uuidSchema, conversationId), parse(chatReactionsQuerySchema, query ?? {}).ids);
  }

  // ---------------------------------------------------------------- Delete Inbox
  /** Clear my inbox: every direct chat and group of mine is emptied for me only. */
  inboxClear(): Promise<ChatInboxDeleteResult> { return this.repo.inboxClear(); }
  /**
   * The Super Admin deletes every internal chat message for everybody (the database checks the role and the typed confirmation). The stored
   * files are then removed from storage here; the database is told which are gone. A file that could not be removed stays listed for a retry.
   */
  async inboxPurge(body: unknown): Promise<ChatInboxDeleteResult> {
    const done = await this.repo.inboxPurge(parse(chatPurgeSchema, body).confirm);
    const removed: string[] = [];
    for (const f of done.files) {
      try {
        await this.storage.remove(f.bucket, [f.path], f.provider);
        removed.push(f.id);
      } catch (err) {
        console.error('[chat] could not remove a purged file from storage', { file: f.id, message: (err as Error).message });
      }
    }
    for (let i = 0; i < removed.length; i += 500) await this.repo.purgedFilesRemoved(removed.slice(i, i + 500)).catch(() => undefined);
    return { scope: 'ALL_INTERNAL', conversations: done.conversations, messages: done.messages, filesRemoved: removed.length, filesPending: done.files.length - removed.length };
  }
  deleteForMe(messageId: string): Promise<ChatDeleteResult> { return this.repo.deleteForMe(parse(uuidSchema, messageId)); }
  /** The database wipes the message and says which stored files must go; they are removed here, and the database is told when they are gone. */
  async deleteForEveryone(messageId: string): Promise<ChatDeleteResult> {
    const done = await this.repo.deleteForEveryone(parse(uuidSchema, messageId));
    const removed: string[] = [];
    for (const f of done.files) {
      try {
        await this.storage.remove(f.bucket, [f.path], f.provider);
        removed.push(f.id);
      } catch (err) {
        console.error('[chat] could not remove a deleted file from storage', { file: f.id, message: (err as Error).message });
      }
    }
    if (removed.length) await this.repo.attachmentsRemoved(removed).catch(() => undefined);
    if (removed.length < done.files.length) throw new AppError('SERVICE_UNAVAILABLE', 'The message was deleted, but a file could not be removed from storage yet. Delete the message again to retry the file.');
    return { id: done.id, deleted: true };
  }

  // ---------------------------------------------------------------- keys for end-to-end encryption
  keyStatus() { return this.repo.keyStatus(); }
  internalMode() { return this.repo.internalMode(); }
  setInternalMode(body: unknown) { return this.repo.setInternalMode(parse(chatInternalModeSchema, body).mode); }
  keySetup(body: unknown) { const i = parse(chatKeySetupSchema, body); return this.repo.keySetup(i.publicKey, i.backup); }
  keyRegister(body: unknown) { return this.repo.keyRegister(parse(chatKeyRegisterSchema, body).publicKey); }
  keyRotate(body: unknown) { return this.repo.keyRotate(parse(chatKeyRegisterSchema, body).publicKey); }
  keyReset(body: unknown) { const i = parse(chatKeySetupSchema, body); return this.repo.keyReset(i.publicKey, i.backup); }
  keyBackupGet() { return this.repo.keyBackupGet(); }
  async keyBackupSet(body: unknown): Promise<null> { const i = parse(chatKeyBackupSetSchema, body); await this.repo.keyBackupSet(i.backup, i.version); return null; }
  memberKeys(id: string) { return this.repo.memberKeys(parse(uuidSchema, id)); }
  keyLookup(query: unknown) { const i = parse(chatKeyLookupQuerySchema, query); return this.repo.keyLookup(i.profileId, i.version); }

  markRead(id: string, body: unknown) { return this.repo.markRead(parse(uuidSchema, id), parse(chatReadSchema, body ?? {}).seq); }
  // ---- Delivered / Seen and client support groups (20261230000500); the database checks who may do each
  ackDelivered(id: string, body: unknown) { return this.repo.ackDelivered(parse(uuidSchema, id), parse(chatReadSchema, body ?? {}).seq ?? 0); }
  receipts(id: string, query: unknown) { return this.repo.receipts(parse(uuidSchema, id), parse(chatReceiptsQuerySchema, query ?? {}).after ?? 0); }
  supportGroup(customerId: string) { return this.repo.supportGroup(parse(uuidSchema, customerId)); }
  supportGroupSave(customerId: string, body: unknown) { return this.repo.supportGroupSave(parse(uuidSchema, customerId), parse(clientSupportGroupSaveSchema, body ?? {})); }
  async clientAckDelivered(body: unknown) {
    const { channel, rest } = splitChannel(body);
    return this.repo.ackDelivered(await this.clientConversationId(channel), parse(chatReadSchema, rest).seq ?? 0);
  }
  async clientReceipts(query: unknown) {
    const { channel, rest } = splitChannel(query);
    return this.repo.receipts(await this.clientConversationId(channel), parse(chatReceiptsQuerySchema, rest).after ?? 0);
  }

  // ---------------------------------------------------------------- clients (the conversation always comes from the login)
  // The client may name a channel (the Meta Verifier's or the Relationship Manager's) and nothing else: who is on the other side is decided
  // by the database from the customer's assignment, and a channel that is not open at the client's stage is refused there.
  async clientView(query: unknown): Promise<ChatClientView> {
    const { channel, rest } = splitChannel(query);
    const conversation = await this.repo.clientConversation(channel);
    return { conversation, page: await this.repo.messages(conversation.id, parse(chatMessagesQuerySchema, rest)) };
  }
  private async clientConversationId(channel: string | null) { return (await this.repo.clientConversation(channel)).id; }
  async clientMessages(query: unknown): Promise<ChatMessagePage> {
    const { channel, rest } = splitChannel(query);
    return this.repo.messages(await this.clientConversationId(channel), parse(chatMessagesQuerySchema, rest));
  }
  async clientSend(body: unknown): Promise<ChatMessage> {
    const { channel, rest } = splitChannel(body);
    return this.repo.send(await this.clientConversationId(channel), parse(chatSendSchema, rest));
  }
  async clientMarkRead(body: unknown) {
    const { channel, rest } = splitChannel(body);
    return this.repo.markRead(await this.clientConversationId(channel), parse(chatReadSchema, rest).seq);
  }
  async clientBeginUpload(body: unknown) {
    const { channel, rest } = splitChannel(body);
    return this.beginUpload(await this.clientConversationId(channel), rest);
  }

  // ---------------------------------------------------------------- attachments
  /** Books the upload in the database (it checks the person, the type and the size), then hands out the one signed upload for it. */
  async beginUpload(conversationId: string, body: unknown): Promise<ChatUploadTicket> {
    const i = parse(chatUploadSchema, body);
    const row = await this.repo.beginUpload(parse(uuidSchema, conversationId), i.fileName, i.mimeType, i.sizeBytes);
    try {
      const target = await this.storage.createUploadTarget(row.id, row.storage_bucket, row.storage_path, row.mime_type, 'chat_attachments');
      return {
        attachment: { id: row.id, name: row.file_name, mime: row.mime_type, size: Number(row.size_bytes) },
        bucket: row.storage_bucket,
        path: row.storage_path,
        provider: target.provider,
        token: target.token ?? '',
        ...(target.url ? { upload: { url: target.url, headers: target.headers ?? {} } } : {})
      };
    } catch (err) {
      await this.repo.abortUpload(row.id).catch(() => undefined);
      throw err;
    }
  }

  /** The browser says the file is stored: look at the stored object (exists, size, content matches its type), then finish. */
  async completeUpload(id: string) {
    const attId = parse(uuidSchema, id);
    const row = await this.repo.pendingUpload(attId);
    const object = await this.storage.inspectFile(row.storage_provider, row.storage_bucket, row.storage_path, row.mime_type);
    if (!object.exists) {
      await this.discard(row);
      throw new AppError('VALIDATION_ERROR', 'The file did not finish uploading. Please try again.');
    }
    if (!object.matches) {
      await this.discard(row);
      throw new AppError('VALIDATION_ERROR', 'The file content does not match its type. Please send the original file.');
    }
    try {
      const done = await this.repo.completeUpload(attId, object.size, object.etag);
      await this.storage.recordStored(attId, row.storage_provider, { reference: object.reference, etag: object.etag }, 'chat_attachments');
      return done;
    } catch (err) {
      await this.discard(row);
      throw err;
    }
  }

  async abortUpload(id: string): Promise<null> {
    const attId = parse(uuidSchema, id);
    const row = await this.repo.pendingUpload(attId).catch(() => null);
    if (row) await this.discard(row);
    return null;
  }

  private async discard(row: ChatAttachmentRow) {
    await this.repo.abortUpload(row.id).catch(() => undefined);
    await this.storage.remove(row.storage_bucket, [row.storage_path], row.storage_provider).catch(() => undefined);
  }

  /** A short-lived link, issued only if the database says this caller may read the message the file belongs to. */
  async attachmentUrl(id: string, query: unknown): Promise<ClientDocumentUrl> {
    const { action } = parse(clientFileQuerySchema, query ?? {});
    const row = await this.repo.attachmentFile(parse(uuidSchema, id));
    const url = await this.storage.signedDownloadUrl(row.storage_bucket, row.storage_path, FILE_URL_TTL_SECONDS, action === 'download' ? row.file_name : undefined, row.storage_provider);
    return { url, expiresInSeconds: FILE_URL_TTL_SECONDS, fileName: row.file_name };
  }
}
