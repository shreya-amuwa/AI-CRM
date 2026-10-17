export type StorageProviderName = 'SUPABASE' | 'R2';

/** What the browser needs to upload one file: either a Supabase signed-upload token or a presigned PUT request. */
export interface UploadTarget {
  provider: StorageProviderName;
  /** Supabase only. */
  token?: string;
  /** R2 only: PUT the file body to this URL with exactly these headers. */
  url?: string;
  headers?: Record<string, string>;
}

export type InspectResult =
  | { exists: false }
  | { exists: true; size: number; matches: boolean; etag: string | null; contentType: string | null };

/** One place files can live. Paths are always the logical `bucket` + `path` stored in the database. */
export interface StorageDriver {
  readonly provider: StorageProviderName;
  createUploadTarget(bucket: string, path: string, mimeType: string): Promise<UploadTarget>;
  inspect(bucket: string, path: string, mimeType: string): Promise<InspectResult>;
  signedDownloadUrl(bucket: string, path: string, expiresIn: number, opts: { downloadName?: string }): Promise<string>;
  /** Stores bytes the SERVER made (a generated invoice PDF) at exactly this object; storing again replaces it. */
  put(bucket: string, path: string, body: Uint8Array, mimeType: string): Promise<void>;
  /** The stored bytes (the server e-mailing a PDF it stored earlier). */
  read(bucket: string, path: string): Promise<Uint8Array>;
  remove(bucket: string, paths: string[]): Promise<boolean>;
  /** The reference stored in the database for an object (`r2://bucket/key`, `supabase://bucket/path`). */
  reference(bucket: string, path: string): string;
}
