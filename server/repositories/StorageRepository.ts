import { getServiceClient } from '../db/supabase.js';
import { AppError } from '../http/errors.js';

/**
 * Supabase Storage access with the service role. Only ever called AFTER a
 * database function has authorized the caller for the specific document, and
 * only with paths read back from the database - never paths sent by clients.
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
   * Confirms the uploaded object exists and that its first bytes match the
   * declared type (file signature - never the name or the declared type alone).
   * Returns its stored size.
   */
  async inspectFile(
    bucket: string,
    path: string,
    mimeType: string
  ): Promise<{ exists: false } | { exists: true; size: number; matches: boolean }> {
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
    const head = Buffer.from(await res.arrayBuffer()).subarray(0, 1024);
    return { exists: true, size, matches: matchesSignature(head, mimeType) };
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

/** Does the start of a file look like the given type? */
export function matchesSignature(head: Buffer, mimeType: string): boolean {
  const ascii = (from: number, to: number) => head.subarray(from, to).toString('latin1');
  switch (mimeType) {
    case 'application/pdf':
      return head.toString('latin1').includes('%PDF-');
    case 'image/png':
      return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'audio/wav':
      return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
    case 'audio/mp4':
      return ascii(4, 8) === 'ftyp';
    case 'audio/mpeg':
      return ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
    case 'text/csv': {
      // Plain text: no NUL bytes and valid UTF-8 (ignoring a cut-off final character).
      if (head.length === 0 || head.includes(0)) return false;
      const text = new TextDecoder('utf-8', { fatal: false }).decode(head);
      return !text.slice(0, -1).includes('\uFFFD');
    }
    default:
      return false;
  }
}
