-- =============================================================================
-- Operations Head: the person who oversees several departments.
--
-- Until now a Department Head could be given more departments (department_access, set by the Super Admin). That responsibility belongs to
-- a role above the Department Head and below the Super Admin: the OPERATIONS HEAD.
--
-- How it is modelled (the repository's own convention for a functional role, like is_technical_consultant): an Operations Head is a
-- DEPARTMENT_HEAD-class profile with profiles.is_operations_head = true. Every existing rule that reads "role = DEPARTMENT_HEAD" keeps working
-- inside each department the person is authorised for; no Super Admin permission is added. What changes:
--
--   * A grant of another DEPARTMENT (department_access) is honoured, and can be created, only for an Operations Head. A grant of the other
--     FUNCTION of the head's OWN department (one person handling Sales and Support of one department) is not "several departments" and stays.
--   * Grants that already exist for a Department Head who is not an Operations Head are NOT removed: they are marked `transition`, keep working, are
--     audited, and are listed for the Super Admin to decide (make the person an Operations Head, or withdraw the extra departments).
--   * Only the Super Admin makes or removes an Operations Head (set_operations_head), audited, and the person is told.
--   * The rule is enforced by a trigger on department_access, so no API call, RPC or SQL path can give a plain Department Head another department.
--
-- Additive and safe to run again.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The flag, valid only on a Department Head
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists is_operations_head boolean not null default false;

create or replace function private.tg_profiles_operations_head_flag()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_operations_head and new.role <> 'DEPARTMENT_HEAD' then
    new.is_operations_head := false;     -- cleared when the role changes
  end if;
  return new;
end $$;
revoke all on function private.tg_profiles_operations_head_flag() from public, anon, authenticated;

drop trigger if exists profiles_operations_head_flag on public.profiles;
create trigger profiles_operations_head_flag before insert or update on public.profiles
  for each row execute function private.tg_profiles_operations_head_flag();

-- Nobody changes the flag with a plain update of their own profile (or anyone's): only set_operations_head does, through this switch.
create or replace function private.tg_profiles_operations_head_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.is_operations_head is distinct from old.is_operations_head and new.role = old.role
     and coalesce(current_setting('crm.operations_head_change', true), '') <> 'on'
     and coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'FORBIDDEN: Only the Super Admin can make or remove an Operations Head.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_profiles_operations_head_guard() from public, anon, authenticated;

drop trigger if exists profiles_operations_head_guard on public.profiles;
create trigger profiles_operations_head_guard before update on public.profiles
  for each row execute function private.tg_profiles_operations_head_guard();

-- ---------------------------------------------------------------------------
-- 2. Grants: which are "several departments", and the transition mark
-- ---------------------------------------------------------------------------
alter table public.department_access add column if not exists transition boolean not null default false;

-- The department a grant or a home placement counts under (a facet such as Wabatalk counts under its base department).
create or replace function private.base_department(p_department uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(d.facet_of, d.id) from public.departments d where d.id = p_department
$$;
revoke all on function private.base_department(uuid) from public, anon;
grant execute on function private.base_department(uuid) to authenticated, service_role;

-- Is this grant for a department other than the head's own?
create or replace function private.access_is_cross_department(p_profile uuid, p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select private.base_department(p_department) is distinct from private.base_department(p.department_id)
                     from public.profiles p where p.id = p_profile), true)
$$;
revoke all on function private.access_is_cross_department(uuid, uuid) from public, anon;
grant execute on function private.access_is_cross_department(uuid, uuid) to authenticated, service_role;

-- Existing grants for a head who is not an Operations Head: kept (nobody loses access), marked, audited once.
do $$
declare
  r record;
begin
  update public.department_access a set transition = true
    from public.profiles p
   where p.id = a.profile_id and not p.is_operations_head and not a.transition
     and private.access_is_cross_department(a.profile_id, a.department_id);

  for r in select p.id, p.department_id, p.full_name,
                  (select count(*) from public.department_access a where a.profile_id = p.id and a.transition) as n
             from public.profiles p
            where p.role = 'DEPARTMENT_HEAD' and not p.is_operations_head
              and exists (select 1 from public.department_access a where a.profile_id = p.id and a.transition)
              and not exists (select 1 from public.audit_logs l where l.action = 'MULTI_DEPARTMENT_SCOPE_GRANDFATHERED' and l.entity_id = p.id) loop
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, metadata)
    values (null, 'MULTI_DEPARTMENT_SCOPE_GRANDFATHERED', 'profile', r.id, r.department_id,
            jsonb_build_object('extra_departments', r.n, 'note', 'Access kept as it was. The Super Admin decides: make this person an Operations Head, or withdraw the extra departments.'));
  end loop;
end $$;

-- The rule, for every path: a grant of another department is for an Operations Head only.
create or replace function private.tg_department_access_operations_head()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
begin
  select * into p from public.profiles where id = new.profile_id;
  if p.id is null then
    raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001';
  end if;
  if private.access_is_cross_department(new.profile_id, new.department_id) and not p.is_operations_head and not new.transition then
    raise exception 'VALIDATION_ERROR: A Department Head works in one department. To oversee several departments, make this person an Operations Head first.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_department_access_operations_head() from public, anon, authenticated;

drop trigger if exists department_access_operations_head on public.department_access;
create trigger department_access_operations_head before insert on public.department_access
  for each row execute function private.tg_department_access_operations_head();

-- ---------------------------------------------------------------------------
-- 3. The scopes a head really has
-- ---------------------------------------------------------------------------
-- home scope + the grants that are valid: any for an Operations Head; for a Department Head only the other function of their own
-- department (a combined head) and the grandfathered rows.
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
             and (p.is_operations_head or a.transition or not private.access_is_cross_department(p.id, a.department_id))) r
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
             and (p.is_operations_head or a.transition or not private.access_is_cross_department(p.id, a.department_id))) r
    join public.departments d on d.id = r.department_id
$$;
revoke all on function private.scopes_of(uuid) from public, anon;
grant execute on function private.scopes_of(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Make / remove an Operations Head (Super Admin only)
-- ---------------------------------------------------------------------------
create or replace function public.set_operations_head(p_profile uuid, p_value boolean, p_note text default null)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  v_removed integer := 0;
begin
  if private.my_role() is distinct from 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin can make or remove an Operations Head.' using errcode = '42501';
  end if;
  if p_value is null then
    raise exception 'VALIDATION_ERROR: Choose on or off.' using errcode = 'P0001';
  end if;
  select * into t from public.profiles where id = p_profile for update;
  if t.id is null then
    raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001';
  end if;
  if t.role <> 'DEPARTMENT_HEAD' or t.status <> 'ACTIVE' then
    raise exception 'VALIDATION_ERROR: Only an active Department Head can be made an Operations Head.' using errcode = 'P0001';
  end if;
  if t.is_operations_head is not distinct from p_value then
    return t;                                                   -- nothing to change
  end if;

  perform set_config('crm.operations_head_change', 'on', true);
  if p_value then
    update public.profiles set is_operations_head = true where id = t.id returning * into t;
    update public.department_access set transition = false where profile_id = t.id and transition;   -- the extra departments are now authorised, not tolerated
  else
    update public.profiles set is_operations_head = false where id = t.id returning * into t;
    -- the departments given as an Operations Head go with the role; the home scope and the other function of the own department stay
    delete from public.department_access a where a.profile_id = t.id and private.access_is_cross_department(t.id, a.department_id);
    get diagnostics v_removed = row_count;
  end if;
  perform set_config('crm.operations_head_change', 'off', true);

  perform private.write_audit(case when p_value then 'OPERATIONS_HEAD_SET' else 'OPERATIONS_HEAD_REMOVED' end, 'profile', t.id, t.department_id, null,
    jsonb_build_object('note', v_note, 'extra_departments_removed', v_removed));
  perform private.notify(t.id, 'ROLE_CHANGED',
    case when p_value then 'You are now an Operations Head' else 'You are no longer an Operations Head' end,
    case when p_value then 'You can oversee the departments the Super Admin assigns to you.' else 'You work in your own department again.' end, 'profile', t.id);
  return t;
end $$;
revoke all on function public.set_operations_head(uuid, boolean, text) from public, anon;
grant execute on function public.set_operations_head(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. What needs a decision (Super Admin)
-- ---------------------------------------------------------------------------
create or replace function public.operations_head_review()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_role() is distinct from 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin can see this.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'profileId', p.id, 'name', p.full_name, 'email', p.email, 'status', p.status,
             'homeDepartment', (select d.name from public.departments d where d.id = p.department_id),
             'isOperationsHead', p.is_operations_head,
             'needsDecision', not p.is_operations_head and exists (select 1 from public.department_access a where a.profile_id = p.id and a.transition),
             'extraDepartments', (select coalesce(jsonb_agg(jsonb_build_object('departmentId', a.department_id, 'department', d.name, 'division', a.division,
                                                                              'transition', a.transition) order by d.name), '[]'::jsonb)
                                    from public.department_access a join public.departments d on d.id = a.department_id
                                   where a.profile_id = p.id and private.access_is_cross_department(p.id, a.department_id))
           ) order by p.full_name)
      from public.profiles p
     where p.role = 'DEPARTMENT_HEAD' and p.status = 'ACTIVE'
       and (p.is_operations_head or exists (select 1 from public.department_access a
                                             where a.profile_id = p.id and private.access_is_cross_department(p.id, a.department_id)))), '[]'::jsonb);
end $$;
revoke all on function public.operations_head_review() from public, anon;
grant execute on function public.operations_head_review() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Operations overview: the departments I am authorised for, side by side (workload, not a new permission)
-- ---------------------------------------------------------------------------
create or replace function public.operations_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_super_admin() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head)) then
    raise exception 'FORBIDDEN: This page is for Operations Heads.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'departmentId', d.id, 'name', d.name, 'slug', d.slug,
             'people', (select count(*) from public.profiles p where p.department_id = d.id and p.status = 'ACTIVE' and p.role <> 'DEPARTMENT_HEAD'),
             'leads', (select count(*) from public.customers c where c.department_id = d.id and c.lifecycle_stage = 'LEAD'),
             'onboarding', (select count(*) from public.customers c where c.department_id = d.id and c.lifecycle_stage = 'ONBOARDING'),
             'customers', (select count(*) from public.customers c where c.department_id = d.id and c.lifecycle_stage = 'CUSTOMER'),
             'awaitingDepartmentHead', (select count(*) from public.customer_onboarding o join public.customers c on c.id = o.customer_id
                                          where c.department_id = d.id and o.handover_stage = 'DEPARTMENT_HEAD'),
             'withVerifier', (select count(*) from public.customer_onboarding o join public.customers c on c.id = o.customer_id
                                where c.department_id = d.id and o.forwarded_to_support_at is not null and o.handover_stage = 'CONSULTANT')
           ) order by d.name)
      from public.departments d
     where private.is_super_admin() or d.id in (select s.department_id from private.my_scopes() s)), '[]'::jsonb);
end $$;
revoke all on function public.operations_overview() from public, anon;
grant execute on function public.operations_overview() to authenticated;

notify pgrst, 'reload schema';
