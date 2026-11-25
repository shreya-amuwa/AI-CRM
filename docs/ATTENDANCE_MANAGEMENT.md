# Attendance management: team attendance, safe Punch In / Punch Out, corrections

Migration `supabase/migrations/20270205000200_team_attendance_corrections.sql` (Tasks 01 and 02). It builds on the existing attendance
system ([ATTENDANCE_PUNCH.md](ATTENDANCE_PUNCH.md): punches with location, lunch, reminders, HR's register). It is additive and safe to
run twice: no existing table, column, function or rule is changed.

Designations below use the new names (see [ROLE_AND_PERMISSION_MATRIX.md](ROLE_AND_PERMISSION_MATRIX.md)):

- Managing Director = `SUPER_ADMIN`
- CEO = Operations Head

## Team attendance (Task 01)

**Where:**

| Screen | Who | What it shows |
| --- | --- | --- |
| **Attendance → Team attendance** | managers and HR | the full view |
| **Today's Team Attendance** card on the CEO's Operations dashboard | CEO | the counts and each department's availability, with "View all" |
| Same card on the Department Head's overview | Department Head | same |

**Who sees whom.** This is enforced in the database (`attendance_team_overview` / `private.attendance_team_visible`), not by the screen:

| Viewer | Employees listed |
| --- | --- |
| Managing Director, HR staff (not recruiters) | every active employee |
| CEO (Operations Head) | the departments **and functions** of their own scope (`private.scope_covers`): a Support CEO never sees Sales |
| Department Head | their own department and function (and any function they were given) |
| Team Lead | their own team |
| Team Member, anyone signed out | refused |

The Managing Director is never listed. No punch location is returned here; locations stay in HR's register, as before.

**One status per person, so nothing is counted twice.** The existing rules are used (the same as HR's "Today's overview" and the
Managing Director's 11:00 alert):

- **Day start:** the person's own Punch In time from their reminder settings, else the company's (10:00).
- **Day end:** their Punch Out time (19:00).
- **Working days and holidays:** working days are `attendance_settings.reminder_days` (Monday to Saturday); HR's "off for today" is
  the holiday.
- **Leave:** approved leave from `leave_requests`.

| Status | When |
| --- | --- |
| Shift Completed | punched in and out |
| On Break | punched in, a lunch is open (today) |
| Half Day | punched in, with approved half-day leave |
| Late | punched in **after 10:30** India time, for everyone (see [Late marking](#late-marking-company-wide-late-only-after-1030)) |
| Present | punched in otherwise |
| Approved Leave | full-day leave, or morning half-day leave and not punched in |
| Weekly Off / Holiday | not a working day / HR's day off, and not punched in |
| Shift Not Started | today, before their start |
| Not Punched In | today, after their start, within `absent_after_minutes` (60) |
| Absent | after that today, or any earlier working day without a Punch In |

**Summary cards:**

- **Scheduled** excludes weekly offs and holidays.
- **Present** is everyone who punched in, so it includes Late, Half Day, On Break and Shift Completed.
- **Late arrivals** counts everyone who arrived late, including those now on break or finished.
- Each card filters the list on the server.

**Unavailable for work** = Absent, Not Punched In or Approved Leave. These rows are highlighted and counted per department.

**Filters:** date (today by default, up to two years back), department, team, status ("Unavailable for work", "Present", "Late
arrivals", or any single status), and employee search.

**Columns:** Employee (photo or initials), Designation, Department, Team Lead, Status, Punch In, Punch Out, and Remarks. Remarks cover
leave, minutes late, the early Punch Out reason, a pending correction and "on break".

- **Phones:** a compact list, where tapping a person shows their details.
- **Tablets and desktops:** the table, which scrolls inside its box if needed.

**Freshness:** today's view reloads when the browser tab becomes visible again, and every 2 minutes while it is visible. There is also
a Refresh button. Attendance tables are not part of the Realtime publication (it was trimmed for cost), so this does not add a
Realtime channel.

**Overnight shifts:** not supported. Every attendance day is one office day in India time, and the reminder times cannot cross
midnight. Supporting them would mean a shift model first.

## Safe Punch In / Punch Out (Task 02)

**Punch In:**

- **Start your workday?** shows the employee, the date and the current time (the server's clock).
- **Cancel** records nothing. **Confirm Punch In** records it.

**Punch Out:**

- **End your workday?** shows the Punch In, the current time, the total working time, breaks, the net working time and the
  scheduled shift end. These come from the server (`attendance_punch_out_preview`).
- Before the shift end it says **"You are punching out before your scheduled shift end time."** and requires a reason
  (`attendance_settings.early_punch_out_reason_required`, on by default).
- **Continue Working** closes the dialog. **Confirm Punch Out** records it.

**Behaviour of both dialogs:**

- On phones they are a compact bottom sheet (`src/components/common/BottomSheet.tsx`); from 640 px a centred dialog.
- Focus stays in the dialog, Escape closes it while nothing is being saved, and the buttons are disabled while saving.
- Success is shown only after the server's answer.

**Safety against duplicates and invalid actions:**

- **One request id per dialog:** pressing Confirm twice, or retrying after a slow network, sends the same id, and the database records
  it once (the existing `client_request_id` rule).
- **Server checks:** the database still checks every transition (one Punch In a day, no Punch Out before Punch In, no lunch after
  Punch Out), the location rules and the server time.
- **The early reason:** `attendance_punch_out_confirmed` checks it, calls the existing `attendance_punch_out` in the same transaction
  and stores the reason with that punch (`attendance_events.note`, audited as `ATTENDANCE_EARLY_PUNCH_OUT`).
- **Errors:** an error (no location, offline) stays in the dialog. Confirm again is the same request.
- **Before the migration runs:** the screen falls back to the existing Punch Out.

## Attendance corrections (Task 02)

**Asking:** an employee asks (Attendance → Corrections, or "Ask to resume your day" after a Punch Out) for one of:

- **I punched out by mistake: resume my day** (today only);
- **Correct my Punch Out time** (the correct time);
- **I missed my Punch In** (the correct time; only if the day has none).

With a reason (5 to 1000 characters) and optional supporting information, for a day up to `correction_window_days` (30) back.

**Limits:**

- One open request per day; the same request sent again is one request.
- Nobody, employees included, edits attendance directly.

**Who decides:**

- HR staff, the Managing Director, or the CEO / Department Head whose scope covers the employee.
- A Department Head does not decide for another Department Head; a CEO does.
- Never the employee themself. Team Leads do not decide.
- The approvers in scope (not the Managing Director, to avoid noise) get a notification.

**Approving** applies the correction in the same transaction:

| Correction | What approving does |
| --- | --- |
| Resume my day | The day's Punch Out is set aside (`attendance_records.punch_out_at` cleared). The Punch Out events stay as history; the next Punch Out is the effective one. |
| Correct my Punch Out | A Punch Out at the given time is added (`recorded_by` = the approver, location "unavailable", note "Correction approved: …"), and becomes the effective one. A lunch still open then ends with it. |
| I missed my Punch In | A Punch In at the given time is added the same way. |

**Rejecting** needs a reason. The employee is notified either way.

**Audit trail:**

- **On the request:** the original record (`original`), the requested change, the applied record (`applied`), the approver, the time
  and the decision note.
- **In the audit log:** `ATTENDANCE_CORRECTION_REQUESTED` / `APPROVED` / `REJECTED` / `CANCELLED`.

**Impact:** payroll, incentives and reports do not read attendance (checked: no incentive or payout function reads
`attendance_records`). HR's register and the employee's own history show the corrected day.

## Settings (new columns in `attendance_settings`)

| Column | Default | Meaning |
| --- | --- | --- |
| `late_grace_minutes` | 0 | **Not used** since `20270211000100` (late marking is the fixed company-wide 10:30 rule) |
| `early_punch_out_reason_required` | true | A reason is required before the shift end |
| `correction_window_days` | 30 | How far back a correction may be asked |

Change them with SQL, e.g. `update public.attendance_settings set correction_window_days = 45;`.

## Late marking (company-wide: Late only after 10:30)

Migration `20270211000100_attendance_late_after_1030.sql`. One rule for **every employee in every department** (Sales, Support, Accounts,
Technical Consultant, AI Studio, AI Design Studio, International, Reseller, HR and any future department) and every role:

| Punch In (India time) | Status | Late minutes |
| --- | --- | --- |
| up to and including 10:30 (e.g. 09:59, 10:00, 10:01, 10:15, 10:30) | Present | 0 |
| 10:31 | Late | 1 |
| 10:45 | Late | 15 |
| 11:00 | Late | 30 |

- The official reporting time stays **10:00** (reminders, "Not punched in" and "Absent" are unchanged). Late counts from **10:30**.
- The Punch In is read in Asia/Kolkata and cut to the whole minute (10:30:59 is still Present), matching the time shown on screen.
- It lives in one database function, `private.attendance_late_minutes(punch_in_at)` (with `private.attendance_reporting_time()` and
  `private.attendance_late_after()`). Team attendance (`attendance_team_overview`: Department Heads, CEOs, Team Leads, HR, Super Admin,
  its Late arrivals filter and counts), Today's Attendance Overview and the Super Admin's 11:00 alert all use it; the screens, the mobile
  layout and the API only display what it returns (`late`, `lateMinutes`, plus `reportingTime`, `lateAfter`, `graceMinutes` = 30).
- Nothing overrides it: not a department, not a person's own Punch In reminder time, not `attendance_settings.late_grace_minutes`.
- **History:** no late flag is stored; every view recomputes it from `attendance_records.punch_in_at`, so all past days show the corrected
  status as soon as the migration runs. No attendance row is changed, added or removed; approved corrections and leave stay as they are.
- The dashboards highlight late rows (amber in Team attendance, orange in Today's overview) and show "Late by N min".
- Tests: `supabase/tests/attendance_late_rule_test.sql` (every case above in ten departments and three roles, both views, the API
  functions, the overrides, and that the migration changes no attendance record).

## Files

| Area | Files |
| --- | --- |
| Database | `supabase/migrations/20270205000200_team_attendance_corrections.sql` |
| Screens | `src/components/attendance/TeamAttendance.tsx`, `AttendanceCorrections.tsx`, `AttendancePage.tsx` (dialogs, tabs), `src/components/common/BottomSheet.tsx` |
| Client | `src/lib/attendance.ts` (`teamOverview`, `punchOutPreview`, `punchOutConfirmed`, `requestCorrection`, `corrections`, `decideCorrection`) |

**Tests:**

- `supabase/tests/team_attendance_test.sql` (`npm run test:db`): the statuses at fixed times, who sees whom (Sales vs Support, other
  departments, Team Leads, members refused), the early-reason rule and retries, the correction flow and its permissions.
- `supabase/tests/ui_attendance.test.mjs`: the confirmation dialogs.
- `supabase/tests/ui_team_attendance.test.mjs`: cards, filters, departments, phones at 320 / 360 / 390 px, corrections.
