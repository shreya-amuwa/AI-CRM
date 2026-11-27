import type { ClientDocumentUrl, RechargeUploadTicket, SupportRecharge, SupportRechargeList } from '../../shared/contracts.js';
import { clientFileQuerySchema, rechargeBodySchema, rechargeCreateSchema, rechargeListQuerySchema, rechargeStatusBodySchema, rechargeUploadSchema, uuidSchema } from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import type { RechargeFileRow, SupportRechargeRepository } from '../repositories/SupportRechargeRepository.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

/** The payment proof is opened through a link that works for 2 minutes. */
const FILE_URL_TTL_SECONDS = 120;
const TABLE = 'support_recharge_files';

/**
 * Support Recharges (Panel and Message). The database decides who may see, create, edit or change the status of which record, from the caller's own
 * login; this layer validates the input (the same Zod rules as the screen), issues the signed upload and view links AFTER the database allowed them,
 * looks at the stored object before a file is accepted, and never accepts a department, an owner, a total or a storage path from a request.
 */
export class SupportRechargeService {
  constructor(
    private readonly repo: SupportRechargeRepository,
    private readonly storage: StorageRepository
  ) {}

  list(query: unknown): Promise<SupportRechargeList> {
    const q = parse(rechargeListQuerySchema, query ?? {});
    return this.repo.list({ kind: q.kind, search: q.search, status: q.status || undefined, from: q.from || undefined, to: q.to || undefined, min: q.min, max: q.max, limit: q.limit, offset: q.offset });
  }
  get(id: string): Promise<SupportRecharge> { return this.repo.get(parse(uuidSchema, id)); }
  create(body: unknown): Promise<SupportRecharge> {
    const { kind, requestId, ...rest } = parse(rechargeCreateSchema, body);
    return this.repo.create({ kind, requestId: requestId ?? null, ...rest });
  }
  update(id: string, body: unknown): Promise<SupportRecharge> { return this.repo.update(parse(uuidSchema, id), parse(rechargeBodySchema, body)); }
  setStatus(id: string, body: unknown): Promise<SupportRecharge> {
    const b = parse(rechargeStatusBodySchema, body);
    return this.repo.setStatus(parse(uuidSchema, id), b.status, b.note);
  }

  // ---- the screenshot
  /** Books the upload in the database (it checks the person, the type and the size), then hands out the one signed upload for it. */
  async beginUpload(body: unknown): Promise<RechargeUploadTicket> {
    const i = parse(rechargeUploadSchema, body);
    const row = await this.repo.beginUpload(i.fileName, i.mimeType, i.sizeBytes);
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
  async completeUpload(id: string) {
    const fileId = parse(uuidSchema, id);
    const row = await this.repo.pendingUpload(fileId);
    const object = await this.storage.inspectFile(row.storage_provider, row.storage_bucket, row.storage_path, row.mime_type);
    if (!object.exists) {
      await this.discard(row);
      throw new AppError('VALIDATION_ERROR', 'The file did not finish uploading. Please try again.');
    }
    if (!object.matches) {
      await this.discard(row);
      throw new AppError('VALIDATION_ERROR', 'The file content does not match its type. Please upload the original screenshot.');
    }
    try {
      const done = await this.repo.completeUpload(fileId, object.size, object.etag);
      await this.storage.recordStored(fileId, row.storage_provider, { reference: object.reference, etag: object.etag }, TABLE);
      return done;
    } catch (err) {
      await this.discard(row);
      throw err;
    }
  }

  async abortUpload(id: string): Promise<null> {
    const fileId = parse(uuidSchema, id);
    const row = await this.repo.pendingUpload(fileId).catch(() => null);
    if (row) await this.discard(row);
    return null;
  }

  private async discard(row: RechargeFileRow) {
    await this.repo.abortUpload(row.id).catch(() => undefined);
    await this.storage.remove(row.storage_bucket, [row.storage_path], row.storage_provider).catch(() => undefined);
  }

  /** A short-lived link, issued only if the database says this caller may read the recharge the screenshot belongs to. */
  async screenshotUrl(id: string, query: unknown): Promise<ClientDocumentUrl> {
    const { action } = parse(clientFileQuerySchema, query ?? {});
    const row = await this.repo.attachmentFile(parse(uuidSchema, id));
    const url = await this.storage.signedDownloadUrl(row.storage_bucket, row.storage_path, FILE_URL_TTL_SECONDS, action === 'download' ? row.file_name : undefined, row.storage_provider);
    return { url, expiresInSeconds: FILE_URL_TTL_SECONDS, fileName: row.file_name };
  }
}
