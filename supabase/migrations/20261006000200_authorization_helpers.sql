-- =============================================================================
-- Authorization helpers. These are the ONLY place the hierarchy rules are
-- written down; RLS policies, triggers and workflow functions all call them.
--
-- Schema `private` is not exposed through the Supabase Data API, so these
-- functions cannot be called directly by clients.
--
-- Every "my_*" helper returns NULL unless the caller's profile is ACTIVE, so
-- any policy built on them denies PENDING / SUSPENDED / REVOKED / REJECTED
-- users automatically ("role + status" check).
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create or replace function private.my_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE'
$$;

create or replace function private.my_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE'
$$;

create or replace function private.my_department_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.department_id from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE'
$$;

create or replace function private.my_team_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.team_id from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE'
$$;

create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'SUPER_ADMIN', false)
$$;

create or replace function private.try_uuid(p_value text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end $$;

-- Can the current user SEE this profile?
--   self (any status) | super admin | department head: own department |
--   team head / member: own team + their department heads
create or replace function private.can_view_profile(
  p_id uuid, p_role public.app_role, p_department_id uuid, p_team_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_id = auth.uid() then true
    when private.my_role() = 'SUPER_ADMIN' then true
    when private.my_role() = 'DEPARTMENT_HEAD' then p_department_id = private.my_department_id()
    when private.my_role() in ('TEAM_HEAD', 'TEAM_MEMBER') then
      p_team_id = private.my_team_id()
      or (p_role = 'DEPARTMENT_HEAD' and p_department_id = private.my_department_id())
    else false
  end
$$;

-- Can `p_actor` MANAGE (approve / reject / suspend / revoke / reinstate /
-- reassign) the target profile? Never yourself; Super Admins are only
-- manageable by the database owner.
create or replace function private.actor_can_manage_profile(p_actor uuid, p_target uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.profiles;
  v_target public.profiles;
begin
  if p_actor is null or p_target is null or p_actor = p_target then
    return false;
  end if;
  select * into v_me from public.profiles where id = p_actor and status = 'ACTIVE';
  select * into v_target from public.profiles where id = p_target;
  if v_me.id is null or v_target.id is null then
    return false;
  end if;
  return case v_me.role
    when 'SUPER_ADMIN' then v_target.role <> 'SUPER_ADMIN'
    when 'DEPARTMENT_HEAD' then v_target.role in ('TEAM_HEAD', 'TEAM_MEMBER')
                                and v_target.department_id = v_me.department_id
    when 'TEAM_HEAD' then v_target.role = 'TEAM_MEMBER'
                          and v_target.team_id = v_me.team_id
    else false
  end;
end $$;

create or replace function private.can_manage_profile(p_target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.actor_can_manage_profile(auth.uid(), p_target)
$$;

-- Can `p_actor` place someone into (role, department, team)?
-- Used for provisioning new users, approving registrations into a team and
-- changing role / team assignments.
create or replace function private.actor_can_assign_role(
  p_actor uuid, p_role public.app_role, p_department_id uuid, p_team_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.profiles;
  v_team_department uuid;
begin
  select * into v_me from public.profiles where id = p_actor and status = 'ACTIVE';
  if v_me.id is null or p_role is null then
    return false;
  end if;

  -- Structural validity of the target placement
  if p_role = 'SUPER_ADMIN' then
    return false;                                   -- never assignable through the app
  elsif p_role = 'DEPARTMENT_HEAD' then
    if p_department_id is null or p_team_id is not null then return false; end if;
  else
    if p_team_id is null then return false; end if;
    select department_id into v_team_department from public.teams where id = p_team_id;
    if v_team_department is null or v_team_department is distinct from coalesce(p_department_id, v_team_department) then
      return false;
    end if;
    p_department_id := v_team_department;
  end if;

  return case v_me.role
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then p_role in ('TEAM_HEAD', 'TEAM_MEMBER') and p_department_id = v_me.department_id
    when 'TEAM_HEAD' then p_role = 'TEAM_MEMBER' and p_team_id = v_me.team_id
    else false
  end;
end $$;

-- Can the current user make `p_owner` the owner of a customer?
create or replace function private.can_assign_customer_owner(p_owner uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.profiles;
  v_owner public.profiles;
begin
  select * into v_me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  select * into v_owner from public.profiles where id = p_owner and status = 'ACTIVE';
  if v_me.id is null or v_owner.id is null or v_owner.team_id is null then
    return false;
  end if;
  return case v_me.role
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then v_owner.department_id = v_me.department_id
    when 'TEAM_HEAD' then v_owner.team_id = v_me.team_id
    when 'TEAM_MEMBER' then v_owner.id = v_me.id
    else false
  end;
end $$;

-- Is the caller in the HR department (or Super Admin)? Used by legacy HR tables.
create or replace function private.is_hr_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_super_admin() or exists (
    select 1 from public.profiles p join public.departments d on d.id = p.department_id
    where p.id = auth.uid() and p.status = 'ACTIVE' and d.slug = 'hr')
$$;

-- ---------------------------------------------------------------------------
-- Side-effect helpers (only callable from other SECURITY DEFINER code)
-- ---------------------------------------------------------------------------
create or replace function private.write_audit(
  p_action text, p_entity_type text, p_entity_id uuid,
  p_department_id uuid, p_team_id uuid, p_metadata jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
  values ((select id from public.profiles where id = auth.uid()), p_action, p_entity_type, p_entity_id,
          p_department_id, p_team_id, coalesce(p_metadata, '{}'::jsonb))
$$;

create or replace function private.notify(
  p_recipient uuid, p_type text, p_title text, p_body text,
  p_entity_type text default null, p_entity_id uuid default null,
  p_data jsonb default '{}'::jsonb, p_priority text default 'normal')
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, actor_id, data, priority)
  select p_recipient, p_type, p_title, coalesce(p_body, ''), p_entity_type, p_entity_id,
         (select id from public.profiles where id = auth.uid()), coalesce(p_data, '{}'::jsonb), p_priority
  where p_recipient is not null and p_recipient is distinct from auth.uid()
$$;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
-- Side-effect helpers are reachable only from SECURITY DEFINER code.
revoke execute on function private.write_audit(text, text, uuid, uuid, uuid, jsonb) from authenticated;
revoke execute on function private.notify(uuid, text, text, text, text, uuid, jsonb, text) from authenticated;
