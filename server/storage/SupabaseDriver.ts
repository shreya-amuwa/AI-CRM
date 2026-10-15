import { getServiceClient } from '../db/supabase.js';
import { AppError } from '../http/errors.js';
import { matchesSignature } from './signature.js';
import type { InspectResult, StorageDriver, UploadTarget } from './types.js';

/** Supabase Storage with the service role. Used for files stored before R2 and when STORAGE_PROVIDER=supabase. */
export class SupabaseDriver implements StorageDriver {
  readonly provider = 'SUPABASE' as const;

  private bucket(name: string) {
    return getServiceClient().storage.from(name);
  }

  reference(bucket: string, path: string): string {
    return `supabase://${bucket}/${path}`;
  }

  async createUploadTarget(bucket: string, path: string): Promise<UploadTarget> {
    const { data, error } = await this.bucket(bucket).createSignedUploadUrl(path);
    if (error || !data) {
      console.error('[storage] createSignedUploadUrl failed', error?.message);
      throw new AppError('SERVICE_UNAVAILABLE', 'File storage is not available right now. Please try again.');
    }
    return { provider: 'SUPABASE', token: data.token };
  }

  async inspect(bucket: string, path: string, mimeType: string): Promise<InspectResult> {
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
    const meta = (object.metadata ?? {}) as { size?: number; eTag?: string; mimetype?: string };
    const signed = await this.bucket(bucket).createSignedUrl(path, 60);
    if (signed.error || !signed.data) throw new AppError('SERVICE_UNAVAILABLE');
    const res = await fetch(signed.data.signedUrl, { headers: { Range: 'bytes=0-1023' } });
    const head = Buffer.from(await res.arrayBuffer()).subarray(0, 1024);
    return {
      exists: true,
      size: Number(meta.size ?? 0),
      etag: meta.eTag ? String(meta.eTag).replace(/^"|"$/g, '') : null,
      contentType: meta.mimetype ?? null,
      matches: matchesSignature(head, mimeType)
    };
  }

  async signedDownloadUrl(bucket: string, path: string, expiresIn: number, opts: { downloadName?: string }): Promise<string> {
    const { data, error } = await this.bucket(bucket).createSignedUrl(path, expiresIn, opts.downloadName ? { download: opts.downloadName } : undefined);
    if (error || !data) {
      console.error('[storage] createSignedUrl failed', error?.message);
      throw new AppError('SERVICE_UNAVAILABLE', 'Could not open the file. Please try again.');
    }
    return data.signedUrl;
  }

  async remove(bucket: string, paths: string[]): Promise<boolean> {
    const { error } = await this.bucket(bucket).remove(paths);
    if (error) console.error('[storage] remove failed', { paths, message: error.message });
    return !error;
  }
}
