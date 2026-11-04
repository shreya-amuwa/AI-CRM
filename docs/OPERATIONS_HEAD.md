# Operations Head: creation and several departments on one account

Migration: `supabase/migrations/20261218000100_operations_head_creation.sql` (re-runnable; nothing is deleted or rewritten).

Hierarchy: Super Admin > Operations Head > Department Head > Team Lead > Team Member. Team Members report to their Team Lead, Team Leads to their Department Head, Department Heads to the Operations Head accountable for their department (`department_operations_owner`), Operations Heads to the Super Admin. The Operations Head is **not** a Department Head: it is a `DEPARTMENT_HEAD`-class profile with `profiles.is_operations_head = true` (so every existing role rule keeps working) that supervises departments instead of being the head of one.

## The creation error, and its root cause

> "Wabastore already has a Support Department Head (...). A department can have only one for each side."

The form, the API and the database all treated a new Operations Head as a **Department Head first** and only set the flag afterwards (`set_operations_head`, a second call):

1. the form (`StaffManagementPanel`) mapped *Operations Head* to the role `DEPARTMENT_HEAD`, computed the "existing head of this side" for it and showed the warning and disabled the button;
2. `UserService.create` called `assert_can_create_user('DEPARTMENT_HEAD', home department, side)`, which applies the one-head-per-department-and-side rule;
3. the profile `INSERT` fired `tg_profiles_one_department_head` - again before the flag existed;
4. `department_head_of()` also counted an Operations Head as the head of its home department, so Operations Heads and Department Heads could block each other.

## What changed

* `department_head_of()` ignores Operations Heads; `tg_profiles_one_department_head` skips them (and checks again when someone stops being one). **The rule for Department Heads is unchanged** (still refused: a second head of a department / side).
* `provision_auth_user` creates the profile **as an Operations Head from the start** when the Super Admin asks (`provisioned_operations_head` in the service-only app metadata; anyone else is refused). `assert_can_create_operations_head` is the form's check (Super Admin only, no Department Head uniqueness).
* **Many-to-many**: `operations_head_departments (profile_id, department_id, granted_by, created_at, updated_at)`, primary key `(profile_id, department_id)` (no duplicates), foreign keys with cascade, no direct access. It is read by `private.my_scopes()` / `private.scopes_of()` as *whole departments*, so the dashboard, RLS and the active-department switch follow it, for **any** department (also Accounts or HR, which have only a General team). The older `(department, function)` pairs keep working.
* `operations_head_assign_new` (create form) and `operations_head_scope_set` (Super Admin, *Operations Heads*) write that table. A department nobody was accountable for becomes the new head's; one that already has an accountable Operations Head keeps it. Adding or removing a department needs no new account; removing one takes the access away at once and deletes nothing (the department, its Department Head, people and records stay). At least one department is required; the person's home department stays among the assigned ones (HR opens its own hub without an Operations Dashboard, so a new Operations Head is placed in the first assigned department that is not HR).
* Suspending (`POST /users/:id/status`) removes the scope and blocks sign-in; reactivating gives the same departments back.

## The form

*Team Members > Add Team Member > Operations Head*: name, e-mail (the sign-in; the "Username" of the form is the full name), password, contact numbers, joining date, date of birth, blood group, position, and a **multi-select of departments** (checkboxes, the selection is listed under it). No Sales/Support function, no Department Head warning. "Will open: Operations Head Dashboard". The request is `POST /users` with `operationsHead: true` and `departmentIds: [...]` (an older client that sends one department with `additionalAccess` pairs keeps working).

## The dashboard

*Operations Dashboard* shows only the assigned departments, side by side, with a **Department filter** ("All my departments (consolidated)" or one department, which narrows the totals and opens its management view): Department Heads, Team Leads / Members, work waiting, Department Head activity and approvals. Reports from Department Heads, performance and notifications are in the same sidebar (*Reports*, *Top Performers & Rankings*, *Notification Center*).

## Permissions (database, not the screen)

Super Admin: everything (creates, edits departments, suspends/reactivates, sees activity). Operations Head: only assigned departments; cannot change their own or anyone's departments, create or promote an Operations Head, or create a Department Head. Department Head / Team Lead / Team Member: unchanged.

## Tests

`supabase/tests/operations_head_creation_test.sql`, `api_integration.test.ts` ("Operations Head: created from the Super Admin form..."), `supabase/tests/e2e/run-operations-head.sh` (the scenario of the task in a real browser).

## Sales / Support function and several departments (migration 20261224000100)

An Operations Head's departments now follow their function (Sales, Support or both), and a Department Head may be given another department's function when nobody heads it. See [FUNCTION_SCOPES.md](FUNCTION_SCOPES.md).
