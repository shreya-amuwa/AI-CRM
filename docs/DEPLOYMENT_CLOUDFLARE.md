# Moving the CRM from Vercel to Cloudflare Workers (+ Resend for e-mail)

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
| SMTP (nodemailer, Gmail app password) | **Resend** HTTPS API (`EMAIL_PROVIDER=resend`), already supported by `server/automations/providers.ts`; calls spaced to Resend's rate limit, a 429 is waited out and retried | |

Code-level changes needed for the Workers runtime (each covered by a test):

* `@hono/node-server` (the Node adapter used by Vercel, Vite dev and the tests) replaces the global `Response` class when it is imported; the Worker
  build aliases it to a stub (`worker/stubs/honoNodeServer.ts`). Without this every request fails with "did not resolve to 'Response'".
* `nodemailer` is aliased to a stub on Workers (`worker/stubs/nodemailer.ts`): with `EMAIL_PROVIDER=smtp` a send fails with a clear
  "use Resend" message and stays queued for a retry, instead of crashing the dispatch run.
* `/api/proxy` (`server/net/safeFetch.ts`): Node's `http` with a custom DNS check is not available on Workers, so it uses `fetch` with the same URL
  checks on every redirect hop, the same time and size limits; Cloudflare's network itself has no route to private / metadata addresses.

**Vercel keeps working** with this code (nothing was removed), so both can run side by side during the move, and going back is just DNS.

### Tests

| Command | What it proves |
| --- | --- |
| `npm run test:unit` → `cloudflare_worker` | headers match, forged IP / place headers are dropped, the adapter, routing (404 vs app page), cron times, Resend 429 / pacing |
| `npm run test:worker` (also in CI) | the **real Workers runtime** (`wrangler dev` / workerd) against PostgreSQL + PostgREST: static files and headers, sign-in and API calls, the lead webhook, `/api/proxy` refusing internal addresses, a Supabase auth e-mail delivered through Resend (a local stand-in), the cron run completing the dispatch, and invoice / HR PDFs, R2 signed links and AES encryption **byte-identical to Node.js** |

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
   * **Build variables** (used when the frontend is built, public values only):
     `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (same values as on Vercel).
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

   Do **not** copy `SMTP_*`: SMTP cannot run on Workers. Optional: `RESEND_MAX_PER_SECOND` (default 5) if your Resend account allows more.
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
4. Send one test of each e-mail type you rely on (a password reset, a new employee welcome e-mail, an invoice e-mail) and check Resend → **Emails**.

### Step D: after a week without problems

* Remove the old Vercel project (or keep a one-line redirect there for old bookmarks to `ai-crm-drab.vercel.app`).
* In a separate pull request: delete `vercel.json`, `@vercel/node`, and `docs/DEPLOYMENT_VERCEL.md` (keep `api/*.ts`: the Worker uses them).
* Remove the Gmail app password (`SMTP_PASS`) from wherever it is still stored.

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
