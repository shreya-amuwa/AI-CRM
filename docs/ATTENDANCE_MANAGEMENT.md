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
| Late | punched in after their start + `attendance_settings.late_grace_minutes` (new; **0** by default = the current rule) |
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
- **No reason is asked** before the shift end, and no early-leave warning is shown (owner's decision, 2026-11-25; migration
  `20270209000100_punch_out_no_reason.sql`). The confirmation is enough.
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
- **The Punch Out itself:** the screen calls the existing `attendance_punch_out`, with no reason. It works whether or not the migration
  has been run. `attendance_punch_out_confirmed` (an optional reason, kept with the punch and audited as `ATTENDANCE_EARLY_PUNCH_OUT`)
  stays in the database in case the rule is switched back on.
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
| `late_grace_minutes` | 0 | Minutes after the start before "Late" (0 = today's rule) |
| `early_punch_out_reason_required` | false (since `20270209000100`) | Whether `attendance_punch_out_confirmed` requires a reason before the shift end. The screen does not ask for one |
| `correction_window_days` | 30 | How far back a correction may be asked |

Change them with SQL, e.g. `update public.attendance_settings set late_grace_minutes = 10;`.

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
