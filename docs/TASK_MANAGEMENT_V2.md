# Task management v2: assignment, tracking and work updates

Migration `supabase/migrations/20270117000100_task_work_updates_v2.sql`. It improves the **existing** Task module (`work_tasks`, `work_task_updates`, the
hierarchy and the work update requests of `20270116000100`). Nothing was replaced: the Department Head → Team Lead → Team Member hierarchy, who may
assign to whom, who sees which task, the roles and the statuses are unchanged. Every existing function still works; the migration only adds.

## What changed for people

| Who | What is new |
| --- | --- |
| Team Lead, Department Head | **Assign task** opens a panel: task information (title, description, priority Low / Medium / High / **Urgent**, due date, optional customer) and assignment (a searchable list with initials, name, designation, team; several people for a Team Lead). Validation, a loading state, success and the database's refusal are all shown. |
| Everyone | **Task tracker**: summary cards (Total, Assigned, In Progress, Blocked, Completed, Overdue, Awaiting Update), filters (All Tasks, My Tasks, Assigned by Me, In Progress, Blocked, Completed, Overdue, Awaiting Update), search by task title or employee name, sorted overdue first, then Urgent / High, then the closest due date. 15 tasks are shown at a time ("Show more"). |
| Everyone | **Task details** (side panel): Overview, Work Progress, Update Requests, Activity Timeline. |
| Employee (assignee) | **Submit work update**: status (In progress / Blocked / Completed / Not completed), progress %, work completed, remaining work, blockers, next steps, new expected completion date. |
| Department Head, Team Lead | **Request update** from the task details (existing feature); the employee answers that specific request from the same form. |

## Statuses

The lifecycle is mapped onto the existing statuses, nothing was added to them:

| Lifecycle | Stored as |
| --- | --- |
| Assigned | `ASSIGNED` |
| In Progress | `IN_PROGRESS` |
| Blocked | `BLOCKED` |
| Completed | `COMPLETED` |
| Overdue | **Calculated**: due date before today and not `COMPLETED`. It is never stored and an employee cannot set it. |
| Awaiting Employee Update | **Calculated**: an open update request on the task. |
| Accepted | Not supported by the data model (there is no accept step); not added. |

## Work updates

`public.submit_work_update(p_task, p_status, p_progress, p_completed, p_remaining, p_blockers, p_next, p_expected, p_request)`

- Only the **task's assignee** may call it (read from the signed-in session; no role or user id is accepted). Anyone else gets `42501` (HTTP 403).
- Each call **adds a row** to `work_task_updates` (the history) and the task shows the latest. Nothing is overwritten.
- A real update is required: what was done (at least 10 characters), or, for Blocked / Not completed, what is in the way (at least 10 characters).
  The same update twice in a row is refused.
- Progress is the employee's report: **Completed is exactly 100%** and anything else is below 100%. A status change alone never sets the progress.
- A completed task takes no more updates, and a completed task is never overdue.
- With `p_request` it answers that update request (the request must be addressed to the caller, for that task, and still open). The requester and anyone
  who sent a reminder are notified.
- The history is protected by a trigger: a signed-in user cannot edit or delete an update row, directly or through a function.
- The old `submit_task_update` keeps working for any older screen.

`public.work_task_details(p_task)` returns the overview, the update history, the update requests, the timeline and what the caller may do (`canUpdate`,
`canRequest`, `canManage`). It answers only for people who may **already** read the task (`private.can_view_work_task`); others get a not-found / forbidden
error. The timeline lists: created, assigned, progress updates, update requested, reminder, employee responded.

## Notifications (the existing system, `private.notify_once` so an identical unread one is not repeated)

| Type | To | When |
| --- | --- | --- |
| `TASK_ASSIGNED` (existing) | the assignee | a task is assigned |
| `WORK_UPDATE_REQUESTED`, `WORK_UPDATE_FOLLOW_UP` (existing) | the employee | an update is requested / a reminder |
| `WORK_UPDATE_SUBMITTED` | who gave the task, who asked, whoever sent a reminder | an update (In progress) is submitted |
| `TASK_BLOCKED` (urgent) | the same, and whoever gave the task above them | the status is Blocked |
| `TASK_COMPLETED` | the same | the final update is submitted |
| `TASK_NOT_COMPLETED` (urgent) | the same | the employee reports it could not be completed |

All of them carry `entity_type = 'work_task'` and the task id: clicking one opens the task (the tracker opens its details panel) and open lists refresh live.

## Not built (the data model does not support it)

- **Category** on a task (no such column).
- **Accepted** status and **reassignment** history (the Team Lead's delegation is shown in the timeline as an assignment).
- **Attachments** on an update (the project has no task attachment storage).
- A Department Head choosing **several** assignees at once (one function, one assignee); a Team Lead can choose several members.

## Tests

- `supabase/tests/task_work_updates_v2_test.sql`: 62 checks against the real functions (assignment incl. Urgent, validation, history, request linkage,
  notifications, overdue, every refusal, history protection, existing functions unchanged, the migration run twice).
- `supabase/tests/task_tracker.test.ts`: 20 checks (cards, the eight filters, sorting, assignment form rules).
- `supabase/tests/ui_task_management.test.mjs`: 50 browser checks (assignment panel, tracker, details panel, update form, phone width).
- `supabase/tests/ui_work_updates.test.mjs`: updated for the unified answer form.
