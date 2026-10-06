/**
 * Server-side configuration. Read lazily so a missing variable produces a
 * clean 503 response instead of crashing the function at import time.
 * The service-role key is only ever read here and never sent to clients.
 */
export interface ServerEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string | null;
  allowedOrigins: string[];
}

let cached: ServerEnv | null = null;

export class ConfigurationError extends Error {}

export function getEnv(): ServerEnv {
  if (cached) return cached;
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new ConfigurationError('SUPABASE_URL and SUPABASE_ANON_KEY must be configured on the server.');
  }
  cached = {
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim() || null,
    allowedOrigins: (process.env.API_ALLOWED_ORIGINS || '')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean)
  };
  return cached;
}
