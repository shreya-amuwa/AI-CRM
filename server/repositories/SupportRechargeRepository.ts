import type { SupabaseClient } from '@supabase/supabase-js';
import type { SupportRecharge, SupportRechargeList } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** A row of support_recharge_files as the upload / download functions return it. */
export interface RechargeFileRow {
  id: string;
  uploader_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  storage_bucket: string;
  storage_path: string;
  storage_provider: 'R2' | 'SUPABASE' | null;
}

/**
 * Support Recharges (20270228000200). Every call is a database function that decides from the caller's own login (Support staff only, and which
 * records); nothing here names a department, an owner or a storage path. The caller's own database client is used (row level security applies),
 * never the service key.
 */
export class SupportRechargeRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  list(q: { kind: string; search?: string; status?: string; from?: string; to?: string; min?: number; max?: number; limit: number; offset: number }) {
    return this.rpc<SupportRechargeList>('recharge_list', {
      p_kind: q.kind, p_search: q.search || null, p_status: q.status || null, p_from: q.from || null, p_to: q.to || null,
      p_min: q.min ?? null, p_max: q.max ?? null, p_limit: q.limit, p_offset: q.offset
    });
  }
  get(id: string) { return this.rpc<SupportRecharge>('recharge_get', { p_id: id }); }
  create(p: Record<string, unknown>) { return this.rpc<SupportRecharge>('recharge_create', { p }); }
  update(id: string, p: Record<string, unknown>) { return this.rpc<SupportRecharge>('recharge_update', { p_id: id, p }); }
  setStatus(id: string, status: string, note: string | null) { return this.rpc<SupportRecharge>('recharge_set_status', { p_id: id, p_status: status, p_note: note }); }

  // ---- the payment screenshot
  beginUpload(fileName: string, mime: string, size: number) { return this.rpc<RechargeFileRow>('recharge_begin_upload', { p_file_name: fileName, p_mime: mime, p_size: size }); }
  pendingUpload(id: string) { return this.rpc<RechargeFileRow>('recharge_pending_upload', { p_attachment: id }); }
  completeUpload(id: string, size: number, etag: string | null) {
    return this.rpc<{ id: string; name: string; mime: string; size: number }>('recharge_complete_upload', { p_attachment: id, p_size: size, p_etag: etag });
  }
  async abortUpload(id: string) { await this.rpc<null>('recharge_abort_upload', { p_attachment: id }); }
  attachmentFile(id: string) { return this.rpc<RechargeFileRow>('recharge_attachment_download', { p_attachment: id }); }
}
