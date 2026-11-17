/**
 * The server-side lead webhook pull: the provider credential comes from the server environment, is sent only to the provider's own host,
 * and is never returned to the browser. Run: npm run test:unit
 */
process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_ANON_KEY = 'anon-test-key';
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const { LeadWebhookService } = await import('../../server/services/LeadWebhookService.js');
const { webhookCredentialHeaders, webhookTokenVariable, isCredentialHost } = await import('../../server/leads/webhookSources.js');
const { BlockedTargetError } = await import('../../server/net/safeFetch.js');
const { routes } = await import('../../server/routes.js');

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

// Made-up value, only for this test.
const TEST_TOKEN = 'test-token-0123456789-abcdef';
const env = { [webhookTokenVariable('aicalling')]: TEST_TOKEN } as NodeJS.ProcessEnv;
const PROVIDER = 'https://webhooks.wabastore.com/webhook/abc123';

check(webhookTokenVariable('aicalling') === 'WABASTORE_SOURCE_TOKEN_AICALLING', 'the variable is named after the source');
check(isCredentialHost(PROVIDER), "the provider's host may receive a credential");
for (const u of ['http://webhooks.wabastore.com/x', 'https://evil.example.com/x', 'https://webhooks.wabastore.com.evil.com/x', 'https://u:p@webhooks.wabastore.com/x', 'not a url']) {
  check(!isCredentialHost(u), `no credential for ${u}`);
}
check(webhookCredentialHeaders('aicalling', PROVIDER, env)?.Authorization === `Bearer ${TEST_TOKEN}`, 'Bearer and x-api-key are built from the environment');
check(webhookCredentialHeaders('whatsapp', PROVIDER, env) === null, 'a source without its variable sends no credential');
check(webhookCredentialHeaders('aicalling', 'https://evil.example.com/x', env) === null, 'another host never gets the credential');

type Seen = { url: string; opts: any };
function service(answer: () => Promise<any>, seen: Seen[] = []) {
  return new LeadWebhookService(async (url, opts) => { seen.push({ url, opts }); return answer(); }, env);
}
const okAnswer = async () => ({ status: 200, contentType: 'application/json', body: Buffer.from('{"accepted":true}') });

{
  const seen: Seen[] = [];
  const r = await service(okAnswer, seen).fetchSource({ sourceId: 'aicalling', url: PROVIDER });
  check(seen[0].opts.headers?.['x-api-key'] === TEST_TOKEN && seen[0].opts.method === 'GET', 'the server sends the credential to the provider');
  check(r.status === 200 && r.body === '{"accepted":true}' && r.credentialApplied === true, 'the answer is passed on');
  check(!JSON.stringify(r).includes(TEST_TOKEN), 'the credential is never in the answer');
}
{
  const seen: Seen[] = [];
  const r = await service(okAnswer, seen).fetchSource({ sourceId: 'aicalling', url: 'https://script.google.com/macros/s/x/exec' });
  check(seen[0].opts.headers === undefined && r.credentialApplied === false, 'a custom address is fetched without any credential');
}
{
  const seen: Seen[] = [];
  await service(okAnswer, seen).fetchSource({ sourceId: 'aicalling', url: PROVIDER, method: 'POST', body: { name: 'Test' } });
  check(seen[0].opts.method === 'POST' && seen[0].opts.body === '{"name":"Test"}', 'a test lead is posted as JSON');
}

const rejects = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as { code?: string; message: string }; } };
const bad = (body: unknown) => rejects(service(okAnswer).fetchSource(body));
check((await bad({ sourceId: 'unknown', url: PROVIDER }))?.code === 'VALIDATION_ERROR', 'an unknown source is refused');
check((await bad({ sourceId: 'rcs', url: 'nope' }))?.code === 'VALIDATION_ERROR', 'an invalid address is refused');
check((await bad({ sourceId: 'rcs', url: PROVIDER, token: 'x' }))?.code === 'VALIDATION_ERROR', 'a token sent by the browser is refused (strict schema)');
check((await bad({ sourceId: 'rcs', url: PROVIDER, body: { a: 1 } }))?.code === 'VALIDATION_ERROR', 'a GET with a body is refused');
const blocked = await rejects(service(async () => { throw new BlockedTargetError('That address is not allowed.'); }).fetchSource({ sourceId: 'rcs', url: 'http://127.0.0.1/x' }));
check(blocked?.code === 'VALIDATION_ERROR', 'a private address is refused with the guard\'s message');
const down = await rejects(service(async () => { throw new Error('ECONNRESET secret-host.internal'); }).fetchSource({ sourceId: 'rcs', url: PROVIDER }));
check(down?.code === 'SERVICE_UNAVAILABLE' && !down.message.includes('secret-host'), 'a network failure gives a generic message');

const route = routes.find(r => r.path === '/leads/webhook-fetch');
check(route && route.method === 'POST', 'POST /leads/webhook-fetch is registered (signed-in, active users only, like every route)');

console.log(`\n${passed} LEAD WEBHOOK FETCH CHECKS PASSED`);
