# Email management: Resend first, SES failover later, CC / BCC rules, one log, one suppression list

Migration `20270201000100_email_management.sql`. Code: `server/automations/providers.ts` (the router), `server/email/*` (routing, classification,
the shared record, the Resend webhook, provider checks), `src/components/email/EmailManagement.tsx` (Super Admin → Email Management).
Related: `docs/AUTH_EMAIL_HOOK.md`, `docs/AWS_SES_SETUP.md`, `docs/DEPLOYMENT_CLOUDFLARE.md`.

## 1. What existed (audit) and what was wrong

Working and kept: `sendEmail()` with SMTP (nodemailer / Worker sockets), Resend, Brevo and SES API v2; the SMTP mailbox as Resend's / SES's
fallback; senders per kind (`EMAIL_FROM_AUTH`, `_CAREERS`, `_CLIENT`, `_HR`); the Supabase Send Email Hook; and a durable queue per e-mail family
with leases and retries (automation jobs, welcome / HR / finance events, recruitment decision e-mails, the meetings outbox, invoice sending).
**No second outbox was built**: those queues stay the queues; what was missing across them is added at the moment of sending.

Confirmed defects:
1. **Credentials could be copied.** The client temporary-password, set-password and panel-password e-mails (`dispatcher.ts`) and the client
   login e-mails of `CustomerImportService` were sent with settings that keep the deployment's `EMAIL_CC` / `EMAIL_BCC`. With those set, a password
   or a set-password link went to every copied address. They are now `CREDENTIALS` e-mails: never copied, enforced centrally.
2. **One primary + SMTP only.** SES could never be a fallback for Resend (or the reverse); the order was fixed in code.
3. **No shared state.** A quota pause and the request spacing lived in each Worker isolate's memory; another instance kept hitting the refusal.
4. **Nothing recorded which provider sent what**, no attempts, no delivery confirmation, no bounces or complaints, no suppression list.
5. **No idempotency at the provider:** a retried job after a lost answer could send twice. Resend's `Idempotency-Key` was not used.
6. A daily-quota 429 from Resend was retried after a second (it cannot succeed); the SES region default (`ap-south-1`) did not match Amuwa's
   verified region (`ap-southeast-2`).
7. Jobs of one customer in the same batch were sent concurrently: the order of a customer's e-mails held only by timing.

## 2. Provider routing and failover

| Setting (Worker) | Meaning |
| --- | --- |
| `EMAIL_PROVIDER=resend` | primary provider (unchanged meaning) |
| `EMAIL_API_KEY` | Resend key (secret; a **sending-only** key is enough) |
| `EMAIL_FALLBACK=on` (default) / `off` | whether later providers may stand in |
| `EMAIL_PROVIDER_ORDER=resend,ses,smtp` | optional full order (validated; a typo is ignored) |
| `EMAIL_SES_PRODUCTION_ENABLED=false` | SES joins any order only when `true` (after AWS grants production access) |
| `SES_REGION=ap-southeast-2` | SES region (default now Sydney; set it explicitly) |

* **Phase A (now):** Resend → SMTP mailbox. SES keys may be set but SES is not used (sandbox). Email Management shows it as "waiting for AWS
  production access".
* **Phase B:** `EMAIL_SES_PRODUCTION_ENABLED=true` and either `EMAIL_PROVIDER_ORDER=ses,resend,smtp` or `resend,ses,smtp`. The Super Admin may
  also choose the order in Email Management → Usage & Limits, among the providers the Worker allows (never another one).
* An explicit `EMAIL_PROVIDER=ses` without an order still works as before (primary).

**Failure classification** (`server/email/classify.ts`): the next provider is tried only after a definite refusal about the *provider*:
`QUOTA_DAILY`, `QUOTA_MONTHLY`, `RATE_LIMIT`, `AUTH_INVALID`, `DOMAIN_UNVERIFIED`, `SES_SANDBOX`, `ACCOUNT_SUSPENDED`, `TEMPORARY` (5xx),
`NETWORK` (never reached the provider), `NOT_CONFIGURED`. Never for the *e-mail*: `INVALID_RECIPIENT`, `SUPPRESSED`, `INVALID_CONTENT`,
`ATTACHMENT_TOO_LARGE`. **`TIMEOUT` is `UNKNOWN_ACCEPTANCE`:** the provider may have sent it, so no other provider is tried; the next attempt
of the same event may only ask the same provider again, and only Resend (with the same `Idempotency-Key`, kept 24 h by Resend). Otherwise the
e-mail waits for the Super Admin's review (Email Management → Delivery Failures: "It was sent" / "Not sent — allow sending again").
After a quota refusal the provider is paused for every Worker instance (until the next UTC midnight / month for quotas, 30 s for a rate limit, 1 h for the SES sandbox; a wrong key or unverified domain is recorded, not paused, so a fix works at once).
When every provider is refused or paused, the e-mail stays in its queue (`RETRY_PENDING`); it is never reported as sent.

## 3. Quotas and priorities

* Resend free plan: 100 / day (UTC day) and 3,000 / month — **configurable** (Email Management → Usage & Limits), not hard-coded.
* The CRM counts accepted **recipients** (To + CC + BCC) per provider and day; Resend's own `x-resend-daily-quota` / `x-resend-monthly-quota`
  answer headers are stored as reported (their format is not documented, so they are shown, not computed with). The account's real usage
  (other senders, received mail counted by Resend) is Resend's figure; the CRM's count is labelled "counted by the CRM".
* Before each send the database checks pauses and quota (counting e-mails in flight on other instances) and keeps the last
  `critical_reserve` (10) of the day and month for **CRITICAL** e-mail: sign-in codes, password resets, verification. NORMAL / LOW e-mail that
  would use the reserve goes to the next provider or waits.
* Priorities: CRITICAL (auth), HIGH (decisions, invoices, activation, welcome), NORMAL (default), LOW. Authentication e-mails are sent at once
  (the hook does not queue), never behind routine mail.
* Alerts at 70 / 85 / 95 / 100 % (configurable) to the Super Admin's bell, once per provider, threshold and day / month.
* Per-second spacing stays per instance (`RESEND_MAX_PER_SECOND`), with Resend's 429 + `Retry-After` handled; the shared pause covers the rest.

## 4. Automatic CC / BCC (rules engine)

Rules (Email Management → CC/BCC Rules): category, optional application / department / workflow, CC or BCC, who is copied, priority, on/off,
effective dates, excluded employees. **Who is copied is resolved at the moment of sending from the live records**:

| Target | Source |
| --- | --- |
| The customer's owner | `customers.owner_id` |
| Relationship manager | `private.rm_of(customer)` |
| Assigned Meta Verifier | `customer_onboarding.meta_verifier_id` |
| Accounts owner | `customers.accounts_owner_id` |
| Technical consultant | `customer_onboarding.consultant_started_by` |
| The vacancy's recruiter | `career_postings.responsible_id` of the application |
| Named employees | chosen employees (still only while ACTIVE) |
| Company mailboxes | addresses on an allowed sender domain |

Only ACTIVE employees are ever resolved: someone who left, was suspended, changed team or lost the assignment drops out immediately, with no
manual change. No rule exists by default (nobody is copied). A new rule is saved switched off; **Preview recipients** resolves it for a real
customer or job application before it is switched on. Addresses are normalised and deduplicated across To / CC / BCC; an address chosen as both
CC and BCC is CC once; the recipient and the sender are never copied; suppressed addresses are dropped; at most `max_auto_recipients` (5).
Every rule change is audited with before / after. Prefer CRM notifications over e-mail copies for broad management visibility.

### Authentication and credentials: never copied

`AUTH` (OTP, verification codes, magic links, password reset / recovery, reauthentication, invitations) and `CREDENTIALS` (temporary passwords,
set-password links, panel passwords, welcome links) go to the account holder only, enforced in three places: `sendEmail` drops `EMAIL_CC` /
`EMAIL_BCC` and refuses any explicit copy; `email_send_begin` refuses copies and resolves no rules; the rules table cannot even hold a rule for
these categories. Their log keeps only a masked address (`e***@example.org`), no subject content, link, code or body.

The Supabase hook now sends with `category: AUTH, priority: CRITICAL` and an idempotency key from Supabase's `webhook-id`, so a Supabase retry of
the same request after a lost answer is answered "already sent" instead of e-mailing a second link. It still answers success only when a
provider accepted the e-mail.

## 5. Senders

Email Management → Sender Addresses: one sender (name, address, reply-to) per category, only on an allowed sender domain (`amuwa.com` by
default; verified with the provider). A category without its own sender uses the GENERAL sender, else the existing environment senders
(`EMAIL_FROM_*`, `EMAIL_FROM`). Suggested: auth@, careers@ (RECRUITMENT, INTERVIEW), hr@, sales@, support@, accounts@ (ACCOUNTS, INVOICE,
PAYMENT), tech@, no-reply@ (GENERAL). The SMTP fallback still sends as the mailbox (or its Gmail aliases, `SMTP_SEND_AS`), with the reply-to kept.

## 6. The log, statuses and who sees what

`email_messages`: application, category, template name, priority, sender, recipient (masked for AUTH / CREDENTIALS), CC, BCC (count; the
addresses for the Super Admin only), provider, provider message id, fallback used, attempts, error category, the linked customer / application /
employee, times. `email_attempts`: one row per provider attempt. `email_events`: provider events. Statuses: `PROCESSING`, `ACCEPTED` (the
provider took it), `DELIVERY_CONFIRMED` (its webhook said delivered), `DEFERRED`, `BOUNCED`, `COMPLAINED`, `FAILED`, `RETRY_PENDING`,
`UNKNOWN_ACCEPTANCE`, `SUPPRESSED` (plus `QUEUED`, `CANCELLED`, `EXPIRED` reserved). Kept 180 days (attempts and events 90).

`email_history` (API `GET /email/history`): Super Admin everything; HR staff (not recruiters) recruitment, interview and HR e-mails; a recruiter
the e-mails of their own vacancies' applications; everyone else e-mails linked to a customer they may see (`private.can_view_customer`), never
authentication / credential e-mails. Status and timing only, never a body. *(This PR shows the history in Email Management; the same component
can be placed in the HR, Accounts and Meta Verifier workspaces in a follow-up.)*

## 7. Delivery events (Resend webhook) and suppression

1. Resend dashboard → Webhooks → Add endpoint: `https://crm.amuwacorporation.com/api/v1/internal/email/resend-webhook`, events
   `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`.
2. Copy its signing secret (`whsec_...`) to the Worker secret `RESEND_WEBHOOK_SECRET`.

The request is verified with Resend's Svix signature over the raw body (same Standard Webhooks check as the auth hook; timestamp within 5
minutes); unsigned or altered requests change nothing. Each event is stored once by `svix-id`. A hard bounce or complaint **suppresses the
address for every provider** (SES and SMTP cannot be used to get around it); soft bounces do not. The Super Admin can lift or add a
suppression (audited). SES events (configuration set → SNS / EventBridge) are Phase B; the tables and `email_provider_event` already accept
`provider: 'ses'`, and the endpoint for SES notifications is to be added with SES activation.

## 8. Resend DNS in SPanel (amuwa.com)

The e-mails are sent **from `@amuwa.com`**; the applications run on `amuwacorporation.com`, which does **not** need to be a sending domain.

1. Resend → Domains → Add domain `amuwa.com` (region of your choice). Resend shows the exact records; **use exactly what it shows**. Typically:
   * **DKIM:** TXT `resend._domainkey` → `p=...` (a public key).
   * **SPF for Resend's bounce domain:** MX `send` → `feedback-smtp.<region>.amazonses.com` (priority 10) and TXT `send` → `v=spf1 include:amazonses.com ~all`.
     Resend's return path is its own subdomain (`send.amuwa.com`), separate from SES's custom MAIL FROM (`mail.amuwa.com` in docs/AWS_SES_SETUP.md):
     keep them distinct; do not reuse `mail`.
2. SPanel → DNS Editor for `amuwa.com`: add those records **only**. Do **not** change the company MX records (Google Workspace), the SES DKIM CNAMEs
   (`*._domainkey` pointing to `dkim.amazonses.com`), the existing `_dmarc` TXT policy or the SES MAIL FROM records. A second DKIM selector
   (`resend._domainkey`) next to SES's selectors is normal. Do not add a second root SPF record; root SPF is not needed for Resend's return path.
3. Resend → Verify. Then create a **sending-only** API key restricted to `amuwa.com` → Worker secret `EMAIL_API_KEY`.
4. DMARC stays as it is; with DKIM aligned on `amuwa.com`, Resend mail passes DMARC.

## 9. SES activation later (no code change)

1. AWS console (region **ap-southeast-2**): request production access; wait for approval.
2. Create a configuration set (e.g. `crm-default`) with event destinations for delivery, bounce and complaint; enable the account-level
   suppression list (bounce + complaint).
3. Worker: `SES_REGION=ap-southeast-2`, `SES_ACCESS_KEY_ID` / `SES_SECRET_ACCESS_KEY` (secrets; an IAM user allowed only `ses:SendEmail` for
   the verified identity and `ses:GetAccount`), `SES_CONFIGURATION_SET=crm-default`.
4. Email Management → Email Providers → Amazon SES → **Check now**: it must say "production access and sending is enabled" (it reads
   `GetAccount`; a sandbox account says SANDBOX).
5. Then `EMAIL_SES_PRODUCTION_ENABLED=true` and the order (`EMAIL_PROVIDER_ORDER=ses,resend,smtp` or `resend,ses,smtp`). Send a test (e.g. a staff
   password reset to yourself) and check Email History shows `ses`.

## 10. Deployment, secrets, checks, rollback

Secrets (never in Git, never in the browser): `EMAIL_API_KEY`, `RESEND_WEBHOOK_SECRET`, `SMTP_PASS`, `SES_SECRET_ACCESS_KEY`,
`SUPABASE_AUTH_HOOK_SECRET`. Variables: `EMAIL_PROVIDER=resend`, `EMAIL_FALLBACK=on`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `SMTP_*`, `SES_REGION`,
`EMAIL_SES_PRODUCTION_ENABLED=false`. Staging and production Workers each have their own values.

Rollout:
1. Run the migration in the Supabase SQL editor. The code works before it (the record is skipped, e-mail is sent as before) and after it.
2. Deploy. Nothing changes in routing until the variables change: today's `EMAIL_PROVIDER` keeps working.
3. Resend: DNS (section 8), `EMAIL_API_KEY`, `EMAIL_PROVIDER=resend`, keep `SMTP_*` as the fallback, webhook + `RESEND_WEBHOOK_SECRET`.
4. Verify (real delivery, not mocks): a staff password reset to yourself (arrives once, no CC, history shows `AUTH` masked, then
   "Delivery confirmed"); a candidate application confirmation from careers.amuwacorporation.com; an invoice with its PDF; a client set-password
   e-mail; Email Management → Providers → Resend → Check now; Overview counts move; the webhook events counter increases.
5. SES only after approval (section 9).

Rollback: set `EMAIL_PROVIDER` back to the previous provider (e.g. `smtp`) — no deploy needed. Clear `EMAIL_PROVIDER_ORDER` /
`EMAIL_SES_PRODUCTION_ENABLED` to return to the default route. The code can be redeployed to the previous version; the new tables are additive
and unused by older code. Removing CC rules: switch them off in Email Management.

## 11. Tests

* `supabase/tests/email_management_test.sql` (70 checks): rules (assigned included, unrelated excluded, reassigned / suspended / disabled), dedup,
  CC beats BCC, recipient limit, AUTH / CREDENTIALS never copied (table, function, sensitive flag), idempotency (accepted, in progress, unknown,
  review), shared suppression, shared pauses, quota + critical reserve, provider order, alerts once, webhook events (delivered, duplicate, hard /
  soft bounce, complaint), permissions (team member, HR, Department Head, recruiter), audit, history scoping and masking.
* `supabase/tests/email_routing.test.ts` (59): route and SES gate, classification for Resend / SES / SMTP, failover only when safe, both failing,
  duplicates / unknown acceptance / suppression / refused providers from the record, CC / BCC and sender applied, Idempotency-Key and quota
  headers, no copies of AUTH / CREDENTIALS, the webhook signature (forged, replayed, missing, redelivered).
* API integration ("email management"): the real router through PostgREST with a mock Resend: rule CC, idempotency, usage headers, AUTH privacy
  with `EMAIL_CC` set, signed webhook → delivery confirmed → bounce → suppression → not sent, history scoping, admin API permissions.
* Existing: `smtp_fallback`, `ses_email`, `auth_email_hook`, invoice / meeting / decision / renewal e-mail tests pass unchanged.
* Not automated: real delivery through Resend / SES / Gmail, DNS verification, real webhooks. Do the checks in section 10 step 4.
