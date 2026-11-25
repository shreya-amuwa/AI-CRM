/**
 * The browser side of global search (docs/GLOBAL_SEARCH_ARCHITECTURE.md), without React: matching the pages of the current dashboard,
 * ranking them, the per-person "recently visited" list, and the shortcut test. Records come from the server (public.global_search), which
 * decides what the person may find; nothing here can widen that (aliases only help match a page's own name).
 */

/** A page of the dashboard that is open: registered by the dashboard's own menu, so it lists only what this person has. */
export interface SearchPage {
  /** the menu id the dashboard opens (its own onSelect) */
  navId: string;
  label: string;
  /** the menu section ("Work", "Team"): shown, and searched */
  group?: string;
  /** the parent entry of a sub-page ("Leads" for "Lead List") */
  parent?: string;
}

/** Other words for the same thing. A page matches when the query starts one of these words and the page's name contains another of the set. */
export const ALIASES: string[][] = [
  ['team members', 'team member', 'employees', 'employee', 'emp', 'staff', 'people', 'members'],
  ['managing director', 'md', 'super admin', 'superadmin'],
  ['ceo', 'ceos', 'operations head', 'operation head', 'operations'],
  ['customers', 'customer', 'clients', 'client'],
  ['client conversations', 'client chat', 'conversations'],
  ['attendance', 'punch', 'punch in', 'punch out', 'check in'],
  ['meetings', 'meeting', 'calendar', 'appointments'],
  ['notice board', 'notices', 'notice', 'announcements'],
  ['sales incentives', 'incentives', 'incentive', 'commission'],
  ['leave', 'leaves', 'holiday', 'time off'],
  ['tickets', 'ticket', 'support', 'issues'],
  ['reports', 'report', 'analytics', 'performance'],
  ['income', 'revenue', 'earnings', 'wallet'],
  ['chat', 'messages', 'internal chat'],
  ['field visits', 'field visit', 'visits'],
  ['settings', 'preferences', 'profile']
];

export const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9@.+ ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The score of a page for a query (0: no match). Same ladder as the server: exact, starts with, a word starts with, contains, all words, alias. */
export function scorePage(page: SearchPage, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const label = normalize(page.label);
  const hay = normalize([page.label, page.group, page.parent].filter(Boolean).join(' '));
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.split(' ').some(w => w.startsWith(q))) return 70;
  if (hay.includes(q)) return 55;
  const tokens = q.split(' ');
  if (tokens.length > 1 && tokens.every(t => hay.includes(t))) return 40;
  // an alias: the query starts a word of a set, and the page's name contains another word of that set
  for (const set of ALIASES) {
    if (set.some(a => a === q || a.startsWith(q) || (q.length >= 3 && q.startsWith(a))) && set.some(a => label.includes(a))) return 35;
  }
  return 0;
}

/** Pages ranked (best first, then shorter names, then alphabetically: the same query always gives the same order). */
export function rankPages(pages: SearchPage[], query: string, limit = 8): SearchPage[] {
  const seen = new Set<string>();
  return pages
    .map(p => ({ p, s: scorePage(p, query) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || a.p.label.length - b.p.label.length || a.p.label.localeCompare(b.p.label) || a.p.navId.localeCompare(b.p.navId))
    .filter(x => (seen.has(x.p.navId) ? false : (seen.add(x.p.navId), true)))
    .slice(0, limit)
    .map(x => x.p);
}

// ---------------------------------------------------------------------------------------------------------------- recently visited
/**
 * What is remembered, per person (the key includes their id, so someone else signing in on the same device sees nothing of it):
 *   - a page: its menu id and name (not sensitive);
 *   - a record: only its kind and id. Its name is fetched again (and access checked again) when the list is shown, so no customer or
 *     employee name is kept in the browser.
 */
export type RecentItem =
  | { kind: 'page'; navId: string; label: string; at: number }
  | { kind: 'record'; type: string; id: string; at: number };

export const RECENT_LIMIT = 8;
export const recentKey = (userId: string) => `crm.search.recent.v1.${userId}`;
const RECORD_TYPES = new Set(['employee', 'customer', 'lead', 'meeting', 'ticket', 'department', 'notice']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Store | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export function readRecent(userId: string, s: Store | null = store()): RecentItem[] {
  if (!userId || !s) return [];
  try {
    const raw = JSON.parse(s.getItem(recentKey(userId)) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((r: RecentItem) => r && typeof r.at === 'number' && (
      (r.kind === 'page' && typeof r.navId === 'string' && typeof r.label === 'string' && r.label.length <= 120)
      || (r.kind === 'record' && RECORD_TYPES.has(r.type) && UUID.test(r.id)))).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}
const same = (a: RecentItem, b: RecentItem) => a.kind === b.kind && (a.kind === 'page' ? a.navId === (b as typeof a).navId : a.type === (b as typeof a).type && a.id === (b as typeof a).id);

/** Newest first, no duplicates, at most RECENT_LIMIT. */
export function addRecent(userId: string, item: RecentItem, s: Store | null = store()): RecentItem[] {
  const next = [item, ...readRecent(userId, s).filter(r => !same(r, item))].slice(0, RECENT_LIMIT);
  try { s?.setItem(recentKey(userId), JSON.stringify(next)); } catch { /* storage full or blocked: not remembered */ }
  return next;
}
export function removeRecent(userId: string, item: RecentItem, s: Store | null = store()): RecentItem[] {
  const next = readRecent(userId, s).filter(r => !same(r, item));
  try { s?.setItem(recentKey(userId), JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
export function clearRecent(userId: string, s: Store | null = store()) {
  try { s?.removeItem(recentKey(userId)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------------------------------------------- shortcut
export const isMac = (platform = typeof navigator === 'undefined' ? '' : (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || '') =>
  /mac|iphone|ipad|ipod/i.test(platform);

/** Ctrl + K (Windows, Linux) or Cmd + K (Mac): not while composing text (an input method), not with Alt / Shift. */
export function isSearchShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing'>, mac = isMac()): boolean {
  if (e.isComposing || e.altKey || e.shiftKey) return false;
  if ((e.key || '').toLowerCase() !== 'k') return false;
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}
