import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountStatus, Role } from '../../shared/contracts.js';
import { createUserClient, getAnonClient } from '../db/supabase.js';
import { AppError } from '../http/errors.js';

/** The authenticated caller, loaded from trusted database state. */
export interface Actor {
  id: string;
  email: string;
  role: Role;
  status: AccountStatus;
  departmentId: string | null;
  teamId: string | null;
}

export interface Authenticated {
  actor: Actor;
  db: SupabaseClient;
}

export function extractBearerToken(header: string | undefined): string {
  const match = /^Bearer\s+(.+)$/i.exec(header || '');
  if (!match) throw new AppError('UNAUTHENTICATED');
  return match[1].trim();
}

/**
 * Verifies the access token with Supabase Auth (signature + expiry + user
 * still exists), then loads role/status/placement from `profiles`. Nothing
 * from the token's claims or the request body is trusted for authorization.
 */
export async function authenticate(authorizationHeader: string | undefined): Promise<Authenticated> {
  const token = extractBearerToken(authorizationHeader);
  const { data, error } = await getAnonClient().auth.getUser(token);
  if (error || !data.user) {
    const status = (error as { status?: number } | null)?.status;
    // 401/403: the token itself is invalid or expired. Anything else (no
    // status, 5xx, fetch failure) is a server configuration/network problem
    // and must not be reported to the user as an expired session.
    if (status === 401 || status === 403 || (!error && !data.user)) {
      console.warn('[api] token rejected by Supabase Auth:', error?.message,
        '— if this happens right after signing in, SUPABASE_URL / SUPABASE_ANON_KEY on the server',
        'probably belong to a different project than VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.');
      throw new AppError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
    }
    console.error('[api] could not verify the access token with Supabase Auth:', { status, message: error?.message });
    throw new AppError('SERVICE_UNAVAILABLE', 'The server could not reach Supabase Auth. Check SUPABASE_URL and SUPABASE_ANON_KEY on the server.');
  }

  const db = createUserClient(token);
  const { data: profile, error: profileError } = await db
    .from('profiles')
    .select('id, email, role, status, department_id, team_id')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profileError) throw new AppError('INTERNAL');
  if (!profile) throw new AppError('UNAUTHENTICATED', 'No CRM profile exists for this account.');

  return {
    db,
    actor: {
      id: profile.id,
      email: profile.email,
      role: profile.role,
      status: profile.status,
      departmentId: profile.department_id,
      teamId: profile.team_id
    }
  };
}

export function assertActive(actor: Actor): void {
  if (actor.status === 'ACTIVE') return;
  const messages: Record<Exclude<AccountStatus, 'ACTIVE'>, string> = {
    PENDING: 'Your account is awaiting approval.',
    SUSPENDED: 'Your account has been suspended.',
    REVOKED: 'Your access has been revoked.',
    REJECTED: 'Your registration was declined.'
  };
  throw new AppError('ACCOUNT_INACTIVE', messages[actor.status], { status: actor.status });
}
