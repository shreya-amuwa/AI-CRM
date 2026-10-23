# Telecaller workspace

A **Telecaller** is a Sales team member with a Sales role. The role is stored on the profile (`profiles.sales_sub_role`); the
person stays in their Sales team and department. Run `supabase/run_this_telecaller.sql` (the migration
`20261118000100_telecaller.sql`) once in the Supabase SQL editor; it is safe to run again and changes no existing data.

## Who sets the Sales role
* The **Super Admin** and the **Department Head** (of that department) only - when creating a Team Member of a *Sales* team
  (the "Sales Role / Sales Sub-Role" dropdown appears only for a Sales team and never for Support), or later in
  *Team Members & Access* (a dropdown on each Sales member). Leaving it empty creates the same Sales member as before.
* The roles: Telecaller, Business Associate, Influencer, Visit Sales, Business Partner. The database (`set_sales_sub_role`) and the API
  (`POST /users/:id/sales-sub-role`, and `salesSubRole` on `POST /users`) both refuse anyone else, and a Team Lead or a Support member.

## Which dashboard opens
`profiles.default_dashboard` is computed by the database; the app maps it in `src/lib/auth/roleMapping.ts`:

| Person | Dashboard |
|---|---|
| Sales + Telecaller | Telecaller dashboard `/telecaller/dashboard/:id` |
| Sales + Business Associate / Influencer / Visit Sales / Business Partner | a "dashboard not set up yet" page `/sales-role/:id` (the role is stored; never another role's dashboard) |
| every other Sales member, Team Lead, Support, HR, Accounts, Department Head, Super Admin | unchanged |

The route guard (`src/utils/router.ts`) sends a Telecaller back to their own route and keeps everybody else out of it. This is navigation
only: every Telecaller API and table refuses anyone who is not an active Telecaller (`private.require_telecaller()`), whatever the browser says.

## Pages
* **Home** - Total Assigned Contacts, Calls Pending, Calls Completed (any call status other than Pending), Total Leads, Follow-ups Due Today
  (contacts and leads), Today's Focus and the quick actions. All counts come from `telecaller_home()`.
* **Tasks** - the sheets assigned to the Telecaller: sheet name, assignment date, assigned by, total / pending / completed; the contacts
  table; filters All, Pending, Contacted, Interested, Follow-up Required, Not Interested, Completed; search; pagination; a call dialog (status,
  remarks, follow-up date, "called just now"). Saved through `PATCH /telecaller/contacts/:id`.
* **Leads** - the leads the Telecaller owns: the existing Sales leads (`customers`, stage LEAD), so they stay in the Sales pipeline.
  *Lead Temperature* (Hot red, Warm amber, Cold blue) and *Call Status* are two separate fields. Add / View / Edit, search, filters, pagination.

## Assigning an Excel sheet (Department Head: *Telecaller Sheets*)
1. Choose the Telecaller, then the `.xlsx` file (up to 700 KB, at most 2,000 contacts). The first row needs the headings
   *Contact Name, Company Name, Phone Number, Email, Remarks* (Contact Name and Phone Number are required; common alternative headings work).
2. The file is read in the browser, and every row is checked again by the database. Nothing is saved while any row is wrong: the page lists each
   problem with its Excel row number and shows a preview of the valid rows.
3. **Confirm** assigns the contacts, notifies the Telecaller, and stores the original file in the private `telecaller-sheets` bucket (R2 or Supabase
   Storage, like invoices). The same file cannot be assigned twice to one person (SHA-256 of the file).

## Security
RLS: the sheet and contact tables can only be read by the assignee, the Super Admin, the Department Head of the department and the Team Lead of
the team; nobody can write them directly. Every change goes through a `SECURITY DEFINER` function that checks the caller. A Telecaller reads and
updates only their own contacts and leads (another Telecaller's id returns "not found"). No key is exposed to the browser; the service role is used
only on the server to record the stored file's reference.

## Tests
`supabase/tests/telecaller_test.sql` (database), the Telecaller block of `api_integration.test.ts` (API), `telecaller_sheet.test.ts` (Excel reader and
validation), and `supabase/tests/e2e/run-telecaller.sh` (real browser: creation form, upload, Home / Tasks / Leads, routing, permissions, phone width).
