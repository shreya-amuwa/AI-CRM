# AI Studio: cross-team tasks and multi-task daily reports

Migration `supabase/migrations/20270219000100_ai_studio_cross_team_multi_task.sql` (run after `20270218000100_support_client_login.sql`; safe to run twice; no temp tables;
nothing deleted). Builds on [AI_STUDIO.md](AI_STUDIO.md) and the performance pages of [TASK_DAILY_REPORTS_PERFORMANCE.md](TASK_DAILY_REPORTS_PERFORMANCE.md).

## 1. What was there (audit)

| Area | Before | Where |
| --- | --- | --- |
| Teams | A "team" is a Team Lead and the people who report to them (`private.direct_lead_of`, `profiles.manager_id`); AI Studio has one `teams` row | 20270105000100, 20270107000100 |
| Project ownership | No owner column; a project's Team Leads are its Team Lead members (`ai_studio_project_members`) | 20270105000100 |
| Task assignment | A Team Lead could give tasks to **their own Team Members only**, and only on a project the member was on | `ai_studio_task_assign` |
| Assign form | Listed the project's people; a Team Lead saw only their own members | `AiStudioTasks.tsx` `assignablePeople` |
| Editing a task | **Any** Team Lead who could see a task could change it (the employee's own Team Lead included) | `ai_studio_task_get` / `_edit` |
| Seeing a task | Assignee, the Team Lead who gave it, the employee's Team Lead, the Department Head, the Managing Director (Super Admin) | `private.ai_studio_can_see_task` |
| Daily report | One project and at most one task per report (`unique (author, date, project, task)`); two-step approval: Team Lead, then Department Head | `ai_studio_daily_reports` |
| Progress | Updated only from the task (`ai_studio_task_update`, 0 to 99%, completing needs completion details); history in `ai_studio_task_updates` | 20270105000100 |
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
| Daily report: the whole report | yes (author) | **no** | yes (reviews it) | no | yes (final approval) | yes |
| Daily report: the entries about the cross-team task | yes | **yes** (in the task) | yes | no | yes | yes |
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
* Task details add **Assignment**, **Project-owning team**, **Employee's team** (and the team at assignment if it changed), the **daily report entries** about
  the task, and the new history steps (*Daily report linked*, *Blocker reported*, priority / deadline changes with old and new values).

## 6. Multi-task daily report

**Data.** The existing `ai_studio_daily_reports` row is the parent; `consolidated = true` marks a day report (one per person and day: partial unique index
`(author_id, report_date) where consolidated`), with `total_minutes`. Its day-level parts use the existing columns: `work_completed` = overall summary,
`remarks` = additional work, `blockers` = blockers and challenges, `pending_work` = tomorrow's plan. `project_id` may be null for a day report only
(check constraint). Each task is a row of **`ai_studio_report_entries`** (`unique (report_id, task_id)`): task, project and title as they were, assignment type,
who gave it, task status, previous progress, reported progress, minutes, work completed, blockers, next action.

**Form** (`DailyReportForm.tsx`, `GET /ai-studio/daily-reports/context`, `POST /ai-studio/daily-reports`): date (today and the last 60 days, as before),
employee, department, team; a searchable multi-select of the person's tasks grouped by project (open on that day, or completed that day or later -
cross-team ones included); chosen tasks as removable chips (a task cannot be added twice); one collapsible section per task (the title, project, progress
and hours stay visible when collapsed; typed text is kept); overall summary, additional work, blockers, tomorrow's plan; a sticky summary (tasks, completed,
in progress, total hours). **Save draft** and **Submit daily report**.

**Validation** (the same Zod schema in the form and the service, then the database): every task is the caller's, assigned on or before the date, not completed
before it; each task's work, time (1 minute to 24 hours) and progress are required on submission; at most 25 tasks; the time adds up to at most 24 hours.
The database writes the report and all its entries **in one transaction** (nothing half-written); an error names the task ("Task 2: …") and the form
highlights that section, keeping everything typed. A second click finds the same report; submitting a report already submitted is refused (no duplicate).
The two-step approval (Team Lead → Department Head) and the returned / resubmitted cycle are unchanged.

**Hours.** Each task's hours and minutes are stored as minutes; the total is their sum. The form compares it with the **net working time** of attendance for
that date (punch in to punch out, or now today, less breaks) and warns when the report is higher ("Your total reported task hours exceed your recorded
working hours for this date…"). Attendance is never changed; no pay or incentive is calculated from reported hours.

## 7. Progress synchronization

On **submission** (not on a draft) each entry is linked to its task through the task's own history (`ai_studio_task_updates`, kind `REPORT`, with the report
id and the progress before / after):

* the task's progress follows the report **only upwards** (a report written later for an earlier day never lowers newer progress);
* an open task moves to at most **99%**: completing a task stays its own step with completion details (`ai_studio_task_update`);
* a completed task is reported at 100% and is not changed;
* an *Assigned* task becomes *In progress*;
* a blocker is recorded (kind `BLOCKER`) and told to the Team Lead who gave the task and, for a cross-team task, the employee's own Team Lead.

Task rows are locked during the submission, so two submissions never overwrite each other's progress.

## 8. Notifications (the existing centre, push and e-mail rules)

| Event | To | Type |
| --- | --- | --- |
| Cross-team task assigned | the employee: *New Cross-Team Task Assigned* ("You have been assigned "[Task]" under the "[Project]" project by [Team Lead]. Deadline · Priority") | `AI_STUDIO_TASK_ASSIGNED_CROSS_TEAM` |
| | the employee's Team Lead: *Cross-Team Assignment — Team Member* (who, by whom, from which team, project, task, deadline) | `AI_STUDIO_CROSS_TEAM_ASSIGNMENT` |
| Deadline / priority changed | the employee (`AI_STUDIO_TASK_DEADLINE`, `AI_STUDIO_TASK_PRIORITY`); for a cross-team task also their Team Lead (`AI_STUDIO_CROSS_TEAM_CHANGED`) | |
| Blocker in a daily report | the Team Lead who gave the task; for a cross-team task also the employee's Team Lead | `AI_STUDIO_TASK_BLOCKER` |
| Progress / completion from the task | as before (the giver and the employee's Team Lead) | `AI_STUDIO_TASK_UPDATED` / `_COMPLETED` |
| Daily report submitted / approved / returned | as before | `AI_STUDIO_REPORT_*` |

Progress written by a daily report does not send a notification per task (no noise for small changes). Every notification opens the task or report.

## 9. Performance and attribution

`performance_overview` (20270214000100) for AI Studio adds, per member: cross-team tasks, projects contributed to, minutes reported in daily reports and
blockers reported (`metrics.contribution`); per Team Lead: tasks given to other teams (`management.crossTeamGiven`). Attribution:

* the **employee** is credited with the task once (their figures, under their own Team Lead);
* the **project** gets the progress (project progress is computed from its tasks);
* the **employee's Team Lead** sees the contribution (their team's figures and the drill-down);
* the **assigning Team Lead** is credited with having given it (`crossTeamGiven`), not with the work;
* a task, its completion and its minutes are counted **once** in totals however many people can see it. Pay and incentives are not touched.

## 10. Global search

`private.search_ai_studio` (security definer, with the AI Studio checks: `ai_studio_can_see_task`, `ai_studio_can_see_report`, project membership or an
own task) feeds three new groups of `global_search`: **AI Studio tasks**, **AI Studio projects**, **AI Studio daily reports**. Choosing a result opens the
task or report on the AI Studio pages (which check access again), or the Projects page.

## 11. Historical data

* Every existing single-task report stays as it was (project, task, text, approval history).
* Each one that names a task also gets **one entry** (`legacy = true`) from its own text, so that task histories and the drill-down include it. A report
  that names no task gets no entry (nothing is invented). Idempotent (`on conflict do nothing`).
* Existing tasks get `assignment_type = 'STANDARD'`; their team at assignment is left empty (it is not known), never guessed.
* The single-task save (`ai_studio_report_save`) still works for those older reports and refuses to touch a day report.

## 12. API

| Method | Path | Function |
| --- | --- | --- |
| GET | `/ai-studio/projects/:id/assignees` | `ai_studio_assignees` |
| GET | `/ai-studio/tasks?kind=STANDARD\|CROSS_TEAM&status=OVERDUE…` | `ai_studio_tasks_page` (with `kind`); `ai_studio_tasks_list` keeps its six arguments (and reads through it) |
| GET | `/ai-studio/daily-reports/context?date=` | `ai_studio_daily_context` |
| POST | `/ai-studio/daily-reports` | `ai_studio_daily_report_save` |
| (unchanged paths) | tasks, task, report, review, search | redefined functions: `ai_studio_task_assign`, `_task_edit`, `_task_get`, `_projects_list`, `_reports_list`, `_report_review`, `_report_save`, `private.ai_studio_task_row`, `_report_row`, `_report_detail`, `_tasks_list`, `perf2_member_ai`, `perf2_lead_ai`, `performance_member_work`, `global_search` |

## 13. Tests

* `supabase/tests/ai_studio_cross_team_test.sql` (53 checks): standard and cross-team assignment, refusals (Team Lead not on the project, outside AI Studio,
  another Team Lead, inactive), unchanged hierarchy, visibility and edit rights of each Team Lead, notifications and their wording, filters, the
  three-task report, duplicate task, 0 to 99%, missing time, more than 24 hours, somebody else's task, all-or-nothing, one report per day, progress sync and
  history, stale reports, blockers, who reads the report, the project filter, legacy entries, performance attribution, search.
* `supabase/tests/ai_studio_cross_team.test.ts` (unit): the schema, hours, workload warning, service mapping.
* `api_integration.test.ts`: the "AI Studio: cross-team task assignment and the multi-task daily report" block (direct API requests).
* `supabase/tests/e2e/run-ai-studio-cross-team.sh` (browser, signed in through the login page, 25 checks): the grouped picker with the workload warning
  (desktop and phone), the cross-team label, filter and details, a three-task report submitted **on a phone** (two clicks, one report), the assigning Team
  Lead's single entry, the employee's Team Lead's review, Ctrl+K.

## 14. Deployment and rollback

1. Run the migration in the Supabase SQL editor (one script, safe to run twice).
2. Deploy the app. Before the migration runs the rest of AI Studio keeps working: the assign form falls back to the earlier list; the task lists work, but
   choosing *My team / Cross-team* and the new daily report form show the database's error (the older reports still open).

**Rollback.** The migration only adds columns, a table, a constraint that holds for all existing rows, and function bodies. To go back: deploy the previous app
version (it ignores the new columns). The data can stay. If the earlier function bodies are wanted too, run again, in order, the earlier migrations that
define them (`20270105000100`, `20270106000100`, `20270107000100`, `20270120000100`, `20270214000100`, `20270215000100`), and
`drop function public.ai_studio_tasks_page(text, uuid, text, uuid, integer, integer, text)`. Day reports
written meanwhile then show as reports without a project; their entries stay in `ai_studio_report_entries`.

## 15. Known limitations

* No task **cancel, reassign or reopen** exists in AI Studio, so those events are not recorded (the history has room for them).
* A Team Lead gives tasks to Team Members; giving another **Team Lead** a task stays with the Department Head.
* Availability is today's approved leave and whether the person punched in; there is no separate availability or skills record (not added, as asked).
* The Team Lead's report correction (20270214000100) edits a day report's day-level parts, not its task entries.
* AI Studio's access is unchanged for a CEO: the Managing Director (Super Admin) and AI Studio's Department Head see everything; a CEO outside AI Studio does
  not get new AI Studio access here.
