import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getEnv } from '../config/env.js';
import { AppError } from '../http/errors.js';

const SERVER_AUTH_OPTIONS = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/**
 * Client that acts AS THE CALLER: their access token is forwarded, so every
 * query is filtered by Row Level Security exactly as for a direct request.
 * This is the default for all data access.
 */
export function createUserClient(accessToken: string): SupabaseClient {
  const env = getEnv();
  return createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: SERVER_AUTH_OPTIONS,
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
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
 * Service-role client. BYPASSES RLS — use ONLY for Supabase Auth admin
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
