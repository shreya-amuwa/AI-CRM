# Department HR: HR (Digitree)

An HR member whose whole HR scope is **one business department**. The first one is **HR (Digitree)**. Migration:
`supabase/migrations/20270223000100_department_hr_and_confirmation_email.sql` (safe to run again).

## Who sees what

| User | Digitree HR data | Other departments' HR data |
| --- | --- | --- |
| HR (Digitree) | Yes: employees, personal details, probation confirmations | **No** |
| Existing HR members (HR Assistants, the HR Admin Head, e.g. Payal Chinchghare) | Yes (unchanged: company-wide HR already includes Digitree) | Yes, unchanged |
| Super Admin | Yes | Yes |

* Payal's account needed **no data change**: as an HR department member she is company-wide HR staff (`private.is_hr_staff()`), which already
  covers Digitree. Nothing was granted to, or taken from, any other HR member.
* HR (Digitree) does **not** inherit that company-wide access.

## How it is stored (no new role system, no second HR table)

* `profiles.role = TEAM_MEMBER`, placed **in the Digitree department**, in its General team **Digitree HR** (created by the migration).
* `employee_personal_details.designation = 'Department HR'` sets `profiles.hr_sub_role = 'HR_DEPARTMENT'` and `default_dashboard = 'hr-department'`.
* The department the person is placed in **is** their HR scope (`private.department_hr_scope()`); there is nothing else to keep in step.
* Because they are not in the HR department, every existing HR gate keeps refusing them (`is_hr_staff()` and the functions that check the HR department
  directly): leave, attendance, documents, recruitment, reviews, e-mail history, paid leave and every company-wide report or export stay closed.
* Only these functions were opened to them, each filtered **in the database** to their department: `hr_employee_directory`, `hr_personal_details`,
  `hr_probation_list`, `hr_probation_get`, `hr_confirm_probation`, `hr_dismiss_probation`, `hr_probation_retry_email`, `hr_probation_remind_overdue`
  (and `hr_confirmation_effective_date_set` through `can_confirm_probation`). An id of another department's record is refused; department headers
  (`X-Active-Department`) only ever apply to Department Heads and grant nothing; the person is not a Department Head, so there is no switcher.

## Creating one (Super Admin only)

Department Hub > Add Team Member > *Show members of*: **HR Department** > *Role / Designation*: **HR (Digitree)**. The form places the person in the
Digitree HR team; "Will open" says *HR (Digitree) dashboard (this department only)*. The server refuses anyone but the Super Admin
(`UserService.create`), and so does the database (`assert_designation_allowed`, the designation trigger). An HR employee request cannot ask for it.
Moving a Department HR member to another department is Super Admin only (their department is their scope).

## The dashboard

`/hr-department/dashboard/:id` (`src/components/hr/DepartmentHrDashboard.tsx`): **Employees** (Digitree's people) and **Probation Confirmations**
(the same page the HR dashboard uses), plus Notifications, Attendance and Leave like every dashboard. Any other URL sends them back to it
(`validateRouteAccess`).

Not in this first version (they stay closed in the database rather than open company-wide): editing HR records, leave approvals, attendance
registers, documents and reviews for Digitree. Each can be opened later by filtering that function by `private.department_hr_scope()` the same way.

## Adding another department later

Add an entry to `DEPARTMENT_HR_OPTIONS` in `shared/validation.ts` and create that department's General HR team (as the migration does for Digitree).
No database function changes: the rules are written for any business department.

## Tests

`supabase/tests/department_hr_test.sql` (scope, permission-denied cases, header manipulation, creation rules, confirmation flow),
`supabase/tests/api_integration.test.ts` (Department HR block), `supabase/tests/department_hr.test.ts` (unit: routing and rules),
`supabase/tests/ui_hr_designations.test.mjs` (the form).
