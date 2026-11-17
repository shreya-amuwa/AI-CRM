import type { LeadWebhookFetchResult } from '../../shared/contracts.js';
import { leadWebhookFetchSchema } from '../../shared/validation.js';
import { AppError } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { webhookCredentialHeaders } from '../leads/webhookSources.js';
import { BlockedTargetError, safeGet, type SafeFetchOptions, type SafeResponse } from '../net/safeFetch.js';

type Fetcher = (url: string, opts: SafeFetchOptions) => Promise<SafeResponse>;

/**
 * Reads (or, for a test lead, posts to) a lead source's webhook for the Wabastore panel. The provider credential is added here from the server's
 * environment and never leaves it; the request goes through the SSRF-safe fetcher (public http(s) addresses only, no redirects when a credential is sent).
 */
export class LeadWebhookService {
  constructor(private readonly fetcher: Fetcher = safeGet, private readonly env: NodeJS.ProcessEnv = process.env) {}

  async fetchSource(body: unknown): Promise<LeadWebhookFetchResult> {
    const b = parse(leadWebhookFetchSchema, body);
    const credential = webhookCredentialHeaders(b.sourceId, b.url, this.env);
    try {
      const res = await this.fetcher(b.url, {
        method: b.method,
        headers: credential ?? undefined,
        body: b.method === 'POST' ? JSON.stringify(b.body ?? {}) : undefined
      });
      return { status: res.status, contentType: res.contentType, body: res.body.toString('utf8'), credentialApplied: credential !== null };
    } catch (err) {
      if (err instanceof BlockedTargetError) throw new AppError('VALIDATION_ERROR', err.message);
      throw new AppError('SERVICE_UNAVAILABLE', 'The webhook could not be reached. Try again in a moment.');
    }
  }
}
