-- =============================================================================
-- Security: uploads are finished only after the SERVER has checked the stored file, and customers are deleted only
-- through delete_customer(). Findings SEC-2026-001 and SEC-2026-002 in docs/security/FINDINGS.md.
--
--  1. Upload completion bypass (High). The browser holds the Supabase URL and anon key, so a signed-in user (staff or
--     client) could call complete_document_upload / client_complete_document_upload / chat_complete_upload /
--     ticket_complete_upload straight through PostgREST with any size, skipping the API's look at the stored object
--     (it exists, its real size, its first bytes match the declared type). A file of any type or size could be marked
--     UPLOADED / READY and later opened by staff.
--     Now: after inspecting the stored object the API records an attestation (attest_upload, service role only) with
--     the size and ETag the STORAGE PROVIDER reported. A trigger on the three file tables refuses the PENDING ->
--     UPLOADED / READY step unless a fresh attestation exists with exactly the size being recorded; the attested ETag
--     replaces whatever the caller sent. Each attestation is used once.
--
--  2. Customer deletion bypass (High). authenticated held DELETE on public.customers with a policy that let a
--     Team Head (and Department Head) delete customers directly, skipping delete_customer(): its role rule (Super
--     Admin and the customer's Department Head only), its refusal while a verified payment exists, and the removal of
--     the stored files (they were left orphaned in storage). The direct privilege and policy are removed;
--     delete_customer() (SECURITY DEFINER) is unaffected.
--
-- Rollout: deploy the API that calls attest_upload FIRST, then run this migration (with the old API, uploads would be
-- refused until the new API is live). Nothing is deleted. Safe to run again.
-- =============================================================================

-- 1. Server attestations of stored files ----------------------------------------------------------------------------
create table if not exists private.upload_attestations (
  table_name  text        not null check (table_name in ('customer_documents', 'chat_attachments', 'support_ticket_attachments')),
  object_id   uuid        not null,
  size_bytes  bigint      not null check (size_bytes > 0),
  etag        text        check (etag is null or length(etag) <= 200),
  attested_at timestamptz not null default now(),
  primary key (table_name, object_id)
);
alter table private.upload_attestations enable row level security;
revoke all on private.upload_attestations from public, anon, authenticated;

-- What the storage provider reported for one uploaded object. Called by the API with the service role only.
create or replace function public.attest_upload(p_table text, p_object uuid, p_size bigint, p_etag text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_table is null or p_table not in ('customer_documents', 'chat_attachments', 'support_ticket_attachments') then
    raise exception 'VALIDATION_ERROR: Unknown upload kind.' using errcode = 'P0001';
  end if;
  if p_object is null or p_size is null or p_size < 1 then
    raise exception 'VALIDATION_ERROR: Invalid attestation.' using errcode = 'P0001';
  end if;
  insert into private.upload_attestations (table_name, object_id, size_bytes, etag, attested_at)
  values (p_table, p_object, p_size, left(nullif(btrim(coalesce(p_etag, '')), ''), 200), now())
  on conflict (table_name, object_id) do update
     set size_bytes = excluded.size_bytes, etag = excluded.etag, attested_at = excluded.attested_at;
  delete from private.upload_attestations where attested_at < now() - interval '1 day';
end $$;
revoke all on function public.attest_upload(text, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.attest_upload(text, uuid, bigint, text) to service_role;

-- The PENDING -> stored step needs a fresh attestation with the same size. Whatever function or path makes the change.
create or replace function private.tg_require_upload_attestation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_size bigint;
  v_etag text;
begin
  if old.status = 'PENDING' and new.status in ('UPLOADED', 'READY') then
    delete from private.upload_attestations a
     where a.table_name = tg_table_name and a.object_id = new.id and a.attested_at > now() - interval '1 hour'
    returning a.size_bytes, a.etag into v_size, v_etag;
    if v_size is null then
      raise exception 'VALIDATION_ERROR: The stored file has not been checked by the server. Please upload it again from the CRM.' using errcode = 'P0001';
    end if;
    if new.size_bytes is distinct from v_size then
      raise exception 'VALIDATION_ERROR: The file size does not match the stored file. Please upload it again.' using errcode = 'P0001';
    end if;
    if v_etag is not null then
      new.storage_etag := v_etag;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_require_upload_attestation() from public, anon, authenticated;

drop trigger if exists customer_documents_require_attestation on public.customer_documents;
create trigger customer_documents_require_attestation before update of status on public.customer_documents
  for each row execute function private.tg_require_upload_attestation();
drop trigger if exists chat_attachments_require_attestation on public.chat_attachments;
create trigger chat_attachments_require_attestation before update of status on public.chat_attachments
  for each row execute function private.tg_require_upload_attestation();
drop trigger if exists support_ticket_attachments_require_attestation on public.support_ticket_attachments;
create trigger support_ticket_attachments_require_attestation before update of status on public.support_ticket_attachments
  for each row execute function private.tg_require_upload_attestation();

-- 2. Customers are deleted only through delete_customer() ----------------------------------------------------------
drop policy if exists customers_delete on public.customers;
revoke delete on public.customers from authenticated;
