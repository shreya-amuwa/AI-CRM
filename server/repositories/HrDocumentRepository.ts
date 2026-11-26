import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  HrDocType, HrDocument, HrDocPrefill, HrLetterTemplateState, HrLetterTemplateVersion, HrLetterType, OfferTemplate, OfferTemplateFile, OfferTemplateHistory,
  OfferTemplateList, OfferTemplateVersion
} from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** NDA / Experience Letter records. Every function is a database function that checks the caller is HR staff and re-checks the employee. */
export class HrDocumentRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return unwrap(await this.db.rpc(name, args)) as T;
  }

  prefill(employeeKey: string, type: HrDocType) {
    return this.rpc<Omit<HrDocPrefill, 'signatory'>>('hr_document_prefill', { p_employee_key: employeeKey, p_doc_type: type });
  }

  record(i: {
    employeeKey: string; type: HrDocType; fields: Record<string, unknown>; fileName: string;
    provider: string; bucket: string; path: string; reference: string; etag: string | null; size: number; sha256: string;
  }) {
    return this.rpc<HrDocument>('hr_document_record', {
      p_employee_key: i.employeeKey, p_doc_type: i.type, p_fields: i.fields, p_file_name: i.fileName, p_provider: i.provider,
      p_bucket: i.bucket, p_path: i.path, p_ref: i.reference, p_etag: i.etag, p_size: i.size, p_sha256: i.sha256
    });
  }

  list(employeeKey: string | null, type: HrDocType | null) {
    return this.rpc<HrDocument[]>('hr_documents_list', { p_employee_key: employeeKey, p_doc_type: type });
  }

  templateState(type: HrLetterType) { return this.rpc<HrLetterTemplateState>('hr_letter_template_state', { p_type: type }); }
  templateVersion(type: HrLetterType, version: number) { return this.rpc<HrLetterTemplateVersion>('hr_letter_template_version', { p_type: type, p_version: version }); }
  saveTemplate(type: HrLetterType, content: unknown, baseVersion: number, note: string | null) {
    return this.rpc<HrLetterTemplateVersion>('hr_letter_template_save', { p_type: type, p_content: content, p_base_version: baseVersion, p_note: note });
  }

  // ---- Role-based Offer Letter templates (20270206000100): HR staff read, the Super Admin / HR Admin Head save --------------------------------
  offerTemplates() { return this.rpc<OfferTemplateList>('hr_offer_templates_list', {}); }
  offerTemplateHistory(id: string) { return this.rpc<OfferTemplateHistory>('hr_offer_template_versions', { p_template: id }); }
  offerTemplateVersion(id: string, version: number) {
    return this.rpc<OfferTemplateVersion & { key: string; designation: string; content: unknown }>('hr_offer_template_version', { p_template: id, p_version: version });
  }
  saveOfferTemplate(i: { templateId: string | null; designation: string; description: string | null; content: unknown; letterhead: unknown; sampleFileId: string | null; baseVersion: number; note: string | null }) {
    return this.rpc<OfferTemplate>('hr_offer_template_save', {
      p_template: i.templateId, p_designation: i.designation, p_description: i.description, p_content: i.content, p_letterhead: i.letterhead,
      p_sample_file: i.sampleFileId, p_base_version: i.baseVersion, p_note: i.note
    });
  }
  recordOfferTemplateFile(i: { kind: 'SAMPLE' | 'LETTERHEAD'; fileName: string; mimeType: string; size: number; provider: string; bucket: string; path: string; reference: string; sha256: string }) {
    return this.rpc<OfferTemplateFile>('hr_offer_template_file_record', {
      p_kind: i.kind, p_file_name: i.fileName, p_mime: i.mimeType, p_size: i.size, p_provider: i.provider, p_bucket: i.bucket, p_path: i.path, p_ref: i.reference, p_sha256: i.sha256
    });
  }
  offerTemplateFile(id: string) {
    return this.rpc<OfferTemplateFile & { storageProvider: 'SUPABASE' | 'R2'; storageBucket: string; storagePath: string }>('hr_offer_template_file', { p_id: id });
  }

  /** Where the stored file lives (and writes the audit entry for opening it). */
  get(id: string) {
    return this.rpc<{ id: string; fileName: string; storageProvider: 'SUPABASE' | 'R2'; storageBucket: string; storagePath: string }>('hr_document_get', { p_id: id });
  }
}
