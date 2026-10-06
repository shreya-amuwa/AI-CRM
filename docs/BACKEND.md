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

**There is no Express/Nest server.** The backend is plain TypeScript on
Node.js, deployed as a single Vercel serverless function. It uses
`@supabase/supabase-js` to talk to the database and `zod` for validation. A ~60-line
router (`server/http/router.ts`) maps paths to controllers. This keeps cold starts small
and needs no server to operate; the same code could be mounted in Express later
without changes below `server/app.ts`.

## Life of a request — "Authorize & Activate"

1. **UI** (`UserAccessManagementModal`) calls `approvalsApi.approve(id, { teamId })`
   (`src/lib/api/endpoints.ts`). `src/lib/api/client.ts` attaches the Supabase
   access token.
2. **Vercel** receives `POST /api/v1/approval-requests/<id>/approve` and, via the
   rewrite in `vercel.json`, invokes `api/crm.ts` with `?__path=approval-requests/<id>/approve`.
3. **`server/app.ts`** parses the request, `router.match()` finds
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
   ACTIVE in the chosen team, closes the request — all in one transaction.
   Triggers then write `USER_APPROVED` to `audit_logs` and notify the user.
8. The response returns as `{ "success": true, "data": … }`; errors as
   `{ "success": false, "error": { "code", "message" } }` with a proper HTTP status.

## Where security lives (defence in depth)

| Layer | What it enforces | Can it be bypassed? |
|---|---|---|
| UI | Hides buttons/roles the user may not use | Yes — cosmetic only |
| API (`authz/policies.ts`) | Early, friendly permission errors | Calling PostgREST directly skips it… |
| **Database (RLS + functions + triggers)** | The actual rules: who sees/changes what, status machine, audit | **No** — applies to every path |

Because the API forwards the user's own token, even API bugs cannot read or
change data the user isn't allowed to. The **service-role key** (which bypasses
RLS) is used only to create/ban Supabase Auth accounts, after the database has
confirmed the caller may do it.

## Folder map

| Path | Responsibility |
|---|---|
| `api/crm.ts` | Vercel entry point (one function for all of `/api/v1`) |
| `server/app.ts` | Request/response adapter, error envelope |
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
