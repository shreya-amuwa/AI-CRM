import type { ClientDocumentUrl, HrEmployeeFile, HrEmployeeFileUploadTicket } from '../../shared/contracts.js';
import { clientFileQuerySchema, hrEmployeeFileListQuerySchema, hrEmployeeFileUploadSchema, uuidSchema } from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import type { HrEmployeeFileRepository, HrEmployeeFileRow } from '../repositories/HrEmployeeFileRepository.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

const FILE_URL_TTL_SECONDS = 120;
const TABLE = 'hr_employee_files';

const toFile = (r: HrEmployeeFileRow): HrEmployeeFile => ({
  id: r.id, employeeKey: r.employee_key, kind: r.kind, leaveRef: r.leave_ref, note: r.note, fileName: r.file_name,
  mimeType: r.mime_type as HrEmployeeFile['mimeType'], sizeBytes: Number(r.size_bytes), uploadedBy: r.uploaded_by_name, createdAt: r.created_at
});

/**
 * Documents on an employee's HR profile (ID proofs, employment papers, certificates, leave mails). The database decides who may
 * upload (HR staff) and read (HR staff, or the employee for their own files) and enforces the limits (5 MB, PDF / JPG / PNG /
 * DOCX / EML); this layer validates input, issues the signed upload / download links AFTER the database allowed them, looks at
 * the stored object before it counts, and removes the stored object when HR deletes a file. File bytes never touch the database.
 */
export class HrEmployeeFileService {
  constructor(
    private readonly repo: HrEmployeeFileRepository,
    private readonly storage: StorageRepository
  ) {}

  /** Books the upload in the database, then hands out the one signed upload for it. */
  async beginUpload(body: unknown): Promise<HrEmployeeFileUploadTicket> {
    const i = parse(hrEmployeeFileUploadSchema, body);
    const row = await this.repo.beginUpload(i);
    try {
      const target = await this.storage.createUploadTarget(row.id, row.storage_bucket, row.storage_path, row.mime_type, TABLE);
      return {
        file: toFile(row),
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
  async completeUpload(id: string): Promise<HrEmployeeFile> {
    const fileId = parse(uuidSchema, id);
    const row = await this.repo.pendingUpload(fileId);
    const object = await this.storage.inspectFile(row.storage_provider, row.storage_bucket, row.storage_path, row.mime_type);
    if (!object.exists) {
      await this.discard(row);
      throw new AppError('VALIDATION_ERROR', 'The file did not finish uploading. Please try again.');
    }
    if (!object.matches) {
      await this.discard(row);
      throw new AppError('VALIDATION_ERROR', 'The file content does not match its type. Please upload the original file.');
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

  private async discard(row: HrEmployeeFileRow) {
    await this.repo.abortUpload(row.id).catch(() => undefined);
    await this.storage.remove(row.storage_bucket, [row.storage_path], row.storage_provider).catch(() => undefined);
  }

  /** An employee's files (HR staff: anyone; everybody else: only their own). */
  list(query: unknown): Promise<HrEmployeeFile[]> {
    const { employeeKey } = parse(hrEmployeeFileListQuerySchema, query ?? {});
    return this.repo.list(employeeKey);
  }

  /** A short-lived link, issued only if the database says this caller may read the file (every opening is audited). */
  async fileUrl(id: string, query: unknown): Promise<ClientDocumentUrl> {
    const { action } = parse(clientFileQuerySchema, query ?? {});
    const row = await this.repo.download(parse(uuidSchema, id));
    const url = await this.storage.signedDownloadUrl(row.storage_bucket, row.storage_path, FILE_URL_TTL_SECONDS, action === 'download' ? row.file_name : undefined, row.storage_provider);
    return { url, expiresInSeconds: FILE_URL_TTL_SECONDS, fileName: row.file_name };
  }

  /** HR deletes a file: the database marks it deleted (kept for the audit trail), then the stored object is removed. */
  async remove(id: string): Promise<null> {
    const row = await this.repo.remove(parse(uuidSchema, id));
    const removed = await this.storage.remove(row.storage_bucket, [row.storage_path], row.storage_provider).catch(() => false);
    if (!removed) console.error('[hr-files] the stored object could not be removed; the row keeps its path for a later purge', { id: row.id });
    return null;
  }
}
