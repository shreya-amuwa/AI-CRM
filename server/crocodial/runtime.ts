import type { SupabaseClient } from '@supabase/supabase-js';
import { platformName, type PlatformName } from '../platform.js';

/**
 * Which server is running, and whether IT has a connection's Crocodial token (docs/CROCODIAL_INTEGRATION.md, "Connection health").
 *
 * The token is a setting of each server that runs the CRM. Production can have more than one (the Cloudflare Worker, and a Vercel
 * deployment that is still connected), and each reads its OWN settings. So every answer about the token says which server gave it:
 * platform, environment and deployment. Nothing here ever returns, logs or stores a token or any part of it: only "detected" and
 * "format valid".
 *
 * Settings are read from process.env (where the Worker's nodejs_compat puts its variables and secrets, and where Node.js has them). On the
 * Worker, worker/entry.ts also registers the Worker's own bindings: a setting missing from process.env is then looked up there, and the
 * deployment id comes from the CF_VERSION_METADATA binding (wrangler.jsonc).
 */
export interface RuntimeInfo {
  /** e.g. "cloudflare:production", "vercel:preview", "node:local": one report per connection and runtime */
  runtime: string;
  platform: PlatformName;
  environment: string | null;
  deployment: string | null;
  host: string | null;
}

export interface CredentialCheck {
  /** the setting's name follows CROCODIAL_TOKEN_<NAME> (anything else is never looked up) */
  nameValid: boolean;
  /** this server has a non-empty setting of that name */
  detected: boolean;
  /** and its value looks like a token: 8 to 4096 characters, no spaces, quotes or "Bearer" prefix */
  formatValid: boolean;
}

type Bindings = Record<string, unknown>;
let bindings: Bindings | null = null;

/** The Worker's own bindings (worker/entry.ts). */
export function useRuntimeBindings(env: Bindings | null): void {
  bindings = env;
}

/** A setting of this server: process.env first, then the Worker's bindings. With an explicit env (tests), only that. */
export function readSetting(name: string, env?: NodeJS.ProcessEnv): string | undefined {
  if (env) return env[name];
  const v = process.env[name];
  if (typeof v === 'string' && v !== '') return v;
  const b = bindings?.[name];
  return typeof b === 'string' ? b : undefined;
}

const CREDENTIAL_NAME = /^CROCODIAL_TOKEN_[A-Z0-9_]{1,40}$/;

/** Whether the value looks like an API token (and not, for example, "Bearer abc", a quoted string or a value with a line break). */
export function tokenFormatValid(value: string): boolean {
  return value.length >= 8 && value.length <= 4096 && !/[\s"'`]/.test(value) && !/^bearer/i.test(value);
}

export function credentialCheck(credentialRef: string | null, env?: NodeJS.ProcessEnv): CredentialCheck {
  // (a connection whose key is stored by the CRM has no setting name)
  if (!credentialRef || !CREDENTIAL_NAME.test(credentialRef)) return { nameValid: false, detected: false, formatValid: false };
  const v = (readSetting(credentialRef, env) ?? '').trim();
  return { nameValid: true, detected: v.length > 0, formatValid: v.length > 0 && tokenFormatValid(v) };
}

/** The token, only when its name and format are valid (used only as the Authorization header). */
export function resolveCredential(credentialRef: string | null, env?: NodeJS.ProcessEnv): string | null {
  const check = credentialCheck(credentialRef, env);
  return check.formatValid && credentialRef ? (readSetting(credentialRef, env) ?? '').trim() : null;
}

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
  return s || null;
};

export function runtimeInfo(env?: NodeJS.ProcessEnv, host?: string | null): RuntimeInfo {
  const get = (n: string) => readSetting(n, env);
  const platform = platformName(env ?? { ...process.env, CRM_PLATFORM: get('CRM_PLATFORM') });
  const environment = clean(get('CRM_ENVIRONMENT') ?? get('VERCEL_ENV') ?? (platform === 'node' ? 'local' : undefined), 40);
  let deployment: string | null = null;
  if (platform === 'cloudflare') {
    const meta = (env ? undefined : bindings?.CF_VERSION_METADATA) as { id?: unknown; tag?: unknown } | undefined;
    deployment = clean(meta?.tag || meta?.id || get('CF_VERSION_ID'), 80);
  } else if (platform === 'vercel') {
    deployment = clean(get('VERCEL_DEPLOYMENT_ID') ?? get('VERCEL_GIT_COMMIT_SHA')?.slice(0, 12), 80);
  }
  const h = typeof host === 'string' ? host.trim().toLowerCase().replace(/[^a-z0-9.:-]/g, '').slice(0, 120) : '';
  return { runtime: `${platform}:${environment ?? 'unknown'}`, platform, environment, deployment, host: h || null };
}

const PLATFORM_LABEL: Record<PlatformName, string> = { cloudflare: 'Cloudflare', vercel: 'Vercel', node: 'Node.js' };

/** "This server (Cloudflare, production)" */
export function runtimeLabel(rt: RuntimeInfo): string {
  return `This server (${PLATFORM_LABEL[rt.platform]}${rt.environment ? `, ${rt.environment}` : ''})`;
}

/** The message for a missing or malformed token: names the server and the setting, never the value. */
export function credentialProblem(credentialRef: string, check: CredentialCheck, rt: RuntimeInfo): string {
  if (!check.nameValid) return `The setting name ${credentialRef} is not a valid CROCODIAL_TOKEN_<NAME> name.`;
  if (!check.detected) {
    return `${runtimeLabel(rt)} has no ${credentialRef} setting. Add it as a secret of this server${rt.platform === 'cloudflare'
      ? ' (Workers & Pages, the CRM Worker, Settings, Variables and Secrets)' : rt.platform === 'vercel' ? ' (Vercel project, Settings, Environment Variables)' : ''}.`;
  }
  return `${runtimeLabel(rt)} has ${credentialRef}, but its value is not a valid token (it must not contain spaces, quotes or the word "Bearer"). Paste the token again.`;
}

/**
 * Record what this server sees for one connection (service role). Returns whether ANOTHER server had a valid token in the last 6 hours,
 * in which case this server must not mark the connection as broken. Never throws (an older database without the function: false).
 */
export async function reportRuntime(db: SupabaseClient, connectionId: string, rt: RuntimeInfo, check: CredentialCheck,
  context: 'PAGE' | 'TEST' | 'SYNC' | 'REFRESH'): Promise<{ otherHasCredential: boolean }> {
  try {
    const { data, error } = await db.rpc('croc_runtime_report', {
      p_connection: connectionId,
      p_runtime: { runtime: rt.runtime, platform: rt.platform, environment: rt.environment, deployment: rt.deployment, host: rt.host },
      p_detected: check.detected, p_valid: check.formatValid, p_context: context
    });
    if (error) return { otherHasCredential: false };
    return { otherHasCredential: !!(data as { otherHasCredential?: boolean } | null)?.otherHasCredential };
  } catch {
    return { otherHasCredential: false };
  }
}
