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

### The developers (migration `20270122000400_bug_team_lead_assignment.sql`)

The **Bugs** entry appears in the side panel only for the people on the developers list:

| Who | Role in the team |
| --- | --- |
| **Shreya Mande** | **Team Lead** |
| **Ashish Sinha** | Developer |
| **Siddhesh Shinde** | Developer |

**How the developers are found.** They are matched by name in **any department**, ignoring case, spaces and dots, with the spellings
Siddhesh / Siddesh / Sidhesh.
- The first version (`20270122000300`) only looked in AI Studio for the exact names. A developer whose account was spelled or placed
  differently never got the section, which is why Siddhesh saw no bugs.
- The Super Admin can still add or remove a developer, and choose the Team Lead, in Settings > *Developers team (Bugs access)*.

**Who sees a bug.**

| Bug | Team Lead (Shreya) | The assigned developer | The other developer | The reporter |
| --- | --- | --- | --- | --- |
| New, **unassigned** | yes | — | yes (both developers see it) | own bug only |
| **Assigned** to Ashish | yes | Ashish: yes | Siddhesh: **no** | own bug only |
| **Assigned** to Siddhesh | yes | Siddhesh: yes | Ashish: **no** | own bug only |

Every new bug starts **Unassigned** and is seen by all three. They all get the same details, files, employee details and submission time.

**Who does what.**
- **Only the Team Lead assigns.** Her bug drawer has an *Assign to* dropdown with Ashish Sinha and Siddhesh Shinde. She can also re-assign a
  bug, or put it back to *Unassigned* so every developer sees it again.
- **The Team Lead's view** shows every bug. Filters: *New (unassigned)*, one per developer, each status. A workload strip gives each
  developer's open and closed bugs.
- **A developer** sees the new unassigned bugs and the ones assigned to them, under *New (unassigned)* and *Assigned to me*. They can open
  and comment on these, and change the status of their own.
- **Changing a status:** the Team Lead on any bug, a developer on the bugs assigned to them. Resolved needs the resolution note and Rejected
  the reason, both read by the reporter. The lead is notified of each developer's progress.
- **Comments:** everyone in the team who sees the bug can add internal comments. Only the team sees them.

**Records.**
- `dev_bugs` has `assigned_to`, `assigned_by`, `assigned_at` and `assignment_status` (UNASSIGNED / ASSIGNED).
- `dev_bug_assignments` keeps every assignment and un-assignment with its time. Ownership changes never delete or copy a bug.
- Removing a developer from the list puts their open bugs back to unassigned.

### Who can see what

The database enforces all of this:

- **The visibility rule.** It lives in `private.bug_visible` / `private.bug_team_visible`. The same rule is applied by every function
  (`bug_dev_list`, `bug_dev_detail`, comments, status, files) and by the **row level security policies** on `dev_bugs`, `dev_bug_events` and
  `dev_bug_assignments`. Anyone else gets `FORBIDDEN` or "not found".
- **Writing.** Nothing is written past the functions: there is no insert, update or delete grant.
- **Reporting and following.** Any Team Member, Team Lead or Department Head (`private.require_employee`), for their own bugs only.
- **Files.** A bug's files open for its reporter and the developers who see the bug, and each download is audited.
- **History.** `dev_bug_events` is append-only. Reporting, assigning and status changes are audited.

**Re-running the migrations.** After `20270122000400` has run, do not re-run `20270122000300` (it refers to the old column name
`assignee_id`). Re-running `20270122000400` itself is safe.

### API

- `GET /bugs/access`
- `POST /bugs`
- `GET /bugs/mine`, `GET /bugs/mine/:id`
- `GET /bugs`, `GET /bugs/:id` (developers)
- `POST /bugs/:id/assign|status|comment` (developers)
- `GET|POST /bugs/team` (Super Admin; `{ profileId, member, lead }`)

Uploads use `/employee/issues/uploads`.

### Tests

- `supabase/tests/developer_bugs_test.sql`
- the "bugs API" block of `api_integration.test.ts`
- `supabase/tests/ui_bugs.test.mjs`

## Developer access by email (migration `20270124000100_developer_access_by_email.sql`)

Who gets the **Bugs** section is one row in `dev_team_members`. The first two bug migrations filled it once, by matching the person's *name*
among ACTIVE profiles, so a developer whose profile did not match at that moment (not approved yet, spelled or placed differently, created
or renamed afterwards) never got the row: `bug_access()` said `isDeveloper = false` and the menu hid Bugs. The visibility rule itself was
correct (every developer sees every unassigned bug; once assigned, only the Team Lead and the assigned developer).

- `dev_team_emails` lists the account emails of the developers (not the lead): `siddhesh.amuwa@gmail.com` (Siddhesh Shinde, AI Studio - AI CRM).
- A profile with a listed email (`profiles.email` or the sign-in email) that is **ACTIVE** and **not a Super Admin** is added to
  `dev_team_members` by the migration and, from then on, automatically when it is created, becomes ACTIVE, or changes email or role.
  A pending / suspended profile is not approved or changed by this: the migration prints a NOTICE saying why the account is still not set up.
- Removing a developer in Settings also removes the email from the list, so the removal is not undone later.
- `supabase/diagnostics/bug_developer_access_check.sql` (read-only) shows the auth user, profile, status, role, membership and what the
  developer sees, for one email.
- The Bugs menu asks `bug_access()` up to three times before concluding "not a developer", so a network hiccup does not hide it.

## Issue routing and escalation (migration `20270128000200_issue_routing_escalation.sql`)

Run after `20270128000100_ceo_meeting_queue.sql`. Additive and safe to run twice.

### One recipient per issue

**Raise an Issue** (Team Members, Team Leads, Department Heads) offers two clearly separate options. Nothing is ever sent to both.

| Option | What it creates | Who receives it |
| --- | --- | --- |
| **Raise an Issue to HR** | an `employee_issues` row (recipient `HR`) | HR only (Employee Issues) |
| **Raise an Issue to Developer Team** | a `dev_bugs` row (source `EMPLOYEE`), with a category and a priority | the developers only (Bugs) |

- Each issue in the employee's lists says where it is:
  - **To: HR**;
  - **Escalated to Developer Team · *status***;
  - **To: Developer Team**.
- The whole row of every list opens the issue: the employee's lists, HR's Employee Issues table and the developers' Bugs table. Buttons in a row keep working.
- **The meeting request to HR moved** from Raise an Issue to **Meetings → HR meeting requests**. It has the same form, rules and history. Its notifications open that tab.

### Developer Team issues

- **Category:** Bug / error, Feature request, Access / login, Wrong or missing data, Slow / performance, Other.
- **Priority:** Low, Medium, High, Urgent. An Urgent issue notifies the developers as urgent.
- **Statuses:** Pending, Under Review, In Progress, Pending Information (`NEEDS_INFO`), Resolved, Rejected, Closed.
  - "Open" means Pending, Under Review, In Progress or Pending Information.
  - Resolving or rejecting needs a note; closing does not.
- **The conversation** is seen by both the reporter and the developers (`dev_bug_events` kind `MESSAGE`):
  - Any developer who sees the issue can reply (`bug_dev_reply`).
  - Only the assigned developer or the Team Lead can **ask for information**, which sets Pending Information.
  - The reporter **follows up** (`bug_my_follow_up`), with files. A follow-up on Pending Information or Resolved goes back to the team.
  - A Closed issue takes no more messages.
  - Internal comments stay developers-only, as before.
- **Older forms** keep working: `POST /bugs` without a category or priority stores Bug, Medium.

### HR: Raise an Issue (sidebar)

- **A. Report to Developer Team.** HR reports an issue (source `HR_REPORT`), optionally naming the **affected department and employee** (ids checked by the database). HR also:
  - follows its status and the developers' replies;
  - sends follow-ups;
  - filters by status and searches, in the database.
- **B. Employee Issues – Received by HR.** The existing Employee Issues workspace, unchanged:
  - search; filters by department, priority, category, assignee, dates and status;
  - the conversation with the employee, status changes and closing.

  It also gains a **sort** (newest, oldest, priority, status, department, employee), a **routing** filter (with HR / escalated) and an "Escalated" count.
- The Super Admin sees section B only, because only an employee reports.

### HR escalates an employee issue (`issue_hr_escalate`)

- "Escalate to Developer Team" on an issue creates **one** linked Developer Team issue (`source_issue_id`, unique). It carries:
  - the employee issue's title, description and priority (or the one HR picks);
  - HR's note and the category;
  - the employee as the affected employee.
- A retry, a double click or another HR person gets the same issue (`duplicate: true`). Nothing is copied twice.
- **Files are referenced, not copied.** The developers who see the Developer Team issue may open the employee issue's files (`issue_attachment_download`, audited). Reassigning the issue to another developer removes that access.
- **The employee is told** (in-app notification and an "Escalated to the Developer Team" entry in their history). When the developers change the status, the employee's issue gets a "Developer Team update" with the resolution note, and the employee is notified.
- **Every HR person** sees the developers' answers on the issue: replies, requests for information and status changes. They never see internal comments.
- **What is refused:**
  - escalating a closed issue;
  - HR escalating their own issue;
  - an employee escalating.

### API

| Route | What it does |
| --- | --- |
| `POST /bugs` | create an issue for the Developer Team. Takes `category`, `priority`, `affectedDepartmentId`, `affectedEmployeeId`; calls `bug_report`. |
| `GET /bugs/mine?status=OPEN\|DONE\|<status>&search=` | the reporter's own issues |
| `POST /bugs/mine/:id/follow-up` | the reporter's follow-up: `{ message, attachmentIds }` |
| `POST /bugs/:id/reply` | a developer's reply: `{ message, requestInfo }` |
| `POST /hr/issues/:id/escalate` | HR escalates an issue: `{ note?, category?, priority? }` |
| `GET /hr/issues?sort=…&routing=WITH_HR\|ESCALATED_TO_DEVELOPERS` | HR's sorted, filtered list |

### Tests

- `supabase/tests/issue_routing_test.sql`
- the "issue routing API" checks of `api_integration.test.ts`
- `supabase/tests/issue_routing.test.ts` (the shared schemas)
- `supabase/tests/ui_bugs.test.mjs`: the two recipients, the conversation, whole rows, HR's page and the escalation
- `supabase/tests/ui_meeting_presence.test.mjs`: Meetings → HR meeting requests
- `supabase/tests/e2e/employee-issues.e2e.mjs`, updated for the new layout
