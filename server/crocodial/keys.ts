import { createHash } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../automations/secrets.js';
import { readSetting } from './runtime.js';

/**
 * Crocodial keys stored by the CRM (docs/superpowers/specs/2026-11-27-lead-tags-and-ceo-crocodial-connections-design.md, "Token storage",
 * "Encryption key lifetime"). The key is encrypted here with AUTOMATION_SECRET_KEY (AES-256-GCM, "v1:" format, server/automations/secrets.ts);
 * the database keeps the ciphertext, a sha256 fingerprint (one connection per Crocodial account) and the last 4 characters. The plain key is
 * only ever the Authorization header: never returned, logged, audited or stored. Rotating AUTOMATION_SECRET_KEY means entering the keys
 * again (a stored key that no longer opens is shown as "Key needs to be entered again").
 */

/** A pasted key without the spaces and line breaks that copying adds (anywhere in it). */
export function normaliseKey(raw: string): string {
  return raw.replace(/\s+/g, '');
}

/** sha256 hex of the normalised key: the same Crocodial account is recognised however it was pasted. */
export function keyFingerprint(key: string): string {
  return createHash('sha256').update(normaliseKey(key), 'utf8').digest('hex');
}

/** The last 4 characters, shown as "•••• 1a2b". */
export function keyLast4(key: string): string {
  return normaliseKey(key).slice(-4);
}

export function sealKey(key: string, secret: string): string {
  return encryptSecret(key, secret);
}

/** The key, or null when it cannot be opened (another secret, tampered, not a ciphertext, no secret). */
export function openKey(cipher: string, secret: string | null): string | null {
  const key = decryptSecret(cipher, secret);
  return key ? key : null;
}

/** This server's AUTOMATION_SECRET_KEY (process.env, then the Worker's bindings; with an explicit env, only that), or null. */
export function keySecret(env?: NodeJS.ProcessEnv): string | null {
  return readSetting('AUTOMATION_SECRET_KEY', env)?.trim() || null;
}

/** Shown to the manager for health KEY_UNREADABLE. */
export const KEY_UNREADABLE_MESSAGE = 'Key needs to be entered again';
