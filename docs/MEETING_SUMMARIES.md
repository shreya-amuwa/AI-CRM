# Post-meeting summaries and the CEO's Meeting Decisions

Migration `supabase/migrations/20270124000200_meeting_summaries.sql`. It extends the existing Meetings system (see
[MEETINGS_GOOGLE_CALENDAR.md](MEETINGS_GOOGLE_CALENDAR.md)). There is no second meeting module and no new meeting status.

After an internal team meeting, the most senior leader who attended documents it: the executive summary, discussion points,
decisions, action items, blockers, next steps and an optional follow-up. The CEO (the `SUPER_ADMIN` account) sees every outcome
in **Meetings → Meeting Decisions**.

## Which meetings

Only **internal team meetings** need a summary: kind `MEETING`, booked by staff (`booked_via = 'STAFF'`), not mirrored from
another workflow (`source_type` is null) and not a client meeting.

These keep working exactly as before, with "Mark done":

- appointments
- Business Associate demos
- recruitment interviews
- employee → HR meetings
- client meetings
- booking-link bookings
- requests for the CEO's time (`CEO_MEETING`)

## The workflow

1. **The meeting takes place.** Its summary row exists from the moment the meeting is booked (status `PENDING`).
2. **The organiser confirms attendance.** This means the host, the person who booked it, or the host's delegates; for a meeting
   the CEO hosts, only a Super Admin. They tick who actually attended: an invitation or an RSVP is not attendance. The
   confirmation is stored per person (`meeting_summary_attendance`, with who and when), in the meeting's history and in the
   audit log.
3. **The responsible leader is chosen** from the people who attended (see the next section). They get a "Meeting summary
   pending" notification.
4. **The leader writes the summary** in the meeting drawer. They can save a draft (`DRAFT`) and come back to it.
5. **The leader submits it.** The meeting is completed in the same database transaction. The CEO is notified with a link to
   the report, and each person given an action item is notified.
6. **The CEO reviews it.** They can ask for a clarification (`REVISION_REQUESTED`), which never changes the report, and mark a
   decision or a blocker for follow-up. The leader answers, and can submit an amendment with a note saying what changed
   (`REVISED`). The CEO is notified of the change.

Summary statuses are `PENDING`, `DRAFT`, `SUBMITTED`, `REVISION_REQUESTED` and `REVISED`. The meeting keeps its own statuses
(`SCHEDULED` → `COMPLETED`).

**"Mark done" for team meetings.** The drawer no longer shows "Mark done" for a team meeting. `POST /meetings/:id/complete`
(`mtg_complete`) refuses with `409` until the summary is submitted. The server enforces this, not just the button.

**Overdue.** A summary not submitted 24 hours after the meeting ended is **Summary overdue**:

- The leader, or the organiser while nobody is responsible, is notified once.
- It shows in the supervisors' "My teams" list and in the CEO's reports.
- The threshold is `meeting_summary_settings.overdue_hours`. To change it, run
  `update public.meeting_summary_settings set overdue_hours = 48;`.

**The scheduled check.** `mms_sweep()` runs with the existing meetings dispatch (`/api/v1/internal/automations/dispatch`). It
asks the organiser to confirm attendance once the meeting has ended, and sends the overdue notice. Each notice goes out once
(recorded on the summary row), never again on later runs or page loads.

**Historical meetings.** A meeting booked and ended before the migration ran is historical. It is never pending or overdue,
and no summary is invented for it. A leader can still add one after the organiser confirms attendance.

## Who writes the summary

**Rank** (active accounts only):

| Rank | Who |
| --- | --- |
| 4 | Super Admin (CEO) |
| 3 | Operations Head (`DEPARTMENT_HEAD` with `is_operations_head`) |
| 2 | Department Head |
| 1 | Team Lead |

**How the owner is chosen:**

1. Take the people whose attendance was confirmed.
2. From the highest rank down, keep only the leaders who either host or booked the meeting, or lead at least one other person
   who attended. "Lead" means:
   - an Operations Head or Department Head: their department and Sales / Support function (`private.scope_covers`);
   - a Team Lead: their team.

   So a Support Operations Head who sat in on a Sales meeting is never made responsible for it.
3. If exactly one leader remains at that rank, they are responsible (`SENIORITY`).
4. If several remain at the same rank:
   - the host, if one of them (`HOST`);
   - otherwise the person who booked it, if one of them (`CREATOR`);
   - otherwise nobody is picked arbitrarily: the organiser, a supervisor or the CEO selects one of them (`SELECTED`).
5. If nobody who leads attended (`NO_LEADER`), the organiser can prepare a draft and **route** it to a leader whose scope covers
   the attendees (`ROUTED`). A supervisor or the CEO can also take it (`ESCALATED`). Either way a reason is required.
6. If the responsible leader is suspended or loses access, the organiser, a supervisor or the CEO **transfers** the summary,
   with a reason (`TRANSFERRED`).
7. The CEO, when responsible, may **delegate** to someone who attended (`DELEGATED`).

The owner, how they were chosen, by whom and why are stored on the summary and in its history.

**Scenarios:**

| Who attended | Responsible |
| --- | --- |
| Operations Head + Department Head + Team Lead + members | the Operations Head |
| Department Head + Team Lead + members | the Department Head |
| Team Lead + members | the Team Lead |
| invited Operations Head who did not come + Department Head | the Department Head |

## Who sees what (enforced in the database)

| Who | Reads | Writes |
| --- | --- | --- |
| The responsible leader | everything, drafts included | the draft, the submission, amendments, answers, progress on action items |
| The organiser | everything, drafts included | attendance, a draft while nobody is responsible, routing to a leader |
| Supervisors of the report's unit: Operations Head / Department Head whose department and function cover it, the Team Lead of its team | the submitted report, pending / overdue status | selecting or transferring the owner |
| Everyone who attended, and the people given an action item | the submitted report | their own action items' progress |
| The CEO (Super Admin) | every team meeting's report and status: outcome fields only (no guests, e-mails, links or locations) | clarifications, follow-up marks |
| Anyone else | nothing ("not found") | nothing |

**Further rules:**

- Action items can be given only to the responsible leader or to people they lead. A Sales leader cannot give work to Support
  or to another department.
- The CEO's report access is limited to these reports. It gives the CEO no rights to manage other people's meetings, and their
  calendars stay private (`mtg_can_view` is unchanged).
- The tables have row-level security, and the signed-in roles have no direct table access. Everything goes through
  `security definer` functions that check `auth.uid()`.
- Revisions, comments and history are append-only: a trigger refuses any change or deletion.
- Every write takes the summary's `version`. A stale version returns `409`. Decisions, action items and blockers carry a key, so
  a retry or an edit never duplicates them.

## API (`/api/v1`)

| Route | Who |
| --- | --- |
| `GET /meetings/:id/summary` | people who may see it |
| `POST /meetings/:id/summary/attendance` `{ attendedIds, version? }` | organiser |
| `POST /meetings/:id/summary/owner` `{ ownerId, reason?, version? }` | organiser, supervisor, CEO, the CEO owner |
| `PATCH /meetings/:id/summary/draft` `{ summary, version }` | owner, or the organiser while nobody is responsible |
| `POST /meetings/:id/summary/submit` `{ summary, version, changeNote? }` | owner (also completes the meeting) |
| `POST /meetings/:id/summary/clarifications` `{ message }` | CEO |
| `POST /meetings/:id/summary/replies` `{ message }` | owner |
| `POST /meetings/:id/summary/follow-ups` `{ itemType, itemId, flag, note? }` | CEO |
| `POST /meetings/summary-actions/:id` `{ status, note? }` | assignee, owner |
| `GET /meetings/summaries?scope=MINE\|TEAM&tab=PENDING\|DRAFT\|SUBMITTED\|OVERDUE\|ALL&limit&offset` | everyone (TEAM: leaders) |
| `GET /meetings/summaries/actions` | everyone: their own action items |
| `GET /meetings/reports/overview?from&to&departmentId&teamId&leaderId&leaderRank` | CEO |
| `GET /meetings/reports?…&status&attention&limit&offset` | CEO |
| `GET /meetings/reports/:id` | CEO |
| `GET /meetings/reports/actions?…&status=OPEN\|OVERDUE\|DONE\|ALL` | CEO |

Validation is the Zod schemas in `shared/validation.ts` (the "Post-meeting summaries" block), and the database checks every
rule again. Errors return `403` (not allowed), `404` (not found or not visible), `409` (stale version, wrong state) and `422`
(invalid input).

## Screens

**Meeting drawer.** For a team meeting the drawer shows a **Meeting summary** panel:

- the summary's status (pending, overdue, submitted…) and who is responsible, with how they were chosen;
- "Who attended?" for the organiser;
- "Meeting completed. Please document the decisions and next steps." with **Submit Meeting Summary**, for the responsible leader;
- the read-only report once it is submitted;
- the clarification thread.

**The form** fills in the meeting's title, reference, date and times, department and team, host, attendees and the responsible
leader from the records, and shows the agenda. It has a field for a clarification of the purpose; a required executive
summary; discussion points; decisions (title, description, decision maker, status, or "No decisions were made"); action items
(title, description, responsible employee, due date, priority, status, related decision); blockers (type, description,
"Requires the CEO's attention", or "No blockers"); next steps; and a follow-up (yes/no, target date, expected outcome). To
schedule the follow-up meeting, use the existing **New meeting** button.

**Meetings → Meeting summaries** (everyone). "My summaries", and "My teams" for leaders, each with Pending / Drafts / Submitted /
Overdue tabs, plus "My action items from meetings" with a status selector.

**Meetings → Meeting Decisions** (Super Admin only):

- **Period and filters:** today, this week, this month or a custom period; department, team, leader role, leader, summary
  status, and "requires CEO attention". All are applied on the server, with pagination.
- **Overview:** meetings held, summaries submitted, pending, overdue, decisions recorded, open action items, overdue action
  items, and items requiring the CEO's attention.
- **Lists:** "Requires your attention" and "Latest decisions".
- **Reports table**, with **View Report** opening the executive report: led by, purpose, executive summary, numbered decisions,
  action items with assignee / due date / status, blockers, next steps, submitted by / at, and the revision history.
- **Action items** across all reports.

A meeting that took place, a submitted summary and a completed action item are counted separately. A decision is never marked
implemented because its summary was submitted.

**Notifications** (Notification Center; no e-mail in this first version):

| Event | Who is told |
| --- | --- |
| Meeting ended: confirm attendance | the organiser |
| Summary pending | the responsible leader |
| Summary submitted, summary revised | the CEO |
| Summary overdue | the responsible leader |
| Clarification requested, follow-up marked | the leader |
| Answer to a clarification | the CEO |
| Action item given | the assignee |

Each notification is sent once.

## Action items and tasks

Action items are stored durably with the summary (`meeting_summary_actions`, with assignee, due date, priority and status), and
their progress is kept in the summary's history. They are **not yet copied into the Work Tasks module**. Creating a work task
has its own assignment rules and notifications, and doing that from inside this function would bypass them.
`meeting_summary_actions.task_id` is reserved for that link: a follow-up can create the task through the task module's own
function at submission, keyed on the action item's id so that a retry does not duplicate it.

## Migration and rollout

1. Run `supabase/migrations/20270124000200_meeting_summaries.sql` in the Supabase SQL editor. It is additive, safe to run twice,
   uses no temporary tables and deletes nothing. It creates the tables, the functions and an `AFTER INSERT` trigger on
   `meetings`, replaces `public.mtg_complete` (same signature: its earlier body plus the summary check), and gives the
   meetings already planned their pending summary row.
2. Deploy the app. Until the migration has run, the new tabs and panel show an error, and everything else in Meetings works as
   before. The dispatch ignores the missing `mms_sweep`.

**Rollback:**

- Redeploy the previous build.
- To restore the old "Mark done" for team meetings, run `mtg_complete`'s definition from
  `20270101000500_meetings_google_calendar.sql` again.
- To stop new summary rows, run `drop trigger meetings_summary_row on public.meetings;`.

The summary tables can stay; nothing else reads them.

## Tests

| File | What it covers |
| --- | --- |
| `supabase/tests/meeting_summaries_test.sql` (`npm run test:db`) | the 8 ownership scenarios; security (impersonation, cross-team, Sales vs Support, suspended accounts, guessed ids, CEO-only functions, signed-out visitors, direct table access); the lifecycle (validation, draft, submit, retry without duplicates, amendments with revisions, clarification, follow-up, action items, overdue and notices sent once); and that appointments are unchanged |
| `supabase/tests/api_integration.test.ts` (`npm run test:api`, "meeting summaries" block) | the same rules through the HTTP API: 401 / 403 / 404 / 409 / 422 |
| `supabase/tests/e2e/run-meeting-summaries.sh` (browser) | a Team Lead confirms attendance and submits from the drawer (no "Mark done"); the member sees their action item; the CEO's Meeting Decisions overview, report and clarification; no sideways scroll on a 390px phone |
