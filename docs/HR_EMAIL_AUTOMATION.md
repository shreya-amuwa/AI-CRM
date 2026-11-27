# HR e-mail automation

Birthday greetings, work-anniversary e-mails, probation reminders and employment-confirmation e-mails, sent automatically from the
existing employee data and the CRM's existing mail setup. **It runs entirely on the backend**: there is no Email Automation page, button
or counter in the HR dashboard, and nobody has to sign in, open a page or press anything for the e-mails to go out (see "Backend only" below).

Migration: `supabase/migrations/20261107000100_hr_email_automation.sql` (additive, safe to rerun; needs the HR migrations
`20261027000100` and `20261103000100` to be applied first).

## What is sent, and when

| E-mail | To | When | Once per |
| --- | --- | --- | --- |
| Birthday (`Happy Birthday, <name>! 🎂`) | the employee | their date of birth, 09:00 India time | employee and year |
| Work anniversary (`Happy Work Anniversary, <name>! 🎉`) | the employee | joining-date anniversary (years of service counted from the real joining date, at least 1) | employee and anniversary year |
| Employee Confirmation Reminder — `<name>` — Due `<date>` | the employee | 7 days before the probation end | confirmation cycle |
| Action Required: Confirmation Due in 7 Days — `<name>` (lists id, department, designation, joining date, confirmation due date, reporting manager) | HR | 7 days before the probation end | cycle and HR recipient |
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
* Missing or invalid e-mail addresses are recorded as `SKIPPED` ("No valid e-mail address for the recipient.") in `hr_email_events`; an employee
  without a date of birth / joining date simply gets no birthday / anniversary / reminder until the date is entered in their HR record.
  `GET /api/v1/hr/email-automation/data-issues` (HR staff) lists them.

Dates use Indian time (Asia/Kolkata). 29 February birthdays and anniversaries are celebrated on 28 February in a common year.

## Probation rule

Probation = 6 months from the joining date (14 Sep -> 14 Mar). A confirmation cycle is opened for employees who joined less than 6 months + 30 days
ago and for everyone whose HR status is `Training / Probation`; interns have none; people who joined long ago are treated as already confirmed (nothing is
sent for them). HR can close a cycle that does not apply ("Close", with a reason).

**Approval**: the HR Department Head / Team Lead, the employee's Department Head, or the Super Admin approves in HR dashboard >
**Probation Confirmations** (nobody can approve their own). This is a person's decision, not an e-mail control, so it keeps its own page. The approval stores who and when, the effective date (default: the probation end date) and an
optional note; it queues the two confirmation e-mails (sent on the end date, or at once if it has passed), and an HR record that says
`Training / Probation` becomes `Full-Time`.

## Reliability

* `hr_email_events` holds one row per e-mail with a **unique event key** (`BIRTHDAY:<employee>:<year>`, `ANNIVERSARY:<employee>:<years>`,
  `PROBATION_REMINDER_EMPLOYEE:<cycle>`, ...). The daily check can run any number of times: an occasion is queued once.
* Statuses: `PENDING`, `SENDING`, `RETRY`, `SENT`, `FAILED`, `SKIPPED`, `DRY_RUN`, with attempts, timestamps and the last error.
* Two senders never take the same e-mail (row locks). Temporary failures (network, 4xx/5xx SMTP, 429) are retried after 5, 15, 60 and 240 minutes and
  then marked `FAILED` after 5 attempts; permanent refusals fail at once. A failed e-mail can be re-queued with `POST /api/v1/hr/email-automation/events/<id>/retry` (HR staff). A crashed sender's e-mail is taken again after
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

## The three automation cards (migration `20261115000100_hr_email_cards.sql`) - no longer shown in the dashboard

The HR dashboard page that showed these cards was removed (see "Backend only"); the API `GET /api/v1/hr/email-automation/cards` still returns them. It
had one card per automation: **Birthday Emails**, **Work Anniversary Emails** and **Employee Confirmation Reminders**.
Each card has the status (Active = sending, Active (dry run) = prepared but not sent, Inactive = `AUTOMATION_MODE=off`), the number of e-mails sent / waiting /
failed, the **next execution** (the next occasion and who it is for, 9:00 AM India time), the **last execution** with its real outcome and error, and a
**Preview e-mail template** (the approved wording, rendered by the server with a sample employee). The confirmation card also lists the upcoming reminders
(reminder date = six-month date minus seven days). The figures are live (`public.hr_email_cards()`, HR staff only); there are no placeholders.
There is no month-specific rule anywhere: every date is calculated per employee from the joining date / date of birth in the company time zone
(29 February is celebrated on 28 February in a common year). The designation and reporting manager in the HR reminder are looked up when the reminder is
queued (reporting manager: the Team Lead of the member's team, else the Department Head, else "Not assigned").

If a section cannot load, the page says which one and why instead of a blank "Something went wrong"; a database that has not been given the latest
migration is reported as exactly that (HTTP 503 with a set-up message). Run the migrations in order, including `20261115000100_hr_email_cards.sql`.

## Go-live checklist

1. Run the migration in the Supabase SQL editor.
2. Set the e-mail variables above. Leave `AUTOMATION_MODE=dry_run` first: the daily check prepares and logs everything (**Email history**, status
   "Not sent (dry run)") without sending.
3. Check the employees without dates (`GET /api/v1/hr/email-automation/data-issues` as an HR user) and fill in the missing dates of birth /
   joining dates in their HR records; set `hr.notify_emails` if HR should have a shared mailbox.
4. Send yourself a test: add your own address to `AUTOMATION_TEST_RECIPIENTS`, set `AUTOMATION_MODE=live`, and give a test employee record
   (HR-only) your e-mail with today's date of birth; call the scheduler once
   (`curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/v1/internal/automations/dispatch`) and confirm the e-mail arrives and appears in
   the provider's own log (Gmail "Sent" of the SMTP account, or the Resend / Brevo dashboard). Only listed addresses are e-mailed in this mode.
5. Remove `AUTOMATION_TEST_RECIPIENTS` to go live. Dry-run e-mails that are still relevant (birthdays within 2 days, pending probation reminders) are sent
   then, once.

## Tests

`npm run test:db` (section "HR e-mail automation": dates, Feb 29, once-per-year, 7-day reminder, overdue, approval rules, queue, retries, permissions),
`npm run test:api` (scheduler endpoint with a mock mail provider: delivery, duplicates, 503 retry, 422 failure, dry run, test mode, approval, HR API
permissions) and `npm run test:unit` (`hr_email_templates.test.ts`: the approved subjects and wording) and the browser test `supabase/tests/e2e/run-hr-email.sh` (the scheduler endpoint queues the birthday, anniversary and both confirmation reminders
with nobody signed in and no duplicates on a second run; the HR menu has no Email Automation entry; the Probation Confirmations page works, also at phone width). No real e-mail is sent by the tests.

## Backend only (no dashboard page)

The HR dashboard no longer has an **Email Automation** entry, page, Refresh / "Run the check now" buttons, sent / waiting / failed counts or template
previews. Only the frontend was removed; everything that sends is unchanged and server-side:

| What | Where |
| --- | --- |
| Daily run, 09:00 Asia/Kolkata | Vercel Cron in `vercel.json` (`30 3 * * *` UTC) calls `/api/v1/internal/automations/dispatch` with `CRON_SECRET`; the second daily cron (`0 5 * * *`) is a retry pass. Optional pg_cron every 15 minutes for faster retries (above). |
| What is due (birthdays, anniversaries, 7-day confirmation reminders to employee + HR) | `public.hr_schedule_emails()` in the database, from the real employee records, once per occasion (unique event key) |
| Sending | `server/automations/hrDispatcher.ts` -> `sendEmail()` in `server/automations/providers.ts`: the **same** provider, `EMAIL_FROM` sender and credentials as the client onboarding / welcome / invoice e-mails |
| Delivery log, retries, failures | `public.hr_email_events` (status, attempts, last error, provider response code / reference, sent time) and `public.hr_automation_state` (key `last_schedule`: the last daily run) |
| Approval of a confirmation | HR dashboard > **Probation Confirmations** (kept: it is a decision, not an e-mail control) |

To look at the log without a page (Supabase SQL editor):

```sql
select kind, recipient_email, status, attempts, last_error, sent_at, send_after
  from public.hr_email_events order by created_at desc limit 50;
```

The HR API routes under `/api/v1/hr/email-automation/*` (overview, history, cards, retry, run, data-issues) are kept for scripts and support; no screen calls
them except the probation list / approve / close.

## Confirmed only after the confirmation e-mail is sent (migration `20270223000100`)

* **Confirm** (HR dashboard > Probation Confirmations) validates the record (still undecided, valid effective date, employee still active), records who
  and when, and queues the existing confirmation e-mails; the record becomes **CONFIRMING**, not Confirmed. The server sends the e-mails straight away
  when the probation has ended (otherwise on the end date, as before).
* The record becomes **Confirmed** (`APPROVED`), the HR record turns Full-Time and `EMPLOYEE_CONFIRMED` is audited **only when the employee's
  `CONFIRMATION_EMPLOYEE` e-mail is recorded SENT** (trigger on `hr_email_events`), whoever sent it (the click or the scheduler).
* If the e-mail fails or is skipped, the record stays CONFIRMING and, past its end date, **stays in the overdue list**, with the reason. **Retry e-mail**
  (`POST /api/v1/hr/email-automation/probation/:id/retry-email`) re-queues the same e-mail row (reading the employee's address again): no second
  confirmation and no second e-mail can be created (unique event keys, row locks). A second Confirm is refused (409).
* The confirmation status (`hr_probation_cycles.status`) and the e-mail status (`hr_email_events`) are kept separately; the list shows both
  (`status`, `email.status`, `email.error`, `overdue`).
* **Overdue reminder** (beside Confirm, `POST .../probation/:id/remind-overdue`): an in-CRM reminder to the employee's Department Head(s) and the
  department's HR. It never confirms anybody. An unread reminder is not repeated.
* **Close** also works for a CONFIRMING record whose e-mail cannot go out; its unsent e-mails are dropped.
* `AUTOMATION_MODE=dry_run` / `off`: nothing is really sent, so nobody becomes Confirmed; the page says why. Set `live` in production.
* Paid leave, which starts from the confirmation, follows the same rule (it reads `APPROVED` only).
* Department HR (for example HR (Digitree), see [DEPARTMENT_HR.md](DEPARTMENT_HR.md)) sees and decides its own department's confirmations only.
