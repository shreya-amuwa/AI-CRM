-- =============================================================================
-- Access Control tab: save a head's whole department / function matrix in one step, and give every department of the shared / combined
-- groups the teams its functions need. Builds on 20261123 (department_access), 20261124 (Wabatalk) and 20261125 (pair check, heads overview).
-- Additive and safe to run again; nothing is deleted except the grants the Super Admin unticks.
--
--   1. Wabastar and Amuwa Design Studio only had a "General" team, so no Sales / Support grant could ever be given there (the matrix showed
--      them greyed out). They get a Sales team and a Support team, only when the department has none of that function yet. Nobody is moved.
--   2. public.department_access_apply(head, pairs): the Super Admin's Save button. The pairs are the WHOLE set of extra (department, function)
--      the head should hold; the database validates every new pair with the same rule as one-at-a-time grants, adds the missing ones and
--      removes the ones no longer ticked, in ONE transaction (all or nothing), each change audited. The head's own placement (department +
--      side) is implicit and never removed.
--   3. public.my_department_scopes(): a head who works BOTH functions of one department (D Talk: Sales, and its Support as Wabatalk) is offered
--      ONE department with the Sales | Support selector, not two separate departments.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Teams the shared / combined departments need
-- ---------------------------------------------------------------------------
insert into public.teams (department_id, name, division)
select d.id, v.name, v.division::public.team_division
  from public.departments d
 cross join (values ('Sales', 'SALES'), ('Support', 'SUPPORT')) as v(name, division)
 where d.slug in ('wabastar', 'designstudio')
   and not exists (select 1 from public.teams t where t.department_id = d.id and t.division::text = v.division)
   and not exists (select 1 from public.teams t where t.department_id = d.id and lower(t.name) = lower(v.name));

-- ---------------------------------------------------------------------------
-- 2. Save the whole matrix
-- ---------------------------------------------------------------------------
create or replace function public.department_access_apply(p_profile uuid, p_pairs jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  x jsonb;
  v_dept uuid;
  v_div text;
  v_problem text;
  v_home_base uuid;
  v_desired jsonb := '[]'::jsonb;
  r record;
  v_added integer := 0;
  v_removed integer := 0;
begin
  if private.my_role() is distinct from 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin can give a Department Head more departments.' using errcode = '42501';
  end if;
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' or jsonb_array_length(p_pairs) > 60 then
    raise exception 'VALIDATION_ERROR: Invalid departments.' using errcode = 'P0001';
  end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null then raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001'; end if;
  if t.role <> 'DEPARTMENT_HEAD' or t.status <> 'ACTIVE' then
    raise exception 'VALIDATION_ERROR: Only an active Department Head can work in more than one department or function.' using errcode = 'P0001';
  end if;
  select coalesce(d.facet_of, d.id) into v_home_base from public.departments d where d.id = t.department_id;

  for x in select * from jsonb_array_elements(p_pairs) loop
    begin
      v_dept := (x ->> 'departmentId')::uuid;
    exception when others then
      raise exception 'VALIDATION_ERROR: Invalid department.' using errcode = 'P0001';
    end;
    v_div := upper(coalesce(x ->> 'division', ''));
    -- the head's own department and side are implicit: ticking them again changes nothing
    if t.head_division is not null and v_div = t.head_division
       and (select coalesce(d.facet_of, d.id) from public.departments d where d.id = v_dept) is not distinct from v_home_base then
      continue;
    end if;
    v_problem := private.department_access_problem(v_dept, v_div);
    if v_problem is not null then
      raise exception 'VALIDATION_ERROR: %', v_problem using errcode = 'P0001';
    end if;
    v_desired := v_desired || jsonb_build_array(jsonb_build_object('department_id', v_dept, 'division', v_div));
  end loop;

  -- removed: held now, not ticked any more
  for r in select a.department_id, a.division from public.department_access a
            where a.profile_id = t.id
              and not exists (select 1 from jsonb_to_recordset(v_desired) as d(department_id uuid, division text) where d.department_id = a.department_id and d.division = a.division) loop
    delete from public.department_access where profile_id = t.id and department_id = r.department_id and division = r.division;
    perform private.write_audit('DEPARTMENT_ACCESS_REVOKED', 'profile', t.id, r.department_id, null, jsonb_build_object('division', r.division));
    v_removed := v_removed + 1;
  end loop;
  -- added: ticked, not held yet
  for r in select distinct d.department_id, d.division from jsonb_to_recordset(v_desired) as d(department_id uuid, division text)
            where not exists (select 1 from public.department_access a where a.profile_id = t.id and a.department_id = d.department_id and a.division = d.division) loop
    insert into public.department_access (profile_id, department_id, division, granted_by) values (t.id, r.department_id, r.division, auth.uid());
    perform private.write_audit('DEPARTMENT_ACCESS_GRANTED', 'profile', t.id, r.department_id, null, jsonb_build_object('division', r.division));
    v_added := v_added + 1;
  end loop;
  return public.department_access_get(t.id) || jsonb_build_object('added', v_added, 'removed', v_removed);
end $$;
revoke all on function public.department_access_apply(uuid, jsonb) from public, anon;
grant execute on function public.department_access_apply(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. One department with a Sales | Support selector when the head works both functions of it
-- ---------------------------------------------------------------------------
-- The department entry that stands for `p_base` in the head's own scopes: the base department itself when the head works the whole
-- department or both functions, else the department that carries the one function (D Talk's Support is Wabatalk).
create or replace function private.shown_for_my_scopes(p_base uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from private.my_scopes() s where s.department_id = p_base and s.division is null)
      or (exists (select 1 from private.my_scopes() s where s.department_id = p_base and s.division = 'SALES')
          and exists (select 1 from private.my_scopes() s where s.department_id = p_base and s.division = 'SUPPORT')) then p_base
    else private.shown_department(p_base, (select min(s.division) from private.my_scopes() s where s.department_id = p_base))
  end
$$;
revoke all on function private.shown_for_my_scopes(uuid) from public, anon;
grant execute on function private.shown_for_my_scopes(uuid) to authenticated, service_role;

create or replace function public.my_department_scopes()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_home uuid;
  v_home_shown uuid;
  v jsonb;
  v_act uuid := private.active_department_id();
begin
  select p.department_id into v_home from public.profiles p
   where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD';
  if v_home is null then
    return jsonb_build_object('departments', '[]'::jsonb, 'homeDepartmentId', null, 'activeDepartmentId', null, 'activeDivision', null);
  end if;
  v_home := (select coalesce(d.facet_of, d.id) from public.departments d where d.id = v_home);
  v_home_shown := private.shown_for_my_scopes(v_home);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'slug', d.slug, 'name', d.name, 'iconName', d.icon_name, 'accentColor', d.accent_color,
           'isHome', d.id = v_home_shown,
           'dataDepartmentId', g.base, 'dataSlug', b.slug,
           'divisions', coalesce(to_jsonb(g.divs), '[]'::jsonb),
           'wholeDepartment', g.whole
         ) order by (d.id = v_home_shown) desc, d.name), '[]'::jsonb)
    into v
    from (select x.shown, x.base,
                 array_agg(distinct x.division order by x.division) filter (where x.division is not null) as divs,
                 coalesce(bool_or(x.division is null), false) as whole
            from (select s.department_id as base, s.division, private.shown_for_my_scopes(s.department_id) as shown from private.my_scopes() s) x
           group by x.shown, x.base) g
    join public.departments d on d.id = g.shown
    join public.departments b on b.id = g.base;
  return jsonb_build_object('departments', v, 'homeDepartmentId', v_home_shown,
                            'activeDepartmentId', private.shown_for_my_scopes(v_act),
                            'activeDivision', private.active_head_division());
end $$;
revoke all on function public.my_department_scopes() from public, anon;
grant execute on function public.my_department_scopes() to authenticated;

notify pgrst, 'reload schema';
