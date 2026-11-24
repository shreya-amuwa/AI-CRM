# Notification reliability: attendance reminders, Web Push delivery, sound and Notification Health

Migration `20270126000200_notification_reliability.sql`. Related: `docs/ATTENDANCE_PUNCH.md` ("Reminders and the app"), `docs/CHAT.md`
("Push notifications"), `docs/DEPLOYMENT_CLOUDFLARE.md` ("Attendance reminders and push").

## What "delivered" means here

Web Push gives the CRM one answer: whether the **push service** (Google FCM, Mozilla, Apple, Microsoft) **accepted** the message. It does
not tell the CRM whether the phone or laptop **showed** the notification, or whether it **made a sound**: that depends on the browser,
the operating system, notification permission, Do Not Disturb / Focus, battery saving and the network. The CRM therefore never says
"delivered". Its statuses are:

| Status | Meaning |
| --- | --- |
| `PENDING` | Queued; waiting for the next scheduled run (or sent at once, for a test). |
| `PROCESSING` | Taken by a run, with a lease (60 s + the run's budget). If the run dies, the row is taken again after the lease. |
| `ACCEPTED_BY_PUSH_SERVICE` | The push service answered 2xx. |
| `RETRY_PENDING` | Timeout, network error, 429 or 5xx: tried again after 1, 3, 10 minutes (or `Retry-After`, 30 s–15 min). |
| `FAILED` | A permanent answer (400, 401/403 VAPID refused, 413), the device is gone (404/410), or 4 attempts used. |
| `EXPIRED` | Not sent in time: never pushed late (30 minutes after the reminder was due; the lunch warning when the break ends). |
| `CANCELLED` | No longer true or no longer addressed correctly: the action was done (punched in, lunch ended, punched out), approved leave, reminders switched off, the device was removed, switched off, or **now belongs to another person** (shared phone). |

The reminder itself also records `push_status` on `attendance_reminder_log`: `QUEUED` (n devices), `NO_DEVICE`, or `PUSH_OFF` (the server
has no working VAPID keys; the reminder reached the bell only, and nothing is queued for later).

## Root causes found (code)

1. **Reminders were marked "sent" before any push.** `attendance_reminders_due` inserted into `attendance_reminder_log` (the once-only
   record) and the bell, then returned the devices; the API pushed afterwards. Any push failure (timeout, 429/5xx, the Worker stopping, the
   Worker's per-invocation **subrequest limit** — 50 on the Cloudflare Free plan — when everybody's 10:00 Punch In is due at once) was never
   retried, and nothing recorded it.
2. **No per-device outcome, no retry, no visibility.** `push_subscriptions_report` only stamped `last_success_at` / `last_failure_at`.
   A transient failure and a permanent one looked the same; nobody could see which employees were not reachable.
3. **No Resume Work reminder.** Only "Lunch ends in N minutes", a few minutes before the allowance ran out — and none at all when less
   than the warning was left (a second break).
4. **No sound outside chat.** `NotificationContext` refetched on Realtime events but never played anything; only chat had a chime.
5. **Realtime could stop for good.** The notification channel was subscribed once, with no status handling: after a network drop, laptop
   sleep or channel error the bell stopped updating until a page reload; a failed fetch was silently ignored.
6. **Devices could not be diagnosed.** Neither the employee nor HR could see whether a device was blocked, expired, or ever accepted a push.

## Reminder flow now

```
Cloudflare cron */5 (worker/index.ts, SCHEDULED_ENABLED=true)
  → POST /api/v1/internal/attendance/reminders (dispatch secret)
    → attendance_reminders_generate(now, push configured?)       one transaction per run:
         reminder log row (unique per person, day, kind, step, lunch break)
         + bell notification (notifications)
         + one notification_deliveries row per active device (unique per reminder and device)
    → processDeliveries (server/automations/notificationDelivery.ts)
         push_deliveries_claim: expire stale rows, cancel rows that are no longer true / mis-addressed, lease the rest (skip locked)
         send ≤ 6 at a time, ≤ PUSH_MAX_PER_RUN (40) per run, ≤ 20 s
         push_deliveries_report: accepted / retry / failed / gone (404/410 switches the device off for good)
    → notification_scheduler_run_record (counts, push configured, error code)
```

* Overlapping runs cannot duplicate anything: the unique keys plus `for update skip locked` leases.
* A run that crashes after generation loses nothing: the bell row exists, the deliveries are `PENDING` (or `PROCESSING` with a lease that
  runs out) and the next run sends them. Delivery is at-least-once: a run that pushed and died before reporting can push the same
  reminder again; the push `Topic` and the notification `tag` make the second one replace the first on the device.
* The push `TTL` is the time left until the reminder expires, so a push service never shows an out-of-date reminder hours later.
* Before the migration is run, the API automatically uses the old path (`attendance_reminders_due`), unchanged.

### Late delivery policy

| Situation | Behaviour |
| --- | --- |
| Cron delayed / a few runs missed | The latest due step is generated if at most 30 minutes late (as before); a run that comes when the follow-up is already due sends only the follow-up. |
| Worker failure / Supabase unavailable | Nothing is generated while down; when back, anything still within 30 minutes is generated; queued deliveries continue until they expire. The run is recorded as failed (`GENERATION_FAILED`), and Notification Health shows "Delayed" / "Not running". |
| Employee offline | The push service keeps the message for its TTL (≤ the reminder's expiry), then drops it. The bell keeps it. |
| Invalid subscription (404/410) | Device switched off (`EXPIRED_AT_PUSH_SERVICE`), its other waiting rows cancelled, never retried. |
| Action already completed | Rechecked before every push and every retry: `CANCELLED (NO_LONGER_DUE)`. |

## The four reminders

| Reminder | When | Only if | Follow-up |
| --- | --- | --- | --- |
| Punch In — "Time to Punch In" | effective Punch In time | not punched in; not on full-day or morning half-day leave | one, `reminder_follow_up_minutes` (15) later |
| Lunch — "Lunch time" | effective lunch time | punched in, not out, no lunch yet today; not on full-day / afternoon leave | one, same delay |
| Lunch ends soon — "Lunch ends in N minutes" | `reminder_lunch_warning_minutes` (5) before the allowance left runs out | the break is open, more than the warning is left | — |
| **Resume Work** — "Time to Resume Work" / "Your lunch break has ended. Please tap Resume Work in Amuwa CRM." | the real start of the open break + the allowance **left for the day** (earlier breaks counted; `lunch_allowance_minutes`, 45). A break started with nothing left: 5 minutes after it starts. | the break is still open and not punched out | one, `reminder_resume_follow_up_minutes` (10, 0 = none; HR: Attendance → Reminders) |
| Punch Out — "Time to Punch Out" | effective Punch Out time | punched in, not out; not on full-day / afternoon leave | one, same delay |

All times are Asia/Kolkata. Company pause, the company switch, reminder days, the personal switch and the Super Admin exclusion apply to
all of them. A reminder never punches anybody in or out, and no lunch or payroll rule was changed.

## Sound

`src/lib/notifications/notificationSound.ts` (shared with `src/lib/chat/chatSound.ts`, whose behaviour is unchanged).

* Switches: **Attendance reminders**, **Chat messages**, **General notifications** (Attendance → Reminders → Notification sound), on by
  default, saved with the person's settings (`notification_sound_save`) and remembered in the browser.
* **Test sound** plays inside the click (the only moment browsers allow audio to start). The person can confirm "I heard it" — the only
  honest evidence that sound works on a device (`sound_confirmed_at`).
* A chime plays only for a notification that is new since the page loaded (nothing at sign-in or after a refresh), unread, at most 15
  minutes old, not caused by the person, once per notification across tabs (`crm.sound.played` in localStorage; a hidden tab waits a
  moment so the visible tab chimes first), at most one chime per 2.5 s. Chat notifications keep the chat chime only.
* When the page is hidden and this device has push on, the page stays quiet: the operating-system notification is the alert.
* The service worker shows pushes with `silent: false` and `renotify`. **Websites cannot choose the sound of a notification shown by the
  operating system** while the CRM is closed; volume, sound and Do Not Disturb are the device's.

## Realtime and the Notification Center

`src/context/NotificationContext.tsx`: the channel is re-opened after `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` with backoff
(2 s → 60 s, jitter) and the list is read again when it reconnects, when the tab becomes visible or focused, when the network returns and
when a push arrives (`push-received` from `public/sw.js`). Only while Realtime is down and the tab is visible is the list read every 30 s.
One read at a time (a read asked for meanwhile runs once after it); a failed read is retried with backoff and shown in the Notification
Center. Answers for a previous account are discarded (shared browser).

## Devices

Attendance → Reminders → My devices: **Turn on notifications**, **Send test notification** (then "Did it appear? Did it make a sound?"),
**Test sound**, **Check device status** (support, permission, subscription, whether the CRM knows this device, sound allowed) and
**Notification troubleshooting** per platform (iPhone/iPad Home Screen app, Android, Windows, Mac). The banner says *"Enable notifications to
receive Punch In, Lunch, Resume Work and Punch Out reminders."* and is hidden for the day with "Not now" (no repeated permission prompts:
the browser is asked only when the person taps the button).

Each staff browser reports a small summary at most once a day or when it changes (`notification_client_check`: permission, subscribed,
audio allowed, installed app; a random browser id — never the push address or keys).

Shared devices: a subscription belongs to the last person who turned it on or signed in on it; signing out removes it; a delivery whose
device moved to another person is cancelled, never re-addressed.

## Notification Health

Super Admin → **Notification Health**; HR staff (not recruiters) → Attendance → **Notification health**. `notification_health` /
`notification_health_employee` (audited: `NOTIFICATION_HEALTH_VIEWED`). One row per **active** employee except the Super Admin (the same
people the reminders are for — no hard-coded list); suspended, revoked, pending accounts, clients and candidates are not included.

Statuses (first that applies): Company reminders paused → Reminders disabled by employee → Push configuration unavailable → Notifications
blocked (no device and a browser reported "blocked") → Device not registered → Delivery failed (the last finished push failed after the
last acceptance) → Retry pending → Setup required (no push accepted in 14 days) → **Ready** (a push was accepted in the last 14 days, nothing
failed since). A registered device alone is never "Ready". Extra flags: no reminder due today (day off, leave), reminder not generated as
expected (Punch In / Punch Out 10 minutes after due), sound status (confirmed / allowed in browser / not allowed yet / unknown).

Also shown: the scheduler (last successful run; Healthy ≤ 15 min, Delayed ≤ 60 min, Not running), the last 24 h counters (generated,
attempted, accepted, failed, retried, expired devices, no-device reminders), today's reminders and the queue. Filters: department, role,
issue. A row opens the employee's devices (label, state, times, codes), browser reports and last 30 deliveries — never an endpoint, key,
message text or punch location.

**Send test** (per employee, with a confirmation): queues a test to their active devices, sends it at once and shows how many push
services accepted it. Max 3 per employee and 30 per administrator per hour; the employee sees "HR sent a test notification" in their bell;
audited (`NOTIFICATION_TEST_SENT`); no attendance or reminder record is created. Employees' own tests: max 5 per 10 minutes.

## Meeting notifications on phones (20270207000100)

Meeting notifications used to reach the bell only. Now each meeting notification a person receives in the CRM that needs their attention
is also pushed to each of their active devices (delivery kind `MEETING`), by the same delivery worker (retries, dead-device clean-up,
expiry). This is for everyone, the Managing Director included, and only for meetings they are in (host, organiser, invitee, or one waiting
for their approval): who is notified does not change.

* **Pushed:** invited, rescheduled / moved, cancelled, reminders, approval requested / approved / declined / another time proposed,
  scheduled, a guest booked, summary submitted / revised / due / overdue (`private.meeting_push_type`). **Bell only:** answers to an
  invitation, presence, Google sync problems and other information-only types.
* **One push per notification and device** (`notification_deliveries.notification_id` + device, unique), so a retry never sends twice.
  Nobody is told about their own action. A newer notice about the same meeting replaces an older one still waiting (a late retry of a
  reminder never covers "Meeting cancelled").
* **Lock-screen text:** a fixed label and the meeting's title ("Meeting request: Q3 review", "In 15 minutes: Q3 review") and its time
  (IST; for "Another time proposed", the proposed time). Never the agenda, minutes, participants, or who asked or booked (the bell's own
  text, which can name them, is not used).
* **Tapping it** opens that meeting: `/?open=meeting&id=…` (or, with the CRM already open, the service worker asks it to open the meeting).
* **Expiry:** an hour after the meeting starts (at least 30 minutes from when it was queued, so retries can run), so a stale reminder is
  dropped; summary notices a day after they were queued. Without push keys the rows are closed as expired the next time that person gets a
  meeting notice.
* **Reminders:** 24 hours and 1 hour before, plus **15 minutes before** and **at the start** (within 5 minutes). Each once per start time,
  so a moved meeting is reminded again and a cancelled one is not. They are created by the 5-minute scheduled run
  (`/internal/attendance/reminders` now creates them first: two database calls, so the attendance reminders keep their request budget;
  Google sync and e-mails stay with the dispatch) and still by the daily dispatch. Guests get e-mail reminders 24 hours and 1 hour before,
  as before (booked at short notice: the 1-hour e-mail at the 15-minute mark).
* **Right after a change** (create, move, cancel, approve…), the pushes are sent at once, not at the next 5-minute run.
* Without push keys, or without a registered device, the bell works as before. Each person's devices and a test send are under
  Attendance → **Reminders** (this includes the Managing Director, who is not listed in Notification Health).
* Known limit: in the older department panels (side menu) a tapped push opens the CRM but not Meetings when the CRM was closed (notices
  behave the same today); with the CRM open it opens Meetings.
* Tests: `supabase/tests/meeting_push_test.sql`, `supabase/tests/meeting_push_open.test.ts`, and "meeting push" in
  `supabase/tests/api_integration.test.ts`.
* Rollback: drop the trigger `notifications_meeting_push` on `public.notifications` (meetings go back to bell only); the extra column, index
  and reminder kinds are harmless to leave.

## Security

All new tables have RLS on and no grants; access only through `security definer` functions with `set search_path = ''`.
Service role only: `attendance_reminders_generate`, `push_deliveries_claim`, `push_deliveries_report`, `notification_scheduler_run_record`.
Self only: `push_test_enqueue`, `push_test_confirm` (marks only the caller's own device), `notification_sound_save`, `notification_sound_confirm`,
`notification_client_check`. HR staff and Super Admin: `notification_health`, `notification_health_employee`, `notification_admin_test`,
`hr_attendance_resume_follow_up_save` (HR). Error text stored is a short code (`HTTP 503`, `TIMEOUT`, `DEVICE_GONE`), never a response body,
endpoint or key. History is kept 30 days (browser reports 90).

## Settings

| Variable | Where | Default | |
| --- | --- | --- | --- |
| `SCHEDULED_ENABLED` | Worker variable | off | must be `true` on the production Worker, or no reminder is ever generated |
| `CRON_SECRET` / `AUTOMATION_DISPATCH_SECRET` | Worker secret | — | 16+ characters |
| `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY` | Worker secret / variables | — | without them: bell only, everyone "Push configuration unavailable" |
| `PUSH_MAX_PER_RUN` | Worker variable | 40 | pushes per scheduled run (1–500); raise on the Workers Paid plan (e.g. 400) |

## Tests

* `supabase/tests/notification_reliability_test.sql` (89 checks): generation once, NO_DEVICE / PUSH_OFF, leases and double claims,
  accepted / retry / gone / max attempts / expiry / crashed worker, stale and re-assigned devices cancelled, Resume Work (end of allowance,
  follow-up, several breaks, allowance used up, after Resume Work, after Punch Out), leave, tests and their rate limits, sound settings,
  Notification Health permissions (team member, Department Head outside HR, HR Recruiter refused), statuses, no secrets, audit.
* `supabase/tests/notification_delivery.test.ts`: push answer classification, per-run limit, concurrency, budget, sender errors.
* `supabase/tests/notification_sound.test.ts`: audio unlock, once per notification across tabs, bursts, switches, hidden + push, test sound,
  which new notification chimes.
* `supabase/tests/api_integration.test.ts` ("notification reliability"): the real API with a fake push service and real VAPID encryption:
  self test, 503 → retry → accepted, 410 → device off, run records, admin test, health statuses and permissions.
* Existing `attendance_reminders_test.sql`, `chat_push_test.sql`, `web_push.test.ts`, `chat_sound.test.ts`, `ui_reminders.test.mjs` still pass.

## Manual device test matrix (not automated — results must be recorded on real devices)

| # | Device | Steps | Expected |
| --- | --- | --- | --- |
| 1 | Chrome / Edge, Windows | Turn on notifications → Send test → confirm | Notification with the OS sound; Health: Ready |
| 2 | Same, tab in background | Wait for a reminder (or an admin test) | OS notification; no second in-app chime |
| 3 | Same, CRM open and focused | Admin test / reminder | Bell updates, one chime (if sound allowed) |
| 4 | Chrome, Android | Same as 1; then lock the screen | Notification on the lock screen |
| 5 | Safari, macOS | Same as 1 | Notification (sound per System Settings) |
| 6 | iPhone, Safari tab | Open Attendance → Reminders | Banner explains Add to Home Screen; no push promised |
| 7 | iPhone, Home Screen app (iOS ≥ 16.4) | Turn on → test | Notification |
| 8 | Any | Block notifications in site settings → reload | Banner "blocked" + steps; Health: Notifications blocked (no device) |
| 9 | Any | Two tabs open, new notification | One chime |
| 10 | Any | Refresh the page | No chime for old notifications |
| 11 | Laptop | Sleep 10 min, wake | Bell catches up within seconds |
| 12 | Shared phone | A signs out, B signs in and turns on | Only B's reminders arrive |
| 13 | Android Chrome and iPhone Home Screen app; CRM open, in the background, closed | A colleague invites you to a meeting, moves it, cancels it | One notification each, title + time only; tapping opens that meeting |
| 14 | Same | A meeting you are in starts in 20 minutes | "In 15 minutes" then "Starting now" notifications |

## Production audit (employee by employee)

The employee-level report is the Notification Health page. To read the same rows directly — read-only — in the Supabase SQL editor
(which runs as the database owner, so it bypasses the page's permission check; share the result only with people allowed to see it),
after the migration:

```sql
-- one row per active employee (Super Admin excluded); pass true if the Worker's VAPID keys are set, false if not
select h.item ->> 'name' as employee, h.item ->> 'department' as department, h.item ->> 'role' as role,
       h.item ->> 'status' as status, h.item -> 'effective' as reminder_times, (h.item ->> 'remindersEnabled')::boolean as reminders_on,
       (h.item ->> 'activeDevices')::int as active_devices, (h.item ->> 'expiredDevices')::int as expired_devices,
       h.item ->> 'lastAcceptedAt' as last_push_accepted, h.item ->> 'lastFailureAt' as last_failure, h.item ->> 'lastFailureCode' as failure_code,
       h.item ->> 'soundStatus' as sound, (h.item ->> 'reminderMissing')::boolean as reminder_missing_today
  from private.notification_health_rows(true) h
 order by h.item ->> 'status', h.item ->> 'department', h.item ->> 'name';

-- the scheduler: has the 5-minute run worked recently?
select finished_at, ok, push_configured, generated, attempted, accepted, retry, failed, gone, no_device, error
  from public.notification_scheduler_runs order by finished_at desc limit 20;
```

Right after the migration every employee shows *Setup required* or *Device not registered* until a push is accepted (a reminder or a
test): no acceptance had been recorded per delivery before. `push_subscriptions.last_success_at` from before the migration counts.
