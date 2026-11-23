import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { sendWebPushDetailed, vapidConfig, type PushResult, type VapidConfig } from './webPush.js';

/**
 * The delivery outbox (migration 20270126000200): the database holds one row per notification and device; this takes due rows with a lease
 * (push_deliveries_claim), sends them with bounded concurrency, and reports each answer back (push_deliveries_report), which decides
 * accepted / retry later / failed / device gone. A Worker that stops half way loses nothing: the rows it held are taken again when their
 * lease ends. Two runs at once never take the same row.
 *
 * Budget: a Cloudflare Worker invocation may make a limited number of subrequests (50 on the Free plan), and every push is one. At 10:00,
 * when everybody's Punch In reminder is due together, the old code tried to push to every device in one invocation; pushes past the
 * limit failed and were never retried. Here each run sends at most PUSH_MAX_PER_RUN (default 40) and leaves the rest PENDING for the next
 * run, five minutes later, within their expiry. On the Paid plan raise PUSH_MAX_PER_RUN (e.g. 400).
 */
export interface ClaimedDelivery {
  id: number;
  lease: string;
  subscriptionId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  tag: string;
  url: string;
  ttl: number;
}
export interface DeliveryTotals { attempted: number; accepted: number; retry: number; failed: number; gone: number }
export const NO_TOTALS: DeliveryTotals = { attempted: 0, accepted: 0, retry: 0, failed: 0, gone: 0 };

export interface DeliveryStore {
  claim(limit: number, leaseSeconds: number, ids?: number[]): Promise<ClaimedDelivery[]>;
  report(results: DeliveryReport[]): Promise<void>;
}
export interface DeliveryReport { id: number; lease: string; outcome: PushResult['outcome']; status: number | null; error: string | null; retryAfter: number | null; ms: number }
type Sender = (d: ClaimedDelivery, vapid: VapidConfig) => Promise<PushResult>;

/** The database outbox through the service role. */
export const supabaseDeliveryStore: DeliveryStore = {
  async claim(limit, leaseSeconds, ids) {
    const { data, error } = await getServiceClient().rpc('push_deliveries_claim', { p_limit: limit, p_lease_seconds: leaseSeconds, p_ids: ids ?? null });
    if (error) throw new Error(`Deliveries could not be claimed: ${error.message}`);
    return (data ?? []) as ClaimedDelivery[];
  },
  async report(results) {
    if (!results.length) return;
    const { error } = await getServiceClient().rpc('push_deliveries_report', { p_results: results });
    // the rows stay PROCESSING; their lease ends and the next run takes them again (at-least-once, the same tag replaces a duplicate)
    if (error) console.error('[push] could not record the push results:', error.message);
  }
};

export function maxPerRun(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number((env.PUSH_MAX_PER_RUN ?? '').trim());
  return Number.isInteger(n) && n >= 1 && n <= 500 ? n : 40;
}

const defaultSender: Sender = (d, vapid) =>
  sendWebPushDetailed({ id: d.subscriptionId, endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth },
    { title: d.title, body: d.body, tag: d.tag, url: d.url, ttl: d.ttl }, vapid);

/**
 * Send what is due: claim, push a few at a time, report each batch at once (so a crash loses at most one batch's reports). Stops at the
 * per-run limit or the time budget. `ids` sends exactly those rows (a test notification, sent while the person waits).
 */
export async function processDeliveries(opts: {
  limit?: number; budgetMs?: number; concurrency?: number; ids?: number[];
  store?: DeliveryStore; sender?: Sender; vapid?: VapidConfig | null; now?: () => number;
} = {}): Promise<DeliveryTotals> {
  const vapid = opts.vapid === undefined ? vapidConfig() : opts.vapid;
  const store = opts.store ?? (hasServiceClient() ? supabaseDeliveryStore : null);
  if (!vapid || !store) return { ...NO_TOTALS };
  const limit = opts.limit ?? maxPerRun();
  const budgetMs = opts.budgetMs ?? 20_000;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 6, 10));
  const sender = opts.sender ?? defaultSender;
  const now = opts.now ?? Date.now;
  const start = now();
  const totals: DeliveryTotals = { ...NO_TOTALS };
  // the lease outlives the time this run may take, so no other run takes a row this one still holds
  const leaseSeconds = Math.ceil(budgetMs / 1000) + 30;
  while (totals.attempted < limit && now() - start < budgetMs) {
    const batch = await store.claim(Math.min(concurrency * 2, limit - totals.attempted), leaseSeconds, opts.ids);
    if (!batch.length) break;
    for (let i = 0; i < batch.length; i += concurrency) {
      const slice = batch.slice(i, i + concurrency);
      const results = await Promise.all(slice.map(d => sender(d, vapid).catch((): PushResult => ({ outcome: 'retry', status: null, error: 'SEND_ERROR', retryAfter: null, ms: 0 }))));
      await store.report(slice.map((d, k) => ({ id: d.id, lease: d.lease, ...results[k] })));
      totals.attempted += slice.length;
      for (const r of results) totals[r.outcome === 'accepted' ? 'accepted' : r.outcome] += 1;
    }
    if (opts.ids) break;
  }
  return totals;
}
