/**
 * The browser API client: identical GET requests in flight share one call, a few reference lists are reused for a short time, and
 * any change forgets every reused answer. Runs in Node with a stand-in fetch (no server, no database).
 */
let calls: { method: string; url: string; headers: Record<string, string> }[] = [];
let release: (() => void)[] = [];
let holdResponses = false;
(globalThis as any).window = globalThis;
(globalThis as any).addEventListener ??= () => {};
(globalThis as any).dispatchEvent ??= () => true;
(globalThis as any).CustomEvent ??= class { constructor(public type: string) {} };
(globalThis as any).fetch = async (url: string, init: { method: string; headers: Record<string, string> }) => {
  calls.push({ method: init.method, url, headers: init.headers });
  if (holdResponses) await new Promise<void>(r => release.push(r));
  return { status: 200, text: async () => JSON.stringify({ success: true, data: { items: [1, 2, 3], n: calls.length } }) };
};

const { api, clearApiCache } = await import('../../src/lib/api/client.js');
const { setRequestScope } = await import('../../src/lib/scope/activeScope.js');

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}
const reset = () => { calls = []; release = []; holdResponses = false; clearApiCache(); };

// identical GETs in flight share one call; each caller gets its own copy
reset();
holdResponses = true;
const a = api.get<{ items: number[] }>('/pipeline/customers', { stage: 'LEAD' });
const b = api.get<{ items: number[] }>('/pipeline/customers', { stage: 'LEAD' });
await new Promise(r => setTimeout(r, 10));
release.forEach(r => r());
const [ra, rb] = await Promise.all([a, b]);
check(calls.length === 1, 'two identical GETs at the same time make one network call', calls);
ra.items.push(99);
check(rb.items.length === 3, 'each caller gets its own copy (changing one answer does not change the other)', rb);

// different query / different scope: separate calls
reset();
holdResponses = true;
const c1 = api.get('/pipeline/customers', { stage: 'LEAD' });
const c2 = api.get('/pipeline/customers', { stage: 'POTENTIAL' });
await new Promise(r => setTimeout(r, 0)); // the client reads the scope once the session is known (a tick later)
setRequestScope({ departmentId: '11111111-1111-1111-1111-111111111111', division: 'SALES' });
const c3 = api.get('/pipeline/customers', { stage: 'LEAD' });
await new Promise(r => setTimeout(r, 0));
setRequestScope({ departmentId: null, division: null });
await new Promise(r => setTimeout(r, 10));
release.forEach(r => r());
await Promise.all([c1, c2, c3]);
check(calls.length === 3, 'a different query or a different department scope is never shared', calls.map(c => c.url));
check(calls[2].headers['X-Active-Department'] === '11111111-1111-1111-1111-111111111111', 'the scope header is still sent');

// ordinary lists are not kept after they arrive
reset();
await api.get('/pipeline/customers', { stage: 'LEAD' });
await api.get('/pipeline/customers', { stage: 'LEAD' });
check(calls.length === 2, 'an ordinary list is fetched again on the next visit (never kept)');

// reference lists are reused for a short time
reset();
await api.get('/pipeline/services');
await api.get('/pipeline/services');
check(calls.length === 1, 'the service catalogue is reused (one call)', calls.map(c => c.url));
await api.get('/departments');
await api.get('/departments');
await api.get('/teams');
await api.get('/teams');
check(calls.length === 5, 'departments and teams are never kept (they carry live details)', calls.map(c => c.url));

// a change forgets them
await api.post('/pipeline/leads', { name: 'x' });
await api.get('/pipeline/services');
check(calls.length === 7 && calls[5].method === 'POST' && calls[6].url.endsWith('/pipeline/services'), 'after a change the reference list is fetched again', calls.map(c => `${c.method} ${c.url}`));

// a refused change forgets them too
reset();
await api.get('/pipeline/services');
(globalThis as any).fetch = async (url: string, init: { method: string; headers: Record<string, string> }) => {
  calls.push({ method: init.method, url, headers: init.headers });
  if (init.method !== 'GET') return { status: 422, text: async () => JSON.stringify({ success: false, error: { code: 'VALIDATION_ERROR', message: 'no' } }) };
  return { status: 200, text: async () => JSON.stringify({ success: true, data: [] }) };
};
await api.patch('/teams/x', {}).catch(() => undefined);
await api.get('/pipeline/services');
check(calls.length === 3, 'a refused change also forgets the reused answers', calls.map(c => `${c.method} ${c.url}`));

// errors are never kept
reset();
let fail = true;
(globalThis as any).fetch = async (url: string, init: { method: string; headers: Record<string, string> }) => {
  calls.push({ method: init.method, url, headers: init.headers });
  if (fail) return { status: 500, text: async () => JSON.stringify({ success: false, error: { code: 'INTERNAL', message: 'boom' } }) };
  return { status: 200, text: async () => JSON.stringify({ success: true, data: [] }) };
};
await api.get('/pipeline/services').catch(() => undefined);
fail = false;
const after = await api.get<unknown[]>('/pipeline/services');
check(calls.length === 2 && Array.isArray(after), 'a failed answer is never reused');

// a list asked for after a change never joins a request sent before the change (it would show the old data)
reset();
let n = 0;
let releaseOld: (() => void) | undefined;
(globalThis as any).fetch = async (url: string, init: { method: string; headers: Record<string, string> }) => {
  calls.push({ method: init.method, url, headers: init.headers });
  const mine = ++n;
  if (init.method === 'GET' && mine === 1) await new Promise<void>(r => (releaseOld = r)); // the old list request is slow
  return { status: 200, text: async () => JSON.stringify({ success: true, data: { version: init.method === 'GET' ? mine : 0 } }) };
};
const oldList = api.get<{ version: number }>('/hr/recruitment/candidates');
await new Promise(r => setTimeout(r, 5));
await api.patch('/hr/recruitment/candidates/1', { status: 'CONFIRMED' });
const newList = api.get<{ version: number }>('/hr/recruitment/candidates');
await new Promise(r => setTimeout(r, 5));
releaseOld!();
const [o, nw] = await Promise.all([oldList, newList]);
check(calls.filter(c => c.method === 'GET').length === 2 && o.version === 1 && nw.version === 3, 'a GET made after a change is a new request, not the one sent before the change', { calls: calls.map(c => c.method), o, nw });

console.log(`=== ${passed} API CLIENT CACHE CHECKS PASSED ===`);
