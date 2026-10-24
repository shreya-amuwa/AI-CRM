-- Run this ONE file once in the Supabase SQL editor (safe to run again). It is the migration 20261120000100_department_head_division.sql.

-- =============================================================================
-- Sales and Support Department Heads.
--
-- A department can have one Department Head for each side of the business:
-- a Sales Department Head and a Support Department Head. Both keep the
-- department-wide access and the Department Head dashboard they have today;
-- the side is recorded in profiles.head_division and shown next to the name.
--
--  * profiles.head_division  ('SALES' | 'SUPPORT', NULL = not specified; only
--    meaningful for a Department Head).
--  * "One head per department" becomes "one head per department and side":
--    a second SALES head (or second SUPPORT head, or second unspecified head)
--    of the same department is still refused. A SALES head can sit next to a
--    SUPPORT head. Suspended heads still count; revoked / rejected do not.
--  * assert_can_create_user takes the side; create-user provisioning passes it
--    through app_metadata (provisioned_head_division).
--  * set_head_division(profile, side): Super Admin labels an existing head
--    (e.g. the Support head created before this existed).
-- Additive / idempotent. Run the whole file at once.
-- =============================================================================

alter table public.profiles add column if not exists head_division text;
alter table public.profiles drop constraint if exists profiles_head_division_check;
alter table public.profiles add constraint profiles_head_division_check
  check (head_division is null or head_division in ('SALES', 'SUPPORT'));

-- First active / suspended / pending head of the same side of the department.
drop function if exists private.department_head_of(uuid, uuid);
create or replace function private.department_head_of(p_department uuid, p_exclude uuid default null, p_division text default null)
returns public.profiles language sql stable security definer set search_path = '' as $$
  select * from public.profiles
   where role = 'DEPARTMENT_HEAD' and department_id = p_department
     and status in ('ACTIVE', 'SUSPENDED', 'PENDING') and id is distinct from p_exclude
     and head_division is not distinct from p_division
   order by created_at
   limit 1
$$;
grant execute on function private.department_head_of(uuid, uuid, text) to authenticated;

create or replace function private.tg_profiles_one_department_head()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.profiles;
begin
  if new.role <> 'DEPARTMENT_HEAD' then
    new.head_division := null;   -- the side belongs to Department Heads only
    return new;
  end if;
  if new.department_id is null or new.status in ('REVOKED', 'REJECTED') then
    return new;
  end if;
  -- Only check when someone becomes a head of this department / side (not on other edits).
  if tg_op = 'UPDATE' and old.role = 'DEPARTMENT_HEAD' and old.department_id is not distinct from new.department_id
     and old.status not in ('REVOKED', 'REJECTED') and old.head_division is not distinct from new.head_division then
    return new;
  end if;
  v_existing := private.department_head_of(new.department_id, new.id, new.head_division);
  if v_existing.id is not null then
    raise exception 'CONFLICT: This department already has a Department Head% (%). A department can have only one%.',
      case new.head_division when 'SALES' then ' for Sales' when 'SUPPORT' then ' for Support' else '' end, v_existing.full_name,
      case new.head_division when 'SALES' then ' Sales Department Head' when 'SUPPORT' then ' Support Department Head' else '' end
      using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_profiles_one_department_head() from public, anon, authenticated;

-- Checked before the login is created, so the manager sees the reason.
drop function if exists public.assert_can_create_user(public.app_role, uuid, uuid);
create or replace function public.assert_can_create_user(
  p_role public.app_role, p_department_id uuid default null, p_team_id uuid default null, p_head_division text default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_existing public.profiles;
begin
  if not private.actor_can_assign_role(auth.uid(), p_role, p_department_id, p_team_id) then
    raise exception 'FORBIDDEN: You are not allowed to create a % here.', replace(p_role::text, '_', ' ')
      using errcode = '42501';
  end if;
  if p_head_division is not null and (p_role <> 'DEPARTMENT_HEAD' or p_head_division not in ('SALES', 'SUPPORT')) then
    raise exception 'VALIDATION_ERROR: Only a Department Head can be a Sales or Support head.' using errcode = 'P0001';
  end if;
  if p_role = 'DEPARTMENT_HEAD' then
    v_existing := private.department_head_of(p_department_id, null, p_head_division);
    if v_existing.id is not null then
      raise exception 'CONFLICT: This department already has a Department Head% (%). A department can have only one%.',
        case p_head_division when 'SALES' then ' for Sales' when 'SUPPORT' then ' for Support' else '' end, v_existing.full_name,
        case p_head_division when 'SALES' then ' Sales Department Head' when 'SUPPORT' then ' Support Department Head' else '' end
        using errcode = 'P0001';
    end if;
  end if;
  return true;
end $$;
revoke all on function public.assert_can_create_user(public.app_role, uuid, uuid, text) from public, anon;
grant execute on function public.assert_can_create_user(public.app_role, uuid, uuid, text) to authenticated;

-- Account creation: carry the side through app_metadata (the full function, as in 20261008000800, plus the side).
create or replace function private.provision_auth_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user auth.users;
  v_meta jsonb;
  v_app jsonb;
  v_email text;
  v_name text;
  v_actor uuid;
  v_role public.app_role;
  v_department uuid;
  v_team uuid;
  v_head_division text;
  v_profile public.profiles;
  v_request public.approval_requests;
begin
  select * into v_user from auth.users where id = p_user_id;
  if v_user.id is null or exists (select 1 from public.profiles where id = p_user_id) then
    return;
  end if;
  v_meta := coalesce(v_user.raw_user_meta_data, '{}'::jsonb);
  v_app := coalesce(v_user.raw_app_meta_data, '{}'::jsonb);
  v_email := lower(v_user.email);
  v_name := left(coalesce(nullif(trim(v_meta ->> 'full_name'), ''), split_part(lower(v_user.email), '@', 1)), 160);

  if v_email is null then
    raise exception 'VALIDATION_ERROR: An e-mail address is required.' using errcode = 'P0001';
  end if;

  -- 1. Bootstrap the first Super Admin
  if coalesce((v_app ->> 'bootstrap_super_admin')::boolean, false) then
    if exists (select 1 from public.profiles where role = 'SUPER_ADMIN') then
      raise exception 'FORBIDDEN: A Super Admin already exists.' using errcode = '42501';
    end if;
    insert into public.profiles (id, email, full_name, role, status, approved_at)
    values (v_user.id, v_email, v_name, 'SUPER_ADMIN', 'ACTIVE', now()) returning * into v_profile;
    perform private.write_audit('USER_CREATED', 'profile', v_profile.id, null, null,
      jsonb_build_object('role', 'SUPER_ADMIN', 'bootstrap', true));
    return;
  end if;

  -- 2. Provisioned by a manager through the API
  if v_app ? 'provisioned_by' then
    v_actor := private.try_uuid(v_app ->> 'provisioned_by');
    begin
      v_role := (v_app ->> 'provisioned_role')::public.app_role;
    exception when others then
      raise exception 'VALIDATION_ERROR: Invalid role.' using errcode = 'P0001';
    end;
    v_team := private.try_uuid(v_app ->> 'provisioned_team_id');
    v_head_division := case when v_role = 'DEPARTMENT_HEAD' then nullif(v_app ->> 'provisioned_head_division', '') end;
    v_department := coalesce((select department_id from public.teams where id = v_team),
                             private.try_uuid(v_app ->> 'provisioned_department_id'));

    if not private.actor_can_assign_role(v_actor, v_role, v_department, v_team) then
      raise exception 'FORBIDDEN: You are not allowed to create this user.' using errcode = '42501';
    end if;

    insert into public.profiles (id, email, full_name, position, role, status, department_id, team_id, head_division, approved_by, approved_at)
    values (v_user.id, v_email, v_name, nullif(trim(v_meta ->> 'position'), ''), v_role, 'ACTIVE',
            v_department, v_team, v_head_division, v_actor, now())
    returning * into v_profile;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
    values (v_actor, 'USER_CREATED', 'profile', v_profile.id, v_department, v_team,
            jsonb_build_object('role', v_role, 'email', v_email));
    if v_team is not null then
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
      values (v_actor, 'TEAM_MEMBER_ADDED', 'team', v_team, v_department, v_team, jsonb_build_object('user_id', v_profile.id));
    end if;

    if coalesce((v_app ->> 'provisioned_technical_consultant')::boolean, false) then
      update public.profiles set is_technical_consultant = true where id = v_profile.id returning * into v_profile;
      if not v_profile.is_technical_consultant then
        raise exception 'VALIDATION_ERROR: A Technical Consultant must be a team member of a support team.' using errcode = 'P0001';
      end if;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
      values (v_actor, 'TECHNICAL_CONSULTANT_SET', 'profile', v_profile.id,
              v_profile.department_id, v_profile.team_id, jsonb_build_object('value', true));
    end if;
    return;
  end if;

  -- 3. Self-registration → PENDING team member awaiting approval
  select d.id into v_department from public.departments d
  where d.id = private.try_uuid(v_meta ->> 'department_id') and not d.is_locked;
  select t.id into v_team from public.teams t
  where t.id = private.try_uuid(v_meta ->> 'team_id') and t.department_id = v_department;

  insert into public.profiles (id, email, full_name, role, status, department_id, team_id)
  values (v_user.id, v_email, v_name, 'TEAM_MEMBER', 'PENDING', v_department, v_team)
  returning * into v_profile;

  insert into public.approval_requests (request_type, subject_user_id, department_id, team_id)
  values ('USER_REGISTRATION', v_profile.id, v_department, v_team)
  returning * into v_request;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
  values (v_profile.id, 'USER_REGISTERED', 'profile', v_profile.id, v_department, v_team,
          jsonb_build_object('approval_request_id', v_request.id));

  perform private.route_registration_request(v_request, v_profile);
end $$;
revoke all on function private.provision_auth_user(uuid) from public, anon, authenticated;

-- Super Admin labels an existing Department Head Sales or Support (or clears it).
create or replace function public.set_head_division(p_profile uuid, p_division text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
begin
  if private.my_role() is distinct from 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin can set a Department Head''s side.' using errcode = '42501';
  end if;
  if p_division is not null and p_division not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null then raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001'; end if;
  if t.role <> 'DEPARTMENT_HEAD' then
    raise exception 'VALIDATION_ERROR: Only a Department Head has a Sales or Support side.' using errcode = 'P0001';
  end if;
  -- the one-head-per-side trigger refuses a clash
  update public.profiles set head_division = p_division where id = t.id returning * into t;
  perform private.write_audit('HEAD_DIVISION_SET', 'profile', t.id, t.department_id, null, jsonb_build_object('headDivision', p_division));
  return jsonb_build_object('id', t.id, 'headDivision', t.head_division);
end $$;
revoke all on function public.set_head_division(uuid, text) from public, anon;
grant execute on function public.set_head_division(uuid, text) to authenticated;
