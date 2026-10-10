# AI CRM - Backend Architecture, Supabase Schema & RBAC

This document is the Phase 1 (audit) and Phase 2 (architecture) output for moving the
AI CRM from browser `localStorage` to Supabase PostgreSQL as the single source of truth.
It records what the application did before this change, what it does now, and what is
intentionally left for follow-up phases.

---

## 1. Current architecture (before this change)

| Layer | What exists |
|---|---|
| Frontend | Vite + React 18 + TypeScript SPA (`src/`), ~56k lines. No router library; a hand-rolled `utils/router.ts` maps URL → role dashboard. |
| State | React contexts (`AuthContext`, `DepartmentContext`, `NotificationContext`, `LeadStoreContext`, …) and singleton "stores" in `src/services/*Store.ts`. Almost every store reads/writes `localStorage`. |
| Backend | Three Vercel serverless functions in `api/`: inbound lead webhooks (`webhook.ts`, `webhooks/[...path].ts`) and an open URL proxy (`proxy.ts`). No business API. |
| Database | Supabase project with five ad-hoc tables created by `schema.sql` / `run_migration.cjs` (`crm_leads`, `blueprint_requirements`, `hr_employees`, `hr_attendance`, `hr_leave_applications`). Every table had a `USING (true) WITH CHECK (true)` policy, i.e. **world read/write with the public anon key**. |
| Auth | Entirely simulated in the browser (see §1.1). Supabase Auth was not used. |

### 1.1 How authentication worked

* `LoginForm.tsx` compared the typed email/password against **hard-coded credentials in the
  bundle** (`superadmin@amuwa.com / superadmin123`, `admin@…/admin123`, etc.) and against
  `userApprovalStore`, which stored **plain-text passwords in `localStorage`**.
* `AuthContext.loginWithEmail(email, password, role)` accepted a **client-supplied role** and
  wrote the resulting user object (including `role`) to `localStorage['unified_crm_user']`.
  On reload the role was read back from `localStorage` - editing that key in DevTools grants
  Super Admin.
* `loginWithGoogle(email)` created an **admin** user for *any* email with no verification.
* Route guards (`validateRouteAccess`) and every permission check ran only in React.

### 1.2 Existing authorization / role logic

Roles in `AuthUser.role`: `superadmin`, `admin`, `hr`, `team-lead`, `team-member`,
`technical-support`, `client`. Checks are scattered `user.role === '…'` comparisons in
~16 components (`Header`, `DepartmentSelector`, `UserAccessManagementModal`, …). No server
or database enforcement existed.

### 1.3 Existing notification system

`NotificationContext` held notifications in React state seeded from a hard-coded array;
nothing persisted. "Privacy" filtering (`getNotificationsForUser`) ran client-side, so every
browser received every notification. Sign-up "notified" approvers by pushing to this
in-memory list - the approver never saw it unless they were in the same tab.

## 2. Current data flow

```
Component ──► singleton store (teamMemberStore, userApprovalStore, …)
                 └─► localStorage.setItem(JSON.stringify(everything))
Component ◄── store.get*() (re-parse whole array, filter in JS)
```

Data never left the browser (except inbound leads and the HR employee table), so a
customer added on one laptop did not exist anywhere else.

## 3. Current Local Storage usage (inventory)

| Key | Owner | Contents | Classification |
|---|---|---|---|
| `unified_crm_user` | AuthContext | logged-in user **incl. role** | ❌ authorization in storage → replaced by Supabase session + `profiles` |
| `amuwa_user_registrations_v2` | userApprovalStore | users, **plain-text passwords**, status, approver | ❌ → `auth.users` + `profiles` + `approval_requests`. Purged on load (passwords cannot be migrated safely). |
| `amuwa_crm_team_member_customers_v3` | teamMemberStore | customers | ❌ → `customers` (one-time import offered) |
| `unified_crm_departments_v3` | DepartmentContext | departments, lock state | ❌ → `departments` |
| *(React state)* | NotificationContext | notifications | ❌ → `notifications` |
| `amuwa_supabase_url`, `amuwa_supabase_anon_key` | supabaseClient | user-overridable Supabase endpoint | ❌ removed - config comes from env only |
| `amuwa_crm_team_member_{leads,activities,followups,reports,recent_updates,invoices,events,deals}_v3` | teamMemberStore | pipeline data | ⚠️ business data - **follow-up phase** (§12) |
| `tl_*` (5 keys) | teamLeadStore | team-lead pod data | ⚠️ follow-up phase |
| `unified_crm_leads` | LeadStoreContext | lead cache (crm_leads is in Supabase) | ⚠️ follow-up phase |
| `amuwa_crm_attendance_records_v6`, `…latest_member_login_v6` | attendanceStore | HR attendance | ⚠️ follow-up (table `hr_attendance` exists) |
| `wabastore_department_members_v1`, `wabastore_tech_support_data_v1`, `unified_crm_field_visits`, accountsStore keys, `aiqr_*` | various | domain data | ⚠️ follow-up phase |
| `unified_crm_active_sessions` | sessionManager | cross-tab "max 2 users" sessions | UI/session simulation |
| `amuwa_theme_mode`, `amuwa_crm_last_invoice_department`, `amuwa_sys_login_*` | UI | preferences | ✅ legitimately client-side |

## 4. Proposed application architecture

```
React UI (components: presentation only)
   │  hooks / contexts (UI state, caching)
   ▼
src/lib/api/*  ── typed API client (one place that talks to the backend)
   │  Authorization: Bearer <Supabase access token>
   ▼
/api/v1/*  (Vercel function; same handler mounted in Vite dev server)
   Router → Controller → Service → Repository
   │  user-scoped Supabase client (caller's JWT ⇒ RLS still applies)
   │  service-role client ONLY for auth.admin (create / ban / delete auth users)
   ▼
Supabase PostgreSQL
   RLS policies + SECURITY DEFINER workflow functions + triggers (audit, notifications,
   ownership derivation, status state machine)
```

Design principles:

* **The database is the final authority.** Every rule (hierarchy, status, ownership, role
  elevation) is enforced by RLS, column grants, triggers or workflow functions. The API
  repeats checks only to return friendly errors early - bypassing the API and calling
  PostgREST directly with a stolen token gains nothing.
* **Status is re-checked on every query.** RLS helpers require `status = 'ACTIVE'` from the
  `profiles` table (not from the JWT), so revocation takes effect on the very next request.
  The API additionally bans the auth user so the refresh token stops working.
* **No role in the JWT or storage is trusted.** `app_metadata` is only used at provisioning
  time and is re-validated by the database trigger.
* Frontend talks to Supabase directly for exactly two things: **Auth** (sign-in/up/out,
  session) and **Realtime** (a ping that triggers a refetch of notifications/approvals).

## 5. Supabase schema

Migrations live in `supabase/migrations/` (Supabase CLI format). Overview:

```
auth.users 1─1 profiles ─┬─► departments
                         └─► teams ──► departments        (composite FK keeps team ∈ department)
customers ─► profiles (owner) ; team_id/department_id derived from owner by trigger
customer_activities ─► customers
approval_requests ─► profiles (subject, decided_by), departments, teams
notifications ─► profiles (recipient, actor)
audit_logs ─► profiles (actor, nullable on delete)
crm_settings (key/value)
```

| Table | Key columns / constraints |
|---|---|
| `departments` | `id uuid`, `slug` unique (matches legacy ids such as `wabastore` used by the UI), `name` unique (case-insensitive), `is_locked`, display fields. |
| `teams` | `department_id` FK, `name`, `division` enum (`SALES`/`SUPPORT`/`GENERAL`), unique `(department_id, lower(name))`, unique `(id, department_id)` for composite FKs. |
| `profiles` | PK = `auth.users.id` (cascade), `email` (unique, lower-case), `full_name`, `role app_role`, `status account_status`, `department_id`, `team_id` with composite FK `(team_id, department_id) → teams(id, department_id)`. CHECKs: department heads need a department; active team heads/members need a team. |
| `customers` | `owner_id` FK (`ON DELETE RESTRICT`), `team_id`, `department_id` (derived, composite FK), contact fields, `segment`, `status`, order metrics, `created_by/updated_by`, `search_text` generated column + trigram index, partial unique `(department_id, lower(email))`. |
| `customer_activities` | immutable timeline rows per customer. |
| `approval_requests` | `request_type`, `subject_user_id`, routing `department_id/team_id`, `status`, decision fields; partial unique: one PENDING request per subject/type. |
| `notifications` | `recipient_id`, `type` (UPPER_SNAKE text, extensible without migrations), `title`, `body`, `entity_type/entity_id`, `actor_id`, `data jsonb`, `read_at`. |
| `audit_logs` | `bigint identity`, `actor_id`, `action`, `entity_type`, `entity_id`, `department_id/team_id` (for hierarchical visibility), `metadata jsonb`. Append-only: no UPDATE/DELETE grant to anyone. |
| `crm_settings` | `key` PK, `value jsonb`, `updated_by`. |

Deliberate omissions (not "blindly" creating tables):

* **`roles` / `permissions` tables** - the hierarchy is fixed and permissions are
  *relationship-based* (same team / same department), not a flat role→permission matrix.
  They are encoded once, in versioned SQL helper functions (`private.can_manage_profile`,
  `private.can_assign_role`, …) that both RLS and workflow functions call. A matrix table
  would add an indirection every policy must join without expressing the relationships.
* **`team_memberships`** - the business rule is one team per user, so `profiles.team_id`
  is the membership. If multi-team membership is ever needed, introduce the join table and
  change `private.current_team_id()` - policies are written against the helpers, not the column.
* **`customer_assignments`** - ownership is `customers.owner_id`; history of reassignment is
  in `audit_logs` (`CUSTOMER_REASSIGNED`). Shared ownership can be added later as a join table
  plus one extra branch in `private.can_access_customer`.
* **`organizations`** - the CRM is single-tenant (Amuwa group, business units = departments).
  Everything hangs off `departments`, so multi-tenancy later means one `organization_id`
  column on `departments`/`profiles` and one predicate in the helpers.

## 6. Role / permission hierarchy

Roles (`app_role` enum): `SUPER_ADMIN` > `DEPARTMENT_HEAD` (a.k.a. Admin) > `TEAM_HEAD` > `TEAM_MEMBER`.
Statuses (`account_status`): `PENDING`, `ACTIVE`, `SUSPENDED`, `REVOKED`, `REJECTED`.
**Access = role AND status = ACTIVE.**

| Actor (ACTIVE) | Can see profiles | Can manage (approve/suspend/revoke/restore) | Can create role | Customers |
|---|---|---|---|---|
| SUPER_ADMIN | all | everyone except other Super Admins and self | DEPARTMENT_HEAD, TEAM_HEAD, TEAM_MEMBER anywhere | all |
| DEPARTMENT_HEAD | own department | TEAM_HEAD / TEAM_MEMBER in own department | TEAM_HEAD, TEAM_MEMBER in own department | own department |
| TEAM_HEAD | own team (+ own department head) | TEAM_MEMBER in own team | TEAM_MEMBER in own team | own team |
| TEAM_MEMBER | own team | - | - | own (`owner_id = self`) |

Allowed status transitions (enforced by trigger, applies even to service role):
`PENDING→ACTIVE|REJECTED`, `ACTIVE→SUSPENDED|REVOKED`, `SUSPENDED→ACTIVE|REVOKED`,
`REVOKED→ACTIVE`. Nobody can change their **own** role, status, department or team -
`profiles` has column-level `UPDATE` grants only on `full_name`, `avatar_url`, `phone`,
`position`; everything else goes through workflow functions that check the hierarchy.

Hard delete of users: Super Admin only (via API → `auth.admin.deleteUser`). Users who still
own customers cannot be deleted (`ON DELETE RESTRICT` → `409 CONFLICT`); reassign first.

Mapping to the legacy UI roles (so existing dashboards keep working):
`SUPER_ADMIN→superadmin`, `DEPARTMENT_HEAD→admin` (`hr` when the department slug is `hr`),
`TEAM_HEAD→team-lead`, `TEAM_MEMBER→team-member` (`technical-support` when the team
division is `SUPPORT`). This mapping is derived from database state in one function
(`src/lib/auth/roleMapping.ts`) and is used for **navigation only**.

## 7. Customer onboarding flow

```
Team Member → "Add Customer" form (client validation via shared zod schema)
  → POST /api/v1/customers  (Bearer token)
  → authenticate: verify JWT with Supabase, load profile, require ACTIVE
  → CustomerService: validate (zod), authz pre-check (owner within actor scope)
  → CustomerRepository.insert with the caller's JWT
      DB trigger: owner must be ACTIVE + have a team; team_id/department_id copied from owner;
                  created_by/updated_by = auth.uid()
      RLS WITH CHECK: actor may own/assign within scope
      AFTER trigger: audit_logs CUSTOMER_CREATED, notify team heads (CUSTOMER_CREATED)
  ← 201 { success: true, data: <persisted row> }
UI inserts the returned row into its list (no local-only records)
```

## 8. User approval flow

```
Sign-up form → supabase.auth.signUp({ email, password, data: { full_name, department_id, team_id } })
  → trigger on auth.users (SECURITY DEFINER):
       profile(role = TEAM_MEMBER, status = PENDING)   -- role never taken from user input
       approval_request(USER_REGISTRATION, routed to team/department)
       notifications USER_REGISTRATION_REQUEST → active team heads of the team,
                    else department heads, else super admins
       audit USER_REGISTERED
Approver → POST /api/v1/approval-requests/:id/approve { team_id? }
  → rpc approve_registration: can_manage_profile? → PENDING→ACTIVE, request APPROVED,
    notify subject USER_APPROVED, audit USER_APPROVED (all in one transaction)
Reject → PENDING→REJECTED (+ USER_REJECTED notification + audit)
```

Admin-created users (`POST /api/v1/users`): the API first calls `rpc assert_can_create_user`
with the caller's JWT, then uses the service role to create the auth user with
`app_metadata.provisioned_by/role/department/team`. The DB trigger **re-validates** that
`provisioned_by` is allowed to create that role in that scope before creating an ACTIVE profile.

## 9. Notification flow

Notifications are rows per recipient, written only by SECURITY DEFINER functions/triggers
(`private.notify`). Clients can `SELECT` their own rows and `UPDATE read_at` only (column grant).
Announcements from the Notification Center use `rpc broadcast_announcement(...)`, which
fans out to recipients inside the sender's scope. The frontend subscribes to Supabase
Realtime on `notifications` (RLS-filtered to the recipient) and refetches the unread count.

Types today: `USER_REGISTRATION_REQUEST`, `USER_APPROVED`, `USER_REJECTED`, `USER_SUSPENDED`,
`USER_REVOKED`, `USER_REINSTATED`, `CUSTOMER_CREATED`, `CUSTOMER_UPDATED`, `ANNOUNCEMENT`.
New types need no migration (`type` is validated as UPPER_SNAKE text).

## 10. RLS strategy

* RLS **enabled** on every application table (not FORCEd: SECURITY DEFINER helpers run as the table owner). No `USING (true)` anywhere.
* Helper functions in a non-exposed `private` schema, `SECURITY DEFINER`, `STABLE`,
  `search_path = ''`: `current_profile_id()`, `current_role()`, `current_department_id()`,
  `current_team_id()` - all return NULL unless the caller's profile is ACTIVE, so every
  policy that uses them automatically denies pending/suspended/revoked users.
* Policies call `(select private.fn())` so Postgres evaluates them once per statement.
* Writes to sensitive columns go through `SECURITY DEFINER` workflow functions
  (`approve_registration`, `reject_registration`, `set_user_status`, `assign_user`,
  `broadcast_announcement`) - never through direct `UPDATE` grants.
* `audit_logs` and `notifications` have no INSERT grant for `authenticated`.
* Legacy tables (`crm_leads`, `hr_*`, `blueprint_requirements`) lose their public policies:
  `crm_leads`/`blueprint_requirements` require an active user; `hr_*` require Super Admin or
  membership of the `hr` department. Webhooks use the service role (no anon fallback).
* Anonymous users get exactly one function: `list_registration_options()` (department and
  team names for the sign-up form).

## 11. Backend / service structure

Endpoints (all under `/api/v1`, all require `Authorization: Bearer <access token>`):
`GET|PATCH /me` · `GET|POST /users`, `GET|PATCH|DELETE /users/:id`, `POST /users/:id/status` ·
`GET /approval-requests`, `POST /approval-requests/:id/approve|reject` (requests are created by
the database on sign-up, so there is no `POST /approval-requests`) ·
`GET|POST /customers`, `GET /customers/summary`, `POST /customers/import`,
`GET|PATCH|DELETE /customers/:id`, `GET|POST /customers/:id/activities` ·
`GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/read-all`,
`PATCH /notifications/:id/read`, `DELETE /notifications/:id`, `POST /announcements` ·
`GET|POST /departments`, `PATCH|DELETE /departments/:id` · `GET|POST /teams`,
`PATCH|DELETE /teams/:id` · `GET /audit-logs`.


```
api/crm.ts          Vercel entry (single function → router)
server/
  config/env.ts               validated env (never exposes service key to the client)
  app.ts                      Hono app: middleware (request id, logs, security headers, CORS,
                              body limit, rate limits, auth) + error envelope
  http/                       types, AppError → JSON envelope, rate limiting
  auth/authenticate.ts        JWT verification + profile load → Actor
  authz/policies.ts           centralized pre-checks (mirrors DB rules for early errors)
  db/supabase.ts              user-scoped client factory, service-role client (lazy)
  repositories/               ProfileRepository, CustomerRepository, ApprovalRepository,
                              NotificationRepository, DepartmentRepository, TeamRepository,
                              AuditRepository
  services/                   UserService, CustomerService, ApprovalService,
                              NotificationService, OrganizationService, AuditService
  controllers/                one per resource; thin
  routes.ts                   declarative route table (method, path, handler, rate class)
shared/
  contracts.ts                DTO types shared by API and UI
  validation.ts               zod schemas shared by API and UI
```

Response envelope: `{ success: true, data, meta? }` or
`{ success: false, error: { code, message, details? } }`. Codes: `UNAUTHENTICATED` 401,
`ACCOUNT_INACTIVE` 403, `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 422,
`CONFLICT` 409, `INTERNAL` 500. Postgres errors are mapped (`42501`→FORBIDDEN,
`23505`→CONFLICT, `23503`→CONFLICT/VALIDATION, `P0001` with known prefixes) and never
leaked verbatim.

## 12. Migration strategy from Local Storage

1. **Auth/users** - plain-text passwords in `amuwa_user_registrations_v2` cannot be migrated
   safely, and the hard-coded demo accounts are not real people. The store is **purged on
   load**. Real staff are provisioned by their managers (`POST /users`) or self-register and
   are approved. The first Super Admin is created with `scripts/bootstrap-super-admin.mjs`.
2. **Departments** - the 11 official departments are seeded by migration with their legacy
   slugs, so existing URLs and department panels keep working. Sales/Support teams are
   seeded for the business units that have those divisions.
3. **Customers** - on first login, if `amuwa_crm_team_member_customers_v3` contains rows
   owned by the legacy id of this user (or unowned), the dashboard offers
   "Import N customers from this browser". Import goes through `POST /customers/import`
   (same validation + RLS, duplicates skipped). The local key is removed only after the
   server confirms.
4. **Notifications** - legacy ones were in-memory demo data; nothing to migrate.
5. **Follow-up phases** (same pattern: table + RLS + repository/service + hook): leads/pipeline
   (`crm_leads` + `teamMemberStore` leads/deals/follow-ups), invoices & accounts, HR
   attendance/employees, team-lead pod data, technical-support tickets, field visits, AIQR.
   Until then these modules still use `localStorage` (full inventory in §3).

## 13. Security risks found (and status)

| # | Risk | Severity | Status |
|---|---|---|---|
| 1 | **Database password hard-coded in `run_migration.cjs`** (committed) | Critical | File removed. **Password must be rotated in Supabase** - it remains in git history. |
| 2 | All tables world-readable/writable via anon key (`USING (true)`) - includes HR salaries | Critical | Replaced by scoped policies (migration `…_harden_legacy_tables`). |
| 3 | Client-side auth; role stored in `localStorage`; fake Google login grants admin | Critical | Replaced by Supabase Auth + DB profiles. |
| 4 | Plain-text passwords in `localStorage` and in the JS bundle (demo creds) | High | Removed; legacy store purged. |
| 5 | Anon key hard-coded as fallback; users could repoint the app to another Supabase project via `localStorage` | Medium | Env-only config. |
| 6 | `.env` and `CREDENTIALS.md` were committed then deleted (history keeps them). `.env` held the anon key; `CREDENTIALS.md` held demo passwords | Medium | Demo credentials no longer work (auth is real). Consider rotating the anon/JWT secret if the project was ever relied on with open policies. |
| 7 | Webhooks fall back to the anon key when the service key is missing | Medium | Fallback removed; webhook returns 500 if misconfigured. Webhook endpoints are still unauthenticated - add a shared secret (`WEBHOOK_SECRET`) in the follow-up. |
| 8 | `api/proxy.ts` is an open proxy (SSRF / abuse) | Medium | Not changed in this pass (used by lead fetchers); recommended: allow-list hosts + require auth. |
| 9 | Public storage buckets `blueprint-files`, `amuwa-docs` | Low-Med | Unchanged; recommend private buckets + signed URLs. |
| 10 | Per-department "unlock" passwords hard-coded in `DepartmentAccessForm` / `DepartmentUnlockModal` | High | Removed. Department access now follows the user's database profile. |
| 11 | Unreachable AIQR module (`src/components/aiqr`, `AiqrAuthContext`) contains a hard-coded passcode | Low | Not imported anywhere and tree-shaken from the bundle; delete or migrate when AIQR is revived. |
| 12 | Customer KPIs, pagination and CSV import on the customer dashboard were static mock UI | - | Replaced by `customer_summary()` (RLS-scoped aggregates), server pagination and a real import of legacy browser data. |

## 14. Verification performed

| Suite | What it proves | Result |
|---|---|---|
| `supabase/tests/rls_test.sql` (`npm run test:db`) | Every role against every table and workflow function: hierarchy scoping, self-elevation, status state machine, revocation, audit immutability, anon access, legacy tables | 123/123 |
| `supabase/tests/api_integration.test.ts` (`npm run test:api`) | Real HTTP handler → supabase-js → PostgREST → Postgres: auth, envelopes, validation, error mapping, pagination/search, provisioning, approvals, revocation + ban | 62/62 |
| Browser run (Playwright, Vite dev server + API) | Forged `localStorage` role ignored; sign-up → pending → approved from the UI; customer added, survives reload and appears in a fresh browser with nothing in `localStorage`; team head blocked from privileged delete | 9/9 |
| Upgrade simulation | Migrations applied over the legacy schema with `USING (true)` policies and existing rows | open policies gone, data kept |
| `npm run typecheck`, `npm run build`, bundle scan | Frontend + server compile; no JWTs, service-role references or demo passwords in `dist/` | pass |

Not verified here: a deploy to the real Supabase project (no credentials in this
environment) and Supabase Realtime delivery (the local stand-in has no Realtime
server; the UI also refetches after its own actions).

## 15. Scalability notes

* Customer lists are **server-paginated** (`page`, `pageSize ≤ 100`), filtered and sorted in
  SQL; search uses a trigram GIN index on a generated `search_text` column (debounced in UI).
* Indexes exist only for real query paths: profile lookups by department/team/status,
  customers by owner / team+created_at / department+created_at, unread notifications per
  recipient (partial index), pending approvals by team/department, audit by
  department/team/entity/time.
* RLS helpers are `STABLE` and wrapped in `(select …)` so they run once per statement, and
  they hit the `profiles` primary key.
* `count: 'exact'` on large tables gets expensive past ~1M rows; switch the customer list to
  `count: 'estimated'` or keyset pagination at that point (one repository change).
* Realtime is used only for notifications and approval requests; everything else is fetched
  on demand.
