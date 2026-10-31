# Hierarchical work reports

`Team Member -> Team Lead -> Department Head -> Operations Head`. Every person below the Operations Head writes an individual report; the
chain reviews it; each level sees the level below it in expandable boxes. Migration: `supabase/migrations/20261213000100_work_reports.sql`.

## What each role sees (the **Reports** menu)

| Role | Tabs | What it does |
| --- | --- | --- |
| Team Member | Submit report, My reports | Fills in the report (title, date, period, assigned / completed tasks, work completed, today's activities, pending tasks, challenges, achievements, remarks, attachment links), saves a draft or submits it to their Team Lead. Sees only their own reports with status, submitted-to, the Team Lead's comment and last-updated time. A report sent back for a revision is edited and resubmitted. |
| Team Lead | Team member reports, My individual report | Inbox of the team's reports (Pending / Approved / Rejected / Revision required): open one, **Approve**, **Reject** or **Request revision** with a comment. The *team report box* is built live from the members' reports (counts for the period and one expandable card per member). Their own individual report goes straight to the Department Head and cannot be approved by themselves. |
| Department Head | Team reports, My individual report | The Team Lead reports waiting for their decision, then **one expandable box per Team Lead** (header: counts, last submission, the lead's own report status; inside: A. the lead's individual report, B. the members' *approved* reports, one card per member). The *consolidated department report* previews the totals and sends the package for the period to the Operations Head, with department-level observations. |
| Operations Head | Department reports | The Department Head reports waiting for their decision, then **one expandable box per department** they own (from the database, nothing hard-coded). Opening it shows Level 1 the Department Head's report, Level 2 a box per Team Lead, Level 3 a card per Team Member, all in one place. |

Super Admin has the same company-wide view as the Operations Head over every department. Operations Heads also get the menu in the shared Department Head
and Sales Head dashboards. The older Department Head page that counted tasks is now called **Task Reports** (and **Sales Reports** on the Sales Head dashboard).

## Rules the database enforces

* **Reviewer chain:** a Team Member's reviewer is the Team Lead of their team; a Team Lead's is the Department Head of the department (and side, when the head looks after one side);
  a Department Head's is the Operations Head who owns the department (`department_operations_owner`). Nobody reviews their own report.
* **What is visible:** the author sees their own (drafts included); a reviewer sees what was submitted to them; the Department Head sees Team Lead reports and the members' reports
  *only once their Team Lead approved them*; the Operations Head sees Department Head reports and, once the Department Head has sent the package for that period, the whole chain below
  (members' reports again only when approved). Pending, rejected and returned reports are shown as counts, never as approved. Drafts are private to the author.
* **Package:** the Department Head's package for a period is a pointer, not a copy (`work_report_packages`: one per department and period; sending it again updates the note). The boxes are
  built live from the individual reports, so a report approved later appears in it too and every report keeps its own identity. Before the package is sent the Operations Head sees counts only.
* **History:** a report's steps are kept in `work_report_events` (created, submitted, opened, approved, rejected, revision requested, resubmitted). A resubmission raises the revision number; earlier
  steps and comments stay. Nothing is overwritten and submitted reports cannot be deleted.
* **Notifications** (existing notification centre, `entity_type` `work_report`): submit -> reviewer; resubmit -> reviewer; approve / reject / revision -> author; package sent -> Operations Head.
  Each event notifies once. Clicking one opens the Reports page on that report. The menu badge is *reports waiting for my decision + my reports sent back*.
* **Attachments** are saved as validated `http(s)` links (up to 5). Uploading files through the signed-upload storage used by Raise an Issue is a follow-up.

## Data

`work_reports` (kind MEMBER / TEAM_LEAD / DEPARTMENT_HEAD, author, department, team, period, content JSON, status, revision, reviewer, review comment), `work_report_events`, `work_report_packages`.
RLS is on with no grants for the app roles: all access is through `security definer` functions (`work_report_save`, `_submit`, `_get`, `_review`, `_delete_draft`, `work_reports_mine`, `_inbox`, `_team_box`,
`_department`, `_operations`, `_operations_department`, `_context`, `work_report_package_submit`) that work out the caller from `auth.uid()`; the browser sends no role, team or reviewer.

## API (`/api/v1/work-reports/...`)

`GET context | mine | inbox | team-box | department | operations | operations/departments/:id | :id`, `POST /` (create draft), `PATCH :id`, `DELETE :id` (draft), `POST :id/submit | :id/review | package`.
The same Zod schemas (`shared/validation.ts`, field list in `shared/reportFields.ts`) are used by the form and the service.

## AI performance analysis

Reports are separate records and are not read by the AI performance report; nothing here is approved automatically. If an AI summary of a report is added later it must be labelled as AI
output and never change a report's status.

## Tests

`supabase/tests/work_reports_test.sql` (roles, visibility, approvals, revision loop, packages, notifications, audit, no direct table access), the *Work reports* block of
`supabase/tests/api_integration.test.ts` (every route per role, cross-department and cross-role denials) and `supabase/tests/work_reports.test.ts` (schemas).
