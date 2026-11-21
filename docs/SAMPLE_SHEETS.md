# Sample sheets and menu sections

## Sample sheets: what a person downloads before an upload

Every sheet upload in the CRM offers a **sample sheet** with the headings the CRM expects and, in the first row under them, **dummy details** that
only show what goes in each column. The dummy details are placeholders (`Customer_Name`, `Company_Name`, `Contact_Name` ...), never a real person,
business, mobile number or e-mail address. The made-up mobile number is `9000000000` and the e-mail address is on `example.com` (a domain
reserved for examples).

| Upload | Where | Sample | Skips its own sample row |
| --- | --- | --- | --- |
| **Sheet Upload** | Sales Department Head / Operations Head → Sheet Upload (and Lead Assign) | *Sample Excel sheet* and *Sample CSV* (new) | yes (new) |
| **Telecaller Sheets** | Department Head → Telecaller Sheets | *Sample Excel sheet* (new; this upload takes .xlsx only) | yes (new) |
| **Upload Leads** | the Upload Leads button beside Add Lead | Sample Excel / CSV Template (placeholders now) | yes (also the example row of earlier templates) |
| **Upload customers** | Support: Add customer → Upload customer details | `Customer_Upload_Template.xlsx` and a CSV template (placeholders now) | yes (the Excel example by its dummy mobile 9820011111 / `EXAMPLE`; the CSV example by its placeholder row, also the earlier one) |
| **Import existing customers** | Support: Import existing customers | `Existing_Customers_One_Sheet.xlsx` and the older tab-per-kind template (placeholders now) | yes (dummy mobile 9820011111 / `EXAMPLE`) |
| **Lead import** (Wabastore panel) | Import leads → Load Sample Format / Download Sample CSV | placeholders; the old sample had a comma inside a value | yes (new) |

**One place for the values:** `shared/sampleSheets.ts` (the placeholders, the headings of the contact sheet, and the "is this the sample row"
checks), `src/lib/sampleSheetDownload.ts` (the files that are downloaded) and `src/components/common/SampleSheetDownload.tsx` (the block shown on
the page). The rows are built from the same headings the upload reads, so a sample cannot drift from what is accepted.

**A sample row is skipped, never imported.** It is recognised by the exact placeholder name together with the made-up mobile number, so a real
contact that merely has the same name but another number is kept. A file that holds *only* the sample row is refused with "The sheet only has the
sample row. Replace it with your contacts, or add them below it." and the preview says "the sample row was skipped" when it left one out. The
line / row numbers shown for problems are always the file's own.

**Earlier downloads still work.** People may hold a template downloaded before this change; its example row (for example Upload Leads'
`Ravi Kumar` row, the customer CSV's `Asha Verma` row) is still recognised and skipped, so it does not become a lead or a customer.

### The shipped Excel templates (`public/templates/*.xlsx`)

The example rows of the four templates used real-sounding names (a customer, a Relationship Manager, a business, an agent). They now hold
placeholders: `Customer_Name`, `Relationship_Manager_Name`, `Referrer_Name`, `Support_Member_Name`, `Business_Name`, `City_Name`, `Business_Address`,
`Business_Category`, `Agent_Name`, `customer@example.com`. Services, plans, dates and numbers stay as they were: they show valid values and must match
the CRM's lists.

* `scripts/scrub_template_examples.py` replaces the names in the three templates that have no generator, changing only the text of the example
  cells (and comments). It is safe to run again.
* `scripts/build_one_sheet_template.py` builds `Existing_Customers_One_Sheet.xlsx`; its example data now uses the placeholders. It copies its lists
  from the Team template, so run the scrub first, then the builder.
* To add a template: put placeholders in its example row, keep the dummy mobile `9820011111` or the word `EXAMPLE` so the import skips the row,
  and add its file to the tests below (they scan every `.xlsx` in `public/templates`).

### Tests

`supabase/tests/sample_sheets.test.ts` (the placeholders, the parsers skipping the sample row, old samples still skipped, and every shipped
template free of real-sounding names), `supabase/tests/telecaller_sheet.test.ts`, and the real-browser `supabase/tests/ui_sample_sheets.test.mjs`
(the download, the file read back with the real Excel reader, and uploading the sample back through the real Sheet Upload and Telecaller Sheets pages).

## Side menus in sections

Every dashboard's side menu reads in labelled sections instead of one long list. The Sales Department Head / Operations Head and the Telecaller
had none, and the Team Lead had only partial sections; they now follow the pattern of the others (the Department Head, Team Member, Support, Accounts).

* **Sales Department Head / Sales Operations Head** (`src/components/sales-head/salesHeadNav.ts`): Overview (with the Operations Dashboard for the
  Operations Head) on top, then **Leads** (Leads, Sheet Upload, Telecaller Sheets, Field Visits, Lead Welcome WhatsApp), **My Sales** (My Leads, My Income),
  **Work** (Daily Tasks, Work Updates, Performance Management, Top Performers & Rankings), **Income & Reports** (Department Income, Incentive setup,
  Sales Reports, Reports), **Crocodial** (only when the person is connected or oversees connected people), **Customers** (Service Prices,
  Client Notices), **Team** (Team Members & Access, Telecaller, Business Associate) and **Communication** (Raise an Issue, Chat, Notification Center).
  Attendance and Meetings stay at the very top. Nothing was removed or renamed; only the grouping changed. The Crocodial entries are now flat
  entries of their own section (as on the Team Lead's menu) instead of one expandable entry.
* **Telecaller**: Home, then **Sales** (Leads, Field Visit, My Income), **Work** (Tasks, Reports) and **Team** (Raise an Issue).
* **Team Lead**: the Team Lead's own leads moved from the top group into a **Sales** section (Overview stays alone on top).

Tests: `supabase/tests/sales_head_nav.test.ts` (the sections, no entry lost or doubled against the old menu, the Operations Head differences,
Crocodial, and that every entry is a page that exists).
