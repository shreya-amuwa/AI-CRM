# AI Design Studio

> This department is named **AI Design Studio** (slug `ai-design-studio`). For a short time (migration `20270112000200`) it carried the name
> "Amuwa Design Studio"; migration `20270118000100_amuwa_design_studio_restore.sql` gave the name back. **Amuwa Design Studio** (slug
> `designstudio`) is a separate, active department. See [DESIGN_STUDIO_ROLES.md](DESIGN_STUDIO_ROLES.md).

A separate, client-oriented department with its own Team Member, Team Lead and Department Head dashboard. Migration:
`supabase/migrations/20270110000100_ai_design_studio.sql` (additive, safe to run twice).

It is **not** AI Studio and **not** Amuwa Design Studio (slug `designstudio`). Nothing of those departments is changed. The Super Admin has **no**
AI Design Studio workspace: it is not in the Super Admin's *Departments* page or company overview, and the database functions refuse the Super Admin.
It **is** in the *Department* drop-down of *Add Team Member*, so people are created with the existing process.

## Department, people and hierarchy

* Department `ai-design-studio` ("AI Design Studio") with one `General` team. The roles are the existing ones: `DEPARTMENT_HEAD -> TEAM_HEAD (Team Lead) -> TEAM_MEMBER`.
* **A Team Member can be created before any Team Lead exists.** The Team Lead of a member is `profiles.manager_id`, resolved by the existing
  `private.direct_lead_of` (see TEAM_LEAD_OWNERSHIP.md): nobody named + no Team Lead = **unassigned**. An unassigned member signs in, works, and their
  reports, issues and assignments go **directly to the Department Head**. The Department Head (or Super Admin) names a Team Lead later with the
  existing *Assign to Team Lead* (`assign_member_to_team_lead`). A team with exactly one active Team Lead gives that lead its unnamed members by itself
  (the existing rule); with two or more leads, an unnamed member stays unassigned until named.
* A Team Lead sees only their own members (`private.led_by`): never another lead's people, work, reports or issues.

## Dashboard routing

The department **and** the role decide (`isAiDesignStudio` in `src/lib/auth/roleMapping.ts`), never the role name alone:

| Department | Role | Dashboard |
|---|---|---|
| AI Design Studio | Team Member / Team Lead / Department Head | AI Design Studio dashboard (`/ai-design-studio/dashboard/:id/:page`) |
| AI Studio, Sales, Support, HR, Accounts, every other department | any | unchanged |

The Team Member and Team Lead share **one sidebar**: Attendance, Meeting Request, Overview, Client (Client Add, Client Notice), Assign, Report, Raise an
Issue, Chat, Notification, Settings. The role changes what the pages let you do. The Department Head sees the same pages plus *Team Members* (add people, name Team Leads).

## Pages

* **Attendance, Meeting Request, Chat, Notification, Settings, Leave:** the existing shared modules (`DashboardShell`, `ChatRoute`, `NotificationsPage`,
  `MemberSettingsDashboard`, `LeaveCenter`), including the Google Calendar integration of Meetings. The menu item reads "Meeting Request" through the new
  optional `meetingsLabel` of `DashboardShell`.
* **Overview:** live figures (`ads_overview`): clients, assignments (ongoing / pending / completed / overdue), upcoming deadlines, recent notices and
  activity, reports waiting, open issues, and the team (Team Lead / Department Head).
* **Client Add:** name, company, contact person and number, e-mail, address, requirements, design service, work description, remarks, up to 5 attachment
  links. The same client (name + company + e-mail) is not saved twice (`CONFLICT`). The creator is kept. Sales leads and Support customers are **not** created.
  Who sees a client: the Department Head all; the creator; the creator's Team Lead; anyone working on an assignment of that client.
* **Client Notice:** title, client, description, date, creator, priority, status (Open / Acknowledged / Resolved), category (new instructions, design
  feedback, requirement change, revision request, approval update, delivery update, important communication), optional "assign to". Notified: the named
  person, the Department Head, everyone working on that client and their Team Leads.
* **Assign:** Department Head -> Team Lead (`ads_assignment_create`), or directly to a Team Member **who has no Team Lead**; Team Lead -> **own** Team Members only,
  from the work they received (`parentId`). Statuses: Assigned, Accepted, In Progress, Pending Review, Revision Required, Completed. The receiver sets Accepted /
  In Progress (with progress) / Pending Review; **the person who assigned it (or the Department Head) completes it or sends it back** (a revision needs a note).
  Deadline, priority and instructions can be changed by the assigner and the Department Head (the receiver is notified of a new deadline). Reassignment keeps
  the full history in `ads_events` (who assigned, who received, every status change, deadline and reassignment).
* **Report (daily):** date, client, assignment, work completed today, work in progress, pending work, blockers, remarks, links. `Team Member -> Team Lead ->
  Department Head`; a Team Lead's own report and an unassigned member's report go **directly to the Department Head**. Team Lead: *My Reports* and *Team Member
  Reports* (approve or return with remarks; approving forwards to the head). Department Head: every report, with filters (Team Lead, member, client, date,
  status), final approval or return, and the complete history (reviewer, time, remarks). The head cannot skip the Team Lead's stage; if a member has no
  lead, the head decides alone. A returned report is corrected and sent again; earlier rounds stay in the history.
* **Raise an Issue:** title, category, description, client / assignment, priority, links. Goes to the raiser's Team Lead (or the Department Head for a
  Team Lead, an unassigned member, or after escalation). The Team Lead responds, changes the status (Open, Under Review, In Progress, Resolved, Closed) and can
  **escalate** to the Department Head, who manages every issue. The raiser can reply and close a resolved issue. This is separate from HR's employee issues.

## Data and security

Tables (RLS on, no grants to the app roles): `ads_clients`, `ads_client_notices`, `ads_assignments`, `ads_reports`, `ads_issues`, and one append-only
`ads_events` history. Every read and write is a `security definer` function `ads_*` (`set search_path = ''`) that calls `private.ads_actor()`:
the caller must be an **active** Department Head, Team Lead or Team Member **of AI Design Studio**; the browser sends no role, team, reviewer or status
(strict Zod schemas refuse such fields). Errors are `VALIDATION_ERROR` / `NOT_FOUND` / `FORBIDDEN` / `CONFLICT`. Notifications use the existing
`notifications` table with a dedupe key (retries never notify twice) and link to the record (`entity_type` `ads_*`); audit entries are written for creates,
status changes, reviews and escalations. Attachments are validated `http(s)` links (up to 5), as in work reports.
Department `generates_revenue` is `false`, so it does not appear in Accounts' income screens.

## API (`/api/v1/ai-design-studio/...`)

`GET context | people | overview`, `GET|POST clients`, `GET|PATCH clients/:id`, `GET|POST notices`, `POST notices/:id/status`, `GET|POST assignments`,
`GET|PATCH assignments/:id`, `POST assignments/:id/status | reassign`, `GET|POST reports`, `GET reports/:id`, `POST reports/:id/review`, `GET|POST issues`,
`GET issues/:id`, `POST issues/:id/update | escalate`. Types in `shared/contracts.ts`, schemas in `shared/validation.ts`; code in
`server/{repositories,services}/AiDesignStudio*.ts`; client `src/lib/api/aiDesignStudio.ts`; screens `src/components/ai-design-studio/`.

## Tests

`supabase/tests/ai_design_studio_test.sql` (hierarchy, routing, isolation, permissions, notifications, history), `supabase/tests/ai_design_studio.test.ts`
(dashboard routing by department + role, route guards, Super Admin, schemas), and the *AI Design Studio* block of `supabase/tests/api_integration.test.ts`.

## Rollout

Run `20270110000100_ai_design_studio.sql` in the Supabase SQL editor. Before it runs, the department does not exist and nothing else changes; after it,
create the Department Head with *Add Team Member* (Department: AI Design Studio, Role: Department Head), then Team Members and Team Leads.
