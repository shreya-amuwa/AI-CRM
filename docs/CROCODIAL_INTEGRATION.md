# Crocodial integration (read-only connector)

Crocodial (`app.crocodial.app`) is the calling CRM the Sales staff use to call and follow up leads. This integration reads its Outbound API into the
AI-CRM, so each employee and their managers can see that work next to their CRM work.

- **Design:** `docs/superpowers/specs/2026-11-19-crocodial-integration-design.md`
- **API guide:** Crocodial's *Outbound API* guide (Setup → Outbound API)

It is delivered in parts:

| Part | What | Status |
| --- | --- | --- |
| 1 | Configuration and identity (rollout, connections, department links, approved employee mappings, Super Admin page, connection test) | pull request #246 |
| 2 | Read-only sync of leads, call logs, follow-ups and remarks (rate-limited, paged, checkpointed, reconciled) | pull request #247 |
| 3 | "My Crocodial Activity" on the employee's own dashboard | pull request #249 |
| 4 | Team Lead / Department Head / Operations Head / Super Admin pilot views | this pull request |

## Pilot: M Pillar Sales, two people

- **Rollout.** The migration allows exactly one department and function: **M Pillar · Sales**. No other department can be linked until the Super Admin allows it (rollout).
- **Accounts.** The live check on 2026-11-19 found **one** Crocodial account, "M pillar corporation", with branch 121 and 5 users. One connection (one token) serves the pilot. Its users are:
  - Supriya Mpillar (Crocodial id 371);
  - sachin (4138);
  - Vanshika (4193);
  - snehal (4194);
  - prachii (4195).
- **Only approved people are switched on.** Only the people the Super Admin maps and approves count. The pilot is Sachin and Supriya. The other three are never shown or counted unless they are approved later.

## Who does what

| Step | Who | Where |
| --- | --- | --- |
| Allow a department + function (rollout) | Super Admin | Crocodial Integration > 1. Rollout |
| Add a connection (one Crocodial account) | Super Admin | > 2. Connections |
| Put the token on the server | Whoever deploys | the server's environment (see below) |
| Test the connection (reads the user and branch lists only) | Super Admin | > Test connection |
| Link the connection to M Pillar Sales; switch it on | Super Admin | > 3. Departments |
| Map a Crocodial user to one CRM employee, check, approve or revoke | Super Admin | > 4. People |

The database enforces each step (`croc_*` functions in `20270115000100_crocodial_integration.sql`). Department Heads and everyone else get `FORBIDDEN`.

**When a person's activity counts.** All of these must hold at the time of the activity:
1. the connection is on;
2. its link to the person's department + Sales is on;
3. the rollout allows that department;
4. the person's mapping is approved and in effect;
5. the person is active.

**Mapping rules.**
- Switching a department on switches nobody on.
- A mapping is only possible for an active member of that department's Sales (team division SALES, or that department's Sales head).
- One Crocodial user maps to one person, and one person to one Crocodial user, per account.
- Revoking ends the mapping: activity before the end stays the person's, nothing after it does. The CRM profile, role and team are never changed.

## Who sees a person's Crocodial activity

| Viewer | Sees |
| --- | --- |
| The person | Their own only. |
| Team Lead | Only the people they lead (`private.led_by`), not another Team Lead's people in the same team. |
| Department Head / Operations Head | People in departments + Sales their scope covers (`private.scopes_of`). Support-only heads and other departments see nothing. |
| Super Admin | Everything, plus configuration. |
| Anyone else / no login | Nothing. |

This is `private.croc_can_view(profile, department, division)`. The screens in parts 3 and 4 read only through functions that call it.

## The token (environment secret)

1. **Create the token.** In Crocodial, go to **Setup → Outbound API**, create a token, and keep **Allow changes OFF**. The CRM only reads.
2. **Put it on the server.** Add it to the server's environment under a name starting with `CROCODIAL_TOKEN_`, for example `CROCODIAL_TOKEN_MPILLAR`. Use Vercel → Settings → Environment Variables, and the Worker secrets if the API runs there. Redeploy.
3. **Name it in the CRM.** In the CRM, add the connection with **that name**. The CRM stores only the name, and shows whether the server has it ("set on the server"). The value never reaches the browser, the database, the logs or the repository.
4. **If the token is ever exposed** (pasted into a chat, an e-mail or a ticket): regenerate it in Crocodial, which ends the old one immediately, and update the server setting.

## How the client talks to Crocodial (`server/crocodial/client.ts`)

- **Requests.** GET only, to `https://app.crocodial.app/api/datalake/outbound`. The token goes in the `Authorization: Bearer` header only.
- **Rate.** At most one request every 1.2 s per client (50 a minute, under Crocodial's 60).
  - On `429` it waits 60 s, at most twice, then stops with "rate limited".
  - Network errors and 5xx are retried twice with back-off.
  - Timeout: 30 s.
- **Paging.** Pages of 500 rows. `next_page_url` is followed only when all of these hold:
  - same origin and path;
  - https;
  - the next page number;
  - no `token` in the address.
- **Validation.** Every row is checked. A row that does not match is skipped and counted.
- **Errors become health states:**
  - `401`: token refused;
  - `403`: token turned off in Crocodial;
  - missing setting: "token setting missing on the server".
- **What the connection test keeps.** It reads `/employees` and `/branches` only, and keeps names, active flags and branch ids. Phone numbers and e-mails are dropped.

## Sync (part 2, `server/crocodial/sync.ts`, migration `20270115000200_crocodial_sync.sql`)

**What syncs, and when**
- **Which connections.** Only connections that are **on** and serve an **on** link of a **rolled-out** department (`croc_sync_due`). Anything else is never contacted.
- **When it runs.**
  - Scheduled runs sync each such connection at most every `CROCODIAL_SYNC_EVERY_MINUTES` (default 60), with a 15 s budget per run and at most 10 pages per list (see "How often it runs" below).
  - The Super Admin's **Sync now** runs at most once every 5 minutes per connection, with a 20 s budget.

**What one run does**
1. Refreshes the account's user list, so new Crocodial users appear for mapping.
2. Reads **leads, call logs, follow-ups and remarks**, each on its own: one failing resource does not stop or move the others. A refused or turned-off token stops the connection.

**How each resource is read**
- **One run at a time.** A lease (10 minutes) keeps two runs from reading the same resource.
- **What is asked for:**
  - a **full pull** the first time, and weekly only when the Super Admin presses **Sync now** (scheduled runs never re-read everything);
  - otherwise rows changed since the **checkpoint** (`updated_since`).
- **Storing.** Every page is stored as it arrives. A pull that runs out of time **resumes from its next page** on the next run. The first full pull of a large account therefore completes over a few runs.
- **The checkpoint** moves only after a resource was read to the end. It moves to that pull's start time minus a 10-minute overlap.
- **Duplicates.** Rows are upserted on (connection, Crocodial id): a row read twice is updated, never duplicated, and two accounts never mix.
- **Deletions.** A full pull marks rows Crocodial no longer returns as **missing**. Nothing is deleted.

**What is kept**
- **Leads:** name, phone, company, city, status, source, **assigned_to id**, created_by id, called, outcome, next follow-up, last interaction, and created/updated times.
- **Calls:** **called_by id**, lead id, phone, contact name, type, time, duration, connected.
- **Follow-ups:** **created_by id**, lead id, phone, note, due time, done, completed time.
- **Remarks:** **written_by id**, lead id, phone, text.

**Not kept:** e-mail, budget, deal value, custom fields, raw number, SIM, location, spam flag, recordings.

**Who a record belongs to.** `private.croc_person_at(connection, Crocodial user, time)` gives the CRM person whose approved mapping was in effect at the record's time. Re-mapping a Crocodial user never rewrites past calls. Records of a Crocodial user without an approved mapping are **not attributed to anyone**. They are kept, shown to the Super Admin as unmatched (by Crocodial user), and never counted.

**Super Admin page, "5. Sync":**
- for each resource: the last complete read, rows, and state (up to date / first read in progress / error);
- what is stored, and what is missing;
- what is not attributed;
- a warning when the last complete read is older than 24 hours.

**Live check (2026-11-19, M Pillar account, local test database only, removed afterwards):**
- **First run:** everything was read to the end in **42 requests / 48 s**: **234 leads, 18,387 call logs, 162 follow-ups, 212 remarks**, 0 unreadable rows.
- **Second (incremental) run:** 6 requests, nothing duplicated.
- **Calls by Crocodial user:**

  | Crocodial user | Who | Calls |
  | --- | --- | --- |
  | 371 | Supriya | 5,013 |
  | 4138 | sachin | 2,066 |
  | 4193 | Vanshika | 1,715 |
  | 4194 | snehal | 689 |
  | 4195 | prachii | 3,190 |
  | **340** | not in the account's user list (probably the account owner's own login) | **5,714** |

  Calls of 340, and of anyone not approved, stay unattributed until the Super Admin decides otherwise.


**Timing (migration `20270115000500`, Cloudflare):**
- **The 5-minute cron** (the attendance reminders' cron) calls `/internal/crocodial/sync` on its ticks every `CROCODIAL_SYNC_EVERY_MINUTES` (default 60, so once an hour; it was every 5 minutes, then 15). A read still in progress continues on those runs, at most 10 pages per list each time. This needs `SCHEDULED_ENABLED=true` and the dispatch secret, as for every scheduled run.
- **Sync now:** reads for up to 50 s with no page cap (a full read finishes in one press), and can be used again after 1 minute (it was 5).
- **Reading order:** leads → follow-ups → remarks → call logs. The small lists finish first, and the large call log can never hold them back.
- **Previously:** the sync only continued with the twice-daily automation run or Sync now (20 s, then 5 minutes to wait). The first read of the M Pillar account (about 40 pages) therefore looked stuck, showing "not available yet (not synced)".

## My Crocodial Activity (part 3, `public.croc_activity`, migration `20270115000300_crocodial_activity.sql`)

**Where it appears.** A section on the dashboard the person already has:

| Dashboard | What it shows |
| --- | --- |
| Telecaller Home | Calls and follow-ups |
| Business Associate Home | The same, plus demo counts **from the CRM demo schedule** |
| Team member Home | Calls and follow-ups |

**When it appears.** Only for a person whose mapping is approved and switched on (`croc_my_status`); for everyone else nothing is shown. No role, permission or dashboard changes.

**Section contents:**
- a period filter: today, 7 days, 30 days, or custom (at most 93 days);
- the source and last-sync label;
- figure cards;
- recent calls (last 4 digits of the number only);
- open follow-ups.

**Who can read it.** `GET /crocodial/activity` (optionally `?profileId=` for part 4) calls `croc_activity`. It answers for the caller, or for a person the caller may see (`private.croc_can_view`). Any other id gets 404.

**Formulas.** Days are in the account's time zone, both ends included. A record counts only through the approved mapping in effect at its time.

| Figure | How it is counted |
| --- | --- |
| Calls made | Outgoing calls by the person |
| Connected | Of those, `connected = true` |
| Connect rate | connected ÷ calls made ("—" when there are no calls made) |
| Talk time | Duration of the connected outgoing calls |
| Incoming / missed | Calls of that type, counted apart |
| Unique leads contacted | Distinct Crocodial leads of the outgoing calls (a call without a lead is not counted here) |
| Follow-ups scheduled | Created by the person, due in the period |
| Completed | Of those, done |
| Completion | completed ÷ scheduled |
| Overdue | Created by the person, not done, due before now (any date) |
| My Crocodial leads | Leads Crocodial shows as assigned to the person now. This is not the CRM owner, and nothing is copied into the CRM pipeline. |
| Demos scheduled (CRM `ba_demos`, assigned to the person) | Starting in the period and not cancelled |
| Demos completed | Of those, COMPLETED |
| Demos cancelled | Shown apart |
| Upcoming demos | From now, SCHEDULED or RESCHEDULED |

A rescheduled demo is one record, counted once. Demos are never derived from Crocodial remarks or statuses.

**States:**
- **No approved mapping:** "switched off". Nothing is shown.
- **Never fully synced:** "not available", with no figures, never zeros.
- **Last complete sync older than 24 hours:** figures are shown with a "not current" label.
- **Crocodial activity is kept apart** from the task-performance scores.

**Live check (2026-11-19, local test database, removed afterwards).** Crocodial user 4138 was mapped to one test person and 371 to another, over the last 30 days. `croc_activity` matched a direct count of the stored calls exactly, in 9 to 42 ms:

| Crocodial user | Calls made | Connected | Connect rate | Talk time |
| --- | --- | --- | --- | --- |
| 4138 | 19 | 8 | 42.1% | 424 s |
| 371 | 954 | 534 | 56% | 49,675 s |

## Management view (part 4, `public.croc_team_activity`, migration `20270115000400_crocodial_team_activity.sql`)

**Who sees what.** A **Crocodial Activity** page in the existing dashboards, inside the existing reporting hierarchy:

| Dashboard | People listed |
| --- | --- |
| Team Lead | Only the connected people they lead (`private.led_by`), never another Team Lead's people in the same team |
| Sales Department Head and Sales Operations Head (the Sales head dashboard) | The connected people of every department + Sales their scope covers (`private.scopes_of`). A Support-only head, or a head of other departments, sees nobody. |
| Super Admin | Everyone, under Automations → Crocodial Activity |
| An employee | Nobody else |

For Team Leads and heads, the entry appears only when they have at least one connected person. The database decides who is listed (`croc_team_activity`, built on `croc_can_view`). Drilling down into a person opens their activity through `croc_activity`, which checks the caller again.

**What the page shows:**
- **The label** "Crocodial Pilot — N connected employees", and a note that the totals cover only the connected employees listed, never the whole department.
- **Totals:** calls made, connected and connect rate (from the totals), talk time, follow-ups completed / scheduled and overdue, CRM demos completed / scheduled.
- **A calls-per-day chart.**
- **One row per person**, with the same figures as their own view, and Open to see their activity.
- **A breakdown by team**, and a team filter when there are several teams.

**Rules:**
- **Same formulas** as "My Crocodial Activity".
- **Not synced yet:** a person who has never been fully synced is listed as "not available yet" and **left out of the totals**, never counted as zero.
- **Stale data:** data older than 24 hours is labelled.

## Earlier activity and the heads' view (migration `20270116000300_crocodial_count_from.sql`)

**Counting earlier activity.** Approving a mapping counts activity from that moment. Everything the sync stored before it (calls,
follow-ups, remarks) counted for nobody. Under "4. People", each approved mapping now shows "Counting activity from <date>" with two actions:

- **Count all past activity.** The mapping counts from the start of the day of the first record stored for that Crocodial user.
- **Or from a date, then "Use this date".** The mapping counts from the start of that day, in the account's time zone. A future date is refused.

How it works and what is checked:

- Both actions call `public.croc_mapping_count_from(mapping, from | null)`. Only the Super Admin can use it.
- It works only on an approved mapping that is in effect.
- The new period may not overlap another mapping of the same Crocodial user, or of the same CRM person, on that account. If it does, the
  change is refused and the message names that mapping. This way one record never counts for two people.
- Every change is audited as `CROCODIAL_MAPPING_COUNT_FROM_SET`, with the previous and the new date. The History list shows it as
  "activity start date changed".
- Nothing is fetched again: the data is already stored, and the figures change as soon as the date does.

Use it only when nobody else used that Crocodial login before the person.

**Periods.** Both activity views also offer "Last 90 days". Any period of up to 93 days can still be chosen with the date fields.

**Department Heads and Team Leads.**

- Their side panel has a **Crocodial** section:
  - For a Team Lead it is a labelled section.
  - For a Department Head it is an entry that opens to its pages.
- The section shows only what applies:
  - **My Crocodial Activity** and **My Crocodial Leads**, when they are connected themselves.
  - **Team Crocodial Activity**, when they oversee connected people. This is the management view.
- It is hidden when nothing applies.
- In the management view, a Department Head (who sits above teams) is shown as "Department Head (above teams)" instead of "—".
- In "By team", Department Heads are grouped as "Department Head(s)" instead of "No team".
- The Super Admin's "Crocodial Activity" lists every connected person, heads included.

## My Crocodial Leads (migration `20270116000400_crocodial_leads.sql`)

`public.croc_leads(profile | null, search, filter, page, page_size)` returns, one page at a time, the leads that Crocodial currently assigns to
the person's mapped Crocodial user on that account. The data is the stored copy from the sync. Leads are never matched by name and never
come from another account.

- **Who can see them.** The same people as `croc_activity`: the person, their own Team Lead, the heads whose scope covers that department's
  Sales, and the Super Admin. Anyone else gets "not found".
- **Filters.** All, Follow-up due (next follow-up before now), and Never called. Each filter shows its count.
- **Search.** By name, company, city or status, or by at least 4 digits of the phone number.
- **Order.** Due follow-ups first, then upcoming ones, then the most recently worked leads.
- **Each lead shows:**
  - the masked phone number (last 4 digits);
  - the status, with "never called" marked;
  - how many times the person called that lead;
  - the next follow-up, with "(due)" marked;
  - the last activity.
- **Where it shows.**
  - "My Crocodial Leads" in the Crocodial section of the side panel of Team Leads and Department Heads.
  - Below "My Crocodial Activity" on the home page of Telecallers, Business Associates and team members. There it appears only for a
    person who is connected, and it shows nothing at all (not even an error) otherwise.
- It is read-only. Calling and updating leads still happens in the Crocodial app.

## Field mapping and the Sales dashboards (migration `20270117000200_crocodial_field_alignment.sql`)

**The source of truth** is the sync itself (`server/crocodial/sync.ts`, which validates every row Crocodial sends) and the tables it fills.
Crocodial is read by **polling** its Outbound API. There are **no webhooks**: nothing pushes events into the CRM. Repeated reads cannot
duplicate a record, because every row is stored once per (connection, Crocodial id) and updated in place. A row Crocodial stops returning is
marked missing and left out of the figures; nothing is deleted. **Crocodial has no demo data.** Demo figures always come from the CRM demo
schedule (`ba_demos`).

**One field map:** `shared/crocodialFields.ts`. It lists every field Crocodial sends, the key the sync stores it under, the CRM column, its
type, and what it is used for. A unit test checks that the sync stores exactly these fields and that every column exists in its table.

| Crocodial (call-logs) | CRM column (`crocodial_ext_calls`) | Type | Used for |
| --- | --- | --- | --- |
| `id` | `external_id` | id | the record; with the connection, it is the key that stops duplicates |
| `called_by.id` | `called_by_ext` | id | **employee:** the CRM person is the one whose approved mapping (`crocodial_employee_mappings`) was in effect at `call_at`. Never matched by name. |
| `lead.id` | `lead_ext` | id | **lead:** the Crocodial lead (`crocodial_ext_leads` of the same connection). Never matched to CRM leads. |
| `phone_number` | `phone_number` | phone | unique numbers (digits only, the last 10); shown masked to the last 4 digits |
| `contact_name` | `contact_name` | text | the contact shown, else the Crocodial lead's name |
| `call_type` | `call_type` | enum: incoming, outgoing, missed, voicemail, rejected, blocked, answered_elsewhere, unknown | **status:** shown as Incoming, Outgoing, Missed, … |
| `call_at` | `call_at` | timestamptz | **date/time:** shown in the account's time zone; periods are days of that zone |
| `duration_seconds` | `duration_seconds` | integer | duration of a connected call; talk time |
| `connected` | `connected` | boolean | **status:** Connected (true), Not connected (false), **Not reported** (empty: never shown as "not connected") |
| `synced_at` | `external_synced_at` | timestamptz | stored only |

Leads, follow-ups and remarks are mapped the same way: their `assigned_to.id` / `created_by.id` / `written_by.id` go through the mapping, and
`lead.id` goes to the Crocodial lead. The full lists are in the file.

**One formula.** These database helpers compute the figures:

- `private.croc_person_calls`: the calls attributed to a person;
- `private.croc_call_summary`: the call figures;
- `private.croc_demo_summary`: the CRM demo figures;
- `private.croc_person_state`: whether the person is connected and synced.

Every Sales screen uses them: "My Crocodial Activity", the management view, and the Sales head's Telecaller and Business Associate sections.
The same person therefore shows the same numbers everywhere.

| Call figure | Counted as |
| --- | --- |
| Total calls | outgoing calls |
| Connected | outgoing, connected = true |
| Not connected | outgoing, connected = false. An outgoing call whose `connected` is empty is in neither. |
| Unique numbers | distinct numbers called (outgoing); `+91 98…`, `098…` and `98…` are one number |
| Talk time | duration of the connected outgoing calls |
| (connect rate) | connected ÷ total calls, shown under Connected |

**Not counted twice.** The management view's totals used to add up each person's "unique leads", so a lead two people called counted twice.
Unique leads and unique numbers are now counted once across the people listed.

**Every field on the Sales dashboards, classified.** 1 = from Crocodial, 2 = from CRM records, 3 = required by the Sales workflow,
4 = unnecessary or unsupported (removed).

| Screen | Field | Class | Now |
| --- | --- | --- | --- |
| Crocodial activity (Telecaller, Business Associate and Sales member Home; Team Lead and head "My Crocodial Activity") | Total calls, Connected (+ rate), Not connected, Unique numbers, Talk time | 1 | shown, the shared five |
| | Recent calls: contact, masked number, type, status, duration, date and time | 1 | shown; an empty "connected" now reads "Not reported" (it said "not connected") |
| | Open follow-ups (Crocodial follow-ups, with overdue marked) | 1, 3 | shown |
| | Demos scheduled / completed / upcoming / cancelled (Business Associates) | 2 | shown, labelled "from the CRM demo schedule" |
| | Unique leads contacted | 1 | removed from the cards (unique numbers replaces it; still in the data) |
| | Incoming / missed | 1 | removed from the cards (the recent calls show each call's type) |
| | Follow-ups scheduled / completed / completion %, overdue follow-ups | 1 | removed: counters on top of the open follow-up list |
| | My Crocodial leads (assigned, never called) | 1 | removed: it duplicated the "My Crocodial Leads" section just below it |
| Crocodial management view (Team Lead, heads, Super Admin) | Total calls, Connected, Not connected, Rate, Unique numbers, Talk time | 1 | shown, per person and in total |
| | Demos (CRM) completed / scheduled | 2 | shown |
| | Unique leads, follow-ups, overdue | 1 | removed from the table and the totals |
| Sales head › Telecaller List and dashboard | the five call figures, connect rate, the call log | 1 | shown (none for a person not connected: "Not connected to Crocodial") |
| | Leads created, Converted to a Business Associate, the leads list | 2, 3 | shown |
| | Calls logged, contacts called, reached, not reached yet, unique numbers, reach rate (all from the CRM contact sheets) | 4 | removed: CRM sheet counters presented as call figures |
| | Interested / not interested, follow-ups due / overdue, contacts assigned, conversion rate | 4 | removed: duplicates of the Telecaller's own workflow pages |
| Sales head › Business Associate List and dashboard | the five call figures and the call log (when connected) | 1 | shown |
| | Leads assigned, demos scheduled / completed / upcoming / cancelled, final quotations (once per quotation), deals closed, deal value | 2, 3 | shown; demos counted exactly as in their own view |
| | Leads worked, open contacts, clients met in a demo, quotation value, revenue received, deals pending, conversion rate, activity timeline | 4 | removed |

**Not changed:** the Telecaller's own Home counters (assigned contacts, calls pending / completed, leads, follow-ups due). These are the
statuses of the CRM contact sheets the Telecaller works through, and they are not labelled as Crocodial. Also unchanged: lead management,
assignments, follow-ups, field visits, the sync, mapping and permissions. **Sales Executive and Business Partner dashboards** do not exist
yet (phase 2). When they are built, they will read calls and demos only through the same helpers.

## How often it runs, and what it writes (migration `20270129000100_crocodial_sync_quiet.sql`)
- **Once an hour by default** (`CROCODIAL_SYNC_EVERY_MINUTES`, Worker variable: 5, 10, 15, 20, 30 or 60; `0`/`off` = only Sync now). The same
  setting decides when a connection is due in the daily automations run, so the two agree.
- **Only changes are written.** A top-up run reads what changed since the last run (10 minutes of overlap) and writes a new version only of
  records whose values differ; a record seen again unchanged gets no new row version (Postgres still takes a brief row lock). Before this, every
  record read was rewritten, which used up Supabase's disk I/O budget. The "Rows" figures of a run now count records changed, not records read:
  an up-to-date run shows 0.
- **At most 10 pages (5,000 records) per list per scheduled run**, within the 15-second budget; a longer read continues on the next run.
  **Sync now** has no page cap (only its 50 s budget), so a full read the Super Admin starts finishes in one press.
- **No automatic full re-read.** The very first pull of a connection reads everything. After that, scheduled runs only top up; the weekly full
  re-read (which marks records Crocodial no longer returns as missing) happens when the Super Admin presses **Sync now**.
- To check: `crocodial_sync_runs` (one row per list per run: pages, rows, full or not) and Supabase → Reports → Disk IO.

## Migration to run (Supabase SQL editor)

- `supabase/migrations/20270115000100_crocodial_integration.sql`, then `20270115000200_crocodial_sync.sql`, then `20270115000300_crocodial_activity.sql`, then `20270115000400_crocodial_team_activity.sql`, then `20270115000500_crocodial_sync_now_minute.sql`, then `20270116000300_crocodial_count_from.sql`, then `20270116000400_crocodial_leads.sql`, then `20270117000200_crocodial_field_alignment.sql`, then `20270129000100_crocodial_sync_quiet.sql`
  - Run them after every earlier migration.
  - It is additive and safe to run twice.
  - It adds the tables (RLS on, no grants), the `croc_*` functions, and the M Pillar Sales rollout row.
  - Before it runs, nothing changes. After it, nothing is switched on until the Super Admin does the steps above.

## Rollout steps (pilot)

1. Run the migration.
2. Add `CROCODIAL_TOKEN_MPILLAR` to the server environment, with a token whose "Allow changes" is off. Redeploy.
3. Open Super Admin > Crocodial Integration and add the connection:
   - name "M Pillar";
   - account "M pillar corporation";
   - setting `CROCODIAL_TOKEN_MPILLAR`.
4. Click **Test connection**. Expect "Connected. 5 employees and 1 branches read".
5. Click **Link (stays off)** for M Pillar · Sales.
6. Under People, map and approve each person:
   1. pick "sachin (id 4138)" and the CRM account of Sachin;
   2. check the department, team and role shown;
   3. confirm in Crocodial that this user really is that person;
   4. propose, then approve;
   5. do the same for "Supriya Mpillar (id 371)".
7. Switch the connection **on** and the M Pillar Sales link **on**. Parts 2 to 4 then sync and show the activity.

## Rollback

- **Pause.** Rollout → **Pause**. This switches the department link off. Nobody's data is shown or synced, and nothing is deleted.
- **Stop calling Crocodial.** Switch the connection off, or remove the server setting. The connection then reports "token setting missing".
- **Database.** The migration only adds tables and functions. No existing table, function or data is changed.
