# Go-live runbook: CRM to Cloudflare Workers, e-mail to AWS SES, abuse protection

For the owner. Follow it top to bottom; every step says where to click and what you should see. Nothing here changes the live site until
**Phase 4**, and every phase after that has a way back. Design: `docs/superpowers/specs/2026-11-12-cloudflare-ses-abuse-protection-design.md`.

Paste secrets only into the Cloudflare, Vercel, AWS and Supabase dashboards: never into chat, documents or commits.

---

## What you need to provide or decide

| # | What | Where it goes | When |
| --- | --- | --- | --- |
| 1 | A **Cloudflare account** on **Workers Paid** (US$5/month) | — | Phase 0 |
| 2 | Access to the **DNS of `amuwacorporation.com`** (registrar login, or it is already on Cloudflare) | Phase 3 | Phase 0: find out where it is |
| 3 | Access to the **DNS of `amuwa.com`** (for AWS SES's records) | `AWS_SES_SETUP.md` | Phase 0 |
| 4 | An **AWS account** and SES production access | `AWS_SES_SETUP.md` | Phase 0 (takes about a day) |
| 5 | A copy of **every Vercel environment variable** of the CRM project | Cloudflare Worker settings | Phase 2 |
| 6 | Two new random secrets: `PORTAL_FORWARD_SECRET` and `CRON_SECRET` (32+ characters each; e.g. a password manager's generator, 40 letters and digits) | the first on both Vercel projects (Phase 1) and later Cloudflare; the second on Cloudflare | Phase 1 / 2 |
| 7 | A **Turnstile widget** (Cloudflare dashboard -> Turnstile -> Add widget; hostname = the Candidate Portal's domain; mode Managed): its site key and secret key | Portal (site key), Cloudflare Worker (secret) | Phase 7 |
| 8 | Two test accounts per role you want checked (staff, client, candidate), not real customers | rehearsal checklist | Phase 2 |
| 9 | A quiet weekday evening, **11 PM IST**, with about an hour free, and no other merges that day | — | Phase 4 |

---

## Phase 0: accounts (start now; nothing changes for users)

1. **Cloudflare:** sign up at <https://dash.cloudflare.com>, then Workers & Pages -> Plans -> **Workers Paid**. Turn on two-factor
   authentication (My Profile -> Authentication).
2. **AWS SES:** follow `AWS_SES_SETUP.md` steps 1–6 now (the production-access request takes about a day). Do not switch the CRM to SES yet.
3. **Where is `amuwacorporation.com`'s DNS?** At your registrar, look at the domain's nameservers. If they end in `ns.cloudflare.com`, it is
   already on Cloudflare: skip Phase 3.
4. **Vercel settings list:** Vercel -> the CRM project -> Settings -> Environment Variables. You will copy each value into Cloudflare in
   Phase 2 (keep this tab open then; do not export them to a file).

## Phase 1: merge the code (nothing changes for users)

**First, the shared secret (before merging anything).** The new sign-up and sign-in limits count each candidate by the address the
portal forwards, signed with `PORTAL_FORWARD_SECRET`. Without the secret every candidate looks like the portal's one address, and the
stricter limits (5 sign-ups an hour per address) would briefly apply to everyone together. So:

1. Make one random secret of 40 letters and digits.
2. Vercel -> **CRM** project -> Settings -> Environment Variables -> `PORTAL_FORWARD_SECRET` = the secret (all environments).
3. Vercel -> **Candidate Portal** project -> the same variable, same value (server only: not `NEXT_PUBLIC_`).
   Setting them changes nothing until the new code is deployed.

Then merge in this order, each after its checks are green:

1. Candidate Portal pull request **Abuse protection** (`claude/abuse-protection`). It starts sending the signed address, which the
   current CRM simply ignores; its new check before sign-in answers "not found" on the current CRM, which the portal treats as allowed.
2. AI-CRM pull request **Cloudflare Workers** (`claude/gracious-lovelace-j9twbe`)
3. AI-CRM pull request **AWS SES** (`claude/ses-email`)
4. AI-CRM pull request **Abuse protection** (`claude/abuse-protection`). From its deployment on, limits count each candidate separately.

Check after the last one: sign up a test candidate on the portal, sign in, apply to a test job. Security & Audit log: the
`CANDIDATE_REGISTERED` entry shows your own address, not Vercel's.

The three AI-CRM pull requests build on each other: after merging one, GitHub moves the next onto `main` (if it says "This branch has
conflicts" or still shows the earlier commits, ask for it to be updated before merging). Use **Create a merge commit** or **Squash and
merge** ("Rebase and merge" is not available: the branches contain merge commits).

Everything new is **inactive on Vercel**: the Worker files are not part of the Vercel build; SES needs `EMAIL_PROVIDER=ses`; Turnstile is
off without its secret; the forwarded address is ignored without `PORTAL_FORWARD_SECRET`. The only behaviour that changes on Vercel at once
is stricter sign-up / reset limits (counted in the database instead of per server) and throwaway e-mail domains being refused at sign-up.

If Vercel shows "Deployment was blocked" (the commit-author issue in `DEPLOYMENT_VERCEL.md`), users are not affected: Vercel keeps serving
the previous version, which is fine until Phase 4.

## Phase 2: rehearsal on the Worker's own address (1–2 days; users stay on Vercel)

1. Cloudflare -> Workers & Pages -> Create -> **Import a repository** -> `shreya-amuwa/ai-crm`:
   * Worker name **`ai-crm`**; production branch `main`; build command `npm run build`; deploy command `npx wrangler deploy`;
     non-production branch deploy command `npx wrangler versions upload`.
   * Build variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (same as Vercel).
2. Worker `ai-crm` -> Settings -> Variables and Secrets. Add **every** Vercel variable (sensitive ones as **Secret**), and:

   | Name | Value | Note |
   | --- | --- | --- |
   | `EMAIL_PROVIDER` | `smtp` | the Gmail mailbox, exactly as on Vercel today (SES comes in Phase 6) |
   | `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` (secret) | as on Vercel | |
   | `SCHEDULED_ENABLED` | **leave unset** | the morning automations must not run here yet (Vercel still runs them) |
   | `CRON_SECRET` (secret) | new random 32+ characters | |
   | `APP_URL` | `https://crm.amuwacorporation.com` | |

   `PORTAL_FORWARD_SECRET` comes over with the other Vercel variables (Phase 1). **Do not set** `TURNSTILE_*` yet (Phase 7).
3. Deployments -> the latest -> it should say **Success**. Open `https://ai-crm.<your-subdomain>.workers.dev/api/v1/health`: expect
   `"status":"ok"` and `"serviceRoleKey":"configured"`.
4. **Rehearsal checklist** on the `workers.dev` address, with test accounts (real data: do not change real customers):

   | # | Check | Expected |
   | --- | --- | --- |
   | 1 | Staff sign-in (each role you use) | dashboard loads, no error banner |
   | 2 | Department switch, a few lists (customers, leads, tasks) | data appears, same as on Vercel |
   | 3 | Open a customer, open an uploaded document | file opens (R2 / Supabase link) |
   | 4 | Upload a small document to a test customer | upload completes |
   | 5 | Generate an invoice PDF for a test order | PDF opens |
   | 6 | Chat: send a message between two test staff | arrives live |
   | 7 | Attendance punch with a test employee | recorded |
   | 8 | Client sign-in (test client) and client dashboard | loads |
   | 9 | Client "forgot password" with a test client | e-mail arrives (from the Gmail mailbox) |
   | 10 | Staff "forgot password" with a test employee | e-mail arrives |
   | 11 | A test e-mail type you rely on (e.g. a payment request to a test client) | arrives |
   | 12 | `…/api/v1/careers/jobs` | JSON list of jobs |
   | 13 | Worker -> Logs (Observability): errors during the above | none, or only ones you expect |
   | 14 | Worker -> Settings -> Triggers: cron run (it runs at 09:00 / 10:30 IST) | log line `[cron] skipped: SCHEDULED_ENABLED is not "true"` |

   Anything wrong: stop here and send me the check number and the Worker log lines (no secrets).

## Phase 3: DNS into Cloudflare (only if `amuwacorporation.com` is not on Cloudflare yet)

A quiet evening at least 2 days before Phase 4. The CRM keeps running on Vercel throughout.

1. Cloudflare -> Add a domain -> `amuwacorporation.com` -> Free plan. Cloudflare imports the existing DNS records.
2. **Compare record by record** with the registrar's DNS page. Especially: every **MX** record (company e-mail), every **TXT** (SPF
   `v=spf1 …`, DKIM `…._domainkey`, DMARC `_dmarc`, site verifications), and the record for `crm` (pointing to Vercel). Add anything missing.
   Set the `crm` record's proxy status to **DNS only** (grey cloud) for now.
3. At the registrar: **turn off DNSSEC** if it is on; lower record lifetimes (TTL) to 5 minutes if it allows.
4. Change the nameservers to the two Cloudflare shows. Within a few hours Cloudflare says "Active".
5. Check: company e-mail still arrives (send yourself one from outside), the CRM still opens on Vercel.

Way back: put the old nameservers back at the registrar.

## Phase 4: go-live (a weekday, 11 PM IST, about 1 hour)

Before starting: the rehearsal passed; nobody is merging anything; you have Vercel and Cloudflare open side by side.

| Time | Step | Check |
| --- | --- | --- |
| 22:55 | Worker -> Deployments: the latest `main` is deployed and green | |
| 23:00 | **Vercel** -> CRM project -> Settings -> Domains -> remove `crm.amuwacorporation.com` | |
| 23:01 | **Cloudflare** -> Worker `ai-crm` -> Settings -> Domains & Routes -> Add -> Custom domain -> `crm.amuwacorporation.com` (it replaces the old `crm` record; confirm) | status "Active" within a few minutes |
| 23:05 | Worker -> Variables: `SCHEDULED_ENABLED` = `true`. **Vercel** -> Settings -> Cron Jobs -> **Disable** | the automations now run from Cloudflare only |
| 23:06 | Open `https://crm.amuwacorporation.com/api/v1/health` | `"status":"ok"` |
| 23:10 | Rehearsal checks 1–12 again, on the real address | same results |
| 23:30 | Cloudflare -> the domain -> Security -> WAF -> **Managed rules**: turn on the free "Cloudflare Managed Free Ruleset". **Do not** turn on Bot Fight Mode (it would block the portal's server, Supabase's e-mail hook and the webhooks). | |
| 23:35 | Candidate Portal: open its sign-in and job pages | they load (the portal calls the same address) |
| 23:40 | Done. Leave Vercel's CRM project in place (do not delete it) | |

Staff stay signed in: the address is the same, so their sessions continue.

### Rollback (about 5 minutes) if anything in the table below happens

1. Cloudflare -> Worker -> Domains & Routes -> remove the custom domain.
2. Vercel -> Domains -> add `crm.amuwacorporation.com` back (and the DNS record Vercel asks for, in Cloudflare DNS, DNS only).
3. Worker -> `SCHEDULED_ENABLED` -> remove or `false`; Vercel -> Cron Jobs -> Enable.
4. Tell me what happened; nothing in the database needs undoing.

| Roll back if | |
| --- | --- |
| Error rate above 1% for 10 minutes | Worker -> Metrics |
| Staff or clients cannot sign in | |
| Invoices fail to generate | |
| The scheduled run fails twice | Worker -> Logs, `[cron]` lines |
| Any data looks wrong | |

## Phase 5: watch (48 hours)

Twice a day: Worker -> Metrics (requests, errors, CPU time) and Logs (errors); the CRM's e-mail delivery logs; the Security & Audit log.
CPU time per request should stay far below the 30-second limit.

## Phase 6: switch e-mail to AWS SES (once AWS granted production access)

`AWS_SES_SETUP.md` step 7: add the `SES_*` secrets and optional `EMAIL_FROM_*` senders, keep the `SMTP_*` (backup), then set
`EMAIL_PROVIDER` = `ses`. Send one of each e-mail type to test addresses and check SES -> Account dashboard. Way back: `EMAIL_PROVIDER` =
`smtp` (instant).

## Phase 7: abuse protection on

1. **Visitor address:** already done in Phase 1 (the Worker got `PORTAL_FORWARD_SECRET` with the other Vercel variables in Phase 2).
2. **Turnstile:** Worker secrets `TURNSTILE_SECRET_KEY`, variables `TURNSTILE_ALLOWED_HOSTNAMES` = the portal's host name and
   `TURNSTILE_MODE` = `log`; portal Vercel variable `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, redeploy the portal. Check: the portal's sign-in page
   shows the small Cloudflare check; signing in works.
3. After a day, Security & Audit log -> action `BOT_CHECK_FAILED`: if there are few or none from real candidates, set `TURNSTILE_MODE` =
   `enforce`. Way back: `log` or `off`.
4. Supabase -> Authentication -> Rate Limits: "emails sent per hour" e.g. 30.

## Phase 8: retire Vercel's CRM project (after 1–2 quiet weeks)

Delete the CRM project in Vercel (not the Candidate Portal's). Ask for a small pull request removing `vercel.json` and the Vercel docs.
Keep the `SMTP_*` settings: they are the e-mail backup.
