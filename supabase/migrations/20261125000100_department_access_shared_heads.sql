-- =============================================================================
-- Assigning several departments to ONE Department Head while creating the account, and listing shared heads in every department they serve.
--
-- Builds on 20261123000100_department_scopes.sql (department_access: the persisted (department, function) pairs a head may work in) and
-- 20261124000100_wabatalk_support_department.sql (Wabatalk = D Talk's Support side). Nothing is renamed or moved; additive and safe to run again.
--
--   1. private.department_access_problem(department, function): the ONE rule for "may this pair be given?" (department exists, a side
--      department takes its own function only, a function whose side has its own department is given under that name, the department
--      has a team of that function). public.department_access_set uses it, and so does the check below, so the form and the database agree.
--   2. public.department_access_check(pairs): the Super Admin's form asks BEFORE the account is created, so a wrong pair never leaves a half-made user.
--   3. public.department_heads_overview(department): every Department Head who works in that department (their own or authorised), with ALL
--      their departments and functions, for the "Team Members & Access" list.
-- =============================================================================

create or replace function private.department_access_problem(p_department uuid, p_division text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  d public.departments;
  v_side public.departments;
begin
  if p_division is null or p_division not in ('SALES', 'SUPPORT') then
    return 'Choose Sales or Support.';
  end if;
  select * into d from public.departments where id = p_department;
  if d.id is null then return 'Department not found.'; end if;
  if d.facet_of is not null and d.facet_division <> p_division then
    return format('%s is the %s department, so only %s can be given.', d.name, initcap(d.facet_division), initcap(d.facet_division));
  end if;
  select * into v_side from public.departments f where f.facet_of = d.id and f.facet_division = p_division;
  if v_side.id is not null then
    return format('The %s side of %s is the %s department. Give %s instead.', initcap(p_division), d.name, v_side.name, v_side.name);
  end if;
  if not exists (select 1 from public.teams x where x.department_id = coalesce(d.facet_of, d.id) and x.division::text = p_division) then
    return format('%s has no %s team, so there is nothing for this head to manage there.', d.name, initcap(p_division));
  end if;
  return null;
end $$;
revoke all on function private.department_access_problem(uuid, text) from public, anon;
grant execute on function private.department_access_problem(uuid, text) to authenticated, service_role;

create or replace function public.department_access_set(p_profile uuid, p_department uuid, p_division text, p_granted boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  d public.departments;
  v_problem text;
begin
  if private.my_role() is distinct from 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin can give a Department Head more departments.' using errcode = '42501';
  end if;
  if p_division is null or p_division not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null then raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001'; end if;
  if t.role <> 'DEPARTMENT_HEAD' or t.status <> 'ACTIVE' then
    raise exception 'VALIDATION_ERROR: Only an active Department Head can work in more than one department or function.' using errcode = 'P0001';
  end if;
  select * into d from public.departments where id = p_department;
  if d.id is null then raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001'; end if;
  if coalesce(p_granted, false) then
    v_problem := private.department_access_problem(d.id, p_division);
    if v_problem is not null then
      raise exception 'VALIDATION_ERROR: %', v_problem using errcode = 'P0001';
    end if;
    insert into public.department_access (profile_id, department_id, division, granted_by)
    values (t.id, d.id, p_division, auth.uid())
    on conflict do nothing;
    perform private.write_audit('DEPARTMENT_ACCESS_GRANTED', 'profile', t.id, d.id, null, jsonb_build_object('division', p_division));
  else
    delete from public.department_access where profile_id = t.id and department_id = d.id and division = p_division;
    perform private.write_audit('DEPARTMENT_ACCESS_REVOKED', 'profile', t.id, d.id, null, jsonb_build_object('division', p_division));
  end if;
  return public.department_access_get(t.id);
end $$;
revoke all on function public.department_access_set(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.department_access_set(uuid, uuid, text, boolean) to authenticated;

-- The Super Admin's form: which of these (department, function) pairs would be refused, and why? [] = all fine.
create or replace function public.department_access_check(p_pairs jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  x jsonb;
  v_problem text;
  v_out jsonb := '[]'::jsonb;
begin
  if private.my_role() is distinct from 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin can give a Department Head more departments.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_pairs) <> 'array' or jsonb_array_length(p_pairs) > 60 then
    raise exception 'VALIDATION_ERROR: Invalid departments.' using errcode = 'P0001';
  end if;
  for x in select * from jsonb_array_elements(p_pairs) loop
    begin
      v_problem := private.department_access_problem((x ->> 'departmentId')::uuid, x ->> 'division');
    exception when others then
      v_problem := 'Invalid department.';
    end;
    if v_problem is not null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('departmentId', x ->> 'departmentId', 'division', x ->> 'division', 'problem', v_problem));
    end if;
  end loop;
  return v_out;
end $$;
revoke all on function public.department_access_check(jsonb) from public, anon;
grant execute on function public.department_access_check(jsonb) to authenticated;

-- Every Department Head who works in `p_department` (it is their own department or the Super Admin authorised it), with all their
-- departments and functions (Wabatalk shown under its own name; division null = the whole department).
create or replace function public.department_heads_overview(p_department uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_base uuid;
  v_div text;
  v jsonb;
begin
  select coalesce(d.facet_of, d.id), d.facet_division into v_base, v_div from public.departments d where d.id = p_department;
  if v_base is null then return '[]'::jsonb; end if;
  if not (private.is_super_admin()
          or (private.my_role() = 'DEPARTMENT_HEAD' and exists (select 1 from private.my_scopes() s where s.department_id = v_base))) then
    return '[]'::jsonb;
  end if;
  with raw as (
    select p.id as profile_id, p.department_id as department_id, p.head_division as division
      from public.profiles p where p.role = 'DEPARTMENT_HEAD' and p.status <> 'REVOKED' and p.department_id is not null
    union
    select a.profile_id, a.department_id, a.division
      from public.department_access a join public.profiles p on p.id = a.profile_id where p.role = 'DEPARTMENT_HEAD' and p.status <> 'REVOKED'),
  resolved as (
    select distinct r.profile_id, coalesce(d.facet_of, d.id) as base, coalesce(d.facet_division, r.division) as division
      from raw r join public.departments d on d.id = r.department_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'profileId', h.profile_id,
           'access', (select jsonb_agg(jsonb_build_object('departmentId', private.shown_department(x.base, x.division), 'department', sd.name, 'division', x.division)
                                       order by sd.name, x.division)
                        from resolved x join public.departments sd on sd.id = private.shown_department(x.base, x.division)
                       where x.profile_id = h.profile_id))), '[]'::jsonb)
    into v
    from (select distinct r.profile_id from resolved r
           where r.base = v_base and (v_div is null or r.division is null or r.division = v_div)) h;
  return v;
end $$;
revoke all on function public.department_heads_overview(uuid) from public, anon;
grant execute on function public.department_heads_overview(uuid) to authenticated;

notify pgrst, 'reload schema';
