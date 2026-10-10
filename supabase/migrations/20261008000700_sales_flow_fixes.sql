-- =============================================================================
-- Sales flow fixes: whole-rupee amounts, back out of Potential, first payment
-- starts onboarding, optional Website URL, Facebook Business Manager details.
--
--  1. Deal amount and payments must be whole rupees (15000.99 is rejected by
--     move_customer_to_potential, record_customer_payment, start_customer_onboarding).
--  2. back_out_customer(): a Potential customer who backs out returns to Leads.
--  3. record_customer_payment(): the FIRST payment on a Potential customer
--     starts onboarding; later payments (balance) can be recorded while the
--     customer is in onboarding. Onboarding counts gain GET_STARTED (balance due).
--  4. onboarding_items.is_optional + "Website URL" for WhatsApp API + Blue Tick
--     (optional: not needed to send to the consultant; counted once filled).
--     Facebook Business Manager access becomes a details item ("Add details").
-- Additive / idempotent. The peer's forward / return / review functions are
-- not redefined.
-- =============================================================================

-- 1/2. Lifecycle guard: lead status may reset when a customer returns to Leads.
create or replace function private.tg_customers_lifecycle_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.lifecycle_stage not in ('LEAD', 'CUSTOMER') then
      raise exception 'VALIDATION_ERROR: New records start as a lead or a customer.' using errcode = 'P0001';
    end if;
    new.stage_changed_at := now();
    return new;
  end if;
  if new.lifecycle_stage is distinct from old.lifecycle_stage then
    new.stage_changed_at := now();
  end if;
  -- (a back-out returns the customer to Leads and may reset the status)
  if new.lead_status is distinct from old.lead_status and old.lifecycle_stage <> 'LEAD' and new.lifecycle_stage <> 'LEAD' then
    raise exception 'VALIDATION_ERROR: Lead status can only change while the customer is a lead.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.move_customer_to_potential(p_id uuid, p_deal_amount numeric, p_due_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
begin
  if v.lifecycle_stage <> 'LEAD' then
    raise exception 'CONFLICT: Only leads can be moved to Potential.' using errcode = 'P0001';
  end if;
  if coalesce(p_deal_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the deal amount before moving to Potential.' using errcode = 'P0001';
  end if;
  if p_deal_amount <> trunc(p_deal_amount) then
    raise exception 'VALIDATION_ERROR: Enter the deal amount in whole rupees (no paise).' using errcode = 'P0001';
  end if;
  if p_due_date is null then
    raise exception 'VALIDATION_ERROR: Enter the payment due date.' using errcode = 'P0001';
  end if;
  update public.customers
     set lifecycle_stage = 'POTENTIAL', lead_status = 'READY_TO_BUY', deal_amount = p_deal_amount,
         amount_received = 0, payment_due_date = p_due_date
   where id = p_id;
  perform private.log_customer_activity(p_id, 'MOVED_TO_POTENTIAL',
    format('Moved to Potential · ₹%s due %s', p_deal_amount, to_char(p_due_date, 'DD Mon YYYY')));
  perform private.write_audit('CUSTOMER_STAGE_CHANGED', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('from', 'LEAD', 'to', 'POTENTIAL', 'deal_amount', p_deal_amount, 'due', p_due_date));
end $$;
revoke all on function public.move_customer_to_potential(uuid, numeric, date) from public, anon;
grant execute on function public.move_customer_to_potential(uuid, numeric, date) to authenticated;

create or replace function public.start_customer_onboarding(
  p_id uuid, p_amount_received numeric, p_payment_method text, p_target_handover date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
  v_received numeric;
begin
  if v.lifecycle_stage <> 'POTENTIAL' then
    raise exception 'CONFLICT: Only potential customers can start onboarding.' using errcode = 'P0001';
  end if;
  if p_payment_method is null or p_payment_method not in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Select how the customer paid.' using errcode = 'P0001';
  end if;
  if coalesce(p_amount_received, 0) <> trunc(coalesce(p_amount_received, 0)) then
    raise exception 'VALIDATION_ERROR: Enter the amount received in whole rupees (no paise).' using errcode = 'P0001';
  end if;
  v_received := v.amount_received + coalesce(p_amount_received, 0);
  if v_received <= 0 then
    raise exception 'VALIDATION_ERROR: Record the payment received before starting onboarding.' using errcode = 'P0001';
  end if;
  if v_received > v.deal_amount then
    raise exception 'VALIDATION_ERROR: Amount received cannot exceed the deal amount (₹%).', v.deal_amount using errcode = 'P0001';
  end if;

  update public.customers set lifecycle_stage = 'ONBOARDING', amount_received = v_received where id = p_id;
  insert into public.customer_onboarding (customer_id, stage, payment_method, started_by, target_handover_date)
  values (p_id, 'COLLECT_REQUIREMENTS', p_payment_method, (select private.my_id()), p_target_handover)
  on conflict (customer_id) do update
    set stage = 'COLLECT_REQUIREMENTS', payment_method = excluded.payment_method,
        started_at = now(), started_by = excluded.started_by, target_handover_date = excluded.target_handover_date;
  perform private.refresh_onboarding_progress(p_id);

  perform private.log_customer_activity(p_id, 'PAYMENT_CONFIRMED',
    format('Payment ₹%s confirmed (%s)', v_received, replace(p_payment_method, '_', ' ')));
  perform private.log_customer_activity(p_id, 'MOVED_TO_ONBOARDING', 'Moved from Potential to Onboarding');
  perform private.write_audit('CUSTOMER_STAGE_CHANGED', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('from', 'POTENTIAL', 'to', 'ONBOARDING', 'amount_received', v_received, 'method', p_payment_method));
end $$;
revoke all on function public.start_customer_onboarding(uuid, numeric, text, date) from public, anon;
grant execute on function public.start_customer_onboarding(uuid, numeric, text, date) to authenticated;

-- 3. First payment starts onboarding; balance payments are recorded in onboarding.
create or replace function public.record_customer_payment(p_id uuid, p_amount numeric, p_method text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
begin
  if v.lifecycle_stage not in ('POTENTIAL', 'ONBOARDING') then
    raise exception 'CONFLICT: Payments are recorded while the customer is in Potential or Onboarding.' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the amount received.' using errcode = 'P0001';
  end if;
  if p_amount <> trunc(p_amount) then
    raise exception 'VALIDATION_ERROR: Enter the amount received in whole rupees (no paise).' using errcode = 'P0001';
  end if;
  if v.amount_received + p_amount > v.deal_amount then
    raise exception 'VALIDATION_ERROR: Amount received cannot exceed the deal amount (₹%).', v.deal_amount using errcode = 'P0001';
  end if;

  if v.lifecycle_stage = 'POTENTIAL' then
    -- First payment: onboarding gets started (records the payment too).
    perform public.start_customer_onboarding(p_id, p_amount, p_method, null);
    return;
  end if;

  update public.customers set amount_received = amount_received + p_amount where id = p_id;
  perform private.log_customer_activity(p_id, 'PAYMENT_RECEIVED',
    format('₹%s received%s', p_amount, coalesce(' via ' || p_method, '')));
  perform private.write_audit('PAYMENT_RECORDED', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('amount', p_amount, 'method', p_method, 'total_received', v.amount_received + p_amount));
end $$;
revoke all on function public.record_customer_payment(uuid, numeric, text) from public, anon;
grant execute on function public.record_customer_payment(uuid, numeric, text) to authenticated;

-- 2. Customer backs out at Potential → back to Leads.
create or replace function public.back_out_customer(p_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
  v_reason text := left(nullif(trim(coalesce(p_reason, '')), ''), 500);
begin
  if v.lifecycle_stage <> 'POTENTIAL' then
    raise exception 'CONFLICT: Only potential customers can back out.' using errcode = 'P0001';
  end if;
  if v.amount_received > 0 then
    raise exception 'CONFLICT: A payment of ₹% is already recorded for this customer.', v.amount_received using errcode = 'P0001';
  end if;
  update public.customers
     set lifecycle_stage = 'LEAD', lead_status = 'INTERESTED', expected_budget = coalesce(v.deal_amount, expected_budget),
         deal_amount = null, amount_received = 0, payment_due_date = null
   where id = p_id;
  perform private.log_customer_activity(p_id, 'BACKED_OUT',
    'Backed out at Potential - moved back to Leads' || coalesce(' · ' || v_reason, ''));
  perform private.write_audit('CUSTOMER_STAGE_CHANGED', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('from', 'POTENTIAL', 'to', 'LEAD', 'reason', v_reason, 'deal_amount', v.deal_amount));
end $$;
revoke all on function public.back_out_customer(uuid, text) from public, anon;
grant execute on function public.back_out_customer(uuid, text) to authenticated;

-- Sales list counts (adds the onboarding GET_STARTED count).
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
      'READY_FOR_HANDOVER', count(*) filter (where lifecycle_stage = 'ONBOARDING' and not returned and total > 0 and saved >= total),
      -- First payment received, balance still due.
      'GET_STARTED', count(*) filter (where lifecycle_stage = 'ONBOARDING' and not fully_paid)),
    'mandatoryDocuments', (select n from m))
  from c
$$;
revoke all on function public.customer_pipeline_counts() from public, anon;
grant execute on function public.customer_pipeline_counts() to authenticated;

-- 4. Optional checklist items.
alter table public.onboarding_items add column if not exists is_optional boolean not null default false;

insert into public.onboarding_items (code, section, label, hint, kind, options, always_required, sort_order, is_optional) values
  ('WA_WEBSITE_URL', 'SERVICE', 'Website URL', 'Optional - the business website, if they have one', 'DETAILS', null, false, 115, true)
on conflict (code) do update set label = excluded.label, hint = excluded.hint, kind = excluded.kind,
  sort_order = excluded.sort_order, is_optional = true, is_active = true;
insert into public.onboarding_item_services (item_code, service_code) values ('WA_WEBSITE_URL', 'WHATSAPP_API_BLUE_TICK')
on conflict do nothing;

-- Facebook Business Manager access is collected as details ("Add details").
update public.onboarding_items set kind = 'DETAILS',
  hint = 'Partner access granted - add the Business Manager ID and any details'
 where code = 'FB_BUSINESS_MANAGER';

-- Required items, plus optional items once they have been filled in (so they
-- count towards progress and review, but never block sending).
create or replace function private.customer_items(p_customer uuid)
returns setof public.onboarding_items language sql stable security definer set search_path = '' as $$
  select i.* from public.onboarding_items i
  where i.is_active and i.filled_by = 'SALES' and (i.always_required or exists (
    select 1 from public.onboarding_item_services m
    join public.customer_services cs on cs.service_code = m.service_code and cs.customer_id = p_customer
    where m.item_code = i.code))
    and (not i.is_optional or exists (
      select 1 from public.customer_onboarding_entries e where e.customer_id = p_customer and e.item_code = i.code))
$$;
revoke all on function private.customer_items(uuid) from public, anon, authenticated;

-- Optional items that have not been filled in yet.
create or replace function private.customer_optional_items(p_customer uuid)
returns setof public.onboarding_items language sql stable security definer set search_path = '' as $$
  select i.* from public.onboarding_items i
  where i.is_active and i.filled_by = 'SALES' and i.is_optional and (i.always_required or exists (
    select 1 from public.onboarding_item_services m
    join public.customer_services cs on cs.service_code = m.service_code and cs.customer_id = p_customer
    where m.item_code = i.code))
    and not exists (
      select 1 from public.customer_onboarding_entries e where e.customer_id = p_customer and e.item_code = i.code)
$$;
revoke all on function private.customer_optional_items(uuid) from public, anon, authenticated;

create or replace function public.save_onboarding_entry(p_customer uuid, p_item text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_customer);
  i public.onboarding_items;
  v_value text := nullif(trim(coalesce(p_value, '')), '');
begin
  if v.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: Details are collected once the customer is in onboarding.' using errcode = 'P0001';
  end if;
  select * into i from (select * from private.customer_items(p_customer)
                         union all select * from private.customer_optional_items(p_customer)) x where x.code = p_item;
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
      'optional', i.is_optional,
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
        select * from private.customer_optional_items(p_customer)
        union all
        select * from private.customer_consultant_items(p_customer)) i
  left join public.document_types t on t.code = i.code and i.kind = 'FILE'
  left join public.customer_onboarding_entries e on e.customer_id = p_customer and e.item_code = i.code;
  return v_result;
end $$;
revoke all on function public.customer_onboarding_checklist(uuid) from public, anon;
grant execute on function public.customer_onboarding_checklist(uuid) to authenticated;
