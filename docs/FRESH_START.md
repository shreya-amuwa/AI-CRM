# Fresh start: delete all test data and files, keep the Super Admin

For testing the whole application from the beginning. **Irreversible. Run it on the right project and take a backup first** (Supabase: Database > Backups; Cloudflare R2 has no undo).

## What stays / what goes
| Stays | Goes |
|---|---|
| The Super Admin account(s) (login + profile) | Every other person and login: Department Heads, Team Leads, Team Members, HR, Accounts, ... |
| Departments (incl. Wabatalk) and teams | All customers, leads, clients and **client logins** |
| Service catalogue and prices, monthly plans, GST states, document types, onboarding checklist templates | Services, payments, invoices, add-ons, tickets, tasks, chat, notifications |
| System settings (SLA, reminders, attribution rule, `crm_settings`) | HR / recruitment / training / attendance data, telecaller sheets, business-associate data, expenses, revenue attribution |
| The audit log (the database refuses to delete it by design; no customer data in it) | Every uploaded file (Supabase Storage and Cloudflare R2) |

Counters start again: customer codes, ticket numbers, invoice numbers (INV-YYYY-00001), quotation numbers.

## Steps
1. **Database.** Open `supabase/maintenance/reset_all_data_keep_super_admin.sql` in the Supabase SQL editor.
   * Run **STEP 1** (preview, changes nothing): it lists the Super Admin(s) that will stay and how many rows are removed from every table.
   * In **STEP 2** set `v_confirm` to exactly `DELETE EVERYTHING EXCEPT SUPER ADMIN` and run it. Any other text is refused. It is one transaction: it deletes everything or nothing. It also refuses to run if there is no active Super Admin with a login.
2. **Files** (from any computer with Node 20+, in the repo folder):
   ```
   SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role key> \
   R2_ACCOUNT_ID=<id> R2_ACCESS_KEY_ID=<key> R2_SECRET_ACCESS_KEY=<secret> R2_BUCKET=<bucket> \
     node scripts/purge-all-files.mjs                                          # lists, deletes nothing
   ... node scripts/purge-all-files.mjs --apply --confirm "DELETE ALL FILES"    # deletes
   ```
   It empties every Supabase Storage bucket (the buckets stay) and the CRM's folders in R2. Other keys in the R2 bucket are listed as "left alone" (add `--r2-everything` only if the CRM is the sole user of that bucket). Without the `R2_*` variables only Supabase Storage is cleared. Never paste the keys into chat or commit them.
3. **Sign in as the Super Admin** and create the people again (Department Heads, Team Leads, members, Accounts, HR); then give the shared heads their departments under *Departments & functions* (see [DEPARTMENT_SCOPES.md](DEPARTMENT_SCOPES.md)).

## Notes
* Browsers that were signed in as deleted users show the sign-in page after the next request; the Super Admin's own session continues.
* To keep another table (for example your HR job positions), add its name to `v_keep_tables` and to the `keep_tables` list in STEP 1 before running.
* Tested on a copy of the test database: afterwards only the Super Admin remained, every other table was empty, counters were back at 1, and the catalogue, departments and teams were intact.
