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
