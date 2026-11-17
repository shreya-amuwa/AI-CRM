import type { LEAD_WEBHOOK_SOURCES } from '../../shared/validation.js';

/**
 * Credentials for the lead webhooks of the Wabastore panel. They live in server environment variables
 * (WABASTORE_SOURCE_TOKEN_<SOURCE>, e.g. WABASTORE_SOURCE_TOKEN_AICALLING) so the browser never holds them.
 * A credential is attached only when the target is the provider's own host, so a signed-in user cannot make the
 * server send it to an address of their choosing.
 */
export type LeadWebhookSource = (typeof LEAD_WEBHOOK_SOURCES)[number];

const CREDENTIAL_HOSTS = new Set(['webhooks.wabastore.com']);

export const webhookTokenVariable = (source: LeadWebhookSource) => `WABASTORE_SOURCE_TOKEN_${source.toUpperCase()}`;

export function isCredentialHost(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && CREDENTIAL_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** The headers the provider expects (the same two the browser used to send), or null when none is configured or the host is not the provider's. */
export function webhookCredentialHeaders(source: LeadWebhookSource, url: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> | null {
  if (!isCredentialHost(url)) return null;
  const token = (env[webhookTokenVariable(source)] || '').trim();
  if (!token) return null;
  return { Authorization: `Bearer ${token}`, 'x-api-key': token };
}
