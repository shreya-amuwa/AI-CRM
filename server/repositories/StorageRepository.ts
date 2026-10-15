import { getServiceClient } from '../db/supabase.js';
import { activeProviderName } from '../storage/config.js';
import { R2Driver } from '../storage/R2Driver.js';
import { SupabaseDriver } from '../storage/SupabaseDriver.js';
import type { InspectResult, StorageDriver, StorageProviderName, UploadTarget } from '../storage/types.js';

export { matchesSignature } from '../storage/signature.js';
export type { InspectResult, StorageProviderName, UploadTarget } from '../storage/types.js';

const drivers: Record<StorageProviderName, StorageDriver> = { SUPABASE: new SupabaseDriver(), R2: new R2Driver() };

/**
 * File storage for customer documents and invoice PDFs. Only ever called AFTER a database function has authorized the
 * caller for the specific document, and only with paths read back from the database - never paths sent by clients.
 *
 * New files go to the active provider (Cloudflare R2 when configured). Every document row records WHERE its file lives
 * (storage_provider) and the reference of the stored object (storage_ref, storage_etag), so old files in Supabase Storage
 * and new files in R2 keep working side by side.
 */
export class StorageRepository {
  /** The provider new uploads use. */
  active(): StorageDriver {
    return drivers[activeProviderName()];
  }

  driver(provider: StorageProviderName | null | undefined): StorageDriver {
    return drivers[provider === 'R2' ? 'R2' : 'SUPABASE'];
  }

  /** A single-use way for the browser to upload exactly this one file; the provider is remembered on the document row. */
  async createUploadTarget(documentId: string, bucket: string, path: string, mimeType: string): Promise<UploadTarget> {
    const driver = this.active();
    const target = await driver.createUploadTarget(bucket, path, mimeType);
    await this.setReference(documentId, { storage_provider: driver.provider, storage_ref: driver.reference(bucket, path) });
    return target;
  }

  /**
   * Confirms the uploaded object exists and that its first bytes match the declared type. Returns its stored size,
   * the provider's ETag and the object's reference.
   */
  async inspectFile(provider: StorageProviderName | null | undefined, bucket: string, path: string, mimeType: string): Promise<InspectResult & { reference?: string }> {
    const driver = this.driver(provider);
    const result = await driver.inspect(bucket, path, mimeType);
    return result.exists ? { ...result, reference: driver.reference(bucket, path) } : result;
  }

  /** The reference of a stored file, kept in Supabase next to the document: where it lives, its key and its ETag. */
  async recordStored(documentId: string, provider: StorageProviderName | null | undefined, info: { reference?: string; etag: string | null }): Promise<void> {
    await this.setReference(documentId, { storage_provider: this.driver(provider).provider, storage_ref: info.reference, storage_etag: info.etag });
  }

  private async setReference(documentId: string, fields: Record<string, unknown>): Promise<void> {
    const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const { error } = await getServiceClient().from('customer_documents').update(clean).eq('id', documentId);
    if (error) console.error('[storage] could not record the file reference', { documentId, message: error.message });
  }

  /** Which provider holds a stored file (looked up from the database by its path). Unknown / old rows are Supabase. */
  async providerOfPath(bucket: string, path: string): Promise<StorageProviderName> {
    const { data } = await getServiceClient()
      .from('customer_documents')
      .select('storage_provider')
      .eq('storage_bucket', bucket)
      .eq('storage_path', path)
      .limit(1)
      .maybeSingle();
    return (data as { storage_provider?: string } | null)?.storage_provider === 'R2' ? 'R2' : 'SUPABASE';
  }

  async signedDownloadUrl(bucket: string, path: string, expiresIn: number, downloadName?: string, provider?: StorageProviderName | null): Promise<string> {
    const p = provider ?? (await this.providerOfPath(bucket, path));
    return this.driver(p).signedDownloadUrl(bucket, path, expiresIn, { downloadName });
  }

  /** Best effort; failures are logged (metadata keeps the path for a later purge). Without a known provider both are tried. */
  async remove(bucket: string, paths: string[], provider?: StorageProviderName | null): Promise<boolean> {
    if (!paths.length) return true;
    if (provider) return this.driver(provider).remove(bucket, paths);
    const results = await Promise.all([drivers.R2, drivers.SUPABASE].map(d => d.remove(bucket, paths).catch(() => false)));
    return results.some(Boolean);
  }

  /** Marks abandoned uploads FAILED and removes their objects (wherever they were going to be). */
  async expireStaleUploads(bucket: string): Promise<void> {
    const { data, error } = await getServiceClient().rpc('expire_stale_document_uploads');
    if (error) return console.error('[storage] expire stale uploads failed', error.message);
    const paths = (data as unknown as string[]) || [];
    if (paths.length) await this.remove(bucket, paths);
  }
}
