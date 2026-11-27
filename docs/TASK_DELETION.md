# Deleting an assigned task

Migration `20270220000100_task_deletion.sql`. Team Leads, Department Heads and Operations Heads can delete tasks they are responsible for, in the
Task module of every department, in AI Studio and in AI Design Studio. Nobody else can, and the rule is enforced in the database, not only by hiding
the button.

## Who may delete

| Who | Task module (every department) | AI Studio project tasks | AI Design Studio assignments |
| --- | --- | --- | --- |
| Team Lead | Tasks they assigned, and **any task of a Team Member who reports directly to them, whoever gave it** | Same | Same |
| Department Head | Tasks they assigned, and **any task in the department and function they head, whoever gave it** | Tasks they assigned, and any AI Studio task, whoever gave it | Work they gave, and any work of the department, whoever gave it |
| Operations Head | Unchanged: tasks they assigned, and tasks in a department and function they manage, except one the Super Admin gave | Same as the Department Head when their AI Studio role is Department Head, except a task the Managing Director gave | Same, except work the Super Admin gave |
| Team Member (incl. Telecaller, Business Associate, every member designation) | Never | Never | Never |
| Super Admin / Managing Director | **AI Studio department tasks only** (as its Department Head) | **Any AI Studio task** (as its Department Head) | Never (AI Design Studio is a separate department) |

The bold parts are migration `20270225000100_task_delete_hierarchy.sql` (see "By team and department" below).

Also:

* Nobody deletes a task that was assigned to **them**.
* An Operations Head cannot delete a task given by the Super Admin. (Since `20270225000100` a Department Head and a Team Lead can, inside their own department / team.)
* A head only reaches tasks they may already open (`private.can_view_work_task`); a task outside their scope answers "not found".

## What a delete does

* Removes the task and what hangs off it through the existing `on delete cascade` keys: sub-tasks / parts passed on to Team Members, their progress
  updates, update requests, the Task module's per-task daily reports, and an AI Studio task's place in the consolidated daily reports that picked it
  (the report itself and its remarks stay). Nothing is left orphaned. The confirmation lists what goes with the task.
* Rows that only point at the task keep their content and lose the link (`on delete set null`): older one-task AI Studio daily reports,
  AI Design Studio reports and issues, field visits.
* Removes the task's own notifications (they would open a task that no longer exists) and tells the assignee (and everyone who had a part of it, and the giver
  when a head deletes a Team Lead's task) with `TASK_DELETED` / `AI_STUDIO_TASK_DELETED` / `ADS_ASSIGNMENT_DELETED`.
* Writes `TASK_DELETED` / `AI_STUDIO_TASK_DELETED` / `ADS_ASSIGNMENT_DELETED` to the audit log with a snapshot of the task.
* Locks the row first; a second click (or someone else deleting it meanwhile) gets "Task not found. It may already have been deleted."

## By team and department (migration `20270225000100_task_delete_hierarchy.sql`)

* **Team Lead:** any task of a Team Member who reports directly to them (`private.direct_lead_of`: the member's direct Team Lead, or the only Team Lead of the
  team), whoever gave it: the Team Lead, the Department Head, the Super Admin, an Operations Head or another Team Lead (an AI Studio cross-team task too).
  Never a task of another Team Lead's team, another department, another Team Lead or an unrelated employee, and never a task assigned to themselves.
* **Department Head:** any task inside the department and function they are authorised for (`private.head_covers`: a Support head's scope is the
  department's Support side), whoever gave it. Never another department.
* **Super Admin:** an explicit AI Studio department-head permission. AI Studio is found from the department itself (`private.ai_studio_department()`),
  never from a person or a name in the code. Any Task module task of the AI Studio department and any AI Studio project task, whoever gave it. Every
  other department (Sales, Support, Accounts, HR, AI Design Studio, ...) stays refused: "The Super Admin deletes only AI Studio tasks, as the Department
  Head of AI Studio."
* **Unchanged:** Operations Heads, Team Members, Telecallers, Business Associates and every other role; the confirmation, the cascade, the
  notifications and the audit log.
* **Same rule everywhere:** the checks use the reporting lines, teams and departments in the database, so they hold for every existing and new department.
* **Delete on the task cards.** Besides the task workspace, an eligible card has its own **Delete** button: the Task module's task tracker, the
  Department Head's "Assigned tasks" cards and their Team Members' parts, the Team Lead's "Tasks you assigned" and their members' parts, the AI Studio
  task rows and the AI Design Studio assignment table. Which cards get one is decided by the database for the whole list in one request:
  `work_tasks_deletable(ids)` for the Task module (it reads its tasks from the table), and `canDelete` on each item of `ai_studio_tasks_page` and
  `ads_assignments_list`. A click checks again with the server, opens the same confirmation, and deletes through the same API; the lists and counts
  reload at once. Before the migration is run no card has a Delete button.

## Database

| Function | Purpose |
| --- | --- |
| `public.work_task_delete_preview(task)` | `canDelete`, the reason when not, and the counts the confirmation shows (sub-tasks, updates, daily reports) |
| `public.work_task_delete(task)` | Delete a Task module task |
| `public.ai_studio_task_get(task)` | Now also returns `canDelete` |
| `public.ai_studio_task_delete(task)` | Delete an AI Studio task |
| `public.ads_assignment_get(id)` | Now also returns `canDelete` |
| `public.ads_assignment_delete(id)` | Delete an AI Design Studio assignment |
| `public.work_tasks_deletable(ids)` | (`20270225000100`) which of these Task module tasks the caller may delete: one call for a list of cards (at most 1000) |
| `public.ai_studio_tasks_page(...)`, `public.ads_assignments_list(...)` | (`20270225000100`) each item also carries `canDelete` |

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

`supabase/tests/task_deletion_test.sql` (every role, including refusals), `supabase/tests/task_delete_hierarchy_test.sql` (the team / department / AI Studio
rules, `20270225000100`), `supabase/tests/task_deletion.test.ts` (unit), two blocks in `supabase/tests/api_integration.test.ts`, and the card Delete in
`ui_task_management.test.mjs` and `ui_ai_studio_deadlines.test.mjs`.
