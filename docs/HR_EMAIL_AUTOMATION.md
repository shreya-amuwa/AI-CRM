# HR e-mail automation

Birthday greetings, work-anniversary e-mails, probation reminders and employment-confirmation e-mails, sent automatically from the
existing employee data and the CRM's existing mail setup. Monitoring is in **HR dashboard > Email Automation**.

Migration: `supabase/migrations/20261107000100_hr_email_automation.sql` (additive, safe to rerun; needs the HR migrations
`20261027000100` and `20261103000100` to be applied first).

## What is sent, and when

| E-mail | To | When | Once per |
| --- | --- | --- | --- |
| Birthday (`Happy Birthday, <name>! 🎂`) | the employee | their date of birth, 09:00 India time | employee and year |
| Work anniversary (`Happy Work Anniversary, <name>!`) | the employee | joining-date anniversary (years of service counted from the real joining date, at least 1) | employee and anniversary year |
| Upcoming Employment Confirmation Review | the employee | 7 days before the probation end | confirmation cycle |
| Action Required: Probation Confirmation Due | HR | 7 days before the probation end | cycle and HR recipient |
| Overdue: Probation Confirmation Pending | HR only | after the end date while still undecided: weekly, at most 8 times | cycle, week and HR recipient |
| Employment Confirmation - Amuwa Corporation | the employee | **only after approval**, on/after the probation end date | cycle |
| Employee Confirmation Completed | HR | **only after approval** | cycle and HR recipient |

Nothing marks anybody permanent by itself. If the confirmation is still pending after the end date, HR gets the overdue reminder instead.

## Where the data comes from (no second employee table)

* **Employees** are the HR directory: CRM accounts (`profiles`) with their HR record (`hr_employees`), plus HR-only records. Super Admins are not
  employees. Only **active** people are served (account `ACTIVE` and HR status not `Left`).
* **Date of birth**: the Add Member details (`employee_personal_details`), else `hr_employees.data.dateOfBirth`.
* **Joining date**: the Add Member details, else the HR record's joining date. The account creation / approval date is never used as a fallback.
* **E-mail address**: the account e-mail (or the HR record's).
* **HR recipients**: every active member of the HR department, plus any addresses in `crm_settings` key `hr.notify_emails` (a JSON array, e.g.
  `["hr@amuwa.com"]`). An employee is never sent the HR copy about themselves.
* Missing or invalid dates / e-mail addresses are listed in **Email Automation > Dates to fix**, where HR can fill in the dates.

Dates use Indian time (Asia/Kolkata). 29 February birthdays and anniversaries are celebrated on 28 February in a common year.

## Probation rule

Probation = 6 months from the joining date (14 Sep -> 14 Mar). A confirmation cycle is opened for employees who joined less than 6 months + 30 days
ago and for everyone whose HR status is `Training / Probation`; interns have none; people who joined long ago are treated as already confirmed (nothing is
sent for them). HR can close a cycle that does not apply ("Close", with a reason).

**Approval**: the HR Department Head / Team Lead, the employee's Department Head, or the Super Admin approves in HR dashboard > Email Automation >
Probation confirmations (nobody can approve their own). The approval stores who and when, the effective date (default: the probation end date) and an
optional note; it queues the two confirmation e-mails (sent on the end date, or at once if it has passed), and an HR record that says
`Training / Probation` becomes `Full-Time`.

## Reliability

* `hr_email_events` holds one row per e-mail with a **unique event key** (`BIRTHDAY:<employee>:<year>`, `ANNIVERSARY:<employee>:<years>`,
  `PROBATION_REMINDER_EMPLOYEE:<cycle>`, ...). The daily check can run any number of times: an occasion is queued once.
* Statuses: `PENDING`, `SENDING`, `RETRY`, `SENT`, `FAILED`, `SKIPPED`, `DRY_RUN`, with attempts, timestamps and the last error.
* Two senders never take the same e-mail (row locks). Temporary failures (network, 4xx/5xx SMTP, 429) are retried after 5, 15, 60 and 240 minutes and
  then marked `FAILED` after 5 attempts; permanent refusals fail at once. HR can **Retry** a failed e-mail. A crashed sender's e-mail is taken again after
  10 minutes. (SMTP gives no idempotency key, so a crash in the milliseconds between "accepted by the mail server" and "recorded" could send one duplicate.)
* A missed run still sends birthdays / anniversaries up to 2 days late; later than that they are skipped.
* Passwords and credentials are never stored or logged; the audit log only keeps the e-mail kind and attempts.

## E-mail service configuration (server environment variables, never in the frontend)

The HR e-mails use the same settings as the onboarding and invoice e-mails:

```
AUTOMATION_MODE=dry_run          # off | dry_run (prepared and logged, NOT sent; default) | live
EMAIL_PROVIDER=smtp              # smtp | resend | brevo
EMAIL_FROM="Amuwa Corporation <meta@amuwa.com>"
SMTP_HOST=smtp.gmail.com  SMTP_PORT=465  SMTP_USER=meta@amuwa.com  SMTP_PASS=<Google app password>
#   or EMAIL_PROVIDER=resend|brevo with EMAIL_API_KEY
AUTOMATION_DISPATCH_SECRET=<random, 16+ characters>   # protects the scheduler endpoint (Vercel Cron's CRON_SECRET also works)
# optional
HR_EMAIL_FROM_NAME="Amuwa Corporation HR"   # sender display name (default shown)
HR_REPLY_TO=hr@amuwa.com                    # replies go here (default: EMAIL_REPLY_TO)
AUTOMATION_TEST_RECIPIENTS=you@example.com  # while set, ONLY these addresses are e-mailed (the rest wait)
```

HR e-mails never use `EMAIL_CC` / `EMAIL_BCC` (those are for client e-mails).

## Scheduler

`GET|POST /api/v1/internal/automations/dispatch` with `Authorization: Bearer <AUTOMATION_DISPATCH_SECRET or CRON_SECRET>` decides what is due and sends it
(it also runs the onboarding-message retries and the ticket escalation it always ran). It is idempotent.

* **Vercel Cron** (included in `vercel.json`): `30 3 * * *` = 09:00 India time every day. Set `CRON_SECRET` in Vercel (the same value as, or in
  addition to, `AUTOMATION_DISPATCH_SECRET`); Vercel sends it as the bearer token. On the Hobby plan this daily run is the most Vercel allows, so a
  failed e-mail is retried at the next day's run; with a Pro plan, or the Supabase option below, retries happen within minutes.
* **Supabase pg_cron + pg_net** (every 15 minutes, optional, for fast retries):

```sql
select cron.schedule('hr-email-automation', '*/15 * * * *', $$
  select net.http_post(url := 'https://<your-app>/api/v1/internal/automations/dispatch',
                       headers := jsonb_build_object('Authorization', 'Bearer <AUTOMATION_DISPATCH_SECRET>')) $$);
```

E-mails are timed for 09:00 India time on their day (`send_after`), whatever the run frequency.

## Go-live checklist

1. Run the migration in the Supabase SQL editor.
2. Set the e-mail variables above. Leave `AUTOMATION_MODE=dry_run` first: the daily check prepares and logs everything (**Email history**, status
   "Not sent (dry run)") without sending.
3. Check **Dates to fix** and fill in the missing dates of birth / joining dates; set `hr.notify_emails` if HR should have a shared mailbox.
4. Send yourself a test: add your own address to `AUTOMATION_TEST_RECIPIENTS`, set `AUTOMATION_MODE=live`, and give a test employee record
   (HR-only) your e-mail with today's date of birth; press **Run the check now** and confirm the e-mail arrives. Only listed addresses are e-mailed in
   this mode.
5. Remove `AUTOMATION_TEST_RECIPIENTS` to go live. Dry-run e-mails that are still relevant (birthdays within 2 days, pending probation reminders) are sent
   then, once.

## Tests

`npm run test:db` (section "HR e-mail automation": dates, Feb 29, once-per-year, 7-day reminder, overdue, approval rules, queue, retries, permissions),
`npm run test:api` (scheduler endpoint with a mock mail provider: delivery, duplicates, 503 retry, 422 failure, dry run, test mode, approval, HR API
permissions) and `npm run test:unit` (`hr_email_templates.test.ts`: the approved subjects and wording). No real e-mail is sent by the tests.
