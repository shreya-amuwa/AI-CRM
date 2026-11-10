// Unit test of the load fixes (PR "chat under load"): the API refuses quickly when the database is busy instead of retrying through the
// slower three-call sign-in path, and a query that gets no answer is given up after the deadline (no 30-second hang).
import { createServer } from 'node:http';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exit(1); } passed++; console.log('ok -', name); };

process.env.USER_QUERY_TIMEOUT_MS = '300';
const { isMissingObject } = await import('../../server/auth/authenticate');
const { fetchWithTimeout } = await import('../../server/db/supabase');

check(isMissingObject('PGRST202', 'Could not find the function public.api_session'), 'a function that is not there (migration missing): the slower path is allowed');
check(isMissingObject('42883', 'function private.rate_hit(text) does not exist'), 'an object a missing migration would create: allowed');
check(!isMissingObject('57014', 'canceling statement due to statement timeout'), 'a statement timeout is "busy", not "missing"');
check(!isMissingObject('PGRST003', 'Timed out acquiring connection from connection pool.'), 'a full connection pool is "busy", not "missing"');
check(!isMissingObject(undefined, 'upstream request timeout'), 'a gateway timeout is "busy"');

// a server that never answers
const srv = createServer(() => { /* never answers */ });
await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
const port = (srv.address() as { port: number }).port;
const t0 = Date.now();
let aborted = false;
try { await fetchWithTimeout(`http://127.0.0.1:${port}/`); } catch (e) { aborted = /abort|timeout/i.test(String((e as Error)?.name) + String((e as Error)?.message)); }
check(aborted && Date.now() - t0 < 3000, 'a query with no answer is given up after the deadline', Date.now() - t0);
const own = new AbortController();
const p = fetchWithTimeout(`http://127.0.0.1:${port}/`, { signal: own.signal }).then(() => false, () => true);
own.abort();
check(await p, 'the caller can still cancel it');
srv.closeAllConnections?.();
srv.close();
console.log(`=== CHAT LOAD TESTS PASSED (${passed}) ===`);
