# Upload Leads (every Sales dashboard)

The Lead section of every Sales dashboard has two buttons side by side: **+ Add Lead** (unchanged) and **↑ Upload Leads**.
Upload Leads adds many leads at once from an Excel (`.xlsx`) or CSV (`.csv`) file. It is not a second lead system: every lead is made by the
same database function as Add Lead (`public.create_lead`), so it lands in the same `customers` table (stage LEAD), with the same rules.

## Who has it

| Employee | Dashboard | Where |
| --- | --- | --- |
| Sales Team Member (no Sales role) and Business Associate | Unified Sales dashboard | Leads (the shared `LeadsView`) |
| Telecaller | Telecaller dashboard | Leads (`telecaller/LeadsPage`) |
| Sales Team Lead | Team Lead dashboard | My Leads (the shared `LeadsView`) |
| Sales Department Head | Sales Department Head dashboard | My Leads (the shared `LeadsView`) |
| Influencer, Visit Sales, Business Partner | none yet (`/sales-role/:id` shows "dashboard not set up yet") | the database already allows them; the button appears once their dashboard has a Lead section |

The button is in the two shared Lead components, so every dashboard built on them gets it. It is shown only to Sales employees
(`canUploadLeads` in `src/lib/auth/roleMapping.ts`); Support, HR, Accounts and every other department do not see it, and the database
refuses them anyway (`private.can_upload_leads()`: an active Team Member or Team Lead of a Sales team, or the Sales Department Head).

## The upload window

1. **Download Sample Excel Template** / **Download Sample CSV Template** (made in the browser). Columns:
   Customer Name\*, Contact Person, Mobile Number\*, Email Address, Company Name\*, Business Type, Location, Interested Service\*, Lead Source,
   Lead Description, Follow-up Date, Assigned Employee. The example row of the template is skipped if it is left in the file.
2. **Drag and drop** the file or **Browse Files** (up to 5,000 leads and 5 MB). The first non-empty row is the heading row; each column is matched to
   a lead field by its heading (common other names such as *Mobile No*, *Business Name*, *City*, *Remarks* work) and the match can be changed.
3. **Preview**: the number of records detected and, for each row, **New lead**, **Duplicate lead** or **Invalid lead** with the reason and the row
   number, in tabs. The rows with problems can be downloaded, fixed and uploaded again (**Upload a corrected file**).
4. **Import N new leads**: the rows are sent in chunks of 100; a progress bar shows how far it is.
5. **Summary**: Total Records Uploaded, Leads Created, Duplicate Leads, Failed Records, Invalid Records and the Upload Batch ID, with
   **Failed records (Excel / CSV)**: every row that was not created, with its values and the reason, ready to fix and upload again.
6. **Your previous uploads**: the last 20 uploads with their counts and the same download.

## Field mapping

| Column | Lead field | Rule (the Add Lead rule) |
| --- | --- | --- |
| Customer Name | `name` | required, up to 200 |
| Contact Person | added to `notes` as "Contact person: …" | the lead has no separate contact-person field |
| Mobile Number | `phone` | required, a real 10-digit Indian mobile (+91 / 0 allowed); stored as 10 digits |
| Email Address | `email` | optional, valid e-mail |
| Company Name | `company` | required (the Add Lead "Business name") |
| Business Type | `business_category` | optional |
| Location | `city` | optional |
| Interested Service | `customer_services` | required; service names or codes from the catalogue, several separated by `;` |
| Lead Source | `lead_source` | empty = *Other*; a known source is written as the Add Lead form writes it |
| Lead Description | `notes` | optional |
| Follow-up Date | `next_follow_up_at` | DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD or an Excel date; 10:00 India time on that day |
| Assigned Employee | `owner_id` | see below |

## Ownership

* A lead belongs to **the person who uploads it** (Created By and Assigned To are the uploader), exactly as with Add Lead. Department and team
  follow the owner (the existing ownership trigger), Created Date is the import time, and `customers.lead_upload_batch_id` is the Upload Batch ID.
* **Assigned Employee** (the employee's e-mail, or their full name if it is unique in the department) may give a lead to someone else only where the
  existing rule already allows it (`private.can_assign_customer_owner`): a Team Member only themselves, a Team Lead their own Team Members, the Sales
  Department Head an employee of a Sales team of their department. Anything else makes that row invalid ("you cannot assign leads to this
  employee"); it is never given to the Super Admin or anybody else instead. The ownership trigger checks it again when the lead is created.
* Leads with the source *Field visit* from a Field Visit employee are routed to the Sales Department Head as before (the existing trigger).
* Visibility is unchanged: the uploaded leads are ordinary leads, seen by whoever already sees that owner's leads.

## Duplicates

The existing rule (`private.find_duplicate_customer`): the same e-mail, or the same last 10 digits of the mobile number, in the lead's department,
in any stage (lead, potential, onboarding, customer). Also a mobile number or e-mail that appears twice in the file. A duplicate is shown separately,
is never created, and never changes the existing record. The message names the existing record only if the uploader may open it.

## Reliability

* **Validated on both sides**: the browser reads the file; the API checks every row with the Add Lead schema (`leadUploadLeadSchema`, from
  `leadCreateSchema`); the database checks again (required values, mobile, e-mail, services, owner, duplicates) before calling `create_lead`.
* **Large files**: up to 5,000 rows, imported 100 rows per request. Each request is one transaction; inside it each row is its own sub-transaction,
  so a row that fails (marked *Failed* with a clear reason) leaves nothing half-made and does not stop the others.
* **No double import**: the upload has a request id (a double click or a retry starts nothing twice), each row is recorded once
  (`lead_upload_rows` primary key), so a retried chunk creates nothing again, uploads in one department run one at a time (advisory lock), and a
  file whose leads were already created cannot be imported again (`CONFLICT`). An upload interrupted by a closed tab can be resumed with **Import**
  in the same window; otherwise the next upload of the same file closes it as *Interrupted*, and the leads it made count as duplicates.
* **Notifications**: during an upload the per-lead "New customer" notification to the Team Lead is skipped; at the end one summary goes to each
  Team Lead of the teams the leads went to and to each employee who was given leads.
* **History and error log**: `lead_upload_batches` (who, when, file name / type / SHA-256, counts, status) and `lead_upload_rows` (every row's
  outcome and reason; the rows not created keep the values sent). Both tables have RLS on and no grants: only the uploader reads their own
  uploads, through the functions below. `LEAD_UPLOAD_COMPLETED` is written to the audit log; each lead also has its `CUSTOMER_CREATED` audit row
  and a `LEAD_UPLOADED` activity.

## API

| Method | Path | Database function |
| --- | --- | --- |
| POST | `/api/v1/lead-uploads/check` | `lead_upload_check(rows)`: preview, saves nothing |
| POST | `/api/v1/lead-uploads` | `lead_upload_start(request, file name, type, hash, total)` |
| POST | `/api/v1/lead-uploads/:id/rows` | `lead_upload_rows(batch, rows)`: up to 200 rows |
| POST | `/api/v1/lead-uploads/:id/finish` | `lead_upload_finish(batch)`: the summary |
| GET | `/api/v1/lead-uploads` | `lead_upload_history()` |
| GET | `/api/v1/lead-uploads/:id/issues` | `lead_upload_issues(batch)`: the rows not created |

## Rollout

Run `supabase/migrations/20270103000100_lead_bulk_upload.sql` once in the Supabase SQL editor (safe to run again; adds two tables, one nullable column,
one trigger and functions; redefines `private.tg_customers_after_write` with one added condition). Until it is run the button opens the window and the
preview shows the database error; nothing else changes.

## Tests

`supabase/tests/lead_upload.test.ts` (unit: headings, row rules, dates, writers), `supabase/tests/lead_upload_test.sql` (database: every Sales level,
ownership, assignment rules, duplicates, invalid rows, retries, history, refused roles) and the Upload Leads block of `api_integration.test.ts`.
