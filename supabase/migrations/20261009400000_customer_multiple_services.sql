-- =============================================================================
-- A customer can have many services.
--
-- customer_services (customer, service) already holds the services; it gains a
-- `details` column so each service keeps its own form data (WhatsApp API:
-- campaigns, message package, messages sent). customers.service_code /
-- service_interest / service_details stay as the PRIMARY (first) service so
-- every existing screen keeps working.
--
-- create_support_customer / update_support_customer take `p_services`
-- (a JSON array of {serviceCode, serviceDetails}) instead of one service code.
-- Update with p_services = null leaves the services untouched.
-- Additive: no data is deleted; existing single services are copied into
-- customer_services.
-- =============================================================================

alter table public.customer_services add column if not exists details jsonb not null default '{}'::jsonb;

-- Existing single services become rows (with their details).
insert into public.customer_services (customer_id, service_code, details)
select c.id, c.service_code, coalesce(c.service_details, '{}'::jsonb)
  from public.customers c
 where c.service_code is not null
   and exists (select 1 from public.crm_services s where s.code = c.service_code)
on conflict (customer_id, service_code) do update
  set details = excluded.details
  where public.customer_services.details = '{}'::jsonb;

-- Validate and normalise a list of services: known, unique, details checked.
create or replace function private.normalize_service_list(p_services jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  e jsonb;
  v_code text;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
begin
  if p_services is null or jsonb_typeof(p_services) <> 'array' then
    return '[]'::jsonb;
  end if;
  if jsonb_array_length(p_services) > 25 then
    raise exception 'VALIDATION_ERROR: Add at most 25 services to one customer.' using errcode = 'P0001';
  end if;
  for e in select * from jsonb_array_elements(p_services) loop
    v_code := nullif(trim(coalesce(e ->> 'serviceCode', '')), '');
    if v_code is null then
      continue;
    end if;
    if not exists (select 1 from public.crm_services where code = v_code and is_active) then
      raise exception 'VALIDATION_ERROR: Choose a service from the list.' using errcode = 'P0001';
    end if;
    if v_code = any (v_seen) then
      raise exception 'VALIDATION_ERROR: The same service is added more than once.' using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_code;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'serviceCode', v_code,
      'serviceDetails', private.normalize_service_details(v_code, e -> 'serviceDetails')));
  end loop;
  return v_out;
end $$;
grant execute on function private.normalize_service_list(jsonb) to authenticated;

-- Replace a customer's services with the (already normalised) list.
create or replace function private.save_customer_services(p_customer uuid, p_list jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.customer_services cs
   where cs.customer_id = p_customer
     and cs.service_code not in (select x ->> 'serviceCode' from jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) x);
  insert into public.customer_services (customer_id, service_code, details)
  select p_customer, x ->> 'serviceCode', coalesce(x -> 'serviceDetails', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) x
  on conflict (customer_id, service_code) do update set details = excluded.details;
end $$;
revoke all on function private.save_customer_services(uuid, jsonb) from public, anon, authenticated;

-- One service per call is replaced by a list.
drop function if exists public.create_support_customer(text, text, text, text, text, text, text, jsonb, text, text, text, uuid);
drop function if exists public.update_support_customer(uuid, text, text, text, text, text, text, text, jsonb, text, text, text, uuid);

create or replace function public.create_support_customer(
  p_name text, p_company text, p_phone text, p_email text, p_segment text, p_status text,
  p_services jsonb, p_requirement text, p_channel text, p_notes text,
  p_assignee uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  owner public.profiles;
  v_list jsonb := private.normalize_service_list(p_services);
  v_service text;
  v_id uuid;
  v_code text;
  v_name text := trim(coalesce(p_name, ''));
  v_lead uuid;
begin
  v_service := v_list -> 0 ->> 'serviceCode';
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into owner from public.profiles where id = coalesce(p_assignee, me.id) and status = 'ACTIVE';
  if owner.id is null or owner.team_id is null then
    raise exception 'VALIDATION_ERROR: Choose an active team member to assign this customer to.' using errcode = 'P0001';
  end if;
  if not private.may_work_in_support() then
    raise exception 'FORBIDDEN: Only the Support team can add customers here.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.teams t where t.id = owner.team_id and t.division = 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Assign the customer to a member of the Support team.' using errcode = 'P0001';
  end if;
  if not private.can_assign_customer_owner(owner.id) then
    raise exception 'FORBIDDEN: You cannot assign customers to this user.' using errcode = '42501';
  end if;
  perform private.check_support_customer_fields(p_name, p_email, p_phone, p_segment, p_status, v_service);
  perform private.raise_duplicate_customer(private.find_duplicate_customer(owner.department_id, p_email, p_phone, null));

  insert into public.customers (owner_id, name, company, phone, email, segment, status, notes,
                                service_code, service_interest, service_details, requirement, channel, lifecycle_stage)
  values (owner.id, v_name, nullif(trim(coalesce(p_company, '')), ''), nullif(trim(coalesce(p_phone, '')), ''),
          nullif(lower(trim(coalesce(p_email, ''))), ''),
          coalesce(p_segment, 'RETAIL')::public.customer_segment, coalesce(p_status, 'ACTIVE')::public.customer_status,
          nullif(trim(coalesce(p_notes, '')), ''), v_service,
          (select name from public.crm_services where code = v_service),
          coalesce(v_list -> 0 -> 'serviceDetails', '{}'::jsonb),
          nullif(trim(coalesce(p_requirement, '')), ''), nullif(trim(coalesce(p_channel, '')), ''), 'CUSTOMER')
  returning id, customer_code into v_id, v_code;

  perform private.save_customer_services(v_id, v_list);

  insert into public.customer_activities (customer_id, actor_id, type, note)
  values (v_id, me.id, 'CUSTOMER_CREATED', format('Added by %s%s', me.full_name,
          case when owner.id <> me.id then format(' and assigned to %s', owner.full_name) else '' end));

  if owner.id <> me.id then
    perform private.notify(owner.id, 'CUSTOMER_ASSIGNED', format('Customer assigned: %s', v_name),
      format('%s (%s) was assigned to you by %s.', v_name, v_code, me.full_name), 'customer', v_id);
  end if;
  for v_lead in select id from public.profiles
                 where role = 'TEAM_HEAD' and status = 'ACTIVE' and team_id = owner.team_id and id <> me.id loop
    perform private.notify(v_lead, 'CUSTOMER_ADDED', format('New customer: %s', v_name),
      format('%s (%s) was added for %s.', v_name, v_code, owner.full_name), 'customer', v_id);
  end loop;
  return v_id;
end $$;
revoke all on function public.create_support_customer(text, text, text, text, text, text, jsonb, text, text, text, uuid) from public, anon;
grant execute on function public.create_support_customer(text, text, text, text, text, text, jsonb, text, text, text, uuid) to authenticated;

create or replace function public.update_support_customer(
  p_customer uuid, p_name text, p_company text, p_phone text, p_email text, p_segment text, p_status text,
  p_services jsonb, p_requirement text, p_channel text, p_notes text,
  p_assignee uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.customers;
  new_owner public.profiles;
  v_list jsonb := private.normalize_service_list(p_services);
  v_service text;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into c from public.customers where id = p_customer for update;
  if me.id is null or c.id is null or not private.can_view_customer(c.id) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if not (c.owner_id = me.id
          or me.role = 'SUPER_ADMIN'
          or (me.role = 'DEPARTMENT_HEAD' and c.department_id = me.department_id)
          or (me.role = 'TEAM_HEAD' and c.team_id = me.team_id)) then
    raise exception 'FORBIDDEN: Only the assigned team member or their team lead can edit this customer.' using errcode = '42501';
  end if;
  v_service := v_list -> 0 ->> 'serviceCode';
  perform private.check_support_customer_fields(p_name, p_email, p_phone, p_segment, p_status, v_service);
  perform private.raise_duplicate_customer(private.find_duplicate_customer(c.department_id, p_email, p_phone, c.id));

  if p_assignee is not null and p_assignee <> c.owner_id then
    select * into new_owner from public.profiles where id = p_assignee and status = 'ACTIVE';
    if new_owner.id is null or not private.can_assign_customer_owner(new_owner.id) then
      raise exception 'FORBIDDEN: You cannot assign customers to this user.' using errcode = '42501';
    end if;
  end if;

  update public.customers
     set name = trim(p_name),
         company = nullif(trim(coalesce(p_company, '')), ''),
         phone = nullif(trim(coalesce(p_phone, '')), ''),
         email = nullif(lower(trim(coalesce(p_email, ''))), ''),
         segment = coalesce(p_segment, 'RETAIL')::public.customer_segment,
         status = coalesce(p_status, 'ACTIVE')::public.customer_status,
         service_code = case when p_services is null then service_code else v_service end,
         service_interest = case when p_services is null then service_interest when v_service is null then null else (select name from public.crm_services where code = v_service) end,
         service_details = case when p_services is null then service_details else coalesce(v_list -> 0 -> 'serviceDetails', '{}'::jsonb) end,
         requirement = nullif(trim(coalesce(p_requirement, '')), ''),
         channel = nullif(trim(coalesce(p_channel, '')), ''),
         notes = nullif(trim(coalesce(p_notes, '')), ''),
         owner_id = coalesce(new_owner.id, owner_id)
   where id = c.id;

  if p_services is not null then
    perform private.save_customer_services(c.id, v_list);
  end if;

  insert into public.customer_activities (customer_id, actor_id, type, note)
  values (c.id, me.id, 'CUSTOMER_UPDATED', format('Details updated by %s%s', me.full_name,
          case when new_owner.id is not null then format('; assigned to %s', new_owner.full_name) else '' end));
  if new_owner.id is not null and new_owner.id <> me.id then
    perform private.notify(new_owner.id, 'CUSTOMER_ASSIGNED', format('Customer assigned: %s', trim(p_name)),
      format('%s (%s) was assigned to you by %s.', trim(p_name), c.customer_code, me.full_name), 'customer', c.id);
  end if;
end $$;
revoke all on function public.update_support_customer(uuid, text, text, text, text, text, text, jsonb, text, text, text, uuid) from public, anon;
grant execute on function public.update_support_customer(uuid, text, text, text, text, text, text, jsonb, text, text, text, uuid) to authenticated;
