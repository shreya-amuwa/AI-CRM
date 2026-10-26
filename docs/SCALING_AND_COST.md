# Scaling, cost and robustness

How the CRM keeps database work low on the free Supabase / Cloudflare / Vercel plans, what was changed for it, what to switch on outside the
code, and what was deliberately **not** done yet (and why).

## How a request reaches the database today
* **One database call to sign a request in.** Every API request calls `public.api_session()` once, with the caller's own token. PostgREST
  checks the token's signature and expiry, and the function returns the caller's profile, department scope and rate-limit result in that one
  call. Then the route makes its own call(s). The older three-step path (Auth `/user` + profile + rate limit) is only a fallback for a project
  where the migration is missing.
* Every permission is decided by the database (Row Level Security and `security definer` functions). No cache below can widen what anybody sees.

## What was changed (migration `20261128000100_query_performance.sql`, browser API client, Realtime)
| Change | Effect | Behaviour change |
|---|---|---|
| RLS initPlan: per-user functions in policies (`private.my_id()`, `auth.uid()`, ...) run once per query instead of once per row (11 policies were still written the slow way; the other 102 already were) | Less CPU per list query, more as tables grow | None: only zero-argument STABLE functions are wrapped |
| 34 indexes on foreign keys used for per-customer / per-person / per-department lookups and for cascading deletes | Lists and deletes stop scanning whole tables | None (a little more write work and storage) |
| Browser API client: identical GET requests in flight share one network call | Fewer duplicate calls when several parts of a screen ask for the same thing | None: each caller gets its own copy, and a request made after a change never joins one sent before it |
| Browser API client: the service catalogue is reused for 60 s (departments, teams and every other list are never kept: they carry live details) | Fewer calls for the catalogue, which almost every Sales screen loads | A catalogue edit made by **another** person can take up to 60 s to show; your own change (any POST/PATCH/DELETE) clears it at once. Build with `VITE_API_CACHE=off` to switch the client cache off |
| One shared Realtime channel per tab and per set of tables (`src/lib/realtimeShared.ts`) for the pipeline, support and work-task lists; it was one channel per listening component, often 2-4 per screen | Fewer Realtime subscriptions; Supabase checks RLS once per subscription per change | None: each screen keeps its own refresh |
| Wabastore screens stop polling while the browser tab is hidden | No calls from background tabs | None while the tab is visible |
| Daily database backup to a private R2 bucket (`.github/workflows/db-backup.yml`) | A restorable copy every day (the Supabase free plan has no backups) | Does nothing until its secrets are set |

### Deploying it
1. Merge, let Vercel deploy.
2. Paste `supabase/run_this_query_performance.sql` into the Supabase SQL editor and run it (safe to run again; it only adds indexes and
   rewrites 11 policies to an equivalent form). The app works with or without it.

## Switch on outside the code (free)
### Database backups
Set the repository secrets listed at the top of `.github/workflows/db-backup.yml`, create a **private** R2 bucket for backups with a lifecycle
rule that deletes objects older than 30 days, then run the workflow once by hand (Actions -> Database backup -> Run workflow).

Restore into a NEW project (never over the live one): download the file, `gpg -d crm-....dump.gpg > crm.dump` (if encrypted), then
`pg_restore --no-owner --no-privileges -d "<new database url>" crm.dump`. Test a restore once, so you know it works before you need it.

### Cloudflare (in front of the site)
* Proxy the domain through Cloudflare (orange cloud) and turn on **Bot Fight Mode** and the **free managed WAF rules**.
* One **rate-limiting rule** (included in the free plan): e.g. path starts with `/api/v1/` -> more than 300 requests per minute per IP -> block
  for 1 minute. The API keeps its own per-user limits as well.
* **Turnstile** (free) on public forms (sign-in, client "forgot password", public lead forms) when bots become a problem.

### Supabase settings
* Settings -> API: move to the new **publishable / secret keys**; keep the secret (service) key only in Vercel's server environment, never in a
  `VITE_` variable (CI already checks the browser bundle for it).
* Authentication: turn on **MFA** for the Super Admin and Department Heads; keep e-mail confirmation on.
* Database -> **Query Performance** and **Advisors**: look at the slowest and most frequent queries once a month.
* The daily Vercel cron (`/internal/automations/dispatch`) touches the database every day, so a free project does not pause for inactivity.

### Watch the free-plan limits
Database size, egress, monthly active users and Realtime connections are shown in Supabase -> Usage. Files belong in R2 (no egress fees), never in
Postgres. Check the current limits on the Supabase, Cloudflare and Vercel pricing pages; they change.

## Deliberately not done yet (and why)
| Idea | Why not now |
|---|---|
| Skip `api_session()` with a local JWT check + a cached profile | Saves one call per request, but a suspended user or a role change would take effect only after the cache expires, rate limits would stop being shared between servers, and the department-scope check moves out of the database. Worth it only once the numbers show `api_session` is the bottleneck |
| Redis (Upstash) / Cloudflare KV | Nothing in the app needs a shared cache today; it would add a service, a secret and a new failure mode. Revisit for dashboard totals or rate limits if traffic grows |
| `count: 'estimated'` on list totals | Page totals ("of 1,234") would become approximate |
| React Query everywhere | A rewrite of every screen's data loading; the API-client cache above gives the low-risk part of the benefit |
| Moving the API from Vercel to Cloudflare Workers | Larger project. Note: Vercel's Hobby plan is for non-commercial use; plan this (or Vercel Pro) before relying on it commercially |
| Replacing `postgres_changes` with Broadcast for other screens | Changes how each screen learns about updates; do it screen by screen when Realtime usage gets close to the limit |

## Measure before the next step
Turn on Supabase Query Performance, keep `API_ACCESS_LOG` on (one line per request in Vercel -> Logs, with the time taken), and load-test a staging
copy (e.g. k6) before deciding on any item of the table above.
