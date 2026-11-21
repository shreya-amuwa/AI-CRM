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
