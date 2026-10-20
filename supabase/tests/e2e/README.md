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
