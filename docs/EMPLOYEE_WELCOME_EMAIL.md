# Employee welcome e-mail (login set-up)

When a new employee's account becomes **active**, the backend e-mails them automatically: who they are, where to sign in, their login ID and a secure,
one-time link to choose **their own** password. Nobody (HR included) types, sees, receives or stores an employee's password. Migration:
`supabase/migrations/20261219000100_employee_welcome_email.sql` (safe to run twice; run after `20261218000100_operations_head_creation.sql`).

## When it is sent

| Workflow | Queued when |
| --- | --- |
| HR (or Team Lead request) -> approver | the approver **approves** and the database activates the account (`approval_requests` becomes APPROVED). A request that is only submitted, pending, rejected or refused queues **nothing**. |
| Super Admin / Department Head / Team Lead creates an active account | the account is created (the e-mail is held for up to 2 minutes and released by the API as soon as the rest of the creation - details, roles - has succeeded; a failed creation removes the account and its row). |

Not covered: the first Super Admin (bootstrap) and self-registration (pending until approved: not an employee-creation workflow). One row per activation
(`event_key` is unique: `REQUEST:<request id>` or `PROVISIONED:<profile id>`), so the same activation never makes two e-mails.

## What the employee receives

Subject `Welcome to Amuwa Corporation – Your CRM Login Credentials`. Branded (logo, navy header), the employee's name, welcome message, employee ID (when there is
one), department, designation, **login ID** (the work e-mail), the CRM login page, a **Set your password** button (+ the plain address), first sign-in steps, the
mandatory-password notice and the HR contact (`HR_REPLY_TO`, else `EMAIL_REPLY_TO`). All values come from the database record; `server/automations/welcomeTemplates.ts`.

## Credentials and security

* **Link, not password.** The server makes a one-time Supabase Auth recovery link **at send time** (`AuthAdminRepository.passwordLink`) and puts it only in the e-mail. It is not stored in
  any table, attempt record, notification, audit entry, log or API response (asserted by the tests). A newer link replaces the older one (Auth keeps one), which is how a resend
  invalidates a superseded link. The link works once and for the Auth OTP lifetime (Supabase > Authentication > Email > OTP expiry: set it to the security policy, at most 24 h);
  an expired link shows "ask HR to resend".
* **The account starts with a random password nobody knows** (`temporaryPassword(28)`, CSPRNG). The HR request form and the Add Member form no longer ask for a password; the API still
  accepts one from older callers but never puts it in an e-mail, response or log.
* **`/set-password`** (standalone page, `StaffSetPassword`): the token is exchanged for a session only when the employee presses Save (an e-mail scanner opening the link cannot use it up).
  `POST /api/v1/me/password` then sets the password through the server (hashed by Supabase Auth, never stored or returned) and closes the welcome e-mail
  (`welcome_email_setup_done`). The employee then opens the dashboard of their own role; access is unchanged by this feature (role, department and team come from the approved record).
* After the employee chose a password **no resend is possible** (it would be a password reset by e-mail): "Forgot password?" on the staff sign-in page covers that (`POST /api/v1/auth/forgot-password`, migration 20261231000700: only an ACTIVE employee gets a one-time link to `/set-password?purpose=reset`; the answer is the same for every address; 5 requests per 15 min per caller, 3 per hour per address).

## Tracking, retries, resend

`employee_welcome_emails`: employee, address, type (`WELCOME_LOGIN`), trigger event, status `PENDING / PROCESSING / RETRYING / SENT / FAILED` (+ `SKIPPED` no usable address / account not active,
`DRY_RUN` while `AUTOMATION_MODE=dry_run`), attempts (retry count = attempts - 1), sent time, safe error text, who activated, resend count / time / by. `employee_welcome_email_attempts`
keeps every attempt and every resend request. **SENT is recorded only after the mail provider accepted the message**; a dry run is never SENT.

* The sender uses the existing mail setup (`AUTOMATION_MODE`, `EMAIL_PROVIDER`, `EMAIL_FROM`, SMTP / Resend / Brevo, `AUTOMATION_TEST_RECIPIENTS`, `AUTOMATION_DISPATCH_SECRET`): see `HR_EMAIL_AUTOMATION.md`.
  `server/automations/welcomeDispatcher.ts` claims due rows (two senders never take the same row), makes the link, sends, records.
* Temporary failures (network, 5xx, 429) are retried after 5, 15, 60 and 240 minutes and end FAILED after 5 attempts; a permanent refusal fails at once. A failure never undoes the activation.
* `WELCOME_EMAIL=off` (optional, server environment) pauses only this sender (rows keep queueing); leave it unset in production.
* It runs by itself: right after an approval / creation (same request) and on every scheduler tick (`/api/v1/internal/automations/dispatch`, which also retries). **No Email Automation page is needed.**
* **HR is notified** in the Notification Center when the account is created (approved requests) and when the welcome e-mail fails (`EMPLOYEE_WELCOME_EMAIL_FAILED`).
* **Employee Requests** (HR dashboard) shows for each approved employee: Account: Active, Welcome email: Sent / Failed / Retrying..., the error text, "Password set by the employee", and **Resend welcome e-mail**.
  `GET /welcome-emails[?status=&employee=]` and `POST /welcome-emails/:employeeId/resend` are open to HR, the Super Admin and the employee's Department Head (checked in the database). A resend is refused while
  one is queued or being sent, within 2 minutes of the last send / resend, after the employee set their password, for an inactive account and without a valid address; every resend is recorded with who asked and audited.

## Email Automation menu

The backend does not depend on the HR sidebar entry. Removing "Email Automation" from the menu removes only the navigation: the configuration, triggers, templates, event processing, tracking and
retries keep running. (This change did not touch the sidebar entry; its page is still reachable until that entry is removed.)

## Tests

`supabase/tests/employee_welcome_email_test.sql` (queueing at activation only, no duplicates, claim / finish / retries, who sees and resends, nothing stored), the *Welcome e-mail* block of
`supabase/tests/api_integration.test.ts` and `supabase/tests/e2e/run-welcome-email.sh` (real browsers: HR request -> approval -> e-mail content, first password, retry, failure and resend, direct creation by Super Admin / Department Head / Team Lead, dry run).
