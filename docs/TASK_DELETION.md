# Deleting an assigned task

Migration `20270220000100_task_deletion.sql`. Team Leads, Department Heads and Operations Heads can delete tasks they are responsible for, in the
Task module of every department, in AI Studio and in AI Design Studio. Nobody else can, and the rule is enforced in the database, not only by hiding
the button.

## Who may delete

| Who | Task module (every department) | AI Studio project tasks | AI Design Studio assignments |
| --- | --- | --- | --- |
| Team Lead | Tasks they assigned | Tasks they assigned | Work they gave |
| Department Head | Tasks they assigned, and tasks in the department and function they head | Tasks they assigned, and any AI Studio task | Work they gave, and any work of the department |
| Operations Head | Tasks they assigned, and tasks in a department and function they manage | Same as the Department Head when their AI Studio role is Department Head | Same as the Department Head |
| Team Member (incl. Telecaller, Business Associate, every member designation) | Never | Never | Never |
| Super Admin / Managing Director | Unchanged: no delete | Unchanged: no delete | Unchanged |

Also:

* Nobody deletes a task that was assigned to **them**.
* A Department Head cannot delete a task given by the Super Admin or by an Operations Head (a higher level). An Operations Head cannot delete a task given by the Super Admin.
* A head only reaches tasks they may already open (`private.can_view_work_task`); a task outside their scope answers "not found".

## What a delete does

* Removes the task and what hangs off it through the existing `on delete cascade` keys: sub-tasks / parts passed on to Team Members, their progress
  updates, update requests and (Task module) the per-task daily reports. Nothing is left orphaned.
* AI Studio daily reports stay. A consolidated report loses only its part about the deleted task (its links to the task and to that task's history go with
  the task, `on delete cascade`); an older one-task report keeps its text and loses the link (`on delete set null`).
* Other rows that only point at the task keep their content and lose the link (`on delete set null`): AI Design Studio reports and issues, field visits.
* Removes the task's own notifications (they would open a task that no longer exists) and tells the assignee (and everyone who had a part of it, and the giver
  when a head deletes a Team Lead's task) with `TASK_DELETED` / `AI_STUDIO_TASK_DELETED` / `ADS_ASSIGNMENT_DELETED`.
* Writes `TASK_DELETED` / `AI_STUDIO_TASK_DELETED` / `ADS_ASSIGNMENT_DELETED` to the audit log with a snapshot of the task.
* Locks the row first; a second click (or someone else deleting it meanwhile) gets "Task not found. It may already have been deleted."

## Database

| Function | Purpose |
| --- | --- |
| `public.work_task_delete_preview(task)` | `canDelete`, the reason when not, and the counts the confirmation shows (sub-tasks, updates, daily reports) |
| `public.work_task_delete(task)` | Delete a Task module task |
| `public.ai_studio_task_get(task)` | Now also returns `canDelete` |
| `public.ai_studio_task_delete(task)` | Delete an AI Studio task |
| `public.ads_assignment_get(id)` | Now also returns `canDelete` |
| `public.ads_assignment_delete(id)` | Delete an AI Design Studio assignment |

The rules live in `private.work_task_delete_problem`, `private.ai_studio_delete_problem` and `private.ads_delete_problem`, used for both the flag and the delete.

## API

| Route | Notes |
| --- | --- |
| `GET /api/work-tasks/:id/delete-preview` | The confirmation's data |
| `DELETE /api/work-tasks/:id` | Task module |
| `DELETE /api/ai-studio/tasks/:id` | AI Studio |
| `DELETE /api/ai-design-studio/assignments/:id` | AI Design Studio |

Errors: 403 (not allowed), 404 (not found / already deleted), 422 (malformed id). The DELETE routes use the stricter rate limit.

## Screens

* **Task workspace** (opened from any task card: Department Head / Operations Head assign page, Team Lead tasks, Sales Head, unified dashboard and the
  department dashboards): a **Delete task** button in the actions bar.
* **AI Studio** task dialog: **Delete task** next to Edit.
* **AI Design Studio** assignment drawer: **Delete assignment**.

Each button is shown only when the server says `canDelete`. It opens the app's confirmation dialog naming the task, the assignee, the status, the due date
and what is removed with it; the delete runs inside the dialog and a refusal stays visible there. After a delete the dialog closes, a success message is
shown, and every task list and count on the page reloads at once (`crm:work-tasks-changed`, the AI Studio / AI Design Studio change events; other people's
screens follow through realtime).

## Before the migration is run

The preview call fails and the Task workspace shows no Delete button; AI Studio and AI Design Studio details have no `canDelete`, so no button either.
Everything else works as before.

## Tests

`supabase/tests/task_deletion_test.sql` (every role, including refusals), `supabase/tests/task_deletion.test.ts` (unit) and a block in
`supabase/tests/api_integration.test.ts`.
