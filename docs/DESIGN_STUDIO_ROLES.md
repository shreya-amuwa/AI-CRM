# Amuwa Design Studio: one department, three roles

There is **one** Amuwa Design Studio: the department built as "AI Design Studio" (slug `ai-design-studio`, see
[AI_DESIGN_STUDIO.md](AI_DESIGN_STUDIO.md)), renamed by migration `20270112000200_amuwa_design_studio_rename.sql`. It keeps all of its
features: the Department Head, Team Lead and Team Member dashboards (clients, client notices, assignments, daily reports, issues), the
reporting hierarchy **Department Head -> Team Lead -> Team Member**, and its one General team. It has nothing Sales or Support: no Sales /
Support team, role, dashboard, side or Access Control function.

The old department that had this name (slug `designstudio`) is **retired**: it is now called "Amuwa Design Studio (Retired)".
Nothing in it is moved, locked or deleted. Its people keep signing in to their existing dashboards, and the services it delivers keep it as
their delivery department until the Super Admin changes that in the service settings. The add forms no longer offer it for new people.

## What the forms offer

**Super Admin -> Add Team Member** (and the Department Head / Team Lead forms that share it):

| Department chosen | Role | Sub-department / Team | Department Head side | Designation |
| --- | --- | --- | --- | --- |
| Amuwa Design Studio | Department Head, Team Lead, Team Member | its General team | none | Department Head, Team Lead, Team Member |
| Amuwa Design Studio (Retired) | (shown, but Create is disabled: "this department is retired") | | | |
| Any other department | unchanged | unchanged | unchanged | unchanged |

* Choosing a department refreshes the Role and Team lists at once. A choice the new department does not have (a Support role, a Sales or
  Support team, a Sales role such as Telecaller or Business Associate) is cleared, never carried over.
* **HR -> New employee request**: Amuwa Design Studio offers Department Head, Team Lead, Team Member and the General side only; the retired
  department is not listed.

## What the database enforces

Migrations `20270112000100_designstudio_department_roles.sql` and `20270112000200_amuwa_design_studio_rename.sql`, for both departments:

* `private.designstudio_role_problem(...)`: nobody is placed in a Sales or Support team, given a Sales role, or made a Sales / Support
  Department Head. It is used by `public.assert_can_create_user` (`POST /users` answers `VALIDATION_ERROR: Amuwa Design Studio has no Sales or
  Support roles. ...` before any login exists), by `private.check_employee_submission` (HR requests) and by the trigger
  `profiles_designstudio_roles` on `public.profiles` (every other path: provisioning, `PATCH /users/:id`, a team move).
* `private.department_access_problem`: Access Control cannot give a Department Head the Sales or Support function of either department.
  The grants already given were withdrawn by the migration, each one written to the audit log as `DEPARTMENT_ACCESS_REVOKED`.
* Existing people are not changed: the trigger checks a person only when they are created or their department, team, role, side or Sales role
  changes. No team, profile or customer is deleted.

## Tests

`supabase/tests/designstudio_roles_test.sql` (database), `supabase/tests/designstudio_roles.test.ts` (unit),
`supabase/tests/ui_designstudio_roles.test.mjs` (browser) and the "Amuwa Design Studio" block of `supabase/tests/api_integration.test.ts`.
