# Sales Department Head dashboard

A Department Head whose side is **Sales** (see [DEPARTMENT_HEAD_SIDES.md](DEPARTMENT_HEAD_SIDES.md)) opens their own dashboard at
`/sales-head/dashboard/:id`. The Support Department Head (and a head with no side set) keeps the shared Department Head dashboard, its route
and its data, unchanged.

## Menu (in this order)
Overview · Leads (Lead List, Lead Assign) · Daily Tasks · Performance Management · Department Income · Reports · Client Notices ·
Team Members & Access · Chat · Notification Center. Sign out and Leave are in the top bar as on every other dashboard.

## Who is a Sales head, and how Sales and Support stay separate
- The person is `role = DEPARTMENT_HEAD` with `head_division = 'SALES'`; the database resolves `default_dashboard = 'sales-department-head'`
  (never a name). The browser routes on that value; the database enforces the rest.
- A Sales head reads the **Sales teams** of the department only: customers, tasks, tickets, people (the Support head included), performance
  reports and chat are filtered in the database (`private.sales_scope_team`, policies and functions in migration `20261121000100`). They
  cannot create Support employees, give tasks to Support teams, or open the whole-department performance report.
- Every `sales_*` function starts with `private.require_sales_head()`; the Support head, a Team Lead, a member and the Super Admin get 403.
- Not changed: the Support head's own access, the Super Admin, every other role.
- Limits to know: the audience of a **client notice** is the department's clients (the notice model has no Sales/Support split), so a Sales
  head sees and ends only the notices they published; **expenses** are recorded per department, not per Sales side, so Department Income shows
  gross (collected) income and an honest "Not recorded for Sales" for expenses and net.

## Pages
| Page | What it shows | Source |
|---|---|---|
| Overview | 12 live cards (leads by temperature, assigned, pending assignment, team, tasks, follow-ups due, converted, income), status distribution, team activity, follow-ups, pending tasks, recent activities / sheets / conversions, highlights | `sales_head_overview` |
| Lead List | searchable, filterable (All, Hot, Warm, Cold, Unassigned, Assigned, Follow-up, Converted), sortable, paged table; lead detail; assign an unassigned enquiry | `sales_leads_list`, `sales_lead_get`, `sales_inbound_assign` |
| Lead Assign | upload `.xlsx`, column mapping, preview (valid / invalid / duplicate), confirmation naming the person, assignment, history | `sales_lead_sheet_assign`, `sales_lead_sheets_list` |
| Daily Tasks | all / pending / in progress / completed / overdue, create a task for a Sales Team Lead | `sales_tasks_list`, `sales_task_assign` (the existing task workflow) |
| Performance Management | card per Team Lead / member (assigned leads, tasks completed / pending / overdue, follow-ups, conversions, an indicator from the recorded tasks); workspace per person; the existing AI-assisted performance report | `sales_head_reports`, `sales_leads_list`, `sales_tasks_list`, `ReportView` |
| Department Income | gross (collected) income, awaiting verification, refunded, outstanding, transactions | `sales_head_income` (the department income report's Sales division) |
| Reports | Team Lead / Team Member, period, task status, charts, CSV export | `sales_head_reports` |
| Client Notices, Team Members & Access, Chat, Notification Center | the existing pages, scoped as above | existing |

## Lead Assign in detail
1. Choose who gets the sheet: active Sales **Team Leads** and **Team Members** without a Sales role, or with the role **Telecaller**. Business
   Associates, Influencers, Visit Sales and Business Partners have their own workflows and are not offered.
2. Upload an `.xlsx` (up to 700 KB, 2,000 rows; `.xls` is not read - save it as `.xlsx`). Customer Name and Phone Number are required;
   Company / Business Name, Email, Lead Source, Lead Temperature (Hot, Warm, Cold) and Remarks are optional. The headings are matched by name and can
   be corrected by hand.
3. The preview is a database check that saves nothing: valid rows, invalid rows (missing name, bad phone / e-mail / temperature) and duplicates
   (twice in the sheet, or already in the CRM by phone or e-mail) - every left-out row is listed with its reason.
4. Confirm. A member gets the leads in their own pipeline (stage Lead, with source, temperature and remarks) and a notification; a Telecaller
   gets the sheet through the existing Telecaller contact-sheet workflow (they call, and the interested ones become leads).
5. Recorded: who uploaded, upload and assignment dates, counts, the assignee, and the original file (stored privately, referenced from the row).
   The same file (SHA-256) cannot be imported twice in a department.

## Technical
- Migrations: `20261120000100_department_head_division.sql` then `20261121000100_sales_department_head.sql`. One paste each:
  `supabase/run_this_department_head_division.sql`, `supabase/run_this_sales_department_head.sql`.
- New table `sales_lead_sheets` (read-only to users, written by functions); `customers.source_sheet_id`.
- API: `GET/POST /sales-head/...` (overview, lead-assignees, sheets, sheets/:id/source, leads, leads/:id, leads/:id/assign, tasks, task-assignees,
  reports, income). Code: `server/{repositories,services}/SalesHead*`, `src/components/sales-head/*`, `src/lib/salesLeadSheet.ts`.
- Tests: `supabase/tests/sales_department_head_test.sql`, the "Sales Department Head dashboard" block of `api_integration.test.ts`,
  `sales_lead_sheet.test.ts`, `e2e/sales-head.e2e.mjs` (`run-sales-head.sh`).
