# Moving the CRM from Vercel to Cloudflare Workers (+ AWS SES for e-mail)

> **E-mail provider update:** the owner chose **AWS SES** instead of Resend. Setup: `AWS_SES_SETUP.md`. The step-by-step go-live is in
> `GO_LIVE_RUNBOOK.md`. Where this page says Resend, read SES: the same backup rules apply (`EMAIL_PROVIDER=ses`, keys `SES_*`).

Why: the Vercel Hobby plan's limits (function invocations, build minutes, the commit-author block in `DEPLOYMENT_VERCEL.md`, cron only
twice a day) do not fit a production CRM. Cloudflare Workers runs the same code at the edge, serves the static frontend for free and without
limit, and costs a flat **US$5 / month** (Workers Paid) for 10 million API requests a month. E-mail moves to **Resend**, whose HTTPS API
works on Workers (SMTP does not).

Nothing changes for the database (Supabase), file storage (Cloudflare R2 / Supabase Storage) or the code's behaviour.

---

## 1. What was built (the plan, as implemented)

| Was on Vercel | Now on Cloudflare | Where |
| --- | --- | --- |
| Static frontend (`dist/`) | Workers **static assets** (free, unlimited requests) | `wrangler.jsonc` → `assets` |
| `api/crm.ts` function (`/api/v1/*`, Hono) | the same Hono `app.fetch` inside the Worker | `worker/index.ts` |
| `api/proxy.ts`, `api/webhook.ts`, `api/webhooks/[...path].ts` | the **same handler files**, run through a small request/response adapter | `worker/nodeHandler.ts` |
| `vercel.json` rewrites (SPA fallback, webhook paths) | Worker routing: app screens → `index.html`; missing `/api`, `/assets`, `/ocr` files → 404 | `worker/index.ts` |
| `vercel.json` security headers | `public/_headers` (static files) + `worker/securityHeaders.ts` (Worker responses); a test keeps them identical | |
| `vercel.json` crons (03:30 and 05:00 UTC) | Cron Triggers at the same times, calling the same dispatch endpoint with `CRON_SECRET` | `wrangler.jsonc` → `triggers` |
| Vercel IP / geo headers (`x-vercel-ip-*`) | Cloudflare's `cf-connecting-ip` and `request.cf` (forged headers are dropped first) | `worker/index.ts`, `server/security/clientNetwork.ts` |
| Environment variables | Worker **Variables and Secrets** (they appear in `process.env`, so `server/` is unchanged) | dashboard / `wrangler secret put` |
| SMTP (nodemailer, Gmail app password) | **Resend** HTTPS API (`EMAIL_PROVIDER=resend`), already supported by `server/automations/providers.ts`; calls spaced to Resend's rate limit, a 429 is waited out and retried. The **meta@amuwa.com mailbox stays as the fallback** (section 1b) | |

Code-level changes needed for the Workers runtime (each covered by a test):

* `@hono/node-server` (the Node adapter used by Vercel, Vite dev and the tests) replaces the global `Response` class when it is imported; the Worker
  build aliases it to a stub (`worker/stubs/honoNodeServer.ts`). Without this every request fails with "did not resolve to 'Response'".
* `nodemailer` cannot run on Workers (it needs Node's `net` / `tls`): it is aliased to a stub there, and SMTP goes through the CRM's own
  small SMTP client over Cloudflare's TCP sockets (`server/automations/smtpSocket.ts`, registered by `worker/entry.ts`).
* `/api/proxy` (`server/net/safeFetch.ts`): Node's `http` with a custom DNS check is not available on Workers, so it uses `fetch` with the same URL
  checks on every redirect hop, the same time and size limits; Cloudflare's network itself has no route to private / metadata addresses.

**Vercel keeps working** with this code (nothing was removed), so both can run side by side during the move, and going back is just DNS.

## 1b. E-mail fallback: Resend first, the meta@amuwa.com mailbox when Resend refuses

With `EMAIL_PROVIDER=resend` **and** the mailbox settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) set, every e-mail goes to Resend
first. If Resend does not accept it, the **same e-mail** (same sender, recipients, CC / BCC, attachments) is sent at once through the mailbox:

| Resend's answer | What happens |
| --- | --- |
| accepted | sent by Resend; the mailbox is not used |
| 429 daily / monthly **quota reached** | sent through the mailbox; for the next 15 minutes e-mails go straight to the mailbox (no waiting for the same refusal) |
| 429 too many requests (after one wait-and-retry), 401 / 403 (key or domain refused), 5xx or unreachable | sent through the mailbox |
| **no answer in time** (timeout) | **not** sent again: Resend may have sent it, and the client must not get it twice. It stays queued and is retried |
| 422 / 400 (an invalid address or request) | not sent again: the mailbox would refuse it too |
| both Resend and the mailbox refuse | kept queued and retried at the next run, with both reasons in the log |

The delivery log shows `Sent through the SMTP mailbox (fallback): Resend HTTP 429 …` for an e-mail the mailbox sent.
`EMAIL_FALLBACK=off` turns the fallback off. Google Workspace allows about 2,000 e-mails a day from one mailbox, plenty as a fallback.

On the Worker, SMTP uses TLS from the first byte (port 465, as now) or STARTTLS (587); the password is never sent unencrypted. Keep the
same `SMTP_*` values as on Vercel (the app password of meta@amuwa.com).

### Tests

| Command | What it proves |
| --- | --- |
| `npm run test:unit` → `cloudflare_worker` | headers match, forged IP / place headers are dropped, the adapter, routing (404 vs app page), cron times, Resend 429 / pacing |
| `npm run test:unit` → `smtp_fallback` | the Worker SMTP client (TLS 465, STARTTLS 587, sign-in, BCC, attachments, no header injection) and every fallback rule in 1b |
| `npm run test:worker` (also in CI) | the **real Workers runtime** (`wrangler dev` / workerd) against PostgreSQL + PostgREST: static files and headers, sign-in and API calls, the lead webhook, `/api/proxy` refusing internal addresses, a Supabase auth e-mail delivered through Resend (a local stand-in), and through the SMTP mailbox over Cloudflare sockets when Resend answers "daily quota reached", the cron run completing the dispatch, and invoice / HR PDFs, R2 signed links and AES encryption **byte-identical to Node.js** |

---

## 2. What the owner needs to do / provide

You do these steps yourself. No one else needs your passwords or keys: paste secrets only into the Cloudflare, Resend and Supabase
dashboards, never into chat, files or commits.

**Accounts and decisions**

1. A **Cloudflare account** with the **Workers Paid** plan (US$5/month). The free plan stops each request after 10 ms of CPU time, which is too
   little for invoice PDFs, HR documents and the automation runs.
2. A **Resend account** (free: 3,000 e-mails a month, at most 100 a day; Pro US$20: 50,000 a month, no daily cap). Choose Pro if the CRM sends
   more than 100 e-mails on a busy day (welcome e-mails, invoices, HR reminders and password resets all count).
3. Decide the **web address**: keep `crm.amuwacorporation.com` (recommended; links in e-mails already use it) or another one. To attach a
   domain to a Worker, the domain's DNS must be managed by Cloudflare (move the nameservers of `amuwacorporation.com` to Cloudflare; Cloudflare
   imports the existing records).
4. Access to the DNS of **amuwa.com** (the sending address `meta@amuwa.com`), to add Resend's records.

---

## 3. Step by step

### Step A: Resend (do first, it takes a while for DNS to verify)

1. Resend → **Domains → Add domain** → `amuwa.com` (region closest to your users). Add the shown DNS records (DKIM `TXT`, and the `MX` + SPF `TXT`
   on the `send` subdomain) where `amuwa.com`'s DNS is hosted. Wait for **Verified**.
   These records do not touch the Google Workspace mailbox: Resend uses its own `send.` subdomain for the bounce address.
2. Recommended: add a DMARC record if there is none: `TXT _dmarc.amuwa.com  "v=DMARC1; p=none;"`.
3. Resend → **API Keys → Create**: permission **Sending access**, domain `amuwa.com`. Copy it once (it starts with `re_`).

### Step B: Cloudflare Worker

1. Cloudflare dashboard → **Workers & Pages → Create → Import a repository** → GitHub `shreya-amuwa/ai-crm`.
   * Project / Worker name: **`ai-crm`** (must equal `name` in `wrangler.jsonc`).
   * Production branch: `main`.
   * Build command: `npm run build`. Deploy command: `npx wrangler deploy`.
     Non-production branch deploy command: `npx wrangler versions upload` (every pull request gets a preview link).
   * **Build variables** (Worker -> Settings -> **Build** -> Variables and secrets; used when the frontend is built, public values only):
     `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (same values as on Vercel). They must be BUILD variables: a runtime Worker variable is not
     visible to `vite build`. `scripts/check-build-env.mjs` (part of `npm run build`) stops a Cloudflare build that lacks them, or that has a secret
     in a `VITE_` name (it recognises Cloudflare's own build through `WORKERS_CI`; add the build variable `REQUIRE_BUILD_ENV=1` if it does not).
2. Worker → **Settings → Variables and Secrets**. Add every value you have on Vercel today (Vercel → Project → Settings → Environment Variables),
   as **Secret** for anything sensitive. `CRM_PLATFORM` and `EMAIL_PROVIDER` are already set by `wrangler.jsonc`. At minimum:

   | Name | Value |
   | --- | --- |
   | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (secret) | as on Vercel |
   | `EMAIL_API_KEY` (secret) | the Resend key from step A3 |
   | `EMAIL_FROM` | `Amuwa Corporation <meta@amuwa.com>` |
   | `EMAIL_REPLY_TO`, `EMAIL_CC`, `EMAIL_BCC` | as on Vercel, if set |
   | `CRON_SECRET` (secret) | any random string of 16+ characters (or keep `AUTOMATION_DISPATCH_SECRET`) |
   | `APP_URL` | the final address, e.g. `https://crm.amuwacorporation.com` |
   | `AUTOMATION_MODE`, `AUTOMATION_SECRET_KEY` (secret), `WHATSAPP_WEBHOOK_URL` (secret), `WEBHOOK_SECRET` (secret), `WEBHOOK_VERIFY_TOKEN`, `SUPABASE_AUTH_HOOK_SECRET` (secret), `BIOMETRIC_INGEST_SECRET` (secret), `WABASTORE_*`, `R2_*` (secrets), `ANTHROPIC_API_KEY` (secret), `GOOGLE_MAPS_API_KEY` (secret), … | everything else exactly as on Vercel |

   **Do copy `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (secret)**: the meta@amuwa.com mailbox is the fallback when Resend refuses
   (section 1b). Optional: `RESEND_MAX_PER_SECOND` (default 5) if your Resend account allows more.
3. **Deploy** (Deployments → Retry / push to `main`). Open the `https://ai-crm.<your-subdomain>.workers.dev` address and check:
   `…/api/v1/health` shows `"status":"ok"`; sign in; open a few dashboards; generate one invoice PDF.
4. Worker → **Settings → Triggers**: the two cron schedules from `wrangler.jsonc` are listed. **Settings → Observability**: logs are on.

### Step C: switch the address (the cut-over)

1. If not done yet: add `amuwacorporation.com` to Cloudflare (Add a site → Free plan) and change its nameservers at the registrar.
2. Worker → **Settings → Domains & Routes → Add → Custom domain** → `crm.amuwacorporation.com`. Cloudflare creates the DNS record and the
   certificate. (Remove the domain from the Vercel project first, or the old `CNAME` to Vercel will be in the way.)
3. Update everything that calls the CRM by address (use the new address everywhere):
   * **Supabase → Authentication → URL Configuration**: Site URL and Redirect URLs.
   * **Supabase → Authentication → Hooks → Send Email** (if on): `https://<address>/api/v1/internal/auth/email-hook`.
   * **Supabase pg_cron / database webhooks** that call `/api/v1/internal/automations/dispatch`, if any.
   * **Cloudflare R2 → bucket → Settings → CORS**: add the new address to `AllowedOrigins` (`docs/CLOUDFLARE_R2.md`), or file uploads fail.
   * Senders of the **lead webhook** (n8n, WhatsApp, forms, the Google Apps Script on the Expenses page), the **Wabastore delivery-status webhook**
     and the **biometric gateway**, if they used the `ai-crm-drab.vercel.app` address.
   * The staff manual links (`docs-site/content/...`) still name `ai-crm-drab.vercel.app`: update them in a small follow-up change once the final address is known.
3b. **Run the smoke test** from your computer against the new address: `node scripts/cf-smoke.mjs https://<address> --expect=cloudflare --supabase-host=<project>.supabase.co`.
   Every line must be PASS; read each WARN. It checks routing, headers, caching, the API's privacy, the webhook and e-mail-hook addresses, and
   what `/api/v1/health` says about the platform, the schedule and file storage. The sign-in, upload and chat checks are in `CLOUDFLARE_AUDIT.md`.
4. **Run the automations on ONE platform only.** At go-live set `SCHEDULED_ENABLED=true` on the Worker AND `VERCEL_CRON_PAUSED=true` on Vercel (a
   variable, no redeploy of code needed) in the same hour; `/api/v1/health` shows `scheduledAutomations` for each. Until the Worker has
   `SCHEDULED_ENABLED=true` the Worker's cron does nothing, and until Vercel is paused its cron keeps calling the same database.
5. Send one test of each e-mail type you rely on (a password reset, a new employee welcome e-mail, an invoice e-mail) and check Resend → **Emails**.

### Step D: after a week without problems

* Remove the old Vercel project (or keep a one-line redirect there for old bookmarks to `ai-crm-drab.vercel.app`).
* In a separate pull request: delete `vercel.json`, `@vercel/node`, and `docs/DEPLOYMENT_VERCEL.md` (keep `api/*.ts`: the Worker uses them).
* Keep `SMTP_*` on the Worker: it is the e-mail fallback.

## Is merging this safe while users are on Vercel?

Yes, by design, and checked by the full test suite on the Node.js (Vercel) code path:

* Merging deploys the same app to Vercel as before. Everything Cloudflare-specific is inactive there: the Worker files are not part of the
  Vercel build, the Cloudflare IP / place reading needs `CRM_PLATFORM=cloudflare`, the fetch-based `/api/proxy` path and the socket SMTP
  client only run inside Workers.
* E-mail on Vercel is unchanged while `EMAIL_PROVIDER` stays `smtp` (nodemailer, as today). The Resend pacing and the fallback apply only
  once `EMAIL_PROVIDER=resend` is set.
* No database migration, no change to stored data.
* While the Vercel "Deployment was blocked" issue (`DEPLOYMENT_VERCEL.md`) is not fixed, merge with **Rebase and merge**.

What needs care is the **cut-over** (Step C), not the merge: test on the `workers.dev` address first while users stay on Vercel. On a new
address users sign in once more (sign-in is kept per web address), so switch at a quiet hour.

**Rollback** at any time before step D: point the domain back to Vercel (Step C2 in reverse) and set `EMAIL_PROVIDER` back on Vercel.
Nothing in the database changes, so going back loses no data.

---

## 4. Running it locally

```bash
npm run build
npx wrangler dev          # the Worker on http://localhost:8787 (put local secrets in .dev.vars, never committed)
```

`npm run dev` (Vite with the API inside it) keeps working as before.

## 5. Limits worth knowing

* Workers Paid: 30 s of **CPU** time per request by default (waiting for the database does not count), 10 million requests / month included,
  then US$0.30 per million. Static files are free and do not count.
* Every request runs in a fresh or reused isolate; the in-memory rate limits (`RATE_LIMIT_*`) are per isolate, as they were per Vercel instance.
* Cron Triggers can run more often than Vercel Hobby allowed (for example every 15 minutes for faster e-mail retries); the times were kept
  the same on purpose so behaviour does not change. Change `triggers.crons` in `wrangler.jsonc` to run more often.

## Database load: Realtime tables and the Crocodial sync interval (19 Nov 2026)

On 19 Nov 2026 the Supabase database ran out of CPU in the afternoon and evening: logins, attendance and the 5-minute jobs timed out and the Worker
logged `[api] could not reach Supabase: TimeoutError`. Two contributions are reduced:

* **Realtime.** 56% of all database time was Supabase Realtime working through every change of the 40 tables in the `supabase_realtime`
  publication. Migration `20270116000200_realtime_publication_trim.sql` removes the 6 tables no screen listens to (`hr_attendance`,
  `hr_leave_applications`, `team_assignments`, `department_operations_owner`, `onboarding_automation_runs`, `support_ticket_escalations`). Every table
  a screen listens to stays (`supabase/tests/realtime_publication_trim_test.sql` lists them). A new screen that listens to a table must publish it
  in its own migration (`alter publication supabase_realtime add table public.<name>;`).
* **Crocodial sync.** It ran on every 5-minute tick (a large first read wrote all afternoon). It now runs every `CROCODIAL_SYNC_EVERY_MINUTES`
  (Worker variable; 5, 10, 15, 20, 30 or 60 = default; `0` = only when the Super Admin starts one), on the ticks whose minute is a multiple of it.
  Each run reads at most 10 pages per list, writes only the Crocodial records that changed, and never re-reads everything on its own (only the
  Super Admin's **Sync now** does the weekly full re-read; migration `20270127000100_crocodial_sync_quiet.sql`).
  The attendance reminders keep running every 5 minutes.
* **One dispatcher only.** The scheduled jobs (the 5-minute reminders and Crocodial sync, the daily automations) must run from exactly one place:
  the production Worker with `SCHEDULED_ENABLED=true` and `CRON_SECRET` set. Vercel's cron must be paused (`VERCEL_CRON_PAUSED=true`) and any
  rehearsal or preview copy of the Worker must leave `SCHEDULED_ENABLED` unset. Two places with the switch on run every reminder and every sync
  twice.

If the database is still slow: Supabase → Reports → Database (CPU), and Project Settings → Compute and Disk (a larger compute size removes the
CPU throttling of the smallest one).


## Attendance reminders and push (migration 20270126000200)

The reminders need all of these on the **production** Worker (`ai-crm`); none of them can be checked from GitHub:

1. **Variables / secrets** (Worker → Settings → Variables and Secrets): `SCHEDULED_ENABLED=true`; `CRON_SECRET` (or `AUTOMATION_DISPATCH_SECRET`,
   16+ characters); `VAPID_PRIVATE_KEY` (the private key as a JWK, secret), `VAPID_SUBJECT` (`mailto:` or `https:`), and `VAPID_PUBLIC_KEY`
   if set must be the private key's own public key (otherwise push is switched off and the log says so). Optional `PUSH_MAX_PER_RUN`
   (default 40; the Free plan allows 50 subrequests per invocation, raise it on the Paid plan, e.g. 400).
2. **Cron**: Worker → Settings → Triggers lists `*/5 * * * *` (from `wrangler.jsonc`). Exactly one platform runs it: `VERCEL_CRON_PAUSED=true` on
   Vercel if Vercel still exists, and no second Worker (e.g. a workers.dev rehearsal copy) with `SCHEDULED_ENABLED=true` against the same database.
3. **Check** after deploying: Worker → Logs shows `[cron] attendance reminders: HTTP 200 {... "mode":"outbox" ...}` every 5 minutes, and
   Super Admin → Notification Health shows the scheduler as **Healthy** and push as configured. "Not running" there means the cron, the
   switch or the secret is wrong; "Push configuration unavailable" means the VAPID settings are missing or do not match.
4. Run `supabase/migrations/20270126000200_notification_reliability.sql` in the Supabase SQL editor (before or after the deploy: the API falls
   back to the previous reminder path until it exists).

## E-mail: Resend first, SES later (migration 20270130000100)

See `docs/EMAIL_MANAGEMENT.md` sections 8–10. In short, on the production Worker: `EMAIL_PROVIDER=resend`, secret `EMAIL_API_KEY` (sending-only
Resend key), `EMAIL_FALLBACK=on` with the working `SMTP_*` mailbox, secret `RESEND_WEBHOOK_SECRET` (Resend webhook to
`/api/v1/internal/email/resend-webhook`), `SES_REGION=ap-southeast-2`, and `EMAIL_SES_PRODUCTION_ENABLED=false` until AWS grants SES production
access. Rollback: set `EMAIL_PROVIDER` back to the previous provider (no deploy needed).
