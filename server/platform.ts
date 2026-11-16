/**
 * Which platform is running this code, and who is allowed to run the scheduled automations. Used by GET /api/v1/health (so a deployment can be
 * checked from one address) and by the scheduled-dispatch route. Reads only names and on/off switches, never a secret.
 */
export type PlatformName = 'cloudflare' | 'vercel' | 'node';

export function platformName(env: NodeJS.ProcessEnv = process.env): PlatformName {
  if ((env.CRM_PLATFORM || '').trim().toLowerCase() === 'cloudflare') return 'cloudflare';
  if (env.VERCEL) return 'vercel';
  return 'node';
}

const on = (v: string | undefined) => (v || '').trim().toLowerCase() === 'true';

/**
 * Whether this deployment runs the twice-daily automations by itself:
 *   Cloudflare - only when SCHEDULED_ENABLED is "true" (worker/index.ts), so a rehearsal copy never runs them next to the live one;
 *   Vercel     - Vercel Cron (vercel.json "crons") always calls the deployment unless VERCEL_CRON_PAUSED is "true" (see isPausedVercelCron);
 *   node       - never (local development, tests).
 */
export function scheduledAutomations(env: NodeJS.ProcessEnv = process.env): 'on' | 'off' | 'paused' | 'n/a' {
  switch (platformName(env)) {
    case 'cloudflare': return on(env.SCHEDULED_ENABLED) ? 'on' : 'off';
    case 'vercel': return on(env.VERCEL_CRON_PAUSED) ? 'paused' : 'on';
    default: return 'n/a';
  }
}

/**
 * True for a request made by Vercel Cron while this Vercel deployment has been told to stand down (VERCEL_CRON_PAUSED=true). This lets the owner
 * stop Vercel's schedule after the move to Cloudflare WITHOUT a code change, so the automations never run on both platforms at once.
 * Only the cron's own request is skipped: an authenticated call from anywhere else (pg_cron, the Cloudflare cron, a person) still runs.
 */
export function isPausedVercelCron(userAgent: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return platformName(env) === 'vercel' && on(env.VERCEL_CRON_PAUSED) && /^vercel-cron\//i.test(userAgent || '');
}
