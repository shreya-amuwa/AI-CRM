# Amuwa Design Studio and AI Design Studio: two active departments, three roles each

| Department | Slug | Dashboards | Super Admin workspace |
| --- | --- | --- | --- |
| **Amuwa Design Studio** | `designstudio` | the existing Department Head, Team Lead and Team Member dashboards of the CRM | yes (Departments page) |
| **AI Design Studio** | `ai-design-studio` | its own dashboard: clients, notices, assignments, daily reports, issues (see [AI_DESIGN_STUDIO.md](AI_DESIGN_STUDIO.md)) | no |

Both are normal, **active** departments with the hierarchy **Department Head -> Team Lead -> Team Member**, and neither has anything Sales or
Support for new people: no Sales / Support team, role, side or Access Control function. They are separate from AI Studio (slug `ai-studio`),
Sales, Support, HR and Accounts. Nobody is moved between departments.

## History: why "(Retired)" was removed

Migration `20270112000200_amuwa_design_studio_rename.sql` renamed the department that holds the Design Studio people (`designstudio`) to
"Amuwa Design Studio (Retired)" and the Add Team Member form refused to add anyone to it. **Only the name and that form check said so**: the
database never locked or deactivated the department (`is_locked` untouched), and `POST /users` accepted new people there. Migration
`20270118000100_amuwa_design_studio_restore.sql` gives `ai-design-studio` its own name "AI Design Studio" (department names are unique) and
restores "Amuwa Design Studio" for `designstudio`; the form check, its warning and the helper behind it are removed. No profile, team,
customer, service, assignment, report, attendance record or audit entry is moved, changed or deleted, and no password is reset. The migration
also adds a General team to Amuwa Design Studio if it has none (new people are placed in it; the Sales / Support teams the existing people
are in stay).

## What the forms offer

**Super Admin -> Add Team Member** (and the Department Head / Team Lead forms that share it):

| Department chosen | Role | Sub-department / Team | Department Head side | Designation |
| --- | --- | --- | --- | --- |
| Amuwa Design Studio | Department Head, Team Lead, Team Member | its General team | none | Department Head, Team Lead, Team Member |
| AI Design Studio | Department Head, Team Lead, Team Member | its General team | none | Department Head, Team Lead, Team Member |
| Any other department | unchanged | unchanged | unchanged | unchanged |

* Choosing a department refreshes the Role and Team lists at once. A choice the new department does not have (a Support role, a Sales or
  Support team, a Sales role such as Telecaller or Business Associate) is cleared, never carried over.
* **HR -> New employee request**: Amuwa Design Studio and AI Design Studio offer Department Head, Team Lead, Team Member and the General side only.

## What the database enforces

Migrations `20270112000100_designstudio_department_roles.sql`, `20270112000200_amuwa_design_studio_rename.sql` and `20270118000100_amuwa_design_studio_restore.sql`, for both departments:

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
