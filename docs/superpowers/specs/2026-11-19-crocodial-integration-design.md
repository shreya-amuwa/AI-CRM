# Crocodial integration: reusable connector, MPillar Sales pilot (two employees)

Status: draft for approval (2026-11-19). Source request: the owner's "AMUWA AI-CRM — CROCODIAL INTEGRATION" brief and `outbound-api-guide.md`.

## Why

- **Where the work happens.** Sales staff call and follow up leads in Crocodial (a calling CRM). Managers cannot see that work in the AI-CRM.
- **Goal.** Read Crocodial's activity into the CRM, so each employee sees their own calling and follow-up work next to their CRM work. Their managers see it through the existing Sales hierarchy.
- **Pilot first.** The rollout starts with MPillar Sales and two people (Sachin and Supriya). Later departments are switched on by configuration, not by a rewrite.

## What exists today (investigation)

- **No Crocodial integration exists.** "Crocodial (Call CRM)" appears only as a sellable service name in onboarding (`crm_services`).
- **Hierarchy.** Super Admin → Operations Head → Department Head → Team Lead (`TEAM_HEAD`) → Team Member.
  - Department and Sales/Support scope comes from `private.scopes_of(profile)`. It covers the home department, `department_access` grants, and `operations_head_departments` with its per-department division.
  - A Team Lead's people come from `private.led_by(lead, person)` / `private.direct_lead_of(person)` within their team.
  - The Sales/Support function is `teams.division`.
- **Sales roles.**
  - Sub-role (`profiles.sales_sub_role`): TELECALLER, BUSINESS_ASSOCIATE, INFLUENCER, VISIT_SALES or BUSINESS_PARTNER.
  - The dashboard is chosen from it: Telecaller Dashboard, Business Associate Dashboard, or the general sales dashboard.
- **Demos.** `ba_demos` (status SCHEDULED / RESCHEDULED / COMPLETED / CANCELLED, `assigned_to`, `starts_at`) is the source of truth for demo counts.
- **No access from here.**
  - This environment cannot reach `app.crocodial.app` (the network proxy refuses it).
  - It has no Crocodial token and no access to the production database.

  Identity verification and the first live sync therefore have to be done by the owner, through the admin screen this work adds. Everything else is built and tested against recorded fixtures.

## Goals

1. **One reusable connector.** A connection (one Crocodial account and its token) is linked to a department + function. Approved employee mappings sit under it, synced activity under those, and CRM dashboards read the activity.
2. **Pilot only.** Only MPillar Sales is enabled, and only the employee mappings a Super Admin approves (intended: Sachin and Supriya). Everyone else gets nothing, including other MPillar Sales staff.
3. **Read-only use of Crocodial.**
   - Resources read: `/employees`, `/branches`, `/leads`, `/call-logs`, `/followups`, `/remarks`.
   - Never called: create, update or delete operations.
   - Not imported during the pilot: recordings.
4. **Exact attribution.** Each record type is attributed by a specific Crocodial field, mapped through an approved, account-scoped employee mapping:
   - calls by `called_by.id`;
   - follow-ups by `created_by.id`;
   - remarks by `written_by.id`;
   - leads by `assigned_to.id`.

   Names and phone numbers are never used to match people. Unmatched records are kept, but excluded and admin-only.
5. **Existing dashboards and hierarchy.**
   - "My Crocodial Activity" goes on the employee's existing dashboard.
   - Pilot views go into the existing Team Lead, Department Head, Operations Head and Super Admin screens.
   - Management totals are labelled "Crocodial Pilot — N connected employees".
6. **Admin screen** (Super Admin): connections, connection test, department enablement, employee mapping approve/revoke, sync status and errors, manual sync, unmatched records, audit history.

## Non-goals

- Writing anything to Crocodial. Its "Allow changes" setting stays off.
- Importing call recordings.
- Copying Crocodial leads into the CRM customer pipeline. A link to an existing customer is only a suggestion until an admin confirms it.
- Support departments, or any department other than MPillar Sales.
- Changing anyone's CRM role, department or team, or creating CRM accounts.
- Combining Crocodial activity with the existing task-performance scores.

## Anti-goals (a failure even if it "works")

- One person sees another person's activity: by URL, id, query parameter or payload.
- A call is counted for the wrong person.
- Two Crocodial accounts' records are mixed: numeric ids from different accounts collide.
- Stale or failed data is shown as live, or "no data" is shown as zero.
- The token appears in the browser, in logs or in the repository.
- A department or employee is switched on without an explicit Super Admin decision.

## Approaches considered

- **A. One generic connector with configuration rows, enforced in the database.** Chosen.
  - Tables hold connections, department enablement and employee mappings.
  - Synced rows carry `connection_id` and the external id, as the key.
  - Every read goes through `security definer` functions that check the caller against the existing hierarchy, and against an approved mapping in an enabled department.
  - Expansion to another department is a Super Admin action, not a code change.
- **B. A hard-coded MPillar integration (env flag plus a name list).** Rejected:
  - it would need a rewrite for the next department;
  - it puts the security boundary in application code;
  - it would match people by name.
- **C. Calling Crocodial live on every dashboard view (no local copy).** Rejected:
  - a 60 requests/minute limit is shared by all viewers;
  - permissions cannot be enforced in the database;
  - there would be no history when a mapping changes;
  - it is slow.

## Design

### Data (all tables: RLS on, no grants to `authenticated`; access only through functions)

- **`crocodial_connections`** — one Crocodial account and its token.
  - Columns: `id`, `name`, `external_account_label` (the account as the owner identifies it in Crocodial), `credential_ref` (the NAME of a server environment variable, `^CROCODIAL_TOKEN_[A-Z0-9_]{1,40}$`, never the token itself), `enabled` (default false), `health` (UNKNOWN / OK / AUTH_FAILED / DISABLED_AT_SOURCE / RATE_LIMITED / ERROR), `last_success_at`, `last_attempt_at`, `last_error` (safe text), `timezone` (from the API), timestamps.
  - If Sachin and Supriya are two separate Crocodial accounts, there are two connections, each with its own token. If they are employees of one account, there is one connection.
- **`crocodial_department_links`** — a connection serving one department and function.
  - Columns: `connection_id`, `department_id`, `division` (`'SALES'` only for now; check constraint), `enabled` (default false), `stage` (PILOT / PRODUCTION), `owner_id`, timestamps.
  - Unique on (`connection_id`, `department_id`, `division`).
- **`crocodial_employee_mappings`** — a Crocodial user mapped to a CRM profile.
  - Columns: `connection_id`, `external_employee_id` (bigint), `external_name` (for display only), `profile_id`, `department_id`, `division`, `role_snapshot` (the profile's role and sub-role at approval), `status` (PENDING / APPROVED / REVOKED), `proposed_by`, `approved_by`, `approved_at`, `effective_from`, `ended_at`.
  - Partial unique indexes: one live mapping (PENDING or APPROVED, not ended) per (`connection_id`, `external_employee_id`) and one per (`connection_id`, `profile_id`).
- **`crocodial_lead_links`** — a suggested or confirmed link from a Crocodial lead to a CRM customer.
  - Columns: `connection_id`, `external_lead_id`, `customer_id`, `status` (SUGGESTED / CONFIRMED / REJECTED), `decided_by`, `decided_at`.
  - Nothing ever writes to `customers`.
- **Synced copies** (PR 2), keyed by (`connection_id`, `external_id`), holding only the fields the dashboards need:
  - `crocodial_ext_employees` (with `branch_id`, `active`);
  - `crocodial_ext_branches`;
  - `crocodial_ext_leads` (`assigned_to_ext`, `status`, `called`, `next_followup_at`, `last_interaction_at`, created/updated);
  - `crocodial_ext_calls` (`called_by_ext`, `lead_ext`, `call_type`, `call_at`, `duration_seconds`, `connected`);
  - `crocodial_ext_followups` (`created_by_ext`, `lead_ext`, `scheduled_at`, `done`, `completed_at`);
  - `crocodial_ext_remarks` (`written_by_ext`, `lead_ext`, `created_at`; the remark text is kept for the owner's own view only).

  Every row has `first_seen_at`, `last_seen_at` and `missing_since`. Reconciliation sets `missing_since` and never deletes.
  Lead phone numbers, names and e-mails are stored only on the lead row, and shown only to people allowed to see that lead's employee.
- **`crocodial_sync_state`** (per connection × resource): `checkpoint` (the start time of the last fully successful run), `running_since` (a lock with a lease), `last_run_at`, `last_ok_at`, `last_error`, `rows_last_run`.
  **`crocodial_sync_runs`** keeps the history.
- **Audit:** every configuration and mapping change goes through the existing `private.write_audit`, with before and after values.

### Activation (database-enforced)

A person's Crocodial data is visible or counted only when all of these are true:
1. the connection is enabled;
2. the connection's department link for the mapping's department and function is enabled;
3. the mapping is APPROVED and in effect (`effective_from <= t` and `ended_at` is null or later than `t`);
4. the profile is ACTIVE.

Further rules:
- **Approval checks** that the profile is ACTIVE, belongs to that department, and sits in a team of that function (or is that function's Department Head). It records a role snapshot. It never changes the profile.
- **Who can change configuration:** only the Super Admin can create connections, enable department links, and approve or revoke mappings. Switching a department on does not switch anyone on.
- **The migration seeds** one disabled department link, for the department with slug `mpillar` and function SALES, once its connection is created. There are no rows for any other department. Nothing is enabled until the Super Admin approves each step.

### Who sees what (enforced by one helper, `private.croc_can_view(profile_id, department_id)`, built on the existing helpers)

| Viewer | Sees |
| --- | --- |
| The mapped employee | Their own activity only (`profile = me`). |
| Their Team Lead | The employees in their team that they lead (`private.led_by`). Not another Team Lead's people in the same department. |
| Department Head / Operations Head | Mapped employees whose department and function are in `private.scopes_of(me)` with SALES (or the whole department). Support-only heads see nothing. |
| Super Admin | Everything, plus configuration, unmatched records and errors. |
| Anyone else | Nothing. Functions return "not found" for ids outside their scope. |

Unmatched records (no approved mapping) are visible to the Super Admin only and are never counted.

### Synchronisation (server, service role only)

- **Client.** `server/crocodial/client.ts`.
  - Base URL is fixed. The token is read from `process.env[credential_ref]` on the server.
  - Header `Authorization: Bearer`, timeout 30 s, retries with back-off on network errors and 5xx.
  - On 429: wait 60 s, at most twice, then stop the resource for this run.
  - Rate limit: at most 50 requests per minute per connection (under the documented 60), counted in the database so parallel instances share it.
- **Pagination.** `next_page_url` is followed only when it has the same origin and path as the request, `page` grows by one, and no `token` query parameter is present (the header is always used).
- **Validation.** Responses are checked with Zod. A row that does not validate is skipped and counted, never stored half-read.
- **Order per connection:** employees → branches → leads → call-logs → followups → remarks.
  - Each resource has its own checkpoint, so one failed resource does not move or block the others.
  - The checkpoint advances only after all pages are stored, to the run's start time minus a 10-minute overlap.
  - Upserts are idempotent on (`connection_id`, `external_id`).
  - Calls are filtered `from` the checkpoint date, because the guide documents `updated_since` for calls too.
- **Reconciliation.** A weekly full pull marks rows that were not returned as `missing_since`. Rows that come back are cleared. Nothing is deleted.
- **When syncs run.**
  - The existing automation dispatch (pg_cron, every few minutes) runs connections that are due, at most every 15 minutes each.
  - A manual "Sync now" (Super Admin) is limited to once per 5 minutes per connection.
  - Overlapping runs are prevented by the `running_since` lease.
- **No sync for disabled configuration.** Disabled connections, and connections with no enabled department link, are never called.

### Metrics (database functions; a date range in the account's time zone)

- **Calls made:** call-log rows with `call_type = 'outgoing'` and `called_by_ext` = the employee's approved external id on that connection, in effect at `call_at`.
- **Connected calls:** calls made with `connected = true`.
- **Connect rate:** connected calls ÷ calls made. Shown as "—" when there are no calls made.
- **Talk duration:** the sum of `duration_seconds` over connected outgoing calls.
- **Missed / incoming:** counted separately by `call_type`.
- **Unique leads contacted:** distinct `lead_ext` over calls made where `lead_ext` is not null.
- **Follow-ups scheduled:** created by the employee, with `scheduled_at` in range.
  - **Completed:** those with `done`.
  - **Overdue:** not done and `scheduled_at` before now.
  - **Completion:** completed ÷ scheduled in range.
- **My Crocodial leads:** leads whose `assigned_to_ext` is the employee, as Crocodial reports it now. This is separate from the CRM customer owner.
- **Demos (CRM, not Crocodial)**, from `ba_demos` where `assigned_to` = the profile:
  - scheduled: distinct demos with `starts_at` in range;
  - completed: status COMPLETED;
  - cancelled: shown separately;
  - upcoming: `starts_at` ≥ now and not cancelled or completed.

  A rescheduled demo is one demo.
- **Unavailable vs zero.** "Unavailable" is shown when the person has no approved mapping or the last successful sync is too old (default 24 h). "Zero" is shown only when the data is fresh.

### Screens

- **Employee.** A "My Crocodial Activity" section on the dashboard they already have:
  - **Telecaller Home:** call and follow-up cards, plus recent calls.
  - **Business Associate Home:** call activity plus CRM demos.
  - **Other sales roles:** the general sales dashboard.

  The section has date filters, a "Source: Crocodial · last synced …" label, and unavailable and error states. It is shown only when the database says the person has an approved mapping.
- **Management.** In the existing Team Lead, Department Head and Operations Head Sales views: a "Crocodial Pilot — N connected employees" panel with a per-employee table, totals, trend and drill-down. Its scope is exactly the table above.
- **Super Admin.** A "Crocodial Integration" page in the Super Admin dashboard:
  - connections: name, account, credential variable name, enable, test, health, last sync, Sync now;
  - department links: only MPillar Sales is configured; others show "Not configured";
  - employee mapping:
    1. pick a Crocodial user from the synced `/employees` list;
    2. pick a CRM profile;
    3. see the department, team and role check;
    4. approve or revoke;
  - unmatched records;
  - audit history.

### Delivery (separate pull requests, each working on its own)

1. **PR 1 — Configuration and identity.**
   - Connection, department link and mapping tables, with the activation and visibility helpers.
   - Super Admin functions and API.
   - The Crocodial client with the connection test and the `/employees` + `/branches` fetch, used to pick mappings.
   - The admin page: connections, department links, mapping approval, audit.
   - DB, unit and API tests.
2. **PR 2 — Read-only sync.** The synced tables, sync state, worker, rate limit, pagination, reconciliation, unmatched review, and sync status in the admin page. Tests use recorded fixtures (two accounts with overlapping ids).
3. **PR 3 — Employee dashboards.** "My Crocodial Activity" on Telecaller, Business Associate and general sales homes.
4. **PR 4 — Management views.** Team Lead, Department Head, Operations Head and Super Admin pilot panels.
5. **PR 5 — Rollout.** The rollout runbook, the docs, and any remaining regression or browser tests.

## Left to the owner (cannot be done from this environment)

1. **Find out how the accounts are set up in Crocodial:** is the screenshot two separate accounts, or two employees of one account? This decides one connection or two, and one token or two. The code supports either.
2. **Create a token** in each Crocodial account (Setup → Outbound API), with "Allow changes" OFF. Store it as a server secret, for example `CROCODIAL_TOKEN_MPILLAR_SACHIN` (Vercel / Worker env).
3. **In the admin page:**
   1. create the connection with that variable's name;
   2. run the connection test;
   3. pick each person's Crocodial user from the fetched employee list;
   4. pick their CRM profile; the page shows their department, team and role for checking;
   5. approve;
   6. enable the MPillar Sales link;
   7. run the first sync.
4. **Verify against Crocodial's own screens** that call counts match for a known day.

## Calls I made (please check)

- **Token storage.** The token is stored as a server environment variable, named by the connection; the database keeps only the name. This follows the brief's "environment secret". No new encryption key is needed.
- **Who controls configuration.** Only the Super Admin creates connections, enables departments and approves mappings. Department Heads only view.
- **Lead links.** Links to CRM customers are suggestions until confirmed, and no CRM data is ever changed.
- **Freshness.** Data older than 24 h is shown as stale, not as current.
- **Reconciliation.** It runs weekly and never deletes.
