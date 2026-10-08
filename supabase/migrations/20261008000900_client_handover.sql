-- =============================================================================
-- Client panel login + hand-over:
--   Technical Consultant → Department Head → Team Lead → Team Member.
--
-- 1. The Technical Consultant creates the client's panel in the internal
--    platform, then creates the client's LOGIN here (same e-mail + password the
--    mobile app will use). The password goes straight to Supabase Auth (hashed);
--    it is never stored or returned by the CRM. customer_client_accounts only
--    records which auth user belongs to which customer.
-- 2. Once every document/detail is authorized and the client login exists, the
--    consultant sends the customer to the Department Head. The Department Head
--    passes it to a Team Lead of the department; the Team Lead assigns it to a
--    Team Member of their team. Each step is a function that re-checks who may
--    do it; recipients get read access to the customer (not edit rights).
-- Additive / idempotent.
-- =============================================================================

-- Client logins never get a CRM profile (and so cannot use the CRM API).
create or replace function private.tg_handle_new_auth_user_deferred()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users u where u.id = new.id and u.raw_app_meta_data ? 'client_customer_id') then
    return null;
  end if;
  perform private.provision_auth_user(new.id);
  return null;
end $$;
revoke all on function private.tg_handle_new_auth_user_deferred() from public, anon, authenticated;

create table if not exists public.customer_client_accounts (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  email text not null unique check (email = lower(email) and length(email) <= 254),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.customer_client_accounts enable row level security;
revoke all on public.customer_client_accounts from public, anon, authenticated;
grant select on public.customer_client_accounts to authenticated;
drop policy if exists customer_client_accounts_select on public.customer_client_accounts;
create policy customer_client_accounts_select on public.customer_client_accounts for select to authenticated
  using (exists (select 1 from public.customers c where c.id = customer_id));

alter table public.customer_onboarding
  add column if not exists handover_stage text not null default 'CONSULTANT'
    check (handover_stage in ('CONSULTANT', 'DEPARTMENT_HEAD', 'TEAM_LEAD', 'TEAM_MEMBER')),
  add column if not exists to_department_head_at timestamptz,
  add column if not exists to_department_head_by uuid references public.profiles (id) on delete set null,
  add column if not exists team_lead_id uuid references public.profiles (id) on delete set null,
  add column if not exists passed_to_team_lead_at timestamptz,
  add column if not exists passed_to_team_lead_by uuid references public.profiles (id) on delete set null,
  add column if not exists team_member_id uuid references public.profiles (id) on delete set null,
  add column if not exists assigned_to_member_at timestamptz,
  add column if not exists assigned_to_member_by uuid references public.profiles (id) on delete set null,
  add column if not exists handover_note text check (length(handover_note) <= 1000);
create index if not exists customer_onboarding_team_lead_idx on public.customer_onboarding (team_lead_id) where team_lead_id is not null;
create index if not exists customer_onboarding_team_member_idx on public.customer_onboarding (team_member_id) where team_member_id is not null;

-- The Team Lead / Team Member a customer was handed to (SECURITY DEFINER: used
-- inside RLS policies without recursing into them).
create or replace function private.handover_recipient(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customer_onboarding o
    where o.customer_id = p_customer
      and ((o.team_lead_id = (select private.my_id()) and o.handover_stage in ('TEAM_LEAD', 'TEAM_MEMBER'))
        or (o.team_member_id = (select private.my_id()) and o.handover_stage = 'TEAM_MEMBER')))
$$;
revoke all on function private.handover_recipient(uuid) from public, anon;
grant execute on function private.handover_recipient(uuid) to authenticated;

drop policy if exists customers_select_handover on public.customers;
create policy customers_select_handover on public.customers for select to authenticated
  using (lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and private.handover_recipient(id));

-- Read access (checklist, files, owner name) for the people the customer was handed to.
create or replace function private.can_view_onboarding_review(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    join public.customer_onboarding o on o.customer_id = c.id
    where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
      and o.with_consultant
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or c.department_id = private.my_support_department_id()
        or private.handover_recipient(c.id)))
$$;
revoke all on function private.can_view_onboarding_review(uuid) from public, anon;
grant execute on function private.can_view_onboarding_review(uuid) to authenticated;

-- Review actions close once the customer has left the consultant.
create or replace function private.can_review_onboarding(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
      and private.onboarding_forwarded(c.id)
      -- once handed over to the Department Head the consultant's review is closed
      and not exists (select 1 from public.customer_onboarding o where o.customer_id = c.id and o.handover_stage <> 'CONSULTANT')
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or c.department_id = private.my_support_department_id()))
$$;
grant execute on function private.can_review_onboarding(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Client login (the password lives only in Supabase Auth)
-- ---------------------------------------------------------------------------
create or replace function private.may_manage_client_account(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_review_onboarding(p_customer)
     and exists (select 1 from public.customers c where c.id = p_customer
                  and (private.is_super_admin() or c.department_id = private.my_support_department_id()))
$$;
revoke all on function private.may_manage_client_account(uuid) from public, anon;
grant execute on function private.may_manage_client_account(uuid) to authenticated;

create or replace function public.assert_client_account_allowed(p_customer uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not private.may_manage_client_account(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_client_accounts where customer_id = p_customer) then
    raise exception 'CONFLICT: This customer already has a login.' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'VALIDATION_ERROR: Enter a valid e-mail address.' using errcode = 'P0001';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) or exists (select 1 from public.profiles where lower(email) = v_email) then
    raise exception 'CONFLICT: That e-mail already has a login. Use a different e-mail for the client.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.assert_client_account_allowed(uuid, text) from public, anon;
grant execute on function public.assert_client_account_allowed(uuid, text) to authenticated;

-- Called by the API after Supabase Auth created the user (app_metadata can only
-- be written with the service key, so the marker proves the API created it).
create or replace function public.record_client_account(p_customer uuid, p_user_id uuid, p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not private.may_manage_client_account(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u
                  where u.id = p_user_id and lower(u.email) = v_email
                    and u.raw_app_meta_data ->> 'client_customer_id' = p_customer::text) then
    raise exception 'VALIDATION_ERROR: The client login was not created for this customer.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer;
  insert into public.customer_client_accounts (customer_id, auth_user_id, email, created_by)
  values (p_customer, p_user_id, v_email, (select private.my_id()));
  perform private.log_customer_activity(p_customer, 'CLIENT_LOGIN_CREATED', format('Client login created (%s)', v_email));
  perform private.write_audit('CLIENT_LOGIN_CREATED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('email', v_email));
end $$;
revoke all on function public.record_client_account(uuid, uuid, text) from public, anon;
grant execute on function public.record_client_account(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Hand-over: consultant → department head → team lead → team member
-- ---------------------------------------------------------------------------
create or replace function public.send_to_department_head(p_customer uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 1000);
  v_head uuid;
  v_count integer := 0;
begin
  if not private.may_manage_client_account(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if v.lifecycle_stage <> 'ONBOARDING' then
    raise exception 'CONFLICT: This customer is not in onboarding.' using errcode = 'P0001';
  end if;
  if o.handover_stage <> 'CONSULTANT' then
    raise exception 'CONFLICT: Already sent to the Department Head.' using errcode = 'P0001';
  end if;
  if o.returned_at is not null or o.review_state <> 'VERIFIED' then
    raise exception 'VALIDATION_ERROR: Authorize every document and detail first (including the WABA ID where it applies).' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customer_client_accounts where customer_id = p_customer) then
    raise exception 'VALIDATION_ERROR: Create the client''s login first.' using errcode = 'P0001';
  end if;

  for v_head in
    select id from public.profiles where role = 'DEPARTMENT_HEAD' and status = 'ACTIVE' and department_id = v.department_id
  loop
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    raise exception 'CONFLICT: This department has no active Department Head to send the customer to.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding
     set handover_stage = 'DEPARTMENT_HEAD', stage = 'HANDOVER', to_department_head_at = now(),
         to_department_head_by = (select private.my_id()), handover_note = v_note
   where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'SENT_TO_DEPARTMENT_HEAD', 'Verified and sent to the Department Head' || coalesce(' · ' || v_note, ''));
  perform private.write_audit('HANDOVER_TO_DEPARTMENT_HEAD', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('note', v_note));

  for v_head in
    select id from public.profiles where role = 'DEPARTMENT_HEAD' and status = 'ACTIVE' and department_id = v.department_id
  loop
    perform private.notify(v_head, 'HANDOVER_TO_DEPARTMENT_HEAD', format('New client to assign: %s', coalesce(v.company, v.name)),
      coalesce(v_note, 'The Technical Consultant verified everything and created the client''s login.'), 'customer', p_customer);
  end loop;
  perform private.notify(v.owner_id, 'HANDOVER_TO_DEPARTMENT_HEAD', format('Verified: %s', coalesce(v.company, v.name)),
    'The Technical Consultant verified the customer and sent it to the Department Head.', 'customer', p_customer);
end $$;
revoke all on function public.send_to_department_head(uuid, text) from public, anon;
grant execute on function public.send_to_department_head(uuid, text) to authenticated;

create or replace function public.pass_to_team_lead(p_customer uuid, p_team_lead uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 1000);
begin
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not (private.is_super_admin()
       or (private.my_role() = 'DEPARTMENT_HEAD' and v.department_id = private.my_department_id())) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.customer_id is null or o.handover_stage not in ('DEPARTMENT_HEAD', 'TEAM_LEAD') then
    raise exception 'CONFLICT: This customer is not waiting to be passed to a Team Lead.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_team_lead and p.role = 'TEAM_HEAD'
                  and p.status = 'ACTIVE' and p.department_id = v.department_id) then
    raise exception 'VALIDATION_ERROR: Choose an active Team Lead of this department.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding
     set handover_stage = 'TEAM_LEAD', team_lead_id = p_team_lead, passed_to_team_lead_at = now(),
         passed_to_team_lead_by = (select private.my_id()), team_member_id = null, assigned_to_member_at = null,
         assigned_to_member_by = null, handover_note = coalesce(v_note, handover_note)
   where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'PASSED_TO_TEAM_LEAD',
    format('Passed to Team Lead %s', (select full_name from public.profiles where id = p_team_lead)) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('HANDOVER_TO_TEAM_LEAD', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('team_lead', p_team_lead, 'note', v_note));
  perform private.notify(p_team_lead, 'HANDOVER_TO_TEAM_LEAD', format('New client for your team: %s', coalesce(v.company, v.name)),
    coalesce(v_note, 'The Department Head passed this client to you. Assign it to a team member.'), 'customer', p_customer);
end $$;
revoke all on function public.pass_to_team_lead(uuid, uuid, text) from public, anon;
grant execute on function public.pass_to_team_lead(uuid, uuid, text) to authenticated;

create or replace function public.assign_to_team_member(p_customer uuid, p_member uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 1000);
  v_lead_team uuid;
begin
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.customer_id is null or not (private.is_super_admin() or o.team_lead_id = (select private.my_id())) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  if o.handover_stage not in ('TEAM_LEAD', 'TEAM_MEMBER') then
    raise exception 'CONFLICT: This customer has not been passed to a Team Lead yet.' using errcode = 'P0001';
  end if;
  select team_id into v_lead_team from public.profiles where id = o.team_lead_id;
  if not exists (select 1 from public.profiles p where p.id = p_member and p.role = 'TEAM_MEMBER'
                  and p.status = 'ACTIVE' and p.team_id = v_lead_team) then
    raise exception 'VALIDATION_ERROR: Choose an active Team Member of your team.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding
     set handover_stage = 'TEAM_MEMBER', team_member_id = p_member, assigned_to_member_at = now(),
         assigned_to_member_by = (select private.my_id()), handover_note = coalesce(v_note, handover_note)
   where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'ASSIGNED_TO_TEAM_MEMBER',
    format('Assigned to %s', (select full_name from public.profiles where id = p_member)) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('HANDOVER_TO_TEAM_MEMBER', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('team_member', p_member, 'note', v_note));
  perform private.notify(p_member, 'HANDOVER_TO_TEAM_MEMBER', format('New client assigned to you: %s', coalesce(v.company, v.name)),
    coalesce(v_note, 'Your Team Lead assigned this client to you.'), 'customer', p_customer);
end $$;
revoke all on function public.assign_to_team_member(uuid, uuid, text) from public, anon;
grant execute on function public.assign_to_team_member(uuid, uuid, text) to authenticated;

-- Hand-over status with names (profiles of other teams are not readable by everyone).
create or replace function public.customer_handover_info(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  o public.customer_onboarding;
  a public.customer_client_accounts;
begin
  if not (private.can_access_customer(p_customer) or private.can_view_onboarding_review(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  select * into a from public.customer_client_accounts where customer_id = p_customer;
  if o.customer_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'stage', o.handover_stage,
    'toDepartmentHeadAt', o.to_department_head_at,
    'sentBy', (select full_name from public.profiles where id = o.to_department_head_by),
    'teamLead', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = o.team_lead_id),
    'passedToTeamLeadAt', o.passed_to_team_lead_at,
    'teamMember', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = o.team_member_id),
    'assignedToMemberAt', o.assigned_to_member_at,
    'note', o.handover_note,
    'clientAccount', case when a.customer_id is null then null
                          else jsonb_build_object('email', a.email, 'createdAt', a.created_at) end);
end $$;
revoke all on function public.customer_handover_info(uuid) from public, anon;
grant execute on function public.customer_handover_info(uuid) to authenticated;
