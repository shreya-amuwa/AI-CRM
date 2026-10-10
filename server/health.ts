import { getEnv } from './config/env.js';
import { getAnonClient } from './db/supabase.js';

/**
 * GET /api/v1/health - unauthenticated deployment check. Reports whether the
 * server is configured and can reach the database; never returns secrets.
 */
export async function healthCheck() {
  const checks: Record<string, string> = {};
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
