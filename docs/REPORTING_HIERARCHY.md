# Daily and weekly reporting hierarchy

Migration `supabase/migrations/20270308000100_report_hierarchy.sql` (additive, safe to run twice). It builds on the existing modules; no separate
reporting system was added: the hierarchical work reports (`docs/WORK_REPORTS.md`, `docs/COMPANY_REPORTING.md`) for every department, and AI Studio's own
daily reports (`docs/AI_STUDIO_DAILY_REPORTS.md`, `docs/AI_STUDIO_HR_PERFORMANCE.md`).

| Department | Daily reporting | Weekly reporting |
| --- | --- | --- |
| Every department except AI Studio | Team Member → Team Lead → Department Head | Department Head → Operations Head |
| AI Studio | Team Member → Team Lead → HR (the HR employees the Super Admin named, e.g. Simran Kumari) | Team Lead → Department Head (the Super Admin) |

## Every department except AI Studio (unchanged)

* **Daily:** a Team Member submits to their Team Lead; the Team Lead approves; the report goes to the Department Head (*Pending Department Head
  Approval*), who sees the department's reports team-wise (a box per Team Lead) and employee-wise. Nothing changed.
* **Weekly:** the Department Head compiles the week (the summary of the daily reports is built from them) and submits it to the Operations Head of the
  department and function, who sees the weekly reports of the departments they are responsible for. After the Operations Head approves, HR performance
  reviews follow as before (and a department with no Operations Head still goes straight to HR).
* **New in the weekly report:** besides the title, assigned / completed task overview and remarks, the Department Head now writes **Pending work**,
  **Achievements** and **Challenges** (`work_report_packages.pending_overview / achievements / challenges`; `work_report_weekly_save` takes them; the
  Operations Head and HR read them in the report).

## AI Studio

AI Studio is kept out of the normal department cycle: the database refuses a Department Head → Operations Head weekly report for AI Studio, refuses a new
hierarchical work report for an AI Studio person (trigger `tg_reports_not_ai_studio`; existing rows are untouched), and AI Studio is not a weekly Operations
Head scope (so the Super Admin's routing review no longer lists it as "missing an Operations Head").

### Daily: Team Member → Team Lead → HR

* The Team Member submits to their Team Lead (as before). **The Team Lead's approval is final**: the report is *Approved*, sent to HR once
  (`ai_studio_report_hr_sends`, once per revision) and the named HR employees are notified. The Department Head (Super Admin) no longer has an
  approval step for it; they still read every report.
* A Team Member without a Team Lead, and a Team Lead's own report, still go to the Department Head (there is no Team Lead step for them).
* **Existing reports:** reports a Team Lead had approved that were waiting for the Department Head became *Approved* at the Team Lead's time; their
  history, approvals and HR records are kept.
* **Simran Kumari's dashboard:** HR side panel → **Daily Reports – AI Studio**. Shown only to the HR employees the Super Admin named (HR → Daily Reports –
  AI Studio → *HR access*) and to the Super Admin; no name is written in the code and the database refuses everyone else (403). It shows the approved reports
  of AI Studio Team Members employee-wise (default), team-wise and project-wise, with the Team Lead's approval (who and when), the reporting date, the
  completed work, the pending work and the remarks, and the Team Leads' own reports.

### Weekly: Team Lead → Department Head (the Super Admin)

* **Team Lead:** AI Studio side panel → **Weekly Report**. One report per week (Monday to Sunday). The figures are read from the records, team-wise
  (each member who reports to them: daily reports submitted / approved, tasks completed, pending, overdue) and project-wise (tasks completed / pending,
  people), and are fixed when the report is submitted. The Team Lead writes the completed work (required to submit), pending work, achievements, challenges
  and remarks. Save as draft, submit; a returned report is edited and resubmitted (revision + 1).
* **Super Admin:** AI Studio workspace → **Weekly Reports**: every Team Lead's submitted weeks (filter by week and status), the full report with its figures,
  **Acknowledge** or **Return for revision** (comment required). Every step is kept in `ai_studio_weekly_report_events` and the audit log.
* **Nobody else:** HR (Simran included), the Operations Head, another Team Lead, a Team Member and the AI Studio Department Head profile cannot list, open or
  review it (403 / 404). Notifications go to the Super Admins on submission and to the Team Lead on a decision, once each.

## API

| Method and path | Who |
| --- | --- |
| `GET /ai-studio/weekly-reports/week?weekStart=YYYY-MM-DD` | the Team Lead: their week and its live figures |
| `POST /ai-studio/weekly-reports` | the Team Lead: `{ weekStart, completedWork, pendingWork, achievements, challenges, remarks, submit }` (strict) |
| `GET /ai-studio/weekly-reports?weekStart&status` | the Super Admin (every submitted week), a Team Lead (their own) |
| `GET /ai-studio/weekly-reports/:id` | the Super Admin, its Team Lead |
| `POST /ai-studio/weekly-reports/:id/review` | the Super Admin: `{ decision: ACKNOWLEDGE \| RETURN, comment }` |
| `POST /work-reports/weekly` | the Department Head: adds `pendingOverview`, `achievements`, `challenges` |

## Deploying

Run `20270308000100_report_hierarchy.sql` in the Supabase SQL editor, then deploy the app. Before the migration the app works as before, except the new
AI Studio weekly pages answer with an error and the three new weekly fields are not saved.

## Tests

`supabase/tests/report_hierarchy_test.sql` (all seven checks: the two hierarchies, Simran's access, AI Studio weekly reports never reaching HR or an
Operations Head, AI Studio out of the normal cycle, no duplicates, the existing flows), `ai_studio_hr_performance_test.sql` (updated: the Team Lead's approval
is final), the "Reporting hierarchy" and updated AI Studio blocks of `api_integration.test.ts`, `report_hierarchy.test.ts` (schemas) and
`ui_ai_studio_hr.test.mjs` (Daily Reports – AI Studio, the weekly report for the Team Lead and the Super Admin).
