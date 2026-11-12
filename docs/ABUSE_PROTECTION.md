# Abuse protection: rate limits, bot check, throwaway e-mails

Protects the public endpoints of the CRM and everything the Candidate Portal does, against bots, mass sign-ups, password guessing, reset-mail
floods and scraping. Code: `server/security/abuse.ts`, the routes in `server/app.ts`, `server/automations/authEmailHook.ts`;
tests: `supabase/tests/abuse_protection.test.ts` (unit), the "abuse:" block of `api_integration.test.ts` (database) and section 3b of
`worker_e2e.test.ts` (Workers runtime).

## The layers

1. **Cloudflare's edge (dashboard, no code):** the free managed WAF rules on the `amuwacorporation.com` zone (`GO_LIVE_RUNBOOK.md`,
   phase 4). **Do not turn on "Bot Fight Mode"**: it challenges server-to-server calls (the Candidate Portal's server, Supabase's e-mail
   hook, the WhatsApp / n8n / biometric webhooks), which would break sign-up e-mails and the portal, and on the free plan it cannot be
   switched off for those paths. Turnstile and the limits below do that job without the risk.
2. **Flood limit per address:** on the Worker, Cloudflare's rate limiter (`FLOOD_LIMITER` in `wrangler.jsonc`, 600 requests a minute per
   address, counted by Cloudflare rather than by each short-lived copy of the server). On Node.js (Vercel, local) the in-memory limiter,
   as before.
3. **Limits counted in the database** (`rate_limit_consume`, shared by every server instance) for everything that creates accounts or sends
   e-mail, and per-candidate ceilings.
4. **Cloudflare Turnstile** on the portal's sign-up, sign-in, forgot-password and apply forms (usually invisible).
5. **Throwaway e-mail domains** refused at sign-up (a public list of about 10,000 domains, CC0,
   `server/security/disposableDomainList.ts`).

## The visitor's real address (Candidate Portal)

The portal calls the CRM from its own server, so without help the CRM sees **one** address for every candidate (a busy hour could hit the
sign-up limit for everyone, and one abuser could use up everyone's allowance). The portal therefore adds, to every call:

```
x-portal-client-ip:  the visitor's address (from Vercel's own headers)
x-portal-client-ts:  Unix seconds
x-portal-client-sig: hex HMAC-SHA256(PORTAL_FORWARD_SECRET, "<ip>.<ts>")
```

The CRM believes it only with a valid signature made within 60 seconds; otherwise the caller's own address counts. The audit log records
that address too. For the job listings it caches (where a per-visitor header would split the cache) the portal sends
`x-portal-server` = HMAC(`PORTAL_FORWARD_SECRET`, "portal-server") instead, which only exempts those listings from the per-address limit. `PORTAL_FORWARD_SECRET`: a random string of 32+ characters, set on **both** the CRM (Worker secret) and the portal
(Vercel environment variable), nowhere else.

## Limits (defaults)

Each is an environment variable of the same name on the CRM; change it without a code change.

| Setting | Default | What |
| --- | --- | --- |
| `CAND_SIGNUP_PER_IP_HOUR` | 5 | candidate sign-ups per visitor an hour |
| `CAND_SIGNUP_PER_EMAIL_HOUR` | 3 | sign-up attempts per e-mail an hour |
| `CAND_SIGNUP_SITE_HOUR` | 300 | sign-ups for the whole site an hour (stops a flood from many addresses) |
| `CAND_SIGNIN_PER_IP_15MIN` | 20 | candidate sign-in attempts per visitor a quarter hour |
| `CAND_SIGNIN_PER_EMAIL_15MIN` | 10 | sign-in attempts per account a quarter hour (password guessing from many addresses) |
| `RESET_PER_IP_15MIN` | 5 | "forgot password" per visitor a quarter hour (candidate, client and staff share it) |
| `RESET_PER_EMAIL_HOUR` | 3 | "forgot password" per e-mail an hour |
| `AUTH_MAIL_PER_RECIPIENT_HOUR` | 5 | sign-in / reset / invite e-mails per recipient an hour, however they were triggered |
| `AUTH_MAIL_SITE_HOUR` | 500 | such e-mails for the whole site an hour |
| `CAND_APPLY_PER_DAY` | 10 | applications per candidate a day |
| `CAND_APPLY_GUARD_PER_IP_HOUR` | 30 | application attempts per visitor an hour |
| `CAND_UPLOAD_PER_DAY` | 20 | resume / document uploads per candidate a day |
| `CAND_PROFILE_SAVE_PER_HOUR` | 60 | profile saves per candidate an hour |
| `JOBS_PER_IP_MINUTE` | 120 | public job listing requests per visitor a minute |
| `LOGIN_FAIL_REPORT_PER_IP_15MIN` | 10 | staff "sign-in refused" reports per address a quarter hour |

A refused request gets `429 RATE_LIMITED` with `Retry-After`; "forgot password" answers the same whether or not the account exists.

## Turnstile

* Cloudflare dashboard -> Turnstile -> Add widget: hostname of the portal (e.g. `careers.amuwa.com`), mode **Managed**. You get a **site
  key** (public: the portal's `NEXT_PUBLIC_TURNSTILE_SITE_KEY`) and a **secret key** (the CRM's `TURNSTILE_SECRET_KEY`, a Worker secret).
* CRM settings: `TURNSTILE_SECRET_KEY`, `TURNSTILE_ALLOWED_HOSTNAMES` (the portal's host names, comma separated) and `TURNSTILE_MODE`:
  * `off` (default, or no secret key): nothing checked;
  * `log`: tokens checked and failures recorded in the Security & Audit log (`BOT_CHECK_FAILED`), nobody refused;
  * `enforce`: a missing, invalid, reused, wrong-site or wrong-form token is refused (`403`, reason `BOT_CHECK_FAILED`).
* The portal sends the token in the `x-turnstile-token` header to `POST /api/v1/candidate-auth/register` (action `sign_up`) and to
  `POST /api/v1/candidate-auth/guard` `{ action: 'sign_in' | 'reset' | 'apply', email? }`, which it calls before a Supabase sign-in, a
  Supabase reset e-mail and an application.
* If Cloudflare's verification service cannot be reached the request is allowed and recorded as `unreachable`: the limits still apply,
  and an outage must not lock every candidate out.
* Roll-out: deploy the CRM (accepts tokens), deploy the portal (sends them), `TURNSTILE_MODE=log` for a day, read the audit log, then
  `enforce`. Going back: `log` or `off`, instantly.

## Supabase settings (dashboard)

Authentication -> Rate Limits: keep "emails sent per hour" modest (e.g. 30) and the token / verification limits at their defaults. This
covers someone calling Supabase's own API directly with the public anon key (bypassing the portal); Supabase then counts by that caller's
real address. The CRM's own per-recipient ceiling (`AUTH_MAIL_PER_RECIPIENT_HOUR`) applies to every auth e-mail in any case, since Supabase
hands them all to the CRM's e-mail hook.

## What is not covered

* A slow, distributed attack that stays under every limit: the site-wide ceilings and Turnstile are the answer there; watch the
  Security & Audit log (`BOT_CHECK_FAILED`, many `RATE_LIMITED`).
* Staff sign-in goes from the browser straight to Supabase (Supabase's own per-address limits apply); the CRM records refused sign-ins.
