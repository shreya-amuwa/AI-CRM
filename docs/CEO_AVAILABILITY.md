# CEO Availability (HR dashboards)

Migration `supabase/migrations/20270201000100_ceo_availability.sql` (run after `20270131000200`; additive, safe to run twice). It builds on
"CEO office arrival" (`20270128000300`, see `docs/MEETINGS_GOOGLE_CALENDAR.md`): the same table, the same status, the same banner. Nothing is duplicated.

## What HR sees

- **CEO Availability** is in the side panel of every HR dashboard, **immediately below Notice Board**:
  - the HR department's menu (HR Department Head, HR Assistant, HR Admin Head, and the Super Admin when they open HR);
  - the HR Recruiter's dashboard (read only, see "Who may update it").
- The screen shows the **current availability** ("CEO has arrived at the office" / "CEO has not arrived yet"), the **latest status update** (CEO Arrived or
  CEO Not Arrived, the date and time, and who pressed it) and two buttons, **CEO Arrived** and **CEO Not Arrived**.
- The status is **stored in the database** and is the same on every dashboard. A change shows on every open screen at once (Supabase Realtime on
  `ceo_office_arrivals`) and is still there after a refresh. Each day starts as "not arrived" (India time); when the latest update is from an earlier day the screen says so.
- HR's home page keeps its compact **CEO HAS ARRIVED** button (unchanged).

## Who may update it

| Who | Reads | Presses the buttons |
| --- | --- | --- |
| Super Admin | yes | yes |
| HR Department Head, HR Assistant, HR Admin Head (HR department, not Recruiters) | yes | yes (`private.is_hr_staff()`) |
| HR Recruiter | yes | **no** (the screen has no buttons; the database refuses) |
| Every other employee | yes (shown on "Ask the CEO for time") | **no** (`FORBIDDEN`) |
| A visitor | no (401) | no |

The database decides; hiding the buttons is only a convenience. Nobody writes the table directly (no table grants; only the functions).

## Data (no new table)

`ceo_office_arrivals` gets one column, `kind` (`ARRIVED` default, or `NOT_ARRIVED`), and a check that a `NOT_ARRIVED` row is never a live arrival.

- **CEO Arrived** (`ceo_mark_arrived`, existing): one live arrival per CEO per day; a second press changes nothing.
- **CEO Not Arrived** (`ceo_mark_not_arrived`, new): an arrival recorded today is marked undone (kept, with who undid it). With no arrival today the press is stored as a
  `NOT_ARRIVED` row. A second press changes nothing (`duplicate: true`). Both are audited (`CEO_OFFICE_ARRIVAL_UNDONE`, `CEO_OFFICE_NOT_ARRIVED`).
- `ceo_office_status()` now also returns, for each CEO: `status` (`ARRIVED` / `NOT_ARRIVED`), `updatedAt`, `updatedBy`, `updatedStatus`, `updatedToday`. The old fields are unchanged,
  so the screens work before the migration is run (the new fields are optional in `shared/contracts.ts`).

## Meeting requests

The status is **information only**. `mtg_create`, the approval and the queue never read it, so **CEO not arrived never prevents a request**.

- **CEO has arrived:** the request is sent as usual and the form shows the green banner.
- **CEO has not arrived:** opening "Ask the CEO for time" shows a popup: *"CEO has not arrived yet. You can still schedule your meeting request. Please plan your preferred meeting time accordingly."*
  with **OK, continue with my request**. The red banner stays on the form, and the request is saved as usual.
- Every request is saved with the employee, their department and designation, the requested date and time, and the purpose (the agenda).
- **Review:** the CEO (Super Admin) sees all requests with that information in *Requests*, with the availability HR set shown next to them; an employee sees their own in *My CEO requests*.
  The request drawer shows "CEO today". Only the CEO approves, rejects or reschedules (unchanged).

## API

| Route | Who |
| --- | --- |
| `GET /meetings/ceo-office` (existing) | every signed-in employee |
| `POST /meetings/ceo-office/arrived` (existing) | HR staff, Super Admin |
| `POST /meetings/ceo-office/not-arrived` (new, `{ ceoId? }`) | HR staff, Super Admin |
| `POST /meetings/ceo-office/undo` (existing) | HR staff, Super Admin |

## Tests

`supabase/tests/ceo_availability_test.sql` (database: who may press, stored with time and person, duplicate presses, the same status for every role, yesterday does not count,
requests never blocked and saved with their details); the "CEO availability API" checks of `supabase/tests/api_integration.test.ts`;
`supabase/tests/ui_ceo_availability.test.mjs` (browser: sidebar order in the HR menu and the Recruiter's dashboard, two HR dashboards on one status, refresh, read-only Recruiter,
the popup and the saved request, no popup after arrival).
