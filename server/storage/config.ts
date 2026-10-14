import { ConfigurationError } from '../config/env.js';
import type { StorageProviderName } from './types.js';

export interface R2Settings {
  host: string;
  protocol: 'http' | 'https';
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/**
 * Where NEW files go. Existing files stay where they are (each document row records its own provider).
 *   STORAGE_PROVIDER=r2        -> Cloudflare R2 (requires the R2_* variables)
 *   STORAGE_PROVIDER=supabase  -> Supabase Storage
 *   (unset)                    -> R2 when every R2_* variable is set, otherwise Supabase
 * R2_ACCOUNT_ID (or R2_ENDPOINT), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.
 */
export function r2Settings(): R2Settings | null {
  const accountId = (process.env.R2_ACCOUNT_ID || '').trim();
  const endpoint = (process.env.R2_ENDPOINT || '').trim();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = (process.env.R2_BUCKET || '').trim();
  if ((!accountId && !endpoint) || !accessKeyId || !secretAccessKey || !bucket) return null;
  if (endpoint) {
    const u = new URL(endpoint);
    return { host: u.host, protocol: u.protocol === 'http:' ? 'http' : 'https', bucket, accessKeyId, secretAccessKey };
  }
  return { host: `${accountId}.r2.cloudflarestorage.com`, protocol: 'https', bucket, accessKeyId, secretAccessKey };
}

export function activeProviderName(): StorageProviderName {
  const wanted = (process.env.STORAGE_PROVIDER || '').trim().toLowerCase();
  if (wanted === 'supabase') return 'SUPABASE';
  if (wanted === 'r2') {
    if (!r2Settings()) throw new ConfigurationError('STORAGE_PROVIDER=r2 needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.');
    return 'R2';
  }
  return r2Settings() ? 'R2' : 'SUPABASE';
}
