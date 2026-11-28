/**
 * Crocodial keys stored by the CRM (server/crocodial/keys.ts, CrocodialService.saveKey / removeKey, the sync's lookup): a pasted key is
 * normalised (spaces and line breaks removed) before it is fingerprinted, sealed with AUTOMATION_SECRET_KEY and opened only with the same
 * secret; saving a key checks the caller first, then the server's secret, the key's shape and one live read, and stores nothing when
 * Crocodial refuses the key or cannot be reached. The plain key never reaches the store, the answer or an error message. The sync opens a
 * stored key; one that no longer opens marks the connection KEY_UNREADABLE and is skipped (nothing is sent to Crocodial).
 */
import { keyFingerprint, normaliseKey, openKey, sealKey } from '../../server/crocodial/keys.js';
import { CrocodialService } from '../../server/services/CrocodialService.js';
import { runCrocodialSync } from '../../server/crocodial/sync.js';
import { AppError } from '../../server/http/errors.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const KEY = 'croc-key-not-real-9f3a1b2c';
const CID = '00000000-0000-4000-8000-0000000000c1';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const usersPage = () => json(200, { success: true, data: [{ id: 7, name: 'Seller' }], meta: { page: 1, per_page: 1, total: 12, next_page_url: null } });

// ---------------------------------------------------------------------------- keys.ts
{
  check(normaliseKey(' abc\n ') === 'abc', 'normaliseKey trims and removes whitespace and line breaks');
  check(normaliseKey('ab c\r\n\td') === 'abcd', 'normaliseKey removes whitespace inside the key too');
  check(keyFingerprint('abc') === keyFingerprint(' abc\n'), 'the same fingerprint for a key pasted with spaces or a line break');
  check(/^[0-9a-f]{64}$/.test(keyFingerprint('abc')) && keyFingerprint('abc') !== keyFingerprint('abd'), 'the fingerprint is sha256 hex and differs per key');
  const sealed = sealKey(KEY, 's1');
  check(sealed.startsWith('v1:') && !sealed.includes(KEY), 'a sealed key keeps the v1: prefix and does not contain the key');
  check(openKey(sealed, 's1') === KEY, 'openKey(sealKey(k, s1), s1) gives the key back');
  check(openKey(sealed, 's2') === null, 'with another secret it does not open');
  check(openKey('garbage', 's1') === null, 'garbage does not open');
  check(openKey(sealed, null) === null, 'without a secret it does not open');
}

// ---------------------------------------------------------------------------- saveKey
type Call = { fn: string; args: unknown[] };
function harness(answer: (url: string, init: RequestInit) => Promise<Response>, env: Record<string, string> = { AUTOMATION_SECRET_KEY: 's1' }) {
  const calls: Call[] = [];
  const fetched: { url: string; auth: string }[] = [];
  const repo: any = { canManageCheck: async (id: string) => { calls.push({ fn: 'canManageCheck', args: [id] }); } };
  const keyStore: any = {
    tokenStore: async (...args: unknown[]) => { calls.push({ fn: 'tokenStore', args }); return { id: CID, keySource: 'DATABASE', keyLast4: args[3] }; },
    tokenClear: async (...args: unknown[]) => { calls.push({ fn: 'tokenClear', args }); return { id: CID, keySource: 'NONE', enabled: false }; }
  };
  const limits: unknown[] = [];
  const sleeps: number[] = [];
  const svc = new CrocodialService(repo, env as any, {
    keyStore,
    limit: async (b: unknown) => { limits.push(b); },
    client: {
      sleep: async (ms: number) => { sleeps.push(ms); }, minGapMs: 0,
      fetch: async (url: string, init: RequestInit) => {
        fetched.push({ url, auth: String((init.headers as Record<string, string>).Authorization) });
        return answer(url, init);
      }
    }
  });
  return { svc, calls, fetched, limits, sleeps };
}
const failure = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e as AppError; }
  return null;
};

{
  const h = harness(async () => usersPage());
  const r = await h.svc.saveKey(CID, `  ${KEY}\n`, 'actor-1');
  check(r.ok === true && r.last4 === KEY.slice(-4) && r.users === 12, 'success: ok, the last 4 characters and the number of Crocodial users', r);
  check(!JSON.stringify(r).includes(KEY), 'the answer does not contain the key');
  check(h.calls[0]?.fn === 'canManageCheck' && h.calls[0].args[0] === CID, 'the caller is checked first (as the user)');
  check(JSON.stringify(h.limits) === JSON.stringify([[{ key: 'croc-key:actor-1', limit: 5, window: 600 }]]), 'rate limited per person, 5 in 10 minutes', h.limits);
  check(h.fetched.length === 1 && h.fetched[0].auth === `Bearer ${KEY}` && /\/employees\?/.test(h.fetched[0].url) && new URL(h.fetched[0].url).searchParams.get('per_page') === '1',
    'one live read of 1 user, with the normalised key', h.fetched);
  const store = h.calls.find(c => c.fn === 'tokenStore');
  const [id, cipher, fp, last4, actor] = (store?.args ?? []) as string[];
  check(store && id === CID && cipher !== KEY && !cipher.includes(KEY) && openKey(cipher, 's1') === KEY && fp === keyFingerprint(KEY) && last4 === KEY.slice(-4) && actor === 'actor-1',
    'stored: the ciphertext (not the key), the fingerprint, the last 4 and who', store);
}
{
  const h = harness(async () => json(401, { message: 'Unauthenticated' }));
  const e = await failure(h.svc.saveKey(CID, KEY, 'actor-1'));
  check(e instanceof AppError && e.code === 'VALIDATION_ERROR' && e.message === 'Crocodial refused this key.', 'a 401 from Crocodial: VALIDATION_ERROR, "Crocodial refused this key."', e);
  check(!h.calls.some(c => c.fn === 'tokenStore'), 'and nothing is stored');
}
{
  const h = harness(async () => json(403, {}));
  const e = await failure(h.svc.saveKey(CID, KEY, 'actor-1'));
  check(e?.code === 'VALIDATION_ERROR' && e.message === 'Crocodial refused this key.' && !h.calls.some(c => c.fn === 'tokenStore'), 'a 403 (key turned off) is refused the same way', e);
}
{
  const h = harness(async () => { throw new TypeError('fetch failed'); });
  const e = await failure(h.svc.saveKey(CID, KEY, 'actor-1'));
  check(e?.code === 'SERVICE_UNAVAILABLE' && e.message === 'Crocodial could not be reached. Nothing was saved; try again.', 'a network error: SERVICE_UNAVAILABLE with the exact copy', e);
  check(!h.calls.some(c => c.fn === 'tokenStore'), 'and nothing is stored');
}
{
  const h = harness(async () => json(502, {}));
  const e = await failure(h.svc.saveKey(CID, KEY, 'actor-1'));
  check(e?.code === 'SERVICE_UNAVAILABLE' && e.message === 'Crocodial could not be reached. Nothing was saved; try again.' && !h.calls.some(c => c.fn === 'tokenStore'),
    'a 5xx: the same, nothing stored', e);
}
{
  // a 429 must not make "Save key" wait (the client waits 60 s twice on 429 for the sync): it fails at once, nothing stored
  const h = harness(async () => json(429, {}));
  const e = await failure(h.svc.saveKey(CID, KEY, 'actor-1'));
  check(e?.code === 'SERVICE_UNAVAILABLE' && e.message === 'Crocodial could not be reached. Nothing was saved; try again.', 'a 429: SERVICE_UNAVAILABLE with the exact copy', e);
  check(h.fetched.length === 1 && h.sleeps.length === 0 && !h.calls.some(c => c.fn === 'tokenStore'), 'at once: one request, no waiting, nothing stored', { fetched: h.fetched.length, sleeps: h.sleeps });
}
{
  // network errors and 5xx: at most one short retry in the probe (the sync keeps its 2 s / 4 s back-off)
  const h = harness(async () => json(503, {}));
  await failure(h.svc.saveKey(CID, KEY, 'actor-1'));
  check(h.sleeps.reduce((a, b) => a + b, 0) <= 1_000, 'a 5xx: the probe waits at most a second in all', h.sleeps);
}
{
  const h = harness(async () => usersPage(), {});
  const e = await failure(h.svc.saveKey(CID, KEY, 'actor-1'));
  check(e?.code === 'SERVICE_UNAVAILABLE' && e.message === "Crocodial keys can't be stored on this server. Ask the Managing Director.", 'no AUTOMATION_SECRET_KEY: SERVICE_UNAVAILABLE with the exact copy', e);
  check(h.fetched.length === 0 && !h.calls.some(c => c.fn === 'tokenStore'), 'and Crocodial is not called, nothing stored');
}
{
  const h = harness(async () => usersPage());
  const e = await failure(h.svc.saveKey(CID, 'Bearer abcdefghijk', 'actor-1'));
  check(e?.code === 'VALIDATION_ERROR' && !e.message.includes('abcdefghijk') && h.fetched.length === 0, 'a value not shaped like a key is refused before any call (and not echoed)', e);
  const e2 = await failure(h.svc.saveKey(CID, 'short', 'actor-1'));
  check(e2?.code === 'VALIDATION_ERROR' && h.fetched.length === 0, 'too short: refused');
}
{
  const h = harness(async () => usersPage());
  h.svc['repo'].canManageCheck = async () => { throw new AppError('FORBIDDEN', 'You can manage Crocodial only for departments you run.'); };
  const e = await failure(h.svc.saveKey(CID, KEY, 'actor-1'));
  check(e?.code === 'FORBIDDEN' && h.limits.length === 0 && h.fetched.length === 0 && !h.calls.some(c => c.fn === 'tokenStore'), 'a caller who may not manage it: refused before anything else', e);
}
{
  const h = harness(async () => usersPage());
  const r = await h.svc.removeKey(CID, 'actor-1');
  check(h.calls[0]?.fn === 'canManageCheck' && h.calls[1]?.fn === 'tokenClear' && h.calls[1].args[0] === CID && h.calls[1].args[1] === 'actor-1' && (r as any).keySource === 'NONE',
    'removeKey: the caller is checked, then the key is cleared by the service role', h.calls);
}

// ---------------------------------------------------------------------------- the sync uses a stored key
function syncDb(cipher: string) {
  const statuses: any[] = [];
  const db: any = {
    rpc: async (fn: string, a: any) => {
      if (fn === 'croc_sync_due') return { data: [{ id: 'c1', credentialRef: null, tokenCiphertext: cipher }], error: null };
      if (fn === 'croc_connection_status') { statuses.push(a); return { data: null, error: null }; }
      if (fn === 'croc_store_directory') return { data: {}, error: null };
      if (fn === 'croc_sync_begin') return { data: { ok: false, reason: 'test' }, error: null };
      if (fn === 'croc_reconcile') return { data: { processed: 0, enabled: false }, error: null };
      if (fn === 'croc_runtime_report') return { data: {}, error: null };
      return { data: null, error: { message: 'unexpected ' + fn } };
    }
  };
  return { db, statuses };
}
{
  const s = syncDb(sealKey(KEY, 's1'));
  const auths: string[] = [];
  const fetch = async (_u: string, init: RequestInit) => { auths.push(String((init.headers as Record<string, string>).Authorization)); return json(200, { success: true, data: [], meta: { next_page_url: null } }); };
  const r = await runCrocodialSync({ db: s.db, env: { AUTOMATION_SECRET_KEY: 's1' } as any, fetch, sleep: async () => undefined, minGapMs: 0 });
  check(r.connections[0]?.health === 'OK' && auths.length > 0 && auths.every(a => a === `Bearer ${KEY}`), 'the sync opens the stored key and uses it', { r, auths });
}
{
  const s = syncDb(sealKey(KEY, 'old-secret'));
  let calls = 0;
  const fetch = async () => { calls++; return json(200, {}); };
  const r = await runCrocodialSync({ db: s.db, env: { AUTOMATION_SECRET_KEY: 's1' } as any, fetch, sleep: async () => undefined, minGapMs: 0 });
  check(calls === 0 && r.connections[0]?.health === 'KEY_UNREADABLE', 'a stored key that no longer opens: nothing is sent to Crocodial', r);
  check(s.statuses.length === 1 && s.statuses[0].p_connection === 'c1' && s.statuses[0].p_health === 'KEY_UNREADABLE' && s.statuses[0].p_error === null,
    'and the connection is marked KEY_UNREADABLE', s.statuses);
}

console.log(`=== ${passed} CROCODIAL KEY CHECKS PASSED ===`);
