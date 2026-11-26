# Team Lead -> Team Member ownership

`Super Admin -> Operations Head -> Department Head -> Team Lead -> Team Member`. For routine tasks and daily reports the reporting line is
**one Team Member -> their ONE Team Lead -> the Department Head**, decided by the database. Migration: `20261223000100_team_lead_ownership.sql` (additive, safe to run twice).

## Root causes (confirmed in the code, not guessed)

| Symptom | Cause |
| --- | --- |
| A Team Lead sees / assigns tasks to another Team Lead's members | A Team Member belonged to a **team** (`profiles.team_id`), and two active Team Leads (`role = TEAM_HEAD`) can share one team. `assign_team_task` / `assign_task_to_members` accepted any `TEAM_MEMBER` with the same `team_id`; the picker filtered the browser's profile list the same way. |
| Technical Consultants and Meta Verifiers in the picker | They are `TEAM_MEMBER`s with a flag (`is_technical_consultant`, `is_meta_verifier`); a role filter cannot tell them apart. |
| Report shows "Team Lead: Waiting (Mittal sumra)" but the history says "Opened for review (Team Lead) by Renuka Parche" | Three rules disagreed. `work_report_submit` stored the displayed lead as the **first Team Lead of the team by name** (`order by p.full_name, p.id limit 1`); the notification went to **every** Team Lead of the team; and `report_review_stage` / `is_report_reviewer` allowed **any** of them to open and decide. The second lead, who is not the first by name, opened and could decide the report. |
| A Team Lead's inbox / team box showed other leads' members | `work_reports_inbox`, `work_reports_team_box` and `team_lead_box` selected members and reports by `team_id`. |

## The model

* `profiles.manager_id` = the direct Team Lead of a Team Member. A guard trigger keeps it valid (a `TEAM_HEAD` of the member's own team); a team change clears it.
* A member added by a Team Lead is theirs at once (`provision_auth_user` sets it from the provisioning actor). A member of a team with **exactly one** active Team Lead
  belongs to that lead (backfill + resolver). A member of a team with several leads and nobody named is **unassigned**: no lead is picked for them.
* `private.direct_lead_of(member)` is the single resolver. A **named** lead who is no longer an active Team Lead of the team leaves the member unassigned (reassignment required,
  never an automatic replacement). `private.report_lead_of(report)` is the lead recorded when the report was submitted (so what is shown, notified and authorised is one person), else the author's direct lead.
* The Super Admin or the Department Head of the team (not a Team Lead) names or changes a lead with `assign_direct_lead(member, lead)`. The member's **pending** stage-1 reports move to
  the new lead (history step `REROUTED`, notification); approved or decided reports and all earlier history stay.

## What changed for users

| Place | Before | Now |
| --- | --- | --- |
| Task form "Team members" (`assign_team_task`) and delegating a task (`assign_task_to_members`) | everyone with the Team Lead's `team_id` | only the lead's own ordinary members (`my_team_members()`; no Technical Consultant, no Meta Verifier, nobody inactive). The database refuses any other id, so a crafted request fails too. The form shows loading, error and "nobody assigned yet" states. |
| Submitting a daily report | a Team Lead picked by name; all leads notified | goes to the member's own Team Lead, who alone is notified and may open, approve, reject or request a revision. A member with no resolvable lead gets the existing message "You are not assigned to a Team Lead yet". |
| Team Lead inbox / team box, Department Head and Operations Head boxes | all reports of the team | the reports and people of that lead |

## Existing data

`hierarchy_report(p_apply := false)` (Super Admin or Department Head of the team) is a **read-only impact report**: members with several leads and nobody named, and pending stage-1 reports whose recorded lead is not
the author's direct lead. `hierarchy_report(true)` corrects **only** the verifiable pending ones (a direct lead resolves) with a history step and a notification; ambiguous cases stay in the list for a head to decide with
`assign_direct_lead`. Approved, rejected and earlier reports are never changed. Nothing is moved on its own, except that members of single-lead teams get that lead as `manager_id`.

## Tests

`supabase/tests/team_lead_ownership_test.sql` (section 120): TL A / TL B on one team, members each lead added, a Technical Consultant, a Meta Verifier, a member nobody named, guessed ids, foreign and crafted requests, report routing and notifications,
inbox / team box isolation, the two-level approval, transfer, the impact report, suspension. It also caught that `head_may_manage` ignores the caller's role (a Team Lead could have called `assign_direct_lead`); the helper now checks the Department Head role itself.

## A Team Lead sees only their own members (migration 20261225000100)

**Root cause of "Team Workload" listing other leads' members.** `team_lead_dashboard()` (20261009100000) built the workload list from every
active Team Member whose `team_id` equals the lead's, and `team_lead_scope()` put every customer of that team in the lead's scope. When two or
more Team Leads share one team, each saw (and could count, filter, open tickets of, and reassign) the other lead's members and customers. The
same "same `team_id`" rule was used for a Team Lead by the row-level rules on customers, tasks and tickets, `can_view_customer`,
`can_view_profile`, the performance reports and the overview counts. `profiles.manager_id` / `private.direct_lead_of()` (20261223000100) is the
authoritative relationship but these places never used it.

**Now** every one of them also requires that the person a row belongs to (customer owner, task or ticket assignee, profile) is the lead or one
of their direct members (`private.led_by`, `private.lead_sees`). Rows that belong to nobody (an unassigned ticket of the team) stay visible to
the team's leads. A team with a single Team Lead behaves exactly as before. A member nobody is named for, in a team with several leads, is
visible to no Team Lead until the Department Head names one (`hierarchy_report()`, `assign_direct_lead`) - the Department Head always sees them.
Customers handed to a Team Lead (`customer_onboarding.team_lead_id`) stay in that lead's scope. Team Members see colleagues under the same
lead only. Ticket escalation and its notifications go to the assignee's own lead (`private.ticket_team_lead`), never "the first lead of the team".

| Who | Sees / manages |
| --- | --- |
| Team Lead | their own direct members, their customers, tickets, tasks, reports; customers handed to them |
| Team Member | their own customers, tasks, reports and leave; colleagues under the same lead (names) |
| Department Head | every team of the departments and functions they head (FUNCTION_SCOPES.md) |

**The Support desk (decision for the owner).** Since 20261009000100 every Support Team Lead and Team Member reads ALL post-sale customers of
their department; Support raises tickets for any of them this way. It is kept ON so live Support work does not break, and it now has a switch:
`POST /api/v1/access/support-desk {"departmentWide": false}` (Super Admin, audited) turns it off for strict ownership - then Support can raise
tickets only for their own (or their members') customers. `docs` and tests: `team_lead_direct_scope_test.sql` checks both settings.

## Strict isolation, part 2 (migration 20261226000100)

20261225000100 scoped the lists, reports, tasks, customers and tickets to the direct lead. These checks still allowed "anyone of the same
team" for a Team Lead and now also require the person to be the lead's own member (`private.led_by` / `lead_sees` / `direct_lead_of`):

| Area | Function / rule | Before (two leads in one team) | Now |
| --- | --- | --- | --- |
| Edit, suspend, revoke, remove, change role | `private.actor_can_manage_profile` (behind `can_manage_profile`, `delete_user`, status / role changes) | Lead A could act on Lead B's members | own members only |
| Performance page | `public.performance_people` | listed every member of the team with metrics | own members only |
| Person-owned rows, customers | `can_view_owner`, `can_access_customer`, `may_update_support_customer`, `update_support_customer`, `subscriptions_list`, `customers_insert/update/delete` | team-wide | own members' rows |
| Handing work to a person | `can_assign_ticket_to`, `can_assign_customer_owner` | any member of the team | self or own members |
| Invoice requests, audit log | `invoice_requests_select`, `audit_logs_select` | team-wide | own members' lines (a line about a person: only own members) |
| Notifications | `broadcast_announcement`, `create_support_ticket`, `create_support_customer`, `update_support_ticket`, `request_invoice`, `report_audience`, `hr_reporting_manager` | every lead of the team | the person's own lead (all leads only for an unassigned ticket) |
| Assigning a member to a lead | `assign_member_to_team_lead` ("Assign to Team Lead") | moved the team only; refused a second lead of the same team; a team with two leads left the member with none | names the lead (same team or another); pending stage-1 reports move with the member; history in `team_assignments` + audit |
| Department Head directory, leaderboard | `department_employee_directory`, `private.person_score_rows` | "first lead of the team by name" | the member's own lead; a member with no lead shows "Awaiting a Team Lead" |

The Team Lead's Team Members screen lists Team Members only (not the other Team Lead of a shared team), the role filter offers only Team
Member, and an empty list says "No Team Members are currently assigned to your team." Department Head, Operations Head and Super Admin are
unchanged. A team with a single Team Lead behaves exactly as before. Tests: `team_lead_strict_isolation_test.sql` and the
"Strict Team Lead isolation through the API" block of `api_integration.test.ts`.

**Existing data.** Nothing is moved or guessed. To list the active Team Members who have no Team Lead, run this read-only query in the Supabase
SQL editor. "0 active leads" means the team has no Team Lead at all (the Department Head manages them); "2 active leads" means somebody must
choose: assign each such member with "Assign to Team Lead" (Team Members → Employee Directory). Until then they are visible to the Department
Head and Super Admin and to no Team Lead.

```sql
select d.name as department, t.name as team, m.full_name as member, m.email,
       case when m.manager_id is null then 'NO TEAM LEAD NAMED (team has ' || (select count(*) from public.profiles l where l.team_id = m.team_id and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE') || ' active leads)'
            else 'NAMED LEAD IS NO LONGER AN ACTIVE LEAD OF THIS TEAM' end as problem
  from public.profiles m
  join public.teams t on t.id = m.team_id
  join public.departments d on d.id = m.department_id
 where m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE' and not t.is_pool
   and private.direct_lead_of(m.id) is null
 order by d.name, t.name, m.full_name;
```

## Skip a level when someone is away, and Support customers per Team Lead (migration `20270114000100`)

**Tasks.** The chain is still Operations Head → Department Head → Team Lead → Team Member, but the person in the middle may be absent:

| Who | May now give a task straight to | Never to |
|---|---|---|
| Department Head | any active Team Lead **or ordinary Team Member** of the teams they head (their department and function, `private.head_covers`) | another function's or department's people |
| Operations Head | Department Heads (as before) **and** active Team Leads / Team Members of the departments and functions they manage (`private.scopes_of`) | anyone outside that scope |
| Super Admin | any active Team Lead / Team Member | |
| Team Lead | their **own** Team Members only (unchanged) | another Team Lead's members, even in the same team |

`task_direct_assignees()` feeds the picker (Team Leads, then Team Members with their own Team Lead); `assign_task_direct(assignee, title, details,
priority, due)` gives the task, checked in the database (`private.can_task_directly`). Technical Consultants and Meta Verifiers are never offered.
The task is an ordinary top-level task assigned by the head: it shows in the head's Assign list (and the Operations Head's `operations_tasks()`),
in the receiver's tasks, and to the receiver's own Team Lead, who is also notified ("X gave Y a task"); the other Team Lead of a shared team is not.
A Team Lead who receives one can work on it or share it with their own members. Reports keep going to each member's own Team Lead.
Screens: Department Head → Assign ("Assign to": Team Leads / Team Members), Operations Head → Assign ("A Department Head" or "A Team Lead or Team
Member"). Before the migration is run the screens show the old one-level choices.

**Support customers.** Two Team Leads can share one team (Wabastore "Support"). The department-wide Support desk rule
(`customers_select_support`, `private.can_access_customer`) let every Support Team Lead and Team Member read **every** customer of the department, so
one Team Lead saw the other's customers. The migration switches that setting off (`access_settings.support_desk_department_wide = false`, only if no
Super Admin has set it by hand): a Support Team Lead now sees their own and their own members' customers, a Team Member their own, the Department
Head / Operations Head / Super Admin everything in scope. Tickets can be raised for the customers a person sees. To go back:
`select public.set_support_desk_department_wide(true);` as the Super Admin (audited), or `POST /api/v1/access/support-desk {"departmentWide": true}`.
Tests: `supabase/tests/task_skip_level_test.sql`.
