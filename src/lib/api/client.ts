import type { ApiResponse, ErrorCode } from '../../../shared/contracts';
import { getSupabase } from '../../services/supabaseClient';

const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

/**
 * The single place the UI talks to the backend. Attaches the current
 * Supabase access token, unwraps the `{ success, data | error }` envelope
 * and throws ApiError on failure.
 */
export async function apiRequest<T>(method: string, path: string, options: { query?: Query; body?: unknown } = {}): Promise<T> {
  const session = (await getSupabase()?.auth.getSession())?.data.session;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(options.query || {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const url = `${API_BASE}${path}${qs.toString() ? `?${qs}` : ''}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {})
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Cannot reach the server. Check your connection.', 0);
  }

  let payload: ApiResponse<T> | null = null;
  try {
    payload = (await res.json()) as ApiResponse<T>;
  } catch {
    /* non-JSON response */
  }
  if (!payload) throw new ApiError('INTERNAL', 'Unexpected server response.', res.status);
  if (!payload.success) {
    if (res.status === 401) window.dispatchEvent(new CustomEvent('crm:unauthenticated'));
    if (payload.error.code === 'ACCOUNT_INACTIVE') window.dispatchEvent(new CustomEvent('crm:account-inactive'));
    throw new ApiError(payload.error.code, payload.error.message, res.status, payload.error.details);
  }
  return payload.data;
}

export const api = {
  get: <T>(path: string, query?: Query) => apiRequest<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>('POST', path, { body: body ?? {} }),
  patch: <T>(path: string, body: unknown) => apiRequest<T>('PATCH', path, { body }),
  delete: <T>(path: string) => apiRequest<T>('DELETE', path)
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}
