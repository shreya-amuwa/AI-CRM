import type { ApiResponse, ErrorCode } from '../../../shared/contracts';
import { getSupabase } from '../../services/supabaseClient';
import { scopeHeaders } from '../scope/activeScope';

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

// ---------------------------------------------------------------------------
// Fewer identical requests (set VITE_API_CACHE=off at build time to switch this off)
//  * GET requests that are identical (same URL, same signed-in session, same scope) and still in flight share one network call.
//    Each caller parses its own copy of the response, so no caller can change another caller's data.
//  * The service catalogue (the same for everyone, edited rarely) is reused for a short time.
//  * Any change (POST / PATCH / DELETE), success or not, forgets every reused answer, so a screen never shows a list older than the
//    user's own last change. Nothing is kept across a page reload.
// ---------------------------------------------------------------------------
type RawResponse = { status: number; text: string };
const API_CACHE_ON = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_CACHE !== 'off';
const REFERENCE_TTL_MS = 60_000;
// only answers that are the same for everyone and change only when the catalogue itself is edited (departments and teams are NOT here:
// they carry live details such as which head positions are taken)
const REFERENCE_PATHS = [/^\/pipeline\/services$/];
const inflight = new Map<string, Promise<RawResponse>>();
const reference = new Map<string, { at: number; res: RawResponse }>();

/**
 * Forget every reused answer (after a change, and on sign-out). Requests already in flight finish for whoever is waiting on them, but no
 * request made from now on joins them: a list asked for after a change always comes from the server after that change.
 */
export function clearApiCache(): void {
  reference.clear();
  inflight.clear();
}
if (typeof window !== 'undefined') {
  window.addEventListener('crm:unauthenticated', clearApiCache);
  window.addEventListener('crm:account-inactive', clearApiCache);
}

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

  const headers: Record<string, string> = {
    ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    // the department / function a Department Head works in (the server and the database check it against what was authorised)
    ...scopeHeaders()
  };
  const send = async (): Promise<RawResponse> => {
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: options.body !== undefined ? JSON.stringify(options.body) : undefined });
    } catch {
      throw new ApiError('NETWORK_ERROR', 'Cannot reach the server. Check your connection.', 0);
    }
    return { status: res.status, text: await res.text() };
  };

  let raw: RawResponse;
  if (method === 'GET' && API_CACHE_ON) {
    // the key holds the session's token and the scope headers: another user, or another department, never shares an answer
    const key = `${url}\n${headers.Authorization ?? ''}\n${headers['X-Active-Department'] ?? ''}\n${headers['X-Active-Division'] ?? ''}`;
    const keep = REFERENCE_PATHS.some(rx => rx.test(path));
    const hit = keep ? reference.get(key) : undefined;
    if (hit && Date.now() - hit.at < REFERENCE_TTL_MS) {
      raw = hit.res;
    } else {
      let pending = inflight.get(key);
      if (!pending) {
        const mine: Promise<RawResponse> = send().finally(() => {
          if (inflight.get(key) === mine) inflight.delete(key);
        });
        pending = mine;
        inflight.set(key, pending);
      }
      raw = await pending;
      if (keep && raw.status === 200) reference.set(key, { at: Date.now(), res: raw });
    }
  } else {
    // from the moment a change starts, a new GET never joins one sent before it
    if (method !== 'GET') clearApiCache();
    try {
      raw = await send();
    } finally {
      // a change may have touched any list: never reuse an answer from before it
      if (method !== 'GET') clearApiCache();
    }
  }
  const res = { status: raw.status };
  const text = raw.text;
  let payload: ApiResponse<T> | null = null;
  try {
    payload = JSON.parse(text) as ApiResponse<T>;
  } catch {
    /* non-JSON: platform error page, timeout, or the route did not reach the API */
  }
  if (!payload || typeof payload !== 'object' || !('success' in payload)) {
    const snippet = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
    console.error(`[api] ${method} ${url} → HTTP ${res.status} (non-JSON)`, text.slice(0, 500));
    throw new ApiError(
      res.status >= 500 ? 'INTERNAL' : 'NOT_FOUND',
      `Server error (HTTP ${res.status}) on ${method} ${path}${snippet ? `: ${snippet}` : ''}`,
      res.status
    );
  }
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
