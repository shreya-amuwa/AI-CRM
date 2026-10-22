import type { ClientDocumentUrl, TicketAttachment, TicketUploadTicket } from '../../shared/contracts.js';
import { clientFileQuerySchema, ticketUploadSchema, uuidSchema } from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import type { TicketAttachmentRepository, TicketAttachmentRow } from '../repositories/TicketAttachmentRepository.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

const FILE_URL_TTL_SECONDS = 120;
const TABLE = 'support_ticket_attachments';

/**
 * Files on tickets, for clients and for staff. The database decides who may attach to (or read from) which ticket and
 * enforces the limits (5 files per message, 5 MB each, the allowed types); this layer validates input, issues the signed
 * upload / download links AFTER the database allowed them, looks at the stored object, and never accepts an uploader, a
 * customer for a client, or a storage path from a request.
 */
export class TicketAttachmentService {
  constructor(
    private readonly repo: TicketAttachmentRepository,
    private readonly storage: StorageRepository
  ) {}

  /** Books the upload in the database, then hands out the one signed upload for it. */
  async beginUpload(body: unknown): Promise<TicketUploadTicket> {
    const i = parse(ticketUploadSchema, body);
    const row = await this.repo.beginUpload(i.ticketId ?? null, i.customerId ?? null, i.fileName, i.mimeType, i.sizeBytes);
    try {
      const target = await this.storage.createUploadTarget(row.id, row.storage_bucket, row.storage_path, row.mime_type, TABLE);
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
  async completeUpload(id: string): Promise<TicketAttachment> {
    const attId = parse(uuidSchema, id);
    const row = await this.repo.pendingUpload(attId);
    const object = await this.storage.inspectFile(row.storage_provider, row.storage_bucket, row.storage_path, row.mime_type);
    if (!object.exists) {
      await this.discard(row);
      throw new AppError('VALIDATION_ERROR', 'The file did not finish uploading. Please try again.');
    }
    if (!object.matches) {
      await this.discard(row);
      throw new AppError('VALIDATION_ERROR', 'The file content does not match its type. Please attach the original file.');
    }
    try {
      await this.storage.attest(TABLE, attId, object);
      const done = await this.repo.completeUpload(attId, object.size, object.etag);
      await this.storage.recordStored(attId, row.storage_provider, { reference: object.reference, etag: object.etag }, TABLE);
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

  private async discard(row: TicketAttachmentRow) {
    await this.repo.abortUpload(row.id).catch(() => undefined);
    await this.storage.remove(row.storage_bucket, [row.storage_path], row.storage_provider).catch(() => undefined);
  }

  /** The files of one ticket the caller may see (a client never sees a file on an internal note). */
  forTicket(ticketId: string) { return this.repo.forTicket(parse(uuidSchema, ticketId)); }

  /** A short-lived link, issued only if the database says this caller may read the message the file belongs to. */
  async attachmentUrl(id: string, query: unknown): Promise<ClientDocumentUrl> {
    const { action } = parse(clientFileQuerySchema, query ?? {});
    const row = await this.repo.attachmentFile(parse(uuidSchema, id));
    const url = await this.storage.signedDownloadUrl(row.storage_bucket, row.storage_path, FILE_URL_TTL_SECONDS, action === 'download' ? row.file_name : undefined, row.storage_provider);
    return { url, expiresInSeconds: FILE_URL_TTL_SECONDS, fileName: row.file_name };
  }
}
