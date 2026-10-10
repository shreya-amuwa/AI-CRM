-- =============================================================================
-- Technical Consultant: a "Customers" panel before "Onboarding Customers".
--
-- Customers Accounts confirmed arrive in the consultant's new Customers panel
-- (a table). The consultant sets Contract yes/no, adds add-on services (from
-- the catalog or typed by hand), can edit the contact details, and presses
-- "Send for onboarding". Only then does the customer move to the existing
-- Onboarding Customers panel (document review, authorization, hand-over).
--
--  * customer_onboarding.consultant_started_at  - set by "Send for onboarding"
--    (existing customers are backfilled: they stay in Onboarding Customers)
--  * customer_onboarding.contract_signed, .addons
--  * consultant_set_contract / consultant_set_addons / consultant_update_customer
--    / consultant_start_onboarding - consultant-only, through
--    private.can_review_onboarding (support department, customer sent to them)
--  * onboarding_review_counts: 'all' and the tab counts now exclude customers
--    still in the Customers panel; 'newCustomers' counts them
-- Additive / idempotent.
-- =============================================================================

alter table public.customer_onboarding
  add column if not exists consultant_started_at timestamptz,
  add column if not exists consultant_started_by uuid references public.profiles (id) on delete set null,
  add column if not exists contract_signed boolean not null default false,
  add column if not exists addons jsonb not null default '[]'::jsonb;

-- Customers already with the consultant before this change stay in Onboarding Customers.
update public.customer_onboarding
   set consultant_started_at = coalesce(forwarded_to_support_at, returned_at, now())
 where with_consultant and consultant_started_at is null;

-- ---------------------------------------------------------------------------
-- Counts: Onboarding Customers (started) vs. the new Customers panel
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
    'newCustomers', count(*) filter (where o.consultant_started_at is null))
  from public.customers c
  join public.customer_onboarding o on o.customer_id = c.id
  where c.lifecycle_stage = 'ONBOARDING' and private.can_view_onboarding_review(c.id)
$$;
revoke all on function public.onboarding_review_counts() from public, anon;
grant execute on function public.onboarding_review_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- Edits in the Customers panel
-- ---------------------------------------------------------------------------
create or replace function public.consultant_set_contract(p_customer uuid, p_signed boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding set contract_signed = coalesce(p_signed, false) where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'CONTRACT_UPDATED',
    case when coalesce(p_signed, false) then 'Contract marked as received' else 'Contract marked as not received' end);
end $$;
revoke all on function public.consultant_set_contract(uuid, boolean) from public, anon;
grant execute on function public.consultant_set_contract(uuid, boolean) to authenticated;

-- p_addons: [{ "code": "AI_CALLING" }  |  { "name": "Custom setup" }, ...]
create or replace function public.consultant_set_addons(p_customer uuid, p_addons jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e jsonb;
  v_code text;
  v_name text;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_key text;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_addons is not null and jsonb_typeof(p_addons) <> 'array' then
    raise exception 'VALIDATION_ERROR: Add-ons must be a list.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p_addons, '[]'::jsonb)) > 25 then
    raise exception 'VALIDATION_ERROR: Add at most 25 add-ons.' using errcode = 'P0001';
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_addons, '[]'::jsonb)) loop
    v_code := nullif(trim(coalesce(e ->> 'code', '')), '');
    if v_code is not null then
      select s.name into v_name from public.crm_services s where s.code = v_code and s.is_active;
      if v_name is null then
        raise exception 'VALIDATION_ERROR: Choose an add-on from the list.' using errcode = 'P0001';
      end if;
      v_key := 'c:' || v_code;
    else
      v_name := left(trim(regexp_replace(coalesce(e ->> 'name', ''), '\s+', ' ', 'g')), 120);
      if length(v_name) < 2 then
        raise exception 'VALIDATION_ERROR: Type the add-on name (at least 2 characters).' using errcode = 'P0001';
      end if;
      v_key := 'n:' || lower(v_name);
    end if;
    if v_key = any (v_seen) then
      continue;
    end if;
    v_seen := v_seen || v_key;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('code', v_code, 'name', v_name)));
  end loop;
  update public.customer_onboarding set addons = v_out where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'ADDONS_UPDATED', format('Add-ons updated (%s)', jsonb_array_length(v_out)));
  return v_out;
end $$;
revoke all on function public.consultant_set_addons(uuid, jsonb) from public, anon;
grant execute on function public.consultant_set_addons(uuid, jsonb) to authenticated;

create or replace function public.consultant_update_customer(
  p_customer uuid, p_name text, p_company text, p_phone text, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
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
revoke all on function public.consultant_update_customer(uuid, text, text, text, text) from public, anon;
grant execute on function public.consultant_update_customer(uuid, text, text, text, text) to authenticated;

-- "Send for onboarding": the customer moves to Onboarding Customers.
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
