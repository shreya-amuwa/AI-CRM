# Google Sheet sync of existing customers

Migration `supabase/migrations/20270216000100_customer_sheet_sync.sql` (re-runnable, additive). Staff guide: `docs-site/content/support/importing-existing-customers.md`.

The Support team keeps one shared Google Sheet in the one-sheet import template. Instead of downloading and uploading it after every change, a person who may import
customers connects the sheet once and clicks **CRM Sync > Sync now** inside it. The Excel upload is unchanged and still available.

## Flow

1. **Connect** (Import Customers > Google Sheet sync, `POST /customers/sheet-sync`): the API makes a random key `crmss_<43 chars>`, the database stores only its
   SHA-256 hash and last 4 characters (`customer_sheet_connections`, one ACTIVE per person). The page builds the Apps Script (`src/lib/sheetSyncScript.ts`) with the
   CRM address and the key, shown once. A new key revokes the old one; `DELETE /customers/sheet-sync` disconnects.
2. **Sync now** (the script): reads the template tab (`Import`, or the first tab with the template's headings), sends the heading rows and the rows whose content changed since
   they were last saved (an MD5 of each row in a hidden `CRM Sync Hash` column), 400 rows per request, to `POST /api/v1/integrations/customer-sheet/sync` with
   `Authorization: Bearer <key>`. Dates are sent as `yyyy-mm-dd`. Each row's result is written to a `CRM Status` column. Nothing runs on a timer (`@OnlyCurrentDoc`).
3. **Server** (`server/services/SheetSyncService.ts`): checks the key's shape, rate-limits per key (12 / minute) and per IP, validates the body (`sheetSyncSchema`, at most
   2000 rows), rebuilds the sheet at its real row numbers and parses it with the Excel import's own parser (`shared/existingCustomerImport.ts`, moved from `src/lib`,
   which re-exports it). `Client Password` is dropped. Then `sheet_sync_apply(key_hash, data)` (service role only).
4. **Database** (`sheet_sync_apply`): finds the ACTIVE connection by the key hash (locked: one sync at a time per sheet), refuses a revoked key or an owner who is no longer
   active or allowed, then sets `request.jwt.claims` (and the active department) **for this transaction only** to the person who connected the sheet, so
   `import_customer_data` and every check inside it run exactly as if that person uploaded the file.
   - **Duplicates:** a mobile that is already a customer anywhere in the CRM is never added. If the person may update that customer, its customer-details row is dropped and
     the sheet updates services / usage only (`UPDATED`; the CRM's name, e-mail and owner are kept). Otherwise the row is held (`DUPLICATE`). A new mobile whose e-mail
     belongs to another customer is held as a possible duplicate.
   - **Row by row:** the import is all-or-nothing, so the function tries to save, leaves out the rows that failed (a NEW customer with all of its rows; for an existing
     customer only the failing row) and saves the rest; at most 5 rounds. Results: `ADDED`, `UPDATED`, `SAVED`, `DUPLICATE`, `ERROR`, `SKIPPED` (points at the row that
     stopped its customer).
   - Every sync is logged (`customer_sheet_sync_runs`, `last_result` on the connection) and shown on the Import page.
5. **Client logins** for customers the sheet added are created by the API after the save, recorded as the owner (`sheet_sync_record_login`), and the client gets the
   "Set your password" e-mail (needs `APP_URL`).

## Security

- The key is never stored (hash only), shown once, revocable; a malformed key never reaches the database. The sync endpoint has no other way in.
- A sync can do nothing the person who connected it could not do through the Excel upload, and stops working when they are suspended, revoked or lose Support access.
- Tables have RLS on and no grants; `sheet_sync_apply` / `sheet_sync_record_login` are granted to `service_role` only. Connect / disconnect are audited.

## Tests

`supabase/tests/customer_sheet_sync_test.sql` (database), the "Google Sheet sync" block in `supabase/tests/api_integration.test.ts` (HTTP), and
`supabase/tests/customer_sheet_sync.test.ts` (unit: the parser round trip, the key checks and the Apps Script run against a simulated sheet).
