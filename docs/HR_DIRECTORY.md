# HR dashboard - employee directory

The HR dashboard lists real people from the database. Nothing is seeded in the browser.

## Where the data comes from
- `public.profiles` - every CRM account (role, status, department, team, approval). Created by the Super Admin or any manager, approved by the Super Admin.
- `public.hr_employees` - the HR-only record (salary, employment type, documents collected, left date). `profile_id` links it to the account, so one person is one row. HR can also add a record for someone without a CRM login (`source = hr_record`).
- `public.hr_employee_directory()` merges both in one call and returns the department list (head + active member count). It is limited to Super Admin and ACTIVE HR-department members (`private.is_hr_staff()`), the same rule that protects `hr_employees`.

## What HR sees
- **All Staff / Full Employees / In-Training / Interns** - approved members and HR records.
- **Left / Inactive** - HR status "Left", or an account that is suspended / revoked.
- **Pending Approval** - accounts waiting for the Super Admin.
- Rejected accounts and Super Admin accounts are not listed.
- Columns: name, e-mail, employee ID (the HR ID, or `EMP-` + the first 8 characters of the account id when no HR record exists yet), designation, department, role, team, team lead, department head, approval and account status, joining date.

## Refresh
The screen re-reads the directory when `profiles` / `hr_employees` change (realtime), when the browser tab regains focus, and every 30 seconds. HR actions (convert, left, documents, profile edits) are written to `hr_employees`.

## Deploy
Run `supabase/migrations/20261013000100_hr_employee_directory.sql` in the Supabase SQL editor as one file. It is idempotent and keeps existing HR rows (rows whose e-mail matches an account are linked automatically).
