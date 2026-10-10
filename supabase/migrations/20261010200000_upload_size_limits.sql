-- =============================================================================
-- Smaller uploads, to use Supabase storage sensibly.
--   Invoice               : 20 KB at most
--   Every other document  : 500 KB at most
-- Enforced by the database (document_types.max_size_bytes is checked when an
-- upload starts and again when it completes) and by the storage bucket itself.
-- Files already uploaded are not touched. Additive / idempotent.
-- =============================================================================

update public.document_types
   set max_size_bytes = case when code = 'INVOICE' then 20480 else 512000 end;

update storage.buckets set file_size_limit = 512000 where id = 'customer-documents';

-- Same as before, but the size message reads "20 KB" / "500 KB" instead of "0 MB".
create or replace function public.begin_document_upload(
  p_customer uuid, p_type text, p_file_name text, p_mime text, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_customer);
  t public.document_types;
  d public.customer_documents;
  v_id uuid := gen_random_uuid();
  v_ext text;
begin
  if v.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: Documents are collected once the customer is in onboarding.' using errcode = 'P0001';
  end if;
  select * into t from public.document_types where code = p_type;
  if t.code is null then
    raise exception 'VALIDATION_ERROR: Unknown document type.' using errcode = 'P0001';
  end if;
  if p_mime is null or not (p_mime = any (t.allowed_mime_types)) then
    raise exception 'VALIDATION_ERROR: This file type is not accepted for %.', t.label using errcode = 'P0001';
  end if;
  if coalesce(p_size, 0) <= 0 or p_size > t.max_size_bytes then
    raise exception 'VALIDATION_ERROR: File must be smaller than %.',
      case when t.max_size_bytes < 1048576 then (t.max_size_bytes / 1024) || ' KB' else (t.max_size_bytes / 1048576) || ' MB' end using errcode = 'P0001';
  end if;
  v_ext := case p_mime
    when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'text/csv' then 'csv' when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
    when 'audio/mpeg' then 'mp3' when 'audio/wav' then 'wav' when 'audio/mp4' then 'm4a' else 'bin' end;

  insert into public.customer_documents (id, customer_id, document_type, version, status, storage_path,
                                         original_file_name, mime_type, size_bytes, uploaded_by)
  values (v_id, p_customer, p_type, null, 'PENDING',
          format('customers/%s/%s/%s.%s', p_customer, t.storage_folder, v_id, v_ext),
          left(regexp_replace(coalesce(nullif(trim(p_file_name), ''), 'document.' || v_ext), '[\r\n\t/\\]', '_', 'g'), 255),
          p_mime, p_size, (select private.my_id()))
  returning * into d;
  return d;
end $$;
revoke all on function public.begin_document_upload(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.begin_document_upload(uuid, text, text, text, bigint) to authenticated;
