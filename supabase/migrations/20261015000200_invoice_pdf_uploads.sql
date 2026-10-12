-- =============================================================================
-- Upload existing invoice PDFs (Accounts), visible to every employee who may see the customer.
--
--  * Reuses the existing pieces: member_invoices (the invoice record, new kind UPLOADED),
--    customer_documents (versioned file metadata, document type INVOICE), the private
--    customer-documents bucket, signed single-path uploads, and the audited signed-URL
--    download. No new storage system, no duplicate customer / invoice / payment records.
--  * 500 KB per PDF: document_types.max_size_bytes (checked when the upload starts and
--    again when it completes) and the storage bucket's own file_size_limit.
--  * Only Accounts staff upload or replace. Replacing keeps the old file as a SUPERSEDED version.
--  * Read access follows the customer: Accounts, the owner, team / department heads, the
--    Technical Consultant of the customer, support staff of a post-sale customer, Super Admin.
--  * An invoice record exists only once its file was stored, so a failed upload leaves nothing behind.
-- Additive and re-runnable. Existing invoices, files and onboarding progress are untouched.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. 500 KB, and the data model
-- ---------------------------------------------------------------------------
update public.document_types set max_size_bytes = 512000 where code = 'INVOICE';
update storage.buckets set file_size_limit = 512000 where id = 'customer-documents';

alter table public.member_invoices drop constraint if exists member_invoices_kind_check;
alter table public.member_invoices add constraint member_invoices_kind_check check (kind in ('MANUAL', 'SERVICE', 'ADDON', 'UPLOADED'));
-- The total of an uploaded invoice is optional (Accounts may only have the PDF at hand).
alter table public.member_invoices alter column amount drop not null;

alter table public.customer_documents
  add column if not exists invoice_id uuid references public.member_invoices (id) on delete restrict,
  add column if not exists invoice_meta jsonb check (pg_column_size(invoice_meta) <= 4096);
do $$
begin
  alter table public.customer_documents add constraint customer_documents_invoice_only
    check ((invoice_id is null and invoice_meta is null) or document_type = 'INVOICE');
exception when duplicate_object then null;
end $$;

-- One current file per (customer, type) as before, except for uploaded invoices: those are
-- one current file per invoice, so a customer can have several invoices.
drop index if exists public.customer_documents_one_current_key;
create unique index customer_documents_one_current_key
  on public.customer_documents (customer_id, document_type) where status = 'UPLOADED' and invoice_id is null;
create unique index if not exists customer_documents_one_current_invoice_key
  on public.customer_documents (invoice_id) where status = 'UPLOADED' and invoice_id is not null;
create index if not exists customer_documents_invoice_idx on public.customer_documents (invoice_id, uploaded_at desc) where invoice_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Who may do what
-- ---------------------------------------------------------------------------
-- Everyone who may see the customer may read its invoice files (not only the owner).
create or replace function private.can_read_invoice_doc(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_accounts_staff()
      or private.can_access_customer(p_customer)
      or private.can_view_customer(p_customer)
      or private.can_view_onboarding_review(p_customer)
$$;
revoke all on function private.can_read_invoice_doc(uuid) from public, anon;
grant execute on function private.can_read_invoice_doc(uuid) to authenticated;

-- The general document policy lets whoever sees a customer list its files. For uploaded invoices only
-- the current file is listed to them: earlier versions and unfinished uploads are for Accounts.
drop policy if exists customer_documents_select on public.customer_documents;
create policy customer_documents_select on public.customer_documents for select to authenticated
  using (status <> 'DELETED' and exists (select 1 from public.customers c where c.id = customer_id)
         and (not (document_type = 'INVOICE' and (invoice_id is not null or invoice_meta is not null))
              or status = 'UPLOADED' or (select private.is_accounts_staff())));

-- Uploading and replacing: Accounts staff only (accounts_can_invoice already requires that).
drop policy if exists customer_documents_select_invoice on public.customer_documents;
create policy customer_documents_select_invoice on public.customer_documents for select to authenticated
  using (document_type = 'INVOICE' and status in ('PENDING', 'UPLOADED', 'SUPERSEDED')
         and ((select private.is_accounts_staff())
              or (status = 'UPLOADED' and private.can_read_invoice_doc(customer_id))));

-- ---------------------------------------------------------------------------
-- 3. The invoice as every view sees it: now with its current PDF
-- ---------------------------------------------------------------------------
create or replace function private.invoice_file_json(p_invoice uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with docs as (
    select d.*, row_number() over (order by d.uploaded_at, d.version) as nth
      from public.customer_documents d
     where d.invoice_id = p_invoice and d.status in ('UPLOADED', 'SUPERSEDED')),
  cur as (select * from docs where status = 'UPLOADED')
  select (select jsonb_build_object(
            'documentId', c.id, 'fileName', c.original_file_name, 'sizeBytes', c.size_bytes, 'mimeType', c.mime_type,
            'uploadedAt', c.uploaded_at, 'uploadedBy', (select full_name from public.profiles where id = c.uploaded_by),
            'version', c.nth, 'versionCount', (select count(*) from docs),
            -- earlier versions are for Accounts only
            'versions', case when private.is_accounts_staff() then
              coalesce((select jsonb_agg(jsonb_build_object(
                'documentId', o.id, 'fileName', o.original_file_name, 'sizeBytes', o.size_bytes, 'uploadedAt', o.uploaded_at,
                'uploadedBy', (select full_name from public.profiles where id = o.uploaded_by), 'version', o.nth) order by o.nth desc)
                from docs o where o.status = 'SUPERSEDED'), '[]'::jsonb)
              else '[]'::jsonb end)
          from cur c)
$$;
revoke all on function private.invoice_file_json(uuid) from public, anon, authenticated;

create or replace function private.invoice_json(i public.member_invoices)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', i.id, 'number', i.invoice_number, 'kind', i.kind, 'customerId', i.customer_id,
    'customer', coalesce(nullif(i.company, ''), i.customer_name), 'contact', i.customer_name,
    'customerCode', (select customer_code from public.customers where id = i.customer_id),
    'department', (select name from public.departments where id = coalesce(i.department_id, (select department_id from public.customers where id = i.customer_id))),
    'issueDate', nullif(i.issue_date, ''), 'dueDate', nullif(i.due_date, ''),
    'subtotal', coalesce(i.subtotal, i.amount), 'discount', coalesce(i.discount_total, 0), 'tax', coalesce(i.tax_total, 0), 'total', i.amount,
    'status', i.status, 'paidAt', i.paid_at, 'items', coalesce(i.details -> 'items', '[]'::jsonb), 'note', i.details ->> 'note',
    'reference', i.details ->> 'reference',
    'file', case when i.kind = 'UPLOADED' then private.invoice_file_json(i.id) end,
    'addonRequestId', i.addon_request_id,
    'issuedBy', (select full_name from public.profiles where id = coalesce(i.issued_by, i.owner_id)),
    'issuedAt', coalesce(i.issued_at, i.created_at), 'createdAt', i.created_at)
$$;
revoke all on function private.invoice_json(public.member_invoices) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Validation shared by "new invoice" and "replace"
-- ---------------------------------------------------------------------------
create or replace function private.check_invoice_pdf(p_mime text, p_size bigint)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  t public.document_types;
begin
  select * into t from public.document_types where code = 'INVOICE';
  if p_mime is distinct from 'application/pdf' then
    raise exception 'VALIDATION_ERROR: Only PDF files are accepted for invoices.' using errcode = 'P0001';
  end if;
  if coalesce(p_size, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: This file is empty.' using errcode = 'P0001';
  end if;
  if p_size > t.max_size_bytes then
    raise exception 'VALIDATION_ERROR: File size exceeds the % KB limit. Please upload a smaller PDF.', t.max_size_bytes / 1024 using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.check_invoice_pdf(text, bigint) from public, anon, authenticated;

create or replace function private.invoice_pending_doc(p_customer uuid, p_invoice uuid, p_meta jsonb, p_file_name text, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  d public.customer_documents;
begin
  insert into public.customer_documents (id, customer_id, document_type, version, status, storage_path,
                                         original_file_name, mime_type, size_bytes, uploaded_by, invoice_id, invoice_meta)
  values (v_id, p_customer, 'INVOICE', null, 'PENDING',
          format('customers/%s/invoices/%s.pdf', p_customer, v_id),
          left(regexp_replace(coalesce(nullif(btrim(p_file_name), ''), 'invoice.pdf'), '[\r\n\t/\\]', '_', 'g'), 255),
          'application/pdf', p_size, (select private.my_id()), p_invoice, p_meta)
  returning * into d;
  return d;
end $$;
revoke all on function private.invoice_pending_doc(uuid, uuid, jsonb, text, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Start an upload: a new invoice for a customer, or a replacement PDF for an invoice
--    (the browser then uploads to the single signed path; the API checks the stored file;
--     complete_document_upload creates / updates the invoice record).
-- ---------------------------------------------------------------------------
create or replace function public.begin_invoice_upload(
  p_customer uuid, p_invoice_number text, p_issue_date text, p_due_date text, p_amount numeric,
  p_reference text, p_note text, p_file_name text, p_mime text, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  v_no text := btrim(coalesce(p_invoice_number, ''));
  v_issue date; v_due date;
begin
  perform private.require_accounts_staff();
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not private.accounts_can_invoice(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_no = '' then
    raise exception 'VALIDATION_ERROR: Enter the invoice number.' using errcode = 'P0001';
  end if;
  if v_no !~ '^[A-Za-z0-9][A-Za-z0-9 ./#_-]{0,59}$' then
    raise exception 'VALIDATION_ERROR: The invoice number can use letters, numbers, spaces and - / . # _ (up to 60 characters).' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.member_invoices i where lower(i.invoice_number) = lower(v_no) and i.kind <> 'MANUAL') then
    raise exception 'CONFLICT: An invoice numbered % already exists.', v_no using errcode = 'P0001';
  end if;
  begin
    v_issue := nullif(btrim(coalesce(p_issue_date, '')), '')::date;
    v_due := nullif(btrim(coalesce(p_due_date, '')), '')::date;
  exception when others then
    raise exception 'VALIDATION_ERROR: Enter valid dates.' using errcode = 'P0001';
  end;
  if v_due is not null and v_issue is not null and v_due < v_issue then
    raise exception 'VALIDATION_ERROR: The due date cannot be before the issue date.' using errcode = 'P0001';
  end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 9999999999.99 or round(p_amount, 2) <> p_amount) then
    raise exception 'VALIDATION_ERROR: Enter the invoice total in rupees (up to 2 decimals).' using errcode = 'P0001';
  end if;
  if length(coalesce(p_reference, '')) > 120 or length(coalesce(p_note, '')) > 1000 then
    raise exception 'VALIDATION_ERROR: The reference or note is too long.' using errcode = 'P0001';
  end if;
  perform private.check_invoice_pdf(p_mime, p_size);
  return private.invoice_pending_doc(p_customer, null,
    jsonb_strip_nulls(jsonb_build_object('number', v_no, 'issueDate', v_issue::text, 'dueDate', v_due::text, 'amount', p_amount,
                                         'reference', nullif(btrim(coalesce(p_reference, '')), ''), 'note', nullif(btrim(coalesce(p_note, '')), ''))),
    p_file_name, p_size);
end $$;
revoke all on function public.begin_invoice_upload(uuid, text, text, text, numeric, text, text, text, text, bigint) from public, anon;
grant execute on function public.begin_invoice_upload(uuid, text, text, text, numeric, text, text, text, text, bigint) to authenticated;

create or replace function public.begin_invoice_replacement(p_invoice uuid, p_file_name text, p_mime text, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  inv public.member_invoices;
begin
  perform private.require_accounts_staff();
  select * into inv from public.member_invoices where id = p_invoice for update;
  if inv.id is null or inv.customer_id is null or not private.accounts_can_invoice(inv.customer_id) then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  if inv.kind <> 'UPLOADED' then
    raise exception 'CONFLICT: Only an uploaded invoice PDF can be replaced here.' using errcode = 'P0001';
  end if;
  perform private.check_invoice_pdf(p_mime, p_size);
  return private.invoice_pending_doc(inv.customer_id, inv.id, null, p_file_name, p_size);
end $$;
revoke all on function public.begin_invoice_replacement(uuid, text, text, bigint) from public, anon;
grant execute on function public.begin_invoice_replacement(uuid, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Finish / fail / open: the existing document functions, now aware of invoice files
-- ---------------------------------------------------------------------------
create or replace function public.complete_document_upload(p_document uuid, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
  v public.customers;
  t public.document_types;
  v_replaced public.customer_documents;
  v_inv boolean;
  m jsonb;
  inv public.member_invoices;
begin
  select * into d from public.customer_documents where id = p_document for update;
  v_inv := d.id is not null and d.document_type = 'INVOICE' and (d.invoice_id is not null or d.invoice_meta is not null);
  if d.id is null or not (case when v_inv then private.accounts_can_invoice(d.customer_id)
                               else private.can_access_customer(d.customer_id) or private.can_collect_addon_item(d.customer_id, d.document_type) end) then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  if d.status <> 'PENDING' then
    raise exception 'CONFLICT: This upload was already finished.' using errcode = 'P0001';
  end if;
  select * into t from public.document_types where code = d.document_type;
  if coalesce(p_size, 0) <= 0 or p_size > t.max_size_bytes then
    raise exception 'VALIDATION_ERROR: File size exceeds the % KB limit. Please upload a smaller PDF.', t.max_size_bytes / 1024 using errcode = 'P0001';
  end if;
  if v_inv then
    select * into v from public.customers where id = d.customer_id for update;
  else
    v := private.lock_collect_customer(d.customer_id, d.document_type);
  end if;

  -- A new uploaded invoice gets its record only now that the file is safely stored.
  if v_inv and d.invoice_id is null then
    m := d.invoice_meta;
    begin
      insert into public.member_invoices (owner_id, invoice_number, customer_name, company, amount, status, issue_date, due_date, details,
                                          customer_id, kind, department_id, issued_by, issued_at)
      values ((select private.my_id()), m ->> 'number', v.name, coalesce(v.company, ''), nullif(m ->> 'amount', '')::numeric, 'Pending',
              coalesce(m ->> 'issueDate', ''), coalesce(m ->> 'dueDate', ''),
              jsonb_strip_nulls(jsonb_build_object('note', m ->> 'note', 'reference', m ->> 'reference')),
              v.id, 'UPLOADED', v.department_id, (select private.my_id()), now())
      returning * into inv;
    exception when unique_violation then
      raise exception 'CONFLICT: An invoice numbered % already exists.', m ->> 'number' using errcode = 'P0001';
    end;
    update public.customer_documents set invoice_id = inv.id, invoice_meta = null where id = d.id returning * into d;
  elsif v_inv then
    select * into inv from public.member_invoices where id = d.invoice_id for update;
  end if;

  -- Only the file this one replaces: the same invoice, or (other documents) the same customer and type.
  update public.customer_documents set status = 'SUPERSEDED'
   where customer_id = d.customer_id and document_type = d.document_type and status = 'UPLOADED'
     and invoice_id is not distinct from d.invoice_id and id <> d.id
  returning * into v_replaced;

  update public.customer_documents
     set status = 'UPLOADED', size_bytes = p_size, uploaded_at = now(),
         version = coalesce((select max(x.version) from public.customer_documents x
                              where x.customer_id = d.customer_id and x.document_type = d.document_type), 0) + 1
   where id = p_document returning * into d;

  if v_inv then
    perform private.write_audit(case when v_replaced.id is null then 'INVOICE_UPLOADED' else 'INVOICE_REPLACED' end,
      'invoice', inv.id, v.department_id, v.team_id,
      jsonb_build_object('customer_id', d.customer_id, 'number', inv.invoice_number, 'document_id', d.id, 'file_name', d.original_file_name,
                         'size_bytes', p_size, 'replaced_document_id', v_replaced.id));
    perform private.log_customer_activity(d.customer_id, 'INVOICE_UPLOADED',
      format('Invoice %s PDF %s by Accounts', inv.invoice_number, case when v_replaced.id is null then 'uploaded' else 'replaced' end));
    perform private.notify(v.owner_id, 'INVOICE_UPLOADED', format('Invoice for %s', coalesce(v.company, v.name)),
      format('Accounts %s the PDF of invoice %s.', case when v_replaced.id is null then 'uploaded' else 'replaced' end, inv.invoice_number), 'customer', v.id);
  else
    perform private.write_audit(case when v_replaced.id is null then 'DOCUMENT_UPLOADED' else 'DOCUMENT_REPLACED' end,
      'customer_document', d.id, v.department_id, v.team_id,
      jsonb_build_object('customer_id', d.customer_id, 'document_type', d.document_type, 'version', d.version,
                         'replaced_document_id', v_replaced.id, 'size_bytes', p_size));
    perform private.log_customer_activity(d.customer_id, 'DOCUMENT_UPLOADED',
      format('%s %s (v%s)', t.label, case when v_replaced.id is null then 'uploaded' else 'replaced' end, d.version));
  end if;
  perform private.refresh_onboarding_progress(d.customer_id);
  return d;
end $$;
revoke all on function public.complete_document_upload(uuid, bigint) from public, anon;
grant execute on function public.complete_document_upload(uuid, bigint) to authenticated;

create or replace function public.fail_document_upload(p_document uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
  v_inv boolean;
begin
  select * into d from public.customer_documents where id = p_document for update;
  v_inv := d.id is not null and d.document_type = 'INVOICE' and (d.invoice_id is not null or d.invoice_meta is not null);
  if d.id is null or not (case when v_inv then private.accounts_can_invoice(d.customer_id)
                               else private.can_access_customer(d.customer_id) or private.can_collect_addon_item(d.customer_id, d.document_type) end) then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  if d.status <> 'PENDING' then
    raise exception 'CONFLICT: This upload was already finished.' using errcode = 'P0001';
  end if;
  update public.customer_documents set status = 'FAILED', invoice_meta = null where id = p_document;
  return d.storage_path;
end $$;
revoke all on function public.fail_document_upload(uuid) from public, anon;
grant execute on function public.fail_document_upload(uuid) to authenticated;

-- Viewing / downloading: the person must be allowed to see the customer. Earlier versions of an
-- uploaded invoice are for Accounts only.
create or replace function public.authorize_document_access(p_document uuid, p_action text)
returns table (storage_bucket text, storage_path text, original_file_name text, mime_type text)
language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
  v public.customers;
  v_ok boolean;
begin
  select * into d from public.customer_documents where id = p_document;
  if d.id is null or d.status not in ('UPLOADED', 'SUPERSEDED') then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  if d.document_type = 'INVOICE' then
    v_ok := private.is_accounts_staff()
         or (d.status = 'UPLOADED' and private.can_read_invoice_doc(d.customer_id))
         -- files Sales uploaded before invoices moved to Accounts keep their old access
         or (d.invoice_id is null and private.can_access_customer(d.customer_id));
  else
    v_ok := private.can_access_customer(d.customer_id) or private.can_view_onboarding_review(d.customer_id);
  end if;
  if not v_ok then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = d.customer_id;
  perform private.write_audit(case when p_action = 'DOWNLOAD' then 'DOCUMENT_DOWNLOADED' else 'DOCUMENT_VIEWED' end,
    'customer_document', d.id, v.department_id, v.team_id,
    jsonb_build_object('customer_id', d.customer_id, 'document_type', d.document_type, 'version', d.version, 'invoice_id', d.invoice_id));
  return query select d.storage_bucket, d.storage_path, d.original_file_name, d.mime_type;
end $$;
revoke all on function public.authorize_document_access(uuid, text) from public, anon;
grant execute on function public.authorize_document_access(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Accounts can correct the details of an uploaded invoice (total, dates, reference, note)
-- ---------------------------------------------------------------------------
create or replace function public.accounts_update_uploaded_invoice(
  p_invoice uuid, p_issue_date text, p_due_date text, p_amount numeric, p_reference text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inv public.member_invoices;
  v_issue date; v_due date;
begin
  perform private.require_accounts_staff();
  select * into inv from public.member_invoices where id = p_invoice for update;
  if inv.id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  if inv.kind <> 'UPLOADED' then
    raise exception 'CONFLICT: Only an uploaded invoice can be edited here.' using errcode = 'P0001';
  end if;
  begin
    v_issue := nullif(btrim(coalesce(p_issue_date, '')), '')::date;
    v_due := nullif(btrim(coalesce(p_due_date, '')), '')::date;
  exception when others then
    raise exception 'VALIDATION_ERROR: Enter valid dates.' using errcode = 'P0001';
  end;
  if v_due is not null and v_issue is not null and v_due < v_issue then
    raise exception 'VALIDATION_ERROR: The due date cannot be before the issue date.' using errcode = 'P0001';
  end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 9999999999.99 or round(p_amount, 2) <> p_amount) then
    raise exception 'VALIDATION_ERROR: Enter the invoice total in rupees (up to 2 decimals).' using errcode = 'P0001';
  end if;
  if length(coalesce(p_reference, '')) > 120 or length(coalesce(p_note, '')) > 1000 then
    raise exception 'VALIDATION_ERROR: The reference or note is too long.' using errcode = 'P0001';
  end if;
  update public.member_invoices
     set issue_date = coalesce(v_issue::text, ''), due_date = coalesce(v_due::text, ''), amount = p_amount,
         details = jsonb_strip_nulls(jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), ''), 'reference', nullif(btrim(coalesce(p_reference, '')), '')))
   where id = p_invoice returning * into inv;
  perform private.write_audit('INVOICE_UPDATED', 'invoice', inv.id, inv.department_id, null,
    jsonb_build_object('number', inv.invoice_number, 'total', inv.amount));
  return private.invoice_json(inv);
end $$;
revoke all on function public.accounts_update_uploaded_invoice(uuid, text, text, numeric, text, text) from public, anon;
grant execute on function public.accounts_update_uploaded_invoice(uuid, text, text, numeric, text, text) to authenticated;

-- One invoice (any viewer who may read it): used by the preview / download views.
create or replace function public.invoice_detail(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  inv public.member_invoices;
begin
  select * into inv from public.member_invoices where id = p_invoice;
  if inv.id is null or not private.can_read_invoice(inv) then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  return private.invoice_json(inv);
end $$;
revoke all on function public.invoice_detail(uuid) from public, anon;
grant execute on function public.invoice_detail(uuid) to authenticated;
