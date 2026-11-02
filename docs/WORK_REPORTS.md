# Hierarchical work reports

> The report form, the daily summary, the weekly Department Head -> Operations Head -> HR cycle, HR reviews and the Super Admin analysis / leaderboard are described in [COMPANY_REPORTING.md](COMPANY_REPORTING.md), which replaces this page where they differ (one standard form for every level; the department package is now the weekly report).

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

## Two-level approval for Team Member reports (migration `20261217000100_reports_two_level_approval.sql`)

This section replaces what the sections above say about Team Member reports (the single Team Lead approval and the long member form); Team Lead and Department Head reports are unchanged.

```
Team Member submits -> Pending Team Lead Approval -> (Team Lead approves) -> Pending Department Head Approval -> (Department Head approves) -> Fully Approved
```

* **Statuses.** `SUBMITTED` / `UNDER_REVIEW` = *Pending Team Lead Approval*; the new `PENDING_DEPARTMENT_HEAD` = *Pending Department Head Approval*; `APPROVED` = *Fully Approved* and is reached **only** after both approvals;
  `REJECTED` and `REVISION_REQUIRED` as before. The words come from `reportStatusLabel` in `shared/reportFields.ts`. Pending reports are never counted as approved, anywhere.
* **Two stages, two records.** `work_reports` keeps, per stage, the reviewer (id and name), time, status and comment (`tl_*`, `dh_*`), the Team Lead who handled it (`team_lead_id/_name`) and `decision_stage` (which stage
  made the last rejection / revision request). `work_report_events.stage` marks each history step. A resubmission clears the current approvals (so both stages repeat) and the earlier rounds stay in the history.
* **Who decides.** The database works out the stage from the report's state and the caller (`private.report_review_stage`): only the report's own Team Lead decides stage 1, and only a Department Head covering the
  department (and side) decides stage 2, and only after the Team Lead approved. Nobody decides on their own report; the Super Admin and the Operations Head read but do not take part in the member chain.
  The browser sends only `decision` and `comment`.
* **Department Head.** *Pending Approvals* tab: **Pending Team Member Approvals** (`GET /work-reports/member-approvals`) lists the reports the Team Leads approved: title, employee and designation, Team Lead, report date,
  assigned and completed tasks, Team Lead approval date, status. Approve = fully approved; Reject / Request revision (comment required) sends it back to the employee with the Team Lead's approval kept on record,
  and notifies the employee and the Team Lead. Notifications: Team Lead approved -> Department Head(s) (`REPORT_PENDING_DEPARTMENT_HEAD`) and the employee (`REPORT_TL_APPROVED`); final decisions -> the employee and the Team Lead.
* **Boxes.** Team Lead box (Department Head): **A. Team Lead individual report**, **B. Team Member reports** grouped *Pending Department Head Approval / Fully Approved / Rejected - Revision Required*.
  Operations Head: Department -> Department Head -> Team Lead -> Team Members, every status shown (*Pending Team Lead Approval* too); only fully approved reports count as approved. Counts: `pendingTl`, `pendingDh`, `approved`,
  `revision`, `rejected`.
* **The Team Member report** is only a title, a report date (today by default; up to 60 days back, never a future day), **assigned tasks** and **completed tasks**. The tasks are the member's own `work_tasks`
  (`GET /work-reports/my-tasks`); the database refuses a task that was not assigned to the author, a completed task that is not one of the assigned tasks, and a completed task that is not completed in the task records
  (checked on save and again on submit). The report stores a snapshot of the task titles. The old text sections are no longer saved; reports written before still show them.
* **Team Lead individual report screen:** no Download button and no History section (the approval history is still recorded and shown to reviewers elsewhere).
* **Live updates.** `work_report_signals` (published to Supabase Realtime, RLS: a person only receives their own rows, no report content) gets one row per affected person (author, Team Lead, Department Head(s), Operations Head)
  when a report is submitted or its status changes and when a package is sent (triggers on `work_reports` / `work_report_packages`). `useReportsLive` (`src/components/reports/reportEvents.ts`) listens through the shared channel
  (`listenToTables`: one subscription per tab, closed on unmount), debounces, and the Reports page reads again only the section on screen plus the badge. Without Realtime (no Supabase client) it falls back to a read on focus
  and every 20 seconds while the tab is visible.
* **Existing data.** Team Member reports that the Team Lead had already approved become the stage 1 approval and now wait for the Department Head (status `PENDING_DEPARTMENT_HEAD`); nothing is deleted.
* **Tests.** `supabase/tests/work_reports_two_level_test.sql`, the *Work reports* block of `supabase/tests/api_integration.test.ts`, `supabase/tests/work_reports.test.ts` and `supabase/tests/e2e/run-reports-approval.sh` and `reports-approval.e2e.mjs`.
