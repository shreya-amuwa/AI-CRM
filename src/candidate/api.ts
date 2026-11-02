import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ApiResponse } from '../../shared/contracts';
let auth: SupabaseClient | null = null;
export function candidateAuth(): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Error(
      'The candidate portal is not configured. Please contact recruitment.',
    );
  return (auth ??= createClient(url, key, {
    auth: {
      storageKey: 'amuwa-candidate-session',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }));
}
export async function candidateRequest<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const session = (await candidateAuth().auth.getSession()).data.session;
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json()) as ApiResponse<T>;
  if (!data.success) throw new Error(data.error.message);
  return data.data;
}
export async function publicJobs<T>(page: number, search: string): Promise<T> {
  const response = await fetch(
    `/api/v1/careers/jobs?page=${page}&search=${encodeURIComponent(search)}`,
  );
  const data = (await response.json()) as ApiResponse<T>;
  if (!data.success) throw new Error(data.error.message);
  return data.data;
}
