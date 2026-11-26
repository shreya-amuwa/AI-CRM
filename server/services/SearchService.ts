import { SEARCH_RECORD_TYPES, type SearchRecord, type SearchRecordCard, type SearchRecordType, type SearchResponse } from '../../shared/contracts.js';
import { globalSearchSchema, searchRecordParamsSchema } from '../../shared/validation.js';
import { parse } from '../http/validate.js';
import type { SearchRepository } from '../repositories/SearchRepository.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Global search (docs/GLOBAL_SEARCH_ARCHITECTURE.md). The database decides what the caller may find (global_search runs with their login);
 * this layer validates the query and passes on only well-formed results of known kinds: an id, a title and display text. No address is
 * ever taken from the data: the browser maps a kind and an id to its own screens.
 */
export class SearchService {
  constructor(private readonly repo: SearchRepository) {}

  async search(body: unknown): Promise<SearchResponse> {
    const b = parse(globalSearchSchema, body ?? {});
    const raw = (await this.repo.search(b.q, b.limit ?? 5)) as { query?: unknown; groups?: unknown } | null;
    const groups = Array.isArray(raw?.groups) ? raw!.groups : [];
    return {
      query: typeof raw?.query === 'string' ? raw.query : '',
      groups: groups.flatMap(g => {
        const type = (g as { type?: unknown }).type as SearchRecordType;
        if (!SEARCH_RECORD_TYPES.includes(type)) return [];
        const items: SearchRecord[] = ((g as { items?: unknown[] }).items ?? []).flatMap(i => {
          const r = i as Record<string, unknown>;
          const id = typeof r.id === 'string' && UUID.test(r.id) ? r.id : null;
          const title = text(r.title, 200);
          if (!id || !title || r.type !== type) return [];
          return [{ type, id, title, subtitle: text(r.subtitle, 240), meta: text(r.meta, 60), reference: text(r.reference, 60), score: Number(r.score) || 0 }];
        });
        return items.length ? [{ type, items, hasMore: (g as { hasMore?: unknown }).hasMore === true }] : [];
      })
    };
  }

  /** One result opened (from the palette, or an address typed by hand): read as the caller again, so access is checked anew. */
  async record(type: string, id: string): Promise<SearchRecordCard> {
    const p = parse(searchRecordParamsSchema, { type, id });
    const r = (await this.repo.record(p.type, p.id)) as Record<string, unknown>;
    const fields: [string, string][] = Object.entries((r.fields ?? {}) as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string' && v.trim())
      .map(([k, v]) => [k.slice(0, 40), String(v).slice(0, 300)]);
    return { type: r.type as SearchRecordType, id: String(r.id), title: String(r.title ?? '').slice(0, 200), fields };
  }
}
