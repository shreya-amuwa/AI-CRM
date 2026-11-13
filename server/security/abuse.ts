import { createHmac, timingSafeEqual } from 'node:crypto';
import net from 'node:net';
import { AppError } from '../http/errors.js';
import { DISPOSABLE_DOMAINS_TEXT } from './disposableDomainList.js';

/**
 * Protection of the public and candidate endpoints against bots and abuse (docs/ABUSE_PROTECTION.md):
 *  - the visitor's address as forwarded, signed, by the Candidate Portal (which calls the CRM from its own server);
 *  - Cloudflare Turnstile tokens (the portal's sign-up, sign-in, forgot-password and apply forms);
 *  - throwaway e-mail domains refused at sign-up;
 *  - Cloudflare's edge rate limiter, when the Worker has registered it;
 *  - the limits themselves, each a setting.
 */

// ---------------------------------------------------------------------------
// The visitor's address, forwarded by the Candidate Portal
// ---------------------------------------------------------------------------
/**
 * The portal sends x-portal-client-ip, x-portal-client-ts (Unix seconds) and x-portal-client-sig = hex HMAC-SHA256(PORTAL_FORWARD_SECRET,
 * "<ip>.<ts>"). Believed only with a valid signature made in the last 60 seconds (clock drift allowed both ways); the secret is at least
 * 32 characters and set on both sites only. Anything else: null, and the caller's own address counts.
 */
export const PORTAL_FORWARD_MAX_AGE_S = 60;

export function portalForwardSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = (env.PORTAL_FORWARD_SECRET || '').trim();
  return s.length >= 32 ? s : null;
}

export function signPortalForward(secret: string, ip: string, ts: number): string {
  return createHmac('sha256', secret).update(`${ip}.${ts}`).digest('hex');
}

export function verifiedPortalClient(header: (name: string) => string | undefined, env: NodeJS.ProcessEnv = process.env, nowMs = Date.now()): string | null {
  const secret = portalForwardSecret(env);
  if (!secret) return null;
  const ip = (header('x-portal-client-ip') || '').trim();
  const tsRaw = (header('x-portal-client-ts') || '').trim();
  const sig = (header('x-portal-client-sig') || '').trim().toLowerCase();
  if (!ip || !net.isIP(ip) || !/^\d{9,11}$/.test(tsRaw) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const ts = Number(tsRaw);
  if (Math.abs(nowMs / 1000 - ts) > PORTAL_FORWARD_MAX_AGE_S) return null;
  const want = Buffer.from(signPortalForward(secret, ip, ts), 'hex');
  const given = Buffer.from(sig, 'hex');
  return want.length === given.length && timingSafeEqual(want, given) ? ip : null;
}

/**
 * The portal's own server, for the calls it caches (public job listings, cached for 30 s, where a per-visitor header would split the
 * cache): x-portal-server = hex HMAC-SHA256(PORTAL_FORWARD_SECRET, "portal-server"). It only exempts those listings from the per-address
 * limit (the portal is one address for everyone); Cloudflare's flood limit still applies.
 */
export function portalServerToken(secret: string): string {
  return createHmac('sha256', secret).update('portal-server').digest('hex');
}

export function isPortalServer(header: (name: string) => string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const secret = portalForwardSecret(env);
  const given = (header('x-portal-server') || '').trim().toLowerCase();
  if (!secret || !/^[0-9a-f]{64}$/.test(given)) return false;
  const want = Buffer.from(portalServerToken(secret), 'hex');
  const got = Buffer.from(given, 'hex');
  return want.length === got.length && timingSafeEqual(want, got);
}

// ---------------------------------------------------------------------------
// Cloudflare Turnstile
// ---------------------------------------------------------------------------
export type TurnstileMode = 'off' | 'log' | 'enforce';
export type TurnstileAction = 'sign_up' | 'sign_in' | 'reset' | 'apply';

export interface TurnstileConfig {
  mode: TurnstileMode;
  secret: string | null;
  /** host names the token may come from (the portal's domain); empty: any */
  hostnames: string[];
  verifyUrl: string;
  timeoutMs: number;
}

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * TURNSTILE_MODE: off (default: nothing checked), log (checked and recorded, never refused: for the first day after go-live) or enforce.
 * TURNSTILE_SECRET_KEY: the widget's secret key (Cloudflare dashboard -> Turnstile). Without it the mode is off.
 * TURNSTILE_ALLOWED_HOSTNAMES: e.g. careers.amuwa.com (comma separated).
 */
export function turnstileConfig(env: NodeJS.ProcessEnv = process.env): TurnstileConfig {
  const raw = (env.TURNSTILE_MODE || 'off').trim().toLowerCase();
  const secret = env.TURNSTILE_SECRET_KEY?.trim() || null;
  const mode: TurnstileMode = !secret ? 'off' : raw === 'enforce' || raw === 'log' ? raw : 'off';
  const testUrl = env.TURNSTILE_VERIFY_URL?.trim();
  // a different verification address is for tests only: local addresses, never a remote one
  const verifyUrl = testUrl && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(testUrl) ? testUrl : SITEVERIFY;
  return {
    mode,
    secret,
    hostnames: (env.TURNSTILE_ALLOWED_HOSTNAMES || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean),
    verifyUrl,
    timeoutMs: 5_000
  };
}

export interface TurnstileOutcome {
  /** false only when the request must be refused */
  allowed: boolean;
  /** what was found, for the audit log: ok | missing | invalid | wrong_hostname | wrong_action | unreachable | off */
  result: 'ok' | 'missing' | 'invalid' | 'wrong_hostname' | 'wrong_action' | 'unreachable' | 'off';
}

export type TurnstileFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * Checks a token with Cloudflare (each token is single-use and valid 5 minutes). In "log" mode nothing is refused. If Cloudflare cannot
 * be reached the request is allowed (recorded as "unreachable"): the rate limits below still apply, and a Cloudflare outage must not lock
 * every candidate out.
 */
export async function verifyTurnstile(
  token: string | undefined,
  action: TurnstileAction,
  ip: string | null,
  cfg: TurnstileConfig = turnstileConfig(),
  doFetch: TurnstileFetch = (url, init) => fetch(url, init)
): Promise<TurnstileOutcome> {
  if (cfg.mode === 'off' || !cfg.secret) return { allowed: true, result: 'off' };
  const refuse = (result: TurnstileOutcome['result']): TurnstileOutcome => ({ allowed: cfg.mode !== 'enforce', result });
  const t = (token || '').trim();
  if (!t || t.length > 2048) return refuse('missing');
  let data: Record<string, unknown>;
  try {
    const body = new URLSearchParams({ secret: cfg.secret, response: t, ...(ip ? { remoteip: ip } : {}) }).toString();
    const res = await doFetch(cfg.verifyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(cfg.timeoutMs)
    });
    if (!res.ok) return { allowed: true, result: 'unreachable' };
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    return { allowed: true, result: 'unreachable' };
  }
  if (data.success !== true) return refuse('invalid');
  if (cfg.hostnames.length && !cfg.hostnames.includes(String(data.hostname || '').toLowerCase())) return refuse('wrong_hostname');
  if (data.action !== undefined && data.action !== action) return refuse('wrong_action');
  return { allowed: true, result: 'ok' };
}

export function turnstileRefused(): AppError {
  return new AppError('FORBIDDEN', 'We could not confirm this request came from a person. Refresh the page and try again.', { reason: 'BOT_CHECK_FAILED' });
}

// ---------------------------------------------------------------------------
// Throwaway e-mail domains
// ---------------------------------------------------------------------------
let disposable: Set<string> | null = null;

/** true for an address on a throwaway domain (or a sub-domain of one). DISPOSABLE_EMAIL_ALLOW lists domains to accept anyway. */
export function isDisposableEmail(email: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!domain) return false;
  const allow = new Set((env.DISPOSABLE_EMAIL_ALLOW || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean));
  disposable ??= new Set(DISPOSABLE_DOMAINS_TEXT.split('\n'));
  const parts = domain.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts.slice(i).join('.');
    if (allow.has(d)) return false;
    if (disposable.has(d)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Cloudflare's edge rate limiter (Worker only)
// ---------------------------------------------------------------------------
export type EdgeLimiter = (key: string) => Promise<boolean>;
let edgeLimiter: EdgeLimiter | null = null;

/** Called by worker/entry.ts with the FLOOD_LIMITER binding; Node.js (Vercel, local, tests) keeps the in-memory limiter. */
export function useEdgeLimiter(l: EdgeLimiter | null): void {
  edgeLimiter = l;
}
export function currentEdgeLimiter(): EdgeLimiter | null {
  return edgeLimiter;
}

// ---------------------------------------------------------------------------
// The limits (defaults; each can be changed with an environment variable of the same name)
// ---------------------------------------------------------------------------
export const ABUSE_LIMITS = {
  // candidate sign-up
  CAND_SIGNUP_PER_IP_HOUR: 5,
  CAND_SIGNUP_PER_EMAIL_HOUR: 3,
  CAND_SIGNUP_SITE_HOUR: 300,
  // candidate sign-in (checked by the portal before it asks Supabase)
  CAND_SIGNIN_PER_IP_15MIN: 20,
  CAND_SIGNIN_PER_EMAIL_15MIN: 10,
  // every "forgot password" (candidate, client, staff)
  RESET_PER_IP_15MIN: 5,
  RESET_PER_EMAIL_HOUR: 3,
  // auth e-mails sent through the Supabase hook
  AUTH_MAIL_PER_RECIPIENT_HOUR: 5,
  AUTH_MAIL_SITE_HOUR: 500,
  // signed-in candidates
  CAND_APPLY_PER_DAY: 10,
  CAND_APPLY_GUARD_PER_IP_HOUR: 30,
  CAND_UPLOAD_PER_DAY: 20,
  CAND_PROFILE_SAVE_PER_HOUR: 60,
  // public job listings
  JOBS_PER_IP_MINUTE: 120,
  // staff "sign-in refused" reports
  LOGIN_FAIL_REPORT_PER_IP_15MIN: 10,
  // public booking links (meetings): pages and slots, bookings, and a guest's cancel / answer to a proposed time
  BOOKING_VIEW_PER_IP_5MIN: 60,
  BOOKING_PER_IP_15MIN: 5,
  BOOKING_PER_IP_DAY: 20,
  BOOKING_PER_EMAIL_DAY: 5,
  BOOKING_SITE_HOUR: 200,
  BOOKING_MANAGE_PER_IP_15MIN: 10
} as const;
export type AbuseLimit = keyof typeof ABUSE_LIMITS;

export function limitOf(name: AbuseLimit, env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env[name]);
  return Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : ABUSE_LIMITS[name];
}

export function emailKey(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase().slice(0, 254) : '';
}
