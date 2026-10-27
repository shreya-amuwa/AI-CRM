# Onboarding email + WhatsApp automations

The customer emails and WhatsApp messages that the Google Sheet + Apps Script sent now go out from the CRM.
They are triggered by the Technical Consultant's work. **Nothing is sent when the customer merely reaches the
Technical Consultant**: the first messages go out when the Technical Consultant clicks **Send for onboarding**, once,
whether or not the customer wants add-on services. Asking for add-ons later never sends them again. No sheet and no "Trigger" button are involved.

**Scope for now:** Wabastore customers with the **WhatsApp API + Blue Tick**, **WhatsApp API** or **Blue Tick** service (the three
WhatsApp services need the same documents and are onboarded the same way). Other departments and services are not automated yet.

Migration: `supabase/migrations/20261016000100_onboarding_automations.sql` (re-runnable).

## The flow

| Step | What happens in the CRM | Email | WhatsApp `status` |
| --- | --- | --- | --- |
| 1a | The Technical Consultant clicks **Send for onboarding** (whether or not the customer wants add-ons) and sales entered a **website URL** | "Documents Received – Under Review" | `Under Review` |
| 1b | The Technical Consultant clicks **Send for onboarding** and sales ticked **"Customer has no website"** (or entered no website) | "Mini Website for Your Business" | `Website Pending` |
| 1c | The TC builds the mini website for a customer that started at Website Pending, clicks **Edit website** on the **Website URL** card, saves the link and clicks **Authorize** on that card | "Your Mini Website is Ready": the website link | `Website Ready` (the payload's `website` is the link) |
| 2 | The website link is **authorized** (the TC can add or correct it with **Edit website**) **and** every document / detail sales collected is authorized | "Meta Verification In Progress" (adds: takes about 2-3 weeks; "your website has been created" when the customer started at Website Pending) | `Meta Verification` |
| 3 | The TC creates the **client login** | "Meta Verification Completed – Panel Access Details": panel link, user ID (the login e-mail) and the password | `Status Completed` |

**"Website ready" (step 1c).** Sent once, only to customers that started at Website Pending, when the TC authorizes a real
website address. Saving the link alone sends nothing: it waits for **Authorize**. Correcting the link later and authorizing it again
sends nothing new. When authorizing the link also completes the checklist, "website ready" goes out before "Meta Verification".
The WhatsApp router (Automation Builder) needs a branch for `status = "Website Ready"`.

**Rules kept from the Apps Script:**
- **Forward only.** A stage is never repeated or moved back. A customer that started at Website Pending goes straight to
  Meta Verification and never gets the Under Review email.
- **Once per stage per channel.** The key `ONBOARD|<customer>|<channel>|<stage>` replaces "Last Email Sent",
  "Last WhatsApp Sent" and "WhatsApp Event Key".
- **Re-sends send nothing.** Sending a customer back to sales and receiving them again, or correcting the website link,
  sends nothing new.
- **Validation.**
  - Email uses `EMAIL_RE`. A bad address gives "Invalid client email – nothing sent".
  - WhatsApp uses `cleanPhone_()`: an Indian mobile number, sent as `91XXXXXXXXXX`. The WhatsApp number is used, or the
    phone number if there is no WhatsApp number.
  - A bad WhatsApp number skips only the WhatsApp. Set `AUTOMATION_REQUIRE_VALID_WHATSAPP=true` to also skip the email,
    as the script did.
- **WhatsApp payload.** The same keys as the script: `name, email, phone, department, website, whatsapp_number,
  status, source, automation: "Client Onboarding", event_key`. The Automation Builder router needs no change.
  `source` stays `"Google Sheets"` unless `WHATSAPP_SOURCE` is set.

**The client login is the last step.** For these customers it can be created only after step 2, so the emails always
arrive in order.

## WhatsApp router: the exact status-to-template mapping (check this when a customer gets the wrong WhatsApp)

The CRM never chooses the WhatsApp *template*: it posts one request per stage to the webhook and the **Automation Builder router** (Custom Webhook -> Basic Router -> one
"Send Template Message" per route) chooses the template from the request. Each stage queues its e-mail and its WhatsApp job **together** (`advance_client_status`), so
both always describe the same event. What the CRM sends for each stage (checked by `supabase/tests/onboarding_status_map.test.ts` and the API tests):

| CRM stage (`stage_code`) | e-mail subject | WhatsApp `status` (router must match this exactly) | Template the route must send |
|---|---|---|---|
| `WEBSITE_PENDING` | Mini Website for Your Business | `Website Pending` | the "mini website" template |
| `UNDER_REVIEW` | Documents Received – Under Review | `Under Review` | the "documents received / under review" template |
| `WEBSITE_READY` | Your Mini Website is Ready | `Website Ready` | the "website ready" template (**no route exists for this one in the current builder: add it**) |
| `META_VERIFICATION` | Meta Verification **In Progress** | `Meta Verification` | the **in progress / pending** template (about 2-3 weeks), **not** the completed one |
| `COMPLETED` | Meta Verification **Completed** – Panel Access Details | `Status Completed` | the "completed" template, only when the client login is created |

The CRM payload also carries `stage_code` (the fixed code in the first column) next to the unchanged keys (`name, email, phone, department, website, whatsapp_number, status, source,
automation, event_key`). Existing routes keep working on `status`; new or repaired routes can match `stage_code` instead of the display text.

**Why a customer can get "Meta Verification Completed" on WhatsApp while the e-mail says "In Progress".** The CRM side is verified correct: for the pending stage it posts
`status = "Meta Verification"`, `stage_code = "META_VERIFICATION"` and never a completed status (tests above, including "a pending-verification event can never dispatch the completed
wording"). A different template can therefore only come from the router configuration, which lives in the external builder and cannot be edited from this CRM. In the
builder, open the route filters and check, one by one:
1. The route labelled "Meta Verifcation" (spelling in the builder): its **condition** must be `status` **equals** `Meta Verification` (exact, same spelling), and its **Send Template Message** action must use the
   in-progress template. A mistyped condition never matches; if a *neighbouring* route has a looser rule (for example "contains Verification" or "contains Meta"), it will also
   catch this status and send the completed template. Make every condition **equals**, never **contains**.
2. The route labelled "Status Completed": condition `status` equals `Status Completed` only.
3. In the "Send Template Message" boxes (numbered 2, 5, 4 and 6 in the diagram), confirm the template chosen in each is the one in the last column above; a copied box that still points at the previous
   template is the other usual cause.
4. Add the missing `Website Ready` route.
5. Test with **your own number**: post the sample below to the webhook (same URL as `WHATSAPP_WEBHOOK_URL`) once per status and confirm each arrives with the matching text.
   `{"name":"Test","email":"me@example.com","phone":"91XXXXXXXXXX","department":"Wabastore","website":"","whatsapp_number":"91XXXXXXXXXX","status":"Meta Verification","stage_code":"META_VERIFICATION","source":"AI CRM","automation":"Client Onboarding","event_key":"test|1"}`
Use a new `event_key` for each test, because the builder ignores a repeated one.

## How it works

1. **The database decides when.** Triggers on `customer_onboarding`, `customer_onboarding_entries` (website) and
   `customer_client_accounts` move `customer_onboarding.client_status` forward. In the same transaction they queue one
   EMAIL and one WHATSAPP row in **`automation_jobs`** (the outbox). Every path is covered: the API, database
   functions, the SQL editor.
2. **The API server decides how.** It claims due jobs (`automation_claim_jobs`, `FOR UPDATE SKIP LOCKED`, so a job is
   never sent twice), renders the template, sends it and records the result (`automation_finish_job`).
   - It runs right after every Technical Consultant / Accounts action, so messages go out within seconds.
   - It also runs from `POST /api/v1/internal/automations/dispatch`. That endpoint covers retries and anything missed.
3. **Results.** A job ends as `SENT`, `SKIPPED` (with the reason) or `FAILED`.
   - Failed sends are retried after 1, 5, 15 and 60 minutes. After 5 attempts the job is `FAILED` and the Technical
     Consultants of the department are notified (bell).
   - Every outcome is in the customer's activity log; failures are also in the audit log.
4. **Where to see it.** On the TC customer page, the panel **Customer emails & WhatsApp** shows the step, the
   website link (the TC can add or correct it) and every message with its status. The salesperson can see the same
   messages through the API.

## The client password

Supabase Auth keeps the password (hashed) for signing in. For the completion email, the API also hands the database an
**encrypted** copy: AES-256-GCM, with the key in `AUTOMATION_SECRET_KEY`, which only the server has.
- That copy sits only on that one email job, and no signed-in user can read that column.
- It is erased as soon as the email is sent or given up, and in any case after 7 days.
- The password is never stored readable anywhere.

**How the client signs in to the mobile app:**
- The app signs in with Supabase Auth, using the same e-mail and password (`supabase.auth.signInWithPassword`, with the
  project's public anon key).
- The login carries `client_customer_id` in its app metadata, so the app knows which customer it is.
- A client login has no CRM profile and cannot use the staff CRM API.
- The data the app may read needs its own read rules for client logins. That is part of the app's build, not this change.
- If a client forgets the password, use Supabase's password-reset email (`resetPasswordForEmail`); do not re-send it.

## Setup (Vercel → Project → Settings → Environment Variables)

| Variable | Value |
| --- | --- |
| `AUTOMATION_MODE` | `dry_run` first (prepared and logged, nothing sent), then `live`. `off` stops everything; jobs wait. |
| `EMAIL_PROVIDER` | `smtp` (nodemailer, sending through the mailbox itself), `resend` or `brevo`. |
| SMTP (`EMAIL_PROVIDER=smtp`) | `SMTP_HOST` (`smtp.gmail.com`), `SMTP_PORT` (`465`, or `587` for STARTTLS), `SMTP_USER` (`meta@amuwa.com`), `SMTP_PASS` (a Google **app password**, not the normal one; spaces are ignored). `SMTP_SECURE` defaults to true on port 465. |
| Resend / Brevo (`EMAIL_PROVIDER=resend` or `brevo`) | `EMAIL_API_KEY`. Verify `amuwa.com` with the provider (SPF/DKIM records) so `meta@amuwa.com` can send. |
| `EMAIL_FROM` | `Amuwa Corporation <meta@amuwa.com>` (default). `EMAIL_REPLY_TO` defaults to `meta@amuwa.com`. `EMAIL_CC` / `EMAIL_BCC` are optional. |
| `WHATSAPP_WEBHOOK_URL` | The 1automations webhook. Generate a new one: the old one was shared in the Apps Script. |
| `AUTOMATION_TEST_RECIPIENTS` | **Leave it empty / delete it in production**: the CRM then sends to each customer's own email and WhatsApp number from the database. Set it only to test: everyone not in the list is skipped ("not a test recipient"). |
| `AUTOMATION_SECRET_KEY` | A long random string. Without it the completion email says the password is shared separately. |
| `AUTOMATION_DISPATCH_SECRET` | A long random string (16+ characters) for the dispatch endpoint. |

**Using Gmail / Google Workspace over SMTP (nodemailer):**
1. The `meta@amuwa.com` account needs 2-Step Verification, then create an **App password** (Google Account → Security → App passwords). Your Workspace admin may need to allow this.
2. Gmail limits sending (about 2,000 messages a day for Workspace, 500 for a free Gmail), which is plenty for onboarding emails. Gmail also rewrites the "From" to the signed-in mailbox, so keep `EMAIL_FROM` as that mailbox.
3. A wrong or revoked app password does not lose messages: they wait, show "SMTP sign-in failed" on the customer's panel and are retried, so fixing the password recovers them.
4. Move to Resend or Brevo later by changing `EMAIL_PROVIDER` and the key. Nothing else changes.

**Optional safety net** (retries without waiting for the next TC action). Run this in the Supabase SQL editor, with
the `pg_cron` and `pg_net` extensions enabled:

```sql
select cron.schedule('crm-automation-dispatch', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://<your-domain>/api/v1/internal/automations/dispatch',
    headers := jsonb_build_object('Authorization', 'Bearer <AUTOMATION_DISPATCH_SECRET>'))
$$);
```

## Going live

1. Run the migration.
2. Set the variables with `AUTOMATION_MODE=dry_run`.
3. Move a test customer through the steps and check the panel.
4. Switch to `live` with `AUTOMATION_TEST_RECIPIENTS` set.
5. Remove the test list, then stop the Google Sheet triggers for these customers.

Customers that were already with the Technical Consultant before the migration get their current stage recorded
**without** any message. They only get messages for their next steps.

## Nothing was sent? (troubleshooting)

Open the customer in the Technical Consultant dashboard: the **Customer emails & WhatsApp** panel says why.

| What the panel shows | Meaning and fix |
| --- | --- |
| No panel at all | The customer is not automated: Wabastore + WhatsApp API + Blue Tick only. Or the migration has not been run. |
| A step is shown but **no messages**, with the amber note | Onboarding was started before the automations were switched on (the step was recorded without messages). Press **Send ... messages**. |
| Messages say **Not sent – Dry run** | `AUTOMATION_MODE` is `dry_run`. Set it to `live` and redeploy. |
| Messages say **Test mode – ... is not a test recipient** | `AUTOMATION_TEST_RECIPIENTS` is set and the customer's email or WhatsApp number is not in it. Add it, or remove the setting to go live for everyone. Then press **Send ... messages**. |
| Red note: **Email / WhatsApp sending is not set up** | The provider settings (`EMAIL_PROVIDER` + `SMTP_*` / `EMAIL_API_KEY`, or `WHATSAPP_WEBHOOK_URL`) are missing on the server. Messages wait and go out once they are set and redeployed. |
| The email arrived but the **WhatsApp** did not, and the panel says **Sent** with `accepted by webhook (HTTP 200 ...)` | The CRM handed the message to the 1automations webhook and it answered. What the router does next is outside the CRM. Most often the router has **no branch for that `status`** (for example `Website Ready`): add it, using the payload's `website` field for the link. The webhook's own answer is shown after `HTTP 200:`. |
| The WhatsApp says **Test mode - ... is not a test recipient** | `AUTOMATION_TEST_RECIPIENTS` is set and has the email but not the customer's WhatsApp number. Delete the setting (or add the number), redeploy, then press **Send ... messages**. |
| The WhatsApp says **WhatsApp Number is missing or invalid** | The customer's number is not a real Indian mobile number (10 digits starting 6-9, not all the same digit or a 1234... run). Correct it, then press **Send ... messages**. |
| **Queued** with "attempt N failed" | The provider refused it (for example `SMTP sign-in failed`: wrong app password). It retries by itself after 1, 5, 15 and 60 minutes. |
| **Not sent – Invalid client email** / **WhatsApp Number is missing or invalid** | Correct the customer's details, then press **Send ... messages**. |
| **Failed** | Five attempts failed. The Technical Consultants got a bell notification. Fix the cause, then press **Send ... messages**. |

After changing environment variables in Vercel, **redeploy**; they are read only when the app is deployed.

**Read-only check against the database:** run `supabase/diagnostics/automation_status.sql` in the Supabase SQL editor.
It confirms the migrations are applied and lists the latest customers with their step and every message
(no email addresses or phone numbers).

Migrations, in order: `20261016000100_onboarding_automations.sql`, `20261016000200_resend_client_messages.sql`
(the **Send ... messages** button), `20261016000300_start_onboarding_trigger.sql` (messages start at
**Send for onboarding**; a stricter website check), `20261016000400_invoice_auto_paid_website_ready.sql`
("website ready" message; invoices turn **Paid** by themselves once the payments are verified).
