# Employee approval, Operations Heads and team assignment

One hierarchy, enforced by the database, then the API, then the screens:

Super Admin > Operations Head > Department Head > Team Lead > Team Member. HR creates the employee records and starts the approval.

## 1. Who approves whom

| Requested role | Required approver | How it is resolved |
| --- | --- | --- |
| Operations Head | Super Admin | always |
| Department Head | the Operations Head who **owns** the department | `department_operations_owner` (one row per department) |
| Team Lead | the respective Department Head | the active Department Head of the department (and side, when heads are split Sales / Support) |
| Team Member | the respective Department Head | same |

* The approver is resolved **in the database** from the stored request (`private.resolve_employee_approver`). HR, a Team Lead or the browser never send one.
* The Super Admin can decide any request (ultimate authority). Nobody approves their own account. An unrelated Operations Head, another department's head, HR and
  a Team Lead cannot decide a request; a Department Head cannot approve another Department Head.
* A Department Head request for a department **nobody owns** stays pending, has no approver, and the Super Admin is notified (`DEPARTMENT_OWNER_MISSING`). It is never
  handed to an unrelated person. When the Super Admin names the owner, the waiting requests move to them and they are told.

## 2. The lifecycle

1. **Submit** - HR (any member of the HR department) from *HR > Employee Requests*, or a Team Lead (a Team Member of their own department only) from *Ask for a Team Member*.
   `POST /employee-requests` validates, then creates the sign-in with `request_*` metadata (service key only). The database trigger creates **one** PENDING profile and
   **one** pending request; the person cannot sign in (profile pending, Auth sign-in blocked). The existing member fields are kept (designation, joining date, date of
   birth, blood group, contact, emergency contact; employee ID is new and optional). A duplicate e-mail is refused with the status of the existing account.
2. **Decide** - `employee_request_decide`, one transaction: checks the approver, then **approve + activate** or **reject** (a reason of 3+ characters is required). The account
   is made active nowhere else: a trigger refuses any other path from PENDING / REJECTED to ACTIVE, and another trigger refuses any other change of an employee request's status
   (including the older registration approval and a plain table update).
3. **Placement on approval**
   * Operations Head: becomes `is_operations_head`; the Super Admin ticks the departments they manage in the same step (or later).
   * Department Head: active in the requested department and side.
   * Team Lead: active, with a team of their own created in the department (`<name> Team`).
   * Team Member: active in the department's **pool** team (`teams.is_pool`) = "approved, awaiting a Team Lead".
4. **Reject** - the employee stays inactive (REJECTED), HR is told with the reason. HR corrects and sends it again (`employee_request_resubmit`): the **same** employee, a new attempt
   (`attempt`, `resubmission_of`); every earlier attempt stays.
5. **Assign** (a separate step, never an approval) - the Department Head puts an approved Team Member under an active Team Lead of the same department:
   `assign_member_to_team_lead` moves them into that Team Lead's team, writes `team_assignments` (who, when, from, to, note; kinds PLACEMENT / ASSIGNMENT /
   REASSIGNMENT), tells the Team Lead and the member, and creates **no** employee request. A Team Lead of another department, an inactive Team Lead, an unapproved
   or inactive member, the same Team Lead again, and a member of the other side (Sales / Support) are refused.

Events that do **not** create an employee request: assigning or reassigning a Team Member, moving customers, a Meta Verifier hand-over, routine profile updates,
and everyone who is already active when this is deployed.

## 3. Operations Heads (Super Admin)

* *Team Member Management > Operations Heads* (Super Admin only): the heads, the departments each manages (multi-select), and the **one** accountable Operations Head per
  department ("approves heads"). A department without one is flagged with the number of requests waiting.
* Scope is stored as proper relations: `department_access` (the existing scope, which the dashboard and RLS already read) and `department_operations_owner`.
  `operations_head_scope_set` is Super Admin only; an Operations Head cannot change their own scope or anybody's.
* Changing the scope takes the removed departments off their dashboard **at once**, drops the ownership of them, moves waiting requests, notifies the people involved and
  audits the old and new list (`OPERATIONS_SCOPE_SET`). What they already approved stays, with them as the approver.

## 4. Operations Head dashboard

*Operations Dashboard* (replaces the older overview): totals and a per-department table (Department Head, Team Leads, Team Members, awaiting assignment, pending work), a
department view (Team Leads and their teams, who waits for a Team Lead, customers by stage, hand-overs waiting), **Department Head activity** and **Department Head approvals**.
Only the departments assigned to the person are returned (`operations_dashboard`, `operations_department_activity`, `operations_department_detail`).
Activity is real audit and sign-in records of the Department Heads of that department; nothing is inferred from a status, and no password, session or token is exposed.

## 5. Migration and existing people (`20261211000100_employee_approval_hierarchy.sql`, re-runnable)

* Nobody is promoted and nobody loses access. Active employees do not go through approval.
* Existing multi-department grants stay (and stay listed for a decision).
* A department gets an accountable owner automatically only when **exactly one** active Operations Head already covers it (audited `DEPARTMENT_OWNER_BACKFILLED`).
* `supabase/review_employee_hierarchy.sql` (read only) lists: departments with no owner, departments several heads cover, current owners, still-pending sign-up requests,
  transition grants, and Team Members in a team with no Team Lead.
* Self-registration (public sign-up) keeps its own flow (`source = REGISTRATION`); only HR requests use the hierarchy (a Team Lead no longer files requests: see section 9).

## 6. Routes

`POST|GET /employee-requests`, `GET /employee-requests/:id`, `POST /employee-requests/:id/decide|resubmit`; `GET /operations/heads`, `POST /operations/heads/:id/scope`,
`GET /operations/heads/:id/activity`; `GET /operations/dashboard`, `GET /operations/departments/:id[/activity]`; `GET /department/employees`,
`POST /department/employees/:id/assign-lead`, `GET /department/employees/:id/assignments`.
Changed: `POST /users` by a **Team Lead** is refused (they send an employee request; the Department Head approves). Super Admin and Department Head creation (they are the approvers)
is unchanged.

## 7. Notifications

In-app (the Notification Center, live): approver on submit and on resubmit; the Super Admin when a department has no owner; HR on approval and rejection (with the reason); the Department
Heads when an approved Team Member waits; the Team Lead and the employee on assignment; the Operations Head and the previous owner on a scope or ownership change. One notification
per event per person (the database function that makes the event is the only sender). No password or credential is in any message.
No new e-mail template was added: approvers are reached through the in-app notifications.

## 8. Tests

`supabase/tests/employee_hierarchy_test.sql` (routing, every refusal, owner changes, scope changes, activity, assignment, direct-path bypasses, history),
`api_integration.test.ts` (the same through HTTP), `ui_employee_hierarchy.test.mjs` (approver, HR, directory, Operations dashboard, Super Admin scope; phone and desktop).

## 9. Who adds a team member, and how (`20261212000200_team_lead_direct_member_creation.sql`, re-runnable)

The path depends on **who is signed in**, decided in the database from the caller (never from anything the browser sends):

| Creator | What happens | Approval |
| --- | --- | --- |
| Super Admin, Department Head | creates the account directly (any role they may create) | none, active at once |
| **Team Lead** | *Team Members > Add Team Member*: a **Team Member of their own team** is created directly and is active at once, with the team, department and the Team Lead (reports to) set. For a Sales team the form also offers the **Sales role** (Telecaller, Business Associate, Influencer, Visit Sales, Business Partner), saved on `profiles.sales_sub_role`. | none |
| **HR** (any active member of the HR department) | *Employee Requests*: the employee is created **PENDING** and a request goes to the approver of section 1 (a Team Member or Team Lead: the Department Head). HR sees "Employee Submitted for Department Head Approval" and the status of every request. | required |

* A Team Lead cannot create a Super Admin, Operations Head, Department Head or Team Lead, cannot add anyone to another team or department, and cannot raise their own
  role. `private.actor_can_assign_role` refuses it in the database, so a direct API call fails the same way as the form.
* HR **cannot** skip the approval: `private.actor_can_assign_role` and `public.assert_can_create_user` refuse HR (HR is told to use *Employee Requests*), so `POST /users`
  is closed to HR. The Team Lead path is also closed on `employee_request_submit` (`private.check_employee_submission`: only HR submits; `source` is always `HR`).
* The Department Head decides under *Team Members & Access > Employee Approvals*: details first, Approve, or Reject with a reason (required). The decision, the approver and
  the time are stored on the request and are the history. A rejected person never gets a sign-in. When approved, the account is active and
  the Department Head puts the Team Member under a Team Lead (*Approved Employees*). The HR request form has no Sales role field: the Department Head sets it afterwards
  (`POST /users/:id/sales-sub-role`, also allowed for a Team Lead on a member of their own team).
* Requests a Team Lead filed before this change (`source = MANAGER`) stay decidable by the Department Head: nothing is deleted or rewritten.
* Tests: `employee_hierarchy_test.sql` and `telecaller_test.sql` (DB), `api_integration.test.ts` ("Who adds a team member, and how"), and `supabase/tests/e2e/run-member-creation.sh`
  (Team Lead creates six members including all five Sales roles; HR submits, the Department Head approves and rejects).
