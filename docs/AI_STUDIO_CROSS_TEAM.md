# AI Studio: cross-team task assignment

Migration `supabase/migrations/20270221000100_ai_studio_cross_team.sql` (run after `20270220000100_task_deletion.sql`; safe to run twice; no temp tables;
nothing deleted). Builds on [AI_STUDIO.md](AI_STUDIO.md) and the performance pages of [TASK_DAILY_REPORTS_PERFORMANCE.md](TASK_DAILY_REPORTS_PERFORMANCE.md).

The daily report is main's (one report per day built from the work recorded on the tasks, [AI_STUDIO_DAILY_REPORTS.md](AI_STUDIO_DAILY_REPORTS.md),
`20270219000100_ai_studio_consolidated_reports.sql`); this file does not change it. That report already shows the Team Lead who gave a cross-team task only
that task's part. (An earlier draft of this work had its own per-task report entries; it was dropped in favour of main's report.)

## 1. What was there (audit)

| Area | Before | Where |
| --- | --- | --- |
| Teams | A "team" is a Team Lead and the people who report to them (`private.direct_lead_of`, `profiles.manager_id`); AI Studio has one `teams` row | 20270105000100, 20270107000100 |
| Project ownership | No owner column; a project's Team Leads are its Team Lead members (`ai_studio_project_members`) | 20270105000100 |
| Task assignment | A Team Lead could give tasks to **their own Team Members only**, and only on a project the member was on | `ai_studio_task_assign` |
| Assign form | Listed the project's people; a Team Lead saw only their own members | `AiStudioTasks.tsx` `assignablePeople` |
| Editing a task | **Any** Team Lead who could see a task could change it (the employee's own Team Lead included) | `ai_studio_task_get` / `_edit` |
| Seeing a task | Assignee, the Team Lead who gave it, the employee's Team Lead, the Department Head, the Managing Director (Super Admin) | `private.ai_studio_can_see_task` |
| Search | Ctrl+K did not cover AI Studio | 20270215000100 |
| Not present | Task cancel, reassign, reopen; per-employee skills; a resource-allocation approval policy | |

## 2. Cross-team assignment

**Rule.** A Team Lead **on a project** may give a task of that project to a **Team Member of another AI Studio team**. Same-team tasks keep the earlier
rule (the member must be on the project). The Department Head and the Managing Director assign as before.

* The **server** works out the type (`STANDARD` / `CROSS_TEAM`) from the reporting lines; the browser cannot send it (the API refuses the field).
* The task keeps, in `ai_studio_tasks`: `assignment_type`, `owner_lead_id` (the project-owning team: the assigning Team Lead), `assignee_lead_id` and
  `assignee_team_id` (the employee's Team Lead and team at that moment), next to the existing `assigned_by`, dates, priority, status, progress and
  completion details. No separate cross-team table.
* **Nothing else changes:** the employee's Team Lead, team, department, designation, project membership and existing tasks stay as they were. No new
  employee or task record is made. The employee is **not** added to the project: they see the project (name, status) in Projects marked *Cross-team* and
  only their own task in it.
* No approval step (there is no existing resource-allocation policy); the employee's Team Lead is told at once.

**Who changes a cross-team task** (`private.ai_studio_can_edit_task`): the Team Lead who gave it, the Department Head, the Managing Director. **Not** the
employee's own Team Lead (they see it, for workload). The earlier same-team rule is kept.

## 3. Permission matrix

| | Employee (assignee) | Assigning Team Lead (Team B) | Employee's Team Lead (Team A) | Another Team Lead | Department Head | Managing Director |
| --- | --- | --- | --- | --- | --- | --- |
| See the cross-team task | yes | yes | yes | no | yes | yes |
| Change title, description, priority, deadline | no | yes | **no** | no | yes | yes |
| Update progress, complete it | yes | no | no | no | no | no |
| See the employee's other tasks | yes | **no** | yes | no | yes | yes |
| Delete it (20270220000100) | no | yes | **no** | no | yes | no (unchanged) |
| Daily report (main's): the cross-team task's part | yes | **yes** (in the task) | yes | no | yes | yes |
| Workload counts in the assign form | - | yes (counts only) | yes | - | yes | yes |
| Attendance, salary, incentives, personal details | own | **no** (only "on leave today" / "punched in" in the assign form) | as before | no | as before | as before |

Every rule is in the database (`security definer` functions that read the caller from the login); row level security stays on and the app roles have no
grants on the AI Studio tables. Anyone outside AI Studio, a suspended or former employee, and another department are refused.

## 4. The assign form

`AssigneePicker` (`src/components/ai-studio/AssigneePicker.tsx`), fed by `GET /ai-studio/projects/:id/assignees` (`ai_studio_assignees`):

* one searchable list (name, designation, team, Team Lead), grouped by team, **My team** first; a profile picture or initials; designation; Team Lead;
  open tasks; *On leave*; a *Cross-team* label;
* people who cannot take the task are shown disabled with the reason ("Not on this project…", "only on projects you are on");
* after choosing: the workload (active, high priority, due today, overdue), today's leave / punch, and a warning when the load is heavy
  ("This employee currently has 4 active tasks, including 2 high-priority tasks. Please coordinate the workload before assigning additional work.").
  The warning never blocks. Only counts are shown, never the other tasks;
* active people only; a Team Lead's choices are Team Members.

On a database without the migration the form falls back to the earlier dropdown.

## 5. The employee's tasks

* Projects → *Assigned Tasks* / *Ongoing Tasks* / *Team Tasks* show cross-team tasks with a *Cross-team* label, the project-owning team and who gave it.
* Filters: **All tasks / My team tasks / Cross-team tasks** and the statuses (with **Overdue**; *In progress*, *Completed* as before).
* Task details add **Assignment**, **Project-owning team**, **Employee's team** (and the team at assignment if it changed), and priority / deadline changes
  with old and new values in the history. The daily reports about the task are main's panel (`TaskReportsPanel`).

## 6. Notifications (the existing centre, push and e-mail rules)

| Event | To | Type |
| --- | --- | --- |
| Cross-team task assigned | the employee: *New Cross-Team Task Assigned* ("You have been assigned "[Task]" under the "[Project]" project by [Team Lead]. Deadline · Priority") | `AI_STUDIO_TASK_ASSIGNED_CROSS_TEAM` |
| | the employee's Team Lead: *Cross-Team Assignment — Team Member* (who, by whom, from which team, project, task, deadline) | `AI_STUDIO_CROSS_TEAM_ASSIGNMENT` |
| Deadline / priority changed | the employee (`AI_STUDIO_TASK_DEADLINE`, `AI_STUDIO_TASK_PRIORITY`); for a cross-team task also their Team Lead (`AI_STUDIO_CROSS_TEAM_CHANGED`) | |
| Progress / completion from the task | as before (the giver and the employee's Team Lead) | `AI_STUDIO_TASK_UPDATED` / `_COMPLETED` |
| Daily report submitted / approved / returned | as before | `AI_STUDIO_REPORT_*` |


## 7. Performance and attribution

`performance_overview` (20270214000100) for AI Studio adds, per member: cross-team tasks, projects contributed to and submitted daily reports that name a
blocker (`metrics.contribution`); per Team Lead: tasks given to other teams (`management.crossTeamGiven`). Attribution:

* the **employee** is credited with the task once (their figures, under their own Team Lead);
* the **project** gets the progress (project progress is computed from its tasks);
* the **employee's Team Lead** sees the contribution (their team's figures and the drill-down);
* the **assigning Team Lead** is credited with having given it (`crossTeamGiven`), not with the work;
* a task and its completion are counted **once** in totals however many people can see it. Pay and incentives are not touched.

## 8. Global search

`private.search_ai_studio` (security definer, with the AI Studio checks: `ai_studio_can_see_task`, `ai_studio_can_see_report`, project membership or an
own task) feeds three new groups of `global_search`: **AI Studio tasks**, **AI Studio projects**, **AI Studio daily reports**. Choosing a result opens the
task or report on the AI Studio pages (which check access again), or the Projects page.

Daily reports are found by author, date, project or a task they cover (main's `ai_studio_report_tasks`).

## 9. Historical data

* Existing tasks get `assignment_type = 'STANDARD'`; their team at assignment is left empty (it is not known), never guessed.
* Reports are untouched.

## 10. API

| Method | Path | Function |
| --- | --- | --- |
| GET | `/ai-studio/projects/:id/assignees` | `ai_studio_assignees` |
| GET | `/ai-studio/tasks?kind=STANDARD\|CROSS_TEAM&status=OVERDUE…` | `ai_studio_tasks_page` (with `kind`); `ai_studio_tasks_list` keeps its six arguments (and reads through it) |
| (unchanged paths) | tasks, task, projects, search, performance | redefined functions: `ai_studio_task_assign`, `_task_edit`, `_task_get` (keeps 20270220000100's `canDelete` / `reportCount`), `_projects_list`, `private.ai_studio_task_row`, `perf2_member_ai`, `perf2_lead_ai`, `performance_member_work`, `global_search` |

## 11. Tests

* `supabase/tests/ai_studio_cross_team_test.sql`: standard and cross-team assignment, refusals (Team Lead not on the project, outside AI Studio,
  another Team Lead, inactive), unchanged hierarchy, visibility and edit / delete rights of each Team Lead, notifications and their wording, filters,
  performance attribution, search.
* `supabase/tests/ai_studio_cross_team.test.ts` (unit): the task filters, workload warning, service mapping.
* `api_integration.test.ts`: the "AI Studio: cross-team task assignment" block (direct API requests).
* `supabase/tests/e2e/run-ai-studio-cross-team.sh` (browser, signed in through the login page, 18 checks): the grouped picker with the workload warning
  (desktop and phone), the cross-team label, filter and details, who may change / delete it (and the 403 for the employee's own Team Lead), Ctrl+K.

## 12. Deployment and rollback

1. Run `20270220000100_task_deletion.sql` (if not yet run), then `20270221000100_ai_studio_cross_team.sql`, in the Supabase SQL editor.
2. Deploy the app. Before the migration runs the rest of AI Studio keeps working: the assign form falls back to the earlier list; choosing
   *My team / Cross-team* shows the database's error.

**Rollback.** The migration only adds columns, a constraint that holds for all existing rows, and function bodies. Deploy the previous app version (it ignores
the new columns); the data can stay. For the earlier function bodies too, run again, in order, `20270105000100`, `20270120000100`, `20270214000100`,
`20270215000100` and `20270220000100`, and `drop function public.ai_studio_tasks_page(text, uuid, text, uuid, integer, integer, text)`.

## 13. Known limitations

* A Team Lead gives tasks to Team Members; giving another **Team Lead** a task stays with the Department Head.
* Availability is today's approved leave and whether the person punched in; there is no separate availability or skills record.
* The daily report has no per-task time spent (main's report is built from the task history), so performance shows no reported hours.
* AI Studio's access is unchanged for a CEO: the Managing Director (Super Admin) and AI Studio's Department Head see everything; a CEO outside AI Studio does
  not get new AI Studio access here.
