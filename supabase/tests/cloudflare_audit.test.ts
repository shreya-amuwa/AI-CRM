/**
 * Deployment-audit guards (no database): the platform report of GET /api/v1/health, the switch that stops Vercel's cron after the move to
 * Cloudflare, and that every environment variable the server code reads is written down in .env.example (so the Cloudflare dashboard can be
 * checked against one list). Run: npm run test:unit
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isPausedVercelCron, platformName, scheduledAutomations } from '../../server/platform.js';
import { healthCheck } from '../../server/health.js';

let passed = 0;
function check(cond: unknown, label: string, extra?: unknown) {
  if (!cond) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

// ---- platform and scheduling ---------------------------------------------------------------------------------------------------
check(platformName({ CRM_PLATFORM: 'cloudflare' }) === 'cloudflare' && platformName({ CRM_PLATFORM: ' Cloudflare ' }) === 'cloudflare', 'CRM_PLATFORM=cloudflare is the Worker');
check(platformName({ VERCEL: '1' }) === 'vercel' && platformName({}) === 'node', 'VERCEL means Vercel; nothing means local / tests');
check(platformName({ CRM_PLATFORM: 'cloudflare', VERCEL: '1' }) === 'cloudflare', 'Cloudflare wins if both are set');
check(scheduledAutomations({ CRM_PLATFORM: 'cloudflare' }) === 'off', 'Cloudflare runs no automations until SCHEDULED_ENABLED=true');
check(scheduledAutomations({ CRM_PLATFORM: 'cloudflare', SCHEDULED_ENABLED: 'true' }) === 'on' && scheduledAutomations({ CRM_PLATFORM: 'cloudflare', SCHEDULED_ENABLED: 'yes' }) === 'off', 'SCHEDULED_ENABLED must be exactly "true"');
check(scheduledAutomations({ VERCEL: '1' }) === 'on' && scheduledAutomations({ VERCEL: '1', VERCEL_CRON_PAUSED: 'true' }) === 'paused', 'Vercel runs its cron unless VERCEL_CRON_PAUSED=true');
check(scheduledAutomations({}) === 'n/a', 'local / tests run no schedule');

const cron = 'vercel-cron/1.0';
check(isPausedVercelCron(cron, { VERCEL: '1', VERCEL_CRON_PAUSED: 'true' }), "a paused Vercel deployment skips Vercel Cron's own call");
check(!isPausedVercelCron(cron, { VERCEL: '1' }), 'by default Vercel Cron runs (nothing changes until the switch is set)');
check(!isPausedVercelCron('curl/8', { VERCEL: '1', VERCEL_CRON_PAUSED: 'true' }), 'an authenticated call from anywhere else (pg_cron, a person, Cloudflare) still runs');
check(!isPausedVercelCron(cron, { CRM_PLATFORM: 'cloudflare', VERCEL_CRON_PAUSED: 'true' }) && !isPausedVercelCron(undefined, { VERCEL: '1', VERCEL_CRON_PAUSED: 'true' }), 'the switch affects only Vercel, and only calls that say they are Vercel Cron');

// ---- health --------------------------------------------------------------------------------------------------------------------
Object.assign(process.env, { SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_ANON_KEY: 'anon', CRM_PLATFORM: 'cloudflare' });
delete process.env.SCHEDULED_ENABLED;
{
  const h = (await healthCheck()) as { checks: Record<string, string> };
  check(h.checks.platform === 'cloudflare' && h.checks.scheduledAutomations === 'off', 'health reports the platform and that the schedule is off', h.checks);
  check(h.checks.fileStorage === 'supabase', 'health reports Supabase Storage while no R2 settings exist', h.checks);
  Object.assign(process.env, { R2_ACCOUNT_ID: 'acct', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b', SCHEDULED_ENABLED: 'true' });
  const h2 = (await healthCheck()) as { checks: Record<string, string> };
  check(h2.checks.fileStorage === 'r2' && h2.checks.scheduledAutomations === 'on', 'health reports R2 and the schedule once they are configured', h2.checks);
  check(!JSON.stringify(h2).match(/acct|"s"|"k"|anon/), 'health never contains a key or an account id');
  process.env.STORAGE_PROVIDER = 'r2';
  delete process.env.R2_BUCKET;
  const h3 = (await healthCheck()) as { checks: Record<string, string> };
  check(/misconfigured/.test(h3.checks.fileStorage), 'STORAGE_PROVIDER=r2 without the R2 settings is reported as misconfigured', h3.checks);
}

// ---- every variable the server reads is written down -----------------------------------------------------------------------------
const walk = (d: string): string[] => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(p) ? [p] : []; });
const used = new Set<string>();
for (const f of [...walk('server'), ...walk('api'), ...walk('worker')]) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1]);
  for (const m of s.matchAll(/\benv\.([A-Z][A-Z0-9_]{3,})\b/g)) used.add(m[1]);
}
const example = readFileSync('.env.example', 'utf8');
const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map(m => m[1]));
// platform-provided or bindings, not settings the owner types in
const provided = new Set(['NODE_ENV', 'VERCEL', 'ASSETS', 'FLOOD_LIMITER', 'TRUST_PROXY_HEADERS', 'CI', 'PATH', 'HOME']);
const undocumented = [...used].filter(n => !documented.has(n) && !provided.has(n)).sort();
check(used.size > 60, `the scan found the variables the server reads (${used.size})`);
check(undocumented.length === 0, 'every environment variable the server code reads is named in .env.example', undocumented);
check(![...example.matchAll(/^(?!#)[A-Z_]*(SECRET|SERVICE_ROLE|PASSWORD|API_KEY)[A-Z_]*=(\S{12,})/gm)].some(m => !/^(YOUR_|<|xxx)/i.test(m[2])), '.env.example holds only placeholders for secrets (YOUR_...), no real-looking value');
check(![...example.matchAll(/^#?\s*(VITE_[A-Z0-9_]+)=/gm)].some(m => /SECRET|SERVICE|PASSWORD|PRIVATE|TOKEN|API_KEY/.test(m[1])), 'no browser (VITE_) variable is named like a secret');

// ---- the dispatch route honours the pause (real route, no database needed: it answers before any database call) ----------------------------------
{
  delete process.env.CRM_PLATFORM;
  Object.assign(process.env, { VERCEL: '1', VERCEL_CRON_PAUSED: 'true', AUTOMATION_DISPATCH_SECRET: 'dispatch-secret-16+chars-long' });
  const { app } = await import('../../server/app.js');
  const call = (ua: string, auth = 'Bearer dispatch-secret-16+chars-long') =>
    app.request('/api/v1/internal/automations/dispatch', { method: 'GET', headers: { authorization: auth, 'user-agent': ua, 'x-real-ip': '203.0.113.9' } });
  const skipped = await call('vercel-cron/1.0');
  const body = (await skipped.json()) as { success: boolean; data?: { skipped?: boolean } };
  check(skipped.status === 200 && body.data?.skipped === true, 'a paused Vercel deployment answers its own cron with "skipped" and runs nothing', body);
  const wrong = await call('vercel-cron/1.0', 'Bearer not-the-secret-not-the-secret');
  check(wrong.status === 401, 'the pause never replaces the secret check: a wrong secret is still refused (401)', wrong.status);
}

console.log(`\n${passed} CLOUDFLARE AUDIT CHECKS PASSED`);
process.exit(0);
