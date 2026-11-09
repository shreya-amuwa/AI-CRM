# Company-wide reporting: daily reports, weekly management reports, HR reviews, Super Admin analysis and leaderboard

One reporting architecture for every role, with role-specific screens. It extends the hierarchical work reports (`docs/WORK_REPORTS.md`) and reuses their tables, hierarchy
functions, notifications and live signals. Migrations (run in this order): `20261221000100_reports_standard_form.sql`, `20261221000200_reports_weekly_cycle.sql`,
`20261221000300_hr_performance_reviews.sql`, `20261221000400_performance_leaderboard.sql`.

```
DAILY    Team Member -> Team Lead (approves) -> Department Head (approves)            -> Fully Approved
         Team Lead and Department Head also write their own daily report (Team Lead -> Department Head, Department Head -> Operations Head)
WEEKLY   Department Head compiles the week -> Operations Head approves (or asks for a revision) -> sent to HR
HR       reviews every Team Lead and every Team Member separately -> submits the consolidated report -> Super Admin
SUPER    sees the consolidated report, the AI analysis and the Performance Leaderboard
```

## 1. One standard report form (all levels)

Team Member, Team Lead and Department Head use the same screen (`DailyReportForm`): **Report title, Report date** (today by default, up to 60 days back, never a future day),
**Assigned tasks**, **Completed tasks** and one optional **Remarks / Work Summary** (500 characters). No challenges / achievements / long text.

* The tasks are the author's own `work_tasks` (`GET /work-reports/my-tasks`, open to the three authoring levels). The database refuses a task not assigned to the author, a completed task that is
  not one of the assigned tasks and a completed task that is not `COMPLETED` in the task records (on save and again on submit). A snapshot of each task is stored.
* A report is for **one day**; one report per person and day (a rejected one may be replaced). A report needs an assigned task or a remark to be submitted.
* Reports written before (long-form Team Lead / Department Head sections, weekly periods) stay readable; editing one keeps its old sections.
* Every submission keeps a snapshot of the content in the history (`work_report_events.content`), so a revision never overwrites an earlier version.
* A Team Lead's report has its **own Department Head status** (`dh_status`, `dh_reviewer_*`), separate from the Team Lead's approval of members' reports. A Team Lead cannot approve their own report.
* The Department Head reads every submitted report of their teams (read only), including the ones still waiting for the Team Lead; they can **decide** on a Team Member report only after the Team Lead approved.

## 2. Screens by role (the Reports menu; the page follows the person's place in the chain)

| Role | Tabs |
| --- | --- |
| Team Member | Submit Daily Report, My Reports (title, date, assigned / completed count, submission date, Team Lead and Department Head status) |
| Team Lead | Team Member Reports (Pending Team Lead Approval / Pending Department Head Approval / Fully Approved / Revision Required / Rejected; Approve, Reject, Request revision), My Daily Report, Team Reporting Overview (one collective box: own report + each member, both approvals, task completion) |
| Department Head | Team Reports (a box per Team Lead: Section 1 the lead's own daily report, Section 2 the members' reports), Pending Approvals, My Daily Report, Daily Department Summary (date filter), Weekly Department Report |
| Operations Head | Department Reports (one box per department: figures + weekly status; Level 1 Department Head, Level 2 Team Leads, Level 3 Team Members), Weekly Approvals, Reporting Overview |
| HR (HR department sidebar: **Performance Reviews**) | Department Reviews, Team Lead Reviews, Team Member Reviews, Consolidated Performance Report, Review History |
| Super Admin (sidebar: **Reports & Performance**) | Company Reports, Department Performance, Employee Performance, AI Performance Analysis, Performance Leaderboard |

Boxes are expandable and load their content when opened. Departments, teams and people always come from the database.

## 3. Daily Department Summary

`work_reports_daily_summary(date)`: members, Team Leads, **reports expected**, submitted, pending Team Lead / Department Head approval, fully approved, revision / rejected, task totals (each task counted once),
compliance, a team-wise table and the people who have not reported. Expected = the working days (`report_settings.working_days`, default Monday to Saturday) of every active person from the day their account
started, minus days of an **approved full-day leave** (`leave_requests`). Nothing is copied: it is calculated from the individual reports. The Operations Head and the Super Admin can open any department they cover.

## 4. Weekly cycle (Department Head -> Operations Head -> HR)

The weekly report is the existing `work_report_packages` row (one per department and Monday-to-Sunday week), now with a status, the Department Head's summary (title, assigned / completed task overview, remarks),
a statistics snapshot taken at submission and the Operations Head's decision. It points at the daily reports; it never copies them.

Statuses: `DRAFT, COMPILING, PENDING_OPERATIONS_HEAD, REVISION_REQUIRED, APPROVED_BY_OPERATIONS_HEAD, SENT_TO_HR, HR_REVIEW_IN_PROGRESS, HR_REVIEW_COMPLETED, SUBMITTED_TO_SUPERADMIN`
(labels in `WEEKLY_STATUS_LABEL`). Approval sets `SENT_TO_HR` and records the Operations Head, comment and time; a revision returns it to the Department Head (revision number +1). HR reads only `SENT_TO_HR` and
later; an unapproved week never reaches HR. The Department Head cannot approve their own week. Every step is in `work_report_package_events`.

API: `GET /work-reports/daily-summary`, `GET|POST /work-reports/weekly` (`weekStart` must be a Monday; `submit:true` sends it), `GET /work-reports/weekly/board`, `GET /work-reports/weekly/pending`,
`POST /work-reports/weekly/:id/review`. The older `POST /work-reports/package` only accepts a Monday-to-Sunday week and calls the same function.

## 5. HR performance reviews

Tables `hr_performance_reviews` (one row per person and weekly package: rating on the configured scale, attendance / reporting-consistency note, work assessment, comments, recommendations, status
`DRAFT` / `SUBMITTED`, the figures the review was written against), `hr_consolidated_reports` and `hr_consolidated_packages` (pointers). HR = active members of the HR department (`private.is_hr_reviewer`); the
Super Admin only reads.

* Every active Team Lead and Team Member of the department is reviewed **separately**; nobody can review themselves; a person outside the department is refused.
* A draft can be saved and finished by any HR colleague; a **submitted review is final** and stays in the person's history (`hr_review_history`, `hr_review_log`).
* HR reads the daily reports of an approved week (read only). A review never changes a report or its approval status, and an approved report does not complete the HR review (separate statuses).
* The first review moves the week to *HR Review In Progress*; when every person has a submitted review it becomes *HR Review Completed*.
* **Consolidated report** (`hr_consolidated_get/save`): per week, shows what is complete, what is pending (missing reviews named, drafts marked, open approvals and revisions), and which departments' weekly reports have
  not reached HR. HR can save a draft note. **Submit** sends only the departments whose every review is submitted (they become *Submitted to Superadmin*); the others stay with HR, unfinished, and are listed as
  pending in the stored snapshot. Nothing incomplete is marked as finalised. Submission is audited and notifies the Super Admin. The week's stage reads *Pending HR Review / Partially Reviewed / HR Review
  Completed / Submitted to Superadmin / AI Analysis Completed*.

Rating scale: `report_settings.rating_scale` (default 1 to 5). API: `/hr-reviews/overview|packages/:id|packages/:id/people/:personId/reports|history/:id|log|consolidated`, `POST /hr-reviews`.

## 6. Super Admin: leaderboard, employee performance, AI analysis

**Score** (`private.person_score_rows`, nothing is stored, recalculated for every request): a weighted average of five measures, weights in `report_settings.score_weights` (default task completion 35, daily reporting
compliance 20, on-time submission 10, approvals without revision 10, HR rating 25; the Super Admin changes them and the minimum data limits on the leaderboard page).

| Measure | From |
| --- | --- |
| Task completion | `work_tasks` assigned to the person with a due date (or, with none, creation day) in the period: completed / assigned (needs the minimum number of tasks) |
| Daily reporting compliance | submitted reports / expected report days (leave and days off excluded) |
| On-time submission | reports sent on the report day or the next day |
| Approvals without revision | approved / (approved + revision requests + rejected) |
| HR rating | average of the submitted HR reviews overlapping the period, mapped onto the scale |

A measure with no data is left out and the others are scaled up (never counted as zero). Not penalised: tasks not assigned to the person, approved leave, work outside the period. **Insufficient data**: fewer expected
report days than the minimum or fewer than two measures with data: no score, no rank, never in a Bottom list, shown apart. Trend: the score against the previous period of the same length (Improving /
Stable / Declining at +-5 points; otherwise "not enough data"). The breakdown of every score is shown, and HR ratings are shown next to (not inside) the measured figures.

Leaderboard (`report_leaderboard`, Super Admin only): categories Top 10, Bottom 10, Top / Lowest Team Members, Top / Lowest Team Leads, Top / Lowest Departments, Full ranking; period Daily / Weekly / Monthly /
Custom; filters department, team, designation, role, person, Team Lead, Department Head, Operations Head, performance category, HR rating, reporting compliance, task completion (all work together). Employee
profile (`report_employee_profile`): score and breakdown, 8-week history, HR reviews, reports. Employee ID is `EMP-` + the first 8 characters of the profile id (the CRM keeps no other employee code).

**AI analysis**: `report_analysis_facts` returns measurable facts (consistently strong completion, low completion, missing reports, repeated revision requests, well-performing teams, departments with late or
missing weekly reports, assigned-versus-completed gaps, changes between periods), each with a fact id, the person / team / department, the numbers and its source tables. The writer
(`server/reportAnalysis`) turns them into text: with `ANTHROPIC_API_KEY` set it asks the AI (same switch as the other AI features), **sending the facts by id with no names, departments or teams**, and keeps only
points that cite real fact ids; without a key, or when the AI fails, fixed rules write the text and the screen says so. The text never states a reason and never changes a report or a rating. It is stored in
`report_ai_analyses` (facts, text, source, model, period) and written automatically by the daily run for every consolidated week that is still waiting (`runReportAnalysisAutomation`), which also sets the week to *AI
Analysis Completed* and notifies the Super Admin. API: `/report-performance/consolidated|leaderboard|options|employees/:id|settings|analysis`.

## 7. Live updates and notifications

`work_report_signals` (Realtime, a person receives only their own rows) now also fires for weekly report changes (Operations Head, Department Heads, HR once sent, Super Admin when complete), HR review changes
(HR) and the consolidated submission / analysis (Super Admin); the screens read again only the section on screen (`useReportsLive`). Notifications (existing centre, once each): report submitted -> Team Lead; Team Lead
approved -> Department Head and the author; Department Head decided -> author and Team Lead; weekly report submitted / resubmitted -> Operations Head; weekly report approved -> every HR staff member and the Department
Head; revision -> Department Head; consolidated report submitted -> Super Admin; analysis written -> Super Admin. Clicking opens the right page.

## 8. Security

Every function is `security definer`, works out the caller from `auth.uid()` and has no table grants for the app roles (RLS on, no policies for `authenticated` on the new tables). The browser sends no role, team,
reviewer or id for authorization. Denied: Team Member / Team Lead / Department Head / Operations Head on HR and Super Admin functions; HR on the leaderboard; anyone but the Super Admin on the analysis; the Department Head
on their own weekly approval; HR on report approvals. `report_analysis_store`, `report_analysis_facts_service` and `report_analysis_pending` are granted to `service_role` only.

## 9. Tests

`supabase/tests/reports_company_flow_test.sql` (database: the whole chain with real provisioned accounts and task records, denials, leaderboard and facts), the *Company reporting* block and the updated *Work reports*
block of `supabase/tests/api_integration.test.ts`, `supabase/tests/company_reports.test.ts` (schemas and the analysis writer).

## 10. Limits

* The CRM has no employee code, so the Employee ID is derived from the profile id.
* The leaderboard measures only what the CRM records; integration failures cannot be detected, so a person with missing data shows Insufficient Data rather than a low score only when their data is below the limits.
* Attendance data is limited to approved leave; the review form has a free-text attendance / consistency note beside the recorded report figures.
* The Operations Head approves the Department Head's *daily* report as before; the weekly report is a separate approval.

## Weekly report routing by department AND function (migration 20261230000200)

**Why "No Operations Head assigned to this department" appeared:** the reports looked only for the one department-level Operations Head
(`department_operations_owner`). Departments whose Sales and Support Operations Heads are named per function (`department_function_owner`,
20261224000100) have no department-level owner, so the weekly report, the Department Head's own daily report and the Operations Head's weekly
board found nobody.

* **One resolver**: `private.weekly_reviewer_ids(department, function)` = `private.operations_owner_for`: the active Operations Head named for that
  function, else the department-level owner only when their scope covers the function. A Support Operations Head is never resolved for Sales;
  an inactive one never is.
* **A weekly package belongs to a department and a function** (`work_report_packages.division`: `SALES` / `SUPPORT` / NULL = whole department,
  which every existing package keeps). Unique per (department, function, week).
* **Department Head**: reports the function they head in the department they are working in (header switcher). A head of both functions in a
  department with separate Sales / Support Operations Heads sends a Sales week and a Support week (function selector on the weekly screen);
  the screen shows who receives it. The Department Head's own daily report goes to the Operations Head of their function (a head of both:
  the whole-department Operations Head, else the Sales and Support ones).
* **Operations Head**: the weekly board, pending list, review and drill-down list exactly the (department, function) scopes they are accountable
  for; another function's week is "not found". Figures (`report_scope_stats(..., function)`) and HR's reviews cover the people of that function.
* **Nobody to receive it**: submitting is refused with the reason (the screen saves the draft first); nothing is approved by itself. The Super
  Admin sees every scope with a missing or inactive Operations Head on **Operations Heads** (`GET /api/v1/work-reports/weekly/routing`,
  `weekly_report_routing_review()`), and assigns one with the existing department controls there.

Tests: `supabase/tests/weekly_report_routing_test.sql` (Support DH -> Support OH, Sales DH -> Sales OH in the same department and week, a head of
both functions, a head in two departments, no Operations Head, an inactive one, the wrong one, revision, approval, HR) and the "weekly routing"
block of `api_integration.test.ts`.

## Task hierarchy: Operations Head -> Department Head -> Team Lead -> Team Member (migration 20261230000300)

* **Operations Head** (Assign page): chooses an active Department Head of a department and function they supervise (`operations_task_assignees`,
  `assign_task_to_department_head`). Team Leads are not offered, and the database refuses an Operations Head's call to
  `assign_task_to_team_lead`. Their task list shows each task's whole chain (`operations_tasks`, `task_hierarchy`): actual assignee, who
  delegated it, instructions, assigned/due dates, progress, status, latest update, completion time.
* **Department Head** ("From the Operations Head" on the Assign page): passes the task to one or more of their Team Leads with instructions and
  a due date (`delegate_task_to_team_lead`; only Team Leads of that department and function), follows the chain, and sends updates up.
* **Team Lead**: either **Assign to myself** (`take_task_myself`: the same task, no copy, a second click changes nothing) or hands it to their own
  Team Members with a share each (`delegate_task_to_members`, now accepting a task passed down from a Department Head). Never another lead's member.
* **Who reads a task**: the existing rules, plus everyone above it in its chain; a Department Head does not read another function's Operations
  Head task. A child's update never completes its parent. The Operations Head counts only their own root tasks (no double counting).
* **Daily drill-down** (Operations Head reports, "People and daily reports"; `GET /api/v1/work-reports/operations/people`,
  `operations_people_daily`): per person of the department and function they supervise (Department Heads, Team Leads, Team Members): Team Lead,
  tasks assigned / completed / pending / overdue in the period, and their submitted daily reports with the Team Lead and Department Head
  stages (drafts never). Filters: department, period (up to three months), Team Lead, report status, employee. Read only.

Tests: `supabase/tests/task_hierarchy_test.sql` (33 checks, including: an Operations Head opens only the daily reports of their function), the "people drill-down" block of `api_integration.test.ts`,
`supabase/tests/ui_task_hierarchy.test.mjs` (browser).
