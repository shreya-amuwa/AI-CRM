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

**From the Super Admin hub:** **Add Team Member** -> Department **HR Department** -> role Department Head / Team Lead / Team Member ->
name, e-mail (the login ID), password (the key icon generates a strong one) and the employee details -> **Create Account**. The account is
a real Supabase Auth login, active at once, in the HR department with that role, and linked to its HR employee record
(`hr_employees.profile_id`, created by migration `20261103000100_hr_members_employee_record.sql` for every way an HR account is made: this
form, the API and `npm run create:hr-login`). For HR accounts the Super Admin sees the initial password once on the confirmation card (hidden
until "show", copyable, never stored or logged) to hand over privately. A second Department Head, or an e-mail that already has a login, is
refused with a clear message. The new person signs in at the normal login page and lands on the HR dashboard.

**Create the first HR login from a terminal** (the same HR dashboard, behind its own sign-in):

```
SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service key> \
npm run create:hr-login -- --email hr@yourcompany.com --name "HR Manager" --super-admin <super admin e-mail> --generate
```
It creates the HR Department Head (use `--role TEAM_HEAD` or `TEAM_MEMBER` for an HR lead / member; a department can have only one head)
exactly as Add Member does, and prints the login ID and a generated password once. Without `--generate` the password is typed without echo
(or taken from `HR_LOGIN_PASSWORD`); it is never stored or put on the command line.

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

## Leave in the reporting chain (migration 20261225000200)

New requests follow the requester's reporting line, one step at a time, then HR:

| Requester | Steps |
| --- | --- |
| Team Member | Team Lead -> Department Head -> Operations Head -> HR |
| Team Lead | Department Head -> Operations Head -> HR |
| Department Head | Operations Head -> HR |
| Operations Head | Super Admin -> HR |
| Super Admin / others | HR |

* **Who decides each step** is resolved from the live hierarchy when it is acted on: the member's direct Team Lead (`direct_lead_of`); a
  Department Head of that department AND the member's function (`head_covers`); the Operations Head accountable for that department and function
  (`operations_owner_for`); HR staff who did not decide an earlier step. A reassignment or a departure moves the waiting step automatically.
* **Nobody to decide** (e.g. a member with no named lead, a department nobody supervises): the Super Admin decides that step (recorded as an
  exception in the timeline). A step is never skipped or approved by itself.
* **Statuses**: `PENDING_TEAM_LEAD`, `PENDING_DEPARTMENT_HEAD`, `PENDING_OPERATIONS_HEAD`, `PENDING_HR`, `APPROVED`, `REJECTED_BY_<STEP>`,
  `REVISION_REQUIRED` (sent back: the employee changes the reason and it starts again). A rejection or sending back needs a reason.
* **Enforced in the database** (`decide_leave`): only the current approver of the waiting step, in order, once (the row is locked: a double
  click or two approvers at once cannot both act); nobody decides their own leave; nothing can be written to the table directly.
* **Timeline**: `leave_request_events` - every submission, approval, rejection and send-back with who, when and the note.
* **Balance**: there is no separate balance table; summaries count APPROVED requests only, so a request counts once, when HR approves it.
* **Queues**: "Leave" in the header shows "To review" to anyone who decides a step now; `leave_monthly_summary` also serves a Team Lead
  (their members) and an Operations Head (their departments and function).
* **Existing requests** keep the rules they were made under (Department Head -> HR); no new step is marked as done.
* **Switch back** (Super Admin): `POST /api/v1/leave/workflow {"workflow": "TWO_STEP"}` - new requests then go Department Head -> HR again.
* **Offboarding**: the impact summary counts the leave steps the person decides now (`leaveApprovalsWaiting`).

## Leave chain by requester (migration 20261228000100)

New requests (`workflow_version` 3) follow the chain of the person who asks. It replaces the table above for new requests:

| Requester | Steps |
| --- | --- |
| Team Member | Team Lead -> Department Head -> Operations Head -> HR |
| Meta Verifier | Department Head -> Operations Head -> HR (no Team Lead step) |
| Team Lead | Department Head -> Operations Head -> HR |
| Department Head | Operations Head -> HR |
| Operations Head | HR |
| HR (anyone placed in the HR department) | Super Admin |
| Super Admin | HR |

* **No Operations Head** for the department (and the requester's function): that step is left out, so the Department Head's approval goes
  straight to HR, and a Department Head of that department applies straight to HR. A Department Head who heads both functions goes to the
  department's Operations Head of either function (`leave_operations_head`).
* **HR's own leave**: status `PENDING_SUPER_ADMIN`, then `APPROVED` or `REJECTED_BY_SUPER_ADMIN`; the decision is stored in `sa_decided_by/at/note`
  and shown as `superAdmin`. Another HR person cannot approve it.
* A step that is already waiting is never skipped: if the Operations Head leaves while their step waits, the Super Admin decides it (the exception).
  Steps not reached yet follow the hierarchy at that moment.
* Requests made before this migration keep their chain (version 1: Department Head -> HR; version 2: the table above).

Tests: `supabase/tests/leave_chain_by_requester_test.sql`.

Tests: `supabase/tests/leave_multi_level_test.sql` (the whole chain, wrong approvers, order, rejection, send back, the exception, old requests,
a departing approver, the switch); `hr_test.sql` keeps testing the two-step flow with the switch set to it.
