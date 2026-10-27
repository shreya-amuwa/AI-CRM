# Database cost audit - Amuwa AI CRM

*Audit date: 26 Oct 2026. Branch `claude/ai-crm-supabase-backend-kog2gh`. Nothing in production was read or changed; no migration was created and no provider was switched.*

**Bottom line.** The database is not what makes this system expensive, and moving it would not make it meaningfully cheaper. At the workload a CRM of this size is expected to have, the running cost is the Supabase Pro base price (about **USD 25-30 / month**). A migration to Neon or another managed PostgreSQL would save at most a few dollars a month on the database line while forcing us to replace Supabase Auth, Realtime and the PostgREST/RLS access layer that 110 migrations and the whole API are built on (weeks of work, new security risk). **Do not migrate.** The real cost risks are different and cheap to fix: browser screens that re-download large lists on every Realtime event (the first thing that would push egress and compute up as staff grow), a few write-heavy indexes, unbounded history tables, and no backup beyond the provider's. A prioritised plan is at the end.

## 0. How to read this report
* **VERIFIED** = measured from the repository, or from a scratch PostgreSQL built from all 110 migrations (schema facts, row widths on test data). Reproducible.
* **ESTIMATE** = depends on live usage, which I cannot see from here (no access to the production database, Supabase dashboard or R2). Every estimate states its assumption.
* **Run `supabase/maintenance/usage_report.sql`** (read-only, sizes and counts only, no customer data) in the Supabase SQL editor and send back the results; that turns the estimates below into measurements.
* Prices are from public pricing pages and third-party guides retrieved this month; they change, and the Supabase and Neon figures should be confirmed on their pricing pages before a decision (sources at the end).

## 1. Current database usage report

### 1.1 What exists (VERIFIED, from the migrations)
| Item | Count |
|---|---|
| Tables (public) | 108 |
| Indexes (public) | 316 (2.7 MB of the 18 MB empty-schema size; every index costs a write on every insert/update of its table) |
| Public functions (RPC) / private helper functions | 387 / 344 |
| RLS policies | 113 |
| Triggers | 102 |
| JSONB columns | 40 |
| bytea (binary) columns | **0** - no file contents in PostgreSQL |
| Tables in the Realtime publication | 29 |
| Migrations / lines of SQL | 110 / 38,691 |

Empty-schema database size (all migrations applied, seed data only): **18 MB**. Real size is therefore driven entirely by data growth below.

### 1.2 Largest space consumers
* **Measured:** not possible without production access. Run block 2 of `usage_report.sql`.
* **VERIFIED row widths** (scratch DB with test data; heap bytes/row incl. no TOAST): `audit_logs` ~360 B + **9 indexes**, `notifications` ~300 B, `customer_activities` ~165 B, `customers` ~560 B, `customer_documents` ~455 B. The audit log is the table with the most index overhead (9 indexes, roughly 2x its heap).
* **ESTIMATE of where space will accumulate** (tables that only grow): `audit_logs` (immutable by design: the database refuses deletes), `notifications`, `chat_messages`, `customer_activities`, `automation_jobs`, `hr_email_events`, `subscription_reminder_events`, `support_ticket_updates`, `crm_leads.raw_payload`. At 2,000-5,000 audit rows a day (60 staff, an assumption) the audit log grows about 0.5-1.5 GB a year including indexes.
* **Plan allowance:** Supabase Pro includes 8 GB of database disk per project. On that estimate the database stays under the allowance for several years; disk is **not** the cost driver.

### 1.3 Files and large values
* **VERIFIED: no file content in PostgreSQL.** `customer_documents` holds metadata only (`storage_provider`, `storage_ref`, `storage_path`, `storage_etag`, `size_bytes`, MIME type); files go to Cloudflare R2 (Supabase Storage as the fallback driver). No `bytea`, no base64 columns. `avatar_url` is capped at 1,000 characters.
* **VERIFIED: text columns that can grow are bounded** (chat body 4,000, notification body 2,000, activity note 5,000, ticket update note 4,000, lead notes 4,000). `field_visits.details` is capped at 64 KB.
* **VERIFIED: 30 of the 40 JSONB columns have no size cap.** The ones that can be large: `crm_leads.raw_payload` (the whole inbound webhook body; the code replaces a body over `MAX_RAW_BYTES` with a stub, so this one is guarded in code but not in the database), `automation_jobs.context`, `hr_email_events.payload`, `audit_logs.metadata` (average 137 B on test data, scrubbed by a trigger), `notifications.data`, `performance_reports.*`, `ba_quotations.*`. On test data the averages are small (20-400 B); check block 5 of the report on production.
* **Recommendation:** add `pg_column_size(...) <= N` CHECKs only after block 5 shows real maxima.

### 1.4 Queries, pagination, egress, Realtime (VERIFIED from code)
| Finding | Where | Why it costs |
|---|---|---|
| Server list endpoints are paginated and capped at 100 rows | `shared/validation.ts` `pageParams` | Good. 8 lists use `count: 'exact'` (an extra count over the filtered set on every page); fine at this size, watch for the largest tables (`customers`, `notifications`, `audit_logs`). |
| **Browser screens re-download whole lists on every Realtime event** | `src/lib/support.ts` `useTickets` (up to 1,000 tickets with `select('*')` + up to 5,000 updates with `select('*')` + customer lookup + read markers), `workTasks.ts` (1,000 tasks + 2,000 updates), `teamLead.ts`, `teamMemberStore.ts` | One change to one ticket makes **every open screen of everyone who can see that table** re-read up to ~6,000 rows. Egress and database CPU scale with (people online) x (changes per day) x (list size). This is the single biggest cost risk. |
| **Each ticket reload also calls a write RPC** | `useTickets.reload` calls `escalate_overdue_tickets` first | A write function (the database also runs it on its own schedule) is executed by every viewer on every event. |
| Five separate Realtime channels on `support_tickets`, three on `customers`, each unfiltered and each re-fetching | `useRealtime(...)` x16 (`support_tickets` 5, `customers` 3, others 1 each) | Every channel receives every event the user's RLS allows (Realtime checks RLS per subscriber per event) and triggers its own reload; one table change = several refetches. |
| Chat channels are unfiltered on `chat_conversations` and `chat_members` | `src/lib/chat/useChatLive.ts` | Every membership/conversation change goes to every connected user, then RLS-filtered. |
| Notifications channel is filtered to the recipient | `NotificationContext.tsx` | Good pattern; the others should follow it. |
| `select('*')` in 13 places | support, tasks, team lead, lead store, field visits | Returns every column (including JSON) where a few are used. |
| One tiny upsert per API request for rate limiting | `rate_limit_consume` inside `api_session` | **Correction (second review):** `private.rate_limit_counters` is an **UNLOGGED** table (no WAL) holding a few rows, and it is deliberately in Postgres because serverless instances share no memory. It costs almost nothing; leave it as it is. |
| Browser polling of an external webhook every 30 s per open Wabastore tab (and 5 s when "auto sync" is on) | `WabastorePanel.tsx`, `WabastoreWebhookLiveBar.tsx` | This hits the webhook provider, not the database, but it is steady background traffic per tab; the 5 s loop should be off by default. |
| Daily Vercel cron (2 runs) for automations | `vercel.json` | Negligible. |

**Estimate of the egress risk** (assumption: 10 people have the tickets screen open, 100 bursts of ticket changes a day, each reload returns 2 MB): 10 x 100 x 2 MB = 2 GB/day = **~60 GB/month**, against 250 GB included on Pro. At 30 viewers, 300 bursts and 4 MB it is ~1 TB/month (about USD 70 overage at the quoted USD 0.09/GB). The risk is real but only appears with growth; it is also the cheapest thing to fix.

### 1.5 Indexes (VERIFIED from the schema; usage needs production statistics)
* **Exact duplicate indexes (2):** `chat_messages_conversation_id_seq_key` = `chat_messages_history_idx`; `customer_documents_customer_id_document_type_version_key` = `customer_documents_customer_idx`. In both cases a UNIQUE constraint already provides the same index, so the second one only costs space and write time. Removing a plain index (never a constraint) is a safe cost saving - but it is a migration, so it waits for approval.
* **Prefix-redundant indexes:** none found.
* **Foreign keys with no supporting index: 134.** Most are "who did it" columns (`created_by`, `*_by`) that are never filtered on: leave them, an index on each would add write cost for nothing. The ones that matter are columns used to filter or join on busy tables, e.g. `addon_payments.customer_id`, `invoice_payments.customer_id`, `support_ticket_attachments.customer_id`, `work_tasks.team_id`, `telecaller_contacts.team_id/department_id`, `ba_contacts.department_id/team_id/telecaller_id`, `notifications.actor_id`, `customer_activities.actor_id`. Deleting a person scans each referencing table without such an index. Decide **only** after `pg_stat_statements` and block 3 show real use.
* **Unused indexes:** cannot be determined from the repository. Block 3 lists indexes with 0 scans; judge them over at least 30 days of normal use. `audit_logs` carries 9 indexes (the cost of an audit row is mostly index maintenance): its two partial indexes (`outcome`, `request_id`) and the team/department ones are the first to check.

### 1.6 Backup and recovery (VERIFIED from the repository; provider settings need your confirmation)
* The repository contains **no backup automation**: no `pg_dump`, no scheduled export, no restore drill, no document-bucket backup. Docs only say "take a backup in the Supabase dashboard" before destructive scripts.
* Supabase Pro keeps **daily backups for 7 days**. **Point-in-Time Recovery** is a paid add-on (about USD 100 / month for 7 days' retention; billed hourly). Free-plan projects have no such backups - **confirm which plan production is on.**
* **Gaps:** (1) no recovery to a specific minute (financial records: payments, invoices, attribution) unless PITR is bought; (2) a provider-level failure or account problem has no independent copy; (3) R2 documents have no documented backup/versioning or restore procedure (confirm the bucket's settings); (4) the audit log cannot be purged by design, so there is no archive path either; (5) no tested restore.

### 1.7 Security finding found during the audit (not a cost item)
`src/components/departments/wabastore/WabastorePanel.tsx` (lines ~57-188, ~251, ~293, ~842, ~894) contains **hard-coded webhook secrets / API tokens in source code**, which is committed to git and shipped to every browser. I have not copied them here. They should be treated as exposed: rotate them with the webhook provider and move them to server-side configuration. This is higher priority than any cost item.

## 2. Estimated monthly cost - current setup (Supabase)
Assumptions (ESTIMATE; replace with `usage_report.sql` results): ~60 staff users and a few thousand client logins (well under 100,000 MAU), database under 2 GB, egress 10-60 GB, Realtime under 5 M messages.

| Line | Included on Pro | Expected | Notes |
|---|---|---|---|
| Pro plan | USD 25 / org | **25** | includes a USD 10 compute credit = one Micro instance |
| Compute | Micro covered by the credit | 0 (Micro) / ~5 (Small, 2 GB RAM) / ~50 (Medium) | the cost jumps only if the working set no longer fits in memory (cache hit ratio, block 7) |
| Database disk | 8 GB | 0 | USD 0.125/GB beyond |
| Egress | 250 GB | 0 | USD 0.09/GB beyond; the item to protect (section 1.4) |
| Auth (MAU) | 100,000 | 0 | |
| Realtime | 5 M messages, 500 peak connections | 0 | USD 2.50 per extra million messages, USD 10 per extra 1,000 peak connections. Messages = row changes x subscribers who may see them; see below |
| File storage | 100 GB | 0 | documents are in R2 (R2 egress is free; its storage is per GB-month) |
| PITR add-on (optional) | - | 100 | needs a paid compute size; hourly billing |
| **Total** | | **~25-30**, or **~125-130 with PITR** | |

*Realtime messages, worked example:* 10,000 changes a day on published tables x 10 people allowed to see each = 100,000 messages a day = 3 M a month (inside the 5 M). Three times the team = 27 M, which is ~USD 55 of overage. Realtime is the only line that grows faster than headcount.

## 3. Provider comparison
Only options that fit this architecture are compared. Our architecture is not "a PostgreSQL database": the API and the browser use **PostgREST with row-level security as the signed-in user** (188 `rpc()` and 51 `from()` calls in `server/`, 43 `from()` in 11 browser files), 136 `auth.uid()` uses in policies and functions, `auth.users` provisioning triggers (31 references), Supabase Auth admin calls (create/delete user, recovery links), Storage buckets, and a Realtime publication of 29 tables. Any alternative must replace all of that.

| Option | Database cost / month (ESTIMATE) | What is no longer provided | Replacement cost |
|---|---|---|---|
| **Supabase Pro (today)** | 25-30 (125-130 with PITR) | - | - |
| **Neon (Launch)** | compute USD 0.106 per CU-hour with scale-to-zero (0.25-0.5 CU x ~300 business hours = ~8-16), storage USD 0.35/GB-month (~1), history/PITR storage extra: **~10-20** | Auth, Realtime, PostgREST/RLS identity, Storage | Auth: a hosted service (e.g. Clerk Pro USD 25) or building password/JWT/recovery flows ourselves; Realtime: a hosted pub/sub or our own LISTEN/NOTIFY + SSE service; a new server data-access layer. Net monthly cost is **equal or higher** than Supabase once Auth is replaced |
| **DigitalOcean Managed PostgreSQL** | ~15 (1 GB) with daily backups, no I/O charges | same as Neon | same |
| **AWS RDS (t4g.micro/small)** | ~12-25 + storage, backups included up to the DB size | same, plus operations | same |
| **Self-hosting Supabase on a VPS** | ~10-20 | nothing is removed, but we operate Postgres, Auth, Realtime, backups, upgrades and security ourselves | ongoing engineering time; not recommended for financial data |

Comparison caveats: the third-party comparison articles are marketing-adjacent and partly inconsistent; the Neon egress terms and the Supabase Realtime quota on the current plan should be re-read on the vendors' pages; all figures are USD and exclude tax.

## 4. Migration assessment
* **Expected saving:** USD 0-15 / month on the database line, and about USD 0 or negative once Auth and Realtime are replaced.
* **Effort (ESTIMATE):** 4-8 engineer-weeks: shim the `auth` schema (the repository's own test shim already does this for tests), a new server data layer that opens a transaction and sets the caller's identity for RLS on every request (replacing PostgREST), moving the 43 direct browser queries behind the API, a Realtime replacement, Auth migration (password hashes, sessions, recovery e-mails, client logins), Storage bucket fallback, re-testing 110 migrations' worth of RLS and the 3,400+ database checks and ~1,900 API checks, a cutover with downtime.
* **Risk:** it touches authentication and authorisation, the part of the system where a mistake exposes customer or financial data.
* **Break-even:** at a saving of USD 10 / month the effort never pays back (4 weeks of engineering is worth many years of the saving).
* **Recommendation: do not migrate.** Revisit only if the measured bill after the optimisations below is several hundred dollars a month, or Supabase terms/availability change.

## 5. Recommended optimisations (smallest first; none needs a provider change)
Nothing below disables RLS, weakens authorisation or removes a required index.

**P0 - this week**
1. **Rotate and remove the hard-coded webhook secrets** (section 1.7). Not a cost item; it should not wait.
2. **Run `supabase/maintenance/usage_report.sql`** on production and keep the output: it gives real table sizes, unused indexes, growth and cache hit ratio.
3. **Cost alerts:** in the Supabase dashboard keep the spend cap on, and set usage alerts for egress (50 %/80 % of 250 GB), database disk (6 GB of 8), Realtime messages (4 M of 5 M); same for R2 storage. Set a calendar check on the first of each month.

**P1 - cheap code changes with the biggest effect (front end, no migration)**
4. **Stop re-downloading whole lists on a Realtime event.** Apply the single changed row from the event payload, or re-fetch only the changed id; if a full reload is kept, debounce it harder (e.g. 2-5 s), skip it while the tab is hidden, and pass the same list to all consumers instead of each hook subscribing.
5. **Share one channel per table per page** (today up to 5 channels on `support_tickets`) and add `filter:` to channels that are about one person/team/customer (as `notifications` already does).
6. **Replace `select('*')` with the columns used** in the 13 places; lists should not carry JSON columns.
7. **Call `escalate_overdue_tickets` once per page load, not on every Realtime reload** (the database already runs it on a schedule).
8. **Turn the 5-second webhook "auto sync" off by default** and lengthen the 30-second poll.

**P2 - small database changes (each needs your approval as a migration; all reversible)**
9. Drop the two duplicate plain indexes (`chat_messages_history_idx`, `customer_documents_customer_idx`); the unique constraints already serve the same queries.
10. After 30+ days of statistics: review `audit_logs` indexes (9) and any index with 0 scans (block 3). Add indexes for filter/join foreign keys that `pg_stat_statements` shows doing sequential scans.
11. Add `pg_column_size` caps to the unbounded JSON columns that take inbound or external data (`crm_leads.raw_payload`, `hr_email_events.payload`, `automation_jobs.context`, `notifications.data`).

**P3 - retention (design with you; financial and security history is never deleted)**
12. **Keep forever:** `audit_logs`, payments, invoices, attribution, customer documents' metadata. If the audit log ever outgrows the plan, archive old months to R2 as signed, compressed files **and** keep a verifiable hash in the database - only with approval.
13. **Candidate for a retention window:** read `notifications` older than 90-180 days, `chat_messages` per your policy, `automation_jobs` / `hr_email_events` / `subscription_reminder_events` older than 12-24 months (keep failures and anything linked to money), expired `rate_limit_counters` (already self-cleaning).
14. Keep file contents in R2 (already true); ask for a size cap on every new upload path.

**P4 - backup and recovery**
15. Confirm the plan and that daily backups are on. Decide on **PITR** (about USD 100 / month): worth it if you cannot afford to lose up to a day of payment/invoice records.
16. Add an **independent weekly logical backup** (`pg_dump` of the database to a private R2 bucket from a scheduled GitHub Action with a read-only role) - about USD 0-2 / month and protects against provider-level loss.
17. Turn on versioning or a replica for the R2 document bucket if available, or schedule a copy; write the **restore runbook and rehearse it once** on a scratch project.

## 6. Prioritised plan
| # | Action | Effort | Cost impact | Risk |
|---|---|---|---|---|
| 1 | Rotate/remove hard-coded webhook secrets | 0.5 day | none (security) | low |
| 2 | Run the usage report; set usage alerts + spend cap | 0.5 day | prevents surprises | none |
| 3 | Realtime handlers: apply the event row, share channels, filter, debounce, skip when hidden | 2-4 days | removes the main egress/compute growth risk | low-medium (UI regression tests exist) |
| 4 | `select('*')` -> column lists; escalate RPC once; webhook polling defaults | 1-2 days | smaller payloads | low |
| 5 | Drop 2 duplicate indexes; review unused/needed indexes from statistics | 0.5-1 day | small disk/write saving | low (needs approval) |
| 6 | JSON size caps; retention windows (design first) | 2-3 days | keeps disk flat | low-medium |
| 7 | Backups: confirm plan, decide PITR, weekly dump to R2, restore drill | 1-2 days | USD 0-100 / month | none |
| - | Provider migration | 4-8 weeks | ~USD 0 saved | high - **not recommended** |

## Sources
* Supabase pricing summary and limits (2026 guides): [Jet Admin](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/), [Makerkit](https://makerkit.dev/blog/saas/supabase-pricing), [Supabase pricing](https://supabase.com/pricing)
* Supabase Realtime pricing ($2.50 per million messages, $10 per 1,000 peak connections; Pro quotas 5 M / 500): [Supabase docs](https://supabase.com/docs/guides/realtime/pricing)
* Supabase compute add-ons and credit; PITR (about USD 100 / 7 days) and 7-day daily backups on Pro: [Supabase PITR docs](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery), [Supabase backups](https://supabase.com/features/database-backups)
* Neon pricing (compute USD 0.106/CU-hour Launch, storage USD 0.35/GB-month; egress terms unconfirmed): [Neon pricing](https://neon.com/pricing), [Jet Admin Neon pricing](https://www.jetadmin.io/blog/neon-pricing/amp/), [Makerkit Neon calculator](https://makerkit.dev/pricing-calculator/neon)
* Managed PostgreSQL comparisons (DigitalOcean ~USD 15, RDS small instances): [selfhost.dev comparison](https://selfhost.dev/managed-postgresql-comparison-2026/), [Infratally RDS vs DigitalOcean](https://infratally.com/articles/aws-rds-vs-digitalocean-managed-postgres-full-cost-comparison-2026/)
* Hosted authentication pricing (Clerk / Auth0, figures disagree between sources): [Clerk pricing](https://clerk.com/articles/clerk-pricing-explained), [CIAM Compass](https://guptadeepak.com/ciam-compass/guides/ciam-pricing-at-scale-2026/)


## Appendix - review of an independent audit (26 Oct 2026)
A second audit with read-only access to the live project reported: **1,128 rows (~468 KB of data) in 19 populated tables, 3 users, 0 bytes in Supabase Storage, 5 objects (650 KB) in R2** (not re-measured here; consistent with the fresh-start reset). That confirms the system is tiny today, so every scale-driven item below is *prevention*, not saving. Each claim of that report was checked against the code:

| Claim | Result | Evidence / decision |
|---|---|---|
| Do not migrate providers | **Agree** | same conclusion; TCO figures there differ (see "Cost figures" below) |
| `scope_customers()` is `SETOF customers`, `SECURITY DEFINER`, called ~10 times per `dashboard_scope_overview` | **Verified** (in `20261110000100`, not `20261123`) | not inlinable (security definer + `set search_path`); cheap to fix by scanning once, but only matters above a few thousand customers. Defer until measured |
| `audit_log_actions()` does `SELECT DISTINCT action FROM audit_logs` | **Verified** | full scan whenever the filter list loads; cheap fix (small lookup / loose index scan) - do when the audit log is large |
| Browser `useTickets` calls a write RPC and a 4-table `select('*')` waterfall on every event, 3 channels | **Verified** | keep as P1. **But** removing `escalate_overdue_tickets` from the browser is safe **only if `pg_cron` is enabled** in the live project (the schedule is created only `if exists pg_extension pg_cron`; the Vercel cron runs just twice a day). Check Supabase > Database > Extensions first |
| Pipeline Realtime registered twice per screen (counts + view) | **Verified** (`shared.tsx:408` plus each view) | P1 |
| 16 hooks refetch on focus/visibility | **Roughly** (5 files add `focus`, 15 add `visibilitychange`) | add a short cooldown; P1 |
| Every GET writes to Postgres (rate limit) -> move GETs to in-memory limits | **Reject** | the counter table is UNLOGGED (no WAL, tiny); in-memory counters per serverless instance do not limit anything across instances (the migration says exactly this). Removing the DB limit weakens abuse protection for no saving |
| Cache the authenticated actor for 15 s keyed by the JWT | **Reject** | `api_session` also returns the *active department/function* chosen by request headers (shared and combined Department Heads), so a token-keyed cache would return the wrong department, and a suspended or demoted user would keep access for the cache lifetime. Saves one round trip, risks authorisation |
| Gate `SESSION_STARTED` by token age to stop audit bloat | **Reject** | the event is already de-duplicated in the database per session id (`dedupeKey: session:<id>`); the 87 rows are 87 real sign-in sessions. Gating would lose genuine sign-in records |
| `autoSync` is on by default (5 s polling) | **Incorrect** | `useState(false)` in `WabastoreWebhookLiveBar.tsx`; only the 30 s poll in `WabastorePanel.tsx` runs, and it calls the external webhook, not the database |
| Drop `automation_jobs`, `support_ticket_reads`, `onboarding_automation_runs` from Realtime | **Reject for two of three** | `automation_jobs` feeds `ConsultantViews.tsx` and `support_ticket_reads` feeds `useTickets` (read markers across devices). `onboarding_automation_runs` has no consumer found: optional |
| Lazy-mount `LeadStoreProvider` only in Wabastore | **Reject as written** | at least 12 components across departments use the lead store. A role/department check before hydrating and subscribing is possible, after checking each user |
| `customers_telecaller_leads_idx` duplicates `customers_owner_created_idx` | **Incorrect** | it is a *partial* index (`where lifecycle_stage = 'LEAD'`): smaller and faster for lead lists. Keep. The two true duplicates are `chat_messages_history_idx` and `customer_documents_customer_idx` (found by catalog query) |
| 155 of 277 foreign keys lack an index | **Method differs** | the catalog count on a real schema is 134. Index only the ones used to filter/join, after measuring |
| `telecaller_contacts` / `ba_contacts` need `(department_id, team_id)` indexes because RLS scans | **Unproven** | the policy calls `telecaller_can_read(...)` per row; an index helps only where the query filters on those columns. Measure first |
| `expire_stale_document_uploads` adds latency to uploads | **Incorrect** | it is fired without `await` and `.catch`-ed (`PipelineService.ts:512`) |
| `CustomerService.import` loops up to 500 rows sequentially | **Verified, low value** | legacy browser-data migration route; ignore |
| HR modal documents are `blob:` URLs that `saveHrRecord` never saves | **Verified (a bug, not a cost item)** | `EmployeeProfileModal.tsx` -> `hrDirectory.saveHrRecord` stores only flags/notes. Needs a product decision (HR files are sensitive) |
| Archive/prune `audit_logs` older than 180 days to R2 | **Defer** | 735 rows today; pruning weakens tamper evidence unless a hash chain is added. Revisit when the table passes ~1-2 GB, with approval |
| Add `pg_column_size` caps to unbounded JSONB | **Agree, with care** | use `NOT VALID` first so existing rows cannot make the migration fail; only after block 5 of `usage_report.sql` |
| Nightly `pg_dump` + R2 copy workflow | **Agree** | highest operational value; also confirm the Supabase plan (Free has no automated backups) |
| Stay on Supabase Free | **Not advised for production** | a CRM holding payments and invoices should be on Pro (backups, no pausing); verify the live plan |

**Cost figures to prefer from this report:** Supabase Pro includes **5 M Realtime messages and 500 peak connections** (the other report says 2 M); Neon's paid plan is **usage-based** (about USD 0.106 per CU-hour, no fixed USD 19 minimum in the sources found). The conclusion (do not migrate) is the same either way.

**Triggers to revisit the deferred items:** database over 1 GB; more than ~5,000 customers; egress above 50 GB a month; Realtime above 3 M messages a month; audit log above 1 GB. Until then the cheapest correct action is to leave them alone.
