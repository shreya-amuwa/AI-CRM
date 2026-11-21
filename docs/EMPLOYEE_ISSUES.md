# Employee issues and HR meeting requests

One employee page (**Raise an Issue**, with a selector for *Raise an Issue* / *Meeting Request*) and two HR sections (**Employee Issues**,
**Meeting Requests**). Migration `supabase/migrations/20261210000100_employee_issues_meetings.sql` (paste-able:
`supabase/run_this_employee_issues_meetings.sql`, safe to run again).

## Who can do what

| | Raise / see own / reply | Work the cases (HR) |
|---|---|---|
| Team Member, Team Lead, Department Head (every dashboard) | yes, **own cases only** | no |
| HR department staff (`private.is_hr_staff`) and the Super Admin | HR staff can raise their own | yes, every department; never their own case |
| Super Admin as an employee, clients, signed-out visitors | no | clients / visitors: no |

Authorization is checked **in the database** by every function (`private.require_employee()`, `private.require_hr()`); the API only validates
input and signs file links. The four tables have row level security with a read policy (the owner, or HR; an event only if it is visible to the
employee) and **no insert/update/delete grant**: only the SECURITY DEFINER functions write. The employee's name, department and designation are copied from the profile at submission, never sent by the client (an internal employee code is kept on the row but is not shown; the reference number is the only identifier on screen).
A request that names an employee, a status or an assignee is refused (strict schemas).

## Data

* `employee_issues` (reference `ISS-YYYY-00001`) and `employee_meeting_requests` (`MTG-YYYY-00001`): the case, its status, the assigned HR person, HR's
  latest response, dates. Statuses: issue NEW / IN_PROGRESS / AWAITING_EMPLOYEE / RESOLVED / CLOSED; meeting PENDING / SCHEDULED /
  ALTERNATIVE_PROPOSED / DECLINED / CANCELLED / COMPLETED. A meeting row cannot be SCHEDULED without a confirmed date and time (check constraint).
* `employee_case_events`: the append-only history (updates are blocked by a trigger) of both: submission, assignment, status change, response,
  information request, employee reply, meeting decisions and HR's **internal notes** (visibility `HR`, never read by the employee).
* `employee_issue_attachments` and the private bucket `employee-issue-attachments`: up to 5 files of 5 MB (images, PDF, text, CSV, Word, Excel), the
  same limits, signature check and signed-link flow as ticket attachments; a file is downloadable by the owner or HR only, and each download is audited.
* Idempotency: the form's `clientRequestId` is unique per employee, so a double submit returns the first record and creates no second notification.
  Per-employee limits: 20 issues and 10 meeting requests a day.

## Workflow

* Issue: HR assigns (NEW -> IN_PROGRESS), responds, **requests information** (AWAITING_EMPLOYEE), the employee replies (-> IN_PROGRESS; a reply to a
  RESOLVED issue reopens it), HR resolves / closes (confirmation in the UI). CLOSED is final.
* Meeting: HR **approves and schedules** (date and time, mode, location or `https` link, instructions), **proposes another time** (the employee accepts
  -> SCHEDULED, or declines -> PENDING), **declines** (reason), **reschedules** / **cancels** (reason), **completes** (outcome and follow-up, HR only).
  The employee can withdraw a request or cancel a scheduled meeting.

## Notifications (in-app, existing infrastructure)

`private.notify_once` never writes the same unread notification twice. HR gets one per submission (every active HR department member; the Super Admin
when HR has nobody), the assigned HR person gets the employee's replies and assignments, the employee gets the response, status change, assignment or
schedule. Titles carry the reference and the status, **never the issue text**; audit entries carry ids and counts, never text. Clicking a notification
opens the right page (`src/components/issues/issueEvents.ts`). **E-mail / WhatsApp are not sent** for this feature (no template or provider is wired for
it); that is the remaining integration, to be done with the existing HR e-mail automation when wanted.

## API (all under `/api/v1`)

Employee: `GET /employee/case-details`, `POST|GET /employee/issues`, `GET /employee/issues/:id`, `POST /employee/issues/:id/reply`,
`POST /employee/issues/uploads` (+ `/:id/complete`, `/:id/abort`), `GET /employee/issue-attachments/:id/url`, `POST|GET /employee/meetings`,
`GET /employee/meetings/:id`, `POST /employee/meetings/:id/cancel`, `POST /employee/meetings/:id/alternative`.
HR: `GET /hr/case-assignees`, `GET /hr/case-departments`, `GET /hr/issues/overview`, `GET /hr/issues`, `GET /hr/issues/:id`,
`POST /hr/issues/:id/assign|status|respond|note`, `GET /hr/meetings/overview`, `GET /hr/meetings`, `GET /hr/meetings/:id`,
`POST /hr/meetings/:id/assign|decide|note`.

## UI

* `src/components/issues/` (the page, the shared pieces, the menu item `ISSUES_NAV`, the notification events); `src/components/hr/EmployeeIssuesManagement.tsx`
  and `MeetingRequestsManagement.tsx`; the API client `src/lib/api/employeeCases.ts`.
* The menu item is in the Team Member, Team Lead, Department Head (and Sales / Support / Accounts / Telecaller / Business Associate / Technical
  Consultant / Meta Verifier) dashboards, next to Chat. The HR dashboard has the two HR items. HR employees do not get the employee page.

## Tests

`supabase/tests/employee_issues_test.sql` (database rules, RLS, notifications, audit), the "Employee issues and HR meeting requests" block of
`supabase/tests/api_integration.test.ts` (direct API calls: IDOR, HR-only routes, validation, files), and
`supabase/tests/e2e/run-employee-issues.sh` (real browsers: the three roles, HR's two sections, status and meeting flows, phone / tablet).


## Bugs for the Developers team (migration `20270122000300_developer_bugs.sql`)

### The employee

**Raise an Issue** has a third choice next to *Raise an Issue* and *Meeting Request*: **Report a bug to the Developers team**. It is a
technical problem that goes straight to the developers, not to HR. The employee gives:

- the issue title;
- what the problem is;
- the steps to reproduce (optional);
- screenshots or files (optional).

Files use the same upload pipeline, limits and checks as issues: up to 5 files of 5 MB, private, opened with short signed links.

The reporter's name, department and designation are copied from their profile. The form carries a request id, so sending it twice is
one bug. *My bug reports* below the form shows each bug's status, the developer working on it and the resolution note. Internal comments
are never shown.

### The developers

A **Bugs** entry appears in the side panel only for the developers on the list. It is seeded with **Shreya Mande, Ashish Sinha and
Siddhesh Shinde**, matched by name among the active members of AI Studio.

Every reported bug, from every department, is there:

- reference and title;
- reporter, department and designation;
- submitted at;
- files;
- the assigned developer;
- the status.

A developer can:

- open a bug (description, steps, files, history);
- **assign** it to any developer;
- set **Pending / In Progress / Resolved / Rejected**. Resolved needs the resolution note and Rejected the reason, both read by the reporter;
- add **internal comments**, which only developers see.

Filters: Open, Assigned to me, Unassigned, each status, and search. Notifications reach every developer for a new bug, the assignee for
an assignment, and the reporter for each status change.

### Who can see what

The database enforces all of this:

- **Bugs section.** Only the developers on `dev_team_members` (`private.require_developer`). Everyone else, including other AI Studio
  members, Department Heads and the Super Admin, gets `FORBIDDEN`.
- **Reporting and following.** Any Team Member, Team Lead or Department Head (`private.require_employee`), for their own bugs only.
- **Files.** A bug's files open for its reporter and the developers only, and each download is audited.
- **The developers list.** The Super Admin keeps it (Settings > *Developers team (Bugs access)*, `dev_team_set`) but does not get the Bugs
  section.
- **History.** `dev_bug_events` is append-only. Submitted, assigned, status changes, comments and the resolution are kept as they happened,
  and reporting, assigning and status changes are audited.

### API

- `GET /bugs/access`
- `POST /bugs`
- `GET /bugs/mine`, `GET /bugs/mine/:id`
- `GET /bugs`, `GET /bugs/:id` (developers)
- `POST /bugs/:id/assign|status|comment` (developers)
- `GET|POST /bugs/team` (Super Admin)

Uploads use `/employee/issues/uploads`.

### Tests

- `supabase/tests/developer_bugs_test.sql`
- the "bugs API" block of `api_integration.test.ts`
- `supabase/tests/ui_bugs.test.mjs`
