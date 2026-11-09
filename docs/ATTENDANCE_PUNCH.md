# Attendance: Punch In / Punch Out and lunch (migration 20261230000400)

**Where:** an **Attendance** item in every dashboard's side panel ("My day"; shared dashboard shell, Team Member layout), and at the top of HR's
Attendance module. Nothing is recorded automatically at sign-in and nothing blocks the CRM.

## Employee
* **Punch In** / **Punch Out**: the browser is asked for the location only when the button is pressed. Allowed: the coordinates and their
  accuracy are stored. Denied, unavailable, timed out or unsupported: the punch is still recorded, with that status and **no coordinates**
  (a location is never invented).
* Every time is the **server's** (`now()`), shown in India time, 12-hour (e.g. 9:05 am). The attendance day is the office day (Asia/Kolkata).
* One Punch In a day (a second click, a refresh or another tab returns the first). Punch Out is append-only: each later Punch Out is a new
  event and the **latest** one is the effective Punch Out; earlier ones stay. The same request again (network retry) or a second click within
  60 seconds is not a new punch.
* **Lunch**: Start Lunch / End Lunch; one open break at a time; several breaks add up against the **50-minute** allowance
  (`attendance_settings.lunch_allowance_minutes`). The running timer is computed from the server's start time and clock, so it survives a
  refresh and does not drift. Over the allowance is **flagged only** (no payroll or score effect). A lunch still open at Punch Out ends with it.
  No lunch before Punch In or after Punch Out.

## Who sees what
| Role | Punch times and locations | Lunch |
| --- | --- | --- |
| Team Member, Team Lead, Department Head | their own | their own |
| Operations Head | none of other staff | durations and flags of the departments and functions they supervise |
| HR, Super Admin | everyone (each load is written to the audit log: `ATTENDANCE_LOCATIONS_VIEWED`) | everyone |

The tables (`attendance_events`, `attendance_lunches`, `attendance_settings`) have no grants: everything goes through `attendance_today`,
`attendance_punch_in`, `attendance_punch_out`, `attendance_lunch`, `my_attendance`, `hr_attendance_punches`, `attendance_lunch_overview`.
HR's list has filters (period, department, employee, missing Punch Out, location unavailable, lunch exceeded) and the Punch Out history.

## Place names (migration 20261230000600)
HR (and the employee on their own card) see each captured location as a **readable place**, e.g. "Baner Road, Baner, Pune, Maharashtra
411045", with a small **Map** link and the accuracy ("within 113 m"); the raw coordinates are not shown.
* The server looks each punch up **once** and stores the name with the punch (`attendance_events.place_name`): right after a Punch In / Out
  (`POST /api/v1/attendance/resolve-places`, a few punches at a time), when HR's list has punches without a name, and in the scheduled
  automations run (`/api/v1/internal/automations/dispatch`). Until then the screen says "Finding the place name…".
* Provider: **Google Geocoding** when `GOOGLE_MAPS_API_KEY` is set on the server (better Indian addresses, billed by Google); otherwise
  **OpenStreetMap Nominatim** (free; at most one lookup a second, identified by `GEOCODER_USER_AGENT`, default
  `Amuwa-CRM/1.0 (employee attendance; reverse geocoding of punch locations)`).
* A failed lookup is retried up to **3 times**; the punch keeps its coordinates and Map link either way.
* `attendance_places_pending` / `attendance_set_place` are callable by the server (service role) only. The Operations Head still never sees
  other staff's locations or place names.

## Retention
Coordinates older than **90 days** (`attendance_settings.location_retention_days`) are erased by `private.purge_attendance_locations()`: daily
with pg_cron when it is installed, and on every Punch In in any case. The place name is erased with them. The punch and its time stay; its status becomes `PURGED`.

Tests: `supabase/tests/attendance_punch_lunch_test.sql`, `supabase/tests/attendance_places_test.sql`, `supabase/tests/attendance_places.test.ts`, `supabase/tests/ui_attendance.test.mjs` (browser, real geolocation allowed and denied).
