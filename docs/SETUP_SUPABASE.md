# Supabase Setup, Deployment & Testing

## 0. Before anything else — rotate leaked credentials

The previous `run_migration.cjs` committed the **Postgres database password** for
the Supabase project. The file is removed, but it remains in git history.

1. Supabase Dashboard → Project Settings → Database → **Reset database password**.
2. If the old open (`USING (true)`) policies were ever live, assume table data was
   readable by anyone holding the anon key. Consider rotating the JWT secret
   (Settings → API), which also rotates the anon and service-role keys.

## 1. Environment variables

Copy `.env.example` to `.env.local` (git-ignored) and fill in:

| Variable | Where it is used | Secret? |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Browser bundle (Auth + Realtime) | Public by design |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | API (`server/`), verifies tokens, runs queries as the caller | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | API only: Auth admin (create/ban users) and inbound webhooks | **Secret — server only** |
| `API_ALLOWED_ORIGINS` | Optional CORS allow-list for `/api/v1` | No |

On Vercel set the same variables in Project → Settings → Environment Variables.
Never prefix the service-role key with `VITE_` (that would ship it to browsers).

## 2. Apply the database migrations

With the Supabase CLI (recommended):

```bash
npx supabase init               # once: creates supabase/config.toml (keeps migrations)
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push            # applies supabase/migrations/* in order
```

Without the CLI, run each file in `supabase/migrations/` **in filename order** in
the SQL editor. The migrations are safe on the existing project: legacy tables are
created only if missing and their open policies are replaced.

Every future schema change must be a new, timestamped file in `supabase/migrations/`.

## 3. Supabase Auth settings

* Authentication → URL Configuration → **Site URL**: your deployed app URL
  (and `http://localhost:3000` under Redirect URLs for development).
* Authentication → Providers → Email: keep **Confirm email** enabled for
  production. Self-registered users are PENDING until approved either way.
* Google sign-in (optional): enable the Google provider. Google users are created
  as PENDING team members and need approval like everyone else.

## 4. Create the first Super Admin

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npm run bootstrap:super-admin -- admin@yourcompany.com "Full Name"
```

The password is prompted interactively. The database refuses this once any
Super Admin exists. From there:

* Super Admin creates Department Heads (Access & Approvals → or `POST /api/v1/users`).
* Department Heads create Team Heads and teams; Team Heads add Team Members.
* Staff can also self-register and are approved by their Team/Department Head.

## 5. Run locally

```bash
npm install
npm run dev        # Vite on :3000 with the API mounted at /api/v1
```

## 6. Tests

Both suites run against a throw-away PostgreSQL 15+/16 (no Docker needed) using a
small shim of the Supabase platform (`supabase/tests/supabase_shim.sql`).

```bash
# 123 authorization assertions: every role × every table/function
PGHOST=... PGPORT=... PGUSER=postgres npm run test:db

# 62 end-to-end API checks: HTTP handler → supabase-js → PostgREST → Postgres (RLS)
PGHOST=... PGPORT=... PGUSER=postgres POSTGREST_BIN=/path/to/postgrest npm run test:api

npm run typecheck && npm run build
```

`test:api` uses `supabase/tests/local-gateway.mjs`, a minimal stand-in for the
Supabase gateway/GoTrue (token verification, sign-in, admin create/ban). It is test
infrastructure only.

## 7. Operational notes

* **Revoking access** takes effect on the next request: every RLS helper checks
  `profiles.status = 'ACTIVE'`. The API additionally bans the auth user so the
  session cannot be refreshed.
* **Deleting users** is Super Admin only and refuses users who still own
  customers (reassign first).
* **Audit log** (`audit_logs`) is append-only; even the service role has no write
  grant on it.
