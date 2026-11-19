# System Speed: Live Updates over Broadcast, and Faster Chat Loading: Design

Date: 2026-11-19. Status: approach chosen in conversation (B for every live screen, in three steps; plus the chat loading fix).
Replaces the phase A design (`2026-11-19-realtime-trim-and-filter-design.md`), dropped after measuring.

## Why (production numbers, read-only, 2026-11-19)
- **~75% of all database time is Supabase Realtime's change-feed poller** (`SELECT wal->>…`): 2.70 M calls, ~24,500 s, 9 ms each, spikes
  to 14 s. It polls the replication slot continuously **as long as any browser holds a `postgres_changes` subscription**, whatever the
  amount of change: the live tables changed only a few thousand times in the same period (notifications ~2,900, onboarding ~2,100,
  everything else hundreds or less). Trimming tables or filtering listeners (phase A) would not stop the polling.
- While the database is busy with it, normal calls that take 30–80 ms spike to 5–8 s, chat included: `chat_unread_summary` (12,900 calls,
  45 ms mean, 5.6 s max), `chat_internal_list` (94 ms, 6.3 s), `chat_client_tab` (204 ms, 7.6 s), `chat_message_receipts`,
  `chat_messages_page`, `chat_conversation_detail`, `chat_directory` (137 ms), plus `chat_key_status` / `chat_internal_mode` on many opens.
- Staff report that **chat takes too long to load**.

## Goals
1. **No `postgres_changes` subscription left anywhere** (staff app, client portal, candidate portal): every live screen gets a small
   "something changed for you" signal over **Realtime Broadcast** on a private channel, then reads its data from the API as today. With no
   change-feed subscriber left, the poller stops: most of the database load and the spikes go.
2. **Chat opens fast**: the chat page, the conversation list and a conversation each load with as few round trips as possible, in
   parallel where they must be separate, and no repeated "mode / key status" calls on every open.
3. Measured: before / after database snapshots (cumulative `pg_stat_statements` differences at known times; never reset in production),
   and a browser measurement of chat loading (number and timing of API calls) on the test stack before and after.

## Non-goals
- No change to what any screen shows, who may see what, or the API / database read functions' answers (except where a combined call
  replaces several for chat loading).
- Not removing Realtime itself; Broadcast stays on Supabase Realtime.

## Anti-goals (failure even if it "works")
- A screen that updated live stops updating, or gets updates it must not see. **A signal must never carry data**: only "this kind of thing
  changed" plus ids the receiver may already know; the screen still reads its data the same way as today (the API, or the direct read
  under row-level security where a screen does that today), so permissions are checked as today.
- A private channel someone else can join: channels are authorized by Realtime's RLS on `realtime.messages` (only the person / the members
  of the team, department or conversation the topic names).
- Sending a message, punching in or saving anything gets slower because of signalling (signals are sent by database triggers in the same
  transaction, cheaply, via `realtime.send` / `realtime.broadcast_changes`; never a network call from the API).

## Approaches considered
| | What | Trade-off |
|---|---|---|
| A (dropped) | Trim the 40-table feed, filter listeners. | Measured: the poller keeps running while any listener exists; little gain. |
| **B (chosen)** | Database triggers broadcast tiny signals to private topics (`user:<id>`, `conversation:<id>`, `team:<id>`, `department:<id>`, `customer:<id>`…); screens subscribe to their own topics. | Biggest gain (poller stops); touches every live screen, so three PRs. |
| C | Polling from the browser instead of live updates. | Simple, but more API and database load and slower updates; the opposite of the goal. |

## Design (decided)
- **Topics and who may join** (`realtime.messages` RLS, `private: true` channels): `user:<profile id>` (only that person),
  `conversation:<id>` (whoever `private.chat_access(id)` allows), `customer:<id>` (whoever may see that customer, as the API decides),
  `team:<id>` / `department:<id>` where a screen is scoped that way, `client:<customer id>` for the client portal (that client login).
  The exact topic per screen is decided per listener in the plan, matching what the screen shows today.
- **Signals**: one trigger per table that has a listener today, `after insert or update or delete`, sending `{ table, op, id }` (no other
  columns) to every topic that the row concerns. The browser side keeps today's behaviour (debounce, refetch on focus / after reconnect,
  hidden tab waits) through the existing shared helpers (`listenToTables`, `useChatLive`), whose internals change from `postgres_changes`
  to topic subscriptions.
- **Steps (one PR each)**
  1. Chat (list, unread badge, open conversation, receipts) and the bell (`notifications`), **plus the chat loading fix**.
  2. Leads (`crm_leads`), pipeline and onboarding tables, support, work tasks, reports (`work_report_signals`), field visits, approvals,
     HR, the client portal (`client_notifications`), the team-member store (`member_*`).
  3. Remove every table from the `supabase_realtime` publication (the change feed), the last `postgres_changes` code and its fallbacks;
     take the "after" measurements. A unit guard fails if any `postgres_changes` subscription reappears in `src/`.
- **Chat loading fix (in step 1)**: measure the calls made when the chat page and a conversation open; then remove repeated calls
  (`/chat/settings` mode and key status read once per session, not per open), run independent first calls in parallel, and combine the
  first screen's reads (list + unread counts + client-tab eligibility) where one database call can answer them. Targets: chat page shows the
  list after one round trip; a conversation shows its messages after one round trip.

## Decisions from the builder check (the author's calls)
- **Read receipts** (`src/lib/chat/receiptSignal.ts`, browser-sent Broadcast on the public topic `chat-receipts:<id>`, deliberately not a
  database write): move to the private `conversation:<id>` topic, still **sent by the browser** (an INSERT policy on `realtime.messages`
  lets the conversation's members send; no trigger on the receipt path). Old tabs keep using the public topic until step 3.
- **The project's "Allow public access" Realtime setting is left as it is**; private topics work regardless.
- **Chat mode and key status:** `/chat/settings` is already read once per page load. Key status checks stay as they are (cheap, and needed
  when a key changes on another device); in the STANDARD (company-readable) mode no key work runs when a conversation opens. The
  "one round trip" targets are for the STANDARD mode.
- **Measurements:** the production "before" snapshot was taken on 2026-11-19 08:44 UTC (change feed 2,698,036 calls / 24,512,647 ms;
  chat_unread_summary 12,783 / 576,486 ms; …); another snapshot is taken right before each deploy, and the "after" a few days after step 3.
  The browser measurement of chat loading runs on the local test stack (Vite + the API + PostgREST of `run-api.sh`) with Realtime stubbed,
  counting API calls and their order.
- **Tabs left open across a deploy:** step 1 adds a version check (the build id, compared on focus and every few hours) that reloads an
  idle staff tab after a deploy, so old `postgres_changes` subscriptions do not linger and keep the poller running.
- **Outside subscribers:** none found (the candidate portal is in this repo and uses no live updates; `server`, `worker`, `n8n`,
  `google-apps-script`, `scripts` checked). Step 3 samples `realtime.subscription` in production before removing the feed.
- **Leads:** on a signal the leads screen fetches the new lead the way it reads leads today (the direct table read under its row-level
  security); "reads its data as today" means the same read path, not a new API endpoint.

## Constraints
- Supabase Realtime Broadcast with private channels must be enabled for the project (Realtime settings: "Allow public access" off is
  fine); the plan checks the project's Realtime version supports `realtime.send` / `broadcast_changes` and RLS on `realtime.messages`.
- Migrations safe to run twice, pasteable in the SQL editor, timestamps after every migration on `main`.
- Each step works on its own: during steps 1–2 untouched screens keep their `postgres_changes` listeners.

## Left to the builder
- The topic for each listener and the trigger per table (matching today's visibility), the exact combined chat call, the debounce values.

## Tests expected
- Database: a signal reaches the right topics for each table and operation; RLS lets only the right people join each topic (own user
  topic yes, someone else's no; conversation member yes, outsider no; client of the customer yes, other client no).
- Browser: each converted screen updates when a signal arrives (stubbed Realtime), and never subscribes to `postgres_changes`; chat
  opens with the target number of round trips.
- The unit guard against `postgres_changes` (step 3).
