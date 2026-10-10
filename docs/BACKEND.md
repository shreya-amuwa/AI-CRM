# How the Backend Works

A practical guide for developers. For the full design rationale see
`ARCHITECTURE.md`; for setup see `SETUP_SUPABASE.md`.

## The stack in one picture

```
Browser (React + Vite SPA)
  │  1. Sign in ─────────────► Supabase Auth  (issues a JWT access token)
  │  2. Every CRM request:  fetch('/api/v1/...', Authorization: Bearer <JWT>)
  ▼
Vercel serverless function  api/crm.ts            (dev: Vite middleware, same code)
  └─ server/app.ts          HTTP adapter: body parsing, CORS, JSON envelope, errors
      └─ routes.ts          route table  → controller
          └─ controllers/   HTTP ⇄ service (no logic)
              └─ services/  business rules + zod validation (shared/validation.ts)
                  └─ repositories/  Supabase queries, run AS THE CALLER
                      ▼
Supabase PostgREST  ──►  PostgreSQL
                          • Row Level Security on every table
                          • workflow functions (approve, revoke, assign…)
                          • triggers (audit log, notifications, ownership)
```

**Framework: [Hono](https://hono.dev)** on Node.js, deployed as a single Vercel
serverless function (`api/crm.ts`). Hono provides routing and the middleware chain;
`@supabase/supabase-js` talks to the database and `zod` validates input. Controllers,
services and repositories do not depend on Hono (`server/app.ts` adapts the
request), so the same code could later run as a long-lived Node server.

Middleware order for every request (`server/app.ts`):

1. `requestId` - `X-Request-Id` on every response, included in every log line
2. access log - one JSON line per request (`level, method, path, status, ms, userId`)
3. `secureHeaders` + `Cache-Control: no-store`
4. `cors` - only origins in `API_ALLOWED_ORIGINS` (same-origin needs none)
5. `bodyLimit` - 1 MB
6. **rate limit, layer 1** - per IP, in memory (flood guard before any auth work)
7. **authenticate** - verify token, load profile, require ACTIVE
8. **rate limit, layer 2** - per user, counters in Postgres (shared by all instances)
9. controller → service → repository

## Life of a request - "Authorize & Activate"

1. **UI** (`UserAccessManagementModal`) calls `approvalsApi.approve(id, { teamId })`
   (`src/lib/api/endpoints.ts`). `src/lib/api/client.ts` attaches the Supabase
   access token.
2. **Vercel** receives `POST /api/v1/approval-requests/<id>/approve` and, via the
   rewrite in `vercel.json`, invokes `api/crm.ts` with `?__path=approval-requests/<id>/approve`.
3. **`server/app.ts`** (Hono) runs the middleware chain and dispatches to
   `approvalsController.approve`.
4. **Authentication** (`server/auth/authenticate.ts`): the token is verified
   with Supabase Auth, then the caller's `role / status / department / team`
   are loaded from `profiles`. Inactive accounts are rejected here (403).
5. **Service** (`ApprovalService.approve`): validates the body, checks the
   caller is a manager (friendly early error), calls the repository.
6. **Repository** calls the database function `approve_registration`
   **with the caller's token**, so the database knows who is acting.
7. **Database** (`approve_registration`): checks the hierarchy
   (`private.can_manage_profile`, `actor_can_assign_role`), sets the user
   ACTIVE in the chosen team, closes the request - all in one transaction.
   Triggers then write `USER_APPROVED` to `audit_logs` and notify the user.
8. The response returns as `{ "success": true, "data": … }`; errors as
   `{ "success": false, "error": { "code", "message" } }` with a proper HTTP status.

## Where security lives (defence in depth)

| Layer | What it enforces | Can it be bypassed? |
|---|---|---|
| UI | Hides buttons/roles the user may not use | Yes - cosmetic only |
| API (`authz/policies.ts`) | Early, friendly permission errors | Calling PostgREST directly skips it… |
| **Database (RLS + functions + triggers)** | The actual rules: who sees/changes what, status machine, audit | **No** - applies to every path |

Because the API forwards the user's own token, even API bugs cannot read or
change data the user isn't allowed to. The **service-role key** (which bypasses
RLS) is used only to create/ban Supabase Auth accounts, after the database has
confirmed the caller may do it.

## Rate limiting

| Bucket | Default | Env override |
|---|---|---|
| Per IP (memory, per instance) | 600 req/min | `RATE_LIMIT_IP_PER_MIN` |
| Per user, all endpoints (Postgres) | 300 req/min | `RATE_LIMIT_USER_PER_MIN` |
| Per user, sensitive endpoints (create users, approvals, status/role changes, deletes, announcements, org changes) | 20 req/min | `RATE_LIMIT_SENSITIVE_PER_MIN` |
| Per user, customer import | 5 req/min | `RATE_LIMIT_IMPORT_PER_MIN` |

Exceeding a limit returns **429** `{ code: "RATE_LIMITED" }` with `Retry-After`;
successful responses carry `RateLimit-Limit / -Remaining / -Reset`. Counters live
in `private.rate_limit_counters` via `rate_limit_consume()` (service role only -
clients can't read or reset them). If the counter store is unreachable the API
fails open to the in-memory limiter and logs an error; authorization is still
enforced by the database.

Sign-in and sign-up go directly to Supabase Auth, which has its own limits:
Dashboard → Authentication → Rate Limits (tune "sign-ups / sign-ins per hour").

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

* **build** - `npm run typecheck`, `npm run build`, and secret scans (no JWT or
  service-role reference in the bundle, no committed `.env`, no hard-coded keys).
* **database** - Postgres 16 service + PostgREST: `npm run test:db`
  (RLS for every role) and `npm run test:api` (HTTP → PostgREST → Postgres,
  including rate limits).

Protect `main` in GitHub (Settings → Branches) and require both jobs to pass.

## Folder map

| Path | Responsibility |
|---|---|
| `api/crm.ts` | Vercel entry point (one function for all of `/api/v1`) |
| `server/http/rateLimit.ts` | Rate-limit buckets and stores |
| `server/app.ts` | Hono app: middleware, route registration, error envelope |
| `server/routes.ts` | Every endpoint in one table |
| `server/controllers/` | Thin HTTP handlers |
| `server/services/` | Business logic per resource |
| `server/repositories/` | Data access + row ⇄ DTO mapping |
| `server/authz/policies.ts` | Centralised permission pre-checks |
| `server/http/errors.ts` | Error codes ⇄ HTTP status, safe DB error mapping |
| `shared/contracts.ts`, `shared/validation.ts` | Types + zod schemas shared with the UI |
| `supabase/migrations/` | Schema, RLS, functions, triggers (source of truth for rules) |
| `supabase/tests/` | RLS test-suite and end-to-end API tests |

## Adding a feature (checklist)

1. New table/columns → new migration file in `supabase/migrations/` with RLS
   policies and grants. Add cases to `supabase/tests/rls_test.sql`.
2. Contract + zod schema in `shared/`.
3. Repository → service → controller → route.
4. UI calls it through `src/lib/api/endpoints.ts` (never `fetch` or Supabase
   tables directly from components).
5. `npm run typecheck && npm run test:db && npm run test:api && npm run build`.

## Operating it

* **Health check:** `GET /api/v1/health` (no login) reports whether the
  server has its Supabase configuration, whether the service-role key is set,
  and whether the database migrations are applied. Use it after every deploy.
* **Logs:** Vercel → Project → Logs (function `api/crm`). Unhandled errors
  are logged with `[api]` prefixes; users only ever see safe messages.
* **Environment:** see `.env.example`. Set them in Vercel for Production *and*
  Preview, then redeploy (env changes need a new deployment).
