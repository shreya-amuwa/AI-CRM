# Outages: what happened, what was changed, how to watch for them

## What happened (23–25 Nov 2026)

The CRM froze for 10–40 minutes at a time:
- 23 Nov around 13:15 UTC;
- 24 Nov around 11:15–11:30 UTC;
- 25 Nov from 05:05 to 05:40 UTC (10:35–11:10 IST).

During each freeze:
- screens failed with timeouts;
- staff were signed out because Supabase Auth could not refresh their session (504);
- even Postgres's own tiny system queries took 23–52 seconds.

What it was **not**:
- **Not the CRM's traffic.** Activity in those windows was a few punch-ins and sign-ins, with no imports and no schema changes. Busier hours
  passed without errors. Over 5.5 days the CRM's database work added up to about 4% of one CPU core.
- **Not the data or connections.** The database is 64 MB and used 30 of 60 connections.

What it was:
- **The database machine itself ran short.** The project runs on Supabase's smallest paid size, "Micro": about 1 GB of memory and a
  shared CPU, used together by Postgres, Auth, the API and Realtime. When that box runs short, every part stalls at once.
- **It is far from the users.** The project is in Sydney (ap-southeast-2) while the staff are in India, so every database call travels to
  Australia and back.
- **The CRM made each freeze longer.** 31 people online held 419 Realtime subscriptions, about 13 each. When the database stalled, the
  backlog of changes and every tab's reconnect arrived together, and every open tab reloaded its screens at the same instant.

## What was changed in the code (`claude/outage-resilience`)

**Live updates are paced** (`src/lib/realtimeShared.ts`, used by every screen that follows tables):
- A burst of changes makes one reload per screen, not one per change.
- The reload waits a random 0.4–2 seconds, so the whole office does not reload at the same instant.
- A tab in the background does not reload at all. It reloads once when it is shown again, and only if something changed.

**The bell re-reads after a reconnect at a random moment** within 0.5–5 seconds (`reconnectDelayMs`), instead of every tab at once.

**The Notice Board badge** no longer opens its own subscription to every notification. It follows the bell's own filtered channel. This
halves the notification subscriptions; the database checks each subscription for every notification written.

**`GET /api/v1/health/database`** is a check for an uptime monitor:
- **200** when the database answers within 3 seconds.
- **503** "slow" or "down" otherwise, with the time it took.
- A result is reused for 10 seconds, so a monitor never adds load to a struggling database.
- `/health` keeps answering 200 for deployment checks.

## Get told when it happens (owner, 5 minutes)

Add an uptime monitor on `https://crm.amuwacorporation.com/api/v1/health/database`:
- **Check:** every 1 minute.
- **Alert:** after 2 failures in a row.
- **Where to notify:** e-mail and/or phone.

Sentry (already used), UptimeRobot or Better Stack all work. The alert then tells you about a freeze before staff do, and the history shows
how often it happens.

## The lasting fix

The database needs more memory and CPU, closer to India. The plan is a self-hosted Supabase on a Contabo Cloud VPS 6 (6 vCPU, 12 GB); see
`docs/SELF_HOSTING_SUPABASE.md`. Until then, if freezes keep hurting, Supabase → Project Settings → Compute → **Small** is the quick relief
(a few dollars more a month and about 2 minutes of downtime when it switches).

Before deciding, look at Supabase → Reports → Database for a freeze window. If memory or CPU were at the top, it confirms the cause.
