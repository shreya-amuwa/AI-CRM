-- =============================================================================
-- Sales dashboard fixes.
--
--  1. "Paid in full": a potential customer whose payments reach the deal
--     amount is PAID (not "Part paid", never "Overdue").
--  2. Business basics no longer ask for the GST / Udyam certificates: they
--     go into "All Important Documents" (single combined PDF).
--  3. WABA ID is filled in by the Technical Consultant (it exists only after
--     the customer panel is created), not by sales. "Current pricing approved
--     by client" is removed.
--
-- Built on 20261008000100/0200 (send to consultant, return to sales): those
-- functions are NOT redefined. They use private.customer_items(), which now
-- returns only the items sales fills in, so consultant items never block
-- "Send to Technical Consultant" and are never "Not authorized".
-- customer_pipeline_counts() is redefined from its 20261008000200 version
-- with only the Potential part changed.
-- Additive / idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Paid in full
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists fully_paid boolean generated always as
    (deal_amount is not null and deal_amount > 0 and amount_received >= deal_amount) stored;

create or replace function public.customer_pipeline_counts()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with c as (
    select c.lifecycle_stage, c.lead_status, c.amount_received, c.payment_due_date, c.fully_paid,
           coalesce(o.items_saved, 0) as saved, coalesce(o.items_total, 0) as total,
           o.returned_at is not null as returned
    from public.customers c
    left join public.customer_onboarding o on o.customer_id = c.id
    where c.lifecycle_stage in ('LEAD', 'POTENTIAL', 'ONBOARDING')
      and private.can_access_customer(c.id)
  ), m as (select count(*) as n from public.document_types where is_mandatory)
  select jsonb_build_object(
    'leads', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'LEAD'),
      'NEW', count(*) filter (where lifecycle_stage = 'LEAD' and lead_status = 'NEW'),
      'CONTACTED', count(*) filter (where lifecycle_stage = 'LEAD' and lead_status = 'CONTACTED'),
      'INTERESTED', count(*) filter (where lifecycle_stage = 'LEAD' and lead_status = 'INTERESTED'),
      'READY_TO_BUY', count(*) filter (where lifecycle_stage = 'LEAD' and lead_status = 'READY_TO_BUY')),
    -- Same predicates as the Potential list filters.
    'potential', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'POTENTIAL'),
      'AWAITING', count(*) filter (where lifecycle_stage = 'POTENTIAL' and not fully_paid and amount_received = 0 and payment_due_date >= current_date),
      'PART_PAID', count(*) filter (where lifecycle_stage = 'POTENTIAL' and not fully_paid and amount_received > 0 and payment_due_date >= current_date),
      'OVERDUE', count(*) filter (where lifecycle_stage = 'POTENTIAL' and not fully_paid and payment_due_date < current_date),
      'PAID', count(*) filter (where lifecycle_stage = 'POTENTIAL' and fully_paid)),
    'onboarding', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'ONBOARDING'),
      'RETURNED', count(*) filter (where lifecycle_stage = 'ONBOARDING' and returned),
      'WAITING_ON_CLIENT', count(*) filter (where lifecycle_stage = 'ONBOARDING' and not returned and saved = 0),
      'COLLECTING', count(*) filter (where lifecycle_stage = 'ONBOARDING' and not returned and saved > 0 and saved < total),
      'READY_FOR_HANDOVER', count(*) filter (where lifecycle_stage = 'ONBOARDING' and not returned and total > 0 and saved >= total)),
    'mandatoryDocuments', (select n from m))
  from c
$$;
revoke all on function public.customer_pipeline_counts() from public, anon;
grant execute on function public.customer_pipeline_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 2 + 3. Checklist catalogue changes
-- ---------------------------------------------------------------------------
alter table public.onboarding_items
  add column if not exists filled_by text not null default 'SALES' check (filled_by in ('SALES', 'CONSULTANT'));

update public.onboarding_items set is_active = false
 where code in ('GST_CERTIFICATE', 'UDYAM_CERTIFICATE', 'WA_PRICING_APPROVED');

update public.onboarding_items
   set filled_by = 'CONSULTANT',
       hint = 'Enter the WABA ID once the customer panel is created in the company portal'
 where code = 'WABA_ID';

update public.onboarding_items
   set hint = 'Upload the customer''s important business documents, such as Aadhaar Card, PAN Card, GST Certificate, Udyam Certificate and other required documents, combined into a single PDF.'
 where code = 'IMPORTANT_DOCUMENTS';
update public.document_types
   set description = 'Upload the customer''s important business documents, such as Aadhaar Card, PAN Card, GST Certificate, Udyam Certificate and other required documents, combined into a single PDF.'
 where code = 'IMPORTANT_DOCUMENTS';

-- Items sales fills in (used by save, progress, send-to-consultant, authorize all).
create or replace function private.customer_items(p_customer uuid)
returns setof public.onboarding_items language sql stable security definer set search_path = '' as $$
  select i.* from public.onboarding_items i
  where i.is_active and i.filled_by = 'SALES' and (i.always_required or exists (
    select 1 from public.onboarding_item_services m
    join public.customer_services cs on cs.service_code = m.service_code and cs.customer_id = p_customer
    where m.item_code = i.code))
$$;

-- Items the Technical Consultant fills in for this customer (e.g. WABA ID).
create or replace function private.customer_consultant_items(p_customer uuid)
returns setof public.onboarding_items language sql stable security definer set search_path = '' as $$
  select i.* from public.onboarding_items i
  where i.is_active and i.filled_by = 'CONSULTANT' and (i.always_required or exists (
    select 1 from public.onboarding_item_services m
    join public.customer_services cs on cs.service_code = m.service_code and cs.customer_id = p_customer
    where m.item_code = i.code))
$$;
revoke all on function private.customer_consultant_items(uuid) from public, anon, authenticated;

-- Consultant progress, kept apart from the sales progress columns.
alter table public.customer_onboarding
  add column if not exists consultant_items_total integer not null default 0,
  add column if not exists consultant_items_done integer not null default 0;

create or replace function private.refresh_onboarding_progress(p_customer uuid)
returns void language sql security definer set search_path = '' as $$
  with items as (select code from private.customer_items(p_customer)),
  e as (
    select e.status from public.customer_onboarding_entries e
    join items i on i.code = e.item_code
    where e.customer_id = p_customer),
  ci as (select code from private.customer_consultant_items(p_customer))
  update public.customer_onboarding o set
    mandatory_saved = (
      select count(distinct d.document_type) from public.customer_documents d
      join public.document_types t on t.code = d.document_type and t.is_mandatory
      where d.customer_id = p_customer and d.status = 'UPLOADED'),
    items_total = (select count(*) from items),
    items_saved = (select count(*) from e where status in ('SAVED', 'VERIFIED')),
    items_verified = (select count(*) from e where status = 'VERIFIED'),
    items_rejected = (select count(*) from e where status = 'REJECTED'),
    consultant_items_total = (select count(*) from ci),
    consultant_items_done = (select count(*) from public.customer_onboarding_entries x
                              join ci on ci.code = x.item_code where x.customer_id = p_customer)
  where o.customer_id = p_customer
$$;

-- "Authorized" also needs the consultant's own items (WABA ID) filled in.
alter table public.customer_onboarding drop column if exists review_state;
alter table public.customer_onboarding
  add column review_state text generated always as (
    case when items_rejected > 0 then 'NEEDS_FIX'
         when items_total > 0 and items_verified >= items_total and consultant_items_done >= consultant_items_total then 'VERIFIED'
         when items_saved > items_verified or (items_total > 0 and items_verified >= items_total) then 'TO_REVIEW'
         else 'AWAITING_DOCUMENTS' end) stored;

-- Checklist for one customer: sales items plus consultant items ("filledBy").
create or replace function public.customer_onboarding_checklist(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not (private.can_access_customer(p_customer) or private.can_review_onboarding(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'code', i.code, 'section', i.section, 'label', i.label, 'hint', i.hint, 'kind', i.kind, 'options', i.options,
      'filledBy', i.filled_by,
      'serviceCode', (select m.service_code from public.onboarding_item_services m
                       join public.customer_services cs on cs.service_code = m.service_code and cs.customer_id = p_customer
                       join public.crm_services s on s.code = m.service_code
                      where m.item_code = i.code order by s.sort_order limit 1),
      'services', (select coalesce(jsonb_agg(m.service_code order by m.service_code), '[]'::jsonb) from public.onboarding_item_services m
                    join public.customer_services cs on cs.service_code = m.service_code and cs.customer_id = p_customer
                   where m.item_code = i.code),
      'allowedMimeTypes', t.allowed_mime_types, 'maxSizeBytes', t.max_size_bytes,
      'entry', case when e.item_code is null then null else jsonb_build_object(
        'status', e.status, 'value', e.value, 'documentId', e.document_id,
        'savedBy', (select full_name from public.profiles where id = e.saved_by), 'savedAt', e.saved_at,
        'reviewedBy', (select full_name from public.profiles where id = e.reviewed_by), 'reviewedAt', e.reviewed_at,
        'reviewNote', e.review_note) end)
    order by case i.section when 'BUSINESS_BASICS' then 0 when 'SERVICE' then 1 else 2 end, i.sort_order), '[]'::jsonb)
  into v_result
  from (select * from private.customer_items(p_customer)
        union all
        select * from private.customer_consultant_items(p_customer)) i
  left join public.document_types t on t.code = i.code and i.kind = 'FILE'
  left join public.customer_onboarding_entries e on e.customer_id = p_customer and e.item_code = i.code;
  return v_result;
end $$;

-- Technical Consultant fills in one of their items (e.g. WABA ID).
create or replace function public.save_consultant_entry(p_customer uuid, p_item text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  i public.onboarding_items;
  v_value text := nullif(trim(coalesce(p_value, '')), '');
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into i from private.customer_consultant_items(p_customer) x where x.code = p_item;
  if i.code is null then
    raise exception 'VALIDATION_ERROR: This item is not filled in by the Technical Consultant.' using errcode = 'P0001';
  end if;
  if v_value is null or length(v_value) > 4000 then
    raise exception 'VALIDATION_ERROR: Enter a value.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  insert into public.customer_onboarding_entries as e (customer_id, item_code, value, status, saved_by, saved_at, reviewed_by, reviewed_at)
  values (p_customer, p_item, v_value, 'VERIFIED', (select private.my_id()), now(), (select private.my_id()), now())
  on conflict (customer_id, item_code) do update
    set value = excluded.value, status = 'VERIFIED', saved_by = excluded.saved_by, saved_at = now(),
        reviewed_by = excluded.reviewed_by, reviewed_at = now(), review_note = null;
  perform private.refresh_onboarding_progress(p_customer);
  perform private.log_customer_activity(p_customer, 'ONBOARDING_ITEM_SAVED', format('%s added by the Technical Consultant', i.label));
  perform private.write_audit('ONBOARDING_CONSULTANT_ITEM_SAVED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('item', p_item));
end $$;
revoke all on function public.save_consultant_entry(uuid, text, text) from public, anon;
grant execute on function public.save_consultant_entry(uuid, text, text) to authenticated;

-- Uploads of retired file types (e.g. GST certificate) no longer create checklist entries.
create or replace function private.tg_customer_documents_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.onboarding_items i where i.code = new.document_type and i.kind = 'FILE' and i.is_active) then
    return null;
  end if;
  if new.status = 'UPLOADED' and old.status is distinct from 'UPLOADED' then
    insert into public.customer_onboarding_entries as e (customer_id, item_code, value, document_id, status, saved_by, saved_at)
    values (new.customer_id, new.document_type, new.original_file_name, new.id, 'SAVED', new.uploaded_by, now())
    on conflict (customer_id, item_code) do update
      set value = excluded.value, document_id = excluded.document_id, status = 'SAVED', saved_by = excluded.saved_by,
          saved_at = now(), reviewed_by = null, reviewed_at = null,
          review_note = case when e.status = 'REJECTED' then e.review_note end;
  elsif new.status = 'DELETED' and old.status = 'UPLOADED' then
    delete from public.customer_onboarding_entries where customer_id = new.customer_id and document_id = new.id;
  end if;
  perform private.refresh_onboarding_progress(new.customer_id);
  return null;
end $$;

-- Sales can no longer save consultant items or retired items: save_onboarding_entry
-- already only accepts items from private.customer_items() (sales, active).

-- Recompute progress for every onboarding customer with the new item sets.
do $$
declare r record;
begin
  for r in select customer_id from public.customer_onboarding loop
    perform private.refresh_onboarding_progress(r.customer_id);
  end loop;
end $$;
