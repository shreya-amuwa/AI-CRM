import type { SupabaseClient } from '@supabase/supabase-js';
import type { HrDocType, HrDocument, HrDocPrefill } from '../../shared/contracts.js';
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

  /** Where the stored file lives (and writes the audit entry for opening it). */
  get(id: string) {
    return this.rpc<{ id: string; fileName: string; storageProvider: 'SUPABASE' | 'R2'; storageBucket: string; storagePath: string }>('hr_document_get', { p_id: id });
  }
}
