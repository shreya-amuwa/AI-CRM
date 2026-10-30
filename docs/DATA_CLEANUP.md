# Removing dummy / test customers

Two tools, run in this order. Both are safe by default (they only show what they would do).

## 1. The database rows: `supabase/maintenance/delete_dummy_customers.sql`

Run it in the Supabase SQL editor.

1. **Take a backup** if there is any chance a real customer is in the list (Supabase: Database > Backups).
2. Run the file once as it is. It lists how many rows it would delete from each table ("PREVIEW ONLY").
3. To **keep** some customers, uncomment and edit a line in *STEP 2* (by email, company, id or creation date).
4. To delete, change `''::text as confirm` in *STEP 1* to `'DELETE DUMMY CUSTOMERS'::text as confirm` and run it again.
   Any other text is refused. It deletes everything or nothing (one statement).
5. Run it once more with the confirmation empty: every count for the deleted customers is now 0.

It removes, for each selected customer: the customer record (lead, potential, onboarding or customer), services,
checklist, notes, conversations, activity log, uploaded documents, invoices, payments, payment requests and follow-ups,
add-on requests and payments, support tickets, invoice requests, work tasks, the email / WhatsApp message log, and the
client's app login. With `purge_history` (default on) it also removes the bell notifications and audit-log rows about them.
`reset_invoice_numbers = true` starts INV-YYYY-00001 again when no invoice is left.

Issued invoices and their lines, which the CRM never lets anyone delete, are removed too: this script is for test / demo data, so for the length of its one transaction it switches that protection off for the selected customers and switches it back on. **Do not run it on a database with real invoices you must keep.** It never touches staff, teams, departments or expenses. Finance totals shrink because they are calculated from the
payments. It was tested on a copy of the test database: all customer-linked tables ended empty, staff data was intact,
and a "keep one customer" run left that customer complete.

## 2. The uploaded files: `scripts/sweep-orphan-customer-files.mjs`

SQL cannot delete the files in Storage. After step 1, from any computer with Node:

```
SUPABASE_URL=https://<project>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role key> \
  node scripts/sweep-orphan-customer-files.mjs            # lists the files it would remove
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node scripts/sweep-orphan-customer-files.mjs --apply    # removes them
```

If your files are in Cloudflare R2, add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` to the same command and it sweeps R2 too.
It only removes files of customers that no longer exist in the database; files of kept customers are never touched.
Keep the service role key secret: do not paste it into chat or commit it.
