-- =============================================================================
-- Sent back for re-verification: still visible to the Technical Consultant.
--
-- After "Send back for re-verification" the customer goes to the salesperson
-- (RETURNED, unchanged) and now ALSO stays in the consultant's list as
-- "Waiting for sales team" (review_state WAITING_ON_SALES), read-only: the
-- consultant can open it, see the items and reasons and view files, but can
-- authorize / reject / run automations again only once sales sends it back.
--
--  * customer_onboarding.with_consultant - sent, or sent back and waiting
--  * private.can_view_onboarding_review - read access (list, checklist,
--    files, owner name); private.can_review_onboarding (actions) unchanged
--  * review_state gains WAITING_ON_SALES; onboarding_review_counts counts it
-- Additive / idempotent. Peer functions (forward / return / review) unchanged.
-- =============================================================================

alter table public.customer_onboarding drop column if exists with_consultant;
alter table public.customer_onboarding
  add column with_consultant boolean generated always as (
    forwarded_to_support_at is not null or returned_at is not null) stored;

-- Consultant read access: same people as can_review_onboarding, but also while
-- the customer is waiting for sales to fix the items sent back.
create or replace function private.can_view_onboarding_review(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    join public.customer_onboarding o on o.customer_id = c.id
    where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
      and o.with_consultant
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or c.department_id = private.my_support_department_id()))
$$;
revoke all on function private.can_view_onboarding_review(uuid) from public, anon;
grant execute on function private.can_view_onboarding_review(uuid) to authenticated;

create or replace function private.onboarding_with_consultant(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.customer_onboarding o where o.customer_id = p_customer and o.with_consultant)
$$;
revoke all on function private.onboarding_with_consultant(uuid) from public, anon;
grant execute on function private.onboarding_with_consultant(uuid) to authenticated;

drop policy if exists customers_select_review on public.customers;
create policy customers_select_review on public.customers for select to authenticated
  using (department_id = (select private.my_support_department_id())
         and lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
         and private.onboarding_with_consultant(id));

-- Review state, now with "Waiting for sales team" first (same rules otherwise).
alter table public.customer_onboarding drop column if exists review_state;
alter table public.customer_onboarding
  add column review_state text generated always as (
    case when returned_at is not null then 'WAITING_ON_SALES'
         when items_rejected > 0 then 'NEEDS_FIX'
         when items_total > 0 and items_verified >= items_total and consultant_items_done >= consultant_items_total then 'VERIFIED'
         when items_saved > items_verified or (items_total > 0 and items_verified >= items_total) then 'TO_REVIEW'
         else 'AWAITING_DOCUMENTS' end) stored;

-- Tab counts for the consultant list.
create or replace function public.onboarding_review_counts()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'all', count(*),
    'TO_REVIEW', count(*) filter (where o.review_state = 'TO_REVIEW'),
    'NEEDS_FIX', count(*) filter (where o.review_state = 'NEEDS_FIX'),
    'VERIFIED', count(*) filter (where o.review_state = 'VERIFIED'),
    'AWAITING_DOCUMENTS', count(*) filter (where o.review_state = 'AWAITING_DOCUMENTS'),
    'WAITING_ON_SALES', count(*) filter (where o.review_state = 'WAITING_ON_SALES'))
  from public.customers c
  join public.customer_onboarding o on o.customer_id = c.id
  where c.lifecycle_stage = 'ONBOARDING' and private.can_view_onboarding_review(c.id)
$$;
revoke all on function public.onboarding_review_counts() from public, anon;
grant execute on function public.onboarding_review_counts() to authenticated;

-- Read paths (from 20261008000300 / 20261007000500), with consultant read access.
create or replace function public.customer_onboarding_checklist(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  if not (private.can_access_customer(p_customer) or private.can_view_onboarding_review(p_customer)) then
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
revoke all on function public.customer_onboarding_checklist(uuid) from public, anon;
grant execute on function public.customer_onboarding_checklist(uuid) to authenticated;

create or replace function public.authorize_document_access(p_document uuid, p_action text)
returns table (storage_bucket text, storage_path text, original_file_name text, mime_type text)
language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
  v public.customers;
begin
  select * into d from public.customer_documents where id = p_document;
  if d.id is null or d.status not in ('UPLOADED', 'SUPERSEDED')
     or not (private.can_access_customer(d.customer_id) or private.can_view_onboarding_review(d.customer_id)) then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = d.customer_id;
  perform private.write_audit(case when p_action = 'DOWNLOAD' then 'DOCUMENT_DOWNLOADED' else 'DOCUMENT_VIEWED' end,
    'customer_document', d.id, v.department_id, v.team_id,
    jsonb_build_object('customer_id', d.customer_id, 'document_type', d.document_type, 'version', d.version));
  return query select d.storage_bucket, d.storage_path, d.original_file_name, d.mime_type;
end $$;
revoke all on function public.authorize_document_access(uuid, text) from public, anon;
grant execute on function public.authorize_document_access(uuid, text) to authenticated;

create or replace function public.customer_owner_summary(p_customer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'fullName', p.full_name)
  from public.customers c join public.profiles p on p.id = c.owner_id
  where c.id = p_customer and (private.can_access_customer(c.id) or private.can_view_onboarding_review(c.id))
$$;
revoke all on function public.customer_owner_summary(uuid) from public, anon;
grant execute on function public.customer_owner_summary(uuid) to authenticated;
