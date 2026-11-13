# Sales Department Head dashboard

A Department Head whose side is **Sales** (see [DEPARTMENT_HEAD_SIDES.md](DEPARTMENT_HEAD_SIDES.md)) opens their own dashboard at
`/sales-head/dashboard/:id`. The Support Department Head (and a head with no side set) keeps the shared Department Head dashboard, its route
and its data, unchanged.

## Menu (in this order)
Overview · Leads (Lead List, Lead Assign) · Sheet Upload · Daily Tasks · Performance Management · Department Income · Reports · Client Notices ·
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
| Lead Assign / Sheet Upload | give an `.xlsx`, `.xls` or `.csv` of contacts to a Sales Team Lead, Team Member or Telecaller: column mapping, preview (valid / invalid / duplicate), confirmation naming the person, history with failed rows (see [Sheet Upload](#sheet-upload)) | `sales_lead_assignees`, `sales_lead_sheet_assign`, `sales_lead_sheets_list`, `sales_lead_sheet_issues` |
| Daily Tasks | all / pending / in progress / completed / overdue, create a task for a Sales Team Lead | `sales_tasks_list`, `sales_task_assign` (the existing task workflow) |
| Performance Management | card per Team Lead / member (assigned leads, tasks completed / pending / overdue, follow-ups, conversions, an indicator from the recorded tasks); workspace per person; the existing AI-assisted performance report | `sales_head_reports`, `sales_leads_list`, `sales_tasks_list`, `ReportView` |
| Department Income | gross (collected) income, awaiting verification, refunded, outstanding, transactions | `sales_head_income` (the department income report's Sales division) |
| Reports | Team Lead / Team Member, period, task status, charts, CSV export | `sales_head_reports` |
| Client Notices, Team Members & Access, Chat, Notification Center | the existing pages, scoped as above | existing |

## Lead Assign in detail
The flow of a sheet: **Sales Department Head → Telecaller → (interested contacts become leads) → Business Associate / the Sales team.**
1. The sheet can only be given to a **Telecaller** (active, in a Sales team of the department). With one Telecaller they are already chosen.
   A Team Lead, a Team Member, a Business Associate or anyone from Support cannot be chosen - the database refuses it.
2. Upload an `.xlsx` (up to 700 KB, 2,000 rows; `.xls` is not read - save it as `.xlsx`). Contact Name and Phone Number are required;
   Company Name, Email and Remarks are optional. The headings are matched by name and can be corrected by hand.
3. The preview is a database check that saves nothing: valid rows, invalid rows (missing name, bad phone / e-mail) and duplicates (twice in the
   sheet, or already in the CRM by phone or e-mail) - every left-out row is listed with its reason.
4. Confirm. The contacts go to the Telecaller through the existing Telecaller contact-sheet workflow: they appear in the Telecaller's **Tasks**
   (and the Telecaller is notified); they call, mark the call status, and turn the interested ones into leads (and hand those to a Business
   Associate). No lead is created before the call.
5. Recorded: who uploaded, upload and assignment dates, counts, the Telecaller, and the original file (stored privately, referenced from the row).
   The history shows how many contacts are still to call. The same file (SHA-256) cannot be imported twice in a department.

An enquiry nobody has taken (an "unassigned" inbound lead) is different: in the Lead List the head can give it to a Sales Team Lead or Team Member.

## Technical
- Migrations: `20261120000100_department_head_division.sql`, `20261121000100_sales_department_head.sql`, then `20261122000100_sales_lead_sheets_to_telecallers.sql`
  (sheets only to Telecallers). One paste each: `supabase/run_this_department_head_division.sql`, `supabase/run_this_sales_department_head.sql`,
  `supabase/run_this_sales_lead_sheets_to_telecallers.sql`.
- New table `sales_lead_sheets` (read-only to users, written by functions); `customers.source_sheet_id`.
- API: `GET/POST /sales-head/...` (overview, lead-assignees, sheets, sheets/:id/source, leads, leads/:id, leads/:id/assign, tasks, task-assignees,
  reports, income). Code: `server/{repositories,services}/SalesHead*`, `src/components/sales-head/*`, `src/lib/salesLeadSheet.ts`.
- Tests: `supabase/tests/sales_department_head_test.sql`, the "Sales Department Head dashboard" block of `api_integration.test.ts`,
  `sales_lead_sheet.test.ts`, `e2e/sales-head.e2e.mjs` (`run-sales-head.sh`).

## Sheet Upload

Migration `20270101000400_sales_sheet_upload_members.sql`. It only adds things and is safe to run twice.

**Sheet Upload** is its own menu entry, below Leads. It opens the same page as Leads › Lead Assign: the same upload system, history and database
functions, not a second module.

**Who can receive a sheet:** any active Sales person of the head's own department.
* **Team Lead or Team Member:** the valid rows become new leads in their own pipeline ("My Leads"). Each lead is owned by them, is in their
  department and team, has the source "Excel sheet", and is linked to the sheet. The usual lead-access rules apply: they, their own Team Lead
  and the Department Head work on it. Like every lead, it also shows read-only under "Department Leads" for the department's members. The person
  and their own Team Lead are notified.
* **Telecaller:** the contacts go to their call list, unchanged from before.
* **Not offered:** Business Associates, Influencers, Visit Sales and Business Partners (who work from their own contact lists), and Support.

**Files** (the first sheet of a workbook is read):
* **`.xlsx`**
* **`.xls`** (Excel 97-2003): read in the browser by `src/lib/xlsReader.ts`.
* **`.csv`** (UTF-8 or Windows-1252, separated by commas, semicolons or tabs): read by `src/lib/csvReader.ts`.

**How a file is read:** the browser tells the type by the file's first bytes, not its name. The column matching and the database's checks are
the same for all three. Each check is unchanged:
* a name is required;
* the phone must have 7 to 15 digits;
* the e-mail must be valid;
* lengths are limited;
* duplicates within the sheet and against the CRM are left out;
* the same file is never imported twice (now also under a lock, so a double click or retry cannot import it twice);
* at most 2,000 rows.

**The original file:** it is stored privately in `telecaller-sheets` as `.xlsx`, `.xls` or `.csv`. The server checks its first bytes, and that it
is the exact file that was checked.

**History:** each upload shows the file, who received it (and their role), who uploaded it, the dates, the rows, valid, invalid and duplicate
counts, and a status:
* **Imported:** for leads, how many are in the pipeline and how many have converted;
* **Assigned:** for a Telecaller, how many are still to call and how many are called.

**Failed rows:** the rows left out are now kept with the sheet (`sales_lead_sheets.issues`), with the reason and the values that were sent.
*View N* opens them. Sheets uploaded before this change show the counts only.

**Permissions:** enforced in the database (`private.require_sales_head`).
* Only a Sales head (`private.is_sales_head`, the same check as every page of this dashboard) can list people, preview, upload or read a
  sheet's failed rows, and only for their own department. Team Leads, members, Support and other departments are refused.
* The API is `GET /sales-head/sheets/:id/issues`, alongside the existing `GET|POST /sales-head/sheets`, `POST /sales-head/sheets/:id/source`
  and `GET /sales-head/lead-assignees`.

**Tests:**
* `supabase/tests/sales_department_head_test.sql`
* `supabase/tests/sheet_readers.test.ts`: the `.xls` and `.csv` readers, with a real `.xls` saved by LibreOffice in `sheet_fixtures.ts`
* the "sheet upload API" block of `api_integration.test.ts`
* `supabase/tests/e2e/sales-head.e2e.mjs`: real `.xlsx`, `.xls` and `.csv` files uploaded to a Team Member and the Team Lead; the history and the
  failed rows; the leads in their own dashboards; tablet and phone widths

