# Department x function scopes: Sales / Support Operations Heads, Department Heads in several departments

Migration: `supabase/migrations/20261224000100_department_function_scopes.sql` (run after `20261223000400`; safe to run twice; nothing is deleted
and no live assignment is changed by it). Tests: `supabase/tests/department_function_scopes_test.sql` (66 checks), the API block
"Department x function scopes and company-readable internal chat" in `api_integration.test.ts`, `ui_access_control.test.mjs`.

## Root causes

| Symptom | Confirmed cause |
| --- | --- |
| A **Support** Operations Head (production: the person shown with "No side set" under Wabastore) could read **Sales** data | An Operations Head's departments are rows of `operations_head_departments`, and `private.my_scopes()` / `scopes_of()` returned each one as a whole department (`division` NULL). The person's own function (`profiles.head_division`, the "No side set / Sales / Support" choice) was never applied to those rows, and the home department was added a second time with the same NULL. NULL means "every team", so `active_head_division`, `sales_scope_team` (the RLS filter on customers, tasks, profiles...), `head_may_manage` and the Operations dashboard did not narrow anything. Choosing "Support" in the member list had no effect. |
| A Department Head could not be given a second department ("Only an Operations Head works in several departments") | `20261205000100` made another department an Operations-Head-only grant: a trigger refused the `department_access` row, `my_scopes()` ignored such rows, and the Access Control screen disabled the cells. |
| A one-side Department Head could give a task to the other side's Team Lead | `assign_task_to_team_lead` checked the department, not the function. |

## The model (one source of truth per kind of person)

| Person | Stored in | Function |
| --- | --- | --- |
| Department Head, home department | `profiles.department_id` + `profiles.head_division` | the side (NULL = both sides of the home department) |
| Department Head, another department / function | `department_access (profile, department, division)` | the division of the row |
| Operations Head | `operations_head_departments (profile, department[, division])` | `coalesce(row division, profiles.head_division)`: SALES = Sales Operations Head, SUPPORT = Support Operations Head, NULL = both |

`private.scopes_of(person)` is the only place that turns these into `(department, function)` pairs, and every rule reads it: the active-scope header
switch, RLS, assignment, approvals, reports. A facet department (Wabatalk = D Talk Support) is always its base department's Support side.

### Resulting access matrix

| | Sales data of an assigned department | Support data of an assigned department | Not-assigned department |
| --- | --- | --- | --- |
| Sales Operations Head | yes | **no** | no |
| Support Operations Head | **no** | yes | no |
| Sales & Support Operations Head | yes | yes (a department can be narrowed to one side) | no |
| Department Head, home department | their side (both if no side) | their side (both if no side) | - |
| Department Head, granted department/function (e.g. D Talk Support) | only if granted | only if granted | no |

A Department Head with a second department stays a Department Head: no Operations Head flag, no Operations pages, no second account, no move.

## What enforces it

* **Data**: `scopes_of` / `my_scopes` (above). The header-based department switch already used them, so customers, tickets, tasks, people and
  RLS follow the function automatically. The Operations dashboard, department view, activity, reports board and department reports now
  count only the authorised function (`operations_dashboard`, `operations_department_detail`, `operations_department_activity`,
  `work_reports_operations`, `work_reports_operations_department`).
* **Two heads for one department/function are refused**: `department_access` trigger: a grant to a plain Department Head is refused with
  `CONFLICT: <Department> already has a <Sales|Support> Department Head (<name>)` when another active or suspended Department Head holds that
  department and function (placed there, or granted it). Nobody is overwritten or revoked; existing rows are never re-checked; saving the same
  grant again is fine.
* **Approvals of Department Heads follow department AND function**: `department_function_owner (department, division, operations_head)` names
  the Operations Head accountable for one side. `private.operations_owner_for(department, function)` uses it, else the department-level owner
  (`department_operations_owner`) **only if that owner covers the function**. A request whose owner does not cover it waits for the Super Admin
  (who can always decide). Nothing is moved silently; naming a side owner moves that side's waiting requests to them, audited
  (`DEPARTMENT_FUNCTION_OWNER_SET`). Past approvals keep their approver.
* **Team Lead / Team Member requests** are routed to the Department Head placed in the department first, else to one granted that department
  and function; a Department Head decides only in a department and function they are authorised for (`can_decide_employee_request`). Operations
  Heads keep their previous rule there.
* **Team Lead reports** are reviewed by a Department Head authorised for that department and team function (`head_covers` uses the scopes).
* **Directory / placing members**: `department_employee_directory` and `assign_member_to_team_lead` work in the department the head has open
  (the header switch), with that scope's function.
* **Tasks**: `assign_task_to_team_lead` also requires the Team Lead's team to be of the head's active function.

## Super Admin screens

* **Team Member Management > Operations Heads > Edit departments**: *Operations function* (Support / Sales / Sales & Support), the departments,
  for a Sales & Support head an optional narrower side per department, and *approves heads* (per side for a one-function head). One save, one
  transaction (`POST /operations/heads/:id/function-scope` -> `operations_head_scope_apply`), audited (`OPERATIONS_FUNCTION_SET`,
  `OPERATIONS_FUNCTION_SCOPE_SET`, `OPERATIONS_SCOPE_SET`). On a database without the migration the screen keeps the old departments-only save.
* **Team Member Management > Access Control**: any department and function can be ticked for a Department Head; the database refuses a
  department/function that already has a head and the screen shows the reason. The "only an Operations Head works in several departments"
  restriction is gone from the screen and from the database.
* **Impact report** (read only, Super Admin): `GET /operations/function-scope-review` (`function_scope_review()`), and the SQL file
  `supabase/maintenance/review_function_scopes.sql` (per e-mail placeholder: scopes, where they come from, approvals, and whether another head
  already holds a department/function).

## Correcting the two accounts in the brief (administrator-reviewed, not automatic)

Nothing in the migration changes a person's access. After it is run, the Super Admin:
1. runs block 1 of `review_function_scopes.sql` with the Support Operations Head's e-mail and confirms the departments listed are the ones she
   should supervise;
2. opens *Operations Heads > Edit departments* for her, chooses **Support Operations Head**, keeps the departments, saves. Every department is
   then Support only (check again with block 1: every row says SUPPORT). Her Sales "approves heads" responsibility, if any, stops covering Sales
   requests - they wait for the Super Admin until a Sales Operations Head is named for that side;
3. runs block 2 with the Whatsbox Department Head's e-mail, `wabatalk` and `SUPPORT`. If nobody is returned as `current_head`, opens
   *Access Control*, chooses her, ticks **Wabatalk - Support**, saves. If somebody is returned, the Super Admin decides first who heads D Talk
   Support (the save is refused while two would hold it). Her Whatsbox access is not touched; D Talk Sales is never given.

## Rollback

All changes are additive. To roll back the behaviour without touching data: re-run `20261218000100_operations_head_creation.sql`,
`20261205000100_operations_head.sql` (old trigger), `20261211000100_employee_approval_hierarchy.sql` (old routing),
`20261213000100_work_reports.sql` / `20261217000100` / `20261221000200` (old report functions) and `20261123000100` (old task assignment) in that
order, then reload the schema. The new column / table stay and are ignored. Forward recovery: run `20261224000100` again.

## Known limits

* A Department Head's **own weekly report** (kind DEPARTMENT_HEAD) is still routed to the department-level accountable Operations Head
  (`report_reviewer_ids` does not know the author's side). Name the department owner so it covers the department, or set a side owner; a split
  per side needs the report row to carry the author's side.
* Department Head report inboxes and the weekly package still use the head's **home** department; a Department Head reviews a granted
  department's Team Lead reports through `head_covers`, but the inbox count for a granted department is not shown separately yet.
* Supabase Realtime evaluates RLS without request headers, so live push for a non-home scope is not delivered (as documented in
  `DEPARTMENT_SCOPES.md`); every switch refetches.
