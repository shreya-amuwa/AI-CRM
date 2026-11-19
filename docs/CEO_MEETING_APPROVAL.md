# Meetings with the CEO: only the Super Admin approves, rejects or reschedules

Migration `supabase/migrations/20270114000100_meetings_superadmin_approval.sql`. It tightens the existing **Ask the CEO for time** flow of the
Meetings engine ([MEETINGS_GOOGLE_CALENDAR.md](MEETINGS_GOOGLE_CALENDAR.md)). No new module, no new table, no second permission system: the CEO **is**
the existing Super Admin account (`profiles.role = 'SUPER_ADMIN'`).

## The rule

| Role | Ask the CEO for time | See requests | Approve | Reject | Reschedule | Cancel |
| --- | --- | --- | --- | --- | --- | --- |
| **Super Admin (CEO)** | (books their own calendar) | **all employees'** | **Yes** | **Yes** (reason) | **Yes** (reason) | **Yes** (reason) |
| Admin / HR / HR Department Head | Yes | their own | No | No | No | only their own *pending* request |
| Department Head, Team Lead, Team Member | Yes | their own | No | No | No | only their own *pending* request |
| Business Associate, Technical Consultant, Accounts, any other employee | Yes | their own | No | No | No | only their own *pending* request |
| A delegate named before this change | Yes | their own | No | No | No | only their own *pending* request |

There is no separate Admin role in the CRM (the roles are Super Admin, Department Head, Team Lead and Team Member; HR, Accounts, Business Associate and
Technical Consultant are departments, teams and designations). Whatever the title, **only `SUPER_ADMIN` decides**; nothing inherits it.

## What changed

| Before | After |
| --- | --- |
| The CEO's delegates saw, approved, proposed, declined, moved, cancelled and booked the CEO's time directly (no request) | Delegates have no power over the CEO's time. Booking the CEO's time is always a **request**. Naming delegates is refused for the Super Admin (`mtg_set_delegates`) and the section is gone from the page |
| A rejection needed no reason | A rejection of a request for the CEO's time **needs a reason**; so does moving or cancelling someone's meeting. The employee reads it |
| The employee who booked a CEO meeting could cancel it, even once approved | They can withdraw a **pending** request or **ask for another time** (the meeting goes back to "requested"); never approve, reject or confirm |
| No place to see requests by outcome | **Pending Requests, Approved Meetings, Rejected Meetings, Rescheduled Meetings, Meeting History** (Super Admin: everyone's; employees: *My CEO requests*) |
| A move kept only the new time | Previous time, new time, reason, who and when are saved on the meeting and in the append-only history |
| A request needed a title only | A request needs an **agenda or purpose** (5+ characters) and may carry an additional message |

## How it is enforced (not just hidden buttons)

1. **The role is never sent.** The browser sends the meeting, the decision and the reason. The database functions read `auth.uid()` from the signed-in
   session and look the role up in `profiles`. No role, user id or approver is accepted in a request (the request bodies are strict).
2. **One rule, one place:** `private.mtg_can_decide`, `mtg_can_manage` and `mtg_can_view` use `private.mtg_host_is_sa(host)`; for a meeting whose host
   is a Super Admin they allow only a Super Admin to decide, move, cancel or complete.
3. **403 first.** `mtg_decide`, `mtg_reschedule` and `mtg_cancel` check that rule before anything about the meeting is revealed. A refusal is
   `FORBIDDEN` / SQLSTATE `42501`, which the API turns into **HTTP 403** (`server/http/errors.ts`).
4. **No back door.** Signed-in users have no table privileges at all (`revoke all` + RLS); only the functions write. A trigger
   (`meetings_ceo_guard`) additionally refuses, even for a future function that forgets the check, any status or time change on a CEO meeting that a
   non-Super Admin should not cause (the only exceptions: the requester withdraws a pending request, asks for another time, answers a proposed time).
5. **History cannot be edited or deleted** (`meeting_events` is append-only, trigger since `20270101000500`); decisions are also written to the audit log.
6. Every `/meetings` route needs a login; the new list is `GET /api/v1/meetings/ceo-requests?section=PENDING|APPROVED|REJECTED|RESCHEDULED|ALL`.

## What is recorded

On the meeting: `decided_by`, `decided_at`, `decision_note` (the approval note or the rejection reason), `previous_starts_at`, `previous_ends_at`,
`rescheduled_at`, `rescheduled_by`, `reschedule_reason`, `reschedule_count`, `request_message`. In `meeting_events` (one row per action): who, when, the
old and new status (`fromStatus`, `toStatus`), the old and new time, the note. Notifications (once each, never duplicated while unread): the Super Admin
for a new request or a change request; the employee for approved, rejected, rescheduled and cancelled, with the reason.

## Existing records

Nothing is deleted or rewritten except one idempotent backfill of the new reschedule columns from the existing history. Meetings that are not with the
CEO (a colleague's booking link, demos, interviews, HR meetings) keep their rules. **Employee → HR meeting requests** (Raise an Issue page) are a
different feature handled by HR and are not changed. Delegate rows made earlier stay in `meeting_delegates` but have no effect on the CEO's time.

## Rollback

App: redeploy the previous build. Database: `drop trigger meetings_ceo_guard on public.meetings;` and re-run `20270101000500` then `20270113000100` to
restore the previous functions. The added columns are harmless and can stay.

## Files

- Database: `supabase/migrations/20270114000100_meetings_superadmin_approval.sql`
- API: `server/repositories/MeetingRepository.ts`, `server/services/MeetingService.ts`, `server/controllers/index.ts`, `server/routes.ts`, `shared/validation.ts`, `shared/contracts.ts`
- UI: `src/components/meetings/MeetingsPage.tsx`, `src/lib/api/meetings.ts`
- Tests: `supabase/tests/meetings_ceo_approval_test.sql` (every role, direct writes, the trigger), `supabase/tests/meetings_ceo_approval.test.ts` (HTTP 403 mapping, strict bodies, routes), `supabase/tests/ui_meetings.test.mjs` (the screens)
