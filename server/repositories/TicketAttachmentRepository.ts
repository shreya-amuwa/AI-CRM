import type { SupabaseClient } from '@supabase/supabase-js';
import type { TicketAttachment } from '../../shared/contracts.js';
import { unwrap } from './base.js';

/** A row of support_ticket_attachments as the upload / download functions return it. */
export interface TicketAttachmentRow {
  id: string;
  customer_id: string;
  ticket_id: string | null;
  uploader_id: string | null;
  uploader_client: boolean;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  storage_bucket: string;
  storage_path: string;
  storage_provider: 'R2' | 'SUPABASE' | null;
}

/**
 * Files on support tickets. Each call is a database function that decides from the caller's own login (a client of the
 * ticket's customer, or an employee who may see the ticket); nothing here names an uploader or a storage path. The
 * caller's own database client is used (row level security applies), never the service key.
 */
export class TicketAttachmentRepository {
  constructor(private readonly db: SupabaseClient) {}

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    return unwrap(await this.db.rpc(fn, args)) as T;
  }

  beginUpload(ticketId: string | null, customerId: string | null, fileName: string, mime: string, size: number) {
    return this.rpc<TicketAttachmentRow>('ticket_begin_upload', { p_ticket: ticketId, p_customer: customerId, p_file_name: fileName, p_mime: mime, p_size: size });
  }
  pendingUpload(id: string) { return this.rpc<TicketAttachmentRow>('ticket_pending_upload', { p_attachment: id }); }
  completeUpload(id: string, size: number, etag: string | null) {
    return this.rpc<TicketAttachment>('ticket_complete_upload', { p_attachment: id, p_size: size, p_etag: etag });
  }
  async abortUpload(id: string) { await this.rpc<null>('ticket_abort_upload', { p_attachment: id }); }
  attachmentFile(id: string) { return this.rpc<TicketAttachmentRow>('ticket_attachment_download', { p_attachment: id }); }
  forTicket(ticketId: string) { return this.rpc<TicketAttachment[]>('ticket_attachments', { p_ticket: ticketId }); }
}
