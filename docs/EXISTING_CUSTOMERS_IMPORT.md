# Existing customers: Excel import, client logins and usage on the client dashboard

## Who uses it

| Who | Where | Whose customers |
| --- | --- | --- |
| Support Team Member | Sidebar > **Import Customers** | Always their own. The "Support Team Member" column is ignored. |
| Support Team Lead | Sidebar > **Import Customers** | The member named in the "Support Team Member" column (their own team only). |
| Department Head | Sidebar > **Import Customers** | The member named in the column (any Support team of the department). |

Write the member's name as it appears in the CRM. If two people share a name, use their CRM e-mail instead.

## One sheet for the whole Support team (`Existing_Customers_One_Sheet.xlsx`)

The Import screen offers this template first. Everything is on **one tab, "Import"**, and the whole Support team can type into the same file (for example a shared Google Sheet): the Team Lead or Department Head downloads it as `.xlsx` and uploads it **once**.

- **One row per record.** The first column, **Record type**, says what the row is: *Customer, Service, WhatsApp account, WhatsApp campaign, AI Calling, RCS / Voice* or *Monthly deliverable*. The second column is the **Mobile Number**, which links the rows of one customer. The order of the rows does not matter.
- **Only the columns of that kind are used.** The other cells turn grey. Columns that mean the same thing in several kinds are shared (Sent, Delivered, Read / Answered, Failed, Valid Until, Data as of, Service, Notes), so the sheet is 74 columns wide instead of seven tabs.
- **Who looks after the customer** is written on the Customer row (*Support Team Member*, a drop-down from the *Support Team* tab). A Team Member who uploads always gets the customers for themselves; a Team Lead / Department Head must name the member.
- **It fills itself:** *Customer (auto)* shows whose row it is (red mobile = not on a Customer row); the renewal date, panel, display name, package size, Valid Until and the unit come from the other rows; "Data as of" is typed once on the *Set once* tab. Examples are on rows 2 to 8 (skipped); your rows start on row 9; 3000 rows are prepared.
- **Checks before saving:** a row with an unknown Record type, or data typed without one, is listed by row and stops the save; a value typed in a column that does not apply to the row's kind is ignored and shown as a note. Everything else (required fields, numbers, the customer's service) is checked by the database exactly as before, and errors say "Record type, row N".
- The older templates with one tab per kind (`Existing_Customers_Services_Usage*.xlsx`) still import; the import recognises the format by the Record type column.
- Built by `scripts/build_one_sheet_template.py`; the column headings must match `ONE_SHEET_TYPES` in `src/lib/existingCustomerImport.ts`.

## Steps

1. **Download the template** from the Import screen (`/templates/Existing_Customers_Services_Usage.xlsx`). It has one tab per kind of data:
   1 Customers, 2 Services, 3 WhatsApp Account, 4 WhatsApp Campaigns, 5 AI Calling, 6 RCS & Voice, 7 Monthly Deliverables.
   The grey example rows (mobile 9820011111, or "EXAMPLE" in Notes) are skipped.
2. **Upload the filled file.** Every row is checked and nothing is saved yet. Any problem is listed with its sheet, row and what to fix, for example "1 Customers, row 3: Mobile Number must be a 10-digit Indian mobile number".
3. **Save.** All rows are saved together, or none if anything is wrong.
   - A mobile number that already exists in the department **updates** that customer; it is never added twice. Usage rows and campaigns are replaced as well, so importing the same file again is safe.
   - The caller must already look after that customer (its member, its Team Lead, or the Department Head).
   - **Usage for a service the customer does not have yet.** A customer on sheet 3 / 4 (WhatsApp), 5 (AI Calling), 6 (RCS & Voice) or 7 (Monthly Deliverables)
     gets that service added automatically (status Live, no price or dates; counted under "Services" in the preview). To set the plan, price and
     dates, add the customer's row for that service in "2 Services" (one row per service, so a customer with 3 services has 3 rows); migration
     `20261117000200_import_auto_service.sql`.

Limits: one .xlsx file of up to 5 MB, 500 customers and 5000 rows in total.

## Client logins: the team's password, or the client's own

- Every row in "1 Customers" with a **Client Login E-mail** gets a client login when the file is saved.
- **With a Client Password** (optional column in "1 Customers", right after the Client Login E-mail): the login is created with the password the team chose, and **the client is e-mailed their sign-in details: the client dashboard address (`/client/login`), the login e-mail and the password** ("Your Amuwa client dashboard - sign-in details", from meta@amuwa.com, sent straight away). If the Client Login E-mail is empty, the customer's **E-mail** is the login.
- **Without one**, the client receives a **"Set your password"** e-mail from meta@amuwa.com. The link opens `/client/set-password`, where the client chooses their own password. The link works once. The login is created with a random password that nobody knows.
- **How the password is kept.** The password goes to Supabase Auth, which keeps only a hash (the same way as a login made for a new customer). The CRM does not store it, log it or audit it: it is taken out of the rows before they reach the database, so no database call, audit entry or activity ever contains it; it exists in the server's memory for the length of the request, and in that one e-mail. Because it is not kept, that e-mail cannot be sent again and the password cannot be shown again: if the e-mail did not go out (the screen says so), give the client the password yourself or send a set-password link; a client who forgets it uses "Forgot password?". The audit log records only who set a password for which customer (`CLIENT_PASSWORD_SET_BY_TEAM`).
- **Rules:** at least 10 characters (72 at most), not the e-mail address, and one e-mail per row. A password that breaks a rule is listed with its sheet and row, and nothing is saved until it is fixed. For a customer who already has a login the password is not used (the screen says so); they can use "Forgot password?".
- Two places hold the password as plain text: the Excel file and the client's e-mail. Keep the file somewhere private and **delete the column or the file as soon as the import is done**; the e-mail says to keep it private and offers "Forgot password?" for a new one (the same trade-off as the panel password e-mailed when a new customer's Meta verification is completed).
- **Forgot password?** on the client sign-in page sends a new link. The page gives the same answer whatever e-mail is entered, and a link is only ever sent to a client login, never to a staff account.

## Less typing in the template

The template does the repeating work (the import reads the sheets by their headings, so files made from the older template still import):

- **Set once** tab: "Data as of" (and, in the Team template, the Support Team Member) are typed once and used in every sheet.
- The **mobile number is typed once**, in "1 Customers". Sheets 2, 4 and 7 take it from a drop-down; **Customer (auto)** next to it shows the customer's business and name (red mobile = not in sheet 1).
- Sheets **3 WhatsApp Account, 5 AI Calling and 6 RCS & Voice list their customers by themselves**: every customer who has that service in "2 Services" appears, so only the numbers are typed. A row where nothing has been typed yet is skipped by the import.
- Worked out by the sheet (light green; type over any of them): the **renewal date** (Start Date + Billing Cycle), **Panel / Platform** (from the service), **Panel login** (the customer's e-mail), **Display Name**, **Messages in Package** (from the package), **Subscription ends / Valid until** (from "2 Services"), the **unit** of a monthly deliverable.
- A customer with several services has several rows in "2 Services"; a service with usage data that has no row there is added automatically (migration `20261117000200_import_auto_service.sql`).
- The templates are produced by `scripts/build_import_template.py` (run it only on a template that does not have these changes yet).

## What the client sees

- **My Services**: the plan or package, price, billing cycle, start and renewal dates, and status (Live, Setting up, Paused, Expired, Cancelled). It also shows:
  - a usage bar for WhatsApp messages (package + extra vs sent), AI Calling minutes (or credits), and RCS / Voice messages;
  - the details: quality rating, delivered/read/replies, calls connected, and so on;
  - the last 6 months of monthly deliverables.
- **Campaigns** (new page): every campaign with sent, delivered, read, replied and failed, plus percentages and totals.
- **Overview**: a low-balance alert when a package is 75% used or more (red from 90%), with an "Ask to top up" button that opens Tickets. "Customer since" comes from the sheet.

## Also changed

- The Department Head's **Customers** page shows the Team Member and Team Lead of customers the Support team added itself (imported or added by hand). Before, it only showed them for customers handed over by the Technical Consultant.
- Tickets raised by those clients go straight to their Team Member.

## Database (migration `20261101000100_customer_usage_import.sql`)

- `customers.customer_since`.
- New `customer_services` columns: `plan_name`, `price`, `billing_cycle`, `started_on`, `service_status`, `platform`, `panel_account` and `notes`.
- `service_usage` (one row per customer, service, kind and month) and `service_campaigns`. RLS is on and table grants are revoked, so both are reachable only through functions.
- Functions:
  - `import_customer_data(p_data, p_commit)`: check (preview) or save.
  - `record_imported_client_login` and `client_login_invite_target`.
  - `client_login_for_reset`: service key only.
  - `client_campaigns` and the extended `client_services` / `client_me`.
  - `head_customer_directory` and `private.client_ticket_owner`, updated for Support-added customers.
- The migration is re-runnable. Run it in the Supabase SQL editor like the others.

## API

- `POST /api/v1/customers/import-existing` with `{ commit: boolean, data: { customers, services, whatsapp, campaigns, aiCalling, rcsVoice, monthly } }`. The browser reads the Excel file and sends its rows as JSON.
- `POST /api/v1/customers/:id/client-password-email`: send the set-password e-mail again.
- `POST /api/v1/client-auth/forgot-password` with `{ email }`: no login needed; rate limited per IP.
- `GET /api/v1/client/campaigns`.

## Setup on the live site (one time)

1. **Supabase > Authentication > URL Configuration > Redirect URLs**: add `https://<your CRM domain>/client/set-password`. Without it, Supabase sends the client to the Site URL instead of the set-password page.
2. **Server environment**:
   - `APP_URL` = your CRM address (it is already used for staff links).
   - E-mail settings (`EMAIL_PROVIDER=smtp` with the meta@amuwa.com mailbox) and `AUTOMATION_MODE=live`, as for the onboarding e-mails.
   - With `AUTOMATION_MODE` not set to `live` (or no e-mail set up), logins are still created, and the import screen shows "E-mail not sent" with the reason. Use **Send again** once e-mail is on.
   - `AUTOMATION_TEST_RECIPIENTS` also limits these e-mails while you are testing.
3. **Optional: the Supabase "Reset password" e-mail template.** It is not used: the CRM sends its own e-mail. You can leave it as it is.

## Template with your real Support team (`Existing_Customers_Services_Usage_Team.xlsx`)

`public/templates/Existing_Customers_Services_Usage_Team.xlsx` is the same workbook plus a **Support Team** tab. Its names
feed a drop-down on *1 Customers > Support Team Member*, so nobody types a name wrongly.

Fill the tab with the real people. In the Supabase SQL editor run (read-only), then paste the four columns under the headers:

```sql
select p.full_name as "Support Team Member", case p.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end as "Role",
       t.name as "Team", p.email as "CRM e-mail"
  from public.profiles p
  join public.teams t on t.id = p.team_id and t.division = 'SUPPORT'
 where p.status = 'ACTIVE' and p.role in ('TEAM_MEMBER', 'TEAM_HEAD')
 order by t.name, p.role desc, p.full_name;
```

Only active Support Team Members and Team Leads can look after customers; the Department Head uploads the file and
names them. The upload rules above are unchanged.
