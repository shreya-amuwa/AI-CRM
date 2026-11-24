/**
 * The Crocodial client (server/crocodial/client.ts) and "Test connection" (server/crocodial/directory.ts), with a fake fetch and a stub
 * database: the token only travels in the header, next_page_url is followed only when it is the next page of the same address, errors map
 * to clear health states, 429 waits and retries, rows that do not validate are skipped, and phone numbers / e-mails are never stored.
 */
import { CrocodialClient, CrocodialError, crocodialEmployeeSchema, crocodialToken, safeNextUrl } from '../../server/crocodial/client.js';
import { testCrocodialConnection } from '../../server/crocodial/directory.js';
import { CrocodialService } from '../../server/services/CrocodialService.js';
import { crocodialConnectionSaveSchema, crocodialCountFromSchema, crocodialLeadsQuerySchema, crocodialMappingSchema } from '../../shared/validation.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const B = 'https://app.crocodial.app/api/datalake/outbound';
const TOKEN = 'test-token-not-real-1234';
type Call = { url: string; init: RequestInit };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function fake(replies: (Response | Error)[]) {
  const calls: Call[] = [];
  const f = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift();
    if (!r) throw new Error('no more replies');
    if (r instanceof Error) throw r;
    return r;
  };
  return { f, calls };
}
const slept: number[] = [];
const sleep = async (ms: number) => { slept.push(ms); };
const page = (rows: unknown[], next: string | null, extra: Record<string, unknown> = {}) =>
  json(200, { success: true, data: rows, meta: { resource: 'employees', page: 1, per_page: 500, total: rows.length, timezone: 'Asia/Kolkata', next_page_url: next, ...extra }, filters: {} });

// ---------------------------------------------------------------------------- token and next page
check(crocodialToken('CROCODIAL_TOKEN_MPILLAR', { CROCODIAL_TOKEN_MPILLAR: ' abcdefgh12 ' } as any) === 'abcdefgh12', 'the token is read from the named server setting');
check(crocodialToken('DATABASE_URL', { DATABASE_URL: 'postgres://secret' } as any) === null, 'a setting outside the CROCODIAL_TOKEN_ names is never read');
check(crocodialToken('CROCODIAL_TOKEN_X', {} as any) === null, 'a missing setting means no token');
check(safeNextUrl(`${B}/leads?per_page=500&page=1`, `${B}/leads?per_page=500&page=2`) === `${B}/leads?per_page=500&page=2`, 'the next page of the same address is followed');
check(safeNextUrl(`${B}/leads?page=1`, 'https://evil.example.com/api/datalake/outbound/leads?page=2') === null, 'another host is never followed (the token would leak)');
check(safeNextUrl(`${B}/leads?page=1`, `${B}/employees?page=2`) === null, 'another resource is not followed');
check(safeNextUrl(`${B}/leads?page=1`, `${B}/leads?page=5`) === null, 'a jump in page numbers is not followed');
check(safeNextUrl(`${B}/leads?page=1`, `${B}/leads?page=2&token=abc`) === null, 'an address carrying a token is not followed');
check(safeNextUrl(`${B}/leads?page=1`, `http://app.crocodial.app/api/datalake/outbound/leads?page=2`) === null, 'plain http is not followed');
check(safeNextUrl(`${B}/leads?page=1`, null) === null, 'no next page: done');

// ---------------------------------------------------------------------------- pages, validation, header
{
  const { f, calls } = fake([
    page([{ id: 1, name: 'A' }, { id: 'bad' }], `${B}/employees?per_page=500&page=2`),
    page([{ id: 2, name: 'B', phone: '+91', email: 'x@y' }], null)
  ]);
  const c = new CrocodialClient(TOKEN, { fetch: f, sleep, minGapMs: 0 });
  const r = await c.all('employees', crocodialEmployeeSchema);
  check(r.rows.length === 2 && r.skipped === 1 && r.pages === 2 && r.timezone === 'Asia/Kolkata', 'every page is read; a row that does not validate is skipped and counted', r);
  check(calls.every(x => (x.init.headers as any).Authorization === `Bearer ${TOKEN}` && !x.url.includes(TOKEN)), 'the token is sent in the header, never in the address');
  check(calls.every(x => x.init.method === 'GET'), 'only GET requests are made (nothing is changed in Crocodial)');
  check(new URL(calls[0].url).searchParams.get('per_page') === '500', 'pages of 500 rows (the most Crocodial allows)');
}
{
  const { f } = fake([page([], `${B}/employees?page=2`), page([], `${B}/employees?page=3`)]);
  const c = new CrocodialClient(TOKEN, { fetch: f, sleep, minGapMs: 0 });
  let err: unknown;
  try { await c.all('employees', crocodialEmployeeSchema, {}, 1); } catch (e) { err = e; }
  check(err instanceof CrocodialError && /More than 1 pages/.test((err as Error).message), 'a page limit stops a runaway pull');
}

// ---------------------------------------------------------------------------- errors and waiting
async function errorOf(replies: (Response | Error)[]): Promise<CrocodialError | null> {
  const c = new CrocodialClient(TOKEN, { fetch: fake(replies).f, sleep, minGapMs: 0 });
  try { await c.page(`${B}/employees?page=1`); return null; } catch (e) { return e as CrocodialError; }
}
check((await errorOf([json(401, { success: false, message: 'Unauthenticated' })]))?.health === 'AUTH_FAILED', '401: the token is wrong or regenerated');
check((await errorOf([json(403, { success: false, message: 'Turned off' })]))?.health === 'DISABLED_AT_SOURCE', '403: the token is turned off in Crocodial');
slept.length = 0;
{
  const c = new CrocodialClient(TOKEN, { fetch: fake([json(429, {}), page([{ id: 7 }], null)]).f, sleep, minGapMs: 0 });
  const p = await c.page(`${B}/employees?page=1`);
  check(p.rows.length === 1 && slept.includes(60_000), '429: waits a minute and tries again');
}
check((await errorOf([json(429, {}), json(429, {}), json(429, {})]))?.health === 'RATE_LIMITED', 'a third 429 stops with "rate limited"');
check((await errorOf([new TypeError('fetch failed'), json(502, {}), page([], null)])) === null, 'a network error and a 5xx are retried');
check((await errorOf([json(500, {}), json(500, {}), json(500, {})]))?.health === 'ERROR', 'repeated server errors stop with an error');
check((await errorOf([json(200, { hello: 'world' })]))?.health === 'ERROR', 'an answer in an unexpected shape is an error, not data');
{
  slept.length = 0;
  const c = new CrocodialClient(TOKEN, { fetch: fake([page([], null), page([], null)]).f, sleep, minGapMs: 1_200 });
  await c.page(`${B}/branches?page=1`);
  await c.page(`${B}/employees?page=1`);
  check(slept.some(ms => ms > 0 && ms <= 1_200), 'requests are spaced (at most 50 a minute, under Crocodial\'s 60)');
}

// ---------------------------------------------------------------------------- Test connection
function stubDb() {
  const calls: { fn: string; args: any }[] = [];
  return { calls, db: { rpc: async (fn: string, args: any) => (calls.push({ fn, args }), { data: { employees: 2, branches: 1 }, error: null }) } as any };
}
{
  const s = stubDb();
  const r = await testCrocodialConnection({ id: 'c1', credentialRef: 'CROCODIAL_TOKEN_MP' }, { db: s.db, env: {} as any, fetch: fake([]).f, sleep, minGapMs: 0 });
  check(!r.ok && r.health === 'NO_CREDENTIAL' && /CROCODIAL_TOKEN_MP/.test(r.message) && r.requests === 0, 'without the server setting nothing is called, and it says which setting is missing');
  const st = s.calls.find(c => c.fn === 'croc_connection_status');
  check(st?.args.p_health === 'NO_CREDENTIAL', 'the connection is marked "no credential"');
  const rep = s.calls.find(c => c.fn === 'croc_runtime_report');
  check(rep?.args.p_detected === false && rep?.args.p_valid === false && s.calls.indexOf(rep!) < s.calls.indexOf(st!),
    'this server records what it saw first (detected: no), never a value');
}
{
  const s = stubDb();
  const { f } = fake([
    page([{ id: 371, name: 'Supriya Mpillar', mobile: '9999999999', email: 's@example.com', is_active: true, branches: [{ id: 121, branch_name: 'M pillar' }] },
          { id: 4138, name: 'sachin ', mobile: '8888888888', is_active: true, branches: [] }], null),
    page([{ id: 121, branch_name: 'M pillar corporation', status: 'active', latitude: 1 }], null)
  ]);
  const r = await testCrocodialConnection({ id: 'c1', credentialRef: 'CROCODIAL_TOKEN_MP' }, { db: s.db, env: { CROCODIAL_TOKEN_MP: TOKEN } as any, fetch: f, sleep, minGapMs: 0 });
  const stored = s.calls.find(c => c.fn === 'croc_store_directory')!.args;
  check(r.ok && r.employees === 2 && r.branches === 1 && r.requests === 2, 'the test reads the employee and branch lists only', r);
  check(JSON.stringify(stored.p_employees) === JSON.stringify([
    { id: 371, name: 'Supriya Mpillar', isActive: true, branchIds: [121], updatedAt: null },
    { id: 4138, name: 'sachin', isActive: true, branchIds: [], updatedAt: null }]), 'names, active flags and branches are kept; phone numbers and e-mails are not', stored.p_employees);
  check(s.calls.at(-1)!.fn === 'croc_connection_status' && s.calls.at(-1)!.args.p_health === 'OK', 'the connection is marked healthy');
  check(!JSON.stringify(s.calls).includes(TOKEN) && !JSON.stringify(r).includes(TOKEN), 'the token is never stored or returned');
}
{
  const s = stubDb();
  const r = await testCrocodialConnection({ id: 'c1', credentialRef: 'CROCODIAL_TOKEN_MP' }, { db: s.db, env: { CROCODIAL_TOKEN_MP: TOKEN } as any, fetch: fake([json(401, {})]).f, sleep, minGapMs: 0 });
  check(!r.ok && r.health === 'AUTH_FAILED' && s.calls.at(-1)!.args.p_health === 'AUTH_FAILED', 'a refused token is reported as such');
}

// ---------------------------------------------------------------------------- the service and the input
{
  const repo = { overview: async () => ({ connections: [{ id: 'c1', credentialRef: 'CROCODIAL_TOKEN_MP' }, { id: 'c2', credentialRef: 'CROCODIAL_TOKEN_OTHER' }] }) } as any;
  const o = await new CrocodialService(repo, { CROCODIAL_TOKEN_MP: TOKEN } as any).overview();
  check(o.connections[0].credentialConfigured === true && o.connections[1].credentialConfigured === false && !JSON.stringify(o).includes(TOKEN),
    'the Super Admin sees whether each token setting exists, never its value');
}
check(crocodialConnectionSaveSchema.safeParse({ name: 'M Pillar', credentialRef: 'crocodial_token_mpillar' }).success, 'a credential name is accepted in any case');
check(!crocodialConnectionSaveSchema.safeParse({ name: 'M Pillar', credentialRef: 'rmd_abcdefghijklmnop' }).success, 'a pasted token is refused as a credential name');
check(!crocodialConnectionSaveSchema.safeParse({ name: 'M Pillar', credentialRef: 'CROCODIAL_TOKEN_MP', token: 'x' }).success, 'unknown fields (a token) are refused');
check(!crocodialMappingSchema.safeParse({ connectionId: 'x', externalEmployeeId: 1, profileId: 'y', departmentId: 'z' }).success, 'a mapping needs real ids');
check(crocodialCountFromSchema.safeParse({ from: null }).success && crocodialCountFromSchema.safeParse({ from: '2026-09-01' }).success,
  'count activity from: the first stored record (null) or a day');
check(!crocodialCountFromSchema.safeParse({ from: '01/09/2026' }).success && !crocodialCountFromSchema.safeParse({ from: '2026-09-01', profileId: 'x' }).success,
  'count activity from: only a YYYY-MM-DD day, nothing else');
check(crocodialLeadsQuerySchema.safeParse({ search: 'ravi', filter: 'FOLLOW_UP_DUE', page: '2', pageSize: '25' }).success, 'leads: search, filter and a page');
check(!crocodialLeadsQuerySchema.safeParse({ filter: 'EVERYTHING' }).success && !crocodialLeadsQuerySchema.safeParse({ pageSize: '500' }).success
  && !crocodialLeadsQuerySchema.safeParse({ token: 'x' }).success, 'leads: an unknown filter, a page over 100 or unknown fields are refused');

console.log(`=== ${passed} CROCODIAL CHECKS PASSED ===`);
