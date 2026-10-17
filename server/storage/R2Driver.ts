import { AppError } from '../http/errors.js';
import { r2Settings } from './config.js';
import { presignUrl } from './sigv4.js';
import { matchesSignature } from './signature.js';
import type { InspectResult, StorageDriver, UploadTarget } from './types.js';

const UPLOAD_URL_SECONDS = 15 * 60;
const INTERNAL_URL_SECONDS = 60;

/**
 * Cloudflare R2 through its S3 API, with presigned URLs only (no SDK, no long-lived credentials in the browser).
 * One R2 bucket holds everything; the logical bucket name (e.g. customer-documents) is the first part of the object key.
 */
export class R2Driver implements StorageDriver {
  readonly provider = 'R2' as const;

  private settings() {
    const s = r2Settings();
    if (!s) throw new AppError('SERVICE_UNAVAILABLE', 'File storage is not configured on the server.');
    return s;
  }

  private key(bucket: string, path: string): string {
    return `${bucket}/${path}`;
  }

  private url(method: 'GET' | 'PUT' | 'HEAD' | 'DELETE', bucket: string, path: string, expires: number, extra?: { query?: Record<string, string>; signedHeaders?: Record<string, string> }): string {
    const s = this.settings();
    return presignUrl({
      method,
      host: s.host,
      protocol: s.protocol,
      path: `/${s.bucket}/${this.key(bucket, path)}`,
      accessKeyId: s.accessKeyId,
      secretAccessKey: s.secretAccessKey,
      expiresSeconds: expires,
      query: extra?.query,
      signedHeaders: extra?.signedHeaders
    });
  }

  reference(bucket: string, path: string): string {
    return `r2://${this.settings().bucket}/${this.key(bucket, path)}`;
  }

  async createUploadTarget(bucket: string, path: string, mimeType: string): Promise<UploadTarget> {
    const headers = { 'content-type': mimeType };
    return { provider: 'R2', url: this.url('PUT', bucket, path, UPLOAD_URL_SECONDS, { signedHeaders: headers }), headers: { 'Content-Type': mimeType } };
  }

  async inspect(bucket: string, path: string, mimeType: string): Promise<InspectResult> {
    let head: Response;
    try {
      head = await fetch(this.url('HEAD', bucket, path, INTERNAL_URL_SECONDS), { method: 'HEAD' });
    } catch (e) {
      console.error('[r2] HEAD failed', (e as Error).message);
      throw new AppError('SERVICE_UNAVAILABLE', 'File storage is not available right now. Please try again.');
    }
    if (head.status === 404) return { exists: false };
    if (!head.ok) {
      console.error('[r2] HEAD status', head.status);
      throw new AppError('SERVICE_UNAVAILABLE', 'File storage is not available right now. Please try again.');
    }
    const size = Number(head.headers.get('content-length') ?? 0);
    const etag = (head.headers.get('etag') || '').replace(/^"|"$/g, '') || null;
    const contentType = head.headers.get('content-type');
    const first = await fetch(this.url('GET', bucket, path, INTERNAL_URL_SECONDS), { headers: { Range: 'bytes=0-1023' } });
    if (!first.ok && first.status !== 206) throw new AppError('SERVICE_UNAVAILABLE', 'File storage is not available right now. Please try again.');
    const bytes = Buffer.from(await first.arrayBuffer()).subarray(0, 1024);
    return { exists: true, size, etag, contentType, matches: matchesSignature(bytes, mimeType) };
  }

  async signedDownloadUrl(bucket: string, path: string, expiresIn: number, opts: { downloadName?: string }): Promise<string> {
    const name = opts.downloadName;
    const disposition = name
      ? `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`
      : 'inline';
    return this.url('GET', bucket, path, expiresIn, { query: { 'response-content-disposition': disposition } });
  }

  async put(bucket: string, path: string, body: Uint8Array, mimeType: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(this.url('PUT', bucket, path, UPLOAD_URL_SECONDS, { signedHeaders: { 'content-type': mimeType } }), {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body,
        signal: AbortSignal.timeout(20_000)
      });
    } catch (e) {
      console.error('[r2] PUT failed', (e as Error).message);
      throw new AppError('SERVICE_UNAVAILABLE', 'File storage is not available right now. Please try again.');
    }
    if (!res.ok) {
      console.error('[r2] PUT status', res.status);
      throw new AppError('SERVICE_UNAVAILABLE', 'File storage is not available right now. Please try again.');
    }
  }

  async read(bucket: string, path: string): Promise<Uint8Array> {
    let res: Response;
    try {
      res = await fetch(this.url('GET', bucket, path, INTERNAL_URL_SECONDS), { signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      console.error('[r2] GET failed', (e as Error).message);
      throw new AppError('SERVICE_UNAVAILABLE', 'File storage is not available right now. Please try again.');
    }
    if (!res.ok) throw new AppError(res.status === 404 ? 'NOT_FOUND' : 'SERVICE_UNAVAILABLE', res.status === 404 ? 'The stored file was not found.' : 'File storage is not available right now. Please try again.');
    return new Uint8Array(await res.arrayBuffer());
  }

  async remove(bucket: string, paths: string[]): Promise<boolean> {
    let ok = true;
    for (const path of paths) {
      try {
        const res = await fetch(this.url('DELETE', bucket, path, INTERNAL_URL_SECONDS), { method: 'DELETE' });
        if (!res.ok && res.status !== 404) {
          console.error('[r2] DELETE failed', { path, status: res.status });
          ok = false;
        }
      } catch (e) {
        console.error('[r2] DELETE failed', { path, message: (e as Error).message });
        ok = false;
      }
    }
    return ok;
  }
}
