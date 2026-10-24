import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { scopeHeaders } from '../lib/scope/activeScope';

/**
 * Browser Supabase client. Configuration comes ONLY from build-time
 * environment variables (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY); there
 * are no hard-coded fallbacks and no runtime overrides from localStorage.
 *
 * The browser uses Supabase for:
 *   1. Auth (sign in / sign up / session refresh)
 *   2. Realtime pings on tables protected by RLS
 *   3. The team member workspace and field visits (teamMemberStore,
 *      fieldVisitStore), read and written directly under RLS
 * Other CRM data goes through the API client in src/lib/api.
 */
export interface SupabaseConfig {
  url: string;
  isConfigured: boolean;
}

const env = import.meta.env;
const SUPABASE_URL = (env.VITE_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (env.VITE_SUPABASE_ANON_KEY || '').trim();

export function getSupabaseConfig(): SupabaseConfig {
  return { url: SUPABASE_URL, isConfigured: !!(SUPABASE_URL && SUPABASE_ANON_KEY) };
}

/** Direct data requests (PostgREST) carry the department / function a Department Head works in; the database checks them. */
const fetchWithScope: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const scope = scopeHeaders();
  if (!url.includes('/rest/v1/') || Object.keys(scope).length === 0) return fetch(input, init);
  const headers = new Headers(init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined));
  for (const [k, v] of Object.entries(scope)) headers.set(k, v);
  return fetch(input, { ...init, headers });
};

let clientInstance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!clientInstance && SUPABASE_URL && SUPABASE_ANON_KEY) {
    clientInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } },
      global: { fetch: fetchWithScope }
    });
  }
  return clientInstance;
}

/** Like getSupabase() but throws a clear error when env vars are missing. */
export function requireSupabase(): SupabaseClient {
  const client = getSupabase();
  if (!client) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  return client;
}
