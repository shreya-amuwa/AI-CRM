# Task daily reports and performance approval

Migration `supabase/migrations/20270209000100_task_daily_reports_performance.sql` (run after `20270208000200`; safe to run twice; nothing is deleted, no column is
changed, no existing function is replaced). It **adds** to the task module (`work_tasks`, [WORK_TASKS.md](WORK_TASKS.md), [TASK_MANAGEMENT_V2.md](TASK_MANAGEMENT_V2.md)),
the report chain ([WORK_REPORTS.md](WORK_REPORTS.md)) and Performance Management ([PERFORMANCE_MANAGEMENT.md](PERFORMANCE_MANAGEMENT.md)). Those keep working as before.

```
Department Head -> Team Lead -> Team Member          (tasks, existing)
Team Member submits a daily report on a task -> Team Lead approves or returns it
Approved reports + task records -> performance figures
Team Lead approves a Team Member's performance; Department Head approves a Team Lead's performance
```

## What people see

| Role | Side panel | What it does |
| --- | --- | --- |
| Department Head | **Assign Task**, **Daily Reports**, **Performance Management** | assigns to Team Leads (existing page); *Daily Reports -> Task Reports* lists every task report of the department with its status (read-only); *Performance Management -> Scores & Approvals* compares the Team Leads and teams and approves or returns each Team Lead's performance |
| Team Lead | **Assign Task**, **Daily Reports**, **Performance Management** | assigns to members (existing page); *Task Reports* is the inbox: Approve, or Return for correction with a reason; *Scores & Approvals* shows each member's figures and the Team Lead's own, and approves or returns a member's performance |
| Team Member | **My Assigned Tasks**, **Daily Reports**, **My Performance** | *Task Reports*: report on an assigned task (task, date, work completed, progress %, pending work, reason for delay, remarks); the list shows Pending / Approved / Returned for correction, the Team Lead's remarks and the approval history; a returned report is corrected and sent again |

The same entries exist in the International and Reseller dashboard (`UnifiedDashboard`), the Sales Team Lead, Support Team Lead, Department Head, Sales Department Head
(new *Assign Task* entry, the same page the other heads use) and the Sales and Support Team Member dashboards. The existing *Reports* page is now called **Daily Reports**; its
tabs are unchanged and **Task Reports** is a new last tab. The older task analytics (AI written reports) are the second tab of Performance Management.

## Task daily report (`task_daily_reports`)

* One report per **task and date** (`unique (task_id, report_date)`); the date is today or one of the last 7 days (never the future, never before the task was assigned,
  never after the task closed). A returned report is edited and sent again: the same row, `revision + 1`, so there is never a duplicate.
* Validation (database and form, one Zod schema `taskReportSubmitSchema`): what was done (at least 10 characters); progress 0 to 100; **pending work** is required below 100%;
  the **reason for the delay** is required when the task is past its deadline and not finished.
* Only the **assignee** of the task, a Team Member, can report on it. A report never changes the task itself (task status and progress stay with the existing work updates).
* Status `PENDING` -> `APPROVED` or `RETURNED` (-> `PENDING` again on resubmission). A return needs a reason (5 characters).
* **Who decides:** the Team Member's Team Lead (`private.direct_lead_of`); a member without a Team Lead (AI Studio) is decided by the Department Head covering them. Nobody decides
  on their own report; the Department Head and the Super Admin read, they do not approve a member who has a Team Lead.
* **Approval history** (`task_daily_report_history`, append-only: a signed-in user cannot edit or delete a row): submitted, returned, resubmitted, approved with the approver, the time
  and the remarks. Every step is also in the audit log (`TASK_REPORT_*`).
* **Notifications** (category *Reports*): `REPORT_TASK_SUBMITTED` -> Team Lead (or the head), `REPORT_TASK_APPROVED` / `REPORT_TASK_RETURNED` -> the Team Member.

## Performance (`performance_records`)

Figures are calculated by `performance_overview(start, end)` from the real task records and the approved reports; **nothing is typed in**. A task belongs to the period by its deadline
(or, with none, the day it was assigned). A share with nothing to divide is `null` and shown as *Insufficient data* (never 0%); the score re-balances over the parts that have data.

| Team Member score | weight | | Team Lead score | weight |
| --- | --- | --- | --- | --- |
| Task completion (completed / tasks) | 35 | | Own task completion | 20 |
| Progress (completed = 100, else the latest **approved** report's progress) | 15 | | Team task completion | 25 |
| On-time completion (completed on or before the deadline) | 20 | | Team on-time completion | 15 |
| Reports approved (approved / (approved + returned)) | 15 | | Reports reviewed (reviewed / (reviewed + waiting more than a day)) | 25 |
| Reporting consistency (days with an approved report / working days with an open task; Sundays excluded) | 15 | | Work handed down (received tasks handed to the team or taken on / received) | 15 |

Also shown: tasks assigned / completed / pending / overdue, reports submitted / approved / pending / returned, tasks given to the team, the average time to review. The Department Head
sees the department totals, a comparison of the Team Leads and teams (tasks, completion, overdue, report status, score) and every member under each lead.

* **Record and approval.** A record exists per person and period (`unique (subject_id, period_start, period_end)`), created when there is data. Status `PENDING` / `APPROVED` / `RETURNED`.
  The Team Lead decides a member's record, the Department Head a Team Lead's (`private.perf2_can_decide`); nobody decides their own; the Super Admin and (for members) the Department Head read.
  The decision carries the `version` that was on screen: if the figures changed in between it is refused (`CONFLICT`) and the reviewer reloads.
* **Automatic updates.** Every overview recalculates; a Pending or Returned record follows the data (a new `version` only when a figure changed), and a report submission or decision refreshes the
  member's and their Team Lead's open records of that period at once. An **Approved record keeps the approved figures**; the live figures are shown next to it.
* **Returned for correction:** the person fixes the work and presses *Send again for approval* (`performance_record_resubmit`: figures recalculated, status Pending, the reviewer notified).
* **History** (`performance_record_history`, append-only): generated, refreshed, approved, returned, resubmitted, with the approver, the time, the score and the remarks. Decisions are in the
  audit log (`PERFORMANCE_RECORD_*`) and notify the person (`REPORT_PERFORMANCE_APPROVED` / `_RETURNED`; `REPORT_PERFORMANCE_PENDING` to the reviewer on resubmission).

## Departments and permissions

Nothing new is hard-coded: the rules are the existing hierarchy (`direct_lead_of`, `head_covers`), so each department, team and function (Sales / Support) is isolated exactly as for tasks, and
**International** and **Reseller** work without a special case (their people are ordinary profiles of their own department). Row level security is on for the four tables; the app roles have
`select` through policies and **no write grant**; every write is a `security definer` function that reads the caller from `auth.uid()` (the browser sends no role, team, department or reviewer).

| Who | Reads | Decides |
| --- | --- | --- |
| Team Member | own reports and own performance | nothing |
| Team Lead | reports and performance of the members they lead, their own performance | their members' reports and performance |
| Department Head | everything of the department (and function) they cover | Team Leads' performance (and members without a Team Lead) |
| Super Admin | every department (`performance_overview(..., department)`) | nothing here |
| Another department, another Team Lead | nothing | nothing |

## API

`GET /task-reports/my-tasks`, `GET /task-reports?scope=MINE|TEAM&status&from&to&memberId&taskId&page`, `POST /task-reports`, `GET /task-reports/:id`, `POST /task-reports/:id/review`
(`{decision: APPROVE|RETURN, remarks}`), `GET /performance-approval/overview?start&end[&departmentId]`, `POST /performance-approval/records/:id/review` (`{decision, remarks, version}`),
`POST /performance-approval/records/:id/resubmit`, `GET /performance-approval/records/:id/history`. Route -> `taskReportsController` -> `TaskReportService` (Zod: `taskReportSubmitSchema`,
`taskReportReviewSchema`, `taskReportListQuerySchema`, `performanceOverviewQuerySchema`, `performanceRecordReviewSchema`) -> `TaskReportRepository` -> the database function.

## Tests

* `supabase/tests/task_daily_reports_performance_test.sql` (+ `task_daily_reports_flow.sql`, run once for an ordinary department, International and Reseller): the whole workflow, validation,
  one report per task and day, return / resubmit / approve, performance figures from real records, approval of members and Team Leads, version conflicts, frozen approved record, history,
  audit, notifications, and every refusal (another department, another Team Lead, a member, the Super Admin, direct table writes).
* `supabase/tests/task_daily_reports.test.ts`: the schemas and the service. `supabase/tests/ui_task_reports_performance.test.mjs`: the screens in Chromium (member, Team Lead, Department Head),
  including phone width. `unified_dashboard.test.ts`, `ui_unified_dashboard.test.mjs`, `sales_head_nav.test.ts` cover the new sidebar entries.

## Rollout

Run the migration in the Supabase SQL editor. The screens call the new functions, so until it is run the *Task Reports* tab and the *Scores & Approvals* tab show the database's error; the rest of
the CRM is unaffected. Not built: reports for Team Leads' or Department Heads' own tasks (the report chain of [WORK_REPORTS.md](WORK_REPORTS.md) covers their own daily report), a Department Head's
second approval of members' performance (the head reads it), attachments on a task report.
