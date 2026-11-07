import { createHash, randomUUID } from 'node:crypto';
import type { HrDocPrefill, HrDocPreview, HrDocument, HrDocumentDownload, HrDocType } from '../../shared/contracts.js';
import { hrDocListQuerySchema, hrDocPrefillQuerySchema, hrDocRequestSchema, uuidSchema } from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { DEFAULT_SIGNATORY, EXPERIENCE_FILE_PREFIX, NDA_FILE_PREFIX, renderExperiencePdf, renderNdaPdf } from '../hrDocuments/render.js';
import type { HrDocumentRepository } from '../repositories/HrDocumentRepository.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

export const HR_DOCUMENT_BUCKET = 'hr-documents';
const DOWNLOAD_TTL_SECONDS = 120;

/** "Priya Sharma" -> "Priya-Sharma" (file names carry only letters, digits and hyphens). */
const slug = (s: string) => s.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'Employee';

/**
 * NDA and Experience Letter. The employee, the code and the joining date always come from the HR record (the database function checks the caller
 * is HR staff and that this employee may get this letter); the browser sends only the values HR may edit. The preview and the stored file are
 * made by the same renderer from the same values, so what HR previews is what is stored.
 */
export class HrDocumentService {
  constructor(private readonly repo: HrDocumentRepository, private readonly storage: StorageRepository) {}

  async prefill(query: unknown): Promise<HrDocPrefill> {
    const q = parse(hrDocPrefillQuerySchema, query);
    return { ...(await this.repo.prefill(q.employeeKey, q.type)), signatory: { ...DEFAULT_SIGNATORY } };
  }

  /** Verifies the employee against the record, then draws the PDF. Returns what the database keeps next to the file. */
  private async make(body: unknown) {
    const req = parse(hrDocRequestSchema, body);
    const p = await this.repo.prefill(req.employeeKey, req.type);
    if (!p.ready) throw new AppError('VALIDATION_ERROR', p.problems[0]?.message ?? 'This letter cannot be made for this employee.');
    const e = p.employee;
    if (req.type === 'NDA') {
      return { req, e, fields: { ...req.fields }, bytes: await renderNdaPdf(req.fields), fileName: `${NDA_FILE_PREFIX}-${slug(e.name)}-${req.fields.letterDate}.pdf` };
    }
    const f = req.fields;
    if (!e.joiningDate) throw new AppError('VALIDATION_ERROR', 'The HR record has no joining date.');
    if (f.lastWorkingDate < e.joiningDate) throw new AppError('VALIDATION_ERROR', 'The last working date is before the joining date on record.');
    if (f.letterDate < f.lastWorkingDate) throw new AppError('VALIDATION_ERROR', 'The letter date cannot be before the last working date.');
    return {
      req, e,
      fields: { ...f, joiningDate: e.joiningDate },
      bytes: await renderExperiencePdf(f, e.joiningDate),
      fileName: `${EXPERIENCE_FILE_PREFIX}-${slug(e.name)}-${f.letterDate}.pdf`
    };
  }

  /** The PDF as it would be stored. Nothing is saved. */
  async preview(body: unknown): Promise<HrDocPreview> {
    const m = await this.make(body);
    return { fileName: m.fileName, pdfBase64: Buffer.from(m.bytes).toString('base64') };
  }

  async generate(body: unknown): Promise<HrDocument> {
    const m = await this.make(body);
    const id = randomUUID();
    const path = `${m.req.type.toLowerCase()}/${m.e.key.replace(/[^A-Za-z0-9_-]/g, '_')}/${id}.pdf`;
    const stored = await this.storage.storeGenerated(HR_DOCUMENT_BUCKET, path, m.bytes, 'application/pdf');
    try {
      return await this.repo.record({
        employeeKey: m.req.employeeKey, type: m.req.type, fields: m.fields, fileName: m.fileName,
        provider: stored.provider, bucket: HR_DOCUMENT_BUCKET, path, reference: stored.reference, etag: stored.etag, size: stored.size,
        sha256: createHash('sha256').update(m.bytes).digest('hex')
      });
    } catch (err) {
      // no row: no orphan file either
      await this.storage.remove(HR_DOCUMENT_BUCKET, [path], stored.provider).catch(() => undefined);
      throw err;
    }
  }

  list(query: unknown): Promise<HrDocument[]> {
    const q = parse(hrDocListQuerySchema, query);
    return this.repo.list(q.employeeKey ?? null, (q.type as HrDocType | undefined) ?? null);
  }

  /** A short-lived link to one stored document (the database checks HR staff and audits the opening). */
  async download(id: string): Promise<HrDocumentDownload> {
    const d = await this.repo.get(parse(uuidSchema, id));
    return { fileName: d.fileName, url: await this.storage.signedDownloadUrl(d.storageBucket, d.storagePath, DOWNLOAD_TTL_SECONDS, d.fileName, d.storageProvider) };
  }
}
