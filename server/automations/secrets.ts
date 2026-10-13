import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * The client password typed by the Technical Consultant is needed once, for the
 * "Status Completed" email. It is encrypted here (AES-256-GCM, key from
 * AUTOMATION_SECRET_KEY, which lives only in the server environment), stored on
 * that one email job and erased by the database as soon as the job finishes.
 * Supabase Auth keeps its own (hashed) copy for logging in.
 */
const key = (secret: string) => createHash('sha256').update(secret, 'utf8').digest();

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

/** Returns null when the value cannot be decrypted (wrong key, tampered, missing). */
export function decryptSecret(token: string | null | undefined, secret: string | null): string | null {
  if (!token || !secret) return null;
  const [v, iv, tag, data] = token.split(':');
  if (v !== 'v1' || !iv || !tag || !data) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}
