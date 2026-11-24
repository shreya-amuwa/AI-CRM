# International and Reseller: unified Sales + Support departments

Two departments, **International** (`international`) and **Reseller** (`reseller`), whose Department Head, Team Leads and Team Members each work
in Sales **and** Support. Delivered in three pull requests; this page describes what exists so far (PR 1, then PR 2 at the end).

| PR | Content | State |
| --- | --- | --- |
| 1 | Database: the departments, hierarchy, dashboard routing, Sales/Support access for unified staff, data isolation, tests | above |
| 2 | One dashboard with *Sales* and *Support* groups in the sidebar, for all three roles; the Department Head's Sales pages; the Add Team Member form | PR 2 (section below) |
| 3 | Overview analytics, Super Admin monitoring, browser tests | not started |

Migration `supabase/migrations/20270127000100_international_reseller_departments.sql` (run after `20270126000200`; safe to run twice; nothing is
deleted and no existing department, person, lead, customer, ticket, task or report is changed). Tests: `supabase/tests/unified_departments_test.sql`
(95 checks, permission-denied cases included).

## Model: one flag, the existing tables

* `departments.unified_sales_support` marks a department whose people do both Sales and Support. Both new departments are created with it and
  one team of division `GENERAL` each (the AI Studio pattern). Adding another such department later is data, not code: create it with the flag.
* There are **no new Sales or Support tables and no duplicate people**. Leads and customers are `customers`, tickets are `support_tickets`, plus the
  existing tasks, daily reports, attendance, leave, meetings, chat and notifications. Isolation is the existing ownership / team / department rules.
* A unified department cannot have a Sales-only or a Support-only team (trigger `teams_unified_division`): its people do both.

## Why the existing Sales and Support rules needed a change

The function a person performs (Sales or Support) was read from their **team's division** (`SALES` / `SUPPORT`) in about 235 places, so a member of a
`GENERAL` team could neither raise a ticket nor open the Support Team Lead pages. Rather than rewrite every rule (and risk the existing departments),
two helpers were added, `private.dept_is_unified(department)` and `private.team_unified(team)`, and **only** the Sales-side and Support-side
functions that a Team Lead / Team Member of these departments need were widened from `team.division = 'X'` to
`(team.division = 'X' or private.team_unified(team.id))`. For every other team the result is identical.

Widened (latest definition of each, one condition changed): `is_support_staff`, `current_team_lead`, `team_lead_scope`, `in_team_lead_scope`,
`create_support_customer`, `pass_to_team_lead`, `assign_to_team_member`, `support_member_of`, `support_lead_of`, `tg_support_tickets_support_only`,
`sales_leads_base`, `sales_lead_assignees`, `sales_task_assign`, `sales_task_assignees`, `sales_tasks_list`, `sales_team_people`,
`lead_scope_allowed`, `lead_scope_ids`, `can_upload_leads`, `ba_eligible`, `in_sales_section`.

Deliberately **not** widened: `is_support_team_member` (it carries the Support-only "may not write invoices" restriction, which Sales-side work does not
have) and `my_support_department_id` (the Technical Consultant / Meta verification flow).

## Data isolation (what the tests prove)

| Who | Sees |
| --- | --- |
| Team Member | only the leads, customers, tickets and tasks they own, and their own reports |
| Team Lead | their own Team Members' records; **not** the other Team Lead's people (a team can have several leads; each member belongs to one) |
| Department Head | the whole of their own department (both Sales and Support); no side (`head_division` is forced to NULL: one head for both sides) |
| International vs Reseller vs Sales / Support departments | nothing of each other, in either direction |
| Super Admin | everything (unchanged) |

**Found and fixed while testing:** the *department-wide Support desk* (setting `access_settings.support_desk_department_wide`, on by default) lets every
Support person read every `CUSTOMER`-stage customer of the department (`private.can_view_customer` and the policy `customers_select_support`).
Because unified staff now count as Support staff, that would have let a member read a colleague's customers. It is switched off for a unified
department only (`not private.dept_is_unified(department_id)`), so a member sees only their own customers; existing departments keep the setting.

## Hierarchy and dashboard value

Department Head -> Team Lead -> Team Member, the existing rules: a Team Member is named to one Team Lead (`profiles.manager_id`, `private.direct_lead_of`)
and the daily report goes Team Member -> Team Lead (approve) -> Department Head (final approval); a Team Lead's own report goes straight to the
Department Head. Leave, meetings, chat, attendance and notifications follow the same hierarchy as everywhere.

`profiles.default_dashboard` is `unified-head`, `unified-lead` or `unified-member` for these departments (computed by the database from the
department flag, before the Sales / Support rules). PR 2 opens one dashboard for these values. Until then, such a person signs in and gets the
generic Team Lead / Team Member dashboard (the client does not know the new values yet); nothing else in the CRM changes.

## Super Admin: adding employees

The Department dropdown of *Add Team Member* is read from the database, so both departments appear. Choose the department and the role (Department Head,
Team Lead, Team Member); the reporting relationship, the team and the dashboard are applied from the department. A Department Head asked for a Sales-only
or Support-only side is stored with no side. A second Department Head for the same department is refused (`CONFLICT`), whatever side is asked for.
Nobody here receives Super Admin or another department's permissions.

## Rollout

Run the migration in the Supabase SQL editor. The code works before it is run (nothing references the new column until then). To check afterwards:

```sql
select slug, name, unified_sales_support from public.departments where slug in ('international', 'reseller');
select d.slug, t.name, t.division from public.teams t join public.departments d on d.id = t.department_id where d.unified_sales_support;
```

## Known limits (addressed in the next pull requests)

* The Sales and Support **screens** for these roles are not combined yet (PR 2); a unified person currently opens the generic dashboard.
* Overview analytics, Sales-and-Support reports and the Super Admin comparison of the two departments are PR 3.
* A Support Team Lead page that was built for a Support team's hand-over from Sales (`customer_onboarding`) is not used here: leads become customers in
  the same department and are served by the same member or Team Lead, so there is no hand-over step.

# PR 2: one dashboard, Sales and Support in the same sidebar

Migration `supabase/migrations/20270130000100_unified_head_sales_pages.sql` (run after `20270127000100`; safe to run twice). Tests:
`supabase/tests/unified_head_pages_test.sql` (database), `supabase/tests/unified_dashboard.test.ts` (97 checks: sidebars, addresses, routing, form rules) and
`supabase/tests/ui_unified_dashboard.test.mjs` (154 browser checks in Chromium).

## What a person opens

The Department Head, every Team Lead and every Team Member of International and Reseller open **one** component, `UnifiedDashboard`
(`src/components/unified/`), at `/unified/dashboard/:id[/:section[/:page]]`. The person's role in the database picks the menu and the pages (as AI Studio does);
the database decides what each page may show. Which dashboard a person opens is the `profiles.default_dashboard` value the database computed from the department
(`unified-head` / `unified-lead` / `unified-member`), so no department name is hard-coded in the routing. Another dashboard's address is never opened (the route guard
sends the person back to their own) and a role cannot reach another role's page by typing its address.

## The sidebar (the same structure for the three roles; the entries differ by role)

Attendance and Meeting Request are added first by the dashboard shell, Leave is the top bar's button, and the person's Profile is the last entry.

| Section | Department Head | Team Lead | Team Member |
| --- | --- | --- | --- |
| Overview | department: leads, new, converted, customers, active / resolved tickets, pending tasks, team performance | the team: own leads, tickets, tasks, team scope | own leads, customers, active tickets, tasks (assigned / ongoing / completed) |
| **Sales** | Add Lead, My Leads (Leads, Potential, Customer onboarding, Part payments), Department Leads, Lead Assignment, Sales Performance, Sales Reports | Add Lead, My Leads, Team Leads, Lead Follow-ups, Sales Performance | Add Lead, My Leads, Lead Follow-ups |
| **Support** | Customers, Support Tickets, Customer Issues, Team Activity | Customers, Support Tickets, Team Activity | My Customers, My Support Tickets |
| Work | Task Management (Assign tasks, Work updates, Task reports, Daily tasks), Daily Reports | Task Management, Daily Reports | Task Management, Daily Reports |
| Team | Team Members, Team Attendance, Raise an Issue, Chat, Notification Center, Profile | Team Members, Raise an Issue, Chat, Notification Center, Profile | Raise an Issue, Chat, Notification Center, Profile |

Every entry opens an **existing** page (no second Sales or Support system): `PipelineWorkspace` (leads), `LeadList` / `LeadAssign` / `SalesPerformance` /
`SalesReports` (the Sales Department Head's pages), `HeadLeadsPage`, `HeadCustomersPage`, `SupportDeskPage`, `TeamActivityPage`, `SupportLeadCustomers` /
`SupportLeadTickets` (the Support Team Lead's pages), `TeamCustomers`, `TeamLeadTasksView`, `HeadAssign` / `HeadReports` / `HeadDaily` / `WorkUpdatesPanel`,
`PerformanceManagement`, `TeamMemberManagement`, `HeadAttendancePage`, and the shared Daily Reports, Chat, Raise an Issue and Notification pages. The Team Member's
Support pages (`UnifiedMemberCustomers`, `UnifiedMemberTickets`) are the Support Team Member's own pages with the same database rules.

## Database: the Department Head's Sales pages

The Sales Department Head's pages (Department Leads, Lead Assignment, tasks, people, overview, reports) are guarded by `private.require_sales_head()`, which only
accepted a head whose side is Sales. A unified head has no side, so they were refused ("This page is for the Sales Department Head") although the data rules
already scope them to their own department. The guard now also accepts the Department Head of a unified department, and `sales_head_overview`,
`sales_head_reports`, `division_leads_overview` and `division_support_overview` read the department's unified team. Tested: each head lists and assigns only
their own department's people and leads, the other department's overview is refused, Team Leads and Team Members are still refused, and the Support head and the
Sales head of another department are unchanged.

## Add Team Member (Super Admin, Department Head, Team Lead)

The department dropdown is read from the database, so both departments appear. For International and Reseller the form offers only Department Head, Team Lead
and Team Member, the department's one team and no Sales / Support side, and names the dashboard ("Sales & Support Team Lead Dashboard"). The form helpers use the
slug list `UNIFIED_DEPARTMENT_SLUGS` (a convenience, like the Design Studios list); the database decides (`departments.unified_sales_support`).

## Known limits (PR 3 and later)

* The **Overview** pages read the existing division-overview, pipeline-count, ticket and task data; richer analytics, reporting by Sales and Support and the Super
  Admin's side-by-side monitoring of the two departments are PR 3. The browser test replaces the reused pages (including the Overview) by markers: it proves which
  page each entry opens for each role, not how the reused pages render; those pages keep their own tests.
* The Department Head's *Add Lead* opens the head's lead form (`HeadLeadsPage`); the Sales income and incentive pages are not part of these departments yet.
* `Lead Follow-ups` for a Team Lead / Team Member reuses the member task / follow-up page (`MemberSections`); a dedicated "Sales Activity" page is not built.
* The Sales Department Head's **income** page (`sales_head_income`) is still for Sales-side heads only.

# Super Admin monitoring (PR 3, first part)

The Super Admin who opens International or Reseller from the department hub used to land on the generic department
panel (a lead-ingestion page that does not apply here). **Dashboard** now shows the department's real **Sales and Support** figures side by side (total / new / converted leads,
overdue follow-ups, customers, active / resolved / unassigned tickets, and the team table), read-only, for that department only. It reuses the Department Head's overview
(`UnifiedDepartmentMonitor`, `src/components/unified/UnifiedOverview.tsx`) and the existing `division_leads_overview` / `division_support_overview` functions, which allow exactly the
Super Admin and that department's own Department Head (anyone else is refused by the database). No migration is needed.

# Existing departments: "Amuwa International Department" and "Amuwa Reseller Department" (migration 20270202000300)

## What was wrong

The two departments the owner had already created in the Departments page ("Amuwa International Department", "Amuwa Reseller Department") have their own slugs and no team.
The unified behaviour of the earlier pull requests was keyed on the **two slugs** `international` / `reseller` (the seeded departments), in the database (`departments.unified_sales_support`,
set only for those slugs) **and** in the forms (`UNIFIED_DEPARTMENT_SLUGS`). So for the real departments:

- the Add Team Member form treated them as ordinary departments, offered the Sales-only / Support-only roles and asked for a head function, and refused with *"... has no Sales or Support team to manage."*
  (they have no Sales or Support team: they are meant to have one General team that does both);
- the people in them opened the generic dashboards, not the unified Sales + Support one.

There was no permission problem: the Sales and Support rules (`private.dept_is_unified`, `team_unified`) already read the department flag. They just never saw the flag on these departments.

## The fix (data, not slugs)

`20270202000300_unified_existing_departments.sql` (run after `20270202000200`, and only after `20270127000100_international_reseller_departments.sql` and `20270130000100_unified_head_sales_pages.sql` have been run: it stops with a clear message if they have not; safe to run twice; nothing is deleted from a used department, nothing is renamed, no person, lead, ticket or task changes):

1. A department is flagged `unified_sales_support` when its **name or slug says International or Reseller** (whole word), it is **not the Sales / Support side of another department**
   and it has **no Sales team and no Support team**. A real Sales or Support department therefore can never be matched (tested with "International Sales Hub", which has a Sales team).
2. A flagged department with no team gets its one **General** team.
3. The people already in them get the unified dashboard (`unified-head` / `-lead` / `-member`); a Department Head who had been given a Sales-only or Support-only side has no side.
4. **Duplicates.** The first migration seeded separate `international` / `reseller` departments. `private.unified_drop_unused_seed(slug)` removes such a seeded department **only** when an existing
   International / Reseller department exists and **nothing at all points at it** (every foreign key to the department and its teams is checked; audit entries only remember and are kept).
   If anything is found, it is kept; remove it from the Departments page when no longer needed.

The API now returns `unifiedSalesSupport` for every department (`GET /departments`, optional, so an older database still works), and the forms learn the flagged departments when the
department list loads (`registerUnifiedDepartments`). The two seeded slugs stay recognised as the fallback.

## What every person of these departments has (tested with real accounts in the database)

| Department | Designation | Sales | Support | Dashboard |
| --- | --- | --- | --- | --- |
| Amuwa International | Department Head / Team Lead / Team Member | add lead, lead lists, assignment (head / lead), follow-ups | customers, tickets, status, resolve / close | one unified dashboard |
| Amuwa Reseller | Department Head / Team Lead / Team Member | same | same | one unified dashboard |

Each sees only their own department's leads and tickets (member: their own; Team Lead: their members'; head: the department). Super Admin and every existing Sales / Support department are unchanged.

Tests: `supabase/tests/unified_existing_departments_test.sql`, `supabase/tests/unified_dashboard.test.ts` (registry), `supabase/tests/ui_unified_existing_departments.test.mjs` (the real Add Team Member form), the `departments API` checks of `api_integration.test.ts`.
