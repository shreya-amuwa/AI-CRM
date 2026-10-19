# Existing customers: Excel import, client logins and usage on the client dashboard

## Who uses it

| Who | Where | Whose customers |
| --- | --- | --- |
| Support Team Member | Sidebar > **Import Customers** | Always their own. The "Support Team Member" column is ignored. |
| Support Team Lead | Sidebar > **Import Customers** | The member named in the "Support Team Member" column (their own team only). |
| Department Head | Sidebar > **Import Customers** | The member named in the column (any Support team of the department). |

Write the member's name as it appears in the CRM. If two people share a name, use their CRM e-mail instead.

## Steps

1. **Download the template** from the Import screen (`/templates/Existing_Customers_Services_Usage.xlsx`). It has one tab per kind of data:
   1 Customers, 2 Services, 3 WhatsApp Account, 4 WhatsApp Campaigns, 5 AI Calling, 6 RCS & Voice, 7 Monthly Deliverables.
   The grey example rows (mobile 9820011111, or "EXAMPLE" in Notes) are skipped.
2. **Upload the filled file.** Every row is checked and nothing is saved yet. Any problem is listed with its sheet, row and what to fix, for example "1 Customers, row 3: Mobile Number must be a 10-digit Indian mobile number".
3. **Save.** All rows are saved together, or none if anything is wrong.
   - A mobile number that already exists in the department **updates** that customer; it is never added twice. Usage rows and campaigns are replaced as well, so importing the same file again is safe.
   - The caller must already look after that customer (its member, its Team Lead, or the Department Head).

Limits: one .xlsx file of up to 5 MB, 500 customers and 5000 rows in total.

## Client logins: no passwords anywhere

- Every row in "1 Customers" with a **Client Login E-mail** gets a client login when the file is saved.
- The client receives a **"Set your password"** e-mail from meta@amuwa.com. The link opens `/client/set-password`, where the client chooses their own password. The link works once.
- Nobody types, stores or sends a password. The login is created with a random password that nobody knows.
- After saving, the screen shows each login and whether its e-mail went out. **Send again** sends a fresh link.
- **Forgot password?** on the client sign-in page sends a new link. The page gives the same answer whatever e-mail is entered, and a link is only ever sent to a client login, never to a staff account.

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
