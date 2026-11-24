import { createHash, randomUUID } from 'node:crypto';
import type {
  HrDocPrefill, HrDocPreview, HrDocument, HrDocumentDownload, HrDocType, HrLetterTemplateState, HrLetterTemplateVersion, HrRoleOfferFields, OfferLetterheadOption,
  OfferTemplate, OfferTemplateFile, OfferTemplateHistory, OfferTemplateList, OfferTemplateVersion
} from '../../shared/contracts.js';
import { DEFAULT_EXPERIENCE_CONTENT } from '../../shared/hrLetters.js';
import { checkOfferValues, isRealDate, type OfferLetterhead, type OfferTemplateContent } from '../../shared/offerTemplates.js';
import {
  hrDocListQuerySchema, hrDocPrefillQuerySchema, hrDocRequestSchema, hrLetterTemplateSaveSchema, hrLetterTemplateVersionParamSchema, hrLetterTypeSchema,
  OFFER_UPLOAD_MAX_BYTES, OFFER_UPLOAD_MIME, offerLetterheadSchema, offerTemplateContentSchema, offerTemplateFileUploadSchema, offerTemplateSaveSchema,
  offerTemplateVersionParamSchema, uuidSchema
} from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { DEFAULT_SIGNATORY, EXPERIENCE_FILE_PREFIX, NDA_FILE_PREFIX, OFFER_FILE_PREFIX } from '../hrDocuments/constants.js';
// The PDF drawing code (and pdf-lib) is loaded only when a letter is actually generated, not on every start of the API.
const pdfOffer = () => import('../hrDocuments/offer.js');
const pdfLetters = () => import('../hrDocuments/render.js');
const pdfOfferTemplate = () => import('../hrDocuments/offerTemplate.js');
const builtinLetterheads = () => import('../hrDocuments/offerLetterheads.js');
import type { HrDocumentRepository } from '../repositories/HrDocumentRepository.js';
import type { StorageRepository } from '../repositories/StorageRepository.js';

export const HR_DOCUMENT_BUCKET = 'hr-documents';
const DOWNLOAD_TTL_SECONDS = 120;

/** "Priya Sharma" -> "Priya-Sharma" (file names carry only letters, digits and hyphens). */
const slug = (s: string) => s.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'Employee';

/**
 * NDA, Experience Letter and Offer Letter. The employee, the code and the joining date always come from the HR record (the database function checks the caller
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
      return { req, e, fields: { ...req.fields }, bytes: await (await pdfLetters()).renderNdaPdf(req.fields), fileName: `${NDA_FILE_PREFIX}-${slug(e.name)}-${req.fields.letterDate}.pdf` };
    }
    if (req.type === 'OFFER') {
      const of = req.fields;
      // a role-based Offer Letter (a designation template, 20270206000100)
      if ('offerTemplateId' in of) return { req, e, ...(await this.makeRoleOffer(of, e)) };
      // the wording (a master version, possibly edited for this letter) is stored with the letter: a later master edit never changes it
      return { req, e, fields: { ...of }, bytes: await (await pdfOffer()).renderOfferPdf(of), fileName: `${OFFER_FILE_PREFIX}-${slug(e.name)}-${of.letterDate}.pdf` };
    }
    const f = req.fields;
    const content = f.content ?? DEFAULT_EXPERIENCE_CONTENT;
    const templateVersion = f.templateVersion ?? 1;
    if (!e.joiningDate) throw new AppError('VALIDATION_ERROR', 'The HR record has no joining date.');
    if (f.lastWorkingDate < e.joiningDate) throw new AppError('VALIDATION_ERROR', 'The last working date is before the joining date on record.');
    if (f.letterDate < f.lastWorkingDate) throw new AppError('VALIDATION_ERROR', 'The letter date cannot be before the last working date.');
    return {
      req, e,
      fields: { ...f, joiningDate: e.joiningDate, content, templateVersion },
      bytes: await (await pdfLetters()).renderExperiencePdf(f, e.joiningDate, content),
      fileName: `${EXPERIENCE_FILE_PREFIX}-${slug(e.name)}-${f.letterDate}.pdf`
    };
  }

  /**
   * A role-based Offer Letter: the template version comes from the database (never from the browser), the values are checked against that
   * template's own fields, the letterhead is the template's. What is stored with the letter: the template, its version, the wording it was made
   * with and the values, so the issued letter is never re-drawn from a later template.
   */
  private async makeRoleOffer(f: HrRoleOfferFields, e: HrDocPrefill['employee']) {
    const version = await this.repo.offerTemplateVersion(f.offerTemplateId, f.templateVersion);
    const content = parse(offerTemplateContentSchema, version.content) as OfferTemplateContent;
    const known = new Set(content.fields.map(x => x.key));
    const stray = Object.keys(f.values).filter(k => !known.has(k));
    if (stray.length) throw new AppError('VALIDATION_ERROR', `This template has no field "${stray[0]}". Reload the page.`);
    const { printed, errors } = checkOfferValues(content.fields, f.values);
    const firstError = Object.values(errors)[0];
    if (firstError) throw new AppError('VALIDATION_ERROR', firstError);
    const letterDate = content.fields.find(x => x.key === 'letterDate' && x.type === 'date') ? f.values.letterDate : new Date().toISOString().slice(0, 10);
    const letterhead = await this.letterheadOf(version.letterhead);
    const bytes = await (await pdfOfferTemplate()).renderOfferTemplatePdf({
      content, values: printed, letterhead, documentTitle: version.designation ? `Offer Letter – ${version.designation}` : 'Offer Letter', letterDateIso: letterDate
    });
    const name = (f.values.employeeName ?? '').trim() || e.name;
    const fields: Record<string, unknown> = {
      offerTemplateId: f.offerTemplateId, templateKey: version.key, templateDesignation: version.designation, templateVersion: f.templateVersion,
      values: f.values, content, employeeName: name, letterDate,
      ...(f.values.designation ? { designation: f.values.designation } : {}),
      ...(f.values.joiningDate && isRealDate(f.values.joiningDate) ? { joiningDate: f.values.joiningDate } : {})
    };
    return { fields, bytes, fileName: `${OFFER_FILE_PREFIX}-${slug(version.designation)}-${slug(name)}-${letterDate}.pdf` };
  }

  /** The letterhead page and where to write on it: a bundled one (from a supplied sample) or a PDF HR uploaded (read from private storage). */
  private async letterheadOf(l: OfferLetterhead) {
    if ('builtin' in l) {
      const lh = (await builtinLetterheads()).OFFER_LETTERHEADS[l.builtin];
      if (!lh) throw new AppError('VALIDATION_ERROR', 'The template\'s letterhead does not exist.');
      return { bytes: Buffer.from(lh.base64, 'base64'), layout: lh.layout };
    }
    const file = await this.repo.offerTemplateFile(l.fileId);
    const url = await this.storage.signedDownloadUrl(file.storageBucket, file.storagePath, 60, undefined, file.storageProvider);
    const res = await fetch(url);
    if (!res.ok) throw new AppError('INTERNAL', 'The template\'s letterhead could not be opened. Try again.');
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 5_242_880) throw new AppError('VALIDATION_ERROR', 'The letterhead PDF is too large.');
    return { bytes, layout: (await pdfOfferTemplate()).DEFAULT_LETTERHEAD_LAYOUT };
  }

  // ---- Role-based Offer Letter templates (20270206000100) ----------------------------------------------------------------------------------
  offerTemplates(): Promise<OfferTemplateList> { return this.repo.offerTemplates(); }
  offerTemplateHistory(id: string): Promise<OfferTemplateHistory> { return this.repo.offerTemplateHistory(parse(uuidSchema, id)); }
  offerTemplateVersion(id: string, version: string): Promise<OfferTemplateVersion> {
    return this.repo.offerTemplateVersion(parse(uuidSchema, id), parse(offerTemplateVersionParamSchema, version)) as Promise<OfferTemplateVersion>;
  }
  async offerLetterheads(): Promise<OfferLetterheadOption[]> {
    return Object.entries((await builtinLetterheads()).OFFER_LETTERHEADS).map(([key, v]) => ({ key, label: v.label }));
  }
  /** A new designation template (id null) or a new version of one (Super Admin / HR Admin Head; the database checks who and the version). */
  saveOfferTemplate(id: string | null, body: unknown): Promise<OfferTemplate> {
    const b = parse(offerTemplateSaveSchema, body);
    return this.repo.saveOfferTemplate({
      templateId: id === null ? null : parse(uuidSchema, id), designation: b.designation, description: b.description ?? null, content: b.content,
      letterhead: b.letterhead, sampleFileId: b.sampleFileId ?? null, baseVersion: b.baseVersion, note: b.note ?? null
    });
  }
  /** A template drawn with each field shown as [its label]: what the wording and letterhead look like before any letter is made. */
  async previewOfferTemplate(body: unknown): Promise<HrDocPreview> {
    const b = parse(offerTemplateSaveSchema.pick({ content: true, letterhead: true, designation: true }), body);
    const content = b.content as OfferTemplateContent;
    const values: Record<string, string> = {};
    for (const fd of content.fields) { values[fd.key] = `[${fd.label}]`; if (fd.type === 'money') values[`${fd.key}Words`] = `[${fd.label} in words]`; }
    const bytes = await (await pdfOfferTemplate()).renderOfferTemplatePdf({
      content, values, letterhead: await this.letterheadOf(parse(offerLetterheadSchema, b.letterhead)), documentTitle: `Offer Letter – ${b.designation}`, letterDateIso: '2026-01-01'
    });
    return { fileName: `Offer-Letter-Template-${slug(b.designation)}.pdf`, pdfBase64: Buffer.from(bytes).toString('base64') };
  }
  /** A sample document (PDF / Word) or a letterhead (PDF): its real type and size are checked, it is stored privately, then recorded. */
  async uploadOfferTemplateFile(body: unknown): Promise<OfferTemplateFile> {
    const b = parse(offerTemplateFileUploadSchema, body);
    const bytes = new Uint8Array(Buffer.from(b.dataBase64, 'base64'));
    if (!bytes.length || bytes.length > OFFER_UPLOAD_MAX_BYTES) throw new AppError('VALIDATION_ERROR', 'The file must be at most 2.5 MB.');
    const head = Buffer.from(bytes.subarray(0, 5)).toString('latin1');
    if (b.mimeType === OFFER_UPLOAD_MIME.pdf) {
      if (head !== '%PDF-') throw new AppError('VALIDATION_ERROR', 'That file is not a PDF.');
      if (b.kind === 'LETTERHEAD') {
        const { PDFDocument } = await import('pdf-lib');
        try {
          const d = await PDFDocument.load(bytes);
          if (d.getPageCount() < 1) throw new Error('no page');
        } catch {
          throw new AppError('VALIDATION_ERROR', 'The letterhead PDF cannot be read (it may be protected or damaged).');
        }
      }
    } else if (!(head.startsWith('PK') && Buffer.from(bytes).includes('word/document.xml'))) {
      throw new AppError('VALIDATION_ERROR', 'That file is not a Word (.docx) document.');
    }
    const id = randomUUID();
    const path = `offer-templates/${b.kind.toLowerCase()}/${id}${b.mimeType === OFFER_UPLOAD_MIME.pdf ? '.pdf' : '.docx'}`;
    const stored = await this.storage.storeGenerated(HR_DOCUMENT_BUCKET, path, bytes, b.mimeType);
    try {
      return await this.repo.recordOfferTemplateFile({
        kind: b.kind, fileName: b.fileName, mimeType: b.mimeType, size: stored.size, provider: stored.provider, bucket: HR_DOCUMENT_BUCKET, path,
        reference: stored.reference, sha256: createHash('sha256').update(bytes).digest('hex')
      });
    } catch (err) {
      await this.storage.remove(HR_DOCUMENT_BUCKET, [path], stored.provider).catch(() => undefined);
      throw err;
    }
  }
  /** A short-lived link to an uploaded sample / letterhead (to preview it). */
  async offerTemplateFileUrl(id: string): Promise<HrDocumentDownload> {
    const f = await this.repo.offerTemplateFile(parse(uuidSchema, id));
    return { fileName: f.fileName, url: await this.storage.signedDownloadUrl(f.storageBucket, f.storagePath, DOWNLOAD_TTL_SECONDS, f.fileName, f.storageProvider) };
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

  /** The current master template of a letter, and its versions (HR staff; the database says whether the caller may save a new version). */
  templateState(type: string): Promise<HrLetterTemplateState> {
    return this.repo.templateState(parse(hrLetterTypeSchema, type));
  }
  templateVersion(type: string, version: string): Promise<HrLetterTemplateVersion> {
    return this.repo.templateVersion(parse(hrLetterTypeSchema, type), parse(hrLetterTemplateVersionParamSchema, version));
  }
  /** A new version of a master template (Super Admin / HR Admin Head). Letters already issued keep the wording they were made with. */
  saveTemplate(type: string, body: unknown): Promise<HrLetterTemplateVersion> {
    const b = parse(hrLetterTemplateSaveSchema, { ...(body as Record<string, unknown>), type: parse(hrLetterTypeSchema, type) });
    return this.repo.saveTemplate(b.type, b.content, b.baseVersion, b.note ?? null);
  }

  /** A short-lived link to one stored document (the database checks HR staff and audits the opening). */
  async download(id: string): Promise<HrDocumentDownload> {
    const d = await this.repo.get(parse(uuidSchema, id));
    return { fileName: d.fileName, url: await this.storage.signedDownloadUrl(d.storageBucket, d.storagePath, DOWNLOAD_TTL_SECONDS, d.fileName, d.storageProvider) };
  }
}
