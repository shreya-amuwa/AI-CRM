import type { SupabaseClient } from '@supabase/supabase-js';
import { unwrap } from './base.js';

/** public.global_search, called with the signed-in user's own login: the database's row-level rules decide what is found. */
export class SearchRepository {
  constructor(private readonly db: SupabaseClient) {}
  async search(q: string, limit: number): Promise<unknown> {
    return unwrap(await this.db.rpc('global_search', { p_query: q, p_limit: limit }));
  }
  async record(type: string, id: string): Promise<unknown> {
    return unwrap(await this.db.rpc('search_record', { p_type: type, p_id: id }));
  }
}
