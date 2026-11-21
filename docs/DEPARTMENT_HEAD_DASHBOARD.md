# Department Head dashboard: department overview, team attendance, leads, customers and invoices

Migration `supabase/migrations/20270125000100_department_head_dashboard.sql`. It adds **read-only** database functions for the Department Head's own
department. No table, column, policy or existing function was changed, and nothing else (Super Admin, Admin, Accounts, HR, Team Lead, Team Member and the
other departments' dashboards) was touched.

## What the Department Head gets

| Page | What it shows |
| --- | --- |
| **Overview** (new section at the top) | Department name, employees, present / absent / on leave today and the attendance percentage; customers (active, new, pending invoices), leads (new, in progress, converted, lost) and invoices (count, amount invoiced, pending, overdue). |
| **Team Attendance** (new) | The department's employees for one day: name, designation, status, punch-in, punch-out, time worked, leave. Filters: All / Present / Absent / On leave, a date picker (today by default, never a future date), search, paging. |
| **Leads** (new) | Summary cards, source filter, status filter, search, paging, and **Add lead** (the CRM's existing lead form with a "Lead owner" choice). Opening a lead uses the existing lead details. |
| **Customers** | *Overview* (new): summary cards, search, a status filter, a table (customer, contact, status, relationship manager, services, department, created date, pending invoices) and a customer panel (profile, services, team, invoices and the payment summary, where the customer came from, support tickets, a link to the full customer record). *Hand-overs & tickets* is the page that was here before, unchanged. |
| **Invoices** (new) | Summary cards, filters All / Paid / Pending / Overdue, a date range, search by number or customer, paging. An invoice opens in the CRM's existing read-only invoice detail (and its PDF, where the existing invoice permissions allow it). |

The Accounts head keeps their own pages: they get no Leads and no Invoices page. A Support-side head gets no Leads page (leads belong to the Sales side).

## How the numbers are defined

- **Present**: the employee has a Punch In on that day in `attendance_records` (the manual Punch In / Punch Out). **CRM sign-in is not attendance.**
- **On leave**: an `APPROVED` leave request (`leave_requests`) covers the day and there is no punch-in. A pending or rejected request does not count.
- **Absent**: neither. Weekly offs and holidays are not modelled in the CRM, so a day off with no punch-in shows as Absent; today, someone who has not punched in *yet* also shows as Absent.
- **Attendance %** = present ÷ (employees − on leave). Punch locations are never returned.
- **Employees**: the active people of the head's department and side (Sales or Support), excluding the Super Admin.
- **Leads**: leads, potential and lost ones, plus customers that were once a recorded lead. *New* = a new lead nobody has contacted yet; *In progress* = a lead being worked or a potential customer; *Converted* = in onboarding or a customer; *Lost*.
- **Customers**: the head's department's customers under the customer visibility the table already gives a Department Head (the head's side, plus customers handed over to a Support head). *New* = created in the last 30 days.
- **Invoices**: `member_invoices` of those customers that the existing invoice permission (`private.can_read_invoice`) lets the head read. *Overdue* = pending and past its due date (calculated, never stored). Paid amount = the invoice amount when it is Paid; outstanding = the amount while it is Pending (partial payments are kept per customer by Accounts, not per invoice). Cancelled invoices are listed under their own filter and left out of totals.

## Authorization and department isolation

- Every function starts with `private.head_dept()`: only an active **Department Head**, and the department is `private.my_department_id()` (their profile and the scope they were granted). **No department id, role or user id is accepted from the browser.** Anyone else (Team Lead, Team Member, Super Admin, signed out) is refused with 42501 (HTTP 403).
- Attendance, leads, customers and invoices are filtered to that department in the database (`private.head_attendance_rows`, `head_leads`, `head_customers`, `head_invoices`).
- Invoices also go through the existing `private.can_read_invoice`, and opening an invoice or its document uses the existing `invoice_detail` / `invoice_file_access`, so another department's invoice or PDF is "not found". Marking an invoice paid, changing a payment or accounting data stays with Accounts: the head has no such function.
- **Add lead** uses the existing `/pipeline/leads` endpoint and `create_lead_once`. The owner is checked twice by the database (`private.can_assign_customer_owner`, then the customer insert policy): a lead cannot be given to someone outside the head's department, and the lead lands in the owner's department. The form only offers the head and the Sales Team Leads / Team Members of the department (`head_lead_owners`).
- The private helpers cannot be called by signed-in users.

## Before the migration is run

The new pages show a clear error (the Overview says "Department statistics are not available right now" and offers *Try again*); the rest of the dashboard works as before.

## Tests

- `supabase/tests/department_head_dashboard_test.sql` (86 checks, real functions and policies): attendance (present, absent, on leave, pending leave, punch times, date and status filters, department and side isolation, no locations, the CRM sign-in is ignored), the overview numbers, lead creation (own lead, chosen owner, another department refused), the lead list and filters, customers (list, filters, detail, isolation), invoices (filters, date range, isolation, no accounting writes, document access refused for another department), role refusals and the private helpers.
- `supabase/tests/ui_department_head_dashboard.test.mjs` (89 checks, browser): the Overview statistics, each page (loading, empty and error states, filters, search, paging, details), Add lead with the owner choice, the real dashboard navigation for a Sales head, a Support-side head and the Accounts head, and phone width.

## Add lead for a Department Head (the Team Lead's flow)

**How the Team Lead's Add Lead works.** The Team Lead's dashboard opens the CRM's shared lead pages (`PipelineWorkspace`): the *Add lead* button of the lead list opens
`AddLeadView`, which checks the form with `leadCreateSchema` and sends it to `POST /pipeline/leads` with one request id per form. The service calls `create_lead_once`
(one lead per request id), which runs `create_lead`; the `customers` insert policy and trigger put the lead in the owner's team and department, check who may own it
(`private.can_assign_customer_owner`) and write the activity. There is no department or team in the request: the schema is strict.

**What the Department Head has.** The very same form (`AddLeadView`), endpoint, schema and database functions. The only difference is one extra field, **Lead owner**:
the head first ("Myself"), then the Team Leads and Team Members of the head's own side of the department (`head_lead_owners`, migration `20270126000100`, for the
Sales side and the Support side; a head with no side is offered every team). The button is on the Leads page next to the lead statistics and on the Overview's Leads card.
After saving, the form closes, "Lead added to your department." shows, and the list, the lead summary and the Overview numbers reload.

**Permissions (checked in the database, not only by showing the button).** A head can give a lead only to someone in their own department (`FORBIDDEN` / 403 otherwise);
a department, team, role or user id sent in the request is refused by the API schema, and, if it ever reached the database, ignored (the lead goes to the owner's
department). A Team Lead can give a lead only to their own team, a Team Member only to themself, the head of another department to no one in this department, and a
signed-out caller to no one. The Team Lead's own flow is unchanged. Sending the same form twice (double click, retry) makes one lead.

**Tests.** `department_head_dashboard_test.sql` section 8 (the Team Lead still adds their lead; the head's lead appears in the list and moves the statistics; one lead per
request id; a smuggled department is ignored; every refused combination; the Support head), `department_head_add_lead.test.ts` (what the API accepts) and the browser
test (same fields as the Team Lead's form plus the owner choice, validation, success, refresh, double click, server error, the Overview button).
