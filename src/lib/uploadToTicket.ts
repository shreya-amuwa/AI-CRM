import type { DocumentUploadTicket } from '../../shared/contracts';
import { requireSupabase } from '../services/supabaseClient';

/**
 * Sends the file to wherever the server said it should go: straight to Cloudflare R2 with the presigned PUT the server
 * made for this one file, or (files stored before R2 / STORAGE_PROVIDER=supabase) to Supabase Storage.
 * Throws an Error with a readable message on failure.
 */
export async function uploadToTicket(ticket: DocumentUploadTicket, file: File, contentType: string): Promise<void> {
  if (ticket.provider === 'R2' && ticket.upload) {
    let res: Response;
    try {
      res = await fetch(ticket.upload.url, { method: 'PUT', headers: { ...ticket.upload.headers, 'Content-Type': contentType }, body: file });
    } catch {
      throw new Error('Upload failed: the browser could not reach file storage. Check your connection; if it keeps happening, ask your administrator to check the Cloudflare R2 CORS settings.');
    }
    if (!res.ok) throw new Error(`Upload failed (storage answered ${res.status}). Please try again.`);
    return;
  }
  const { error } = await requireSupabase()
    .storage.from(ticket.bucket)
    .uploadToSignedUrl(ticket.path, ticket.token, await file.arrayBuffer(), { contentType, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
}
