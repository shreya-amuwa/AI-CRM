# Amuwa Design Studio roles

Amuwa Design Studio (slug `designstudio`) has one hierarchy: **Department Head -> Team Lead -> Team Member**. It has no Sales or
Support roles. (It is a different department from AI Design Studio, slug `ai-design-studio`.)

## What the forms offer

**Super Admin -> Add Team Member** (and the Department Head's / Team Lead's own Add Team Member, which use the same form):

| Department chosen | Role | Sub-department / Team | Department Head side | Designation |
| --- | --- | --- | --- | --- |
| Amuwa Design Studio | Department Head, Team Lead, Team Member | its General team only | none (the head of the whole department) | Department Head, Team Lead, Team Member |
| Any other department | unchanged (incl. Technical Consultant, Meta Verifier, Operations Head) | unchanged (Sales / Support / General teams) | unchanged (Sales / Support / both) | unchanged |

* Choosing a department refreshes the Role and Team lists at once. A choice the new department does not have (a Support role, a Sales
  or Support team, a Sales role such as Telecaller or Business Associate) is cleared, never carried over.
* In the Department Head "departments and function" picker of other departments, Amuwa Design Studio cannot be ticked as a Sales or
  Support department.
* **HR -> New employee request**: for Amuwa Design Studio the Designation list is Department Head, Team Lead, Team Member and the Side
  list offers only General.

The new member is saved in Amuwa Design Studio, in its General team (Team Lead / Team Member) or as its Department Head (no side).

## What the database enforces

Migration `20270112000100_designstudio_department_roles.sql`. The forms are only a convenience; every path is checked in the database:

* `private.designstudio_role_problem(...)`: the one rule. In Amuwa Design Studio a person can never be placed in a Sales or Support team,
  given a Sales role, or be a Sales / Support Department Head.
* `public.assert_can_create_user`: the API's check before an account is made (`POST /users`) answers
  `VALIDATION_ERROR: Amuwa Design Studio has no Sales or Support roles. ...` and no login is created.
* `private.check_employee_submission`: an HR employee request for the Sales or Support side of Amuwa Design Studio is refused.
* Trigger `profiles_designstudio_roles` on `public.profiles`: no profile row is written with such a combination, whatever the path
  (provisioning, `PATCH /users/:id`, a team move, a Sales role).

Existing rows are not changed or deleted. The trigger checks a person only when they are created or their department, team, role, side
or Sales role changes, so an existing person can still be suspended, restored or edited. The department's Sales and Support teams are kept
(the Access Control matrix of the combined Department Heads still uses them); people just cannot be placed in them any more.

## Tests

* `supabase/tests/designstudio_roles_test.sql` (database), `supabase/tests/designstudio_roles.test.ts` (unit: the form options),
  and the "Amuwa Design Studio" block of `supabase/tests/api_integration.test.ts`.
