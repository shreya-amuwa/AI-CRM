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


## Role-wise sections: Telecaller and Business Associate (phase 1)

Migrations: `20270117000200_crocodial_field_alignment.sql`, then `20270117000300_sales_role_dashboards.sql`. Both are read-only: they add
functions only, with no table or column changes and no data changes.

**Sidebar.** Two new groups, after Performance Management: **Telecaller → Telecaller List** and **Business Associate → Business Associate List**.
Every other item of the Sales head sidebar is unchanged.

**Who is listed.** Only the people of the head's active department who are in its Sales teams and have that Sales role
(`profiles.sales_sub_role` `TELECALLER` / `BUSINESS_ASSOCIATE`), whatever their account status. Sales members without a Sales role, and Visit
Sales people, belong to the Sales Executive section of phase 2.

**List page:**
- date range (default the last 30 days, at most 93 days, as Crocodial);
- search by name, Employee ID, e-mail or phone;
- filters for Team Lead and account status;
- sort by name, Team Lead, status or any figure, highest first;
- pages of 25, and a CSV export of every matching row (up to 500).

Clicking a name opens the person's full-page dashboard at `/sales-head/dashboard/<head>/telecallers/<profile id>` (or
`business-associates/...`).

**Where each figure comes from** (see `docs/CROCODIAL_INTEGRATION.md`, "Field mapping and the Sales dashboards"):

| Role | From Crocodial (marked "Crocodial") | From the CRM |
| --- | --- | --- |
| Telecaller | Total calls, Connected, Not connected, Unique numbers, Talk time (and connect rate); the call log: date and time, contact, masked number, type, status, duration | Leads created, Converted to a Business Associate; the leads list |
| Business Associate | the same five call figures and the call log, when connected | Leads assigned; demos scheduled, completed, upcoming and cancelled (`ba_demos`, counted as in their own view); final quotations (once each, latest revision); deals closed and their value |

- The call figures are exactly those of the person's own "My Crocodial Activity" view. Both use the same database helpers and the same
  approved-mapping attribution.
- A person not connected to Crocodial, or not synced yet, shows "Not connected to Crocodial" or "Crocodial not synced yet". Their call figures
  are never shown as zeros.
- No call figure is made from CRM fields.

**Person dashboard:**
- details;
- the Crocodial call cards and the CRM cards;
- a Daily / Weekly / Monthly table, where each column says its source;
- the records: Calls (Crocodial) and Leads for a Telecaller; Calls, Leads assigned, Demos, Quotations and Deals for a Business Associate.

**Permissions.**
- `public.sales_role_list` and `public.sales_role_person` call `private.require_sales_head()`. Anyone else gets `FORBIDDEN`.
- They only read the head's own Sales people. A person outside them, or under the wrong role, is `NOT_FOUND`.
- The `private.*` helpers cannot be called by a signed-in user.

**API.**
- `GET /sales-head/roles/:role/people`, where `role` is `telecaller` or `business-associate`. Parameters: `from`, `to`, `search`, `teamLeadId`, `status`,
  `sort`, `page`, and `pageSize` (at most 500).
- `GET /sales-head/roles/:role/people/:id`, with `from` and `to`.
- Types: `SalesRoleList` and `SalesRolePersonDashboard` (`shared/contracts.ts`).

**Tests.**
- `supabase/tests/sales_role_dashboards_test.sql`: the call figures against stored Crocodial calls, counting once across people,
  permissions, scope, filters.
- The "sales roles API" block of `api_integration.test.ts`.
- `sales_role_dashboards.test.ts`: the field map against the sync and the tables, addresses, export, roll-ups.
- `ui_sales_role_dashboards.test.mjs`: the screens.

## Sales CEO → Sales Department Head (migration `20270303000100_sales_ceo_lead_assignment.sql`)

**The bug.** A Sales CEO (a Department Head marked as CEO, with several departments) opening **Leads → Lead Assign** was offered the Team Leads of
the active department, never the Sales Department Heads: `sales_lead_assignees` / `sales_lead_sheet_assign` only knew the active department.

**Now, for a Sales CEO** (an active CEO with at least one department covered for Sales; a Support-only CEO is refused):

| Step | What happens |
|---|---|
| Recipients | The Sales Department Heads of every department the CEO covers for Sales come first (name, department, open leads), then the Sales Team Leads / Team Members of those departments and the active department's Telecallers, as before. Never a Support head, the head of a department they do not cover, another CEO or themselves. A department choice narrows the list when there are several. |
| Department | Always the recipient's own department, worked out by the database. The browser never sends one (an extra field is refused). A head whose home is another department is not offered, because their leads would land there. |
| Upload | The same Excel/CSV checks as before: required name, valid phone and e-mail, duplicates in the sheet and in that department's CRM, the same file never twice per department, and a preview that saves nothing. The confirmation shows the recipient, the department and the note. |
| Commit | The valid rows become leads owned by the Department Head, in that department. Each lead records "assigned by &lt;CEO&gt;"; the sheet keeps the CEO as uploader. The Department Head is notified in the Notification Center ("… assigned to you by &lt;CEO&gt;"). Audit: `SALES_LEAD_SHEET_ASSIGNED` with the department and `byCeo`. |
| History | The CEO's upload history lists the sheets of their departments (with the department) and any sheet they uploaded. |

**The Department Head's side** (Lead Assign page, **Sheets assigned to you**):
- Each sheet shows who assigned it and when, how many leads are still with them, and how many were forwarded or converted.
- **Forward leads** gives the open ones (all, or a number, oldest first) to a Sales Team Lead or Team Member of that department.
- The same customer records change owner, so nothing is copied. The member is notified, and each lead records `LEAD_FORWARDED`.
- Audit: `SALES_LEAD_SHEET_FORWARDED`.
- A single lead can still be reassigned from the lead itself, as before.

**Unchanged:**
- A Department Head's own Lead Assign (their Team Leads, Team Members and Telecallers).
- The Telecaller call-list workflow.
- The rule that a Business Associate, Influencer, Visit Sales or Business Partner is not offered sheets.

**How the owner check allows it.**
- `private.can_assign_customer_owner` also accepts a head whose scope covers the owner's department for Sales.
- This applies only inside `sales_lead_sheet_assign` / `sales_sheet_forward`, which set the department for that one transaction.
- The setting cannot be reached through the API.

**API:**
- `GET /api/v1/sales-head/received-sheets`
- `GET /api/v1/sales-head/received-sheets/:id/assignees`
- `POST /api/v1/sales-head/received-sheets/:id/forward`, with the body `{ assigneeId, count? }`

**Tests:**
- `supabase/tests/sales_ceo_assignment_test.sql` (39 checks)
- the "sales CEO API" checks in `api_integration.test.ts`
- `sales_head_nav.test.ts`

**Rollback.**
- Redeploy the previous app.
- To undo the database part, re-run the earlier definitions of:
  - `sales_lead_assignees`, `sales_lead_sheet_assign`, `sales_lead_sheet_issues` and `sales_lead_sheets_list` from `20270101000400_sales_sheet_upload_members.sql`;
  - `sales_lead_sheet_source_begin` from `20261121000100_sales_department_head.sql`;
  - `private.can_assign_customer_owner` from `20261220000200_department_head_leads.sql`;
  - `croc_refresh_capabilities` from `20270204000100_crocodial_scoped_refresh.sql`.
- The new functions can stay unused.
