# Global search (Ctrl / Cmd + K)

One search for the whole staff CRM. It finds the pages of the dashboard that is open and the records the signed-in person may already
open: employees, customers, leads, meetings, support tickets, departments and notices. Choosing a result opens that exact page or
record. The search never shows anything the person could not already open elsewhere in the CRM.

How people use it: `docs/COMMAND_PALETTE_GUIDE.md`.

## The pieces

| Piece | File | What it does |
|---|---|---|
| Provider | `src/components/search/GlobalSearch.tsx` (`GlobalSearchProvider`, mounted in `src/App.tsx` for an ACTIVE employee) | One keyboard listener for the app; opens the palette; keeps each dashboard's menu |
| Trigger | `GlobalSearchTrigger` in the shared top bar (`shell.tsx` `TopBar`) and the older `Header.tsx` | "Search anything… Ctrl K" on larger screens, a search icon on phones |
| Menu registration | `useSearchPages(pages, onSelect)`, called by `DashboardShell` and `TeamMemberLayout` | A dashboard's own menu (only the pages this person has) becomes searchable, opened by the dashboard's own navigation |
| Palette and record panel | `src/components/search/CommandPalette.tsx` (loaded on demand; preloaded 1.5 s after sign-in) | Results, keyboard, recent items, the record panel |
| Matching, recent, shortcut | `src/lib/search/searchEngine.ts` (no React) | Page matching and aliases, ranking, per-person recent list, Ctrl/Cmd + K test |
| API | `POST /api/v1/search` (`{ q, limit }`) and `GET /api/v1/search/records/:type/:id` | `server/services/SearchService.ts` → `SearchRepository` → database functions |
| Database | `supabase/migrations/20270215000100_global_search.sql` | `public.global_search(q, limit)` and `public.search_record(type, id)` |

The query is sent in a POST body, so it does not appear in addresses or access logs. The per-user request quota applies, and the palette
sends one request after typing pauses (250 ms).

## Permissions: the database decides

`global_search` and `search_record` are **security invoker** functions: they read with the caller's own login, so the existing
row-level rules decide what is returned:

| Records | Rule used | Notes |
|---|---|---|
| Employees | the `profiles` policy, `private.can_view_profile` | The Managing Director sees everyone; a Department Head sees their department (Sales scope); a Team Lead sees the people they directly lead; a Team Member sees colleagues under the same Team Lead |
| Customers, leads | the 14 `customers` policies | Owner, the owner's Team Lead, the department's head / CEO scopes, the Support desk rule, the Meta Verifier and Technical Consultant rules, Accounts, delivery recipients |
| Support tickets | the `support_tickets` policies | Assignee, creator, the escalation target, the team's lead, the department's head |
| Meetings | `private.mtg_can_view` | Host, organiser, attendee, delegate; the Managing Director's requests for the CEO. Private meetings are never shown to others, the Managing Director included |
| Notices | `private.notice_visible` | Recipients and publishers; never a deleted notice or someone else's scheduled one |
| Departments | stricter than the table rule | The Managing Director: all. A Department Head or CEO: the departments of their scopes (`private.scopes_of`). Everyone else: their own department |

Other rules:
* **Account status.** A suspended or pending account cannot search. Anonymous callers have no access.
* **Fields returned.** Only display fields come back: name, subtitle, status and id. Notes, amounts and contact details are never
  returned in the result list.
* **Re-checking on open.** Opening a record (`search_record`) reads it again as the caller. A record that was deleted, or is no longer
  theirs, answers NOT_FOUND ("This record is no longer available, or you do not have access to it."). The same happens for an address
  typed by hand.
* **No links from data.** The browser never receives a link from the data. It maps a kind and an id to its own screens, and the server
  drops unknown kinds and malformed ids.

### Speed without weakening the rules

Under row-level security PostgreSQL cannot use the trigram indexes for "contains" (LIKE is not leakproof). It would therefore read a
whole large table and evaluate every policy on every row. To avoid that:

1. **Candidates.** Small `private.search_*_candidates` helpers find matching ids through the indexes. They are security definer and
   return ids only, never data, from the `private` schema, which the API does not expose (PostgREST serves only `public`).
2. **Read as the caller.** `global_search` then reads only those ids, so the row-level rules still decide what is returned.
3. **Values, not a call.** The candidate list is passed as a value, not a function call, so PostgreSQL uses the primary key before the
   policies.

The caller's own role and department come from `private.search_caller()` (one row by primary key).

**Measured** with 50,000 extra customers on the test database:

| Search | Managing Director | Team Member | Department Head |
|---|---|---|---|
| Exact name or number | 8–15 ms | 22 ms | ~95 ms |
| Broad word | ~90 ms | ~120 ms | ~0.9 s |

The slowest case is one generic word matching every row (for example "person" on 50,000 customers).

**Limitation.** For a query matching more than 600 records of one kind, only the 600 best matches are considered (exact first, then
"starts with", then the most recently updated). If someone's own record is not among them, a more specific query finds it.

## Ranking

The same ladder is used on the server (`private.search_score`) and for pages (`scorePage`):

1. an exact match of the name, or of the id or customer code;
2. the name starts with the query;
3. a word of the name starts with the query;
4. the query appears in the name or details;
5. every word of the query appears, in any order;
6. a close spelling: each word of 4+ letters has a word similarity of 0.4 or more. This is never used for numbers, because a phone
   number is not "close" to another.

**Ties.** Equal matches are sorted by name, then id, so the same search always gives the same order. Recently visited items appear only
when the search is empty; they never push a weaker match above a stronger one.

**Phone numbers.** These are matched on their digits, so "98199 12345", "98199-12345" and "9819912345" all match.

**Pages.** These also match **aliases** (`ALIASES` in `searchEngine.ts`): "emp" finds Team Members, "MD" or "super admin" finds Managing
Director, "operation head" finds CEOs, "client" finds Client Conversations and Customer Management. An alias only matches a page that is
already in the person's own menu.

## Opening results

| Result | Opens |
|---|---|
| A page | the dashboard's own navigation (`onSelect` of that menu) |
| A meeting | the Meetings page on that meeting (`openMeeting(id)`, the same event as a meeting notification) |
| A notice | the Notice Board on that notice (`openNotice(id)`) |
| An employee, customer, lead, ticket, department | the record panel at `?open=record&type=…&id=…`. **Back** closes it, **Forward** opens it again, a **refresh** keeps it, and a pasted link works (after the same access check). Where the dashboard has a matching page ("Customers", "Team Members", "Tickets", "Departments"), the panel offers "Go to …" |

## Recent items, per person

They are stored in the browser under `crm.search.recent.v1.<profile id>`, so another person signing in on the same device sees none of
them:

* **Pages** are stored with their menu id and name.
* **Records** are stored by kind and id only. No customer or employee name is kept in the browser; the name is fetched again (with the
  access check) when the list is shown. A record that is gone is dropped.
* At most 8 are kept, newest first, without duplicates. Each can be removed, and "Clear recent history" empties the list.
* Past search texts are not stored, because they may contain customers' names.

## Making something new searchable

**A new page** needs nothing: it is in the dashboard's menu, so `DashboardShell` / `TeamMemberLayout` registers it. A dashboard with its
own menu calls `useSearchPages(pages, onSelect)` once.

**A new kind of record** takes four steps:
1. **Database:** a section in `public.global_search` that reads the table as the caller (security invoker), using the table's own
   row-level rules or its existing visibility helper. If the table is large, add a candidates helper and an index. Add a branch in
   `public.search_record` if it opens in the record panel. Add role tests in `supabase/tests/global_search_test.sql`, including the
   check that every returned id is readable directly (`test.gs_within_rls`).
2. **Contract:** add the kind to `SEARCH_RECORD_TYPES` (`shared/contracts.ts`) and, if it opens in the panel, to
   `searchRecordParamsSchema` (`shared/validation.ts`).
3. **Palette:** add its label and icon to `KIND`, and how it opens to `openSearchRecord` (`CommandPalette.tsx`). Reuse an existing
   "open this one" event if its page has one.
4. **Docs:** add a row to the permission table above.

## Tests

| Test | Covers |
|---|---|
| `supabase/tests/global_search_test.sql` (`npm run test:db`) | Team Member, Team Leads A and B, Department Head, another department's head, Operations Heads (Sales, Support-only), Support member, HR recruiter and staff, Accounts head and member, Managing Director. Every returned id is readable directly by the same person; opening by a typed id; deleted records; phone digits; ranking; typos; paging; SQL-like input; suspended and anonymous callers |
| `supabase/tests/global_search.test.ts` (`npm run test:unit`) | Page matching and aliases, ranking, the recent list (per person, ids only), the shortcut, the server's cleaning of results |
| `supabase/tests/ui_global_search.test.mjs` (browser) | Ctrl + K, Cmd + K on a Mac, Escape and focus, pages, a single debounced request, stale answers, the record panel with Back / Forward / refresh, a missing record, a meeting, recent items per person, empty / error / ended-session states, 320 and 390 px |
