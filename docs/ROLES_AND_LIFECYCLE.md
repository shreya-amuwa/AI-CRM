# Roles, verification and client logins

This describes the role redesign: who does what from the first sale to a live service, where the client's login comes from, and which
message goes out for which event. It is the report of the change (roles, permissions, routes, migrations, workflows, provisioning,
message mappings, tests, settings, records that need a person's decision, and what is still undecided).

## 1. The journey

```
Sales  ->  Accounts verifies the payment and creates the client login
       ->  Meta Verifier (first WhatsApp verification)  ->  Department Head  ->  Team Lead  ->  Team Member
       ->  Technical Consultant consults the customer after a configurable delay (add-ons, notes, follow-up)
```

* Sales / Support sell and collect the documents. **Accounts** verifies payments and, for every service, creates the client dashboard login.
* The **Meta Verifier** does the *initial* WhatsApp verification only: reviews the documents, records notes and outcomes, sends a customer
  back for correction, and hands the verified customer to the Department Head. The history stays with the customer.
* The **Technical Consultant** does the *later* consultation: add-on discussion, consultation notes, follow-up dates and the existing
  add-on workflow. The consultant no longer creates the client login and no longer verifies WhatsApp customers' first documents.
* **Services that need no consultant** (the direct journey) are verified by Sales / Support and sent to their delivery department.

Which route a customer takes is **data**, not code: `crm_services.requires_technical_consultant` (consultant or direct) and
`crm_services.requires_meta_verification` (Meta Verifier or consultant). Only WhatsApp API and WhatsApp API + Blue Tick are seeded as Meta
services. The route is pinned on the customer when it is first sent for verification (`customer_onboarding.verification_route`), so
changing the catalogue never moves work in flight. The Super Admin or the Department Head can re-route one customer (with a reason, audited).

## 2. Roles and what each may do

| Role | Where it sits | Can | Cannot |
| --- | --- | --- | --- |
| Super Admin | top | everything below; makes Operations Heads, Meta Verifiers; sets the follow-up delay and which services are Meta services | |
| **Operations Head** (new) | between Super Admin and Department Head | oversees the several departments the Super Admin assigned (Operations Overview, switches department inside the dashboard) | no automatic Super Admin permissions; cannot make others Operations Heads or give anyone a department |
| Department Head | one department (plus the other function of it, e.g. D Talk and Wabatalk) | manages that department; receives handed-over customers; re-routes a customer; records "Meta verification completed" | can no longer be given several departments (the database refuses it) |
| **Meta Verifier** (new) | Support team member | sees WhatsApp customers sent for verification; authorises documents; enters the WABA ID; writes verification notes and outcomes; sends back for correction; hands over to the Department Head; records "Meta verification completed" | no add-ons, no consultation notes, no follow-ups, no client login, sees nothing of the consultant's customers |
| Technical Consultant | Support team member | consults after the delay; follow-up list; records contacts and outcomes; add-ons; sees a Meta customer **after** the hand-over | cannot create the client login; cannot verify, hand over or write verification notes for a Meta customer |
| Accounts | Accounts department | verifies payments; creates client logins (all services); corrects the e-mail on a record; sends the set-password e-mail again | |
| Sales / Support member | | sell, collect documents; read-only on the client login | create a login |

A person is **either** a Meta Verifier **or** a Technical Consultant (a database trigger refuses both). Both are flags on `profiles`
(`is_meta_verifier`, `is_technical_consultant`) of a Support team member, like the existing convention - not a rename of a label.

Every rule is enforced in the database (RLS policies and `SECURITY DEFINER` RPCs that check the caller), then again by the API; the screens
only decide what to show.

## 3. Operations Head

* `profiles.is_operations_head` (Department Heads only); `department_access.transition` marks a legacy grant.
* A trigger refuses a cross-department grant unless the person is an Operations Head or the grant is marked `transition`.
* `my_scopes()` / `scopes_of()` honour grants only for Operations Heads, transition grants and facets of the same base department.
* **Existing multi-department Department Heads were not changed and not promoted.** Their extra departments are kept and marked
  `transition`, one audit record each (`MULTI_DEPARTMENT_SCOPE_GRANDFATHERED`). They are listed in Access Control ("to review") for the
  Super Admin to decide: make them an Operations Head, or remove the extra departments.
* Audit: `OPERATIONS_HEAD_SET`; the person is notified.

## 4. Meta verification and the Technical Consultant follow-up

1. Sales sends the customer for verification. `forward_to_consultant` pins the route. A Meta customer needs an active Meta Verifier in
   the department, otherwise the send is refused with a clear message (no customer is stranded).
2. The Meta Verifier reviews, writes notes (`verification_notes`: NOTE / PENDING / NEEDS_CORRECTION / VERIFIED), authorises documents and
   enters the WABA ID, then `send_to_department_head`. The hand-over is validated (everything authorised, one department head exists,
   done once) and creates **one** follow-up (a unique index allows one open follow-up per customer).
3. The follow-up waits as `AWAITING_CONFIGURATION` until the Super Admin sets the delay (Team Member Management > Workflow). **There is
   no default number of days**; it is a decision for the business. Setting it schedules every waiting follow-up from its hand-over date;
   changing it later does not move follow-ups already scheduled.
4. A scheduled job (`tc_followups_process_due`, service role only, called from the dispatch run) revalidates every open follow-up against
   the stored customer. An obsolete one (customer left onboarding or moved department) is **cancelled**, never executed. A due one becomes
   `DUE` and the consultant is notified **once** (`due_notified_at`); with no active consultant the Department Head is told. No browser
   timer or polling is involved. Also a database trigger cancels at once when the customer leaves onboarding.
5. The consultant records each contact (channel, outcome, note, next date). A missed call reschedules; a completed consultation closes it.
   All attempts are kept (`tc_followup_contacts`) and the note joins the customer's consultation notes.

## 5. Client login (Accounts, every service)

* Accounts > **Client Logins** lists every customer with a verified payment: customer, ID, order, e-mail on the record, status, time,
  result (a failure keeps its reason), and the actions *Create login / Try again / Correct e-mail / Send e-mail again*.
* The e-mail is **read from the customer record by the database** (`accounts_client_login_begin(customer)`); the request has no e-mail and
  an e-mail in the body is refused. A missing, invalid or already-used address blocks creation with the reason; Accounts can correct the
  record (reason required, audited with masked addresses) while no login exists.
* No password is typed, shown, stored, logged or sent. The login is created with a random password nobody knows; the client gets an
  e-mail with a one-time **set-password link** that is created at the moment of sending (it expires; a retry makes a fresh one) and is never
  stored. The old encrypted-password column on jobs is now always empty; existing values were erased by the migration.
* Order of events: `begin` (marks the attempt PENDING, refuses a second click) -> create the sign-in -> `record_client_account` (checks the
  sign-in belongs to this customer and e-mail) -> only now the "account created" e-mail and WhatsApp are queued (once per customer and
  channel). A crash between creating the sign-in and recording it leaves a sign-in with this customer's id; the retry **finds and finishes
  it** (`client_auth_user_for`) instead of making a second one. A failure is recorded `FAILED` with a safe sentence and can be retried.
* Existing logins, passwords, e-mails and invoice references are never touched (the migration only adds; a test compares before/after).
* Audit: `CLIENT_LOGIN_REQUESTED/FAILED/CREATED`, `CLIENT_EMAIL_CORRECTED`, `CLIENT_ACCOUNT_EMAIL_RESENT`; no secrets in any of them.
* Removed: `POST /pipeline/customers/:id/client-account`, the consultant's login form, and the consultant's right to the login RPCs.

## 6. Which event sends which message

Every message is a row in `automation_jobs` (the outbox: attempts, status, detail and recipient are persisted; one row per customer, stage
and channel, so an event cannot send twice). Real sending only happens in `AUTOMATION_MODE=live`; tests use dry-run and local mocks.

| Event (recorded in the database) | Stage | E-mail | WhatsApp status / `stage_code` |
| --- | --- | --- | --- |
| Verification started, website present | `UNDER_REVIEW` | Documents Received - Under Review | Under Review |
| Verification started, no website | `WEBSITE_PENDING` | Mini Website for Your Business | Website Pending |
| Website link authorised | `WEBSITE_READY` | Your Mini Website is Ready | Website Ready |
| Every document authorised + website | `META_VERIFICATION` | Meta Verification In Progress (2-3 weeks) | Meta Verification |
| **Meta completed the verification is recorded** | `COMPLETED` | Meta Verification Completed (panel link, user ID, **no password**) | Status Completed |
| **Accounts created the client login** | `ACCOUNT_CREATED` | Your dashboard is ready - set your password (one-time link) | Account Created |
| Payment request sent to Accounts | `ACCOUNTS_PAYMENT` | internal e-mail to Accounts | none |

A pending-verification event can never send the completed wording: `COMPLETED` is queued only by `mark_meta_verification_completed`
(Meta Verifier, Department Head, Super Admin or the consultant of the customer), only after the application stage, once. A login existing
no longer implies "completed" (it did before).

## 7. Client dashboard

* `GET /client/service-progress` -> `client_service_progress()`: one entry per purchased service with journey-specific steps
  (WhatsApp: order -> documents -> our verification -> Meta verification -> live; consultant journey: ... -> set-up with our team -> live;
  direct: order -> documents -> delivery team -> live). Only client wording: no staff names, notes, audit data or amounts; only the
  signed-in client's own customer.
* Live updates without a refresh: each milestone writes a keyed client notification (once), which the open dashboard already listens to.
* One definition of "live" (`private.client_service_state`) is used by both the services list and the steps, so they never disagree.
* Invoices: `client_invoices()` returns the client's own invoices for every service (WhatsApp included); files are opened through signed,
  short-lived links only; no public PDFs; nothing creates an invoice to make one visible.

## 8. Routes

New: `POST /users/:id/operations-head`, `GET /users/operations-head-review`, `GET /operations/overview`, `POST /users/:id/meta-verifier`,
`GET|POST /pipeline/customers/:id/verification/notes`, `POST /pipeline/customers/:id/verification/reroute`, `GET /pipeline/verification-route-review`,
`PATCH /pipeline/service-journeys/:code/meta-verification`, `GET /consultant/followups`, `POST /consultant/followups/:id/contact|assign`,
`GET /workflow/settings`, `POST /workflow/tc-followup-delay`, `GET /pipeline/accounts/client-logins`,
`POST /pipeline/customers/:id/accounts/client-login|customer-email|account-email/resend`, `POST /pipeline/customers/:id/meta-verification-completed`,
`GET /client/service-progress`.
Changed: `POST .../accounts/client-login` takes no body. Removed: `POST /pipeline/customers/:id/client-account`.
`/internal/automations/dispatch` also runs the follow-up job and reports `tcFollowups`.

## 9. Migrations (in this order, all re-runnable)

1. `20261204000100_operations_head.sql`
2. `20261204000200_meta_verifier_workflow.sql`
3. `20261204000300_accounts_client_provisioning.sql`
4. `20261204000400_client_service_progress.sql`

`supabase/run_these_4_migrations_roles_provisioning.sql` is the four in one file for the SQL editor. `supabase/review_role_redesign.sql` is a
read-only list of the records that need a decision (section 11).

## 10. Settings and environment

* No new variable is required. `APP_URL` **must** be set in production (the set-password link points to it; without it the account e-mail fails
  and Accounts is told). `AUTOMATION_SECRET_KEY` is no longer used and can be removed.
* The WhatsApp router (Automation Builder) needs a rule for the new status `Account Created` / `stage_code ACCOUNT_CREATED`.
* Super Admin, after deploying: set the follow-up delay (Workflow tab), create the Meta Verifiers (Add Team Member > Meta Verifier), review the
  heads marked "to review" (Access Control).
* Follow-up due notices are produced by the dispatch run (`/internal/automations/dispatch`, Vercel cron twice a day). The follow-up list shows a
  follow-up as due as soon as its date has passed, whatever the cron cadence; add a cron entry if notifications are needed sooner.

## 11. Records that may need a decision

Run `supabase/review_role_redesign.sql`: Department Heads with extra departments; customers in verification whose route differs from their
services (kept on their route; move by hand); departments with WhatsApp customers but no Meta Verifier; follow-ups waiting for the delay;
client logins whose e-mail differs from the record; customers with a verified payment and no login (and why); duplicate e-mails across
customers; jobs still holding a secret (must be 0).

## 12. Still undecided (needs the business)

1. **The number of days** the consultant waits - deliberately not set. Until it is set follow-ups wait.
2. **The trigger point** of the follow-up is the hand-over to the Department Head (the moment the customer has finished the Meta Verifier's
   part). Say if it should be the Department Head's pass-on or the Meta completion instead.
3. **Which services are Meta services** - only the two WhatsApp API services are seeded.
4. The multi-department Department Heads (section 3).
5. Customers already forwarded keep the consultant route (listed for review).
6. There is no go-live marker for direct services: a customer whose services are all sent to the delivery department becomes a customer and
   the service counts as live, as before. Staff can set an explicit status (`set_customer_service_term`). Say if the delivery team should
   mark go-live.
7. How soon a due follow-up should notify (cron cadence).
8. The Department Head's own screen has no button for "Meta verification completed" or for re-routing yet (the API and database allow it);
   the verifier, the consultant and the Super Admin workflow screens have them.

## 13. Tests

`supabase/tests`: `operations_head_test.sql`, `meta_verifier_test.sql` (route, rights, notes, hand-over, delay, due, cancel, re-route,
re-run), `client_provisioning_test.sql` (orphan sign-ins, e-mail checks, queue access, failed message, re-run), `client_progress_test.sql`
(steps, notifications once, isolation, invoices), the adapted `rls`, `automations`, `journeys` suites, `api_integration.test.ts` (routes,
dispatch, set-password link, no secrets), unit tests (`journey_service`, `onboarding_status_map`), and browser tests
(`ui_head_departments`, `ui_access_control`, `ui_client_logins`). Run `npm run test:db`, `test:api`, `test:unit`, `npm run typecheck`.
