-- =============================================================================
-- Operations Head: create one from the Super Admin form even when every department already has a Department Head, and let ONE account supervise
-- several departments through a single, unified dashboard. Safe to run again; no table is dropped and nothing is deleted or rewritten.
-- Run after 20261217000100_reports_two_level_approval.sql.
--
-- ROOT CAUSE of "<Department> already has a Support Department Head (...). A department can have only one for each side."
--   An Operations Head is stored as a DEPARTMENT_HEAD profile with profiles.is_operations_head = true. The account was created as a plain Department
--   Head (role DEPARTMENT_HEAD, a home department and the Sales/Support "function") and the flag was set in a LATER call. Every Department Head rule
--   therefore ran on it first: the form warned and disabled the button, the API called assert_can_create_user for a Department Head, and the profile
--   INSERT hit tg_profiles_one_department_head, all before the flag existed. department_head_of() also counted Operations Heads as the head of their
--   home department, so an Operations Head could block (or be blocked by) a real Department Head.
--
-- What changes:
--   1. department_head_of() no longer counts an Operations Head as the Department Head of a department (the roles stay apart);
--      the one-head-per-department-and-side rule is unchanged for Department Heads.
--   2. tg_profiles_one_department_head skips Operations Heads, and checks again when someone stops being one.
--   3. assert_can_create_operations_head: the form's check for an Operations Head (Super Admin only, no Department Head uniqueness);
--      assert_can_create_user is unchanged and keeps applying the rule to Department Heads.
--   4. provision_auth_user creates the profile WITH the flag when the Super Admin asks (app_metadata provisioned_operations_head).
--   5. operations_head_departments: the departments an Operations Head supervises, many-to-many (one row per Operations Head and department, no
--      duplicates, foreign keys, no function/side needed, ANY department incl. Accounts / HR). private.my_scopes / scopes_of include it, so the
--      dashboard, RLS and the active-department switch follow it. The older department_access pairs keep working.
--   6. operations_scope_apply (used by "Operations Heads" in Team Members) now writes that table: adding or removing a department takes effect at
--      once, deletes nothing of the department, its people or its Department Head, and keeps the home department among the assigned ones.
--   7. operations_head_assign_new: the departments chosen in the create form, in the same step as the account.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The departments an Operations Head supervises
-- ---------------------------------------------------------------------------
create table if not exists public.operations_head_departments (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, department_id)
);
create index if not exists operations_head_departments_department_idx on public.operations_head_departments (department_id);
drop trigger if exists operations_head_departments_set_updated_at on public.operations_head_departments;
create trigger operations_head_departments_set_updated_at before update on public.operations_head_departments
  for each row execute function public.tg_set_updated_at();
alter table public.operations_head_departments enable row level security;
revoke all on public.operations_head_departments from public, anon, authenticated;   -- read and written only through the functions below

-- The scopes a head really has: the home scope, the grants that are valid, and (an Operations Head) every department in operations_head_departments
-- as a WHOLE department (division null). A facet department (Wabatalk) stays D Talk's Support side.
create or replace function private.my_scopes()
returns table (department_id uuid, division text)
language sql stable security definer set search_path = '' as $$
  select distinct coalesce(d.facet_of, d.id), coalesce(d.facet_division, r.division)
    from (select p.department_id, p.head_division as division
            from public.profiles p
           where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.department_id is not null
          union
          select a.department_id, a.division
            from public.department_access a
            join public.profiles p on p.id = a.profile_id
           where a.profile_id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD'
             and (p.is_operations_head or a.transition or not private.access_is_cross_department(p.id, a.department_id))
          union
          select o.department_id, null::text
            from public.operations_head_departments o
            join public.profiles p on p.id = o.profile_id
           where o.profile_id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head) r
    join public.departments d on d.id = r.department_id
$$;
revoke all on function private.my_scopes() from public, anon;
grant execute on function private.my_scopes() to authenticated, service_role;

create or replace function private.scopes_of(p_profile uuid)
returns table (department_id uuid, division text)
language sql stable security definer set search_path = '' as $$
  select distinct coalesce(d.facet_of, d.id), coalesce(d.facet_division, r.division)
    from (select p.department_id, p.head_division as division
            from public.profiles p
           where p.id = p_profile and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.department_id is not null
          union
          select a.department_id, a.division
            from public.department_access a
            join public.profiles p on p.id = a.profile_id
           where a.profile_id = p_profile and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD'
             and (p.is_operations_head or a.transition or not private.access_is_cross_department(p.id, a.department_id))
          union
          select o.department_id, null::text
            from public.operations_head_departments o
            join public.profiles p on p.id = o.profile_id
           where o.profile_id = p_profile and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head) r
    join public.departments d on d.id = r.department_id
$$;
revoke all on function private.scopes_of(uuid) from public, anon;
grant execute on function private.scopes_of(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The Department Head rule applies to Department Heads only
-- ---------------------------------------------------------------------------
create or replace function private.department_head_of(p_department uuid, p_exclude uuid default null, p_division text default null)
returns public.profiles language sql stable security definer set search_path = '' as $$
  select * from public.profiles
   where role = 'DEPARTMENT_HEAD' and not is_operations_head and department_id = p_department
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
  if new.is_operations_head then
    return new;                  -- an Operations Head is not "the head" of a department: the one-head rule is for Department Heads
  end if;
  if new.department_id is null or new.status in ('REVOKED', 'REJECTED') then
    return new;
  end if;
  -- Only check when someone becomes a head of this department / side (not on other edits).
  if tg_op = 'UPDATE' and old.role = 'DEPARTMENT_HEAD' and old.department_id is not distinct from new.department_id
     and old.status not in ('REVOKED', 'REJECTED') and old.head_division is not distinct from new.head_division
     and not old.is_operations_head then
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

-- Checked before the login is created, so the manager sees the reason. An Operations Head is its own role: the Super Admin only, and no
-- Department Head uniqueness (it works in every department it is given, whoever heads them). assert_can_create_user is unchanged: it still
-- applies the one-head rule to Department Heads.
create or replace function public.assert_can_create_operations_head(p_department_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_role() is distinct from 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin can make an Operations Head.' using errcode = '42501';
  end if;
  if p_department_id is null or not exists (select 1 from public.departments d where d.id = p_department_id and not d.is_locked) then
    raise exception 'VALIDATION_ERROR: Choose at least one department for the Operations Head.' using errcode = 'P0001';
  end if;
  return true;
end $$;
revoke all on function public.assert_can_create_operations_head(uuid) from public, anon;
grant execute on function public.assert_can_create_operations_head(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Account creation: the profile is made as an Operations Head from the start
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.provision_auth_user(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_ops boolean := false;
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

  -- 1b. An employee submitted by HR (or a Team Lead): a PENDING profile and an approval request - never an active account
  if v_app ? 'request_by' then
    perform private.provision_employee_request(v_user, v_app, v_email, v_name, v_meta);
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
    -- An Operations Head is created as one (never as a Department Head first): the Department Head rule of one head per department and side
    -- does not apply to the role, and only the Super Admin can ask for it.
    v_ops := v_role = 'DEPARTMENT_HEAD' and coalesce((v_app ->> 'provisioned_operations_head')::boolean, false);
    if v_ops then
      if not exists (select 1 from public.profiles s where s.id = v_actor and s.role = 'SUPER_ADMIN' and s.status = 'ACTIVE') then
        raise exception 'FORBIDDEN: Only the Super Admin can make an Operations Head.' using errcode = '42501';
      end if;
    end if;
    v_department := coalesce((select department_id from public.teams where id = v_team),
                             private.try_uuid(v_app ->> 'provisioned_department_id'));

    if not private.actor_can_assign_role(v_actor, v_role, v_department, v_team) then
      raise exception 'FORBIDDEN: You are not allowed to create this user.' using errcode = '42501';
    end if;

    insert into public.profiles (id, email, full_name, position, role, status, department_id, team_id, head_division, is_operations_head, approved_by, approved_at)
    values (v_user.id, v_email, v_name, nullif(trim(v_meta ->> 'position'), ''), v_role, 'ACTIVE',
            v_department, v_team, v_head_division, v_ops, v_actor, now())
    returning * into v_profile;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
    values (v_actor, 'USER_CREATED', 'profile', v_profile.id, v_department, v_team,
            jsonb_build_object('role', v_role, 'email', v_email));
    if v_ops then
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
      values (v_actor, 'OPERATIONS_HEAD_SET', 'profile', v_profile.id, v_department, null, jsonb_build_object('note', 'created as an Operations Head'));
    end if;
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
    if coalesce((v_app ->> 'provisioned_meta_verifier')::boolean, false) then
      update public.profiles set is_meta_verifier = true where id = v_profile.id returning * into v_profile;
      if not v_profile.is_meta_verifier then
        raise exception 'VALIDATION_ERROR: A Meta Verifier must be a team member of a support team.' using errcode = 'P0001';
      end if;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
      values (v_actor, 'META_VERIFIER_SET', 'profile', v_profile.id,
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
end $function$;
revoke all on function private.provision_auth_user(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The departments of an Operations Head (the Super Admin's "Operations Heads" screen and the create form)
-- ---------------------------------------------------------------------------
create or replace function private.operations_scope_apply(p_profile uuid, p_departments uuid[], p_primary uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  d uuid;
  v_before uuid[];
  v_after uuid[];
  v_wanted uuid[];
  v_home uuid;
  r record;
begin
  select * into t from public.profiles where id = p_profile for update;
  if t.id is null or t.role <> 'DEPARTMENT_HEAD' or t.status <> 'ACTIVE' or not t.is_operations_head then
    raise exception 'VALIDATION_ERROR: Only an active Operations Head has a department scope.' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_wanted from unnest(coalesce(p_departments, '{}')) x;
  if cardinality(v_wanted) = 0 then
    raise exception 'VALIDATION_ERROR: An Operations Head needs at least one department. To take the role away, remove the Operations Head role instead.' using errcode = 'P0001';
  end if;
  foreach d in array v_wanted loop
    if not exists (select 1 from public.departments x where x.id = d and not x.is_locked) then
      raise exception 'VALIDATION_ERROR: That department cannot be assigned.' using errcode = 'P0001';
    end if;
  end loop;
  select coalesce(array_agg(distinct s.department_id), '{}') into v_before from private.scopes_of(p_profile) s;

  -- the departments the person supervises are exactly the ones chosen (a department that is taken away is not deleted; only the access goes)
  delete from public.operations_head_departments o where o.profile_id = p_profile and not (o.department_id = any (v_wanted));
  insert into public.operations_head_departments (profile_id, department_id, granted_by)
  select p_profile, x, private.my_id() from unnest(v_wanted) x on conflict (profile_id, department_id) do nothing;
  -- the older (department, function) grants are replaced by the whole-department ones
  delete from public.department_access a where a.profile_id = p_profile and private.access_is_cross_department(p_profile, a.department_id);

  -- the home department stays among the assigned ones: when it was taken away the person is placed in the first assigned department
  v_home := private.base_department(t.department_id);
  if not (v_home = any (select private.base_department(x) from unnest(v_wanted) x)) then
    update public.profiles set department_id = private.base_department((select u.x from unnest(p_departments) with ordinality u (x, o) order by u.o limit 1)), team_id = null where id = p_profile;
  end if;

  select coalesce(array_agg(distinct s.department_id), '{}') into v_after from private.scopes_of(p_profile) s;
  -- the departments the person no longer manages are no longer theirs to approve for
  for r in select o.department_id from public.department_operations_owner o where o.operations_head_id = p_profile loop
    if not (private.base_department(r.department_id) = any (v_after)) then
      perform private.set_department_owner(r.department_id, null);
    end if;
  end loop;
  if p_primary is not null then
    for d in select distinct x from unnest(p_primary) x loop
      perform private.set_department_owner(d, p_profile);
    end loop;
  end if;

  if v_before is distinct from v_after then
    perform private.write_audit('OPERATIONS_SCOPE_SET', 'profile', p_profile, t.department_id, null,
      jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
    perform private.notify(p_profile, 'OPERATIONS_SCOPE_CHANGED', 'Your departments were changed', 'The Super Admin changed the departments you manage. Your dashboard now shows the new list.', 'profile', p_profile);
  end if;
end $$;
revoke all on function private.operations_scope_apply(uuid, uuid[], uuid[]) from public, anon, authenticated;

-- The create form: the departments chosen for a new Operations Head. A department nobody is accountable for yet becomes this person's
-- ("approves heads"); a department that already has an accountable Operations Head keeps it (the Super Admin changes that in Operations Heads).
create or replace function public.operations_head_assign_new(p_profile uuid, p_departments uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  v_primary uuid[];
begin
  perform private.require_super_admin();
  select * into t from public.profiles where id = p_profile;
  if t.id is null then
    raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001';
  end if;
  if p_departments is not null and cardinality(p_departments) > 40 then
    raise exception 'VALIDATION_ERROR: Too many departments.' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct private.base_department(x)), '{}') into v_primary from unnest(coalesce(p_departments, '{}')) x
   where not exists (select 1 from public.department_operations_owner o join public.profiles h on h.id = o.operations_head_id
                      where private.base_department(o.department_id) = private.base_department(x) and h.status = 'ACTIVE' and h.is_operations_head);
  perform private.operations_scope_apply(p_profile, p_departments, v_primary);
  -- HR opens its own department hub, which has no Operations Dashboard: an Operations Head is placed in the first assigned department that is not HR
  select * into t from public.profiles where id = p_profile;
  if exists (select 1 from public.departments d where d.id = t.department_id and d.slug = 'hr') then
    update public.profiles set department_id = (select private.base_department(u.x) from unnest(p_departments) with ordinality u (x, o)
                                                  join public.departments d on d.id = private.base_department(u.x) where d.slug <> 'hr' order by u.o limit 1)
     where id = p_profile and exists (select 1 from unnest(p_departments) x join public.departments d on d.id = private.base_department(x) where d.slug <> 'hr');
  end if;
  select * into t from public.profiles where id = p_profile;
  return private.operations_head_json(t);
end $$;
revoke all on function public.operations_head_assign_new(uuid, uuid[]) from public, anon;
grant execute on function public.operations_head_assign_new(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
