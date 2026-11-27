/**
 * Paging for feed-style lists (recent activity, history, timelines, notes, logs), shared by the staff CRM
 * (src/components/common/Paged.tsx) and the client dashboard (src/client/ui.tsx ClientPaged).
 */
export const FEED_PAGE_SIZE = 10;

/** The entries on page `page` (1-based) and the number of pages; a page past the end shows the last page. */
export function pageOf<T>(items: readonly T[], page: number, pageSize: number): { rows: T[]; page: number; pages: number } {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { rows: items.slice((p - 1) * size, p * size), page: p, pages };
}
