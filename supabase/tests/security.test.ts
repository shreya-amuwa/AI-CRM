/**
 * Security unit tests (no database): the outbound-request guard behind /api/proxy, the /api/proxy and lead-webhook handlers.
 * Run: npm run test:unit
 */
process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.VITE_SUPABASE_URL;
delete process.env.VITE_SUPABASE_ANON_KEY;

const { assertPublicUrl, isPrivateAddress, BlockedTargetError } = await import('../../server/net/safeFetch.js');
const { default: proxyHandler } = await import('../../api/proxy.js');
const { default: webhookHandler } = await import('../../api/webhook.js');
const { default: webhookPathHandler } = await import('../../api/webhooks/[...path].js');

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------
for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
                  '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', 'not-an-ip']) {
  check(isPrivateAddress(ip), `${ip} is refused`);
}
for (const ip of ['8.8.8.8', '1.1.1.1', '142.250.80.46', '172.32.0.1', '2606:4700:4700::1111']) {
  check(!isPrivateAddress(ip), `${ip} is a public address`);
}
const blocked = (u: string) => {
  try { assertPublicUrl(u); return false; } catch (e) { return e instanceof BlockedTargetError; }
};
for (const u of ['http://localhost/x', 'http://127.0.0.1/x', 'https://169.254.169.254/latest/meta-data', 'http://[::1]/x', 'http://10.0.0.5/', 'file:///etc/passwd',
                 'ftp://example.com/x', 'gopher://example.com', 'https://user:pw@example.com/', 'https://example.com:22/', 'http://example.com:8080/', 'http://metadata.google.internal/',
                 'http://printer.local/', 'http://foo.localhost/', 'not a url', 'http://0x7f000001/', 'http://2130706433/', 'http://127.1/']) {
  check(blocked(u), `${u} is refused`);
}
for (const u of ['https://docs.google.com/spreadsheets/d/abc/export?format=csv', 'http://example.com/a', 'https://script.google.com/macros/s/x/exec']) {
  check(!blocked(u), `${u} is allowed`);
}

// ---------------------------------------------------------------------------
// Tiny stand-in for Vercel's request / response objects
// ---------------------------------------------------------------------------
function call(handler: (req: any, res: any) => unknown, opts: { method: string; query?: Record<string, any>; headers?: Record<string, string>; body?: unknown; url?: string }) {
  return new Promise<{ status: number; headers: Record<string, string>; body: any }>(resolve => {
    const headers: Record<string, string> = {};
    let status = 200;
    const res: any = {
      setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = String(v); return res; },
      status: (s: number) => { status = s; return res; },
      json: (b: unknown) => { headers['content-type'] ??= 'application/json'; resolve({ status, headers, body: b }); return res; },
      send: (b: unknown) => { resolve({ status, headers, body: b }); return res; },
      end: () => { resolve({ status, headers, body: undefined }); return res; }
    };
    const req: any = { method: opts.method, query: opts.query || {}, headers: Object.fromEntries(Object.entries(opts.headers || {}).map(([k, v]) => [k.toLowerCase(), v])), body: opts.body, url: opts.url || '/api/webhook' };
    Promise.resolve(handler(req, res)).catch(e => { console.error(e); process.exit(1); });
  });
}

// ---------------------------------------------------------------------------
// /api/proxy
// ---------------------------------------------------------------------------
let r = await call(proxyHandler, { method: 'GET', query: { url: 'https://example.com/' } });
check(r.status === 401, 'the proxy needs a signed-in user', r);
check(!('access-control-allow-origin' in r.headers), 'the proxy sends no CORS headers (no cross-site use)', r.headers);
r = await call(proxyHandler, { method: 'POST', body: { url: 'http://169.254.169.254/' } });
check(r.status === 405, 'the proxy no longer relays POST', r);
r = await call(proxyHandler, { method: 'OPTIONS' });
check(r.status === 405 && !('access-control-allow-origin' in r.headers), 'a cross-site pre-flight to the proxy is not answered with a wildcard', r);
r = await call(proxyHandler, { method: 'GET', query: { url: 'http://169.254.169.254/latest/meta-data/' }, headers: { Authorization: 'Basic abc' } });
check(r.status === 401, 'a non-bearer credential is refused', r);

// ---------------------------------------------------------------------------
// Lead webhook
// ---------------------------------------------------------------------------
r = await call(webhookHandler, { method: 'OPTIONS' });
check(r.status === 204 && !('access-control-allow-origin' in r.headers), 'the webhook sends no wildcard CORS header', r.headers);
r = await call(webhookHandler, { method: 'PUT' });
check(r.status === 405, 'only GET / POST are accepted', r);
r = await call(webhookHandler, { method: 'GET', query: { 'hub.challenge': '<script>alert(1)</script>' } });
check(r.status === 403, 'a Meta challenge that is not a plain token is not echoed back (no reflected content)', r);
r = await call(webhookHandler, { method: 'GET', query: { 'hub.challenge': 'abc123' } });
check(r.status === 200 && r.body === 'abc123' && r.headers['content-type'].startsWith('text/plain') && r.headers['x-content-type-options'] === 'nosniff', 'a plain challenge is answered as text', r);
process.env.WEBHOOK_VERIFY_TOKEN = 'verify-me-please';
r = await call(webhookHandler, { method: 'GET', query: { 'hub.challenge': 'abc123', 'hub.verify_token': 'wrong' } });
check(r.status === 403, 'the verify token is checked when configured', r);
r = await call(webhookHandler, { method: 'GET', query: { 'hub.challenge': 'abc123', 'hub.verify_token': 'verify-me-please' } });
check(r.status === 200, 'and accepted when correct', r);

process.env.WEBHOOK_SECRET = 'a-long-shared-secret-1234,second-secret-abcdefg';
const lead = { name: 'Ravi', phone: '9820011111' };
r = await call(webhookHandler, { method: 'POST', body: lead });
check(r.status === 401, 'a lead without the shared secret is refused', r);
r = await call(webhookHandler, { method: 'POST', body: lead, headers: { 'x-webhook-secret': 'wrong-secret-wrong-secret' } });
check(r.status === 401, 'a wrong secret is refused', r);
r = await call(webhookHandler, { method: 'POST', body: lead, headers: { authorization: 'Bearer a-long-shared-secret-123' } });
check(r.status === 401, 'a prefix of the secret is refused', r);
r = await call(webhookPathHandler, { method: 'POST', query: { path: ['wabastore', 'whatsapp'] }, body: lead });
check(r.status === 401, 'the path form of the webhook needs the secret too', r);
r = await call(webhookHandler, { method: 'POST', body: lead, headers: { 'x-webhook-secret': 'second-secret-abcdefg' }, query: { department: 'Bad Dept!' } });
check(r.status === 400, 'department / source must be plain slugs', r);
r = await call(webhookPathHandler, { method: 'POST', query: { path: ['wabastore', "x'; drop table crm_leads;--"] }, body: lead, headers: { authorization: 'Bearer a-long-shared-secret-1234' } });
check(r.status === 400, 'an injection attempt in the source is refused', r);
r = await call(webhookHandler, { method: 'POST', body: lead, headers: { 'x-webhook-secret': 'second-secret-abcdefg' } });
check(r.status !== 401 && r.status !== 403, 'the right secret passes the authentication step', r);
check(!JSON.stringify(r.body).includes('second-secret'), 'the secret is never echoed');

delete process.env.WEBHOOK_SECRET;
for (let i = 0; i < 130; i++) r = await call(webhookHandler, { method: 'POST', body: 'not json', headers: { 'x-real-ip': '203.0.113.9' } });
check(r.status === 429, 'a flood from one address is rate limited', r);

console.log(`=== ${passed} SECURITY UNIT CHECKS PASSED ===`);
process.exit(0);
