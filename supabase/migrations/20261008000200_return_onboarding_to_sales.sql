-- =============================================================================
-- Send back to sales for re-verification.
--
-- The Technical Consultant marks wrong / inappropriate / fake items as
-- "Not authorized" (with a reason) and then clicks "Send back to sales".
-- The customer leaves the consultant's queue and appears in the
-- salesperson's onboarding list as RETURNED, with every rejected item and
-- its reason. Once fixed, the salesperson sends it to the consultant again.
--
--  * customer_onboarding.returned_at / returned_by / return_note
--  * onboarding_state gains RETURNED (list tab + counts)
--  * return_onboarding_to_sales(customer, note)
--  * "Not authorized" on a single item no longer notifies sales on its own;
--    the send-back sends one notification listing every item to fix.
-- Additive / idempotent.
-- =============================================================================

alter table public.customer_onboarding
  add column if not exists returned_at timestamptz,
  add column if not exists returned_by uuid references public.profiles (id) on delete set null,
  add column if not exists return_note text check (length(return_note) <= 1000);

-- Derived list state, now with RETURNED first.
alter table public.customer_onboarding drop column if exists onboarding_state;
alter table public.customer_onboarding
  add column onboarding_state text generated always as (
    case when returned_at is not null then 'RETURNED'
         when items_saved = 0 then 'WAITING_ON_CLIENT'
         when items_total > 0 and items_saved >= items_total then 'READY_FOR_HANDOVER'
         else 'COLLECTING' end) stored;

-- Sales list counts per tab.
create or replace function public.customer_pipeline_counts()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with c as (
    select c.lifecycle_stage, c.lead_status, c.amount_received, c.payment_due_date,
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
    'potential', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'POTENTIAL'),
      'AWAITING', count(*) filter (where lifecycle_stage = 'POTENTIAL' and amount_received = 0 and payment_due_date >= current_date),
      'PART_PAID', count(*) filter (where lifecycle_stage = 'POTENTIAL' and amount_received > 0 and payment_due_date >= current_date),
      'OVERDUE', count(*) filter (where lifecycle_stage = 'POTENTIAL' and payment_due_date < current_date)),
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
-- Consultant: send the customer back to the salesperson.
-- ---------------------------------------------------------------------------
create or replace function public.return_onboarding_to_sales(p_customer uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 1000);
  v_items text;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.items_rejected = 0 then
    raise exception 'VALIDATION_ERROR: Mark at least one item as Not authorized before sending it back.' using errcode = 'P0001';
  end if;

  select string_agg(format('%s (%s)', i.label, e.review_note), '; ' order by i.sort_order) into v_items
  from public.customer_onboarding_entries e
  join public.onboarding_items i on i.code = e.item_code
  where e.customer_id = p_customer and e.status = 'REJECTED';

  update public.customer_onboarding
     set forwarded_to_support_at = null, forwarded_by = null, stage = 'COLLECT_REQUIREMENTS',
         returned_at = now(), returned_by = (select private.my_id()), return_note = v_note
   where customer_id = p_customer;

  perform private.log_customer_activity(p_customer, 'ONBOARDING_RETURNED',
    format('Sent back to sales for re-verification: %s', v_items));
  perform private.write_audit('ONBOARDING_RETURNED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('items_rejected', o.items_rejected, 'note', v_note));
  perform private.notify(v.owner_id, 'ONBOARDING_RETURNED',
    format('Returned by Technical Consultant: %s', coalesce(v.company, v.name)),
    left(coalesce(v_note || ' — ', '') || 'Fix: ' || v_items, 1000), 'customer', p_customer, '{}'::jsonb, 'urgent');
end $$;
revoke all on function public.return_onboarding_to_sales(uuid, text) from public, anon;
grant execute on function public.return_onboarding_to_sales(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Item review: unchanged, except a rejection no longer notifies on its own.
-- ---------------------------------------------------------------------------
create or replace function public.review_onboarding_entry(p_customer uuid, p_item text, p_decision text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  i public.onboarding_items;
  e public.customer_onboarding_entries;
  o public.customer_onboarding;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_decision not in ('VERIFIED', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Choose verify or reject.' using errcode = 'P0001';
  end if;
  if p_decision = 'REJECTED' and v_note is null then
    raise exception 'VALIDATION_ERROR: Tell the sales team what needs fixing.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into i from public.onboarding_items where code = p_item;
  select * into e from public.customer_onboarding_entries where customer_id = p_customer and item_code = p_item for update;
  if e.item_code is null then
    raise exception 'CONFLICT: Nothing has been saved for this item yet.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding_entries
     set status = p_decision, reviewed_by = (select private.my_id()), reviewed_at = now(), review_note = left(v_note, 1000)
   where customer_id = p_customer and item_code = p_item;
  perform private.refresh_onboarding_progress(p_customer);

  perform private.log_customer_activity(p_customer,
    case when p_decision = 'VERIFIED' then 'ONBOARDING_ITEM_VERIFIED' else 'ONBOARDING_ITEM_REJECTED' end,
    case when p_decision = 'VERIFIED' then format('%s verified', i.label) else format('%s needs fixing: %s', i.label, v_note) end);
  perform private.write_audit(case when p_decision = 'VERIFIED' then 'ONBOARDING_ITEM_VERIFIED' else 'ONBOARDING_ITEM_REJECTED' end,
    'customer', p_customer, v.department_id, v.team_id, jsonb_build_object('item', p_item, 'note', v_note));

  select * into o from public.customer_onboarding where customer_id = p_customer;
  if p_decision = 'VERIFIED' and o.items_total > 0 and o.items_verified = o.items_total then
    perform private.notify(v.owner_id, 'ONBOARDING_VERIFIED', format('Onboarding verified: %s', coalesce(v.company, v.name)),
      'All documents and details were verified by the technical team.', 'customer', p_customer);
  end if;
end $$;
revoke all on function public.review_onboarding_entry(uuid, text, text, text) from public, anon;
grant execute on function public.review_onboarding_entry(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Sending (again) clears the returned state. Every item must be saved, so
-- anything still marked Not authorized has to be fixed first.
-- ---------------------------------------------------------------------------
create or replace function public.forward_onboarding_to_support(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
  v_missing text;
  v_recipient uuid;
  v_again boolean;
begin
  if v.lifecycle_stage <> 'ONBOARDING' then
    raise exception 'CONFLICT: This customer is not in onboarding.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_onboarding where customer_id = p_id and forwarded_to_support_at is not null) then
    raise exception 'CONFLICT: Already sent to the Technical Consultant.' using errcode = 'P0001';
  end if;
  select string_agg(i.label, ', ' order by i.sort_order) into v_missing
  from private.customer_items(p_id) i
  where not exists (select 1 from public.customer_onboarding_entries e
                    where e.customer_id = p_id and e.item_code = i.code and e.status in ('SAVED', 'VERIFIED'));
  if v_missing is not null then
    raise exception 'VALIDATION_ERROR: Complete these items first: %.', v_missing using errcode = 'P0001';
  end if;
  select returned_at is not null into v_again from public.customer_onboarding where customer_id = p_id;

  update public.customer_onboarding
     set stage = 'SETUP', forwarded_to_support_at = now(), forwarded_by = (select private.my_id()),
         returned_at = null, returned_by = null, return_note = null
   where customer_id = p_id;
  perform private.log_customer_activity(p_id, 'FORWARDED_TO_SUPPORT',
    case when v_again then 'Fixed and sent again to the Technical Consultant' else 'Sent to the Technical Consultant for verification' end);
  perform private.write_audit('ONBOARDING_FORWARDED', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('resubmitted', coalesce(v_again, false)));

  for v_recipient in
    select p.id from public.profiles p join public.teams t on t.id = p.team_id
    where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id
  loop
    perform private.notify(v_recipient, 'ONBOARDING_FORWARDED',
      format(case when v_again then 'Re-verify: %s' else 'New customer to verify: %s' end, coalesce(v.company, v.name)),
      case when v_again then 'Sales fixed the items you sent back.' else 'Sales has sent the customer''s details and documents for verification.' end,
      'customer', p_id);
  end loop;
end $$;
revoke all on function public.forward_onboarding_to_support(uuid) from public, anon;
grant execute on function public.forward_onboarding_to_support(uuid) to authenticated;
