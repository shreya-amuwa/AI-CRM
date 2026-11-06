# Browser tests

`run-chat.sh` drives real Chromium windows (a client, two Team Members, a Team Lead and a Department Head, plus a phone-sized
window) against a throw-away local stack and checks the chat end to end: live delivery without a refresh, "seen" ticks,
unread badges, notifications, the read-only review, failed sends and retry without duplicates, offline catch-up, long
history, direct messages, groups, attachments, and that every unauthorized attempt is refused. The internal chats are end-to-end
encrypted, so it also checks that the database and the requests hold only ciphertext, the emoji picker, Delete for me / for everyone
(live, after a reload, on another device, stored file removed), a wrong passphrase, a new device, and a key reset with the
key-changed warning (124 checks).

* The stack is a scratch database, PostgREST, `supabase/tests/local-gateway.mjs` (auth, storage and a Realtime stand-in in
  `local-realtime.mjs` that delivers a change only to someone whose own row-level-security lets them read the row) and the web app.
* Passwords are generated on every run; nothing is stored. Phone numbers are generated too.
* It needs `npm i --no-save playwright-core`, PostgREST (`POSTGREST_BIN`), superuser access to a local Postgres (`PGHOST`, `PGPORT`, `PGUSER`) and a Chromium
  (`E2E_CHROMIUM`, or the one Playwright installs). If the machine cannot reach the Tailwind CDN, set `E2E_TAILWIND_FILE`
  to a local copy of the Tailwind browser build.

```
PGHOST=/var/lib/pgcrm PGPORT=54329 PGUSER=postgres POSTGREST_BIN=/path/to/postgrest \
  E2E_CHROMIUM=/path/to/chrome supabase/tests/e2e/run-chat.sh ./chat-screenshots
```

Since migration `20261224000200` the default is the company-readable mode; `run-chat.sh` switches its scratch database to the end-to-end mode
first. `run-chat-readable.sh` (same stack, `chat-readable.e2e.mjs`) checks the default: two browsers that never held a key chat at once with no
secure-messaging bar, button or passphrase, a group works the same way, an older encrypted message is shown as not available without blocking
the composer, the database holds the new messages readable and the old envelope untouched, no key is made, and outsiders are refused.

## Dashboards and the security log

`run-dashboards.sh` uses the same throw-away stack (other ports) and signs in as the Super Admin, a Department Head, a Team Lead and a Team
Member. It checks that the Super Admin lands on the new company dashboard (not the old department hub), that every headline figure equals
the database, that the Department Head and Team Lead see only their own scope, that the demo data of the old Team Lead dashboard is gone, and
that the Security & Audit Logs page lists refused requests, filters, shows details and has nothing to edit or delete. It also checks a phone
width for sideways scrolling and saves screenshots to the directory you pass.

```
PGHOST=... PGPORT=... PGUSER=postgres POSTGREST_BIN=/path/to/postgrest supabase/tests/e2e/run-dashboards.sh ./dashboard-screenshots
```

## Telecaller workspace

`run-telecaller.sh` (own ports) checks the Sales role dropdown in the creation form, the Department Head's Excel upload (errors block it, preview,
confirm, stored file), a Telecaller's Home / Tasks / Leads against the database, routing and permissions (another Telecaller, a Sales member and a
Business Associate), and a phone-sized window.

```
PGHOST=... PGPORT=... PGUSER=postgres POSTGREST_BIN=/path/to/postgrest supabase/tests/e2e/run-telecaller.sh ./telecaller-screenshots
```

## Business Associate workspace

`run-business-associate.sh` (own ports) checks the hand-over from a Telecaller, Tasks, Leads, quotations (approved prices, AI draft, review, PDF stored privately,
revision), demos (validation, conflicts, reschedule, cancel, calendar), Scope of Project (AI draft, section regeneration, review, finalise, new version, PDFs),
routing and permissions, the Department Head's Service Prices page and a phone-sized window. The AI service is a local stand-in started by the test (the runner
points `ANTHROPIC_API_BASE_URL` at it); no external service is called.

```
PGHOST=... PGPORT=... PGUSER=postgres POSTGREST_BIN=/path/to/postgrest supabase/tests/e2e/run-business-associate.sh ./ba-screenshots
```

`run-sales-head.sh` (own ports) checks the Sales Department Head dashboard: it opens at /sales-head/dashboard/…, the menu order (Leads opens Lead List and Lead Assign), the Support
head keeping the Department Head dashboard, Lead Assign with a real .xlsx (column mapping, valid / invalid / duplicate rows, confirmation, history, the same file refused, an old .xls
refused, a Telecaller getting a contact sheet), the leads in the member's own dashboard, Lead List (filters, search, detail, an unassigned enquiry), Daily Tasks (create, overdue, refresh),
Performance cards and workspace, Reports (Team Lead / Team Member, CSV), Income, Notices, Team Members & Access (Sales only), Chat, Notifications, and tablet / phone layouts.
```
PGHOST=... PGPORT=... PGUSER=postgres POSTGREST_BIN=/path/to/postgrest supabase/tests/e2e/run-sales-head.sh ./sales-head-screenshots
```

`run-field-visit.sh` (own ports) checks Field Visit inside the Telecaller, Business Associate and Sales Team Member dashboards: the Field Visit group and its ten pages (no separate dashboard, and
none for Support members, Team Leads or the Department Head), the Overview cards and ten filters against the database, Add Lead (the dashboard's own form, source "Field visit", no duplicate
on a double click), scheduling (validation, double click), Start with the position refused (never marked as captured) and granted (recorded, shown as "captured by the device"), the outcome with
a follow-up, per-lead visit history, the Sales Department Head assigning a lead (the lead keeps its owner; priority and instructions shown; the employee cannot change it) and withdrawing it,
the Accounts pages, and tablet / phone layouts.
```
PGHOST=... PGPORT=... PGUSER=postgres POSTGREST_BIN=/path/to/postgrest supabase/tests/e2e/run-field-visit.sh ./field-visit-screenshots
```

## "Need help?" and the Sales-only pages

`run-sales-only-need-help.sh` (own ports) signs in as twelve internal roles at desktop and phone width and checks "Need help?" is nowhere on the page (phone menu open),
that the Client Dashboard keeps its help box ("Need a hand?" with **Raise a ticket**), that the Sales Department Head has and opens Telecaller Sheets and Service Prices,
that a Support Department Head has neither in the menu, is not let in by a typed address, and is refused (403) by the API.

```
PGHOST=... PGPORT=... PGUSER=postgres POSTGREST_BIN=/path/to/postgrest supabase/tests/e2e/run-sales-only-need-help.sh ./screenshots
```

`run-employee-issues.sh` drives Raise an Issue (a Team Member, a Team Lead and a Department Head: the same page and selector) and HR's two sections
(Employee Issues, Meeting Requests): submitting with validation and an attachment, the reference number, HR's cards, filters, search, assigning, responding,
requesting information, resolving / closing with confirmations, scheduling, declining, proposing another time, what the employee sees (and never the
internal notes), and phone / tablet layouts (83 checks).

`run-member-creation.sh` drives who adds a team member: a Team Lead adds members to their own team at once (the Sales role dropdown with the five Sales roles, the
department / team / Team Lead box, no approval row, the right dashboard for each, the new Telecaller signing in), the API refusing a Team Lead who tries more, HR
submitting an employee ("Employee Submitted for Department Head Approval", pending and unable to sign in, no way around it through `POST /users`), and the Department
Head approving and rejecting (reason required) with HR seeing both outcomes (36 checks).

`run-consultant-meta.sh` drives the Technical Consultant and Meta Verifier workflows on one customer: the consultant sees a Meta customer from the moment Sales sends
it, both statuses on the customer page, each role changing only its own (the Meta change going through the existing Meta verification), Meta onboarding completing
while the customer stays in the consultant's dashboard as Add-on Services Recommended, an open add-on request blocking Completed, and the phone layout (21 checks).

`run-top-performers.sh` drives Top Performers & Rankings from real task and report records: the Department Head's Top 3 / Top 5, complete ranking with an
"Insufficient Data" employee, individual cards with the evaluation, Team Leads compared, monthly recognition (recommended, not official; rejection needs a
reason; only the Department Head approves), the ranking following changed task records, the read-only company view of an Operations Head, the Super Admin's
access through the API, who has no page (Team Lead, Team Member) and the phone layout (35 checks).

`run-operations-head.sh` drives Operations Head creation in a browser: the Super Admin creates one over departments that all have a Department Head (no conflict warning), a second one,
each signs in and sees only their own departments on one dashboard (with the department filter), a department is added (same account) and one removed (access revoked, nothing deleted),
suspend / reactivate, the Department Head rule still refusing a second head, and the existing Department Head still signing in (36 checks).

`run-hr-designations.sh` drives the Super Admin's Add Team Member form for the HR department: the Role dropdown follows the department chosen at the top (HR shows
exactly HR Assistant, HR Recruiter and HR Admin Head; Wabastore / Accounts keep their own roles and the Sales roles), switching departments clears a role that does not
belong to the new one, one employee per HR designation is created through the form and checked in the database, the API refuses wrong department / designation pairs,
and each new employee signs in to their dashboard (HR dashboard, HR Recruiter dashboard, HR Department Head dashboard without Super Admin pages) (20 checks).

`run-recruiter-vacancies.sh` drives the HR Recruiter dashboard: the Work / Recruitment / Management sidebar sections (collapse and expand), the
Department filter listing every department, creating and publishing a vacancy through the form (checked in the database), editing it, putting it on
hold, closing and reopening it, filtering the list by department (including a genuinely empty result), the vacancy surviving a reload, and an HR
Assistant still opening the HR dashboard and being refused by the recruiter API; and the vacancy detail page: the five metric cards with the vacancy's
figures, the breadcrumb, the information sections and skill chips, the "No Candidates Yet" state, a real application (made with the portal's own
career_apply) in the candidates table with a working search / clear and View profile, the layout (three equal information columns side by side and the five figures in one row at 1366 / 1440 / 1920 px, the page as wide as the
content area with no 1400px cap, two columns on a tablet, stacked on a phone) and no horizontal scroll at 390 / 820 / 1280 / 1920 px (49 checks).

`run-reports-approval.sh` drives the Reports page at every level with five people signed in at once and never reloaded: the four-field Team Member form (title, date,
assigned and completed tasks from the member's own task records), the Team Lead's first approval, the Department Head's independent second approval, Fully Approved,
a Department Head revision that starts both approvals again, the Team Lead's individual report without Download and History, and that every change appears on the
other screens by itself with no duplicate cards (24 checks).

`run-welcome-email.sh` drives the new-employee welcome e-mail end to end: HR submits (no password field), the Department Head approves, the backend queues exactly one welcome e-mail
(nothing before approval), HR sees "Account: Active / Welcome email: <status>" and can resend, the employee opens the one-time link, chooses their own password, lands on the dashboard
of their role, signs in again with it, the used link no longer works, and no link or password is left in any table (16 checks).
