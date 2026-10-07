import { getServiceClient } from '../db/supabase.js';
import { AppError } from '../http/errors.js';

/**
 * Supabase Storage access with the service role. Only ever called AFTER a
 * database function has authorized the caller for the specific document, and
 * only with paths read back from the database — never paths sent by clients.
 */
export class StorageRepository {
  private bucket(name: string) {
    return getServiceClient().storage.from(name);
  }

  /** A single-use URL that lets the browser upload exactly this one path. */
  async createUploadToken(bucket: string, path: string): Promise<string> {
    const { data, error } = await this.bucket(bucket).createSignedUploadUrl(path);
    if (error || !data) {
      console.error('[storage] createSignedUploadUrl failed', error?.message);
      throw new AppError('SERVICE_UNAVAILABLE', 'File storage is not available right now. Please try again.');
    }
    return data.token;
  }

  /**
   * Confirms the uploaded object exists and really is a PDF (checks the file
   * signature, not the name or the declared type). Returns its stored size.
   */
  async inspectPdf(bucket: string, path: string): Promise<{ exists: false } | { exists: true; size: number; isPdf: boolean }> {
    const slash = path.lastIndexOf('/');
    const folder = path.slice(0, slash);
    const name = path.slice(slash + 1);
    const { data, error } = await this.bucket(bucket).list(folder, { search: name, limit: 10 });
    if (error) {
      console.error('[storage] list failed', error.message);
      throw new AppError('SERVICE_UNAVAILABLE', 'File storage is not available right now. Please try again.');
    }
    const object = (data || []).find(o => o.name === name);
    if (!object) return { exists: false };
    const size = Number((object.metadata as any)?.size ?? 0);

    const signed = await this.bucket(bucket).createSignedUrl(path, 60);
    if (signed.error || !signed.data) throw new AppError('SERVICE_UNAVAILABLE');
    const res = await fetch(signed.data.signedUrl, { headers: { Range: 'bytes=0-1023' } });
    const head = Buffer.from(await res.arrayBuffer()).subarray(0, 1024).toString('latin1');
    return { exists: true, size, isPdf: head.includes('%PDF-') && head.indexOf('%PDF-') < 1024 };
  }

  async signedDownloadUrl(bucket: string, path: string, expiresIn: number, downloadName?: string): Promise<string> {
    const { data, error } = await this.bucket(bucket).createSignedUrl(path, expiresIn, downloadName ? { download: downloadName } : undefined);
    if (error || !data) {
      console.error('[storage] createSignedUrl failed', error?.message);
      throw new AppError('SERVICE_UNAVAILABLE', 'Could not open the file. Please try again.');
    }
    return data.signedUrl;
  }

  /** Best effort; failures are logged (metadata keeps the path for a later purge). */
  async remove(bucket: string, paths: string[]): Promise<boolean> {
    if (!paths.length) return true;
    const { error } = await this.bucket(bucket).remove(paths);
    if (error) console.error('[storage] remove failed', { paths, message: error.message });
    return !error;
  }

  /** Marks abandoned uploads FAILED and removes their objects. */
  async expireStaleUploads(bucket: string): Promise<void> {
    const { data, error } = await getServiceClient().rpc('expire_stale_document_uploads');
    if (error) return console.error('[storage] expire stale uploads failed', error.message);
    const paths = (data as unknown as string[]) || [];
    if (paths.length) await this.remove(bucket, paths);
  }
}
