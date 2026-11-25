import { getEnv } from './config/env.js';
import { getAnonClient } from './db/supabase.js';
import { platformName, scheduledAutomations } from './platform.js';
import { activeProviderName } from './storage/config.js';

/**
 * GET /api/v1/health - unauthenticated deployment check. Reports whether the
 * server is configured and can reach the database; never returns secrets.
 */
export async function healthCheck() {
  const checks: Record<string, string> = {};
  // Where this is running and whether it runs the scheduled automations: lets a move between platforms be checked from one address.
  checks.platform = platformName();
  checks.scheduledAutomations = scheduledAutomations();
  try {
    checks.fileStorage = activeProviderName() === 'R2' ? 'r2' : 'supabase';
  } catch {
    checks.fileStorage = 'misconfigured (STORAGE_PROVIDER=r2 needs the R2_* settings)';
  }
  let env;
  try {
    env = getEnv();
    checks.config = 'ok';
    checks.supabaseHost = new URL(env.supabaseUrl).host;
    checks.serviceRoleKey = env.supabaseServiceRoleKey ? 'configured' : 'missing (user creation and banning disabled)';
  } catch (err) {
    checks.config = (err as Error).message;
    return { status: 'misconfigured', checks };
  }
  const { error } = await getAnonClient().rpc('list_registration_options');
  checks.database = error ? `error ${error.code || ''}: ${error.message}` : 'ok (migrations applied)';
  return { status: error ? 'degraded' : 'ok', checks, time: new Date().toISOString() };
}

/**
 * GET /api/v1/health/database - for an uptime monitor (Sentry, UptimeRobot, Better Stack...): 200 when the database answers within 3 s,
 * 503 "slow" or "down" otherwise, with the time it took. /health keeps answering 200 for deployment checks. A result is reused for
 * 10 seconds, so a monitor (or many) never adds load to a struggling database; the check itself gives up after 8 seconds.
 */
type Readiness = { status: 200 | 503; body: { database: 'ok' | 'slow' | 'down'; latencyMs: number; checkedAt: string; cached?: boolean } };
const SLOW_MS = 3_000;
const REUSE_MS = 10_000;
let last: { at: number; result: Readiness } | null = null;
export function resetDatabaseReadinessForTests() { last = null; }

export async function databaseReadiness(opts: { ping?: () => Promise<void>; now?: () => number; timeoutMs?: number } = {}): Promise<Readiness> {
  const now = opts.now ?? Date.now;
  const start = now();
  if (last && start - last.at < REUSE_MS) return { status: last.result.status, body: { ...last.result.body, cached: true } };
  const ping = opts.ping ?? (async () => {
    const { error } = await getAnonClient().rpc('list_registration_options');
    if (error) throw new Error('database error');
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), opts.timeoutMs ?? 8_000); });
  let state: 'ok' | 'slow' | 'down';
  try {
    const outcome = await Promise.race([ping().then(() => 'answered' as const), timeout]);
    const took = now() - start;
    state = outcome === 'timeout' ? 'down' : took > SLOW_MS ? 'slow' : 'ok';
  } catch {
    state = 'down';
  } finally {
    if (timer) clearTimeout(timer);
  }
  const result: Readiness = {
    status: state === 'ok' ? 200 : 503,
    body: { database: state, latencyMs: now() - start, checkedAt: new Date(now()).toISOString() }
  };
  last = { at: now(), result };
  return result;
}
