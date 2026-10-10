-- =============================================================================
-- Technical Consultant (TC) workflow: notes, Add-ons Services, return-to-leads rule.
--
--  1. accounts_return_to_leads: refused once a payment of the customer is
--     VERIFIED (decided from the persisted payment rows, not from the UI).
--  2. consultant_notes: the TC's consultation notes (append-only history, edit
--     by the author only), readable by the TC, the Department Head of the
--     department and the Super Admin (CEO).
--  3. Add-ons Services:
--       customer_onboarding.addons_required      Yes / No answer (null = not answered)
--       customer_onboarding.addons_submitted_*   "Send to Add-ons" (once)
--       customer_onboarding.addon_items_*        document progress of the add-ons
--     The add-on checklist is built from the same service catalogue and the same
--     onboarding_items as normal onboarding; entries live in the same table, so
--     a document is collected once and keeps its history and verification.
--     The TC can collect (save / upload / replace) the items of the add-on
--     services of a customer that was sent to Add-ons; sales access is unchanged.
--  4. consultant_start_onboarding: refused while add-ons are selected but the
--     customer has not been sent to Add-ons.
--  5. onboarding_review_counts: Customers panel excludes customers sent to
--     Add-ons; 'addons' counts them.
-- Additive / idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Return to Leads is not available once money is verified
-- ---------------------------------------------------------------------------
create or replace function public.accounts_return_to_leads(p_customer uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_customer_for_accounts(p_customer);
  r public.payment_requests;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 1000);
begin
  select * into r from public.payment_requests where customer_id = p_customer and status = 'PENDING' for update;
  if r.id is null or v.lifecycle_stage <> 'LEAD' or v.payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' then
    raise exception 'CONFLICT: This customer is not waiting for payment confirmation.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_payments where customer_id = p_customer and status = 'PENDING') then
    raise exception 'CONFLICT: Verify or reject the pending payments first, so nothing is left unaccounted for.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_payments where customer_id = p_customer and status = 'VERIFIED') then
    raise exception 'CONFLICT: A payment of this customer is already verified, so they cannot be returned to Leads. Confirm the payment and return them to Sales onboarding instead.' using errcode = 'P0001';
  end if;
  update public.payment_requests
     set status = 'RETURNED', resolved_by = (select private.my_id()), resolved_at = now(), resolution_note = v_reason
   where id = r.id;
  -- The lead, its conversations and every payment on record are kept as they are.
  update public.customers
     set payment_workflow = 'RETURNED_FROM_ACCOUNTS', lead_status = 'INTERESTED', next_follow_up_at = coalesce(next_follow_up_at, now())
   where id = p_customer;
  perform private.log_customer_activity(p_customer, 'RETURNED_FROM_ACCOUNTS',
    'Customer backed off at Accounts - returned to Leads' || coalesce(' · ' || v_reason, ''));
  perform private.write_audit('PAYMENT_RETURNED_TO_LEADS', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('request_id', r.id, 'reason', v_reason, 'verified', v.amount_verified));
  perform private.notify(v.owner_id, 'RETURNED_FROM_ACCOUNTS', format('Returned from Accounts: %s', coalesce(v.company, v.name)),
    coalesce(v_reason, 'The customer backed off. Please follow up.'),
    'customer', p_customer);
end $$;
revoke all on function public.accounts_return_to_leads(uuid, text) from public, anon;
grant execute on function public.accounts_return_to_leads(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Consultation notes
-- ---------------------------------------------------------------------------
create table if not exists public.consultant_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  -- Optional reference to the service the consultation was about.
  service_code text references public.crm_services (code) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists consultant_notes_customer_idx on public.consultant_notes (customer_id, created_at desc);
alter table public.consultant_notes enable row level security;
revoke all on public.consultant_notes from anon, authenticated;

-- Write: the Technical Consultant of the customer's department, while the customer is with the consultant.
create or replace function private.can_write_consultant_notes(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer and c.department_id = private.my_support_department_id()
      and private.can_view_onboarding_review(p_customer))
$$;
revoke all on function private.can_write_consultant_notes(uuid) from public, anon;
grant execute on function private.can_write_consultant_notes(uuid) to authenticated;

-- Read: the same consultants, the Department Head of the department, and the Super Admin (CEO).
create or replace function private.can_read_consultant_notes(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or c.department_id = private.my_support_department_id()))
$$;
revoke all on function private.can_read_consultant_notes(uuid) from public, anon;
grant execute on function private.can_read_consultant_notes(uuid) to authenticated;

create or replace function public.consultant_notes_list(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_read_consultant_notes(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', n.id, 'body', n.body, 'serviceCode', n.service_code,
      'author', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = n.author_id),
      'createdAt', n.created_at, 'updatedAt', n.updated_at,
      'canEdit', n.author_id = (select private.my_id()) and private.can_write_consultant_notes(p_customer))
      order by n.created_at desc, n.id)
    from public.consultant_notes n where n.customer_id = p_customer), '[]'::jsonb);
end $$;
revoke all on function public.consultant_notes_list(uuid) from public, anon;
grant execute on function public.consultant_notes_list(uuid) to authenticated;

create or replace function public.consultant_add_note(p_customer uuid, p_body text, p_service text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  v_body text := btrim(coalesce(p_body, ''));
  v_service text := nullif(btrim(coalesce(p_service, '')), '');
  v_id uuid;
begin
  if not private.can_write_consultant_notes(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if length(v_body) < 1 then
    raise exception 'VALIDATION_ERROR: Write the note first.' using errcode = 'P0001';
  end if;
  if length(v_body) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep the note under 4000 characters.' using errcode = 'P0001';
  end if;
  if v_service is not null and not exists (select 1 from public.crm_services where code = v_service) then
    raise exception 'VALIDATION_ERROR: Unknown service.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer;
  insert into public.consultant_notes (customer_id, author_id, body, service_code)
  values (p_customer, (select private.my_id()), v_body, v_service) returning id into v_id;
  perform private.write_audit('CONSULTANT_NOTE_ADDED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('note_id', v_id));
  return v_id;
end $$;
revoke all on function public.consultant_add_note(uuid, text, text) from public, anon;
grant execute on function public.consultant_add_note(uuid, text, text) to authenticated;

-- Only the author edits a note; the earlier text is kept in the audit log.
create or replace function public.consultant_update_note(p_note uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  n public.consultant_notes;
  v public.customers;
  v_body text := btrim(coalesce(p_body, ''));
begin
  select * into n from public.consultant_notes where id = p_note for update;
  if n.id is null or not private.can_write_consultant_notes(n.customer_id) then
    raise exception 'NOT_FOUND: Note not found.' using errcode = 'P0001';
  end if;
  if n.author_id is distinct from (select private.my_id()) then
    raise exception 'FORBIDDEN: Only the person who wrote a note can edit it.' using errcode = 'P0001';
  end if;
  if length(v_body) < 1 then
    raise exception 'VALIDATION_ERROR: Write the note first.' using errcode = 'P0001';
  end if;
  if length(v_body) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep the note under 4000 characters.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = n.customer_id;
  update public.consultant_notes set body = v_body, updated_at = now() where id = p_note;
  perform private.write_audit('CONSULTANT_NOTE_EDITED', 'customer', n.customer_id, v.department_id, v.team_id,
    jsonb_build_object('note_id', p_note, 'previous', n.body));
end $$;
revoke all on function public.consultant_update_note(uuid, text) from public, anon;
grant execute on function public.consultant_update_note(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Add-ons Services
-- ---------------------------------------------------------------------------
alter table public.customer_onboarding
  add column if not exists addons_required boolean,
  add column if not exists addons_submitted_at timestamptz,
  add column if not exists addons_submitted_by uuid references public.profiles (id) on delete set null,
  add column if not exists addon_items_total integer not null default 0,
  add column if not exists addon_items_saved integer not null default 0,
  add column if not exists addon_items_verified integer not null default 0,
  add column if not exists addon_items_rejected integer not null default 0;
create index if not exists customer_onboarding_addons_idx on public.customer_onboarding (addons_submitted_at) where addons_submitted_at is not null;

-- Catalogue codes of the add-on services selected for a customer (typed-by-hand add-ons have no code).
create or replace function private.customer_addon_codes(p_customer uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(a ->> 'code'), '{}'::text[])
    from public.customer_onboarding o, jsonb_array_elements(o.addons) a
   where o.customer_id = p_customer and a ->> 'code' is not null
$$;
revoke all on function private.customer_addon_codes(uuid) from public, anon, authenticated;

-- Items the TC collects for those add-on services: the same catalogue items as normal onboarding.
create or replace function private.customer_addon_items(p_customer uuid)
returns setof public.onboarding_items language sql stable security definer set search_path = '' as $$
  select i.* from public.onboarding_items i
   where i.is_active and i.filled_by = 'SALES' and not i.always_required and exists (
     select 1 from public.onboarding_item_services m
      where m.item_code = i.code and m.service_code = any (private.customer_addon_codes(p_customer)))
$$;
revoke all on function private.customer_addon_items(uuid) from public, anon, authenticated;

create or replace function private.refresh_addon_progress(p_customer uuid)
returns void language sql security definer set search_path = '' as $$
  with items as (select code, is_optional from private.customer_addon_items(p_customer)),
  e as (select i.code, i.is_optional, x.status
          from items i left join public.customer_onboarding_entries x on x.customer_id = p_customer and x.item_code = i.code)
  update public.customer_onboarding o set
    addon_items_total = (select count(*) from e where not is_optional or status is not null),
    addon_items_saved = (select count(*) from e where status in ('SAVED', 'VERIFIED')),
    addon_items_verified = (select count(*) from e where status = 'VERIFIED'),
    addon_items_rejected = (select count(*) from e where status = 'REJECTED')
  where o.customer_id = p_customer
$$;
revoke all on function private.refresh_addon_progress(uuid) from public, anon, authenticated;

create or replace function private.tg_entries_addon_progress()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_addon_progress(coalesce(new.customer_id, old.customer_id));
  return null;
end $$;
drop trigger if exists customer_onboarding_entries_addon_progress on public.customer_onboarding_entries;
create trigger customer_onboarding_entries_addon_progress after insert or update or delete on public.customer_onboarding_entries
  for each row execute function private.tg_entries_addon_progress();

create or replace function private.tg_onboarding_addons_progress()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_addon_progress(new.customer_id);
  return null;
end $$;
drop trigger if exists customer_onboarding_addons_progress on public.customer_onboarding;
create trigger customer_onboarding_addons_progress after update of addons on public.customer_onboarding
  for each row execute function private.tg_onboarding_addons_progress();

-- Who may collect (save / upload / replace) an add-on item: the department's TC, only after the customer was sent to Add-ons.
create or replace function private.can_collect_addon_item(p_customer uuid, p_item text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.customers c where c.id = p_customer and c.department_id = private.my_support_department_id())
     and private.can_review_onboarding(p_customer)
     and exists (select 1 from public.customer_onboarding o where o.customer_id = p_customer and o.addons_submitted_at is not null)
     and exists (select 1 from private.customer_addon_items(p_customer) i where i.code = p_item)
$$;
revoke all on function private.can_collect_addon_item(uuid, text) from public, anon;
grant execute on function private.can_collect_addon_item(uuid, text) to authenticated;

create or replace function private.lock_collect_customer(p_customer uuid, p_item text)
returns public.customers language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
begin
  if private.can_access_customer(p_customer) then
    return private.lock_accessible_customer(p_customer);
  end if;
  if not private.can_collect_addon_item(p_customer, p_item) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  return v;
end $$;
revoke all on function private.lock_collect_customer(uuid, text) from public, anon, authenticated;

-- The checklist of the add-on services, in the same shape as the normal checklist.
create or replace function public.customer_addon_checklist(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_codes text[];
begin
  if not (private.can_access_customer(p_customer) or private.can_view_onboarding_review(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  v_codes := private.customer_addon_codes(p_customer);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', i.code, 'section', i.section, 'label', i.label, 'hint', i.hint, 'kind', i.kind, 'options', i.options,
      'filledBy', i.filled_by, 'optional', i.is_optional,
      'serviceCode', (select m.service_code from public.onboarding_item_services m
                       join public.crm_services s on s.code = m.service_code
                      where m.item_code = i.code and m.service_code = any (v_codes) order by s.sort_order limit 1),
      'services', (select coalesce(jsonb_agg(m.service_code order by m.service_code), '[]'::jsonb) from public.onboarding_item_services m
                    where m.item_code = i.code and m.service_code = any (v_codes)),
      'allowedMimeTypes', t.allowed_mime_types, 'maxSizeBytes', t.max_size_bytes,
      'entry', case when e.item_code is null then null else jsonb_build_object(
        'status', e.status, 'value', e.value, 'documentId', e.document_id,
        'savedBy', (select full_name from public.profiles where id = e.saved_by), 'savedAt', e.saved_at,
        'reviewedBy', (select full_name from public.profiles where id = e.reviewed_by), 'reviewedAt', e.reviewed_at,
        'reviewNote', e.review_note) end)
      order by i.sort_order)
    from private.customer_addon_items(p_customer) i
    left join public.document_types t on t.code = i.code and i.kind = 'FILE'
    left join public.customer_onboarding_entries e on e.customer_id = p_customer and e.item_code = i.code), '[]'::jsonb);
end $$;
revoke all on function public.customer_addon_checklist(uuid) from public, anon;
grant execute on function public.customer_addon_checklist(uuid) to authenticated;

-- Saving a non-file item: also allowed for the TC on an add-on item.
create or replace function public.save_onboarding_entry(p_customer uuid, p_item text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_collect_customer(p_customer, p_item);
  i public.onboarding_items;
  v_value text := nullif(trim(coalesce(p_value, '')), '');
begin
  if v.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: Details are collected once the customer is in onboarding.' using errcode = 'P0001';
  end if;
  select * into i from (select * from private.customer_items(p_customer)
                         union all select * from private.customer_optional_items(p_customer)
                         union all select * from private.customer_addon_items(p_customer)) x where x.code = p_item limit 1;
  if i.code is null then
    raise exception 'VALIDATION_ERROR: This item is not part of this customer''s onboarding.' using errcode = 'P0001';
  end if;
  if i.kind = 'FILE' then
    raise exception 'VALIDATION_ERROR: Upload a file for this item.' using errcode = 'P0001';
  end if;
  if v_value is null then
    raise exception 'VALIDATION_ERROR: Enter a value.' using errcode = 'P0001';
  end if;
  if length(v_value) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep it under 4000 characters.' using errcode = 'P0001';
  end if;
  if i.kind = 'YES_NO' and v_value not in ('YES', 'NO') then
    raise exception 'VALIDATION_ERROR: Answer yes or no.' using errcode = 'P0001';
  end if;
  if i.kind = 'AMOUNT' and v_value !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
    raise exception 'VALIDATION_ERROR: Enter an amount in rupees.' using errcode = 'P0001';
  end if;
  if i.kind = 'CHOICE' and not (v_value = any (i.options)) then
    raise exception 'VALIDATION_ERROR: Choose one of the options.' using errcode = 'P0001';
  end if;

  insert into public.customer_onboarding_entries as e (customer_id, item_code, value, status, saved_by, saved_at)
  values (p_customer, p_item, v_value, 'SAVED', (select private.my_id()), now())
  on conflict (customer_id, item_code) do update
    set value = excluded.value, status = 'SAVED', saved_by = excluded.saved_by, saved_at = now(),
        reviewed_by = null, reviewed_at = null,
        review_note = case when e.status = 'REJECTED' then e.review_note end;

  perform private.log_customer_activity(p_customer, 'ONBOARDING_ITEM_SAVED', format('%s saved', i.label));
  perform private.write_audit('ONBOARDING_ITEM_SAVED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('item', p_item));
  perform private.refresh_onboarding_progress(p_customer);
end $$;
revoke all on function public.save_onboarding_entry(uuid, text, text) from public, anon;
grant execute on function public.save_onboarding_entry(uuid, text, text) to authenticated;

-- Uploads: unchanged rules; the TC may upload the documents of an add-on item.
create or replace function public.begin_document_upload(
  p_customer uuid, p_type text, p_file_name text, p_mime text, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_collect_customer(p_customer, p_type);
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

create or replace function public.complete_document_upload(p_document uuid, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
  v public.customers;
  t public.document_types;
  v_replaced public.customer_documents;
begin
  select * into d from public.customer_documents where id = p_document for update;
  if d.id is null or not (private.can_access_customer(d.customer_id) or private.can_collect_addon_item(d.customer_id, d.document_type)) then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  if d.status <> 'PENDING' then
    raise exception 'CONFLICT: This upload was already finished.' using errcode = 'P0001';
  end if;
  select * into t from public.document_types where code = d.document_type;
  if coalesce(p_size, 0) <= 0 or p_size > t.max_size_bytes then
    raise exception 'VALIDATION_ERROR: Uploaded file size is not allowed.' using errcode = 'P0001';
  end if;
  v := private.lock_collect_customer(d.customer_id, d.document_type);

  update public.customer_documents set status = 'SUPERSEDED'
   where customer_id = d.customer_id and document_type = d.document_type and status = 'UPLOADED'
  returning * into v_replaced;

  update public.customer_documents
     set status = 'UPLOADED', size_bytes = p_size, uploaded_at = now(),
         version = coalesce((select max(x.version) from public.customer_documents x
                              where x.customer_id = d.customer_id and x.document_type = d.document_type), 0) + 1
   where id = p_document returning * into d;

  perform private.write_audit(
    case when d.document_type = 'INVOICE' then (case when v_replaced.id is null then 'INVOICE_UPLOADED' else 'INVOICE_REPLACED' end)
         else (case when v_replaced.id is null then 'DOCUMENT_UPLOADED' else 'DOCUMENT_REPLACED' end) end,
    'customer_document', d.id, v.department_id, v.team_id,
    jsonb_build_object('customer_id', d.customer_id, 'document_type', d.document_type, 'version', d.version,
                       'replaced_document_id', v_replaced.id, 'size_bytes', p_size));
  perform private.log_customer_activity(d.customer_id, 'DOCUMENT_UPLOADED',
    format('%s %s (v%s)', t.label, case when v_replaced.id is null then 'uploaded' else 'replaced' end, d.version));
  perform private.refresh_onboarding_progress(d.customer_id);
  return d;
end $$;
revoke all on function public.complete_document_upload(uuid, bigint) from public, anon;
grant execute on function public.complete_document_upload(uuid, bigint) to authenticated;

create or replace function public.fail_document_upload(p_document uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
begin
  select * into d from public.customer_documents where id = p_document for update;
  if d.id is null or not (private.can_access_customer(d.customer_id) or private.can_collect_addon_item(d.customer_id, d.document_type)) then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  if d.status <> 'PENDING' then
    raise exception 'CONFLICT: This upload was already finished.' using errcode = 'P0001';
  end if;
  update public.customer_documents set status = 'FAILED' where id = p_document;
  return d.storage_path;
end $$;
revoke all on function public.fail_document_upload(uuid) from public, anon;
grant execute on function public.fail_document_upload(uuid) to authenticated;

-- Yes / No: does the customer need add-on services? Saved selections are never deleted by answering No.
create or replace function public.consultant_set_addons_required(p_customer uuid, p_required boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  o public.customer_onboarding;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_required is null then
    raise exception 'VALIDATION_ERROR: Choose Yes or No.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.addons_submitted_at is not null and not p_required then
    raise exception 'CONFLICT: This customer was already sent to Add-ons Services, so it cannot be switched back to No.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding set addons_required = p_required where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'ADDONS_REQUIRED_UPDATED',
    case when p_required then 'Customer needs add-on services' else 'Customer does not need add-on services' end);
end $$;
revoke all on function public.consultant_set_addons_required(uuid, boolean) from public, anon;
grant execute on function public.consultant_set_addons_required(uuid, boolean) to authenticated;

-- "Send to Add-ons": the customer joins the Add-ons Services workflow (once).
create or replace function public.consultant_send_to_addons(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.addons_submitted_at is not null then
    raise exception 'CONFLICT: This customer was already sent to Add-ons Services.' using errcode = 'P0001';
  end if;
  if o.consultant_started_at is not null then
    raise exception 'CONFLICT: This customer is already in onboarding.' using errcode = 'P0001';
  end if;
  if o.addons_required is not true then
    raise exception 'VALIDATION_ERROR: Answer Yes to "additional services" first.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(o.addons) = 0 then
    raise exception 'VALIDATION_ERROR: Select at least one add-on service.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding
     set addons_submitted_at = now(), addons_submitted_by = (select private.my_id())
   where customer_id = p_customer;
  perform private.refresh_addon_progress(p_customer);
  perform private.log_customer_activity(p_customer, 'SENT_TO_ADDONS',
    format('Sent to Add-ons Services (%s add-on%s)', jsonb_array_length(o.addons), case when jsonb_array_length(o.addons) = 1 then '' else 's' end));
  perform private.write_audit('CONSULTANT_SENT_TO_ADDONS', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('addons', o.addons));
  perform private.notify(v.owner_id, 'SENT_TO_ADDONS', format('Add-on services: %s', coalesce(v.company, v.name)),
    'The Technical Consultant is collecting the documents for the add-on services.', 'customer', p_customer);
end $$;
revoke all on function public.consultant_send_to_addons(uuid) from public, anon;
grant execute on function public.consultant_send_to_addons(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. "Send for onboarding" waits for "Send to Add-ons" when add-ons were chosen
-- ---------------------------------------------------------------------------
create or replace function public.consultant_start_onboarding(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.consultant_started_at is not null then
    raise exception 'CONFLICT: This customer is already in onboarding.' using errcode = 'P0001';
  end if;
  if coalesce(o.addons_required, false) and jsonb_array_length(o.addons) > 0 and o.addons_submitted_at is null then
    raise exception 'CONFLICT: Add-on services are selected. Use "Send to Add-ons" first.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding
     set consultant_started_at = now(), consultant_started_by = (select private.my_id())
   where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'ONBOARDING_STARTED_BY_CONSULTANT', 'Sent for onboarding by the Technical Consultant');
  perform private.write_audit('CONSULTANT_ONBOARDING_STARTED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('contract_signed', o.contract_signed, 'addons', o.addons));
  perform private.notify(v.owner_id, 'ONBOARDING_STARTED', format('Onboarding started: %s', coalesce(v.company, v.name)),
    'The Technical Consultant started onboarding. They will verify the documents next.', 'customer', p_customer);
end $$;
revoke all on function public.consultant_start_onboarding(uuid) from public, anon;
grant execute on function public.consultant_start_onboarding(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Counts: Customers panel vs Add-ons Services
-- ---------------------------------------------------------------------------
create or replace function public.onboarding_review_counts()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'all', count(*) filter (where o.consultant_started_at is not null),
    'TO_REVIEW', count(*) filter (where o.consultant_started_at is not null and o.review_state = 'TO_REVIEW'),
    'NEEDS_FIX', count(*) filter (where o.consultant_started_at is not null and o.review_state = 'NEEDS_FIX'),
    'VERIFIED', count(*) filter (where o.consultant_started_at is not null and o.review_state = 'VERIFIED'),
    'AWAITING_DOCUMENTS', count(*) filter (where o.consultant_started_at is not null and o.review_state = 'AWAITING_DOCUMENTS'),
    'WAITING_ON_SALES', count(*) filter (where o.consultant_started_at is not null and o.review_state = 'WAITING_ON_SALES'),
    'newCustomers', count(*) filter (where o.consultant_started_at is null and o.addons_submitted_at is null),
    'addons', count(*) filter (where o.addons_submitted_at is not null))
  from public.customers c
  join public.customer_onboarding o on o.customer_id = c.id
  where c.lifecycle_stage = 'ONBOARDING' and private.can_view_onboarding_review(c.id)
$$;
revoke all on function public.onboarding_review_counts() from public, anon;
grant execute on function public.onboarding_review_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Live updates: onboarding progress / add-on state reach open screens without a refresh
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.customer_onboarding;
  exception when duplicate_object then null; when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.customer_onboarding_entries;
  exception when duplicate_object then null; when undefined_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Editing the contact details: refuse a save made from a stale form
--    (p_expected = the updated_at the form was loaded with).
-- ---------------------------------------------------------------------------
drop function if exists public.consultant_update_customer(uuid, text, text, text, text);
create or replace function public.consultant_update_customer(
  p_customer uuid, p_name text, p_company text, p_phone text, p_email text, p_expected text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_updated timestamptz;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if length(v_name) < 2 then
    raise exception 'VALIDATION_ERROR: Enter the customer''s name.' using errcode = 'P0001';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'VALIDATION_ERROR: Enter a phone number or an e-mail address.' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: Enter a valid e-mail address.' using errcode = 'P0001';
  end if;
  if v_phone is not null and (v_phone !~ '^[0-9+()\-\s.]{5,25}$' or length(regexp_replace(v_phone, '\D', '', 'g')) < 7) then
    raise exception 'VALIDATION_ERROR: Enter a valid phone number (at least 7 digits).' using errcode = 'P0001';
  end if;
  select updated_at into v_updated from public.customers where id = p_customer for update;
  if p_expected is not null and v_updated is distinct from p_expected::timestamptz then
    raise exception 'CONFLICT: This customer was changed by someone else while you were editing. Close this and open it again to see the latest details.' using errcode = 'P0001';
  end if;
  begin
    update public.customers
       set name = v_name, company = nullif(trim(coalesce(p_company, '')), ''), phone = v_phone, email = v_email,
           updated_by = (select private.my_id())
     where id = p_customer;
  exception when unique_violation then
    raise exception 'CONFLICT: Another customer of this department already uses that e-mail address.' using errcode = 'P0001';
  end;
  perform private.log_customer_activity(p_customer, 'CUSTOMER_UPDATED', 'Details updated by the Technical Consultant');
end $$;
revoke all on function public.consultant_update_customer(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.consultant_update_customer(uuid, text, text, text, text, text) to authenticated;
