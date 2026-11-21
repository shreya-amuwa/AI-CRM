# Uploading customer details (Support Team Lead and Team Member)

On the **Add Customer** page, below the form, **Upload customer details** adds many customers at once.

1. Click **Download template** and fill it: one customer per row, up to 500 rows. Columns:
   `Name, Company, Phone, Email, Type, Status, Service, Requirement, Channel, Notes`.
   Only **Name** and a **phone or e-mail** are required. Type: Retail, Wholesale, Corporate or Other. Status: Active, Inactive or
   Prospect. Service: a service name from the list (several separated by `;`). Channel: Phone, WhatsApp, Email, Walk-in, Website or Other.
2. Save it as **CSV** (Excel: File > Save as > CSV; Google Sheets: File > Download > CSV) and choose the file.
3. The sheet is checked before anything is saved: "N ready, M with problems". Each problem names its row and what is wrong.
   Rows with problems are not uploaded; fix them in the sheet and upload again.
4. **Upload N customers**. Each row is saved exactly like the Add Customer form (same checks, assigned to you). A customer whose phone or
   e-mail already exists is skipped and listed with the reason, so nobody is added twice.

The customers are stored in the same customer table as every other customer, so they appear in the customer list and wherever the
customer data is used (for example the client dashboard).

## The Excel template: Relationship Manager, client dashboard login and several services (one row per customer)

**Download template** now gives `public/templates/Customer_Upload_Template.xlsx`: ONE sheet, one row per customer (up to 500):

| Columns | |
|---|---|
| Relationship Manager *, Customer Name *, Business Name *, Mobile * (10 digits), E-mail, City | The RM is the Support Team Member who looks after the customer, written as their name (or CRM e-mail) in the CRM. |
| Client Login E-mail, Client Password | The client dashboard login. A different e-mail for every client, not already a CRM login. The password is optional (10 to 72 characters, not the e-mail). |
| Service 1 to Service 5: Service, Plan, Price (₹), Billing Cycle, Start Date, Expiry Date, Status | One block per service bought. Service, Start Date and Status are required for a filled block. Dates DD-MM-YYYY. |
| Notes | |

Filled in Google Sheets: **File > Download > Microsoft Excel (.xlsx)** (or **Comma-separated values (.csv)**: the same sheet saved as CSV is recognised by its headings and read the same way), then choose it in **Upload customer details**. The `.xlsx` goes through the same
check and save as **Import Customers** (`POST /customers/import-existing`, `import_customer_data`; see `EXISTING_CUSTOMERS_IMPORT.md`), so nothing new runs on the server:

* Everything is **checked first** and nothing is saved while any row has a problem (the row number and what to fix are listed).
* A Team Lead / Department Head imports for the team: each customer goes to the **RM named on its row** (the database refuses a name that is not in
  their Support team). A Team Member who uploads gets the customers for themselves.
* Each filled service block becomes the customer's service with its plan, price, billing cycle, start and expiry date and status (the expiry date
  drives the renewal reminders).
* **Client logins** are created by the API after the save. With a Client Password the client is e-mailed the dashboard address, the login e-mail and that
  password; without one they get a link to choose their own. The password is taken out of the rows before the database sees them, hashed by Supabase Auth,
  and never stored or logged as text. Delete the Client Password column from the sheet after the upload.
* The grey example row (mobile 9820011111 / "EXAMPLE"; its name and business are placeholders such as `Customer_Name`, see `docs/SAMPLE_SHEETS.md`) is never imported. Rows with nothing typed are skipped.

The older CSV (`Name, Company, Phone, Email, Type, Status, Service, Requirement, Channel, Notes`) is still accepted exactly as before (the "CSV template" link).
Reader: `parseExistingCustomers` in `src/lib/existingCustomerImport.ts` (format `customer-rows`); tests in `supabase/tests/import_template.test.ts`.
