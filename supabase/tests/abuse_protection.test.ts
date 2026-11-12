/**
 * Abuse protection (no database; the shared limiter falls back to memory without a service key): the visitor's address signed by the
 * Candidate Portal, Cloudflare Turnstile in each mode, throwaway e-mail domains, the limits on sign-up / sign-in / resets / candidate
 * actions / job listings, the edge flood limiter and the auth e-mail ceiling. Run: npm run test:unit
 */
import { createServer } from 'node:http';
import {
  ABUSE_LIMITS, isDisposableEmail, limitOf, signPortalForward, turnstileConfig, useEdgeLimiter, verifiedPortalClient, verifyTurnstile, type TurnstileFetch
} from '../../server/security/abuse.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const SECRET = 'portal-forward-secret-0123456789abcdef';
const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
const hdr = (h: Record<string, string>) => (n: string) => h[n];
const signed = (ip: string, ts = Math.floor(Date.now() / 1000), secret = SECRET) => ({
  'x-portal-client-ip': ip, 'x-portal-client-ts': String(ts), 'x-portal-client-sig': signPortalForward(secret, ip, ts)
});

// ---- the visitor's address, signed by the portal ---------------------------------------------------------------------------------
{
  const E = env({ PORTAL_FORWARD_SECRET: SECRET });
  check(verifiedPortalClient(hdr(signed('203.0.113.5')), E) === '203.0.113.5', 'a fresh, correctly signed address is believed');
  check(verifiedPortalClient(hdr(signed('2001:db8::7')), E) === '2001:db8::7', 'IPv6 too');
  check(verifiedPortalClient(hdr(signed('203.0.113.5', Math.floor(Date.now() / 1000) - 61)), E) === null, 'older than 60 s: refused (no replay later)');
  check(verifiedPortalClient(hdr(signed('203.0.113.5', Math.floor(Date.now() / 1000) + 61)), E) === null, 'from more than 60 s in the future: refused');
  check(verifiedPortalClient(hdr({ ...signed('203.0.113.5'), 'x-portal-client-ip': '6.6.6.6' }), E) === null, 'another address under the same signature: refused');
  check(verifiedPortalClient(hdr(signed('203.0.113.5', undefined, 'another-secret-0123456789abcdefghij')), E) === null, 'signed with another secret: refused');
  check(verifiedPortalClient(hdr({ 'x-portal-client-ip': '203.0.113.5' }), E) === null, 'no signature: refused');
  check(verifiedPortalClient(hdr({ ...signed('not-an-ip') }), E) === null, 'not an address: refused');
  check(verifiedPortalClient(hdr(signed('203.0.113.5')), env({ PORTAL_FORWARD_SECRET: 'short' })) === null && verifiedPortalClient(hdr(signed('203.0.113.5')), env({})) === null,
    'no secret (or one under 32 characters) on the CRM: nothing forwarded is believed');
}

// ---- Turnstile ---------------------------------------------------------------------------------------------------------------------
{
  let sent = '';
  const answer = (body: unknown): TurnstileFetch => async (_u, init) => { sent = init.body; return { ok: true, json: async () => body }; };
  const down: TurnstileFetch = async () => { throw new Error('unreachable'); };
  const cfg = (mode: string, extra: Record<string, string> = {}) => turnstileConfig(env({ TURNSTILE_MODE: mode, TURNSTILE_SECRET_KEY: 'ts-secret', TURNSTILE_ALLOWED_HOSTNAMES: 'careers.amuwa.com', ...extra }));
  const good = { success: true, hostname: 'careers.amuwa.com', action: 'sign_up' };

  check(turnstileConfig(env({ TURNSTILE_MODE: 'enforce' })).mode === 'off', 'no secret key: Turnstile is off whatever the mode');
  check(turnstileConfig(env({ TURNSTILE_SECRET_KEY: 'x' })).mode === 'off', 'default mode is off');
  let o = await verifyTurnstile(undefined, 'sign_up', null, cfg('off'), answer(good));
  check(o.allowed && o.result === 'off', 'off: nothing is checked');
  o = await verifyTurnstile('tok', 'sign_up', '203.0.113.5', cfg('enforce'), answer(good));
  check(o.allowed && o.result === 'ok', 'enforce: a valid token passes');
  const p = new URLSearchParams(sent);
  check(p.get('secret') === 'ts-secret' && p.get('response') === 'tok' && p.get('remoteip') === '203.0.113.5', 'the secret, the token and the visitor address go to Cloudflare');
  o = await verifyTurnstile('', 'sign_up', null, cfg('enforce'), answer(good));
  check(!o.allowed && o.result === 'missing', 'enforce: no token is refused');
  o = await verifyTurnstile('tok', 'sign_up', null, cfg('enforce'), answer({ success: false, 'error-codes': ['invalid-input-response'] }));
  check(!o.allowed && o.result === 'invalid', 'enforce: an invalid or reused token is refused');
  o = await verifyTurnstile('tok', 'sign_up', null, cfg('enforce'), answer({ ...good, hostname: 'evil.example.com' }));
  check(!o.allowed && o.result === 'wrong_hostname', 'enforce: a token from another site is refused');
  o = await verifyTurnstile('tok', 'sign_in', null, cfg('enforce'), answer(good));
  check(!o.allowed && o.result === 'wrong_action', 'enforce: a token made for another form is refused');
  o = await verifyTurnstile('tok', 'sign_up', null, cfg('log'), answer({ success: false }));
  check(o.allowed && o.result === 'invalid', 'log: the failure is found but the request is allowed');
  o = await verifyTurnstile('tok', 'sign_up', null, cfg('enforce'), down);
  check(o.allowed && o.result === 'unreachable', 'Cloudflare unreachable: allowed (the limits still apply), recorded as unreachable');
  check(cfg('enforce', { TURNSTILE_VERIFY_URL: 'https://evil.example.com/' }).verifyUrl.startsWith('https://challenges.cloudflare.com/'), 'the verification address can only be redirected to a local test server');
}

// ---- throwaway e-mail domains -------------------------------------------------------------------------------------------------------
{
  check(isDisposableEmail('a@mailinator.com') && isDisposableEmail('A@Sub.Mailinator.com') && isDisposableEmail('x@guerrillamail.com'), 'throwaway domains (and their sub-domains) are recognised');
  check(!isDisposableEmail('a@gmail.com') && !isDisposableEmail('a@outlook.com') && !isDisposableEmail('a@amuwa.com') && !isDisposableEmail('nonsense'), 'ordinary domains are not');
  check(!isDisposableEmail('a@mailinator.com', env({ DISPOSABLE_EMAIL_ALLOW: 'mailinator.com' })), 'DISPOSABLE_EMAIL_ALLOW accepts a listed domain anyway');
  check(limitOf('CAND_SIGNUP_PER_IP_HOUR', env({})) === ABUSE_LIMITS.CAND_SIGNUP_PER_IP_HOUR && limitOf('CAND_SIGNUP_PER_IP_HOUR', env({ CAND_SIGNUP_PER_IP_HOUR: '9' })) === 9 && limitOf('CAND_SIGNUP_PER_IP_HOUR', env({ CAND_SIGNUP_PER_IP_HOUR: '-1' })) === ABUSE_LIMITS.CAND_SIGNUP_PER_IP_HOUR,
    'each limit is a setting, with safe bounds');
}

// ---- the API -----------------------------------------------------------------------------------------------------------------------
// a fake Turnstile siteverify: "pass-<action>" tokens pass for that action, anything else fails
const ts = createServer((req, res) => {
  let b = '';
  req.on('data', c => (b += c));
  req.on('end', () => {
    const token = new URLSearchParams(b).get('response') || '';
    const m = /^pass-(\w+)$/.exec(token);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(m ? { success: true, hostname: 'careers.amuwa.com', action: m[1] } : { success: false, 'error-codes': ['invalid-input-response'] }));
  });
});
await new Promise<void>(r => ts.listen(0, '127.0.0.1', r));
Object.assign(process.env, {
  SUPABASE_URL: 'https://project.supabase.example', SUPABASE_ANON_KEY: 'anon', API_ACCESS_LOG: 'off', PORTAL_FORWARD_SECRET: SECRET,
  TURNSTILE_SECRET_KEY: 'ts-secret', TURNSTILE_MODE: 'enforce', TURNSTILE_ALLOWED_HOSTNAMES: 'careers.amuwa.com',
  TURNSTILE_VERIFY_URL: `http://127.0.0.1:${(ts.address() as { port: number }).port}/siteverify`
});
const { app } = await import('../../server/app.js');
let n = 0;
const fresh = () => `198.51.100.${++n}`; // a new visitor each time
const call = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(`/api/v1${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': '192.0.2.250', ...headers }, body: JSON.stringify(body) });
const json = async (r: Response) => (await r.json()) as any;
{
  // guard: sign-in
  let r = await call('/candidate-auth/guard', { action: 'sign_in', email: 'a@example.com' }, signed(fresh()));
  check(r.status === 403 && (await json(r)).error.details?.reason === 'BOT_CHECK_FAILED', 'guard: no Turnstile token in enforce mode: 403 BOT_CHECK_FAILED');
  r = await call('/candidate-auth/guard', { action: 'sign_in', email: 'a@example.com' }, { ...signed(fresh()), 'x-turnstile-token': 'pass-reset' });
  check(r.status === 403, 'guard: a token made for the reset form does not open sign-in');
  r = await call('/candidate-auth/guard', { action: 'sign_in', email: 'a@example.com' }, { ...signed(fresh()), 'x-turnstile-token': 'pass-sign_in' });
  check(r.status === 200 && (await json(r)).data.allowed === true, 'guard: a valid token for the right form: allowed');
  r = await call('/candidate-auth/guard', { action: 'delete_everything' }, { 'x-turnstile-token': 'pass-sign_in' });
  check(r.status === 422, 'guard: an unknown action is refused');

  process.env.TURNSTILE_MODE = 'log';
  const ip = fresh();
  let statuses: number[] = [];
  for (let i = 0; i < ABUSE_LIMITS.CAND_SIGNIN_PER_IP_15MIN + 1; i++) statuses.push((await call('/candidate-auth/guard', { action: 'sign_in', email: `u${i}@example.com` }, signed(ip))).status);
  check(statuses.slice(0, -1).every(s => s === 200) && statuses.at(-1) === 429, `sign-in: ${ABUSE_LIMITS.CAND_SIGNIN_PER_IP_15MIN} attempts a quarter hour per visitor, then 429 (log mode: missing tokens only recorded)`, statuses);
  r = await call('/candidate-auth/guard', { action: 'sign_in', email: 'other@example.com' }, signed(fresh()));
  check(r.status === 200, 'another visitor is not affected: each candidate counts separately, not the portal as one address');
  statuses = [];
  for (let i = 0; i < ABUSE_LIMITS.CAND_SIGNIN_PER_EMAIL_15MIN + 1; i++) statuses.push((await call('/candidate-auth/guard', { action: 'sign_in', email: 'Target@Example.com' }, signed(fresh()))).status);
  check(statuses.at(-1) === 429 && statuses.filter(s => s === 200).length === ABUSE_LIMITS.CAND_SIGNIN_PER_EMAIL_15MIN, 'password guessing on one account from many addresses: limited per e-mail', statuses);
  statuses = [];
  const rip = fresh();
  for (let i = 0; i < ABUSE_LIMITS.RESET_PER_IP_15MIN + 1; i++) statuses.push((await call('/candidate-auth/guard', { action: 'reset', email: `r${i}@example.com` }, signed(rip))).status);
  check(statuses.at(-1) === 429, 'reset links: limited per visitor', statuses);
  statuses = [];
  for (let i = 0; i < ABUSE_LIMITS.RESET_PER_EMAIL_HOUR + 1; i++) statuses.push((await call('/candidate-auth/guard', { action: 'reset', email: 'victim@example.com' }, signed(fresh()))).status);
  check(statuses.at(-1) === 429, 'reset links: limited per e-mail (no inbox flooding)', statuses);
  // the staff and client "forgot password" share the same per-address and per-e-mail counts
  statuses = [];
  for (let i = 0; i < ABUSE_LIMITS.RESET_PER_EMAIL_HOUR + 1; i++) statuses.push((await call('/client-auth/forgot-password', { email: 'client-victim@example.com' }, { 'x-real-ip': fresh() })).status);
  check(statuses.at(-1) === 429, 'client forgot-password: limited per e-mail too', statuses);

  // forged, unsigned forwarding headers are ignored: the caller's own address counts
  statuses = [];
  for (let i = 0; i < ABUSE_LIMITS.RESET_PER_IP_15MIN + 1; i++) statuses.push((await call('/candidate-auth/guard', { action: 'reset', email: `f${i}@example.com` }, { 'x-real-ip': '192.0.2.77', 'x-portal-client-ip': fresh() })).status);
  check(statuses.at(-1) === 429, 'an unsigned x-portal-client-ip cannot be used to dodge the limits', statuses);

  // sign-up
  process.env.TURNSTILE_MODE = 'enforce';
  r = await call('/candidate-auth/register', { name: 'Bot', email: 'bot@example.com', phone: '9876543210', password: 'Very-long-pass-1' }, signed(fresh()));
  check(r.status === 403, 'sign-up without a Turnstile token (enforce): refused before anything is created');
  r = await call('/candidate-auth/register', { name: 'Temp Person', email: 'temp@mailinator.com', phone: '9876543210', password: 'Very-long-pass-1' }, { ...signed(fresh()), 'x-turnstile-token': 'pass-sign_up' });
  const body = await json(r);
  check(r.status === 422 && /permanent e-mail/.test(body.error.message), 'sign-up with a throwaway address: refused with a clear message', body);
  process.env.TURNSTILE_MODE = 'log';
  const sip = fresh();
  statuses = [];
  for (let i = 0; i < ABUSE_LIMITS.CAND_SIGNUP_PER_IP_HOUR + 1; i++) statuses.push((await call('/candidate-auth/register', { name: 'X', email: `s${i}@mailinator.com` }, signed(sip))).status);
  check(statuses.slice(0, -1).every(s => s !== 429) && statuses.at(-1) === 429, `sign-up: ${ABUSE_LIMITS.CAND_SIGNUP_PER_IP_HOUR} an hour per visitor`, statuses);
  process.env.CAND_SIGNUP_SITE_HOUR = '3';
  statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await call('/candidate-auth/register', { name: 'X', email: `site${i}@mailinator.com` }, signed(fresh()))).status);
  check(statuses.at(-1) === 429, 'sign-up: a ceiling for the whole site stops a flood spread over many addresses', statuses);
  delete process.env.CAND_SIGNUP_SITE_HOUR;

  // public job listings: limited per address, except the portal's own (cached) calls
  const { portalServerToken } = await import('../../server/security/abuse.js');
  const jobs = (h: Record<string, string>) => app.request('/api/v1/careers/jobs', { headers: { 'x-real-ip': '192.0.2.99', ...h } });
  process.env.JOBS_PER_IP_MINUTE = '2';
  const js: number[] = [];
  for (let i = 0; i < 3; i++) js.push((await jobs({})).status);
  check(js[2] === 429, 'job listings: limited per address', js);
  const pj = await jobs({ 'x-portal-server': portalServerToken(SECRET) });
  check(pj.status !== 429, 'the portal server (valid x-portal-server) is not limited per address for its cached listings', pj.status);
  check((await jobs({ 'x-portal-server': 'f'.repeat(64) })).status === 429, 'a forged x-portal-server does not exempt anyone');
  delete process.env.JOBS_PER_IP_MINUTE;

  // the edge limiter (Worker): a refusal is a 429 before any other work
  useEdgeLimiter(async () => false);
  r = await app.request('/api/v1/health');
  check(r.status === 429 && r.headers.get('retry-after') === '60', 'Cloudflare flood limiter says no: 429 with Retry-After');
  useEdgeLimiter(async () => { throw new Error('binding failed'); });
  r = await app.request('/api/v1/health');
  check(r.status === 200, 'the flood limiter failing falls back to the in-memory limiter instead of blocking everyone');
  useEdgeLimiter(null);
}

// ---- auth e-mails: a ceiling per recipient, however the e-mail was triggered ----------------------------------------------------------
{
  const { handleAuthEmailHook, hookKey, signHook } = await import('../../server/automations/authEmailHook.js');
  const KEY = Buffer.from('0123456789abcdef0123456789abcdef');
  const secret = `v1,whsec_${KEY.toString('base64')}`;
  const payload = JSON.stringify({ user: { email: 'flooded@example.com', user_metadata: {} }, email_data: { token: '1', token_hash: 'h', redirect_to: '', email_action_type: 'recovery' } });
  const ts2 = String(Math.floor(Date.now() / 1000));
  let sends = 0;
  const reply = await handleAuthEmailHook(
    { body: payload, id: 'm1', timestamp: ts2, signature: `v1,${signHook(hookKey(secret)!, 'm1', ts2, payload)}` },
    { secret: () => secret, supabaseUrl: () => 'https://project.supabase.example', allow: async () => false, send: async () => { sends++; return { ok: true, retry: false, code: 200, ref: 'x', detail: '' }; } }
  );
  check(reply.status === 429 && sends === 0, 'over the per-recipient ceiling: Supabase is told 429 and nothing is sent');
}

ts.close();
console.log(`\n${passed} ABUSE PROTECTION CHECKS PASSED`);
process.exit(0);
