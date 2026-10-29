import { hasServiceClient, getServiceClient } from '../db/supabase.js';
import type { GeoLocation } from './clientNetwork.js';

/**
 * Security events recorded by the API server (what the database cannot record itself: a refused request rolls its own transaction
 * back). Written to audit_logs through public.record_server_event (service role only).
 *
 * - Never throws and never delays a response: a failure to log is reported on the server log (never swallowed) and the request goes on.
 * - Deduplicated: the same event (same dedupe key) is stored once, so retries and floods of one kind are one row. A small in-memory
 *   check in front of the database keeps a flood from becoming database traffic.
 * - Never receives a token, a password, a request body or a query string: callers pass route patterns and codes only.
 */
export type SecurityOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED';

export interface SecurityEvent {
  action: string;
  entityType: string;
  entityId?: string | null;
  /** The signed-in person, when the request got that far. */
  actorId?: string | null;
  outcome: SecurityOutcome;
  requestId?: string;
  ip?: string;
  /** Where the caller was, when the platform or the configured lookup service could tell (never guessed, never from the caller). */
  location?: GeoLocation | null;
  /** Same key = same event: it is recorded once. */
  dedupeKey: string;
  metadata?: Record<string, unknown>;
}

const WINDOW_MS = 5 * 60_000;
const MAX_REMEMBERED = 5000;
const MAX_ANONYMOUS_PER_MINUTE = 60;

const seen = new Map<string, number>();
let anonymousWindowStart = 0;
let anonymousInWindow = 0;
let warnedNoServiceClient = false;

function remember(key: string, now: number): boolean {
  const at = seen.get(key);
  if (at !== undefined && now - at < WINDOW_MS) return false;
  if (seen.size >= MAX_REMEMBERED) {
    for (const [k, t] of seen) if (now - t >= WINDOW_MS) seen.delete(k);
    if (seen.size >= MAX_REMEMBERED) seen.clear();
  }
  seen.set(key, now);
  return true;
}

/** Tests only: forget what was recorded and the anonymous count, so one test's traffic cannot use up another's allowance. */
export function resetSecurityEventLimits(): void {
  seen.clear();
  anonymousWindowStart = 0;
  anonymousInWindow = 0;
}

export async function recordSecurityEvent(e: SecurityEvent): Promise<void> {
  try {
    const now = Date.now();
    if (!remember(e.dedupeKey, now)) return;
    if (!e.actorId) {
      // events from callers nobody could identify: bounded, so guessing at the API cannot flood the log
      if (now - anonymousWindowStart > 60_000) {
        anonymousWindowStart = now;
        anonymousInWindow = 0;
      }
      if (++anonymousInWindow > MAX_ANONYMOUS_PER_MINUTE) return;
    }
    if (!hasServiceClient()) {
      if (!warnedNoServiceClient) {
        warnedNoServiceClient = true;
        console.warn('[security] SUPABASE_SERVICE_ROLE_KEY is not set: denied requests and sign-ins are not recorded in the audit log.');
      }
      return;
    }
    const { error } = await getServiceClient().rpc('record_server_event', {
      p_action: e.action,
      p_entity_type: e.entityType,
      p_entity_id: e.entityId ?? null,
      p_actor: e.actorId ?? null,
      p_outcome: e.outcome,
      p_request_id: e.requestId ?? null,
      p_ip: e.ip && e.ip !== 'unknown' ? e.ip : null,
      p_dedupe_key: e.dedupeKey,
      p_metadata: e.metadata ?? {},
      p_location: e.location ?? null
    });
    if (error) {
      // forget it, so the next attempt is not suppressed by a failed write
      seen.delete(e.dedupeKey);
      console.error('[security] could not record the event', JSON.stringify({ action: e.action, code: error.code, message: error.message, requestId: e.requestId }));
    }
  } catch (err) {
    seen.delete(e.dedupeKey);
    console.error('[security] could not record the event', JSON.stringify({ action: e.action, message: (err as Error)?.message, requestId: e.requestId }));
  }
}

/** Test hook: forget what was recorded. */
export function resetSecurityEventMemory(): void {
  seen.clear();
  anonymousInWindow = 0;
  anonymousWindowStart = 0;
  warnedNoServiceClient = false;
}

/** The session id inside an access token (the token was already verified by the database; this only reads the label). */
export function sessionClaims(authorization: string | undefined): { sessionId: string; method: string | null } | null {
  const token = /^Bearer\s+(.+)$/i.exec(authorization || '')?.[1]?.trim();
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { session_id?: unknown; amr?: unknown };
    if (typeof payload.session_id !== 'string' || !/^[0-9a-fA-F-]{8,64}$/.test(payload.session_id)) return null;
    const first = Array.isArray(payload.amr) ? (payload.amr[0] as { method?: unknown } | undefined) : undefined;
    return { sessionId: payload.session_id, method: typeof first?.method === 'string' ? first.method.slice(0, 40) : null };
  } catch {
    return null;
  }
}
