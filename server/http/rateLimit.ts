/**
 * Rate limiting.
 *
 * Two layers:
 *  1. Per-IP, in memory, BEFORE authentication - cheap protection against
 *     floods of anonymous/invalid requests. Per serverless instance, so it is
 *     a coarse first line, not an exact quota.
 *  2. Per-user quotas AFTER authentication, stored in Postgres
 *     (public.rate_limit_consume, service role only) so the limit holds across
 *     all serverless instances. Falls back to memory if no service key is set.
 *
 * Limits are configurable through RATE_LIMIT_* environment variables.
 */
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { AppError } from './errors.js';

export interface Bucket {
  key: string;
  limit: number;
  /** Window length in seconds. */
  window: number;
}

export interface BucketResult {
  bucket: string;
  hits: number;
  max_hits: number;
  reset_at: string;
  allowed: boolean;
}

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** Requests per minute. */
export const LIMITS = {
  get ipPerMinute() { return num('RATE_LIMIT_IP_PER_MIN', 600); },
  get userPerMinute() { return num('RATE_LIMIT_USER_PER_MIN', 300); },
  /** Account administration: create users, approvals, status/role changes, deletes, announcements. */
  get sensitivePerMinute() { return num('RATE_LIMIT_SENSITIVE_PER_MIN', 20); },
  /** Bulk import. */
  get importPerMinute() { return num('RATE_LIMIT_IMPORT_PER_MIN', 5); }
};

export type RateClass = 'default' | 'sensitive' | 'import';

// ---------------------------------------------------------------------------
// Memory store (per instance)
// ---------------------------------------------------------------------------
const memory = new Map<string, { windowStart: number; hits: number }>();
let lastSweep = 0;

function consumeMemory(buckets: Bucket[]): BucketResult[] {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, v] of memory) if (now - v.windowStart > 3_600_000) memory.delete(k);
    lastSweep = now;
  }
  return buckets.map(b => {
    const windowMs = b.window * 1000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const id = `${b.key}@${windowStart}`;
    const entry = memory.get(id) || { windowStart, hits: 0 };
    entry.hits++;
    memory.set(id, entry);
    return {
      bucket: b.key,
      hits: entry.hits,
      max_hits: b.limit,
      reset_at: new Date(windowStart + windowMs).toISOString(),
      allowed: entry.hits <= b.limit
    };
  });
}

// ---------------------------------------------------------------------------
// Postgres store (shared across instances)
// ---------------------------------------------------------------------------
async function consumePostgres(buckets: Bucket[]): Promise<BucketResult[]> {
  const { data, error } = await getServiceClient().rpc('rate_limit_consume', { p_buckets: buckets });
  if (error || !Array.isArray(data)) {
    // Fail open on limiter outages: availability matters more than an exact
    // quota, and authorization is still enforced by the database.
    console.error('[api] rate limiter unavailable, falling back to memory', error?.message);
    return consumeMemory(buckets);
  }
  return data as BucketResult[];
}

/** Throw RATE_LIMITED if any bucket is exhausted; returns the tightest result for headers. */
export async function enforce(buckets: Bucket[], store: 'memory' | 'shared'): Promise<BucketResult> {
  const results = store === 'shared' && hasServiceClient() ? await consumePostgres(buckets) : consumeMemory(buckets);
  return evaluate(results);
}

/** Throw RATE_LIMITED if any result is over its limit; returns the tightest result for headers. */
export function evaluate(results: BucketResult[]): BucketResult {
  const blocked = results.find(r => !r.allowed);
  const tightest = blocked || results.reduce((a, b) => (b.max_hits - b.hits < a.max_hits - a.hits ? b : a));
  if (blocked) {
    const retryAfter = Math.max(1, Math.ceil((new Date(blocked.reset_at).getTime() - Date.now()) / 1000));
    throw new AppError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.', { retryAfterSeconds: retryAfter });
  }
  return tightest;
}

export function userBuckets(userId: string, rateClass: RateClass): Bucket[] {
  const buckets: Bucket[] = [{ key: `user:${userId}`, limit: LIMITS.userPerMinute, window: 60 }];
  if (rateClass === 'sensitive') buckets.push({ key: `user:${userId}:sensitive`, limit: LIMITS.sensitivePerMinute, window: 60 });
  if (rateClass === 'import') buckets.push({ key: `user:${userId}:import`, limit: LIMITS.importPerMinute, window: 60 });
  return buckets;
}

/** Per-user buckets as sent to api_session (keys are prefixed with the user id in the database). */
export function userBucketSpecs(rateClass: RateClass): { suffix: string; limit: number; window: number }[] {
  return userBuckets('', rateClass).map(b => ({ suffix: b.key.slice('user:'.length), limit: b.limit, window: b.window }));
}

export function ipBuckets(ip: string): Bucket[] {
  return [{ key: `ip:${ip}`, limit: LIMITS.ipPerMinute, window: 60 }];
}
