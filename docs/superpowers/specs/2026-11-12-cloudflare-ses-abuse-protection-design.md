# Production move: Cloudflare Workers, AWS SES e-mail, abuse protection

Date: 2026-11-12. Status: agreed in conversation (sections 1–3 approved by the owner; section 4 is the owner checklist). Written for the
owner's review; the code was built overnight against this document at the owner's request.

## 0. Intent

* **Outcome:** the live CRM (`crm.amuwacorporation.com`, staff, clients, candidates' backend) runs on Cloudflare Workers (Paid plan,
  US$5/month) instead of Vercel, e-mail goes through AWS SES, and the Candidate Portal and the CRM's public endpoints resist bots and abuse.
* **Constraints:** a live system with real users: no lost e-mails, no broken sign-ins, no visible downtime, a tested way back at every step,
  one change at a time. The Candidate Portal stays on Vercel. Nothing is merged or switched without the owner.
* **Success:** after go-live, error rate and response times are no worse than on Vercel, every e-mail type is delivered, sign-up / sign-in work,
  and abusive traffic (bots, mass sign-ups, reset-mail floods, brute force) is limited or blocked.

Owner's decisions: Workers Paid; AWS SES replaces Resend (Approach A: SES HTTPS API v2 + SigV4; bounces via SES account-level suppression
list + an alarm, Approach A); senders are any `@amuwa.com` address (per e-mail type, decided later); portal stays on Vercel; bot defence =
Turnstile + limits, sign-up stays instant; go-live 11 PM IST on a weekday; four pull requests, owner reviews and merges.

## 1. E-mail through AWS SES

* `EMAIL_PROVIDER=ses` uses SES API v2 `POST https://email.<SES_REGION>.amazonaws.com/v2/email/outbound-emails`, SigV4 (service `ses`)
  signed with `SES_ACCESS_KEY_ID` / `SES_SECRET_ACCESS_KEY` (an IAM user allowed only `ses:SendEmail` / `ses:SendRawEmail` for the
  `amuwa.com` identity). `Simple` content: subject, HTML + text body, attachments (invoice PDFs) as `Attachments`. Optional
  `SES_CONFIGURATION_SET`. Region default `ap-south-1`.
* Senders per e-mail type, each optional, falling back to `EMAIL_FROM`: `EMAIL_FROM_AUTH` (password resets, sign-up / login links, staff
  forgot-password), `EMAIL_FROM_CAREERS` (candidate decisions), `EMAIL_FROM_CLIENT` (exists: onboarding, payments, invoices, renewals,
  client logins), `EMAIL_FROM_HR` (birthdays, anniversaries, probation, training), `EMAIL_FROM` (the rest). Matching `EMAIL_REPLY_TO_*`.
  Any `@amuwa.com` address works once the domain is verified in SES.
* Pacing: calls spaced to `SES_MAX_PER_SECOND` (default 10). 429 `TooManyRequestsException` is waited out and retried once.
* Gmail backup (existing SMTP settings, `meta@amuwa.com`): used when SES does not accept the e-mail — daily quota reached, sending paused or
  account suspended, keys / signature refused (401/403), domain not verified, sandbox "address not verified", throttled after the retry,
  5xx, connection refused. Not used after a timeout (SES may have sent it: no duplicate) nor for an invalid request (`BadRequestException`,
  `MessageRejected` for content). After a quota answer SES is skipped for 15 minutes. Backup sender: the original address when it is listed
  in `SMTP_SEND_AS` (Gmail "Send mail as" aliases), otherwise `meta@amuwa.com` with the original reply-to.
* Bounces and complaints: SES account-level suppression list (bounces + complaints) and a CloudWatch alarm on bounce / complaint rate,
  set up by the owner (guide). No CRM code. Deferred: showing bounces in the CRM.
* Secrets only in Cloudflare secrets; nothing personal or secret logged.

## 2. Abuse protection and rate limits

* **Trusted visitor address from the portal.** The portal calls the CRM from its server, so the CRM saw one address for every candidate
  (the 10/hour sign-up limit was effectively site-wide). The portal sends `x-portal-client-ip` + `x-portal-client-ts` +
  `x-portal-client-sig` = HMAC-SHA256(`PORTAL_FORWARD_SECRET`, `ip.ts`); the CRM accepts it only with a valid signature and a timestamp
  within 60 s, and then uses it as the client address for limits and audit. Otherwise the caller's own address is used.
* **Limits that hold across servers.** Floods: Cloudflare Workers Rate Limiting binding (per address, ~600/min) on the Worker; the
  in-memory limiter stays for Node.js. Anything that creates accounts or sends e-mail uses the database-backed limiter
  (`rate_limit_consume`): sign-up, sign-in guard, every forgot-password form, login-failure reports, the auth e-mail hook.
* **Turnstile** on the portal's sign-up, sign-in, forgot-password and apply forms. The CRM verifies tokens with Cloudflare
  (`siteverify`: success, hostname in `TURNSTILE_ALLOWED_HOSTNAMES`, action matches). `POST /api/v1/candidate-auth/guard`
  `{ action: 'sign_in' | 'reset' | 'apply', email?, turnstileToken }` checks the token and the limits; the portal calls it before
  Supabase sign-in / recovery and before an application. `POST /candidate-auth/register` checks the token itself.
  `TURNSTILE_MODE` = `off` (default) | `log` (verify and record, never block) | `enforce`.
* **Limits** (defaults; each a setting): sign-up 5/h per address, 3/h per e-mail, 300/h site-wide; sign-in 20/15 min per address,
  10/15 min per e-mail; forgot-password 5/15 min per address, 3/h per e-mail; auth e-mails 5/h per recipient, 500/h site-wide;
  applications 10/day per candidate; uploads 20/day per candidate; profile saves 60/h per candidate; public job listings 120/min per address.
* **Throwaway e-mail domains** refused at sign-up (bundled public list).
* Neutral answers (forgot-password never reveals whether an account exists); 429 with Retry-After; blocked attempts recorded in the
  Security & Audit log (sampled).
* Dashboard settings in the runbook: the free managed WAF rules (not Bot Fight Mode, which would block server-to-server calls); Supabase Auth e-mail rate limits.

## 3. Go-live

Four pull requests, each inactive on Vercel until switched on, merged in order:
A. Cloudflare Worker (this branch, merged with `main`; `SCHEDULED_ENABLED` switch, `keep_vars`).
B. SES provider (on A). C. CRM abuse protection (on B). D. Portal (independent repo; needs C live before Turnstile is enforced).

Phases: 0 owner setup (AWS account + SES production access, Cloudflare Paid, Turnstile widget, Vercel settings list) → 1 merge →
2 rehearsal on `workers.dev` with production settings and `SCHEDULED_ENABLED` off → 3 DNS into Cloudflare (if not already), CRM record
still pointing to Vercel → 4 go-live at 11 PM IST on a weekday: domain to the Worker, Worker cron on and Vercel cron off together, smoke
tests → 5 watch 48 h with rollback triggers → 6 `EMAIL_PROVIDER=ses` once SES production access is granted (Gmail stays the backup) →
7 `TURNSTILE_MODE=log` one day, then `enforce` → 8 retire the Vercel CRM project after 1–2 quiet weeks.

Rollback triggers (phases 4–5): error rate > 1% for 10 minutes, staff or clients cannot sign in, invoices fail, the scheduled run fails
twice, any data looks wrong. Rollback: domain back to Vercel, Vercel cron on, Worker `SCHEDULED_ENABLED` off (about 5 minutes).

Same address, so sign-in sessions survive the move.

## 4. Owner checklist

In `docs/GO_LIVE_RUNBOOK.md` (what to provide, where to click, what to expect) and `docs/AWS_SES_SETUP.md`.

## Testing

Every pull request passes typecheck, build, unit, database, API and Worker (real workerd runtime) suites. New tests: SigV4 header signing
against AWS's published example and an independent implementation; SES error → action mapping against a fake SES; per-type senders;
backup sender rules; forwarded-address signatures (valid / expired / tampered / missing); Turnstile (pass / fail / wrong host / wrong
action / each mode) against a fake siteverify; every limit reaching 429; throwaway domains; portal actions send the token and the signed
address.
