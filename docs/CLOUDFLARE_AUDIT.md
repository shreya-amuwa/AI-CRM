# Cloudflare deployment audit (14 November 2026)

**Is the move from Vercel to Cloudflare finished and production-ready? It cannot be confirmed from here, and the evidence available points to
"not finished yet".** The code is ready for Cloudflare and tested; whether the live site runs on it, with the right settings, was not and could not be
verified. Nothing below is marked PASS because a configuration file exists.

## How this was audited, and its limits

* Done: the whole repository read; the Worker bundled with `wrangler deploy --dry-run`; the built app run in the **real Workers runtime** locally
  (`wrangler dev` / workerd) and probed for routing, headers, caching and CORS; the repository's own Worker unit tests; the GitHub Actions record of `main`;
  an inventory of every environment variable the code reads; a search for Vercel leftovers.
* **Not possible from here** (the audit environment's network blocks `crm.amuwacorporation.com` and `*.vercel.app`, and there is no Cloudflare, Supabase,
  Vercel or DNS access): the live site, the Cloudflare dashboard (deployments, logs, variables, domains, R2), the live Supabase project and its migration
  state, real sign-in per role, real uploads, chat, realtime, e-mail. Those are in the manual checklist (section 4).

## 1. What the application actually is

| Question | Answer (read from the code) |
| --- | --- |
| Frontend | Vite 5.4 + React 18.3 single-page app (`src/`). **Not Next.js**, so there is no Next.js configuration and no OpenNext / adapter question. |
| Backend | One Hono 4 API (`server/app.ts`, about 690 routes under `/api/v1`: 616 staff, 50 client, 21 candidate) plus three small handlers (`api/proxy.ts`, `api/webhook.ts`, `api/webhooks/[...path].ts`). |
| Deployment platform in the repo | **Cloudflare Workers**: one Worker serves the built frontend (static assets) and the whole API (`wrangler.jsonc`, `worker/`). **Not Pages.** The same code still runs on Vercel (`vercel.json`, `api/`), by design, for a side-by-side move and rollback (`docs/DEPLOYMENT_CLOUDFLARE.md`). |
| Database / auth | Supabase (Postgres, Auth, Realtime). The API verifies each request through one database call (`api_session`). Realtime runs browser to Supabase directly, so it does not depend on the hosting platform. |
| Files | Cloudflare R2 through presigned S3 URLs (`server/storage/*`, signed with `node:crypto`, which the Worker provides with `nodejs_compat`). |
| Scheduled jobs | Two Cron Triggers (03:30 and 05:00 UTC, as in `vercel.json`) calling `/api/v1/internal/automations/dispatch`, **gated by `SCHEDULED_ENABLED`**. |

## 2. Status

| Component | Status | Details |
| --- | --- | --- |
| Frontend deployment | PARTIAL | Verified: production build passes; the Worker bundles (3.9 MB, 1.25 MB gzip, 531 static files); in the real Workers runtime `/` and every app screen (`/dashboard`, `/client/login`, `/set-password`, `/book/...`) open, hashed assets are cached for a year, a missing `/assets` file is a JSON 404 (not the app page), docs open. **Not verified:** the live site; whether `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` were set as *build* variables on Cloudflare (a missing one builds fine and breaks sign-in). |
| Backend deployment | PARTIAL | The same Hono app runs inside the Worker (tested). `main`'s CI job "Cloudflare Worker end-to-end (Workers runtime → PostgREST → Postgres)" passed on the latest merge. No evidence that the live Worker exists, is current, or has its settings. |
| API endpoints | PARTIAL | Every `/api/v1` route is the same code on both platforms, and every `api/*.ts` function has a Worker route (`/api/proxy`, `/api/webhook`, `/api/webhooks/...`); no contract was changed. Verified locally: protected routes answer 401 with `Cache-Control: no-store`, unknown routes 404, no CORS allow header for an unknown origin. **Not run:** each API group against a real database (the CI Worker job covers sign-in and the main flows, not all ~690 routes). |
| Supabase connection | NOT VERIFIED | `/api/v1/health` on the live address reports the Supabase host and database state: run `scripts/cf-smoke.mjs` (section 4). |
| Database migrations | NOT VERIFIED | 210 migration files; production state is unknowable from here. `scripts/migration-probe.mjs` produces a read-only check for your Supabase SQL editor (tested: no false alarms on a fully migrated database, and it names the files of missing ones). Nothing was run against production. |
| Authentication | PARTIAL | JWT verification is done by PostgREST/Supabase inside `api_session`, not by a secret in the Worker. Covered by the CI Worker test. Supabase Auth Site URL / redirect URLs for the Cloudflare address: NOT VERIFIED (manual). |
| RLS and permissions | PARTIAL | The database suite (7,000+ checks) passes on `main`; unchanged by this audit. The live database's policies are NOT VERIFIED (same reason as migrations). |
| Cloudflare R2 | PARTIAL | Code read: presigned PUT 15 min, signed GET 2 min, server-side verification of size and file type, private bucket; it runs on Workers (the signing uses `node:crypto`). **Not verified:** the real bucket, its CORS list for the address now in use, the `R2_*` variables on the Worker, a real upload/download. `/api/v1/health` now reports `fileStorage` (`r2` or `supabase`). |
| Environment variables | PARTIAL | Complete inventory: 93 server variables. **26 were missing from `.env.example`** (including `SUPABASE_AUTH_HOOK_SECRET`, `SCHEDULED_ENABLED`, `R2_ENDPOINT`, `WABASTORE_*`): fixed and guarded by a test. No `VITE_` variable holds a secret. What is actually set on Cloudflare: NOT VERIFIED. |
| Domain and DNS | NOT VERIFIED | `crm.amuwacorporation.com` is the production address used throughout the code and docs. Which platform answers on it, DNS, the custom-domain binding and leftover Vercel records need the dashboards (section 4). |
| SSL/HTTPS | NOT VERIFIED | The app sends HSTS (1 year) on every response, API and static. The certificate and the http→https redirect are Cloudflare settings: `cf-smoke.mjs` checks the redirect. |
| Realtime | NOT VERIFIED | Browser ↔ Supabase directly; the Content-Security-Policy allows `wss:`. Needs a signed-in test (chat, notifications). |
| Background jobs | PARTIAL | Cron Triggers are configured with the same times as Vercel. **They do nothing until `SCHEDULED_ENABLED=true`**, and while Vercel's cron is not stopped it keeps calling the same database. See finding 2. |
| Performance | PARTIAL | Worker script 1.25 MB gzip (limit 10 MB paid). Static files are served by Cloudflare without Worker time. API start-up and database latency on the live deployment: NOT VERIFIED. |
| Production testing | NOT VERIFIED | Nothing could be run against production. Section 4 lists what to run; `cf-smoke.mjs` does the part that needs no login. |

## 3. Findings

| # | Severity | Finding | Status |
| - | -------- | ------- | ------ |
| 1 | High | **The cut-over cannot be confirmed, and the evidence is that Vercel is still live.** Every pull request and every merge to `main` today (including PR #219) still gets a Vercel preview/production deployment (Vercel project `ai-crm8/ai-crm`), and no Cloudflare build check appears on any pull request. Either Vercel is still serving, or both are running. | **Open: your check** (section 4, A) |
| 2 | High | **Automations may be running twice or not at all.** On the Worker the cron is off until `SCHEDULED_ENABLED=true`; on Vercel the cron runs unless the Vercel deployment is removed. Both talk to the same database. Nothing in the repository could stop Vercel's cron except a code change. | **Fixed in the repo:** `VERCEL_CRON_PAUSED=true` (a Vercel variable) makes Vercel's own cron calls skip; `/api/v1/health` reports `platform` and `scheduledAutomations`. **Open:** set the variables (section 4, C) |
| 3 | High | **A Cloudflare build without `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` succeeds and ships a site where nobody can sign in.** They must be *build* variables; a Worker runtime variable is invisible to the build. | **Fixed:** `scripts/check-build-env.mjs` (in `npm run build`) stops such a Cloudflare build and any `VITE_` secret; the smoke test checks the built bundle. **Open:** set them as build variables |
| 4 | Medium | 26 variables read by the code were not in `.env.example`, so the Cloudflare dashboard could not be checked against one list (and the sign-up e-mail hook secret was easy to forget). | **Fixed** + test (`cloudflare_audit`) |
| 5 | Medium | The R2 bucket's CORS list documented only the Vercel address. A new address (the production domain, the `workers.dev` rehearsal address) cannot upload files until it is listed. | **Docs fixed. Open:** edit the bucket's CORS (section 4, D) |
| 6 | Medium | Everything outside the repository that names the CRM's address must follow the move: Supabase Auth URLs and Send-Email hook, any Supabase `pg_cron` / database webhook, senders of the lead webhook (n8n, the Apps Script), the Wabastore status webhook, the biometric gateway, R2 CORS. | **Open: yours** (section 4) |
| 7 | Low | The staff / client manuals told users to sign in at `ai-crm-drab.vercel.app`; the n8n workflow template still builds links to it. | Manuals **fixed**; n8n template **open** (edit the link in your live n8n workflow) |
| 8 | Info | **Vercel files are still needed** and were not removed: `api/*.ts` are run by the Worker (they import only *types* from `@vercel/node`, which therefore must stay a dev dependency), and `vercel.json` / `docs/DEPLOYMENT_VERCEL.md` are the rollback path. Remove them in a separate change after a quiet week (`DEPLOYMENT_CLOUDFLARE.md`, step D). | Kept on purpose |
| 9 | Low | The Worker's default `workers.dev` address stays public unless switched off, so after cut-over the production app (with production secrets) has a second front door. | **Open:** disable it after go-live if you do not want it (Worker → Settings → Domains & Routes) |
| 10 | Info | 19 migration timestamps are shared by two or more files (for example `20261229000200_*`). Fine for pasting into the SQL editor (order is by full file name); would matter only if the Supabase CLI's migration history were used. | Noted |
| 11 | Info | The brief assumed Next.js (and possibly OpenNext). The app is a Vite single-page app on a Worker with static assets, which needs no adapter. | Not an issue |

Not found: server secrets in browser variables; private data being cacheable (API responses are `no-store`, verified; Cloudflare reports no cache hit for them);
Node-only code that Workers cannot run (the Worker bundles, and the runtime test compares Node and Worker results).

## 4. What you need to do

**A. Find out where production runs (10 minutes).** From your computer:

```bash
node scripts/cf-smoke.mjs https://crm.amuwacorporation.com --expect=cloudflare --supabase-host=<your-production-project>.supabase.co
```

`FAIL ... through Cloudflare` or `platform is "vercel"` means the domain is still served by Vercel. Also open Cloudflare → Workers & Pages → `ai-crm` → Deployments
(latest deployment green? built from `main`?) and Settings → Domains & Routes (is `crm.amuwacorporation.com` listed?).

**B. Build variables (Worker → Settings → Build → Variables and secrets):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public values only). Optionally `REQUIRE_BUILD_ENV=1`.

**C. Runtime variables and secrets (Worker → Settings → Variables and Secrets), names only; secrets marked (S):**

* Core: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (S), `APP_URL` (`https://crm.amuwacorporation.com`), `CRM_PLATFORM` (already `cloudflare` in `wrangler.jsonc`).
* Files (R2): `R2_ACCOUNT_ID` (or `R2_ENDPOINT`), `R2_ACCESS_KEY_ID` (S), `R2_SECRET_ACCESS_KEY` (S), `R2_BUCKET`; optional `STORAGE_PROVIDER`.
* Schedule: `CRON_SECRET` (S) or `AUTOMATION_DISPATCH_SECRET` (S), 16+ characters; `SCHEDULED_ENABLED` = `true` **at go-live only**; `AUTOMATION_MODE`, `AUTOMATION_SECRET_KEY` (S).
* E-mail: `EMAIL_PROVIDER`, `EMAIL_FROM`, the provider key (`EMAIL_API_KEY` (S) or the `SES_*` set), and `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (S) for the mailbox fallback.
* Sign-up e-mails (if the Supabase Send Email hook is on): `SUPABASE_AUTH_HOOK_SECRET` (S).
* If used: `WEBHOOK_SECRET` (S) and `WEBHOOK_VERIFY_TOKEN` (lead webhook); `BIOMETRIC_INGEST_SECRET` (S); `WABASTORE_WEBHOOK_URL` (S), `WABASTORE_API_KEY` (S), `WABASTORE_STATUS_SECRET` (S); `BOLIFY_*`; `ANTHROPIC_*` / `BA_AI_*`; `WHATSAPP_WEBHOOK_URL` (S); `API_ALLOWED_ORIGINS` (only if the frontend is served from a different address than the API).
* The full list with what each does: `.env.example`. Compare it with Vercel → Settings → Environment Variables: **nothing carries over automatically**.
* **On Vercel, at the same time as `SCHEDULED_ENABLED=true` on Cloudflare:** add `VERCEL_CRON_PAUSED` = `true`. Check `/api/v1/health` on both: exactly one shows `scheduledAutomations: "on"`.

**D. Cloudflare R2 → the bucket → Settings → CORS:** `AllowedOrigins` must contain `https://crm.amuwacorporation.com` (and the `workers.dev` address while testing); `AllowedMethods` PUT, GET, HEAD; `AllowedHeaders` Content-Type; no trailing `/`.

**E. Supabase (project → Authentication → URL Configuration):** Site URL and Redirect URLs use `https://crm.amuwacorporation.com`; Send Email hook URL `https://crm.amuwacorporation.com/api/v1/internal/auth/email-hook`; any `pg_cron` / webhook that calls `/api/v1/internal/automations/dispatch`.

**F. Migrations:** `node scripts/migration-probe.mjs > probe.sql`, paste it into the Supabase SQL editor of the production project. No rows = everything the migrations create exists. Rows name the migration files to review and run (in date order). No SQL needs approval from this audit: none is proposed.

**G. DNS / certificate (Cloudflare → the zone):** `crm` points to the Worker (custom domain); no leftover `CNAME` to `cname.vercel-dns.com` or Vercel `A` record; SSL/TLS mode Full (strict); "Always Use HTTPS" on.

**H. Signed-in checks (use test accounts and test records; do not touch real customers):** sign in and out as each role (Super Admin, Admin, Department Head, Team Lead, Team Member,
Business Associate, Technical Consultant, Accounts, HR) and open its dashboard; client login at `/client/login`; create a test lead; upload then download a test customer document (this
proves R2, its CORS and the `R2_*` variables); open a test ticket; send a chat message from a second browser (proves realtime); one attendance punch; one leave request; one HR
recruitment screen; one report. Then Cloudflare → the Worker → **Logs** (observability is on): no errors during these steps.

## 5. What was changed in this branch

| Change | Files |
| --- | --- |
| `/api/v1/health` also reports `platform`, `scheduledAutomations` and `fileStorage` (no secret, additive) | `server/health.ts`, `server/platform.ts` |
| `VERCEL_CRON_PAUSED=true` stops Vercel Cron's own calls (opt-in, default unchanged; other authenticated callers still run) | `server/app.ts`, `server/platform.ts` |
| Cloudflare builds stop when the frontend's Supabase settings are missing or a `VITE_` name holds a secret | `scripts/check-build-env.mjs`, `package.json` (`prebuild`) |
| `.env.example` lists every variable the server reads; a test keeps it that way | `.env.example`, `supabase/tests/cloudflare_audit.test.ts` |
| Read-only smoke test of a deployed address | `scripts/cf-smoke.mjs` |
| Read-only migration check for the Supabase SQL editor | `scripts/migration-probe.mjs` |
| R2 CORS guidance, manuals' sign-in address, go-live steps in the deployment guide | `docs/CLOUDFLARE_R2.md`, `docs-site/content/...`, `docs/DEPLOYMENT_CLOUDFLARE.md` |

No business logic, permission, database object, DNS, Cloudflare or Vercel setting was changed, and no migration is needed.
