/**
 * Crocodial token detection and the scoped refresh, server side (docs/CROCODIAL_INTEGRATION.md, "Connection health" and "Refresh"):
 *   - the token is found in process.env or, on the Worker, in its own bindings; a value not shaped like a token is not used;
 *   - every answer names the server (Cloudflare / Vercel / Node.js, environment, deployment) and never contains the token;
 *   - a server without the token does not mark the connection broken while another server has it;
 *   - the refresh answer never carries the connections it started (they are read after the answer);
 *   - the dashboard wording: the health category, the server mismatch, the refresh messages.
 */
import { credentialCheck, credentialProblem, readSetting, resolveCredential, runtimeInfo, tokenFormatValid, useRuntimeBindings } from '../../server/crocodial/runtime.js';
import { crocodialToken } from '../../server/crocodial/client.js';
import { runCrocodialSync } from '../../server/crocodial/sync.js';
import { CrocodialService } from '../../server/services/CrocodialService.js';
import { healthCategory, serverMismatch } from '../../src/components/crocodial/CrocodialConnectionHealth.js';
import { ago, refreshMessage } from '../../src/components/crocodial/CrocodialRefreshControl.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const TOKEN = 'cr0c-test-token-not-real-91';

// ---------------------------------------------------------------------------- finding the token
check(crocodialToken('CROCODIAL_TOKEN_MPILLAR', { CROCODIAL_TOKEN_MPILLAR: TOKEN } as any) === TOKEN, 'a token in the environment is found');
check(crocodialToken('CROCODIAL_TOKEN_MPILLAR', { CROCODIAL_TOKEN_MPILLAR: `  ${TOKEN}\n` } as any) === TOKEN, 'surrounding spaces / a trailing line break are ignored');
check(crocodialToken('crocodial_token_mpillar', { crocodial_token_mpillar: TOKEN } as any) === null, 'a name outside the CROCODIAL_TOKEN_<NAME> convention is never looked up');
check(crocodialToken('CROCODIAL_TOKEN_MPILLAR', {} as any) === null, 'missing: no token');
for (const bad of ['short', `Bearer ${TOKEN}`, `"${TOKEN}"`, `${TOKEN} extra`]) {
  check(!tokenFormatValid(bad.trim()) && crocodialToken('CROCODIAL_TOKEN_MPILLAR', { CROCODIAL_TOKEN_MPILLAR: bad } as any) === null, `a value shaped wrongly is not used (${bad.slice(0, 8)}…)`);
}
const c1 = credentialCheck('CROCODIAL_TOKEN_MPILLAR', { CROCODIAL_TOKEN_MPILLAR: `Bearer ${TOKEN}` } as any);
check(c1.nameValid && c1.detected && !c1.formatValid, 'detected, but the format is invalid: the two are told apart', c1);

// the Worker's bindings: used when process.env lacks the setting (never with an explicit env, as in these tests)
delete process.env.CROCODIAL_TOKEN_BINDINGTEST;
check(resolveCredential('CROCODIAL_TOKEN_BINDINGTEST') === null, 'not in process.env and no bindings: not found');
useRuntimeBindings({ CROCODIAL_TOKEN_BINDINGTEST: TOKEN, CF_VERSION_METADATA: { id: 'abc-123', tag: '' } });
check(resolveCredential('CROCODIAL_TOKEN_BINDINGTEST') === TOKEN && readSetting('CROCODIAL_TOKEN_BINDINGTEST') === TOKEN, 'found in the Worker’s bindings');
check(resolveCredential('CROCODIAL_TOKEN_BINDINGTEST', {} as any) === null, 'an explicit environment is the only source');
process.env.CROCODIAL_TOKEN_BINDINGTEST = 'from-process-env-xyz';
check(resolveCredential('CROCODIAL_TOKEN_BINDINGTEST') === 'from-process-env-xyz', 'process.env comes first');
delete process.env.CROCODIAL_TOKEN_BINDINGTEST;

// ---------------------------------------------------------------------------- which server
const prevPlatform = process.env.CRM_PLATFORM;
process.env.CRM_PLATFORM = 'cloudflare';
process.env.CRM_ENVIRONMENT = 'production';
const cf = runtimeInfo(undefined, 'CRM.amuwacorporation.com');
check(cf.platform === 'cloudflare' && cf.runtime === 'cloudflare:production' && cf.deployment === 'abc-123' && cf.host === 'crm.amuwacorporation.com',
  'Cloudflare: platform, environment, deployment (version metadata), address', cf);
if (prevPlatform === undefined) delete process.env.CRM_PLATFORM; else process.env.CRM_PLATFORM = prevPlatform;
delete process.env.CRM_ENVIRONMENT;
useRuntimeBindings(null);
const vc = runtimeInfo({ VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: '0123456789abcdef' } as any);
check(vc.runtime === 'vercel:production' && vc.deployment === '0123456789ab', 'Vercel: its environment and commit', vc);
check(runtimeInfo({} as any).runtime === 'node:local', 'Node.js: local');
const msg = credentialProblem('CROCODIAL_TOKEN_MPILLAR', { nameValid: true, detected: false, formatValid: false }, vc);
check(msg.includes('This server (Vercel, production) has no CROCODIAL_TOKEN_MPILLAR setting'), 'the message names the server that lacks the setting', msg);
const msg2 = credentialProblem('CROCODIAL_TOKEN_MPILLAR', c1, cf);
check(msg2.includes('not a valid token') && !msg2.includes(TOKEN), 'an invalid value is reported without the value', msg2);

// ---------------------------------------------------------------------------- a server without the token
function stubDb(otherHasCredential: boolean) {
  const statuses: any[] = [];
  const reports: any[] = [];
  const db: any = {
    rpc: async (fn: string, a: any) => {
      if (fn === 'croc_sync_due') return { data: [{ id: 'c1', credentialRef: 'CROCODIAL_TOKEN_MP' }], error: null };
      if (fn === 'croc_runtime_report') { reports.push(a); return { data: { recorded: true, otherHasCredential }, error: null }; }
      if (fn === 'croc_connection_status') { statuses.push(a); return { data: null, error: null }; }
      return { data: null, error: { message: 'unexpected ' + fn } };
    }
  };
  return { db, statuses, reports };
}
const urls: string[] = [];
const fetchSpy = async (u: string) => { urls.push(u); return new Response('{}', { status: 500 }); };
{
  const s = stubDb(true);
  const r = await runCrocodialSync({ db: s.db, env: { VERCEL: '1', VERCEL_ENV: 'production' } as any, fetch: fetchSpy, sleep: async () => undefined, minGapMs: 0 });
  check(s.statuses.length === 0 && urls.length === 0 && /another server/.test(r.connections[0].error ?? ''),
    'another server has the token: this one leaves the connection alone (no "missing" status, Crocodial not called)', r);
  check(s.reports[0]?.p_detected === false && s.reports[0]?.p_runtime?.runtime === 'vercel:production' && !JSON.stringify(s.reports).includes(TOKEN),
    'and records what it saw (no / no), with its name', s.reports);
}
{
  const s = stubDb(false);
  await runCrocodialSync({ db: s.db, env: { VERCEL: '1', VERCEL_ENV: 'production' } as any, fetch: fetchSpy, sleep: async () => undefined, minGapMs: 0 });
  check(s.statuses[0]?.p_health === 'NO_CREDENTIAL' && /Vercel, production/.test(s.statuses[0]?.p_error), 'no server has it: the connection says so, naming the server', s.statuses);
}

// ---------------------------------------------------------------------------- the refresh answer
{
  const base = { id: 'r1', scope: 'SELF', departmentId: null, people: 1, connections: 1, outcome: 'QUEUED', requestedAt: new Date().toISOString(), state: 'REFRESH_QUEUED', finished: false, lastSyncAt: null };
  const repo: any = { refreshRequest: async (scope: string, dept: string | null) => ({ ...base, scope, departmentId: dept, kick: ['conn-1'] }) };
  const svc = new CrocodialService(repo, {} as any);
  const r = await svc.refresh({ scope: 'SELF' });
  check(!('kick' in (r.data as any)) && typeof r.after === 'function', 'the answer never carries the connections; the read runs after it', r.data);
  repo.refreshRequest = async () => ({ ...base, outcome: 'JOINED', kick: [] });
  check((await svc.refresh({ scope: 'SELF' })).after === undefined, 'a joined request starts nothing');
  let threw = '';
  try { await svc.refresh({ scope: 'SELF', profileId: 'someone-else' }); } catch (e) { threw = (e as Error).message; }
  check(threw !== '', 'a payload naming another person is refused before the database (only a scope is accepted)', threw);
  threw = '';
  try { await svc.refresh({ scope: 'EVERYTHING' }); } catch (e) { threw = (e as Error).message; }
  check(threw !== '', 'an unknown scope is refused');
}

// ---------------------------------------------------------------------------- the dashboard wording
const conn = (health: string, lastError: string | null = null) => ({ health, lastError } as any);
const cur = (detected: boolean, valid: boolean) => ({ nameValid: true, credentialDetected: detected, credentialFormatValid: valid });
check(healthCategory({ current: cur(false, false), connection: conn('OK'), lastSyncAt: 'x' }).label.startsWith('Secret missing'), 'missing on this server comes first, even with an old OK');
check(healthCategory({ current: cur(true, false), connection: conn('OK'), lastSyncAt: null }).label.includes('format is invalid'), 'invalid format');
check(healthCategory({ current: cur(true, true), connection: conn('AUTH_FAILED'), lastSyncAt: null }).label.includes('401'), '401');
check(healthCategory({ current: cur(true, true), connection: conn('DISABLED_AT_SOURCE'), lastSyncAt: null }).label.includes('403'), '403');
check(healthCategory({ current: cur(true, true), connection: conn('RATE_LIMITED'), lastSyncAt: null }).label.includes('rate-limited'), 'rate limited');
check(healthCategory({ current: cur(true, true), connection: conn('ERROR', 'Crocodial could not be reached (AbortError).'), lastSyncAt: null }).label.includes('timeout'), 'network timeout');
check(healthCategory({ current: cur(true, true), connection: conn('NO_CREDENTIAL'), lastSyncAt: null }).label.startsWith('Old status'), 'an old "missing" status is labelled old when this server has the token');
check(healthCategory({ current: cur(true, true), connection: conn('OK'), lastSyncAt: null }).tone === 'ok', 'connected');
const now = Date.parse('2026-11-21T12:00:00Z');
const rep = (runtime: string, platform: string, ok: boolean) => ({ runtime, platform, environment: 'production', deployment: null, host: null, credentialDetected: ok, credentialFormatValid: ok, context: 'SYNC', reportedAt: '2026-11-21T11:00:00Z' } as any);
const mix = serverMismatch([rep('cloudflare:production', 'cloudflare', true), rep('vercel:production', 'vercel', false)], now);
check(mix.withToken.length === 1 && mix.without.length === 1 && mix.without[0].platform === 'vercel', 'two servers, one without the token: shown', mix);
check(refreshMessage('SELF', 'UP_TO_DATE') === 'Your Crocodial data is up to date.', 'employee: up to date');
check(refreshMessage('TEAM', 'SYNCING') === 'Refreshing Crocodial data…', 'refreshing');
check(refreshMessage('SELF', 'TOKEN_MISSING').includes('administrator') && !/token/i.test(refreshMessage('SELF', 'TOKEN_MISSING').replace('Crocodial', '')),
  'an employee is told to ask the administrator, without token details');
check(ago(new Date(now - 120_000).toISOString(), now) === '2 minutes ago' && ago(null) === 'never', '"Last synced: 2 minutes ago"');

console.log(`\n=== CROCODIAL RUNTIME / REFRESH UNIT TESTS PASSED (${passed}) ===`);
