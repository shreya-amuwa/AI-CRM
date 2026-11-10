import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../config/env.js';
import { AppError } from '../http/errors.js';
import { requestInfo } from '../http/context.js';

const SERVER_AUTH_OPTIONS = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/**
 * Client that acts AS THE CALLER: their access token is forwarded, so every
 * query is filtered by Row Level Security exactly as for a direct request.
 * This is the default for all data access.
 */
const USER_QUERY_TIMEOUT_MS = Number(process.env.USER_QUERY_TIMEOUT_MS) > 0 ? Number(process.env.USER_QUERY_TIMEOUT_MS) : 20_000;
/** fetch with a deadline (keeps a caller's own abort signal working too). */
export const fetchWithTimeout: typeof fetch = (input, init) => {
  const deadline = AbortSignal.timeout(USER_QUERY_TIMEOUT_MS);
  const own = init?.signal;
  const signal = own && typeof (AbortSignal as any).any === 'function' ? (AbortSignal as any).any([own, deadline]) : own ?? deadline;
  return fetch(input, { ...init, signal });
};

export function createUserClient(accessToken: string): SupabaseClient {
  const env = getEnv();
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: SERVER_AUTH_OPTIONS,
    // The request id travels with every query (PostgREST exposes it to the database), so audit rows can be tied to the request.
    global: {
      // A query that gets no answer is given up after USER_QUERY_TIMEOUT_MS, so a busy database produces a quick "busy, try again"
      // instead of the function hanging until the platform kills it (Vercel: 30 s) while holding a connection.
      fetch: fetchWithTimeout,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(requestInfo.getStore()?.requestId ? { 'X-Request-Id': requestInfo.getStore()!.requestId } : {}),
        // the department / function a Department Head works in; the database checks them against what the Super Admin authorised
        ...(requestInfo.getStore()?.scope?.department ? { 'X-Active-Department': requestInfo.getStore()!.scope!.department! } : {}),
        ...(requestInfo.getStore()?.scope?.division ? { 'X-Active-Division': requestInfo.getStore()!.scope!.division! } : {})
      }
    }
  });
}

let anonClient: SupabaseClient | null = null;
/** Unauthenticated client, used only to verify access tokens. */
export function getAnonClient(): SupabaseClient {
  if (!anonClient) {
    const env = getEnv();
    anonClient = createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: SERVER_AUTH_OPTIONS });
  }
  return anonClient;
}

let serviceClient: SupabaseClient | null = null;
/**
 * Service-role client. BYPASSES RLS - use ONLY for Supabase Auth admin
 * operations (create / ban users) after the caller has been authorised via a
 * database check. Never use it for table reads or writes.
 */
export function getServiceClient(): SupabaseClient {
  const env = getEnv();
  if (!env.supabaseServiceRoleKey) {
    throw new AppError('SERVICE_UNAVAILABLE', 'User administration is not configured on the server.');
  }
  if (!serviceClient) {
    serviceClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, { auth: SERVER_AUTH_OPTIONS });
  }
  return serviceClient;
}

export function hasServiceClient(): boolean {
  return !!getEnv().supabaseServiceRoleKey;
}
