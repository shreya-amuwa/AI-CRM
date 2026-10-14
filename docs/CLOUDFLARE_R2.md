# Files in Cloudflare R2

Customer documents and invoice PDFs are stored in **Cloudflare R2**. **Supabase keeps the reference** to every file.

## How it works

1. A staff member (or Accounts, for an invoice) picks a file. The browser asks the API to start an upload. The database
   checks who they are, which customer, the file type and the size, and creates the document row (`PENDING`).
2. The server makes a **presigned PUT link for exactly that one object** (valid 15 minutes, only for the declared
   content type) and returns it. The browser uploads the file **straight to R2**: it never goes through our server and no
   R2 key is ever in the browser.
3. The browser tells the API it is done. The server asks R2 for the object (HEAD + the first bytes), checks that it
   exists, that its **size** is within the limit and that its **content matches its type** (a renamed file is refused and
   deleted from R2), then the database marks the document `UPLOADED`.
4. **Supabase stores the file reference** on the `customer_documents` row:

   | Column | What it holds |
   | --- | --- |
   | `storage_provider` | `R2` (Cloudflare) or `SUPABASE` (files stored before R2) |
   | `storage_bucket`, `storage_path` | the logical bucket (`customer-documents`) and the object path (ids only, never names) |
   | `storage_ref` | the full reference, e.g. `r2://<bucket>/customer-documents/customers/<customer id>/...` |
   | `storage_etag` | the ETag R2 returned for the stored object (a fingerprint of the file) |
   | `size_bytes` | the size R2 reported |

5. Viewing or downloading: the API checks permission in the database first, then returns a **short-lived signed R2 link**
   (2 minutes). The bucket is private, so a link cannot be guessed or reused later. Each view/download is audited as before.

Files stored before R2 stay in Supabase Storage and keep opening (their `storage_provider` is `SUPABASE`). Nothing has to
be migrated for the app to work.

## Limits

* **Customer documents: up to 2 MB each** (PDF, images, and the other accepted types for each item).
* Invoice PDFs: PDF only, up to 500 KB (unchanged).
* The limit is checked by the database when the upload starts and again from the size R2 reports when it finishes.

## Setup (one time)

1. **Cloudflare -> R2 -> Create bucket** (keep it **private**: no public access, no custom public domain).
2. **R2 -> Manage API tokens -> Create API token**: permission **Object Read & Write**, limited to that bucket. Copy the
   **Access Key ID** and **Secret Access Key** (shown once) and your **Account ID**.
3. **Bucket -> Settings -> CORS policy**. The browser uploads directly to R2, so allow your app's address:

   ```json
   [
     {
       "AllowedOrigins": ["https://ai-crm-drab.vercel.app"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["Content-Type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Use your real address (and add `http://localhost:3000` for local development). Without this, uploads fail with
   "the browser could not reach file storage".
4. **Vercel -> Project -> Settings -> Environment Variables** (Production, and Preview if you use it):

   ```
   R2_ACCOUNT_ID=<account id>
   R2_ACCESS_KEY_ID=<access key id>
   R2_SECRET_ACCESS_KEY=<secret access key>
   R2_BUCKET=<bucket name>
   STORAGE_PROVIDER=r2        # optional: R2 is used automatically when the four values above are set
   ```

   Never put these in the browser (no `VITE_` prefix), in the repository or in chat.
5. Run the migration `supabase/migrations/20261020000100_r2_file_references.sql` in the Supabase SQL editor (adds the
   reference columns and raises the customer-document limit to 2 MB), then **redeploy**.

To go back to Supabase Storage for new files, set `STORAGE_PROVIDER=supabase` (or remove the R2 variables) and redeploy.

## Moving the old files to R2 (optional)

Not needed for the app to work. If you want everything in R2, copy the objects of the Supabase bucket
`customer-documents` into the R2 bucket **under the same key** (`customer-documents/<path>`; for example with `rclone`
using Supabase's S3 endpoint), then run:

```sql
update public.customer_documents
   set storage_provider = 'R2', storage_ref = 'r2://<bucket>/' || storage_bucket || '/' || storage_path
 where storage_provider = 'SUPABASE';
```

Do this only after every object has been copied; until then those rows must stay `SUPABASE`.

## Cleaning up

`node scripts/sweep-orphan-customer-files.mjs` also sweeps R2 when the `R2_*` variables are set (see `docs/DATA_CLEANUP.md`).

## Where the code is

`server/storage/*` (R2 and Supabase drivers, SigV4 presigner, provider choice), `server/repositories/StorageRepository.ts`
(picks the provider per file and records the reference), `src/lib/uploadToTicket.ts` (browser upload).
Tests: `supabase/tests/api_integration.test.ts` ("Cloudflare R2" block, against a fake R2 that verifies the signatures in
`supabase/tests/fake-r2.ts`); the signer matches AWS's published SigV4 test vector.
