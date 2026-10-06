import type { SupabaseClient } from '@supabase/supabase-js';
import type { Actor } from '../auth/authenticate.js';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface ApiRequest {
  method: HttpMethod;
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string | undefined>;
}

/** Everything a controller needs for one request. */
export interface RequestContext {
  req: ApiRequest;
  params: Record<string, string>;
  actor: Actor;
  /** Supabase client authenticated AS THE CALLER — RLS applies to every query. */
  db: SupabaseClient;
}

export interface HandlerResult<T = unknown> {
  status?: number;
  data: T;
}

export type Handler = (ctx: RequestContext) => Promise<HandlerResult>;

export interface RouteOptions {
  /** Allow callers whose account is not ACTIVE (e.g. GET /me shows the pending screen). */
  allowInactive?: boolean;
  /** Unauthenticated route (health check only). Receives the raw request. */
  public?: (req: ApiRequest) => Promise<unknown>;
}
