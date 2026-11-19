# System Speed, Phase A: Trim and Filter the Live Updates: Design

Date: 2026-11-19. Status: approach C chosen in conversation (A now, then B for chat and the bell only if the measurements say so).

## Why
Staff report slow screens. Production numbers (`pg_stat_statements`, read-only, 2026-11-19):
- The Supabase Realtime change feed (`SELECT wal->>… ` the `postgres_changes` poller) is **~75% of all database time**: 2.68 M calls,
  ~24,000 s, spikes to 14 s. The next biggest item is about 10 times smaller.
- When the database is busy with it, ordinary screens that normally take 30–80 ms spike to 5–8 s (`attendance_today`,
  `chat_unread_summary`, `leave_requests_to_review`, `work_reports_context`, `customer_pipeline_counts`).
- **40 tables are published to Realtime, only ~22 have a listener.** Every change to the others (GPS tracking points, profiles, HR
  tables, automation jobs, …) is still decoded for nothing.
- **Most listeners have no filter**, so every change is checked against every listener's permissions: `crm_leads` INSERT (32 listeners,
  mounted for everybody by `LeadStoreContext`), `chat_conversations` (27), `work_report_signals` (16), `member_invoices` (11), `customers`
  (9), `work_tasks` / `work_task_updates` (7), support tables (5–6), customer onboarding tables (6).
- Rate limiting is not a problem (its call is the per-request sign-in check). Sentry shows **no page timings** for the last 7 days although
  browser tracing is configured at 10% in production.

## Goals
- Remove the wasted live-update work without any screen losing an update it gets today.
- Measure: page and API timings in Sentry, and a before / after of the database numbers.

## Non-goals
- Phase B (personal "signal" channels via Realtime Broadcast) is not part of this; it is decided after measuring phase A.
- No change to what any screen shows or to who may see what.

## Anti-goals (failure even if it "works")
- A screen that updated live stops updating (a listener on a table that was removed from the feed, or a filter that is too narrow).
- A filter that lets someone receive changes they could not see before (filters only narrow; permissions are still checked by Supabase).

## Approaches (chosen: C)
| | What | Trade-off |
|---|---|---|
| A | Trim the feed to the tables someone listens to; filter the busiest listeners to the person's own scope; turn on measurement. | Low risk, one PR, removes most of the waste; the per-listener permission check remains. |
| B | Database triggers send small "something changed for you" signals to per-person / per-team Broadcast channels; screens listen to their own channel only. | Biggest gain (no change-feed decoding, no per-listener checks) but touches every live screen: several PRs. |
| **C (chosen)** | **A now; B for chat and the bell only if A's measurements show it is still needed.** | Cheap safe win first, the larger change only where the numbers justify it. |

## Phase A design
1. **Trim the feed** (one migration, safe to run twice): remove from `supabase_realtime` every table that no code listens to. The list is
   derived from the code (every `postgres_changes` `table:` and every `listenToTables([...])` argument, including the client portal and
   variables such as `support.ts`'s `useRealtime(table)`), not guessed. A unit test keeps the two in step: it fails when a listener names a
   table that is not published, or a published table has no listener.
2. **Filter the busiest listeners** (Realtime `filter`, one column, `eq` or `in`):
   - `work_report_signals` → `recipient_id=eq.<me>` (the table is per recipient).
   - `chat_conversations` in the chat list (`useChatLive`) → `id=in.(<my conversation ids>)` (Realtime allows up to 100 values); with more
     than 100 conversations keep today's unfiltered listener.
   - `crm_leads` INSERT (`LeadStoreContext`) → only on the screens that show inbound leads, not mounted for everybody. Also stop logging the
     lead's personal data to the browser console (`console.log('[Supabase Realtime] Inbound lead arrived live:', row)`).
   - Pipeline tables (`customers`, `customer_documents`, `customer_onboarding`, `customer_onboarding_entries`, `member_invoices`),
     `work_tasks` / `work_task_updates`, support tables: filter by the narrowest column that matches the viewer's scope when the table has
     one (own records → owner / assignee; a team → `team_id`; a department → `department_id`); a company-wide viewer (Super Admin,
     Accounts, HR where it applies) keeps the unfiltered listener. A filter is added only where it is certain to include everything the
     screen shows today; otherwise the listener stays as it is.
3. **Measurement**
   - Find out why Sentry receives no browser timings (DSN or sample rate missing from the production build, or traces dropped) and make the
     10% sampling work. No personal data in traces (the existing scrubbing applies).
   - Record the database numbers (calls, total and mean time of the change feed and of the screens listed above) before deploying, and
     again a few days after; written into the PR / a doc table.

## Constraints
- One PR; migration timestamp later than every migration on `main`; safe to run twice; pasteable in the SQL editor.
- Removing a table from the feed is reversible (`alter publication … add table`); the PR says how.

## Left to the builder
- The exact list of unused tables (from the code scan) and of filters per listener (each justified by the screen's own query).
- Whether a listener's scope (team / department) is available where the listener is created.

## Tests expected
- The unit guard (feed ↔ listeners in step).
- Browser / unit checks that the filtered listeners subscribe with the expected filter for a team member, a team lead and a company-wide
  viewer, and that `LeadStoreContext` no longer subscribes for someone who does not see inbound leads.
