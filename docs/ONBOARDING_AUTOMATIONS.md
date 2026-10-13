# Onboarding email + WhatsApp automations

The customer emails and WhatsApp messages that the Google Sheet + Apps Script sent now go out from the CRM.
They are triggered by the Technical Consultant's work. No sheet and no "Trigger" button are involved.

**Scope for now:** Wabastore customers with the **WhatsApp API + Blue Tick** service. Other departments and services
are not automated yet.

Migration: `supabase/migrations/20261016000100_onboarding_automations.sql` (re-runnable).

## The flow

| Step | What happens in the CRM | Email | WhatsApp `status` |
| --- | --- | --- | --- |
| 1a | The customer reaches the Technical Consultant (Accounts confirmed the payment) with a **website URL** entered by sales | "Documents Received – Under Review" | `Under Review` |
| 1b | The customer reaches the Technical Consultant with **"Customer has no website"** ticked (or no website entered) | "Mini Website for Your Business" | `Website Pending` |
| 2 | The website link is saved (the TC can add or correct it) **and** every document / detail sales collected is authorized | "Meta Verification In Progress" (adds: takes about 2-3 weeks; "your website has been created" when the customer started at Website Pending) | `Meta Verification` |
| 3 | The TC creates the **client login** | "Meta Verification Completed – Panel Access Details": panel link, user ID (the login e-mail) and the password | `Status Completed` |

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
| `AUTOMATION_TEST_RECIPIENTS` | While testing: e.g. `9372286055,9321664464,you@amuwa.com`. Everyone else is skipped ("not a test recipient"). Remove it to go live for everyone. |
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
