# Changelog

All notable changes to the Amuwa CRM (crm.amuwacorporation.com and the Client Portal at `/client/`). The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/):

* **MAJOR**: a change that breaks existing users or integrations (a removed screen, a changed API contract, a migration that cannot run on
  the live data without manual steps).
* **MINOR**: new features that are backwards compatible (new screens, new optional API fields, additive migrations).
* **PATCH**: fixes only.

`package.json` says `1.0.0` and there are no git tags yet. Everything up to the start of the upgrade below counts as **1.0.0**.
A version is tagged (`v1.1.0`) only when the owner approves the release (see `RELEASE_PLAN.md`).

## [Unreleased] - proposed 1.1.0

Management, attendance, notifications and mobile-first UI upgrade (Tasks 01-08). Every change is additive. No API contract or role key
changed, and nothing existing was removed. It is therefore a **minor** release.

### Added

* **Deleting assigned tasks** (docs/TASK_DELETION.md). Team Leads delete the tasks they assigned; Department Heads and Operations Heads delete tasks
  within their department and function, in the Task module of every department, AI Studio and AI Design Studio. Team Members (Telecallers, Business
  Associates and every member designation) cannot, and the Super Admin's access is unchanged. The database checks the role and scope on every delete; the
  button appears only when it says so and opens a confirmation naming the task. Sub-tasks, updates and per-task reports go with the task; the assignee is
  notified and the delete is audited. Migration `20270220000100_task_deletion.sql`.
* **AI Studio: one daily report built from the tasks** (docs/AI_STUDIO_DAILY_REPORTS.md): the employee picks the tasks they worked on, from
  any of their projects, and the report shows the completion details, work updates and links already recorded on those tasks for that
  date, read-only. Only new remarks are typed (additional work, pending work, blockers, tomorrow's plan, remarks). The report stores
  references to the task history, never copies; a submitted report keeps showing its day. The Team Lead and Department Head read it
  project by project (with counts, blockers and cross-team filters); the Team Lead who gave a cross-team task sees only that task's part,
  in the task window. Older one-task reports stay as they are. Migration `20270219000100_ai_studio_consolidated_reports.sql`.
* **Global search (Ctrl / Cmd + K)** (docs/GLOBAL_SEARCH_ARCHITECTURE.md, docs/COMMAND_PALETTE_GUIDE.md): a command palette on every staff
  dashboard. It finds the dashboard's own pages (with aliases) and the employees, customers, leads, meetings, support tickets,
  departments and notices the person may already open. The database's row-level rules decide (security invoker). Results open the exact
  record: records open in a panel with its own address (Back / Forward / refresh), meetings and notices open on their pages. Recent items
  are kept per person, by id only. The header has a search field (an icon on phones). Migration `20270215000100_global_search.sql`.

* **In-app feedback instead of browser pop-ups** (docs/APP_FEEDBACK_SYSTEM.md): toasts, confirmation dialogs (with a destructive style,
  a safe default button, an optional typed confirmation and in-dialog retry) and input dialogs for reasons. All 58 uses of the browser's
  `alert()`, `confirm()` and `prompt()` in 40 files are replaced; a unit test (`no_native_dialogs`) fails if one comes back.

- **Team attendance for the CEO and Department Heads** (Task 01, #290):
  - **Screen:** Attendance → Team, plus a summary card on their dashboards. Each employee gets one status from: Shift Not Started,
    Present, Late, Not Punched In, Absent, Approved Leave, Half Day, On Break, Shift Completed, Weekly Off, Holiday.
  - **Layout:** summary cards that filter the list, a department breakdown, and filters for date, department, team, status and search.
    It has a compact phone layout.
  - **Scope:** checked in the database (`attendance_team_overview`).
- **Safe Punch In / Punch Out** (Task 02, #290):
  - **Confirmation dialogs:** "Start your workday?" and "End your workday?".
  - **Punch Out figures:** worked, break and net time, and the shift end, all from the server's clock.
  - **No duplicates:** one request id per dialog, so a double click or retry never records a second punch.
- **Attendance correction requests** (Task 02, #290):
  - **Kinds:** a missed Punch In or Punch Out, resume the day, and others.
  - **Who decides:** HR, the Managing Director, or the CEO / Department Head whose scope covers the employee.
  - **Audit:** every request and decision is in the audit trail.
- **Meeting notifications on phones** (Task 05, #292):
  - **Participants:** their meeting notices (invited, moved, cancelled, approvals, summaries) are pushed to their devices.
  - **Reminders:** 15 minutes before and at the start, in addition to 24 h and 1 h.
  - **Tap:** a tap opens the meeting.
- **Meeting awareness for the Managing Director** (Task 05, #292):
  - **What they get:** a notice when an internal team meeting they are not in is scheduled, moved or cancelled, plus reminders.
  - **Privacy:** the lock screen never shows a meeting title. A tap opens the read-only report view.
  - **Settings:** Attendance → Reminders → Meeting notifications.
- **Mobile audit tool** (Task 04, #294): `scripts/mobile-audit/` checks every screen the browser tests open at 9 widths, from 320 to
  1440 px.
- **Documentation** (Task 08): `RELEASE_PLAN.md`, `ATTENDANCE_MANAGEMENT.md`, `ROLE_AND_PERMISSION_MATRIX.md`,
  `NOTIFICATION_ARCHITECTURE.md`, `MOBILE_UI_GUIDELINES.md`, `TESTING_CHECKLIST.md`, `DEPLOYMENT_AND_ROLLBACK.md`, `KT_GUIDE.md` and
  this changelog.

### Changed

- **Role names on screen** (Task 06, #288):
  - "Super Admin" is shown as **Managing Director**.
  - "Operations Head" is shown as **CEO**.
  - Display only, through one mapping (`shared/roleNames.ts`). Role keys and permissions are unchanged.
- **Company notice popup** (Task 03, #294):
  - **Phones:** a compact bottom sheet (at most about 55% of the screen) with "View full notice".
  - **Larger screens:** a centred dialog.
  - **Behaviour:** focus kept inside, the page locked behind it, and it never opens over another dialog.
- **Punch Out** (#296):
  - Punching out before the shift end no longer shows a warning or asks for a reason. The confirmation is enough.
  - The company switch `early_punch_out_reason_required` is now off by default.
- **The Managing Director's dashboard** shows the "Turn on notifications" banner, worded for meeting updates (#292).

### Fixed

- **Meeting notices** never reached a phone, and there was no reminder close to the start (#292).
- **Sideways scrolling on phones** in four places (#294):
  - Client Portal → Client Manual;
  - the HR date filters;
  - a long login e-mail in the staff-added confirmation;
  - Crocodial open follow-ups.
- **The dark "Something went wrong" page** flashed for 2-4 seconds after a deployment while the page reloaded itself (fix PR after
  #294). It now shows a quiet "Loading the latest version…". A real crash shows a light error page without internal details.

### Database migrations in this release

* `20270219000100_ai_studio_consolidated_reports.sql`: `ai_studio_report_tasks`, `ai_studio_report_task_updates` (references only), the links
  of a task update (`ai_studio_task_updates.links`, stored when they change), write-once task history, and the daily report functions
  (additive; safe to run twice).
* `20270215000100_global_search.sql`: `global_search`, `search_record`, private candidate helpers and trigram indexes (additive; safe to run twice).

Run in the Supabase SQL editor, in this order, **before** the matching code is deployed. Every one is additive and safe to run twice. See
`DEPLOYMENT_AND_ROLLBACK.md`.

| Migration | From |
| --- | --- |
| `20270205000200_team_attendance_corrections.sql` | #290 |
| `20270208000100_meeting_push.sql` | #292 |
| `20270208000200_meeting_oversight_notifications.sql` | #292 |
| `20270211000100_punch_out_no_reason.sql` | #296 |

Also on `main`, from other work merged in the same period, so they go out with the same deployment:

- `20270205000100_notice_board_delete.sql` (#289);
- `20270206000100_hr_offer_templates.sql` (#291);
- `20270207000100_employee_wallet.sql` (#293);
- `20270209000100_task_daily_reports_performance.sql` (#297);
- `20270210000100_unified_performance_hierarchy.sql` (#300).

Check which of these have already been run (see `DEPLOYMENT_AND_ROLLBACK.md`, "Which migrations have run?").

## [1.0.0]

The CRM as it was before this upgrade (all work merged up to #287).
