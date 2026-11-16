# AI Studio department

A project-based department inside the existing CRM: **AI CRM, AI Website, AIQR** and any project the Department Head adds. Migration
`supabase/migrations/20270105000100_ai_studio.sql` (safe to run twice; nothing is deleted, no other department is touched).
Tests: `supabase/tests/ai_studio_test.sql` (database, permission-denied cases included), the *AI Studio* block of `api_integration.test.ts`,
`supabase/tests/ai_studio.test.ts` (routing, form rules) and the browser test `supabase/tests/e2e/run-ai-studio.sh` (Head, two Team Leads, two Team Members and the Super Admin in real browsers: projects, tasks, the three-step report approval, phone width).

## People and what they open

| Person | Stored as | `profiles.default_dashboard` | Opens |
| --- | --- | --- | --- |
| Department Head | `DEPARTMENT_HEAD`, department `ai-studio` | `ai-studio-head` | `/ai-studio/dashboard/:id` (Head menu) |
| Team Lead | `TEAM_HEAD` | `ai-studio-lead` | same address (Lead menu) |
| Team Member | `TEAM_MEMBER` | `ai-studio-member` | same address (Member menu) |
| Super Admin | `SUPER_ADMIN` (unchanged) | `super-admin` | Department Hub > AI Studio (overview, projects, tasks, reports; people in *Team Members & Access*) |

Nobody in AI Studio gets Super Admin or any extra administrative right. The department, its team ("AI Studio Team") and the people are ordinary
rows of `departments`, `teams` and `profiles`; employees are created through the existing flow (`POST /users`: the Super Admin makes the Head, the Head
makes Team Leads and Team Members, a Team Lead adds their own Team Members). A Team Member belongs to **one** Team Lead through the existing
`profiles.manager_id` (`private.direct_lead_of`), exactly as in every other department; the Head names or changes it with the existing
`assign_direct_lead` (wrapped by `ai_studio_set_lead`, which also requires the new lead to be on the member's projects).

## Data (all new tables are `ai_studio_*`; RLS on, no grants to `anon` / `authenticated`, all access through `security definer` functions)

| Table | What |
| --- | --- |
| `ai_studio_projects` | name (unique, case/space-insensitive), description, status (ACTIVE, ON_HOLD, COMPLETED, ARCHIVED). Seeded: AI CRM, AI Website, AIQR. |
| `ai_studio_project_members` | who works on which project. A Team Lead on one or more projects; a Team Member only on projects their own Team Lead is on. |
| `ai_studio_tasks`, `ai_studio_task_updates` | tasks (project, assignee, assigned by, deadline, priority, status, progress, completion note, up to 5 http(s) links) and the progress / status history. |
| `ai_studio_daily_reports`, `ai_studio_report_events` | the daily report and its complete approval history (who, when, status, remarks). |

Existing tables reused: `departments`, `teams`, `profiles` (`manager_id`), `notifications`, `audit_logs`, attendance, meetings (Google Calendar), chat, leave.
Tasks are separate from `work_tasks` on purpose: they need a project, a different status set and no change to the heavily-used Department Head > Team Lead >
Team Member task functions of the other departments.

## Permissions (enforced in the database; the browser sends no role, team or reviewer)

* **Projects.** Head and Super Admin: all projects, add / edit, put Team Leads on projects. Team Lead: only their projects; puts their own Team Members
  on them. Team Member: only theirs. Duplicate names are refused (`CONFLICT`). A person cannot be taken off a project while they have open tasks in it, and a
  Team Lead not while their members are on it.
* **Tasks.** Head / Super Admin give a task to a Team Lead or a Team Member of the project; a Team Lead only to their own Team Members. Only the assignee
  updates progress (In progress, On hold with a reason, Completed with completion details; 100% only by completing). The assigner, the assignee's Team Lead,
  the Head and the Super Admin can change details and the deadline (the assignee is notified of a new deadline). A Team Member sees only their tasks; a
  Team Lead their own and their team's; another Team Lead's never.
* **Daily reports.** Date, project, task, work completed (required to submit), in progress, pending, blockers, remarks. Statuses: Draft, Submitted,
  Pending Team Lead Approval, Returned by Team Lead, Pending Department Head Approval, Returned by Department Head, Approved
  (`SUBMITTED` is recorded as the first history step; the report is then immediately *Pending ... Approval*).

  ```
  Team Member submits -> Pending Team Lead Approval -> (Team Lead approves) -> Pending Department Head Approval -> (Head approves) -> Approved
  Team Lead submits   -> Pending Department Head Approval -> Approved
  A return (remarks required) goes back to the author; resubmitting repeats the chain from the start and keeps every earlier step in the history.
  ```

  Only the report's own Team Lead decides stage 1, only the Department Head stage 2 and only after stage 1; nobody decides their own report; the Super Admin
  reads but takes no part. A draft is private to its author. One report per person, day, project and task (a double click opens the same report). A Team
  Member without a Team Lead cannot submit (the form says so). Dates: today back to 60 days (Indian time), never the future.
* **Another department** (including another Department Head) gets `FORBIDDEN` from every AI Studio function.

## Notifications (existing notification centre; they open the item)

New task, task updated / completed (assigner and Team Lead), new deadline, added to a project, report submitted (Team Lead; or the Head for a Team Lead's
report), approved by the Team Lead (author and Head), returned (author, and the Team Lead after a Head's return), approved by the Head (author and Team Lead).
Entity types `ai_studio_task` / `ai_studio_report` open the AI Studio Projects / Daily Report page (`aiStudioEvents.ts`). Meeting, leave and chat events are the
existing ones.

## Screens (`src/components/ai-studio/`)

Menu order: **Attendance, Meeting Request** (the shell's own pages, label set with `meetingsLabel`), **Overview, Projects, Daily Report**, then Raise an Issue, Chat and
Notification Center; Leave and the bell are in the top bar. The Head's menu: Overview, Project Management, Tasks, Team Management, Daily Reports.
All screens reuse the Department Head design pieces (`tasks/head/headParts`), the pipeline's inputs and dialogs and `DashboardShell`.

*Add Team Member* (`StaffManagementPanel`): for the AI Studio department a Team Lead or Team Member also gets **Select Project** (projects read from the
database; one or more; **Add Project** opens *Project Name* + optional *Project Description* + *Save Project*, the new project is stored and selected) and, when
the Head or Super Admin adds a Team Member, **Team Lead**. `POST /users` takes `aiStudioProjectIds` / `aiStudioLeadId`; `ai_studio_project_check` validates them BEFORE the
account exists and the account is removed again if assigning fails. On a database without the migration, creating people in other departments still works.

## API (`/api/v1/ai-studio/...`)

`GET overview | people | projects | tasks | tasks/:id | reports | reports/context | reports/:id`, `POST projects`, `PATCH projects/:id`, `POST projects/:id/assign`,
`POST people/:id/lead`, `POST tasks`, `PATCH tasks/:id`, `POST tasks/:id/update`, `POST reports`, `PATCH reports/:id`, `DELETE reports/:id` (draft), `POST reports/:id/review`.
Schemas: `shared/validation.ts` (AI Studio block), types: `shared/contracts.ts`.

## Rollout

1. Run `20270105000100_ai_studio.sql` in the Supabase SQL editor (one script; ends with `notify pgrst, 'reload schema'`).
2. Deploy the app. Before the migration the app still works; the AI Studio department does not exist yet.
3. Super Admin: Department Hub > AI Studio > *Team Members & Access* > Add the Department Head; the Head adds Team Leads (choosing their projects) and Team Members.

## Known limits

* An Operations Head does not see AI Studio (the department has no Sales / Support function; a head with several departments is not modelled here).
* Offboarding an AI Studio employee does not reassign their open AI Studio tasks automatically; the Head changes them with *Edit task* / re-assigns in Project Management.
* Report attachments are not supported (reports are text); task attachments are links, as in the work reports of other departments.
* Live push (Realtime) is not used (no timers either): a page reads again after the person's own action, and a page opened from a notification reads fresh. Someone else's change shows after the next action or reload.
