-- =============================================================================
-- Fix: staff created by a manager (Super Admin → "Team Members & Access")
-- came out as a PENDING "Team Member" with no department instead of the role
-- that was picked (e.g. Department Head).
--
-- Why: Supabase Auth (auth.admin.createUser) INSERTs the auth.users row first
-- and writes app_metadata (provisioned_by / provisioned_role / …) with a
-- separate UPDATE in the same transaction. on_auth_user_created ran on the
-- INSERT, saw no provisioning data and took the self-registration path.
--
-- Now:
--  * private.provision_auth_user(id) holds the whole sign-up / provisioning
--    logic and reads the CURRENT auth.users row; it does nothing if the
--    profile already exists.
--  * on_auth_user_created still runs on INSERT, but only when the row already
--    carries bootstrap / provisioning data.
--  * on_auth_user_created_deferred runs at COMMIT (after Supabase has written
--    app_metadata) and handles everything else — provisioned staff and real
--    self-registrations alike.
--  * The Technical Consultant flag is applied inside the same function, so the
--    separate on_auth_user_created_technical_consultant trigger is dropped.
--  * Accounts already created the wrong way are repaired below: their profile
--    gets the role / department / team the manager picked, and the stray
--    "new account request" is removed.
-- Idempotent: safe to run more than once.
-- =============================================================================

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
    v_department := coalesce((select department_id from public.teams where id = v_team),
                             private.try_uuid(v_app ->> 'provisioned_department_id'));

    if not private.actor_can_assign_role(v_actor, v_role, v_department, v_team) then
      raise exception 'FORBIDDEN: You are not allowed to create this user.' using errcode = '42501';
    end if;

    insert into public.profiles (id, email, full_name, position, role, status, department_id, team_id, approved_by, approved_at)
    values (v_user.id, v_email, v_name, nullif(trim(v_meta ->> 'position'), ''), v_role, 'ACTIVE',
            v_department, v_team, v_actor, now())
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

-- On INSERT: only rows that already carry bootstrap / provisioning data.
create or replace function private.tg_handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_app jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
begin
  if v_app ? 'provisioned_by' or coalesce((v_app ->> 'bootstrap_super_admin')::boolean, false) then
    perform private.provision_auth_user(new.id);
  end if;
  return new;
end $$;
revoke all on function private.tg_handle_new_auth_user() from public, anon, authenticated;

-- At COMMIT: everything else, with app_metadata as Supabase finally wrote it.
create or replace function private.tg_handle_new_auth_user_deferred()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.provision_auth_user(new.id);
  return null;
end $$;
revoke all on function private.tg_handle_new_auth_user_deferred() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.tg_handle_new_auth_user();

drop trigger if exists on_auth_user_created_deferred on auth.users;
create constraint trigger on_auth_user_created_deferred after insert on auth.users
  deferrable initially deferred
  for each row execute function private.tg_handle_new_auth_user_deferred();

-- The consultant flag is now applied by private.provision_auth_user.
drop trigger if exists on_auth_user_created_technical_consultant on auth.users;

-- ---------------------------------------------------------------------------
-- Repair accounts that a manager created but that came out as a pending
-- self-registration (or were then approved as a plain team member).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_app jsonb;
  v_actor uuid;
  v_role public.app_role;
  v_department uuid;
  v_team uuid;
  v_consultant boolean;
begin
  for r in
    select u.id, u.raw_app_meta_data, u.raw_user_meta_data, p.status, p.email
      from auth.users u
      join public.profiles p on p.id = u.id
     where u.raw_app_meta_data ? 'provisioned_by'
       and exists (select 1 from public.approval_requests a
                    where a.subject_user_id = u.id and a.request_type = 'USER_REGISTRATION')
  loop
    v_app := r.raw_app_meta_data;
    v_actor := private.try_uuid(v_app ->> 'provisioned_by');
    begin
      v_role := (v_app ->> 'provisioned_role')::public.app_role;
    exception when others then
      raise notice 'Skipped %: invalid provisioned role', r.email;
      continue;
    end;
    v_team := private.try_uuid(v_app ->> 'provisioned_team_id');
    v_department := coalesce((select department_id from public.teams where id = v_team),
                             private.try_uuid(v_app ->> 'provisioned_department_id'));
    v_consultant := coalesce((v_app ->> 'provisioned_technical_consultant')::boolean, false);

    if not private.actor_can_assign_role(v_actor, v_role, v_department, v_team) then
      raise notice 'Skipped %: the creator may not grant this role', r.email;
      continue;
    end if;

    delete from public.notifications n
     using public.approval_requests a
     where a.subject_user_id = r.id and a.request_type = 'USER_REGISTRATION'
       and n.entity_type = 'approval_request' and n.entity_id = a.id;
    delete from public.approval_requests where subject_user_id = r.id and request_type = 'USER_REGISTRATION';

    update public.profiles
       set role = v_role,
           department_id = v_department,
           team_id = v_team,
           position = coalesce(position, nullif(trim(r.raw_user_meta_data ->> 'position'), '')),
           is_technical_consultant = is_technical_consultant or v_consultant,
           status = case when status = 'PENDING' then 'ACTIVE'::public.account_status else status end,
           approved_by = coalesce(approved_by, v_actor)
     where id = r.id;
    raise notice 'Repaired %: now % (%).', r.email, v_role, coalesce((select name from public.departments where id = v_department), '-');
  end loop;
end $$;
