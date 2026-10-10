# Plan: Email, WhatsApp and AI Calling automations from the CRM database

**Goal.** Replace the Google Sheet + Apps Script automations with automations that run from the CRM's own data. When the Technical Consultant (TC) changes something in their dashboard, the database records it and the right email, WhatsApp message or AI call goes out. There is no sheet, no copy-paste and no manual "Trigger" button for the normal flow.

**Status:** proposal, nothing built yet. Section 9 lists the decisions needed before building.

---

## 1. Where we are today

| | Google Sheet (current script) | CRM (current code) |
|---|---|---|
| What starts it | A Google Form row, or someone editing the **Email Status** dropdown | The TC presses **Trigger** in the Automations panel |
| Client stage | "Email Status" column: Website Pending → Under Review → Meta Verification → Status Completed (forward only) | No stage field. `customer_onboarding.review_state` tracks document review only. |
| Email | `MailApp` (Gmail of the script owner), 4 HTML templates | Posts the customer to a sheet web app (`AUTOMATION_EMAIL_WEBHOOK_URL`) |
| WhatsApp | POST to `webhooks.1automations.com/...`; Automation Builder routes on `status` | Same: posts to a sheet |
| AI calling | Daily scheduler queues "Panel Renewal / Message Recharge / Festival Offer" events; **no calls are actually placed** (waiting for a Bolify method) | Posts to a sheet |
| Rewards | Daily: purchase tier → bonus messages → WhatsApp | Nothing |
| Duplicate protection | "Last Email Sent" / "Last WhatsApp Sent" / "AI Call Event Key" columns | `onboarding_automation_runs`, max one run per minute |
| Record of what was sent | Log columns in the sheet | `onboarding_automation_runs` (Sent / Failed) |

**What we keep:**
- The 4 email templates, word for word.
- The WhatsApp webhook and its payload shape, so the Automation Builder router keeps working unchanged.
- The forward-only stage rule.
- The phone clean-up rules.
- The AI-call event keys.

**What we drop:**
- The sheet and its triggers.
- The output columns.
- Sending from someone's personal Gmail.
- The static panel password in code.

---

## 2. Target design

```
 TC dashboard action                       Database (source of truth)                      Sender (server)                Providers
 ───────────────────                       ──────────────────────────                      ───────────────                ─────────
 Send to TC / review /      ──RPC──▶  customer_onboarding.client_status changes
 "Meta applied" / "Verified"            │  (forward-only, set by DB functions)
 / panel login created                  ▼
                                    AFTER-UPDATE trigger
                                    inserts rows into automation_jobs ───(1) pg_net / DB webhook──▶ POST /api/v1/internal/automations/dispatch
 Daily 09:00 IST (pg_cron) ─────▶   AI-call + reward schedulers insert jobs   (2) pg_cron every 2 min ─▶   │ claims due jobs (SKIP LOCKED)
                                                                                                         │ renders template
                                                                                                         ├─▶ Email provider (API)
                                                                                                         ├─▶ WhatsApp webhook (1automations)
                                                                                                         └─▶ AI calling (Bolify API)
 TC sees timeline  ◀──realtime──  automation_jobs status: QUEUED → SENDING → SENT / FAILED / SKIPPED  ◀── result + provider id
                                    automation_events  ◀── delivery callbacks (email opened/bounced, WA delivered, call outcome)
```

**Principles:**
1. **The database decides *when*; the server decides *how*.** Triggers only insert rows into an outbox (`automation_jobs`). They never call providers, so a TC action is never slowed down or broken by a provider outage.
2. **Every path is covered.** Triggers sit on the tables, not in the UI. An API call, an RPC, the SQL editor or a future mobile app all fire the same automations.
3. **Exactly-once per stage.** A unique `dedupe_key` per job, e.g. `ONBOARD|<customer>|EMAIL|META_VERIFICATION`, replaces "Last Email Sent". Stages go forward only, so a stage is never emailed twice unless someone presses **Resend**.
4. **Retries with limits.** A failed job gets up to 5 attempts with back-off (1, 5, 15 and 60 minutes), then becomes **FAILED** and the TC is notified.
5. **Safe by default.** Each channel has a mode: `off`, `dry_run` or `live`. Staging has a test-recipient allow-list, and there is a kill switch.
6. **Secrets stay on the server.** Webhook URLs, the email API key, the Bolify key and panel passwords never appear in browser code or the database.

---

## 3. Data model (new migration, additive)

### 3.1 Client stage (the old "Email Status" dropdown)
`customer_onboarding`:
- `client_status text` — one of `WEBSITE_PENDING`, `UNDER_REVIEW`, `META_VERIFICATION`, `COMPLETED`. It is null until the customer reaches the TC.
- `client_status_changed_at timestamptz`
- `client_status_changed_by uuid`

New function `set_client_status(customer, status, note)`:
- Only the TC (`can_review_onboarding`), the support team lead, the department head or the super admin can call it.
- **Forward only.** Moving back is refused with the same message the sheet gave: "Cannot go back from Meta Verification to Under Review".

### 3.2 Website
- `customers.website_url text`, plus `customers.has_website boolean` generated as "website present".
- Use the same "no / na / n/a / none / nil / - / not available" rule as `hasWebsite_()`.
- **Sales:** website goes on the lead / customer form.
- **TC:** can edit it, or tick "No website".

### 3.3 Outbox
```sql
automation_jobs (
  id uuid pk,
  customer_id uuid fk,              -- every job belongs to a customer
  channel text,                     -- EMAIL | WHATSAPP | AI_CALL
  kind text,                        -- ONBOARDING_STAGE | PANEL_RENEWAL | MESSAGE_RECHARGE | FESTIVAL_OFFER | REWARD | RESEND
  stage text null,                  -- WEBSITE_PENDING … COMPLETED for onboarding
  dedupe_key text unique,           -- e.g. ONBOARD|<cid>|EMAIL|COMPLETED,  PANEL_PRE|<cid>|2026-11-01
  payload jsonb,                    -- snapshot used to render (name, email, phone 91…, department, panel url…)
  status text,                      -- QUEUED | SENDING | SENT | FAILED | SKIPPED | CANCELLED
  skip_reason text,                 -- INVALID_EMAIL | INVALID_WHATSAPP | NO_PANEL_URL | OPTED_OUT | CHANNEL_OFF …
  attempts int, next_attempt_at timestamptz, locked_until timestamptz,
  provider_ref text,                -- message id / call id
  last_error text,
  created_by uuid, created_at, sent_at, updated_at
)
automation_events (job_id, type, data jsonb, created_at)   -- delivered / opened / bounced / call answered / outcome
```

**Row-level security:**
- Read access follows the customer: anyone who can see the customer can see its jobs.
- No direct writes. Only DB functions and the server (service role) write.

### 3.4 Settings (replaces `CFG`)
- `department_automation_settings (department_id pk, panel_url, sender_name, team_phone, team_email, tech_phone, company_phone, company_email, email_enabled, whatsapp_enabled, ai_call_enabled)`.
  - Editable by the super admin and department head.
  - Seeded with today's values: Wabastore / Wabastar / Chatwaba → `chat.wabastore.shop`, Whatsbox → `app.whatsbox.shop`, Digitree → `app.digitree.online`.
- Server env (secrets):
  - `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM` (e.g. `Amuwa Corporation <meta@amuwa.com>`)
  - `WHATSAPP_WEBHOOK_URL`
  - `BOLIFY_API_KEY` / `BOLIFY_AGENT_ID`
  - `AUTOMATION_DISPATCH_SECRET`
  - `AUTOMATION_MODE_EMAIL|WHATSAPP|AI_CALL` = `off|dry_run|live`
  - `AUTOMATION_TEST_RECIPIENTS` (staging only)

### 3.5 AI calling and rewards data (Phase 2–3)
- **Per customer service** (`customer_services.details`, which already holds the WhatsApp package):
  - `panel_renewal_date`
  - `message_package`
  - `messages_sent` (so messages left = package − sent)
  - `recharge_threshold`
- `festival_offers (id, department_id null = all, title, offer_text, starts_on, ends_on, active)`, managed by the super admin and department head.
- `reward_tiers (department_id, purchase_messages, reward_messages)`, seeded: 1,00,000 → 5,000. Other tiers stay "not configured", the same as the script.
- `message_purchases (customer_id, messages, purchased_at, recorded_by)`. Recording a purchase can queue the reward WhatsApp.
- `automation_opt_outs (customer_id, channel, reason, created_at)`, for DND / "do not call" compliance.

---

## 4. What triggers what (TC actions → messages)

### 4.1 Onboarding stages (Email + WhatsApp)

| # | What happens in the CRM | Who / where | New `client_status` | Email (template from script) | WhatsApp (`status` sent to router) |
|---|---|---|---|---|---|
| 1 | Sales clicks **Send to Technical Consultant** (customer appears in TC queue) | Sales → TC queue (`forwarded_to_support_at` set) | `UNDER_REVIEW`, or `WEBSITE_PENDING` if the customer has no website | "Documents Received – Under Review" / "Mini Website for Your Business" | `Under Review` / `Website Pending` |
| 2 | TC adds the website / unticks "No website" while the customer is in Website Pending | TC dashboard | `UNDER_REVIEW` | "Documents Received – Under Review" | `Under Review` |
| 3 | TC clicks **Meta verification applied** (new button, shown once every document is authorized: `review_state = VERIFIED`) | TC dashboard | `META_VERIFICATION` | "Meta Verification In Progress" | `Meta Verification` |
| 4 | TC clicks **Meta verification completed**. It requires the WABA ID (12+ digits, already enforced) and the department's panel URL. | TC dashboard | `COMPLETED` | "Meta Verification Completed – Panel Access Details" | `Status Completed` |
| — | TC sends documents back to sales (`returned_at`) | TC | unchanged | none (sales is told in-app) | none |
| — | TC presses **Resend** on a timeline entry | TC | unchanged | same template again (`kind = RESEND`, new dedupe key with a timestamp) | optional |

**Rules carried over from the script:**
- **Forward only, never twice.** For example, Under Review → Meta Verification → (back to Under Review) is refused, and nothing is sent.
- **Email checks:**
  - An invalid email gives **SKIPPED** "Invalid client email".
  - With "WhatsApp must be valid" on (`REQUIRE_VALID_WHATSAPP`), a missing or invalid WhatsApp number skips the email too. Section 9 asks whether to keep this.
- **WhatsApp checks:** the number is cleaned with the `cleanPhone_()` rules:
  - Strip `91` or `0`.
  - It must match `^[6-9]\d{9}$`.
  - Fake numbers are rejected.
  - The clean number is sent as `91XXXXXXXXXX`.
- **Completed stage:** it needs a panel URL for the department, or the job is skipped with "Add a panel URL for <department>".
- **WhatsApp payload:** identical to today, so the Automation Builder needs no change: `{ name, email, phone, department, website, whatsapp_number, status, automation: 'Client Onboarding', source: 'AI CRM' }`.

### 4.2 AI calling (scheduled, daily 09:00 IST, same event keys as the script)

| Event | When | Dedupe key | Data the call needs |
|---|---|---|---|
| Panel renewal (pre) | 3 days before `panel_renewal_date` | `PANEL_PRE|<customer>|<date>` | name, service/department, renewal date |
| Panel renewal (expiry) | on `panel_renewal_date` | `PANEL_EXPIRY|<customer>|<date>` | same |
| Message recharge | Messages left ≤ threshold. Checked as soon as "messages sent" is updated, not only daily. | `RECHARGE|<customer>|<left>|<threshold>` | package, messages left, threshold |
| Festival offer | 1 day before `festival_offers.starts_on` | `FESTIVAL|<customer>|<offer id>` | offer text, start, end |

**Call rules:**
- Calls go out only between 10:00 and 19:00 IST. Jobs created outside that window wait.
- Customers in `automation_opt_outs` are never called.
- Until the Bolify API is confirmed (decision 3), AI call jobs run in **dry_run**: queued, visible in the CRM, and nothing is dialled. This is the same as today's "QUEUED — NOT CALLED".
- Bolify's outcome callback writes `automation_events`: answered / not answered / interested / call ID. This replaces "AI Call Outcome" and "Bolify Call ID".

### 4.3 Reward WhatsApp (Phase 3)
1. A purchase is recorded in `message_purchases`.
2. If the tier is configured, the CRM queues a WhatsApp job with `automation: 'Message Purchase Reward'` and the same payload as the script (purchase, reward, total, message).
3. An unconfigured tier is recorded as **SKIPPED** "Tier not configured".

---

## 5. Sending service (server)

- **New `server/services/automations/`:**
  - `dispatcher.ts`: claims due jobs with `update … set status='SENDING', locked_until=now()+2min where id in (select … for update skip locked limit 20)`, so two runs never send the same job.
  - `email.ts`, `whatsapp.ts`, `aiCall.ts`: one adapter per channel.
  - `templates/`: the 4 email templates ported from Apps Script (HTML + plain text, with `esc()`). Unit tested.
  - `phone.ts` (`cleanPhone_` port) and `website.ts` (`hasWebsite_` port). Unit tested against the script's cases.
- **New endpoint `POST /api/v1/internal/automations/dispatch`:**
  - Protected by `AUTOMATION_DISPATCH_SECRET` and not exposed to users.
  - Processes due jobs and returns counts.
- **What calls the dispatcher:**
  1. **Instantly:** a Supabase Database Webhook / `pg_net` call on `automation_jobs` insert, so the email goes out seconds after the TC clicks.
  2. **Safety net:** `pg_cron` every 2 minutes. It covers retries, scheduled calls and anything the instant call missed.
  3. `pg_cron` daily at 09:00 IST runs `enqueue_ai_call_events()`, and at 10:00 IST `enqueue_reward_messages()`.
- **Inbound callbacks:**
  - `POST /api/v1/webhooks/email-events`
  - `/webhooks/whatsapp-status`
  - `/webhooks/ai-call-outcome`
  - Each is signed or secret-checked and writes `automation_events`.
- **The existing `AutomationService`** (manual Trigger → sheet) is kept behind the old env vars during cutover, then removed.

---

## 6. TC dashboard changes

1. **Client status stepper** on the customer page: Website Pending → Under Review → Meta Verification → Completed.
   - It shows the current stage, who set it and when.
   - The buttons are **Meta verification applied** and **Meta verification completed**, each with a confirmation pop-up.
   - Earlier stages are greyed out, so stages can only move forward.
2. **Website field** with a "No website" tick.
3. **Automations timeline** (replaces the three Trigger buttons):
   - One line per message, e.g. "📧 Under Review email — Sent 10 Oct 11:02", "💬 WhatsApp — Skipped: invalid number", "📞 Panel renewal call — Queued (dry run)".
   - Each line has **Resend** and **Retry**. Errors are written in plain words.
   - It updates live (realtime).
4. **Badges on the TC list:** a "Failed automation" count, and the TC gets a bell notification when a job fails after its retries.
5. **Super admin / department head:**
   - An **Automation settings** page: panel URLs, contact numbers, channel on/off, dry-run indicator.
   - **Festival offers** and **Reward tiers** pages.
   - An **Automation log** with filters: channel, status, date.

---

## 7. Phases

| Phase | Scope | Done when |
|---|---|---|
| **0. Decisions & accounts** | Answer section 9. Create the email provider account and verify the `amuwa.com` domain (SPF/DKIM). Confirm the WhatsApp webhook stays the same. Get the Bolify API docs and key. | Secrets in Vercel / Supabase |
| **1. Onboarding Email + WhatsApp** | `client_status`, website field, `automation_jobs` + triggers, settings table, dispatcher + email/WhatsApp adapters + templates, stepper + timeline in the TC dashboard, DB + API + browser tests. Ships in **dry_run**. | A TC moving a test customer through the 4 stages produces exactly 4 emails + 4 WhatsApp jobs; backward moves send nothing; failures retry |
| **1b. Go live (Email + WhatsApp)** | Switch to `live` with the test-recipient allow-list, then for everyone. Stop the sheet's form/edit triggers for clients that are in the CRM. | One week of real traffic with no duplicates |
| **2. AI calling** | Renewal date / package / threshold fields, festival offers, daily scheduler, Bolify adapter + outcome webhook, call-hours window, opt-outs. Starts in dry_run (= today's sheet behaviour). | Scheduled events appear on the timeline; with Bolify confirmed, test calls placed to staff numbers |
| **3. Rewards + polish** | Purchases, reward tiers + reward WhatsApp, editable templates (optional), automation log page, delivery callbacks. | Reward message sent once per qualifying purchase |
| **4. Retire the sheet** | Import "Last Email Sent / Last WhatsApp Sent / AI Call Event Key" for existing clients (so nobody is messaged again), disable Apps Script triggers, remove `AUTOMATION_*_WEBHOOK_URL`. | Sheet is read-only archive |

---

## 8. Testing & safety

- **Database tests (existing `rls_test.sql`):**
  - Each stage change queues one email and one WhatsApp job.
  - Repeating a stage queues nothing.
  - A backward move is refused.
  - Only the TC, lead, head or admin can move stages.
  - Invalid email / phone gives SKIPPED with a reason.
  - Scheduler event keys aren't duplicated across days.
  - Opted-out customers are skipped.
- **API tests:**
  - The dispatcher claims each job once, even with 2 parallel runs.
  - Retry back-off works.
  - The secret is required.
  - dry_run never calls providers. A mock HTTP server records calls.
- **Template tests:** rendered HTML and text, HTML escaping (`<script>` in a name), and the panel URL per department.
- **Browser test:** a TC moves a customer through the stepper and sees the timeline update. Resend works.
- **Kill switch:** setting `AUTOMATION_MODE_*=off` stops sending immediately. Jobs stay QUEUED.

---

## 9. Decisions needed (my recommendation first)

1. **Email sender:** **use a transactional provider (Resend or Brevo)** with `meta@amuwa.com` on a verified domain. The alternative is sending through Google Workspace (Gmail API), which has daily limits and needs a service account. The script today sends from whoever owns it.
2. **WhatsApp:** **keep the same 1automations webhook and payload**, adding only `source: 'AI CRM'`. Nothing changes in Automation Builder.
3. **AI calling (Bolify):** the script never places calls ("waiting for a supported BolifyAI calling method"). We need Bolify's API docs and an API key, or a webhook URL that starts a call. **Until then we build the scheduler in dry_run.**
4. **Who moves the stages:** **automatic** for Under Review / Website Pending (when sales sends to the TC), and **TC buttons** for Meta Verification and Completed, because those happen outside the CRM. The alternative is a free dropdown like the sheet.
5. **Panel password in the "Completed" email:** the script emails the same password (`1234@1234`) to every client and keeps it in code. **Recommendation:**
   - Store the panel password per department as a server secret, or have the TC type the client's password when completing.
   - Never store it in the database.
   - Ask clients to change it after first login.
   - Either way it should be changed, since it has been shared in this chat.
6. **Should a bad WhatsApp number block the email?** The script does block it (`REQUIRE_VALID_WHATSAPP: true`). **Recommendation: no.** Send the email, mark the WhatsApp job as skipped, and flag it to the TC.
7. **Where the renewal date and recharge threshold come from:**
   - **Recommendation:** the renewal date is the TC's "go-live" date plus the service's billing cycle (Monthly / Yearly, already on the checklist), editable by the TC.
   - The threshold is a department default (e.g. 1,000 messages), editable per customer.
8. **Festival offers:** **created by the super admin / department head on an Offers page.** The alternative is per customer, as in the sheet.

---

## 10. Field mapping (sheet → CRM)

| Sheet column | CRM |
|---|---|
| Full Name | `customers.name` |
| Client Email | `customers.email` |
| WhatsApp Number / Phone Number | `customers.whatsapp` (falls back to `phone`) |
| Website Url | `customers.website_url` (new) |
| Department | customer's department → `department_automation_settings.panel_url` |
| Email Status / WhatsApp Status | `customer_onboarding.client_status` (new) |
| Last Email Sent / Last WhatsApp Sent / Email Log / WhatsApp Log | `automation_jobs` (status, sent_at, skip_reason, last_error) |
| WhatsApp (91 format) | computed when sending (`91` + cleaned number), kept in the job payload |
| Panel Renewal Date, Message Package, Messages left, Recharge Threshold | `customer_services.details` (new keys) |
| Festival Offer, Offer Start, Offer End | `festival_offers` (new) |
| AI Call Type / Status / Last Call / Log / Outcome / Bolify Call ID / Event Key | `automation_jobs` (channel AI_CALL) + `automation_events` |
| Purchase Messages, Reward Messages, Total Messages, Reward Status | `message_purchases` + `reward_tiers` + `automation_jobs` (kind REWARD) |
