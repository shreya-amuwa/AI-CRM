# HR: attendance timing, employee details, leave approval, monthly totals, notifications

Migration: `supabase/migrations/20261027000100_hr_attendance_leave_workflow.sql` (additive, safe to rerun in the Supabase SQL editor).

## Attendance: RM login vs biometric punch
* `attendance_records` holds one row per employee and **office day** (India time): the first CRM ("RM system") login and the first biometric punch.
* RM login is recorded when the employee signs in or opens the CRM (once a day). Biometric punches come from the device gateway:
  `POST /api/v1/integrations/biometric/punch` with `Authorization: Bearer <BIOMETRIC_INGEST_SECRET>` and
  `{"email":"person@company.com","punchedAt":"2026-10-16T09:08:00+05:30"}`. The first punch of the day counts; unknown / inactive e-mails get 404.
  HR can also add or correct a punch by hand (**Log Clock-In**).
* HR Dashboard -> Attendance Management shows RM login, biometric punch and **Time Difference** for the chosen date.
  The difference is computed in the database in whole minutes (both times cut to the minute, so midnight and seconds are handled and the
  number always agrees with the rule): **15 min or less** = quiet blue badge with a clock; **more than 15** = red badge with a warning icon
  and a text alternative; **either time missing** = grey `N/A`.
* A difference above 15 minutes notifies the HR department once per employee and day.

## HR logins (ID and password)
Like Accounts, the Super Admin creates HR logins: open the **HR Department** panel -> **Add Member**, choose the role (Department Head,
Team Lead or Team Member) and the team, set the e-mail (the login ID) and a password. Everyone created in the HR department signs in
and lands on the **same HR dashboard** (attendance, HR & Operations, offer letters, leave). Their role still decides what they can do:
the Department Head also gets Add Member, Access Control and Client Notices; a Team Lead gets Add Member and Access Control (team
members only); a Team Member gets the dashboard without those pages. The API and database enforce the same limits.

## HR side panel
Dashboard, **Add Member**, **Access Control**, **HR & Operations**, **Client Notices**, Notification Center. Add Member (create an account) and Access Control (roles, suspend, restore, remove) are separate pages; Client Notices moved out of the header into the side panel under HR & Operations.

**HR & Operations** shows a simple staff directory: a search box, one status filter, and department cards; opening a department lists its people (name, designation, status, and this month's leave when there is any). Everything else (salary, documents, leave history, personal details, "Make permanent employee", "Mark as left") is in the person's profile.

## Add Member
HR Dashboard -> Add Member. New required fields: designation (Department Head / Team Lead / Team Member), joining date, date of birth,
blood group, emergency contact. Department is shown from the department database. The **role** (access) and **designation** stay separate.
They are stored in `employee_personal_details`, readable only by the employee, HR staff and the Super Admin (`hr_personal_details()` /
`my_personal_details()`), and appear in the employee profile in HR & Operations. Invalid details create no account. Existing members are untouched.

## Leave: Team Member -> Department Head -> HR
* **Leave** in the header (every dashboard): request leave, follow it, and (Department Heads / HR) approve or reject what waits for you.
* `PENDING_DEPARTMENT_HEAD` -> head of the employee's department approves -> `PENDING_HR` -> HR gives the final approval -> `APPROVED`.
  A rejection at either step needs a reason and ends the request. Who, when and the note are stored on the request.
* Enforced in the database: nobody decides their own leave; HR cannot decide before the Department Head; a request cannot be decided twice; the
  Department Head of another department cannot decide; the HR approver must differ from the Department Head who reviewed. A Department Head's
  own leave (or a department with no active head) is reviewed by the Super Admin.
* Only approved leave counts in summaries.

## Monthly Half-Days & Leaves
A month selector sits above the Half-Days & Leaves column in HR & Operations (HR dashboard and the Amuwa HQ Operations view).
Approved leave: a full-day leave counts the days of its range that fall in the month (Sundays, the weekly off, are not counted); a half day
counts once. HR and the Super Admin see everyone; a Department Head sees their department (`leave_monthly_summary()`).
Employee records that have no CRM account (the Amuwa HQ demo roster is kept in the browser) use their own leave records dated in the month.

## Notifications
The bell with a side panel is in the shared header (HR, Super Admin, Department Heads, Consultants) next to the existing bells. Events: leave
awaiting Department Head, forwarded to HR, decided (employee, Department Head), attendance discrepancy, new team member. Each event notifies a
person once (`data.dedupeKey`); you are never notified of your own action. Rows are private to the recipient.
