import { z } from 'zod';
import { resolveCredential } from './runtime.js';

/**
 * Crocodial's Outbound API, read-only (docs/CROCODIAL_INTEGRATION.md). The token is read from the SERVER environment variable a connection
 * names (credential_ref, e.g. CROCODIAL_TOKEN_MPILLAR); it is sent only as the Authorization header and never logged, stored or returned.
 * Only GET requests exist here: creating, editing or deleting in Crocodial is out of scope (its "Allow changes" stays off).
 *
 * Limits from the guide: 60 requests a minute per token, at most 500 rows a page, paging through meta.next_page_url.
 * This client keeps under the limit itself (a gap between requests), waits a minute on 429 (at most twice), retries network errors and
 * 5xx twice with back-off, and follows next_page_url only when it is the same address with the next page number.
 */
export const CROCODIAL_BASE = 'https://app.crocodial.app/api/datalake/outbound';
export type CrocodialResource = 'employees' | 'branches' | 'leads' | 'call-logs' | 'followups' | 'remarks';
export type CrocodialHealth = 'OK' | 'NO_CREDENTIAL' | 'AUTH_FAILED' | 'DISABLED_AT_SOURCE' | 'RATE_LIMITED' | 'ERROR';

export class CrocodialError extends Error {
  constructor(readonly health: Exclude<CrocodialHealth, 'OK'>, message: string, readonly status: number | null = null) {
    super(message);
    this.name = 'CrocodialError';
  }
}

export type CrocodialFetch = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The connection's token, from this server's settings (process.env, then the Worker's bindings; with an explicit env, only that). A name
 * that does not follow the convention is never looked up, and a value that is not shaped like a token is not used (server/crocodial/runtime.ts).
 */
export function crocodialToken(credentialRef: string, env?: NodeJS.ProcessEnv): string | null {
  return resolveCredential(credentialRef, env);
}

/**
 * The next page to fetch, or null. Crocodial's next_page_url is followed only when it points at the same origin and path as the page just
 * read, asks for exactly the next page number and carries no token in the address (the header is always used instead).
 */
export function safeNextUrl(current: string, next: unknown): string | null {
  if (typeof next !== 'string' || !next) return null;
  let cur: URL;
  let nxt: URL;
  try {
    cur = new URL(current);
    nxt = new URL(next);
  } catch {
    return null;
  }
  if (nxt.origin !== cur.origin || nxt.pathname !== cur.pathname || nxt.protocol !== 'https:') return null;
  if (nxt.searchParams.has('token')) return null;
  const page = Number(cur.searchParams.get('page') ?? '1');
  if (Number(nxt.searchParams.get('page')) !== page + 1) return null;
  return nxt.toString();
}

const metaSchema = z.object({
  page: z.number().int().optional(),
  per_page: z.number().int().optional(),
  total: z.number().int().optional(),
  last_page: z.number().int().optional(),
  has_more: z.boolean().optional(),
  timezone: z.string().max(64).optional(),
  next_page_url: z.string().nullable().optional()
}).passthrough();
const listSchema = z.object({ success: z.literal(true), data: z.array(z.unknown()), meta: metaSchema }).passthrough();

const idName = z.object({ id: z.number().int().positive(), name: z.string().nullable().optional() }).passthrough();
export const crocodialEmployeeSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  branches: z.array(z.object({ id: z.number().int().positive() }).passthrough()).nullable().optional(),
  updated_at: z.string().nullable().optional()
}).passthrough();
export const crocodialBranchSchema = z.object({
  id: z.number().int().positive(),
  branch_name: z.string().nullable().optional(),
  status: z.string().nullable().optional()
}).passthrough();
export { idName as crocodialIdNameSchema };

export interface CrocodialPage { rows: unknown[]; meta: z.infer<typeof metaSchema>; url: string }

export interface ClientOptions {
  fetch?: CrocodialFetch;
  sleep?: (ms: number) => Promise<void>;
  /** The smallest gap between two requests of this client (60 a minute is Crocodial's limit; 1.2 s keeps to 50). */
  minGapMs?: number;
  timeoutMs?: number;
  base?: string;
}

const realSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export class CrocodialClient {
  private readonly doFetch: CrocodialFetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minGapMs: number;
  private readonly timeoutMs: number;
  private readonly base: string;
  private last = 0;
  requests = 0;

  constructor(private readonly token: string, opts: ClientOptions = {}) {
    this.doFetch = opts.fetch ?? ((u, i) => fetch(u, i));
    this.sleep = opts.sleep ?? realSleep;
    this.minGapMs = opts.minGapMs ?? 1_200;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.base = (opts.base ?? CROCODIAL_BASE).replace(/\/+$/, '');
  }

  url(resource: CrocodialResource, params: Record<string, string | number | undefined> = {}): string {
    const u = new URL(`${this.base}/${resource}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
    return u.toString();
  }

  /** One page, with the waiting and retries described above. Throws CrocodialError with the health it means. */
  async page(url: string): Promise<CrocodialPage> {
    let rateWaits = 0;
    let errors = 0;
    for (;;) {
      const wait = this.last + this.minGapMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.last = Date.now();
      this.requests += 1;
      let res: Response;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      try {
        res = await this.doFetch(url, { method: 'GET', headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' }, signal: ctl.signal });
      } catch (err) {
        clearTimeout(timer);
        if (++errors > 2) throw new CrocodialError('ERROR', `Crocodial could not be reached (${(err as Error).name || 'network error'}).`);
        await this.sleep(2_000 * errors);
        continue;
      }
      clearTimeout(timer);
      if (res.status === 429) {
        if (++rateWaits > 2) throw new CrocodialError('RATE_LIMITED', 'Crocodial\'s limit of 60 requests a minute was reached. Try again in a minute.', 429);
        await this.sleep(60_000);
        continue;
      }
      if (res.status >= 500) {
        if (++errors > 2) throw new CrocodialError('ERROR', `Crocodial answered ${res.status}.`, res.status);
        await this.sleep(2_000 * errors);
        continue;
      }
      const body = await res.json().catch(() => null) as { message?: unknown } | null;
      const msg = typeof body?.message === 'string' ? body.message.slice(0, 200) : '';
      if (res.status === 401) throw new CrocodialError('AUTH_FAILED', 'Crocodial refused the token (missing, wrong or regenerated). Create a new one under Setup → Outbound API.', 401);
      if (res.status === 403) throw new CrocodialError('DISABLED_AT_SOURCE', 'The token is turned off in Crocodial (Setup → Outbound API).', 403);
      if (!res.ok) throw new CrocodialError('ERROR', `Crocodial answered ${res.status}${msg ? `: ${msg}` : ''}.`, res.status);
      const parsed = listSchema.safeParse(body);
      if (!parsed.success) throw new CrocodialError('ERROR', 'Crocodial sent an answer in an unexpected shape.', res.status);
      return { rows: parsed.data.data, meta: parsed.data.meta, url };
    }
  }

  /** Every page of a resource (at most maxPages), rows validated with the schema; rows that do not validate are counted, never kept. */
  async all<T>(resource: CrocodialResource, schema: z.ZodType<T>, params: Record<string, string | number | undefined> = {}, maxPages = 200):
    Promise<{ rows: T[]; skipped: number; pages: number; timezone: string | null; total: number | null }> {
    let url: string | null = this.url(resource, { per_page: 500, ...params, page: 1 });
    const rows: T[] = [];
    let skipped = 0;
    let pages = 0;
    let timezone: string | null = null;
    let total: number | null = null;
    while (url) {
      if (pages >= maxPages) throw new CrocodialError('ERROR', `More than ${maxPages} pages of ${resource}: stopped to stay within the limits.`);
      const p: CrocodialPage = await this.page(url);
      pages += 1;
      timezone = timezone ?? p.meta.timezone ?? null;
      total = total ?? p.meta.total ?? null;
      for (const r of p.rows) {
        const v = schema.safeParse(r);
        if (v.success) rows.push(v.data);
        else skipped += 1;
      }
      url = safeNextUrl(url, p.meta.next_page_url);
    }
    return { rows, skipped, pages, timezone, total };
  }
}
