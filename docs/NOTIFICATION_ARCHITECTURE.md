# Notification architecture

How a notice gets from an event in the CRM to a person's bell, phone and computer, and what the Managing Director (the `SUPER_ADMIN`
role) receives about meetings. Related: `NOTIFICATION_RELIABILITY.md`, `NOTIFICATION_COVERAGE.md`, `CREDENTIALS_AND_NOTIFICATIONS.md`.

## The pipeline

1. **Event → bell.** A database function or trigger calls `private.notify` / `private.notify_once`. That writes one row in
   `notifications` (the in-app bell). The bell updates live over Supabase Realtime and shows the unread count. Sound plays per the
   person's settings (`notificationSound.ts`).
2. **Bell → device outbox.** Notices that must reach a phone are also written to `notification_deliveries`, one row per active device
   in `push_subscriptions`. Each row carries a `kind`, a lock-screen-safe `title` and `body`, a `tag` (a newer push with the same tag
   replaces the older one on the device), a `url` to open, and an expiry.
3. **Outbox → Web Push.** The server (`server/automations/notificationDelivery.ts`, `processDeliveries`) claims pending rows with
   `push_deliveries_claim`, sends them with VAPID, retries with back-off, and marks devices that answer 404/410 as invalid.
4. **Device.** `public/sw.js` shows the notification. A tap focuses an open CRM window and posts a message to it (`open-attendance`,
   `open-meeting`, `open-meeting-report`, …), or opens the CRM on the notice's URL.

The outbox has these kinds: `ATTENDANCE_REMINDER`, `TEST`, `SA_ATTENDANCE`, `COMPANY_NOTICE` and `MEETING` (added by
`20270208000200_meeting_oversight_notifications.sql`).

## Meeting notifications (Task 05)

Two migrations, which never notify the same person about the same thing:

* `20270208000100_meeting_push.sql` (see `NOTIFICATION_RELIABILITY.md`): the meeting notices of the **people taking part** (invited, moved,
  cancelled, approvals, summaries, reminders 24 hours, 1 hour, 15 minutes before and at the start) also go to their phones. A trigger on
  `notifications` queues them. A tap opens the meeting (`/?open=meeting&id=…`). This includes a Managing Director who is invited.
* `20270208000200_meeting_oversight_notifications.sql` (below): **management awareness** for a Managing Director who is *not* taking
  part. A tap opens the read-only report view (`/?open=meeting-report&id=…`), because the meeting itself is not theirs to open.

### Management awareness for the Managing Director

#### Root causes found in the audit

1. Meeting notices only reached the bell. The push outbox carried attendance and company notices only, so a phone heard about a
   meeting only while the CRM was open (fixed by `20270208000100_meeting_push`).
2. Meeting notices go only to the people taking part. The Managing Director heard nothing about a team meeting they were not invited to.
3. There was no reminder close to the start: only 24 hours and 1 hour before, and only for participants (participants: `20270208000100`; Managing Director not taking part: `20270208000200`).
4. The "Turn on notifications" banner was switched off on the Managing Director's dashboard (`reminders={false}`), so their devices
   were rarely subscribed for push at all.

#### What happens now

| Event | Who | Bell | Phone / computer |
| --- | --- | --- | --- |
| Internal team meeting scheduled (booked or approved) | Every active Managing Director **not** taking part | "Team meeting scheduled: *title*" | "Team meeting scheduled" + day and time |
| Moved (start time changed) | same | "…rescheduled", with the old time | yes |
| Cancelled | same (urgent) | "…cancelled", with the reason | yes |
| Reminder (default 15 minutes before and at the start) | Every active Managing Director **not** taking part | "In 15 minutes: *title*" / "Starting now: *title*" | yes |

* Only internal team meetings (`private.mms_eligible`) are covered: not appointments, interviews, client meetings or CEO requests.
* An awareness notice has type `MEETING_OVERSIGHT_*` and `data.awareness = true`. An invitation has type `MEETING_*`. A Managing Director who
  is invited gets the invitation and the participants' reminders only, never the awareness notices too. The participants' push trigger ignores
  `MEETING_OVERSIGHT_*` (`private.meeting_push_type`), so nothing is pushed twice.
* **View Meeting** opens the meeting's read-only report view: title, organiser, department, time, status and participant count. It does not
  give access to anyone's calendar.
* Each notice goes out once per meeting, event, start time and person (`meeting_oversight_log`, unique). Retries and repeated runs send
  nothing twice. A reschedule starts new reminders. A move or cancellation cancels reminder pushes that are still waiting.
* **Lock-screen privacy:** the push text never contains the meeting title or participants ("Team meeting in 15 minutes · Tue 25 Nov, 3:00 PM").
  The full details are shown only inside the CRM, after sign-in.
* The trigger on `meetings` is a deferred constraint trigger, so it sees the attendees added in the same booking. It never blocks the
  booking: any error is caught and logged.

### The scheduler

The reminders ride on the existing 5-minute run (Cloudflare cron `*/5`, `POST /api/v1/internal/attendance/reminders`,
`runScheduledNotifications` in `server/automations/attendanceReminders.ts`), next to the 11:00 attendance alert and the notice releases. Each
run calls `mtg_oversight_run(now)` and then sends the push outbox. That outbox also carries the scheduled / moved / cancelled notices the
trigger queued since the last run. The meetings dispatch runs only twice a day, so it would be too late for reminders. A reminder is sent
if a run comes within 10 minutes after it is due, never later. Before the migration is run, the call is skipped and the rest of the run
carries on. Nothing runs until `SCHEDULED_ENABLED` is `"true"` on the Worker (as for every scheduled automation).

### Settings

Attendance → Reminders → **Meeting notifications** (Managing Director only): on/off, phone and computer alerts on/off, and up to 4 reminder
times (2 hours, 1 hour, 30, 15, 10 or 5 minutes before, at the start). Stored in `meeting_oversight_settings` (one row). It is read and
written only through `mtg_oversight_settings_get` / `mtg_oversight_settings_set`, which refuse anyone else (`FORBIDDEN`). Every change is
written to the audit log with the values before and after.

### Device requirements and known limits

* The device must allow notifications for the CRM. The Managing Director's dashboard now shows the "Turn on notifications" banner.
* **iPhone / iPad:** Web Push works only when the CRM is added to the Home Screen (iOS 16.4+) and opened from there.
* Desktop alerts need the browser running (it may be in the background). Sound on the device is the operating system's choice. In-app
  sound follows the CRM's sound settings.
* Focus / Do Not Disturb modes on the device can hold notifications back. The CRM cannot override them.

### Tests

* `supabase/tests/meeting_oversight_test.sql` (database, 29 checks): awareness events, nothing for others or for invited Managing Directors,
  reminders once each, cancelled meetings, cancelled pushes on a move, settings, permission denied, audit.
* `supabase/tests/meeting_oversight.test.ts` (unit): the service worker opens the meeting on a tap; the worker runs the reminder check and
  survives a database without the migration.
