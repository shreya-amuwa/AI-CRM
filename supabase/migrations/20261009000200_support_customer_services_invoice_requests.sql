-- =============================================================================
-- Support dashboard, round 2.
--
--  1. Customers pick their service from the services catalog (crm_services)
--     and keep service-specific details. For WhatsApp API: campaigns sent and
--     the message package (bought / sent; remaining = bought - sent).
--  2. update_support_customer(): edit a customer's details (owner, team lead,
--     department head, super admin), with the same validation and duplicate
--     checks as create.
--  3. invoice_requests: a Support member asks for an invoice for a customer
--     for a period (from month → to month) with an optional note. The team
--     lead, department head and the customer's owner are notified.
-- Additive / idempotent. Run the whole file at once.
-- =============================================================================

alter table public.customers
  add column if not exists service_code text references public.crm_services (code) on delete set null,
  add column if not exists service_details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(service_details) = 'object' and pg_column_size(service_details) <= 8192);

-- Validate and normalise the per-service details (only WhatsApp API has fields today).
create or replace function private.normalize_service_details(p_service_code text, p_details jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  d jsonb := coalesce(p_details, '{}'::jsonb);
  v_campaigns integer;
  v_package integer;
  v_sent integer;
  v_notes text;
begin
  if p_service_code is null or p_service_code not like 'WHATSAPP_API%' then
    return '{}'::jsonb;
  end if;
  begin
    v_campaigns := coalesce(nullif(d ->> 'campaignsSent', '')::integer, 0);
    v_package := coalesce(nullif(d ->> 'packageMessages', '')::integer, 0);
    v_sent := coalesce(nullif(d ->> 'messagesSent', '')::integer, 0);
  exception when others then
    raise exception 'VALIDATION_ERROR: Campaigns and message counts must be whole numbers.' using errcode = 'P0001';
  end;
  if v_campaigns < 0 or v_package < 0 or v_sent < 0 then
    raise exception 'VALIDATION_ERROR: Campaigns and message counts cannot be negative.' using errcode = 'P0001';
  end if;
  if v_sent > v_package then
    raise exception 'VALIDATION_ERROR: Messages sent cannot be more than the message package.' using errcode = 'P0001';
  end if;
  v_notes := left(nullif(trim(coalesce(d ->> 'campaignNotes', '')), ''), 1000);
  return jsonb_strip_nulls(jsonb_build_object(
    'campaignsSent', v_campaigns, 'packageMessages', v_package, 'messagesSent', v_sent, 'campaignNotes', v_notes));
end $$;
grant execute on function private.normalize_service_details(text, jsonb) to authenticated;

-- Shared field checks for create / update.
create or replace function private.check_support_customer_fields(
  p_name text, p_email text, p_phone text, p_segment text, p_status text, p_service_code text)
returns void language plpgsql stable set search_path = '' as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'VALIDATION_ERROR: Enter the customer''s full name.' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_email, '')), '') is null and nullif(trim(coalesce(p_phone, '')), '') is null then
    raise exception 'VALIDATION_ERROR: Enter a phone number or an e-mail address.' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_email, '')), '') is not null and lower(trim(p_email)) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: Enter a valid e-mail address.' using errcode = 'P0001';
  end if;
  if nullif(trim(coalesce(p_phone, '')), '') is not null and (trim(p_phone) !~ '^[0-9+()\-\s.]{5,25}$' or length(v_digits) < 7) then
    raise exception 'VALIDATION_ERROR: Enter a valid phone number (at least 7 digits).' using errcode = 'P0001';
  end if;
  if coalesce(p_segment, 'RETAIL') not in ('RETAIL', 'WHOLESALE', 'CORPORATE', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Unknown customer type.' using errcode = 'P0001';
  end if;
  if coalesce(p_status, 'ACTIVE') not in ('ACTIVE', 'INACTIVE', 'PROSPECT') then
    raise exception 'VALIDATION_ERROR: Unknown customer status.' using errcode = 'P0001';
  end if;
  if p_service_code is not null and not exists (select 1 from public.crm_services where code = p_service_code and is_active) then
    raise exception 'VALIDATION_ERROR: Choose a service from the list.' using errcode = 'P0001';
  end if;
end $$;
grant execute on function private.check_support_customer_fields(text, text, text, text, text, text) to authenticated;

-- Another customer of the department with this e-mail / phone (last 10 digits).
create or replace function private.find_duplicate_customer(p_department uuid, p_email text, p_phone text, p_exclude uuid)
returns public.customers language sql stable security definer set search_path = '' as $$
  select c.* from public.customers c
   where c.department_id = p_department and c.id is distinct from p_exclude
     and ((nullif(lower(trim(coalesce(p_email, ''))), '') is not null and c.email = lower(trim(p_email)))
       or (length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 7
           and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10)
             = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10)))
   limit 1
$$;
grant execute on function private.find_duplicate_customer(uuid, text, text, uuid) to authenticated;

create or replace function private.raise_duplicate_customer(p_dup public.customers)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_dup.id is null then
    return;
  end if;
  if private.can_view_customer(p_dup.id) then
    raise exception 'CONFLICT: This customer already exists: % (%).', p_dup.name, p_dup.customer_code using errcode = 'P0001';
  end if;
  raise exception 'CONFLICT: A customer with this phone number or e-mail already exists in the CRM.' using errcode = 'P0001';
end $$;
grant execute on function private.raise_duplicate_customer(public.customers) to authenticated;

-- ---------------------------------------------------------------------------
-- Create (replaces the round-1 version: the service now comes from the catalog)
-- ---------------------------------------------------------------------------
drop function if exists public.create_support_customer(text, text, text, text, text, text, text, text, text, text, uuid);

create or replace function public.create_support_customer(
  p_name text, p_company text, p_phone text, p_email text, p_segment text, p_status text,
  p_service_code text, p_service_details jsonb, p_requirement text, p_channel text, p_notes text,
  p_assignee uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  owner public.profiles;
  v_service text := nullif(trim(coalesce(p_service_code, '')), '');
  v_id uuid;
  v_code text;
  v_name text := trim(coalesce(p_name, ''));
  v_lead uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into owner from public.profiles where id = coalesce(p_assignee, me.id) and status = 'ACTIVE';
  if owner.id is null or owner.team_id is null then
    raise exception 'VALIDATION_ERROR: Choose an active team member to assign this customer to.' using errcode = 'P0001';
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
          private.normalize_service_details(v_service, p_service_details),
          nullif(trim(coalesce(p_requirement, '')), ''), nullif(trim(coalesce(p_channel, '')), ''), 'CUSTOMER')
  returning id, customer_code into v_id, v_code;

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
revoke all on function public.create_support_customer(text, text, text, text, text, text, text, jsonb, text, text, text, uuid) from public, anon;
grant execute on function public.create_support_customer(text, text, text, text, text, text, text, jsonb, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Edit
-- ---------------------------------------------------------------------------
create or replace function public.update_support_customer(
  p_customer uuid, p_name text, p_company text, p_phone text, p_email text, p_segment text, p_status text,
  p_service_code text, p_service_details jsonb, p_requirement text, p_channel text, p_notes text,
  p_assignee uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.customers;
  new_owner public.profiles;
  v_service text := nullif(trim(coalesce(p_service_code, '')), '');
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
         service_code = v_service,
         service_interest = case when v_service is null then null else (select name from public.crm_services where code = v_service) end,
         service_details = private.normalize_service_details(v_service, p_service_details),
         requirement = nullif(trim(coalesce(p_requirement, '')), ''),
         channel = nullif(trim(coalesce(p_channel, '')), ''),
         notes = nullif(trim(coalesce(p_notes, '')), ''),
         owner_id = coalesce(new_owner.id, owner_id)
   where id = c.id;

  insert into public.customer_activities (customer_id, actor_id, type, note)
  values (c.id, me.id, 'CUSTOMER_UPDATED', format('Details updated by %s%s', me.full_name,
          case when new_owner.id is not null then format('; assigned to %s', new_owner.full_name) else '' end));
  if new_owner.id is not null and new_owner.id <> me.id then
    perform private.notify(new_owner.id, 'CUSTOMER_ASSIGNED', format('Customer assigned: %s', trim(p_name)),
      format('%s (%s) was assigned to you by %s.', trim(p_name), c.customer_code, me.full_name), 'customer', c.id);
  end if;
end $$;
revoke all on function public.update_support_customer(uuid, text, text, text, text, text, text, text, jsonb, text, text, text, uuid) from public, anon;
grant execute on function public.update_support_customer(uuid, text, text, text, text, text, text, text, jsonb, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Invoice requests
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete set null,
  from_month date not null check (extract(day from from_month) = 1),
  to_month date not null check (extract(day from to_month) = 1),
  note text check (length(note) <= 1000),
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'RAISED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_requests_period check (to_month >= from_month)
);
create index if not exists invoice_requests_customer_idx on public.invoice_requests (customer_id, created_at desc);
create index if not exists invoice_requests_team_idx on public.invoice_requests (team_id, created_at desc);
create index if not exists invoice_requests_department_idx on public.invoice_requests (department_id, created_at desc);
drop trigger if exists invoice_requests_set_updated_at on public.invoice_requests;
create trigger invoice_requests_set_updated_at before update on public.invoice_requests
  for each row execute function public.tg_set_updated_at();

alter table public.invoice_requests enable row level security;
revoke all on public.invoice_requests from anon, authenticated;
grant select on public.invoice_requests to authenticated;
drop policy if exists invoice_requests_select on public.invoice_requests;
create policy invoice_requests_select on public.invoice_requests for select to authenticated
  using (
    requested_by = (select private.my_id())
    or (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and team_id = (select private.my_team_id()))
    or exists (select 1 from public.customers c where c.id = customer_id and c.owner_id = (select private.my_id())));

create or replace function public.request_invoice(p_customer uuid, p_from date, p_to date, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.customers;
  v_from date := date_trunc('month', p_from)::date;
  v_to date := date_trunc('month', p_to)::date;
  v_id uuid;
  v_period text;
  v_recipient uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.can_view_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null then
    raise exception 'VALIDATION_ERROR: Choose the from and to month.' using errcode = 'P0001';
  end if;
  if v_to < v_from then
    raise exception 'VALIDATION_ERROR: The "to" month must be the same as or after the "from" month.' using errcode = 'P0001';
  end if;
  if v_to > (v_from + interval '24 months')::date then
    raise exception 'VALIDATION_ERROR: An invoice request can cover at most 24 months.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;

  insert into public.invoice_requests (customer_id, department_id, team_id, requested_by, from_month, to_month, note)
  values (c.id, coalesce(me.department_id, c.department_id), me.team_id, me.id, v_from, v_to,
          left(nullif(trim(coalesce(p_note, '')), ''), 1000))
  returning id into v_id;

  v_period := case when v_from = v_to then to_char(v_from, 'Mon YYYY')
                   else format('%s – %s', to_char(v_from, 'Mon YYYY'), to_char(v_to, 'Mon YYYY')) end;
  insert into public.customer_activities (customer_id, actor_id, type, note)
  values (c.id, me.id, 'INVOICE_REQUESTED', format('Invoice requested for %s%s', v_period, coalesce(' - ' || nullif(trim(coalesce(p_note, '')), ''), '')));
  perform private.write_audit('INVOICE_REQUESTED', 'invoice_request', v_id, coalesce(me.department_id, c.department_id), me.team_id,
    jsonb_build_object('customer_id', c.id, 'from', v_from, 'to', v_to));

  -- The team lead, the department head and whoever owns the customer (raises its invoices).
  for v_recipient in
    select id from public.profiles
     where status = 'ACTIVE' and id <> me.id and (
       (role = 'TEAM_HEAD' and team_id = me.team_id)
       or (role = 'DEPARTMENT_HEAD' and department_id = c.department_id)
       or id = c.owner_id)
  loop
    perform private.notify(v_recipient, 'INVOICE_REQUESTED', format('Invoice requested: %s', c.name),
      format('%s asked for an invoice for %s (%s)%s', me.full_name, v_period, c.customer_code,
             coalesce(' - ' || nullif(trim(coalesce(p_note, '')), ''), '')), 'invoice_request', v_id);
  end loop;
  return v_id;
end $$;
revoke all on function public.request_invoice(uuid, date, date, text) from public, anon;
grant execute on function public.request_invoice(uuid, date, date, text) to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.invoice_requests;
  exception when duplicate_object then null;
  end;
end $$;
