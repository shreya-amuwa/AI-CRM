/**
 * Global search without a browser (docs/GLOBAL_SEARCH_ARCHITECTURE.md): page matching and its aliases ("att", "emp", "md", "operation head"),
 * the ranking ladder and a stable order, the per-person recent list (newest first, no duplicates, bounded, only kinds and ids for records,
 * another person sees none of it), the Ctrl / Cmd + K test, and the server's cleaning of results (unknown kinds, bad ids and anything that
 * looks like an address are dropped).
 */
import { addRecent, clearRecent, isSearchShortcut, rankPages, readRecent, recentKey, removeRecent, scorePage, RECENT_LIMIT, type SearchPage } from '../../src/lib/search/searchEngine.js';
import { SearchService } from '../../server/services/SearchService.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++;
  console.log(`ok - ${label}`);
}

const pages: SearchPage[] = [
  { navId: '__attendance', label: 'Attendance' }, { navId: '__meetings', label: 'Meetings' }, { navId: '__notices', label: 'Notice Board' },
  { navId: 'team', label: 'Team Members', group: 'Team' }, { navId: 'incentives', label: 'Sales Incentives', group: 'Income & Reports' },
  { navId: 'customers', label: 'Customer Management', group: 'Customers' }, { navId: 'client-chat', label: 'Client Conversations', group: 'Communication' },
  { navId: 'md', label: 'Managing Director Availability' }, { navId: 'ceos', label: 'CEOs', group: 'Company' }, { navId: 'leads', label: 'Lead List', parent: 'Leads' }
];
const top = (q: string) => rankPages(pages, q)[0]?.label;
check(top('att') === 'Attendance', '"att" → Attendance');
check(top('meet') === 'Meetings', '"meet" → Meetings');
check(top('incent') === 'Sales Incentives', '"incent" → Sales Incentives (a word that starts with it)');
check(top('emp') === 'Team Members', '"emp" → Team Members (alias)');
check(top('md') === 'Managing Director Availability' && top('super admin') === 'Managing Director Availability', '"MD" and "super admin" → Managing Director');
check(top('operation head') === 'CEOs', '"operation head" → CEOs');
check(rankPages(pages, 'client').map(p => p.label).join('|') === 'Client Conversations|Customer Management', '"client" → Client Conversations, then Customer Management');
check(top('lead list') === 'Lead List' && top('leads') === 'Lead List', 'a sub-page is found by its own name and its parent\'s');
check(rankPages(pages, 'zzz').length === 0 && scorePage(pages[0], '') === 0, 'no match, no result; an empty query matches nothing');
check(scorePage(pages[0], 'Attendance') > scorePage(pages[0], 'atten') && scorePage(pages[0], 'atten') > scorePage(pages[3], 'members'),
  'exact beats starts-with beats a later word');
check(JSON.stringify(rankPages(pages, 'e')) === JSON.stringify(rankPages([...pages].reverse(), 'e')), 'the order does not depend on the menu order (deterministic)');
check(rankPages([...pages, pages[0]], 'att').length === 1, 'no duplicates');

// recent, per person
const mem = new Map<string, string>();
const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const rid = (n: number) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
addRecent(A, { kind: 'page', navId: '__attendance', label: 'Attendance', at: 1 }, store);
addRecent(A, { kind: 'record', type: 'customer', id: rid(1), at: 2 }, store);
addRecent(A, { kind: 'page', navId: '__attendance', label: 'Attendance', at: 3 }, store);
let r = readRecent(A, store);
check(r.length === 2 && r[0].kind === 'page' && r[1].kind === 'record', 'newest first, no duplicates');
check(!mem.get(recentKey(A))!.includes('title') && !/name|phone|email/i.test(mem.get(recentKey(A))!), 'a record is remembered by kind and id only (no name, phone or e-mail in the browser)');
check(readRecent('cccccccc-0000-4000-8000-000000000009', store).length === 0, 'another person on the same device sees none of it');
for (let i = 2; i < 20; i++) addRecent(A, { kind: 'record', type: 'employee', id: rid(i), at: 10 + i }, store);
check(readRecent(A, store).length === RECENT_LIMIT, `at most ${RECENT_LIMIT}`);
r = removeRecent(A, readRecent(A, store)[0], store);
check(r.length === RECENT_LIMIT - 1, 'one can be removed');
mem.set(recentKey(A), JSON.stringify([{ kind: 'record', type: 'invoice', id: rid(1), at: 1 }, { kind: 'record', type: 'customer', id: 'not-an-id', at: 1 }, { kind: 'page', navId: 'x', label: 'X', at: 1 }]));
check(readRecent(A, store).length === 1, 'unknown kinds and malformed ids stored by anything else are ignored');
mem.set(recentKey(A), '{broken');
check(readRecent(A, store).length === 0, 'a broken entry is ignored');
clearRecent(A, store);
check(!mem.has(recentKey(A)), 'clear recent history');

// the shortcut
const key = (k: string, o: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...o }) as KeyboardEvent;
check(isSearchShortcut(key('k', { ctrlKey: true }), false) && isSearchShortcut(key('K', { ctrlKey: true }), false), 'Ctrl + K on Windows / Linux');
check(isSearchShortcut(key('k', { metaKey: true }), true) && !isSearchShortcut(key('k', { ctrlKey: true }), true), 'Cmd + K on a Mac (Ctrl + K stays the Mac\'s own text shortcut)');
check(!isSearchShortcut(key('k', { ctrlKey: true, isComposing: true }), false), 'not while composing text (an input method)');
check(!isSearchShortcut(key('k', { ctrlKey: true, shiftKey: true }), false) && !isSearchShortcut(key('j', { ctrlKey: true }), false), 'not with Shift, not another key');

// the server passes on only well-formed results
const UUID = 'dddddddd-0000-4000-8000-000000000001';
const repo: any = { search: async () => ({ query: 'asha', groups: [
  { type: 'customer', hasMore: true, items: [{ type: 'customer', id: UUID, title: 'Asha Traders', subtitle: 'CUS-1', meta: 'Active', score: 80 },
    { type: 'customer', id: 'javascript:alert(1)', title: 'Bad id', score: 1 }, { type: 'lead', id: UUID, title: 'Wrong group', score: 1 }] },
  { type: 'website', items: [{ type: 'website', id: UUID, title: 'Not a kind', url: 'https://evil.example' }] }
] }), record: async () => ({ type: 'customer', id: UUID, title: 'Asha Traders', fields: { Phone: '98199 12345', Empty: '', Owner: 'Sachin' } }) };
const svc = new SearchService(repo);
const out = await svc.search({ q: 'asha' });
check(out.groups.length === 1 && out.groups[0].items.length === 1 && out.groups[0].hasMore && out.groups[0].items[0].title === 'Asha Traders',
  'unknown kinds, malformed ids and mixed-up items are dropped');
check(!JSON.stringify(out).includes('evil.example') && !JSON.stringify(out).includes('javascript:'), 'no address from the data ever reaches the browser');
let threw = '';
try { await svc.search({ q: 'asha', limit: 500 }); } catch (e) { threw = (e as Error).message; }
check(threw !== '', 'a limit above 20 is refused');
threw = '';
try { await svc.search({ q: 'x'.repeat(201) }); } catch (e) { threw = (e as Error).message; }
check(threw !== '', 'a query above 200 characters is refused');
const card = await svc.record('customer', UUID);
check(card.fields.length === 2 && card.fields[0][0] === 'Phone', 'a record opens with its non-empty fields, in order');
threw = '';
try { await svc.record('invoice', UUID); } catch (e) { threw = (e as Error).message; }
check(threw !== '', 'an unknown kind of record is refused before the database');
threw = '';
try { await svc.record('customer', '../../etc'); } catch (e) { threw = (e as Error).message; }
check(threw !== '', 'a malformed id is refused');

console.log(`\n=== GLOBAL SEARCH UNIT TESTS PASSED (${passed}) ===`);
