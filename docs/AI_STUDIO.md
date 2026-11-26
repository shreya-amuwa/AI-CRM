# AI Studio department

A project-based department inside the existing CRM: **AI CRM, AI Website, AIQR** and any project the Department Head adds. Migrations
`supabase/migrations/20270105000100_ai_studio.sql`, `20270106000100_ai_studio_superadmin_head.sql` and `20270107000100_ai_studio_members_without_team_lead.sql`, `20270108000100_ai_studio_dashboard_routing.sql` and `20270120000100_ai_studio_project_deadlines.sql` (run in this order; safe to run twice; nothing is deleted, no other department is touched).
Tests: `supabase/tests/ai_studio_test.sql` (database, permission-denied cases included), the *AI Studio* block of `api_integration.test.ts`,
`supabase/tests/ai_studio.test.ts` (routing, form rules) and the browser test `supabase/tests/e2e/run-ai-studio.sh` (the Super Admin, two Team Leads and two Team Members in real browsers: the unchanged Super Admin dashboard, the workspace, creating a Team Lead and a Team Member through the forms, tasks, the Team Member -> Team Lead -> Super Admin approval, phone and tablet widths).

## Who manages AI Studio: the Super Admin is its Department Head

There is **no Department Head account** for AI Studio and none has to be created. The Super Admin keeps their own role and dashboard and manages AI Studio through
`private.ai_studio_role() = 'ADMIN'` (projects, people, tasks, every report, and the **final approval** of daily reports). Nothing is granted to any other role.

| Person | Stored as | `profiles.default_dashboard` | Opens |
| --- | --- | --- | --- |
| Super Admin | `SUPER_ADMIN` (unchanged, not placed in the department) | `super-admin` | the existing Super Admin dashboard, plus one new sidebar entry **AI Studio** (group "AI Studio") that opens the AI Studio workspace |
| Team Lead | `TEAM_HEAD`, department `ai-studio` | `ai-studio-lead` | `/ai-studio/dashboard/:id` (Lead menu) |
| Team Member | `TEAM_MEMBER` | `ai-studio-member` | same address (Member menu) |
| Department Head (optional, not needed) | `DEPARTMENT_HEAD` | `ai-studio-head` | same address (Head menu); if one ever exists they have the same powers inside AI Studio |

**The workspace** (`AiStudioWorkspace`, opened from the Super Admin sidebar or from the AI Studio card in Departments; "Back to Super Admin" returns): menu
Attendance, Meeting Requests (the CRM's own pages that the shell adds to every menu; Attendance opens the register narrowed to AI Studio), Overview, Projects,
Team Leads, Team Members, Tasks, Daily Reports, Chat, Notification Center. *Add Team Lead* / *Add Team Member* are the CRM's employee form with the department and the role fixed
(`StaffManagementPanel lockedRole`): Select Project (with Add Project) and, for a Team Member, the reporting Team Lead (active AI Studio Team Leads only; only that lead's projects are offered).

Employees are created through the existing flow (`POST /users`); a Team Lead adds their own Team Members. A Team Member belongs to **one** Team Lead through the existing
`profiles.manager_id` (`private.direct_lead_of`); the Super Admin names or changes it with `ai_studio_set_lead` (wrapping the existing `assign_direct_lead`; the new lead must be on the member's projects).

## Which dashboard an employee opens (routing)

The dashboard follows the employee's **department** (and then the role), never the role name alone: a Sales, a Support and an AI Studio Team Lead are all "Team Lead" and open three different dashboards.

* **Client** (`toAuthUser` / `isAiStudioStaff` in `src/lib/auth/roleMapping.ts`, navigation only): AI Studio is checked first, before the Sales / Support Team Lead rules. A person is AI Studio staff when their department is AI Studio (slug
  `ai-studio`, else the name "AI Studio"); only when a profile arrives without any department does the dashboard value the database computed from that same department decide. The team's division (Sales / Support) never matters.
  AI Studio Team Leads and Team Members share ONE component (`AiStudioDashboard`) and ONE menu: Attendance, Meeting Request, Overview, Projects (Assigned Tasks / Ongoing Tasks), Daily Report, then Raise an Issue, Chat, Notification Center
  (Leave and the bell are in the top bar). The Team Lead only gets more inside Daily Report (*My Daily Reports* and *Team Member Reports* tabs) and the team's tasks inside Projects. Route guard: each Team Lead is sent back to their own
  address (`/team-lead/...`, `/support-lead/...`, `/ai-studio/...`).
* **Database** (`profiles.default_dashboard`, migration 20270108000100): `private.ai_studio_department()` finds the department by slug, else by name; the trigger gives `ai-studio-head` / `-lead` / `-member` from that department before any Sales /
  Support rule, and the migration recomputes the value for everybody already in AI Studio.
* Tests: `ai_studio.test.ts` (profile shapes, route guard), the department checks at the top of `ai_studio_test.sql`, and the browser test (real Sales, Support and AI Studio Team Lead accounts; desktop and phone sidebars).

## Team Members without a Team Lead (migration 20270107000100)

A Team Member can be created, and given a project, **before any Team Lead exists**; the Team Lead is assigned later by the Super Admin.

* **Optional and independent.** *Reporting Team Lead (optional)* on the Add Team Member form; the project and the Team Lead do not depend on each other (every non-archived project is offered; a member can be on a project their
  Team Lead is not on). A project is still chosen for a new member. A Team Lead adding their own member can give only the projects they are on themselves.
* **No hidden assignment.** The CRM's shared rule "a member of a team with exactly one Team Lead belongs to that lead" is switched off for AI Studio only (`private.direct_lead_of` and the `profiles_manager_guard` trigger),
  so the first Team Lead created does not silently take every earlier member. Members that relied on that shortcut keep their lead (written into `manager_id` first). Other departments are unchanged.
* **Team Members page (Super Admin workspace).** All Team Members with *Employee, Project, Created, Status (Not Assigned / Assigned), Assigned Team Lead*; filter *All / Not Assigned to Team Lead / Assigned to Team Lead*; select one
  or many (or all listed) and **Assign Team Lead** (a list of active AI Studio Team Leads). `POST /ai-studio/people/assign-lead` -> `ai_studio_assign_lead(members[], lead)`: Super Admin / Department Head only, all or nothing, audited,
  the Team Lead and the members are notified; assigned members appear in the Team Lead's dashboard (people, team tasks, team reports). Unassigned members stay visible with a banner counting them.
* **Reports without a Team Lead.** The member logs in, sees their projects and tasks (the Super Admin can give one directly) and submits daily reports; the form says "straight to <Super Admin>". The report goes
  `PENDING_DH_APPROVAL` (the history says why) and only the Super Admin sees and decides it.
* **Assigned later.** New reports follow Team Member -> Team Lead -> Super Admin. A report already submitted keeps its route, status and history: the new Team Lead does not see it and it still waits for the Super Admin;
  approved reports are untouched. A returned or draft report follows the route in force when it is submitted again.
* **Leave and other shared features:** an unassigned member's leave uses the existing rule "the Super Admin decides a step nobody else can".

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
  Team Member (no Team Lead yet) submits -> Pending Department Head Approval -> (Super Admin approves) -> Approved
  Team Member submits -> Pending Team Lead Approval -> (Team Lead approves) -> Pending Department Head Approval -> (Super Admin approves) -> Approved
  Team Lead submits   -> Pending Department Head Approval -> (Super Admin approves) -> Approved   (no stage after the Super Admin)
  A return (remarks required) goes back to the author; resubmitting repeats the chain from the start and keeps every earlier step in the history.
  ```

  Only the report's own Team Lead decides stage 1, only the Super Admin (the Department Head of AI Studio) stage 2 and only after stage 1; nobody decides their own report. A draft is private to its author. One report per person, day, project and task (a double click opens the same report). A Team
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

*Add Team Member* (`StaffManagementPanel`, also the Super Admin's general Team Members page): for the AI Studio department a Team Lead or Team Member also gets **Select Project** (projects read from the
database; one or more; **Add Project** opens *Project Name* + optional *Project Description* + *Save Project*, the new project is stored and selected) and, when
the Head or Super Admin adds a Team Member, **Team Lead**. `POST /users` takes `aiStudioProjectIds` / `aiStudioLeadId`; `ai_studio_project_check` validates them BEFORE the
account exists and the account is removed again if assigning fails. On a database without the migration, creating people in other departments still works.

## API (`/api/v1/ai-studio/...`)

`GET overview | people | projects | tasks | tasks/:id | reports | reports/context | reports/:id`, `POST projects`, `PATCH projects/:id`, `POST projects/:id/assign`,
`POST people/:id/lead`, `POST tasks`, `PATCH tasks/:id`, `POST tasks/:id/update`, `POST reports`, `PATCH reports/:id`, `DELETE reports/:id` (draft), `POST reports/:id/review`.
Schemas: `shared/validation.ts` (AI Studio block), types: `shared/contracts.ts`.

## Project deadlines and the clock (migration 20270119000100)

Every project can have a **deadline**, and the people who work on it see a **clock counting down to it** on their dashboard so they can follow it strictly.

* **Who sets it.** Only the Super Admin / the AI Studio Department Head: *Project Management > Add project / Edit* has *Deadline (optional, Indian time)* with a **Clear** button
  (`POST` / `PATCH /ai-studio/projects`, field `deadlineAt`; left out = unchanged, `null` = none). A Team Lead and a Team Member are refused by the database. A deadline must be in the future (a project whose
  deadline already passed can still be renamed, put on hold or completed with it unchanged) and within five years. A refused deadline saves nothing, not even the project.
* **Who sees it.** `GET /ai-studio/deadlines` (`ai_studio_deadlines()`): the Super Admin / Department Head see every running project that has a deadline; a Team Lead and a Team Member only the projects
  they are on (the rule of the project list). Completed and archived projects are off the clock (their deadline stays on the record).
* **The clock** (`DeadlineClock.tsx`, on the **Overview** of every AI Studio dashboard: Team Member, Team Lead and the Super Admin's workspace). The nearest deadline is a large clock of days, hours, minutes and seconds that
  ticks every second; the other projects are listed below with the time left and their open tasks. Green = three days or more, amber = under three days, red = under a day, solid red = **overdue** (the clock then counts
  how long ago it passed). A small ticking chip also shows on every project card (*Projects* and *Project Management*), a finished project's chip shows the date only.
* **Correct time on any computer.** The list comes with the server's own time and every browser counts to it, so a computer with a wrong clock shows the right time left. One timer serves the whole page.
* **Who is told.** Setting, changing or clearing a deadline notifies the Team Leads and Team Members already on the project (`AI_STUDIO_PROJECT_DEADLINE`, opens *Projects*) and is audited with the old and new moment
  (`AI_STUDIO_PROJECT_DEADLINE`). Saving a project without touching the deadline changes and tells nobody.
* **The remote developer.** The developers of AI Studio, wherever they work from, are its Team Members (and Team Leads) and open the same dashboard, so they get the clock there. There is no separate remote-developer role in the CRM.
* **Database.** `ai_studio_projects.deadline_at` (nullable); `ai_studio_projects_list()` adds `deadlineAt`; new `ai_studio_project_save_with_deadline()` (checks the deadline, calls the unchanged `ai_studio_project_save()`, then sets
  and announces the deadline, all in one transaction) and `ai_studio_deadlines()`. Before the migration is run the app still saves projects as before; only the deadline field and the clock need it.
* **Not included:** reminders at fixed times (for example one day before); the clock is shown, and the people are told when a deadline changes.
* Tests: `ai_studio_deadlines_test.sql` (permissions, who sees what, refusals, notifications, audit), the *AI Studio deadline* block of `api_integration.test.ts`, `ai_studio_deadline.test.ts` (the arithmetic, Indian time, the form
  rule) and `ui_ai_studio_deadlines.test.mjs` (a real browser: ticking, the server's clock, tones, overdue, phone width).

## Rollout

1. Run `20270105000100_ai_studio.sql`, then `20270106000100_ai_studio_superadmin_head.sql`, in the Supabase SQL editor (each one script; each ends with `notify pgrst, 'reload schema'`).
2. Deploy the app. Before the migration the app still works; the AI Studio department does not exist yet.
3. Super Admin: sidebar > AI Studio > Team Leads > Add Team Lead (choosing their projects), then Team Members > Add Team Member (choosing the Team Lead and project). No Department Head is created.

## Known limits

* An Operations Head does not see AI Studio (the department has no Sales / Support function; a head with several departments is not modelled here).
* Offboarding an AI Studio employee does not reassign their open AI Studio tasks automatically; the Head changes them with *Edit task* / re-assigns in Project Management.
* Report attachments are not supported (reports are text); task attachments are links, as in the work reports of other departments.
* Live push (Realtime) is not used (no timers either): a page reads again after the person's own action, and a page opened from a notification reads fresh. Someone else's change shows after the next action or reload.

## A shorter daily report

The daily report form asks three things: **Work Completed Today** (required), **Pending Work** and **Challenges / Blockers**. *Work In Progress* (the same as pending
work) and *Remarks or Additional Updates* were removed from the form. Nothing changed in the database or the API (the two parts were already optional): an older report
that has text in them still shows it, in the report and in the form when it is edited, so nothing written earlier is lost.

## Cross-team tasks and multi-task daily reports (migration 20270219000100)

A Team Lead on a project can give its tasks to members of other AI Studio teams (a task-level permission: nobody changes team), and a daily report now holds
every task worked on that day, from any project, with time and progress per task. The rules, the permission matrix, the data, the notifications and the
rollout are in [AI_STUDIO_CROSS_TEAM.md](AI_STUDIO_CROSS_TEAM.md).

