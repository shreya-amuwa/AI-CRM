// Unit test of the delivery outbox sender (server/automations/notificationDelivery.ts) and the detailed Web Push outcome
// (server/automations/webPush.ts sendWebPushDetailed). An in-memory store stands in for the database; keys are generated here; no real
// device or push service is used.
import { maxPerRun, processDeliveries, type ClaimedDelivery, type DeliveryReport, type DeliveryStore } from '../../server/automations/notificationDelivery';
import { retryAfterSeconds, sendWebPushDetailed, type PushResult, type PushTarget, type VapidConfig } from '../../server/automations/webPush';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exit(1); } passed++; console.log('ok -', name); };
const b64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');

const vapidKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', vapidKeys.privateKey);
const vapid: VapidConfig = { publicKey: b64url(await crypto.subtle.exportKey('raw', vapidKeys.publicKey)), privateJWK: jwk, subject: 'mailto:hr@example.com' };
const device = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const target: PushTarget = {
  id: '00000000-0000-4000-8000-000000000001', endpoint: 'https://push.example.com/send/abc',
  p256dh: b64url(await crypto.subtle.exportKey('raw', device.publicKey)), auth: b64url(crypto.getRandomValues(new Uint8Array(16)))
};
const msg = { title: 'Time to Resume Work', body: 'Your lunch break has ended.', tag: 'att-resume_work-2027-01-11', url: '/?open=attendance', ttl: 600 };
const answer = (status: number, headers: Record<string, string> = {}) => async () => new Response(null, { status, headers });

// --- the detailed outcome of one push
let seenTtl = '';
const r201 = await sendWebPushDetailed(target, msg, vapid, async (_u, init) => { seenTtl = new Headers(init.headers).get('ttl') ?? ''; return new Response(null, { status: 201 }); });
check(r201.outcome === 'accepted' && r201.status === 201 && r201.error === null, '201 is accepted by the push service', r201);
check(seenTtl === '600', 'the TTL is the time left until the reminder expires (not a fixed 30 minutes)', seenTtl);
check((await sendWebPushDetailed(target, msg, vapid, answer(410))).outcome === 'gone', '410 is gone');
check((await sendWebPushDetailed(target, msg, vapid, answer(404))).outcome === 'gone', '404 is gone');
const r429 = await sendWebPushDetailed(target, msg, vapid, answer(429, { 'Retry-After': '120' }));
check(r429.outcome === 'retry' && r429.retryAfter === 120, '429 is retried, after Retry-After', r429);
check((await sendWebPushDetailed(target, msg, vapid, answer(503))).outcome === 'retry', '5xx is retried');
const r403 = await sendWebPushDetailed(target, msg, vapid, answer(403));
check(r403.outcome === 'failed' && r403.error === 'HTTP 403 VAPID_REFUSED', '403 is a permanent failure that names the VAPID refusal', r403);
check((await sendWebPushDetailed(target, msg, vapid, answer(400))).outcome === 'failed', '400 is a permanent failure');
check((await sendWebPushDetailed({ ...target, p256dh: 'broken' }, msg, vapid, answer(201))).error === 'INVALID_DEVICE_KEY', 'a broken device key is a failure, not a crash');
const keepAlive = setInterval(() => {}, 1000);
const hang = (_u: string, init: RequestInit) => new Promise<Response>((_, rej) => init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))));
const rt = await sendWebPushDetailed(target, msg, vapid, hang, 100);
clearInterval(keepAlive);
check(rt.outcome === 'retry' && rt.error === 'TIMEOUT', 'a push service that never answers is a TIMEOUT, retried later', rt);
const rs = await sendWebPushDetailed(target, msg, vapid, async () => { throw new Error('Too many subrequests.'); });
check(rs.outcome === 'retry' && rs.error === 'SUBREQUEST_LIMIT', "the Worker's subrequest limit is retried on the next run (it never reached the push service)", rs);
const rn = await sendWebPushDetailed(target, msg, vapid, async () => { throw new TypeError('fetch failed'); });
check(rn.outcome === 'retry' && rn.error === 'NETWORK_ERROR', 'a network error is retried', rn);
check(!JSON.stringify([r201, r429, r403, rt, rs, rn]).includes('push.example.com'), 'no outcome contains the device address');
check(retryAfterSeconds('30') === 30 && retryAfterSeconds(null) === null && retryAfterSeconds(new Date(Date.now() + 60_000).toUTCString())! >= 58, 'Retry-After in seconds or as a date');

// --- the outbox loop
function fakeStore(n: number) {
  const rows: ClaimedDelivery[] = Array.from({ length: n }, (_, i) => ({
    id: i + 1, lease: `lease-${i + 1}`, subscriptionId: target.id, endpoint: target.endpoint, p256dh: target.p256dh, auth: target.auth,
    title: 't', body: 'b', tag: 'tag', url: '/', ttl: 600
  }));
  const claimed = new Set<number>();
  const reports: DeliveryReport[] = [];
  const claims: number[] = [];
  const store: DeliveryStore = {
    async claim(limit, _lease, ids) {
      claims.push(limit);
      const out = rows.filter(r => !claimed.has(r.id) && (!ids || ids.includes(r.id))).slice(0, limit);
      out.forEach(r => claimed.add(r.id));
      return out;
    },
    async report(results) { reports.push(...results); }
  };
  return { store, reports, claims };
}
const okSender = async (): Promise<PushResult> => ({ outcome: 'accepted', status: 201, error: null, retryAfter: null, ms: 1 });

{
  const f = fakeStore(100);
  let inFlight = 0, maxInFlight = 0;
  const sender = async (): Promise<PushResult> => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await new Promise(r => setTimeout(r, 2)); inFlight--; return okSender(); };
  const t = await processDeliveries({ store: f.store, sender, vapid, limit: 40, concurrency: 6 });
  check(t.attempted === 40 && t.accepted === 40 && f.reports.length === 40, 'one run sends at most the per-run limit (40 by default), the rest waits for the next run', t);
  check(maxInFlight <= 6, 'at most 6 pushes at a time', maxInFlight);
  check(f.reports.every(r => r.lease === `lease-${r.id}`), 'every report carries the lease it was claimed with');
}
{
  const f = fakeStore(5);
  let i = 0;
  const outcomes: PushResult['outcome'][] = ['accepted', 'retry', 'gone', 'failed', 'accepted'];
  const sender = async (): Promise<PushResult> => ({ outcome: outcomes[i++], status: 200, error: null, retryAfter: null, ms: 1 });
  const t = await processDeliveries({ store: f.store, sender, vapid, concurrency: 1 });
  check(t.accepted === 2 && t.retry === 1 && t.gone === 1 && t.failed === 1 && t.attempted === 5, 'the totals count each outcome', t);
}
{
  const f = fakeStore(3);
  const sender = async (): Promise<PushResult> => { throw new Error('boom'); };
  const t = await processDeliveries({ store: f.store, sender, vapid });
  check(t.retry === 3 && f.reports.every(r => r.outcome === 'retry' && r.error === 'SEND_ERROR'), 'a sender that throws is reported as a retry, never lost');
}
{
  const f = fakeStore(10);
  let clock = 0;
  const sender = async (): Promise<PushResult> => { clock += 1000; return okSender(); };
  const t = await processDeliveries({ store: f.store, sender, vapid, concurrency: 1, budgetMs: 3000, now: () => clock });
  check(t.attempted < 10, 'the run stops at its time budget', t);
}
{
  const f = fakeStore(10);
  const t = await processDeliveries({ store: f.store, sender: okSender, vapid, ids: [3, 7] });
  check(t.attempted === 2 && f.reports.map(r => r.id).sort().join() === '3,7', 'a test sends exactly the rows it queued');
}
{
  const f = fakeStore(3);
  const t = await processDeliveries({ store: f.store, sender: okSender, vapid: null });
  check(t.attempted === 0 && f.claims.length === 0, 'without VAPID keys nothing is claimed (the rows are not touched)');
}
check(maxPerRun({}) === 40 && maxPerRun({ PUSH_MAX_PER_RUN: '400' }) === 400 && maxPerRun({ PUSH_MAX_PER_RUN: 'lots' }) === 40 && maxPerRun({ PUSH_MAX_PER_RUN: '9999' }) === 40,
  'PUSH_MAX_PER_RUN: 1..500, 40 by default');

console.log(`=== NOTIFICATION DELIVERY TESTS PASSED (${passed}) ===`);
