---
title: Importing Existing Customers (One-Sheet Bulk Migration)
description: Step-by-step guide to migrating active customers, services, verified payments, invoices, revenue attribution, and Client Portal logins using the Import Customers wizard.
order: 6
group: Customer Onboarding & Migration
roles: [Support Team Member, Support Team Lead, Department Head]
audience: internal
status: verified
sources: [src/components/support/ExistingCustomerImport.tsx, src/components/support/SheetSyncPanel.tsx, shared/existingCustomerImport.ts, src/lib/sheetSyncScript.ts, shared/contracts.ts]
related: [support/support-leads-management, support/logging-client-activity, client/welcome-client-portal]
updated: 2026-10-27
---

The **Import Customers** wizard (`src/components/support/ExistingCustomerImport.tsx`) enables Support Team Members, Support Team Leads, and Department Heads to migrate existing active customers into Amuwa AI CRM in bulk—automatically provisioning active `CLIENT` records, purchased services, verified payment ledger rows, invoices, `ACQUISITION` revenue attribution, usage metrics, and Client Portal credentials.

## Before you start

:::prereq
- Sign in to the Support Dashboard and click **Import Customers** in the left sidebar (`Overview`, `My Leads`, `Team Leads`, `Import Customers`, `Client tickets`, `Client calendar`, `Client documents`, `My Tasks` / `Assigned Tasks`, `Leave Request`, `Chat`, `My Profile`).
- Prepare your customer data in the official Excel template (`.xlsx`, `.xls`, or `.csv`, maximum **5 MB**, up to **500 customers** per upload).
:::

## Downloading the Excel template

In **Import Customers**, download the official template before preparing your sheet:
- **2-Tab / One-Sheet Excel Template** (`/templates/existing-customer-import-template.xlsx` / `/templates/Existing_Customers_One_Sheet.xlsx`): Contains the **Import** data tab (with color-coded column blocks for Customer, Service, Payment, WhatsApp API, Campaigns, AI Calling, RCS & Voice, and Monthly Work) and the **Instructions / Reference** tab.
- **Multi-Tab Services & Usage Template** (`/templates/Existing_Customers_Services_Usage.xlsx`): Available if your team prefers separate tabs (`1 Customers`, `2 Services`, `3 WhatsApp Account`, `4 WhatsApp Campaigns`, `5 AI Calling`, `6 RCS & Voice`, `7 Monthly Deliverables`).

:::note Grey Example Rows Are Skipped Automatically
Keep the template header rows intact. The grey example rows at the top of the sheet (using mobile number `9820011111` or marked `EXAMPLE`) are automatically ignored by the parser.
:::

## Required vs optional columns

Each customer row in the import sheet supports the following core fields across Customer, Service, Commercial, and Portal Login blocks:

| Column Name | Requirement | Description & Validation Rules |
| --- | --- | --- |
| **`Customer Name`** | **Required** | Full name of the primary customer contact. |
| **`Phone` / `Mobile Number`** | **Required** | Valid 10-digit Indian mobile number (used as the unique key to link multiple service/campaign rows for the same customer). |
| **`Services` (`Service`)** | **Required** | Purchased service name(s) matching the CRM service catalog (for example, `Wabastore`, `Whatsbox`, `AI Calling`, `Amuwa Design Studio`). |
| **`Deal Value` / `Service Prices`** | **Required** | Agreed commercial value / price paid (`Price Paid (₹, excl. GST)` or `Deal Value` in whole Rupees). |
| **`Paid Amount`** | **Required** | Amount already paid by the customer and verified for historical ledger import. |
| **`GST Type`** | **Required** | Tax basis (`EXCLUDING_GST` / `INCLUDING_GST`) used to compute tax and invoice totals. |
| **`Assigned To`** (`Handled By - Support Team Member`) | **Required** *(for TL/DH)* | Support Team Member assigned as the Relationship Manager (auto-assigned to you when uploaded by a Support Team Member). |
| **`Email` (`E-mail` / `Client Login E-mail`)** | Optional *(Required for Portal Login)* | Customer email address. When provided, the importer automatically creates a Client Portal login. |
| **`Company Name` (`Business Name`)** | Optional | Registered company, shop, or brand name. |
| **`GSTIN`** | Optional | 15-character GST Identification Number for B2B tax invoices. |
| **`Payment Mode`** | Optional | Payment method (`UPI`, `NEFT`, `IMPS`, `RTGS`, `Cheque`, `Cash`, `Bank Transfer`). |
| **`Transaction Ref`** | Optional | Bank UTR or transaction reference number stored on the verified payment record. |
| **`Portal Password` (`Client Password`)** | Optional | Initial Client Portal login credential. If provided, the client receives an email with the portal URL, login email, and chosen credential (stored only as a secure hash in Supabase Auth). If left blank, the client receives a link to set their own credential. |

## File limits and format rules

- **Supported file types**: `.xlsx` (recommended), `.xls`, and `.csv`.
- **Maximum file size**: **5 MB** per upload (`MAX_BYTES = 5 * 1024 * 1024`).
- **Maximum batch size**: Up to **500 customers** per upload. If migrating a larger portfolio, split the spreadsheet into multiple files of up to 500 customers each.

## The 3-step import wizard

```flow
1. Upload File | Support Staff | Download template, fill customer rows, and upload file (<= 5 MB, <= 500 customers)
2. Preview & Validate | Dry-Run Validator | Calls /customers/import-existing with commit: false; shows Ready, Warning & Error badges
-> Validation Errors Found | Save Blocked | Fix highlighted sheet & row numbers and re-upload
3. Import Results | Atomic Commit | Calls /customers/import-existing with commit: true; creates CLIENT records, payments, invoices & portal logins
```

### Step 1: `1. Upload File`
1. Open **Support Dashboard > Import Customers**.
2. Click **Download the template** and populate your customer, service, and payment rows below the example rows.
3. Click **Choose Excel file** (or drag and drop your `.xlsx` / `.csv` file) to start the dry-run check.

### Step 2: `2. Preview & Validate`
Before anything is written to the database, the wizard runs a full server-side dry run (`POST /customers/import-existing` with `commit: false`) and displays a validation summary with status badges:
- **`Ready` (Green badge)**: Row passed all schema, service catalog, staff assignment, and duplicate checks and is ready to commit.
- **`Warning` (Amber badge)**: Non-blocking notice (for example, an unmapped optional column or extra whitespace that was ignored). You can review warnings and still proceed with saving.
- **`Error` (Red badge)**: Blocking validation problem (for example, invalid 10-digit mobile number, unrecognized service name, or unknown Support Team Member name), listed with the exact **Sheet** and **Row number**. All `Error` rows must be fixed before the **Save** button unlocks.

### Step 3: `3. Import Results`
1. Once zero blocking errors remain, click **Save** (`commit: true`).
2. All rows are committed atomically in a single transaction.
3. The **Import Results** screen summarizes every record created and lists the provisioned Client Portal accounts and email dispatch statuses.

## What is created automatically on import

When you complete Step 3 (`Import Results`), the CRM automatically provisions:
1. **Active `CLIENT` Records**: Each imported customer is created directly at `stage: 'CLIENT'` and assigned to their designated Support Relationship Manager.
2. **Verified Payments & Invoices**: Historical paid amounts are recorded as `VERIFIED` payment ledger entries alongside generated system invoices so balances are accurate from day one.
3. **`ACQUISITION` Revenue Attribution**: Brought-by Sales or Support attribution (`Brought By (Sales / Support)` and `Brought By - Name`) is recorded with `ACQUISITION` revenue attribution for management reporting.
4. **Service Subscriptions & Usage**: Active service plans, renewal dates, WhatsApp API metrics, campaigns, AI Calling minutes, RCS usage, and monthly deliverables populate the customer's dossier.
5. **Client Portal Credentials**: Customers with a login email receive active `/client/login` credentials and a welcome email so they can immediately view their services, usage, calendar, invoices, and support tickets.

## Syncing straight from a shared Google Sheet

Instead of downloading and uploading the file every time, keep **one shared Google Sheet** (the one-sheet template) and send it to the CRM from inside the sheet. The Excel upload above still works.

1. On **Import Customers**, under **Google Sheet sync**, click **Connect Google Sheet**. The CRM shows a ready-made Apps Script. **Copy it now**: it holds the sheet's secret key and is shown only once.
2. In the Google Sheet open **Extensions > Apps Script**, replace everything with the script and click **Save**. Reload the sheet.
3. A **CRM Sync** menu appears. Click **Sync now**. The first time, Google asks you to allow the script to edit this sheet and to connect to the CRM: allow both.
4. Each row gets its result in a new **CRM Status** column: ✅ *Added* or *Saved*, 🔁 *Updated* (the customer was already in the CRM: services and usage were updated, their details in the CRM were kept), ⚠️ *Possible duplicate* (held for you to check), ❌ *Fix this* (what to correct) or ⏸ *Not saved* (another row of that customer needs fixing first).
5. Add new customers to the sheet whenever you like and click **Sync now** again: only new and changed rows are sent. **Send every row again** sends all of them.

Rules: customers are saved with the permissions of the person who connected the sheet (a Team Member's customers are their own). A mobile number that is already a customer anywhere in the CRM is never added a second time, and a new mobile number with another customer's e-mail is held as a possible duplicate. The **Client Password** column is ignored: a client with a login e-mail gets an e-mail to choose their own password. Lost or shared the script? Click **Get a new script**: the old key stops working at once. **Disconnect** stops the sheet from sending anything; customers already saved stay.

## What you should see

:::result
After clicking **Save**, the wizard displays the **Saved / Import Results** confirmation card with counts of imported customers, services, verified payments, and provisioned Client Portal logins. Imported customers appear immediately in **Overview** (`Dashboard - Existing Customers`) and **My Clients**.
:::

## If something goes wrong

- **"The file is larger than 5 MB"**: Split your workbook into smaller batches (up to 500 customers per file) and upload each file sequentially.
- **"No rows are filled in"**: Ensure you added your customer rows *below* the grey example rows and did not use the example mobile number `9820011111`.
- **Row shows `Error` for `Assigned To` / `Handled By`**: Check that the Support Team Member's name or email matches an active user in the Support department.
