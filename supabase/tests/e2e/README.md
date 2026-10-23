# Browser tests

`run-chat.sh` drives real Chromium windows (a client, two Team Members, a Team Lead and a Department Head, plus a phone-sized
window) against a throw-away local stack and checks the chat end to end: live delivery without a refresh, "seen" ticks,
unread badges, notifications, the read-only review, failed sends and retry without duplicates, offline catch-up, long
history, direct messages, groups, attachments, and that every unauthorized attempt is refused.

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
