-- =============================================================================
-- Files in Cloudflare R2, with the file reference kept in Supabase.
--
-- New customer documents and invoice PDFs are uploaded to Cloudflare R2. For every file the database keeps:
--   storage_provider  where it lives: 'R2' (Cloudflare) or 'SUPABASE' (files stored before R2)
--   storage_bucket / storage_path   the logical bucket and the object path (R2 key = bucket + '/' + path)
--   storage_ref       the full reference of the stored object, e.g. r2://<r2 bucket>/customer-documents/<path>
--   storage_etag      the ETag R2 returned for the stored object (a fingerprint of the file)
--   size_bytes        the size R2 reported (already existed)
-- Old files keep working: rows from before this migration are 'SUPABASE'.
--
-- Customer documents may now be up to 2 MB each (invoice PDFs stay at 500 KB).
-- Additive / re-runnable.
-- =============================================================================
alter table public.customer_documents
  add column if not exists storage_provider text not null default 'SUPABASE' check (storage_provider in ('SUPABASE', 'R2')),
  add column if not exists storage_ref text,
  add column if not exists storage_etag text;

update public.customer_documents
   set storage_ref = 'supabase://' || storage_bucket || '/' || storage_path
 where storage_ref is null and storage_provider = 'SUPABASE';

comment on column public.customer_documents.storage_provider is 'Where the file is stored: R2 (Cloudflare) or SUPABASE (Supabase Storage).';
comment on column public.customer_documents.storage_ref is 'Reference of the stored object, e.g. r2://bucket/customer-documents/<path>.';
comment on column public.customer_documents.storage_etag is 'ETag the storage provider returned for the stored object.';

-- 2 MB per customer document (every document type except the invoice PDF)
update public.document_types set max_size_bytes = 2097152 where code <> 'INVOICE';
update public.document_types set max_size_bytes = 512000 where code = 'INVOICE';
-- Supabase Storage bucket (files that still go there, and the existing ones): same ceiling
update storage.buckets set file_size_limit = 2097152 where id = 'customer-documents';
