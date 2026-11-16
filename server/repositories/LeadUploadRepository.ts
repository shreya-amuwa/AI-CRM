import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeadUploadBatch, LeadUploadCheckResult, LeadUploadChunkResult, LeadUploadIssues } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** Upload Leads: one database function per call; the database decides who may upload and who may own each lead. */
export class LeadUploadRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
    return unwrap(await this.db.rpc(name, args)) as T;
  }

  check(rows: unknown[]) { return this.rpc<LeadUploadCheckResult>('lead_upload_check', { p_rows: rows }); }
  start(i: { clientRequestId: string; fileName: string; fileType: 'XLSX' | 'CSV'; fileHash: string; totalRows: number }) {
    return this.rpc<LeadUploadBatch>('lead_upload_start', {
      p_request: i.clientRequestId, p_file_name: i.fileName, p_file_type: i.fileType, p_hash: i.fileHash, p_total: i.totalRows
    });
  }
  rows(batchId: string, rows: unknown[]) { return this.rpc<LeadUploadChunkResult>('lead_upload_rows', { p_batch: batchId, p_rows: rows }); }
  finish(batchId: string) { return this.rpc<LeadUploadBatch>('lead_upload_finish', { p_batch: batchId }); }
  history() { return this.rpc<LeadUploadBatch[]>('lead_upload_history', { p_limit: 20 }); }
  issues(batchId: string) { return this.rpc<LeadUploadIssues>('lead_upload_issues', { p_batch: batchId }); }
}
