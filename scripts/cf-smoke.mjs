#!/usr/bin/env node
/**
 * Read-only smoke test of a deployed CRM address (Cloudflare Worker or, for comparison, Vercel). It sends only GET / OPTIONS / empty POST
 * requests, never signs in and never changes data. Run it from your own computer:
 *
 *   node scripts/cf-smoke.mjs https://crm.amuwacorporation.com
 *   node scripts/cf-smoke.mjs https://crm.amuwacorporation.com --expect=cloudflare --supabase-host=abcd1234.supabase.co
 *   node scripts/cf-smoke.mjs https://ai-crm.<your-subdomain>.workers.dev          (the rehearsal address)
 *
 * PASS = verified. FAIL = a problem. WARN = works but needs a person's decision. Exit code 1 if anything FAILED.
 * It cannot check what needs a login (dashboards by role, uploads, chat): see docs/CLOUDFLARE_AUDIT.md for those manual steps.
 */
const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
const opt = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1] || '';
if (!base) { console.error('Usage: node scripts/cf-smoke.mjs <https://address> [--expect=cloudflare|vercel] [--supabase-host=<project>.supabase.co]'); process.exit(2); }
const expectPlatform = opt('expect') || 'cloudflare';
const expectHost = opt('supabase-host');

let failed = 0;
const out = (tag, name, detail = '') => { console.log(`${tag}  ${name}${detail ? `  -- ${detail}` : ''}`); if (tag === 'FAIL') failed++; };
const ok = (c, name, detail) => out(c ? 'PASS' : 'FAIL', name, c ? '' : detail);
const get = async (path, init = {}) => {
  try { return await fetch(base + path, { redirect: 'manual', ...init, signal: AbortSignal.timeout(20000) }); }
  catch (e) { return { status: 0, headers: new Headers(), text: async () => '', error: String(e.cause?.code || e.message) }; }
};
const h = (r, n) => r.headers.get(n) || '';

console.log(`Checking ${base} (expecting the ${expectPlatform} platform)\n`);

// 1. reachable, HTTPS, platform evidence
const home = await get('/');
ok(home.status === 200 && /text\/html/.test(h(home, 'content-type')), 'the home page loads', home.error || `HTTP ${home.status}`);
const server = h(home, 'server').toLowerCase();
const viaCloudflare = server.includes('cloudflare') || !!h(home, 'cf-ray');
if (expectPlatform === 'cloudflare') ok(viaCloudflare, 'the response comes through Cloudflare (server: cloudflare / cf-ray)', 'no Cloudflare header: this address is probably still served by something else (Vercel?)');
else out('PASS', `platform header check skipped (expecting ${expectPlatform})`);
if (base.startsWith('https://')) {
  const plain = await get('/', { /* same host over http */ }).then(() => fetch(base.replace('https://', 'http://') + '/', { redirect: 'manual', signal: AbortSignal.timeout(15000) }).catch(() => null));
  ok(!plain || (plain.status >= 300 && plain.status < 400 && /^https:/.test(plain.headers.get('location') || '')), 'plain http:// redirects to https:// (or is not served)', plain && `HTTP ${plain.status}`);
}
const need = { 'strict-transport-security': /max-age=\d{7,}/, 'x-content-type-options': /nosniff/i, 'x-frame-options': /deny/i, 'content-security-policy': /default-src 'self'/, 'referrer-policy': /./, 'permissions-policy': /./ };
const missing = Object.entries(need).filter(([k, rx]) => !rx.test(h(home, k))).map(([k]) => k);
ok(missing.length === 0, 'the browser security headers are present on the home page', `missing: ${missing.join(', ')}`);

// 2. single-page app routes and static files
for (const p of ['/dashboard', '/client/login', '/set-password', '/hr/recruitment']) {
  const r = await get(p);
  ok(r.status === 200 && /text\/html/.test(h(r, 'content-type')), `app screen ${p} opens (single-page fallback)`, `HTTP ${r.status}`);
}
const html = await home.text();
const chunk = (html.match(/\/assets\/[^"']+\.js/) || [])[0];
if (chunk) {
  const a = await get(chunk);
  ok(a.status === 200 && /immutable/.test(h(a, 'cache-control')), `a built script (${chunk.slice(8, 28)}...) is served with long-lived caching`, `HTTP ${a.status}, cache-control: ${h(a, 'cache-control')}`);
  const js = await a.text();
  const entryImports = [...js.matchAll(/assets\/([A-Za-z0-9_.-]+\.js)/g)].map((m) => m[1]).slice(0, 12);
  let supabaseConfigured = /[a-z0-9]{8,}\.supabase\.co/.test(js);
  for (const f of entryImports) { if (supabaseConfigured) break; supabaseConfigured = /[a-z0-9]{8,}\.supabase\.co/.test(await (await get(`/assets/${f}`)).text()); }
  ok(supabaseConfigured, 'the built frontend contains a Supabase address (VITE_SUPABASE_URL was set when it was built)', 'none found: set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY as BUILD variables in Cloudflare and rebuild');
  const hit = expectHost ? js.includes(expectHost) || (await Promise.all(entryImports.map(async (f) => (await (await get(`/assets/${f}`)).text()).includes(expectHost)))).some(Boolean) : null;
  if (expectHost) ok(hit, `the frontend points at the expected Supabase project (${expectHost})`, 'a different Supabase address is built in');
} else out('FAIL', 'found no built script in index.html');
const miss = await get('/assets/definitely-missing-file.js');
ok(miss.status === 404 && /json/.test(h(miss, 'content-type')), 'a missing /assets file is a 404, not the app page', `HTTP ${miss.status} ${h(miss, 'content-type')}`);

// 3. API: reachable, configured, private
const health = await get('/api/v1/health');
let hj = {}; try { hj = await health.json(); } catch { /* not json */ }
const d = hj.data || {}; const c = d.checks || {};
ok(health.status === 200 && d.status === 'ok', '/api/v1/health reports ok (configuration and database reachable, migrations applied)', `HTTP ${health.status}, status ${d.status}: ${JSON.stringify(c).slice(0, 200)}`);
ok(c.platform === expectPlatform, `health says the platform is ${expectPlatform}`, `it says "${c.platform || 'nothing (an older build without the platform report)'}"`);
if (c.serviceRoleKey) ok(c.serviceRoleKey === 'configured', 'the Supabase service-role key is configured on the server', c.serviceRoleKey);
if (c.fileStorage) ok(c.fileStorage === 'r2', 'file storage is Cloudflare R2', `it is "${c.fileStorage}" (the R2_* variables are missing or STORAGE_PROVIDER=supabase)`);
else out('WARN', 'health does not report file storage (an older build): check the R2_* variables by hand');
if (expectHost) ok(c.supabaseHost === expectHost, 'the server talks to the expected Supabase project', `it talks to ${c.supabaseHost}`);
else out('WARN', `the server's Supabase project is ${c.supabaseHost || 'unknown'}: confirm it is your PRODUCTION project (or pass --supabase-host=)`);
if (c.scheduledAutomations === 'on') out('PASS', 'the scheduled automations are on for this platform');
else if (c.scheduledAutomations) out('WARN', `scheduled automations are "${c.scheduledAutomations}" here`, expectPlatform === 'cloudflare' ? 'set SCHEDULED_ENABLED=true on the Worker at go-live, and VERCEL_CRON_PAUSED=true on Vercel, so exactly ONE platform runs them' : 'expected while Vercel is being retired');

const unauth = await get('/api/v1/customers');
ok(unauth.status === 401 && /no-store/.test(h(unauth, 'cache-control')), 'a protected API call without sign-in is 401 and "no-store"', `HTTP ${unauth.status}, cache-control: ${h(unauth, 'cache-control')}`);
ok(!/hit/i.test(h(unauth, 'cf-cache-status')), 'API answers are never served from the Cloudflare cache', `cf-cache-status: ${h(unauth, 'cf-cache-status')}`);
const cors = await get('/api/v1/customers', { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
ok(!h(cors, 'access-control-allow-origin'), 'an unknown website is not allowed to call the API from a browser (no CORS allow header)', `allow-origin: ${h(cors, 'access-control-allow-origin')}`);
const dispatch = await get('/api/v1/internal/automations/dispatch', { method: 'POST' });
ok(dispatch.status === 401, 'the scheduled-dispatch address refuses a call without the secret (401)', dispatch.status === 503 ? '503: no CRON_SECRET / AUTOMATION_DISPATCH_SECRET is set on this deployment' : `HTTP ${dispatch.status}`);
const proxy = await get('/api/proxy?url=http%3A%2F%2F169.254.169.254%2F');
ok(proxy.status === 401, '/api/proxy refuses a call without sign-in (401)', `HTTP ${proxy.status}`);
const hook = await get('/api/v1/internal/auth/email-hook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
ok(hook.status === 401 || hook.status === 503, 'the Supabase e-mail hook address exists and refuses an unsigned call', `HTTP ${hook.status}`);
if (hook.status === 503) out('WARN', 'SUPABASE_AUTH_HOOK_SECRET is not set on this deployment: sign-up e-mails fail while the hook is switched on in Supabase');
const webhook = await get('/api/webhook');
let wj = {}; try { wj = await webhook.json(); } catch { /* not json */ }
ok(webhook.status === 200 && wj.status === 'active', 'the inbound lead webhook address is live (GET answers "ready"; nothing is sent)', `HTTP ${webhook.status} ${JSON.stringify(wj).slice(0, 80)}`);
const hooks2 = await get('/api/webhooks/wabastore');
ok(hooks2.status === 200 && /json/.test(h(hooks2, 'content-type')), 'the per-department webhook path /api/webhooks/<department> is routed too', `HTTP ${hooks2.status}`);

console.log(failed ? `\n${failed} check(s) FAILED.` : '\nEvery automatic check passed. Now do the manual checks in docs/CLOUDFLARE_AUDIT.md (sign-in per role, uploads, chat, realtime, e-mail).');
process.exit(failed ? 1 : 0);
