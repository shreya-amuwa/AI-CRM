# Work update requests (Task Management)

Migration `supabase/migrations/20270116000100_work_update_requests.sql`. A Department Head or Team Lead can ask the person a task is assigned to
for a progress update, the employee answers, and the requester follows the answer, all inside the existing Task module. **The task assignment flow,
the reporting hierarchy and every task status rule are unchanged:** nothing here edits a `work_tasks` row, so an update can never change a task's
status, progress or assignee.

## How it works

1. A Department Head / Team Lead opens a task they can already see and chooses **Request update** (optional message, optional reply-by time).
2. The employee the task is assigned to is notified ("Work update requested") and sees it under **Update Requests** (Team Member: My Tasks / Assigned
   Tasks; Team Lead: its own requests appear in the same section).
3. The employee submits a work update (since `20270117000100`: see `TASK_MANAGEMENT_V2.md`): status, progress %, work completed, remaining work, blockers, next steps, expected date. It is kept in the task's history, answers that request, and the task shows the latest status and progress. (`work_update_respond`, the first form of the answer, still exists and still never changes the task.)
4. Everyone who asked (the requester and whoever sent a reminder) is notified ("sent a work update"; urgent when there is a blocker).
5. The requester reads it in the task's **Work updates & history** and in **Work Updates** (filters: All Updates, Pending, Responded, Overdue).
6. If nobody answers, the requester sends a **reminder** on the same request (at most one an hour, five at most). There is never a second open request.

## Who may do what (enforced in the database)

| Action | Allowed |
| --- | --- |
| Ask for an update | An active **Department Head or Team Lead** who can ALREADY see the task under the Task module's own rule (`private.can_view_work_task`: the one who gave it, everyone above it in its chain, the Department Head of the department and function, the Team Lead of their own member), who is **not** the task's assignee, for a task that is not completed. The person asked is the task's assignee, read by the database. No id or role is accepted from the caller. |
| Send a reminder | The same people, on a request still waiting |
| Answer | Only the person the request was sent to, while the task is still theirs; once per request |
| Read requests and answers of a task | The assignee, whoever may ask about it, and the Super Admin (read only) |
| Everything else | Refused with the "forbidden" error (SQLSTATE 42501 = HTTP 403): Team Members, a Department Head or Team Lead outside the task's hierarchy (another department, the Sales head for a Support team, the other Team Lead of the same team), Accounts, and the Super Admin for requests |

## Structure (added; nothing existing is altered)

- `work_update_requests`: task, requester, employee, message, reply-by, status (PENDING / RESPONDED), reminder count. A unique index allows **one open request per task**.
- `work_update_responses`: one per request: progress, work completed, remaining work, blockers, expected date. Final: not editable or deletable.
- `work_update_events`: append-only history (requested, reminder, responded: who and when).
- Signed-in users have **no table privileges**; only the SECURITY DEFINER functions (`search_path = ''`) read and write: `work_update_request`, `work_update_follow_up`, `work_update_respond`, `work_update_my_requests`, `work_update_list`, `work_update_for_task`.
- Notifications reuse the CRM's notification table through `private.notify_once` (an identical unread notification is never sent twice). Types: `WORK_UPDATE_REQUESTED`, `WORK_UPDATE_FOLLOW_UP`, `WORK_UPDATE_SUBMITTED`, entity `work_task`; the bell opens the page that shows the task.
- Task history (`work_update_for_task`): the existing assignment and progress updates plus the new events, in order. Audit log: `WORK_UPDATE_REQUESTED`, `WORK_UPDATE_FOLLOW_UP`, `WORK_UPDATE_SUBMITTED`.

## Screens

- **Department Head** (and Operations Head, Sales Head): new **Work Updates** page with pending counts; **Work updates & history** inside every task and every member row of Assign.
- **Team Lead / Support Team Lead:** a **Work Updates** section and **Work updates & history** per member in Assigned Tasks.
- **Team Member / Support Member:** **Update Requests** (with the answer form and "Updates I sent") above their tasks.

## Not included

- **Attachments:** the Task module has no file storage of its own; adding it would need the full upload flow. Not added.
- **Reassignment history:** the Task module does not record reassignments, so none can be shown.
- **Sales Team Members / Business Associates:** their tasks live in the Business Associate dashboard's own task page, which does not use `work_tasks`; they are not covered.

## Tests

`supabase/tests/work_update_requests_test.sql` (every role, hierarchy, no status change, duplicates, notifications, history, direct writes), `supabase/tests/ui_work_updates.test.mjs` (screens at desktop and phone width).

## Rollback

App: redeploy the previous build. Database: the migration only adds tables and functions; `drop` the six `work_update_*` functions and the three tables to remove it. No existing data is touched.
