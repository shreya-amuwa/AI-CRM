# International and Reseller: unified Sales + Support departments

Two departments, **International** (`international`) and **Reseller** (`reseller`), whose Department Head, Team Leads and Team Members each work
in Sales **and** Support. Delivered in three pull requests; this page describes what exists so far.

| PR | Content | State |
| --- | --- | --- |
| 1 | Database: the departments, hierarchy, dashboard routing, Sales/Support access for unified staff, data isolation, tests | this document |
| 2 | One dashboard with *Sales* and *Support* groups in the sidebar, for all three roles | not started |
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
