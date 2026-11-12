import type { SupabaseClient } from '@supabase/supabase-js';
import type { HrEmployeeFile, HrEmployeeFileKind } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** A row of hr_employee_files as the upload / download / delete functions return it. */
export interface HrEmployeeFileRow {
  id: string;
  employee_key: string;
  kind: HrEmployeeFileKind;
  leave_ref: string | null;
  note: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: 'PENDING' | 'READY' | 'FAILED';
  storage_bucket: string;
  storage_path: string;
  storage_provider: 'R2' | 'SUPABASE' | null;
  uploaded_by_name: string | null;
  created_at: string;
}

/**
 * Documents HR keeps on an employee's profile (migration 20261231000800_hr_employee_files.sql). Every call is a database
 * function that decides from the caller's own login (HR staff, or the employee reading their own files); nothing here names
 * an uploader or a storage path. The caller's own database client is used (row level security applies), never the service key.
 */
export class HrEmployeeFileRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  beginUpload(i: { employeeKey: string; kind: HrEmployeeFileKind; fileName: string; mimeType: string; sizeBytes: number; leaveRef: string | null; note: string | null }) {
    return this.rpc<HrEmployeeFileRow>('hr_employee_file_begin', {
      p_employee_key: i.employeeKey, p_kind: i.kind, p_file_name: i.fileName, p_mime: i.mimeType, p_size: i.sizeBytes, p_leave_ref: i.leaveRef, p_note: i.note
    });
  }
  pendingUpload(id: string) { return this.rpc<HrEmployeeFileRow>('hr_employee_file_pending', { p_id: id }); }
  completeUpload(id: string, size: number, etag: string | null) {
    return this.rpc<HrEmployeeFile>('hr_employee_file_complete', { p_id: id, p_size: size, p_etag: etag });
  }
  async abortUpload(id: string) { await this.rpc<null>('hr_employee_file_abort', { p_id: id }); }
  list(employeeKey: string) { return this.rpc<HrEmployeeFile[]>('hr_employee_files_list', { p_employee_key: employeeKey }); }
  /** Where a stored file lives (and writes the audit entry for opening it). */
  download(id: string) { return this.rpc<HrEmployeeFileRow>('hr_employee_file_download', { p_id: id }); }
  remove(id: string) { return this.rpc<HrEmployeeFileRow>('hr_employee_file_delete', { p_id: id }); }
}
