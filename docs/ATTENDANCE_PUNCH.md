# Attendance: Punch In / Punch Out and lunch (migrations 20261230000400, 0600, 0700)

**Where:** **Attendance** is the first entry of every dashboard's side menu, directly under the logo / department name. This covers:
* the shared dashboard shell, which every role dashboard uses;
* the Team Member layout;
* the department menu (HR Assistant, HR Admin Head, and the Super Admin's department views).

It is also at the top of HR's Attendance module. Every entry opens the same Attendance page. The **Operations Head** marks attendance exactly like every employee, and also has the Punch In / Lunch / Punch Out
card at the top of their Operations Dashboard. Nothing is recorded automatically at sign-in and nothing blocks the CRM.

## Employee
* **Signing in to the CRM never punches in, and signing out never punches out.** The two are recorded separately (see "CRM sign-in and
  sign-out" below).
* **Punch In** / **Punch Out** need the device's **current location** (migration 0700). When the button is pressed the browser is asked for
  the position (`enableHighAccuracy`, `maximumAge: 0`, up to 20 s; readings are watched for a few seconds and the most precise one is kept).
  Punch Out takes a **fresh** position of its own. If permission is denied, location services are off, no position comes in time, the browser
  has no geolocation, or the position is less precise than `attendance_settings.max_location_accuracy_m` (**1000 m** by default — an
  approximate network/IP position is typically several km), **nothing is recorded** and the card explains how to turn location on. The
  database checks the same rules again (coordinates in range, not 0,0, accuracy within the limit); it never accepts a punch without them.
* **No office geofence:** the CRM has no office locations or allowed radius, so none was invented. Punches are recorded with their location but
  are **not** limited to a workplace boundary until the business approves office locations and a radius.
* Punches recorded before migration 0700 with "location unavailable" are kept as they were.
* **States:** Not Punched In → Punched In → On Lunch → Resumed Work → Punched Out; **Incomplete Attendance** = punched in and never out on a
  past day, or today signed out of the CRM after punching in without punching out (until they sign in again). The buttons follow the state
  (Not Punched In: Punch In; Punched In / Resumed Work: Start Lunch, Punch Out; On Lunch: Resume Work only; Punched Out: nothing more that
  day) and the database checks every action again.
* Every time is the **server's** (`now()`), shown in India time, 12-hour (e.g. 9:05 am). The attendance day is the office day (Asia/Kolkata).
* One Punch In a day (a second click, a refresh or another tab returns the first). Punch Out is append-only: each later Punch Out is a new
  event and the **latest** one is the effective Punch Out; earlier ones stay. The same request again (network retry) or a second click within
  60 seconds is not a new punch.
* **Lunch**: Start Lunch / Resume Work; one open break at a time; several breaks add up against the **45-minute** allowance
  (`attendance_settings.lunch_allowance_minutes`). The running timer is computed from the server's start time and clock, so it survives a
  refresh and does not drift. Over the allowance is **flagged only** (no payroll or score effect). A lunch still open at Punch Out ends with it.
  No lunch before Punch In or after Punch Out. Remaining = allowance − total taken (never below 0); extra = total taken − allowance. Lunch is shown
  separately and is **not** deducted from the worked time (Punch In to Punch Out).

## Reminders and the app (migrations 20270109000200, 20270110000200)

Staff get **Punch In**, **Lunch time**, **Lunch ends in N minutes** and **Punch Out** reminders in the CRM bell and, on each device where
they turned them on, as phone / laptop notifications (Web Push).

* **Times.** Company defaults (HR and the Super Admin, Attendance → Reminders): Punch In 10:00, Lunch 14:00, Punch Out 19:00, one follow-up
  15 minutes later, the lunch warning 5 minutes before the allowance runs out, Monday to Saturday, a master switch and "Turn off reminders for
  today". Each person may choose their own times (Punch In 06:00–13:00, Lunch 11:00–17:00, Punch Out 14:00–23:30) or switch reminders off.
  Every change is in the audit log.
* **Who gets what.** A reminder is skipped when it is already done (punched in, lunch started, punched out), on approved full-day leave, on
  a morning half-day (no Punch In) or an afternoon half-day (no lunch, no Punch Out), on days that are not reminder days, and for the Super
  Admin. Each reminder goes out **once** (per person, day, kind and first/follow-up); a reminder more than 30 minutes late is dropped; when a
  run comes after the follow-up is due, only the follow-up goes. The lunch warning is once per break and says the minutes really left.
* **Sending.** The Worker's `*/5 * * * *` cron calls `POST /api/v1/internal/attendance/reminders` (the dispatch secret; off until
  `SCHEDULED_ENABLED=true`). The database (`attendance_reminders_due`) records each reminder and puts it in the bell; the API pushes it to the
  person's devices (`server/automations/webPush.ts`: RFC 8291 `aes128gcm` + RFC 8292 VAPID with Web Crypto, 10-second timeout). A device the
  push service reports as gone (404 / 410) is switched off. Without `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` the reminders reach the bell only.
* **Devices.** "Turn on reminders" (the banner on every staff dashboard, or Attendance → Reminders) saves the browser's subscription for the
  signed-in person; the last person to sign in on a device owns it, and signing out removes it. At most 10 active devices per person.
  Attendance → Reminders lists them (Remove) and sends a test notification.
* **The app.** `public/manifest.webmanifest` makes the CRM installable ("Amuwa CRM", standalone, icons in `public/icons/`). `public/sw.js`
  only shows the reminders and opens Attendance when one is tapped: **no fetch handler and no cache**, so it never serves an old CRM. It is
  served with `Cache-Control: no-cache` (`public/_headers`) and registered only by the staff dashboard shell. When a browser renews its
  subscription, the service worker sends the old and new one to `POST /api/v1/attendance/push-resubscribe` (no sign-in; only an existing,
  active device is moved, `push_subscription_replace`, service role only).
* **iPhone / iPad:** web notifications work only for the app added to the Home Screen (iOS 16.4 or later): Safari → Share → Add to Home
  Screen, then open Amuwa CRM from the Home Screen and turn reminders on there. The banner shows these steps in a Safari tab.

## CRM sign-in and sign-out (separate from attendance)
* Sign-in: the API records `SESSION_STARTED` once per session (now with the browser and system, e.g. "Chrome on Windows"), and the first
  CRM opening of the day is `attendance_records.rm_login_at` (as before).
* Sign-out: the **Log out** button calls `record_crm_logout()`, which records `SESSION_ENDED` for the caller's own session (session id from
  the verified token, server time, once per session). Closing the browser records nothing, so such a session shows "logout not recorded".
* The sign-in place (city from the IP address) stays visible to the Super Admin only, in Security & Audit Logs, as before.

## HR: the attendance register
HR (not recruiters) and the Super Admin open **Attendance register (all staff)** (the first tab of Attendance in the HR panel):
`hr_attendance_register(date, department, employee, status)` lists **every active employee** for one office day: CRM login and logout,
Punch In, Punch In location, lunch duration, Punch Out, Punch Out location, worked time and state. Filters: date (any past day), department,
employee, state. Opening a row shows the full IST date and time of each punch, latitude, longitude, accuracy, a Google Maps link and a small
map (OpenStreetMap) for Punch In and Punch Out, each CRM session (start, end or "logout not recorded", device), each lunch break, the extra
lunch time and earlier Punch Outs. Each read is audited (`ATTENDANCE_LOCATIONS_VIEWED`).

## Time zone
Times are stored as UTC (`timestamptz`, the database's `now()`); the attendance day is the office day in **Asia/Kolkata**; the screens always
show India Standard Time (e.g. "10 November 2026 – 10:57 AM IST") whatever the device's own time zone.

## Who sees what
| Role | Punch times and locations | Lunch |
| --- | --- | --- |
| Team Member, Team Lead, Department Head | their own | their own |
| Operations Head | none of other staff | durations and flags of the departments and functions they supervise |
| HR, Super Admin | everyone (each load is written to the audit log: `ATTENDANCE_LOCATIONS_VIEWED`) | everyone |

The tables (`attendance_events`, `attendance_lunches`, `attendance_settings`) have no grants: everything goes through `attendance_today`,
`attendance_punch_in`, `attendance_punch_out`, `attendance_lunch`, `my_attendance`, `hr_attendance_register`, `hr_attendance_punches`
(kept for compatibility), `attendance_lunch_overview`, `record_crm_logout`. No function takes another person's id for writing: employees can
only punch for themselves.

## Place names (migration 20261230000600)
Next to the coordinates, accuracy and Google Maps link, HR (and the employee) see the **nearest address** looked up from the coordinates,
e.g. "Near: Baner Road, Baner, Pune, Maharashtra 411045". It is labelled as approximate; until it is found, only the coordinates are shown.
* The server looks each punch up **once** and stores the name with the punch (`attendance_events.place_name`): right after a Punch In / Out
  (`POST /api/v1/attendance/resolve-places`, a few punches at a time), when HR's list has punches without a name, and in the scheduled
  automations run (`/api/v1/internal/automations/dispatch`). 
* Provider: **Google Geocoding** when `GOOGLE_MAPS_API_KEY` is set on the server (better Indian addresses, billed by Google); otherwise
  **OpenStreetMap Nominatim** (free; at most one lookup a second, identified by `GEOCODER_USER_AGENT`, default
  `Amuwa-CRM/1.0 (employee attendance; reverse geocoding of punch locations)`).
* A failed lookup is retried up to **3 times**; the punch keeps its coordinates and Map link either way.
* `attendance_places_pending` / `attendance_set_place` are callable by the server (service role) only. The Operations Head still never sees
  other staff's locations or place names.

## Retention
Coordinates older than **90 days** (`attendance_settings.location_retention_days`) are erased by `private.purge_attendance_locations()`: daily
with pg_cron when it is installed, and on every Punch In in any case. The place name is erased with them. The punch and its time stay; its status becomes `PURGED`.

Tests: `supabase/tests/attendance_punch_lunch_test.sql`, `supabase/tests/attendance_register_test.sql`, `supabase/tests/attendance_places_test.sql`, `supabase/tests/attendance_places.test.ts`, `supabase/tests/ui_attendance.test.mjs` (browser, real geolocation allowed and denied).

## Attendance first in every menu

**Attendance** is the first entry of every dashboard's side menu, on desktop and in the phone drawer.

* **Shared dashboard shell** (Super Admin, Department Heads, Operations Heads, Team Leads, Telecaller, Business Associate, Support, Technical
  Consultant, Accounts, HR Recruiter): `DashboardShell` puts it at the top of the first, unlabelled section. Before, it was a "My day" section
  at the bottom.
* **Team Member layout:** the first entry, above Home.
* **Department menu** (`Sidebar.tsx`, used by the HR Assistant, the HR Admin Head and the Super Admin's department views): the first entry, tab
  `my_attendance`. It opens the same `AttendancePage`, with the HR register in the HR department, as on HR's own panel.

Nothing else changes: the rules, the location capture, the database functions, and who sees what (see above). The Super Admin's Attendance still
opens the register only.

**Test:** `supabase/tests/e2e/run-attendance-nav.sh` signs in as every role made by `scripts/seed-test-accounts.mjs` (20 employee logins) and the
Super Admin. For each employee it checks:
* Attendance is the first menu entry, and the rest of the menu is unchanged;
* the employee can punch in and out with the browser's location;
* each punch is stored as that employee's own.

It then checks that the HR Admin Head sees all of them in today's register, and that the entry comes first on a phone.

