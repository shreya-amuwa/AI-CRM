-- =============================================================================
-- Department x function (Sales / Support) scopes for Operations Heads and Department Heads.
-- Run after 20261223000400_employee_offboarding.sql. Safe to run again; nothing is deleted, no column is dropped, no live assignment is changed.
--
-- ROOT CAUSE 1 (a Support Operations Head could read Sales data):
--   An Operations Head's departments are rows of operations_head_departments, and private.my_scopes() / scopes_of() returned each of them as a
--   WHOLE department (division NULL). The person's own function (profiles.head_division, the "No side set / Sales / Support" choice in the member
--   list) was never applied to those rows, and the home department was added again with the same NULL division. NULL means "every team of the
--   department", so the active-scope functions (active_head_division, sales_scope_team, head_may_manage) and the Operations dashboard did not
--   narrow anything: setting the person's side to Support changed nothing.
--
-- ROOT CAUSE 2 (a Department Head could not be given a second department):
--   20261205000100 made "another department" an Operations-Head-only grant: a trigger on department_access refuses the row for a plain Department
--   Head, my_scopes() ignores such rows, and the Access Control screen disables the cells. The real organisation has Department Heads who head
--   one department and one FUNCTION of another (for example Whatsbox + D Talk Support).
--
-- What changes (additive):
--   1. operations_head_departments.division (nullable): an optional narrower function for one department. The effective function of an
--      Operations Head in a department is  coalesce(row division, the person's function)  where the person's function is profiles.head_division
--      (SALES = Sales Operations Head, SUPPORT = Support Operations Head, NULL = Sales & Support). The home department is no longer added as a
--      second, wider scope when it is one of the supervised departments.
--   2. A plain Department Head's department_access rows count again, in ANY department, for the function granted. Instead of "Operations Heads
--      only", the database refuses a grant that would give one department/function TWO Department Heads (CONFLICT, the other head is named;
--      nobody is overwritten or revoked). Rows that already exist are never re-checked.
--   3. Approvals of Department Heads follow department AND function: department_function_owner names the Operations Head accountable for one
--      function of a department; private.operations_owner_for(department, function) uses it, else the department-level owner (only when that
--      owner covers the function). Pending requests are never moved silently: a request whose owner does not cover its function waits for the
--      Super Admin (who can always decide), as an unowned request did before.
--   4. The checks that still looked only at a Department Head's HOME department now use the authorised scopes: the reviewer of Team Lead
--      reports (head_covers), the approver of Team Lead / Team Member requests, the employee directory / team assignment. Operations Heads keep
--      their previous rule there (no new power).
--   5. The Operations dashboard counts only the function the person is authorised for in each department.
--   6. Super Admin functions: operations_head_scope_apply (departments + function + per-department narrowing + who approves, in ONE transaction),
--      operations_head_function_set, and function_scope_review() - a read-only impact report for the existing accounts.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Shape
-- ---------------------------------------------------------------------------
alter table public.operations_head_departments add column if not exists division text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'operations_head_departments_division_check') then
    alter table public.operations_head_departments add constraint operations_head_departments_division_check check (division is null or division in ('SALES', 'SUPPORT'));
  end if;
end $$;

-- The Operations Head accountable for ONE function of a department (Department Head requests of that side). The department-level owner
-- (department_operations_owner) keeps working for a department where nobody is named per function.
create table if not exists public.department_function_owner (
  department_id uuid not null references public.departments (id) on delete cascade,
  division text not null check (division in ('SALES', 'SUPPORT')),
  operations_head_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  primary key (department_id, division)
);
create index if not exists department_function_owner_head_idx on public.department_function_owner (operations_head_id);
alter table public.department_function_owner enable row level security;
revoke all on public.department_function_owner from public, anon, authenticated;
drop policy if exists department_function_owner_select on public.department_function_owner;
create policy department_function_owner_select on public.department_function_owner for select to authenticated using (
  private.is_super_admin() or operations_head_id = (select auth.uid()));
grant select on public.department_function_owner to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The scopes a head really has
-- ---------------------------------------------------------------------------
-- One query for both callers (the signed-in person and anyone else), so the two can never drift apart.
--   * home: a plain Department Head's own department and side; an Operations Head's home department only when it is NOT one of the
--     supervised departments (then the supervised row, with its function, decides);
--   * department_access: every grant of a Department Head (the function is in the row);
--   * operations_head_departments: an Operations Head's departments with  coalesce(row division, the person's function).
-- A facet department (Wabatalk) is always its base department's Support side; a row that would give a facet another function is ignored.
create or replace function private.scopes_of(p_profile uuid)
returns table (department_id uuid, division text)
language sql stable security definer set search_path = '' as $$
  select distinct coalesce(d.facet_of, d.id), coalesce(d.facet_division, r.division)
    from (select p.department_id, p.head_division as division
            from public.profiles p
           where p.id = p_profile and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.department_id is not null
             and not (p.is_operations_head and exists (select 1 from public.operations_head_departments o
                                                         where o.profile_id = p.id and private.base_department(o.department_id) = private.base_department(p.department_id)))
          union
          select a.department_id, a.division
            from public.department_access a
            join public.profiles p on p.id = a.profile_id
           where a.profile_id = p_profile and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD'
          union
          select o.department_id, coalesce(o.division, p.head_division)
            from public.operations_head_departments o
            join public.profiles p on p.id = o.profile_id
           where o.profile_id = p_profile and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head) r
    join public.departments d on d.id = r.department_id
   where d.facet_division is null or r.division is null or r.division = d.facet_division
$$;
revoke all on function private.scopes_of(uuid) from public, anon;
grant execute on function private.scopes_of(uuid) to authenticated, service_role;

create or replace function private.my_scopes()
returns table (department_id uuid, division text)
language sql stable security definer set search_path = '' as $$
  select s.department_id, s.division from private.scopes_of(auth.uid()) s
$$;
revoke all on function private.my_scopes() from public, anon;
grant execute on function private.my_scopes() to authenticated, service_role;

-- The function a person is authorised for in one (base) department: NULL = the whole department (no side, or both sides);
-- 'SALES' / 'SUPPORT' = only that one. Callers check separately that a scope exists at all.
create or replace function private.scope_division_in(p_profile uuid, p_department uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when bool_or(s.division is null) or count(distinct s.division) > 1 then null else min(s.division) end
    from private.scopes_of(p_profile) s
   where s.department_id = private.base_department(p_department)
$$;
revoke all on function private.scope_division_in(uuid, uuid) from public, anon;
grant execute on function private.scope_division_in(uuid, uuid) to authenticated, service_role;

-- Does a scope of p_profile in p_department cover the function p_division (NULL / GENERAL = a request or row that belongs to no side)?
create or replace function private.scope_covers(p_profile uuid, p_department uuid, p_division text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.scopes_of(p_profile) s
                  where s.department_id = private.base_department(p_department)
                    and (s.division is null or (p_division is not null and p_division <> 'GENERAL' and s.division = p_division)))
$$;
revoke all on function private.scope_covers(uuid, uuid, text) from public, anon;
grant execute on function private.scope_covers(uuid, uuid, text) to authenticated, service_role;

-- A team as seen by a scope of function p_division (NULL = every team). A row without a team is not narrowed, as in sales_scope_team.
create or replace function private.team_in_division(p_team uuid, p_division text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_team is null or p_division is null
         or exists (select 1 from public.teams t where t.id = p_team and t.division::text = p_division)
$$;
revoke all on function private.team_in_division(uuid, text) from public, anon;
grant execute on function private.team_in_division(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Department Heads in several departments: allowed, but never two heads for one department and function
-- ---------------------------------------------------------------------------
-- The plain Department Head (not an Operations Head) who already holds this department and function, other than p_exclude: placed there
-- (with that side, or with no side = both) or granted it. NULL when there is nobody.
create or replace function private.department_function_holder(p_department uuid, p_division text, p_exclude uuid)
returns public.profiles language sql stable security definer set search_path = '' as $$
  select h.* from public.profiles h
   where h.id is distinct from p_exclude and h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status in ('ACTIVE', 'SUSPENDED')
     and (
       (private.base_department(h.department_id) = private.base_department(p_department) and (h.head_division is null or h.head_division = p_division))
       or exists (select 1 from public.department_access a join public.departments d on d.id = a.department_id
                   where a.profile_id = h.id and coalesce(d.facet_of, d.id) = private.base_department(p_department)
                     and coalesce(d.facet_division, a.division) = p_division))
   order by (private.base_department(h.department_id) = private.base_department(p_department)) desc, h.created_at
   limit 1
$$;
revoke all on function private.department_function_holder(uuid, text, uuid) from public, anon, authenticated;

create or replace function private.tg_department_access_operations_head()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  v_div text;
  v_other public.profiles;
  v_name text;
begin
  select * into p from public.profiles where id = new.profile_id;
  if p.id is null then
    raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001';
  end if;
  -- a grant that already exists (a repeated save) is not checked again
  if exists (select 1 from public.department_access a where a.profile_id = new.profile_id and a.department_id = new.department_id and a.division = new.division) then
    return new;
  end if;
  if p.is_operations_head then
    return new;                         -- an Operations Head supervises; the one-head rule is for Department Heads
  end if;
  -- a head placed in this department with no side already covers both functions: ticking them only makes both views selectable (Group B)
  if p.head_division is null and private.base_department(new.department_id) = private.base_department(p.department_id) then
    return new;
  end if;
  select coalesce(d.facet_division, new.division), d.name into v_div, v_name from public.departments d where d.id = new.department_id;
  v_other := private.department_function_holder(new.department_id, v_div, new.profile_id);
  if v_other.id is not null then
    raise exception 'CONFLICT: % already has a % Department Head (%). Decide who is responsible first: a department can have only one head for each function.',
      v_name, initcap(v_div), v_other.full_name using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_department_access_operations_head() from public, anon, authenticated;
drop trigger if exists department_access_operations_head on public.department_access;
create trigger department_access_operations_head before insert on public.department_access
  for each row execute function private.tg_department_access_operations_head();

-- ---------------------------------------------------------------------------
-- 4. Who is accountable for a Department Head request: department AND function
-- ---------------------------------------------------------------------------
create or replace function private.operations_owner_for(p_department uuid, p_division text)
returns uuid language sql stable security definer set search_path = '' as $$
  select x.id from (
    -- the Operations Head named for this function of the department
    select p.id, 1 as rank
      from public.department_function_owner o join public.profiles p on p.id = o.operations_head_id
     where o.department_id = private.base_department(p_department) and p_division in ('SALES', 'SUPPORT') and o.division = p_division
       and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head
       and private.scope_covers(p.id, p_department, p_division)
    union all
    -- else the department-level owner, only when their scope covers this function (a Support Operations Head never approves a Sales head)
    select o.id, 2 from (select private.owner_of_department(p_department) as id) o
     where o.id is not null and private.scope_covers(o.id, p_department, p_division)) x
   order by x.rank limit 1
$$;
revoke all on function private.operations_owner_for(uuid, text) from public, anon, authenticated;

create or replace function private.resolve_employee_approver(p_role public.app_role, p_ops boolean, p_department uuid, p_division text)
returns table (kind text, approver_id uuid) language plpgsql stable security definer set search_path = '' as $$
begin
  if p_role = 'DEPARTMENT_HEAD' and p_ops then
    return query select 'SUPER_ADMIN'::text, null::uuid;
  elsif p_role = 'DEPARTMENT_HEAD' then
    return query select 'OPERATIONS_HEAD'::text, private.operations_owner_for(p_department, p_division);   -- null = nobody accountable: the Super Admin decides
  else
    -- the Department Head placed in the department first (as before); then one who was given this department and function
    return query select 'DEPARTMENT_HEAD'::text,
      (select h.id from public.profiles h
        where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE'
          and (p_division is null or p_division = 'GENERAL'
               or exists (select 1 from private.scopes_of(h.id) s where s.department_id = private.base_department(p_department) and (s.division is null or s.division = p_division)))
          and exists (select 1 from private.scopes_of(h.id) s where s.department_id = private.base_department(p_department))
        order by (private.base_department(h.department_id) = private.base_department(p_department)) desc,
                 (h.head_division is not distinct from p_division) desc, h.created_at limit 1);
  end if;
end $$;
revoke all on function private.resolve_employee_approver(public.app_role, boolean, uuid, text) from public, anon, authenticated;

create or replace function private.can_decide_employee_request(p_request uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  r public.approval_requests;
  me public.profiles;
  v_approver public.profiles;
begin
  select * into r from public.approval_requests where id = p_request;
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if r.id is null or me.id is null or r.source = 'REGISTRATION' or r.subject_user_id = me.id then
    return false;                                     -- nobody approves their own account
  end if;
  if me.role = 'SUPER_ADMIN' then
    return true;                                      -- ultimate authority
  end if;
  if r.approver_kind = 'OPERATIONS_HEAD' then
    return me.role = 'DEPARTMENT_HEAD' and me.is_operations_head and private.operations_owner_for(r.department_id, r.requested_division) is not distinct from me.id;
  elsif r.approver_kind = 'DEPARTMENT_HEAD' then
    if me.role <> 'DEPARTMENT_HEAD' then
      return false;
    end if;
    if me.is_operations_head then
      -- unchanged for an Operations Head: only in the department they are placed in
      if private.base_department(me.department_id) is distinct from private.base_department(r.department_id) then
        return false;
      end if;
      if not (me.head_division is null or r.requested_division is null or r.requested_division = 'GENERAL' or me.head_division = r.requested_division) then
        return false;
      end if;
    elsif not exists (select 1 from private.scopes_of(me.id) s
                       where s.department_id = private.base_department(r.department_id)
                         and (s.division is null or r.requested_division is null or r.requested_division = 'GENERAL' or s.division = r.requested_division)) then
      return false;                                   -- a Department Head decides only in a department and function they are authorised for
    end if;
    if r.approver_id is null or r.approver_id = me.id then
      return true;
    end if;
    select * into v_approver from public.profiles where id = r.approver_id;
    return v_approver.id is null or v_approver.status <> 'ACTIVE' or v_approver.role <> 'DEPARTMENT_HEAD';   -- the named head is gone: the respective head takes over
  end if;
  return false;                                       -- SUPER_ADMIN requests: only the Super Admin
end $$;
revoke all on function private.can_decide_employee_request(uuid) from public, anon, authenticated;
grant execute on function private.can_decide_employee_request(uuid) to authenticated;

-- The reviewer of a Team Lead's report: a Department Head authorised for that department and the team's function (home OR granted).
create or replace function private.head_covers(p_head uuid, p_department uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles h
     where h.id = p_head and h.status = 'ACTIVE' and h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head
       and exists (select 1 from private.scopes_of(h.id) s
                    where s.department_id = p_department
                      and (s.division is null or p_team is null
                           or coalesce((select t.division::text from public.teams t where t.id = p_team), 'GENERAL') in ('GENERAL', s.division))))
$$;
revoke all on function private.head_covers(uuid, uuid, uuid) from public, anon, authenticated;

-- The Department Head's department for the directory and for placing Team Members: their home department as before, or (asked for by id)
-- another department they are authorised for, with that scope's function. An Operations Head keeps the previous rule.
create or replace function private.assigner_department(p_department uuid default null)
returns table (department_id uuid, head_division text, is_admin boolean) language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  if me.role = 'SUPER_ADMIN' then
    if p_department is null then
      raise exception 'VALIDATION_ERROR: Choose the department.' using errcode = 'P0001';
    end if;
    return query select private.base_department(p_department), null::text, true;
  elsif me.role = 'DEPARTMENT_HEAD' then
    -- no department named: the department the head is working in right now (the switcher in the header), which is the home one by default
    if p_department is null and not me.is_operations_head then
      p_department := private.active_department_id();
    end if;
    if p_department is null or private.base_department(p_department) = private.base_department(me.department_id) then
      if me.is_operations_head or p_department is null or private.base_department(p_department) = private.base_department(me.department_id) then
        return query select private.base_department(me.department_id),
          case when me.is_operations_head then me.head_division else private.scope_division_in(me.id, me.department_id) end, false;
        return;
      end if;
    end if;
    if me.is_operations_head or not exists (select 1 from private.scopes_of(me.id) s where s.department_id = private.base_department(p_department)) then
      raise exception 'FORBIDDEN: You can only manage your own department.' using errcode = '42501';
    end if;
    return query select private.base_department(p_department), private.scope_division_in(me.id, p_department), false;
  else
    raise exception 'FORBIDDEN: Only a Department Head can do this.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.assigner_department(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The Operations dashboard shows only the authorised function of each department
-- ---------------------------------------------------------------------------
create or replace function public.operations_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.require_operations_head();
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(row_to_json_obj order by (row_to_json_obj ->> 'name')), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', d.id, 'name', d.name, 'slug', d.slug,
      'function', s.dv,
      'accountable', coalesce(private.operations_owner_for(d.id, s.dv) = v_me, false)
                     or coalesce(s.dv is null and private.owner_of_department(d.id) = v_me, false),
      'departmentHeads', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.full_name, 'email', h.email, 'status', h.status, 'side', h.head_division,
                                'lastLoginAt', (select max(a.created_at) from public.auth_login_attempts a where a.user_id = h.id)) order by h.full_name), '[]'::jsonb)
                            from public.profiles h where h.role = 'DEPARTMENT_HEAD' and h.status in ('ACTIVE', 'SUSPENDED') and private.base_department(h.department_id) = d.id
                             and (s.dv is null or h.head_division is null or h.head_division = s.dv)),
      'teamLeads', (select count(*) from public.profiles p where p.role = 'TEAM_HEAD' and p.status = 'ACTIVE' and private.base_department(p.department_id) = d.id
                     and private.team_in_division(p.team_id, s.dv)),
      'teamMembers', (select count(*) from public.profiles p where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and private.base_department(p.department_id) = d.id
                       and private.team_in_division(p.team_id, s.dv)),
      'awaitingAssignment', (select count(*) from public.profiles p join public.teams t on t.id = p.team_id
                              where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and t.is_pool and private.base_department(p.department_id) = d.id
                                and private.team_in_division(t.id, s.dv)),
      'pendingDepartmentHeadApprovals', (select count(*) from public.approval_requests r where r.status = 'PENDING' and r.source <> 'REGISTRATION'
                                           and r.approver_kind = 'OPERATIONS_HEAD' and private.base_department(r.department_id) = d.id
                                           and private.operations_owner_for(d.id, r.requested_division) = v_me),
      'leads', (select count(*) from public.customers c where private.base_department(c.department_id) = d.id and c.lifecycle_stage = 'LEAD' and private.team_in_division(c.team_id, s.dv)),
      'onboarding', (select count(*) from public.customers c where private.base_department(c.department_id) = d.id and c.lifecycle_stage = 'ONBOARDING' and private.team_in_division(c.team_id, s.dv)),
      'customers', (select count(*) from public.customers c where private.base_department(c.department_id) = d.id and c.lifecycle_stage = 'CUSTOMER' and private.team_in_division(c.team_id, s.dv)),
      'awaitingDepartmentHead', (select count(*) from public.customer_onboarding o join public.customers c on c.id = o.customer_id
                                   where private.base_department(c.department_id) = d.id and o.handover_stage = 'DEPARTMENT_HEAD' and private.team_in_division(c.team_id, s.dv)),
      'withVerifier', (select count(*) from public.customer_onboarding o join public.customers c on c.id = o.customer_id
                         where private.base_department(c.department_id) = d.id and o.forwarded_to_support_at is not null and o.handover_stage = 'CONSULTANT'
                           and private.team_in_division(c.team_id, s.dv))
    ) as row_to_json_obj
      from public.departments d
      cross join lateral (select private.scope_division_in(v_me, d.id) as dv) s
     where d.id in (select x.department_id from private.scopes_of(v_me) x)
  ) q;
  return jsonb_build_object(
    'departments', v_rows,
    'totals', jsonb_build_object(
      'departments', jsonb_array_length(v_rows),
      'departmentHeads', (select coalesce(sum(jsonb_array_length(x -> 'departmentHeads')), 0) from jsonb_array_elements(v_rows) x),
      'teamLeads', (select coalesce(sum((x ->> 'teamLeads')::int), 0) from jsonb_array_elements(v_rows) x),
      'teamMembers', (select coalesce(sum((x ->> 'teamMembers')::int), 0) from jsonb_array_elements(v_rows) x),
      'awaitingAssignment', (select coalesce(sum((x ->> 'awaitingAssignment')::int), 0) from jsonb_array_elements(v_rows) x),
      'pendingDepartmentHeadApprovals', (select coalesce(sum((x ->> 'pendingDepartmentHeadApprovals')::int), 0) from jsonb_array_elements(v_rows) x)));
end $$;
revoke all on function public.operations_dashboard() from public, anon;
grant execute on function public.operations_dashboard() to authenticated;

create or replace function public.operations_department_detail(p_department uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.require_operations_head();
  v_dept uuid := private.base_department(p_department);
  v_div text;
begin
  if not exists (select 1 from private.scopes_of(v_me) s where s.department_id = v_dept) then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;
  v_div := private.scope_division_in(v_me, v_dept);
  return jsonb_build_object(
    'function', v_div,
    'teamLeads', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.full_name, 'team', t.name, 'division', t.division,
                    'members', (select count(*) from public.profiles m where m.team_id = l.team_id and m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE')) order by l.full_name), '[]'::jsonb)
                    from public.profiles l left join public.teams t on t.id = l.team_id
                   where l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and private.base_department(l.department_id) = v_dept and private.team_in_division(l.team_id, v_div)),
    'awaitingAssignment', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'approvedAt', p.approved_at) order by p.full_name), '[]'::jsonb)
                    from public.profiles p join public.teams t on t.id = p.team_id
                   where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and t.is_pool and private.base_department(p.department_id) = v_dept and private.team_in_division(t.id, v_div)));
end $$;
revoke all on function public.operations_department_detail(uuid) from public, anon;
grant execute on function public.operations_department_detail(uuid) to authenticated;

create or replace function public.operations_department_activity(p_department uuid, p_limit integer default 60)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.require_operations_head();
  v_dept uuid := private.base_department(p_department);
  v_div text;
begin
  if not exists (select 1 from private.scopes_of(v_me) s where s.department_id = v_dept) then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;
  v_div := private.scope_division_in(v_me, v_dept);
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', x.at, 'departmentHead', x.head_name, 'department', x.dept_name, 'type', x.type, 'reference', x.reference, 'outcome', x.outcome) order by x.at desc)
      from (
        select a.created_at as at, h.full_name as head_name, (select d.name from public.departments d where d.id = v_dept) as dept_name,
               a.action as type, coalesce(a.entity_type, '') || case when a.entity_id is null then '' else ':' || left(a.entity_id::text, 8) end as reference,
               case when a.action like '%REJECTED%' then 'Rejected' when a.action like '%APPROVED%' or a.action like '%ASSIGNED%' then 'Done' when a.action like '%FAILED%' then 'Failed' else 'Recorded' end as outcome
          from public.audit_logs a
          join public.profiles h on h.id = a.actor_id
         where h.role = 'DEPARTMENT_HEAD' and private.base_department(h.department_id) = v_dept and not h.is_operations_head
           and (v_div is null or h.head_division is null or h.head_division = v_div)
           and a.action !~* '(password|token|session|secret)'
        union all
        select l.created_at, h.full_name, (select d.name from public.departments d where d.id = v_dept), 'LOGIN', 'profile:' || left(h.id::text, 8), 'Signed in'
          from public.auth_login_attempts l
          join public.profiles h on h.id = l.user_id
         where h.role = 'DEPARTMENT_HEAD' and private.base_department(h.department_id) = v_dept and not h.is_operations_head
           and (v_div is null or h.head_division is null or h.head_division = v_div)
         order by 1 desc limit least(greatest(coalesce(p_limit, 60), 1), 200)
      ) x), '[]'::jsonb);
end $$;
revoke all on function public.operations_department_activity(uuid, integer) from public, anon;
grant execute on function public.operations_department_activity(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The Super Admin's controls
-- ---------------------------------------------------------------------------
create or replace function private.operations_head_json(p public.profiles)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.full_name, 'email', p.email, 'status', p.status,
    'function', p.head_division,
    'homeDepartment', (select jsonb_build_object('id', d.id, 'name', d.name) from public.departments d where d.id = p.department_id),
    'departments', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'slug', d.slug,
                      'function', private.scope_division_in(p.id, d.id),
                      'narrowed', (select o.division from public.operations_head_departments o where o.profile_id = p.id and private.base_department(o.department_id) = d.id limit 1),
                      'primary', exists (select 1 from public.department_operations_owner o where o.operations_head_id = p.id and private.base_department(o.department_id) = d.id)
                                 or exists (select 1 from public.department_function_owner o where o.operations_head_id = p.id and o.department_id = d.id)) order by d.name), '[]'::jsonb)
                      from public.departments d where d.id in (select s.department_id from private.scopes_of(p.id) s)),
    'pendingApprovals', (select count(*) from public.approval_requests r where r.status = 'PENDING' and r.source <> 'REGISTRATION' and r.approver_kind = 'OPERATIONS_HEAD' and r.approver_id = p.id),
    'lastLoginAt', (select max(a.created_at) from public.auth_login_attempts a where a.user_id = p.id))
$$;
revoke all on function private.operations_head_json(public.profiles) from public, anon, authenticated;

-- Name (or clear) the Operations Head accountable for ONE function of a department. Pending requests of that function move to them, audited.
create or replace function private.set_function_owner(p_department uuid, p_division text, p_head uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_dept uuid := private.base_department(p_department);
  v_old uuid;
  v_moved integer := 0;
  v_name text;
begin
  select name into v_name from public.departments where id = v_dept;
  if v_name is null then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;
  if p_division not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  select operations_head_id into v_old from public.department_function_owner where department_id = v_dept and division = p_division;
  if p_head is not null then
    if not exists (select 1 from public.profiles p where p.id = p_head and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head) then
      raise exception 'VALIDATION_ERROR: Only an active Operations Head can approve Department Heads.' using errcode = 'P0001';
    end if;
    if not private.scope_covers(p_head, v_dept, p_division) then
      raise exception 'VALIDATION_ERROR: Give % (%) to this Operations Head first.', v_name, initcap(p_division) using errcode = 'P0001';
    end if;
    insert into public.department_function_owner (department_id, division, operations_head_id, assigned_by) values (v_dept, p_division, p_head, auth.uid())
    on conflict (department_id, division) do update set operations_head_id = excluded.operations_head_id, assigned_by = excluded.assigned_by, assigned_at = now();
  else
    delete from public.department_function_owner where department_id = v_dept and division = p_division;
  end if;
  if v_old is not distinct from p_head then
    return;
  end if;
  update public.approval_requests set approver_id = p_head
   where status = 'PENDING' and source <> 'REGISTRATION' and approver_kind = 'OPERATIONS_HEAD'
     and private.base_department(department_id) = v_dept and requested_division = p_division;
  get diagnostics v_moved = row_count;
  perform private.write_audit('DEPARTMENT_FUNCTION_OWNER_SET', 'department', v_dept, v_dept, null,
    jsonb_build_object('division', p_division, 'from', v_old, 'to', p_head, 'pending_requests_moved', v_moved));
  if p_head is not null then
    perform private.notify(p_head, 'DEPARTMENT_OWNER_ASSIGNED', format('You approve %s Department Heads of %s', initcap(p_division), v_name),
      case when v_moved > 0 then format('%s request(s) waiting for approval moved to you.', v_moved) else 'Department Head requests of this side now come to you.' end, 'department', v_dept);
  end if;
  if v_old is not null then
    perform private.notify(v_old, 'DEPARTMENT_OWNER_REMOVED', format('You no longer approve %s Department Heads of %s', initcap(p_division), v_name),
      'The Super Admin changed who is accountable for this side of the department.', 'department', v_dept);
  end if;
end $$;
revoke all on function private.set_function_owner(uuid, text, uuid) from public, anon, authenticated;

-- An Operations Head's function (Sales / Support / NULL = both), audited with before and after. It applies to every supervised department
-- at once (a department can be narrowed further, never widened, with operations_head_scope_apply).
create or replace function public.operations_head_function_set(p_profile uuid, p_division text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  v_before text;
  v_div text := nullif(upper(btrim(coalesce(p_division, ''))), '');
begin
  perform private.require_super_admin();
  if v_div is not null and v_div not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales, Support, or Sales & Support.' using errcode = 'P0001';
  end if;
  select * into t from public.profiles where id = p_profile for update;
  if t.id is null then
    raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001';
  end if;
  if t.role <> 'DEPARTMENT_HEAD' or not t.is_operations_head then
    raise exception 'VALIDATION_ERROR: Only an Operations Head has an operations function.' using errcode = 'P0001';
  end if;
  v_before := t.head_division;
  if v_before is not distinct from v_div then
    return private.operations_head_json(t);
  end if;
  update public.profiles set head_division = v_div where id = t.id returning * into t;
  -- a narrowing that no longer fits the function goes (it would be wider than the person's function)
  update public.operations_head_departments set division = null where profile_id = t.id and division is not null and v_div is not null and division <> v_div;
  -- approvals the person can no longer cover stop being theirs (they wait for the Super Admin, or the head named for that side)
  delete from public.department_function_owner o where o.operations_head_id = t.id and not private.scope_covers(t.id, o.department_id, o.division);
  perform private.write_audit('OPERATIONS_FUNCTION_SET', 'profile', t.id, t.department_id, null, jsonb_build_object('before', v_before, 'after', v_div));
  perform private.notify(t.id, 'OPERATIONS_SCOPE_CHANGED', 'Your operations function was changed',
    format('You now manage %s of your departments.', case v_div when 'SALES' then 'the Sales side' when 'SUPPORT' then 'the Support side' else 'Sales and Support' end), 'profile', t.id);
  return private.operations_head_json(t);
end $$;
revoke all on function public.operations_head_function_set(uuid, text) from public, anon;
grant execute on function public.operations_head_function_set(uuid, text) to authenticated;

-- Everything of an Operations Head's scope in ONE transaction (all or nothing):
--   p_function: SALES / SUPPORT / null (both)
--   p_items: [{ "departmentId": uuid, "division": "SALES" | "SUPPORT" | null, "primary": bool }]  (division narrows one department; primary = approves its heads)
create or replace function public.operations_head_scope_apply(p_profile uuid, p_function text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  v_fn text := nullif(upper(btrim(coalesce(p_function, ''))), '');
  v_depts uuid[];
  i jsonb;
  v_dept uuid;
  v_div text;
  v_eff text;
  v_old_narrow jsonb;
  v_new_narrow jsonb;
begin
  perform private.require_super_admin();
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'VALIDATION_ERROR: An Operations Head needs at least one department. To take the role away, remove the Operations Head role instead.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 40 then
    raise exception 'VALIDATION_ERROR: Too many departments.' using errcode = 'P0001';
  end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null then
    raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct (x ->> 'departmentId')::uuid), '{}') into v_depts from jsonb_array_elements(p_items) x;
  select coalesce(jsonb_object_agg(o.department_id, o.division), '{}'::jsonb) into v_old_narrow from public.operations_head_departments o where o.profile_id = t.id;

  perform public.operations_head_function_set(t.id, v_fn);
  -- departments (and who approves at department level), as the existing screen did; the per-function approvals are set below
  perform private.operations_scope_apply(t.id, v_depts, '{}'::uuid[]);

  for i in select * from jsonb_array_elements(p_items) loop
    v_dept := (i ->> 'departmentId')::uuid;
    v_div := nullif(upper(btrim(coalesce(i ->> 'division', ''))), '');
    if v_div is not null and v_div not in ('SALES', 'SUPPORT') then
      raise exception 'VALIDATION_ERROR: Choose Sales or Support for each department.' using errcode = 'P0001';
    end if;
    if v_div is not null and v_fn is not null and v_div <> v_fn then
      raise exception 'VALIDATION_ERROR: A % Operations Head cannot be given the % side of a department.', initcap(v_fn), initcap(v_div) using errcode = 'P0001';
    end if;
    if v_div is not null and not exists (select 1 from public.teams x where x.department_id = private.base_department(v_dept) and x.division::text = v_div) then
      raise exception 'VALIDATION_ERROR: % has no % team.', (select d.name from public.departments d where d.id = v_dept), initcap(v_div) using errcode = 'P0001';
    end if;
    update public.operations_head_departments set division = v_div where profile_id = t.id and department_id = v_dept and division is distinct from v_div;
    v_eff := private.scope_division_in(t.id, v_dept);
    if coalesce((i ->> 'primary')::boolean, false) then
      if v_eff is null then
        perform private.set_department_owner(private.base_department(v_dept), t.id);
      else
        perform private.set_function_owner(v_dept, v_eff, t.id);
      end if;
    else
      -- unticked: the person stops approving there (others are never touched)
      if private.owner_of_department(v_dept) = t.id then
        perform private.set_department_owner(private.base_department(v_dept), null);
      end if;
      delete from public.department_function_owner o where o.department_id = private.base_department(v_dept) and o.operations_head_id = t.id;
    end if;
  end loop;
  delete from public.department_function_owner o where o.operations_head_id = t.id and not private.scope_covers(t.id, o.department_id, o.division);

  select coalesce(jsonb_object_agg(o.department_id, o.division), '{}'::jsonb) into v_new_narrow from public.operations_head_departments o where o.profile_id = t.id;
  if v_old_narrow is distinct from v_new_narrow then
    perform private.write_audit('OPERATIONS_FUNCTION_SCOPE_SET', 'profile', t.id, t.department_id, null, jsonb_build_object('before', v_old_narrow, 'after', v_new_narrow));
  end if;
  select * into t from public.profiles where id = t.id;
  return private.operations_head_json(t);
end $$;
revoke all on function public.operations_head_scope_apply(uuid, text, jsonb) from public, anon;
grant execute on function public.operations_head_scope_apply(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Read-only impact report for the existing accounts (Super Admin). Changes nothing.
-- ---------------------------------------------------------------------------
-- For every Operations Head and every Department Head with a grant outside their home department: what they can reach now, per department
-- and function, where it comes from, and the conflicts the Super Admin has to decide. Names and departments only, no customer data.
create or replace function public.function_scope_review()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_super_admin();
  return jsonb_build_object(
    'operationsHeads', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.full_name, 'status', p.status,
        'function', p.head_division,
        'home', (select d.name from public.departments d where d.id = p.department_id),
        'scopes', (select coalesce(jsonb_agg(jsonb_build_object('department', d.name, 'function', coalesce(s.division, 'SALES + SUPPORT (whole department)')) order by d.name), '[]'::jsonb)
                     from private.scopes_of(p.id) s join public.departments d on d.id = s.department_id),
        'seesSales', exists (select 1 from private.scopes_of(p.id) s where s.division is null or s.division = 'SALES'),
        'seesSupport', exists (select 1 from private.scopes_of(p.id) s where s.division is null or s.division = 'SUPPORT'),
        'olderGrants', (select coalesce(jsonb_agg(jsonb_build_object('department', d.name, 'function', a.division)), '[]'::jsonb)
                          from public.department_access a join public.departments d on d.id = a.department_id where a.profile_id = p.id)) order by p.full_name), '[]'::jsonb)
        from public.profiles p where p.role = 'DEPARTMENT_HEAD' and p.is_operations_head and p.status in ('ACTIVE', 'SUSPENDED')),
    'departmentHeads', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.full_name, 'status', p.status, 'side', p.head_division,
        'home', (select d.name from public.departments d where d.id = p.department_id),
        'grants', (select coalesce(jsonb_agg(jsonb_build_object('department', d.name, 'function', coalesce(d.facet_division, a.division),
                       'otherHead', (select h.full_name from private.department_function_holder(a.department_id, coalesce(d.facet_division, a.division), p.id) h where h.id is not null))
                     order by d.name), '[]'::jsonb)
                     from public.department_access a join public.departments d on d.id = a.department_id where a.profile_id = p.id)) order by p.full_name), '[]'::jsonb)
        from public.profiles p where p.role = 'DEPARTMENT_HEAD' and not p.is_operations_head and p.status in ('ACTIVE', 'SUSPENDED')
         and exists (select 1 from public.department_access a where a.profile_id = p.id)),
    'functionOwners', (select coalesce(jsonb_agg(jsonb_build_object('department', d.name, 'function', o.division, 'operationsHead', h.full_name) order by d.name, o.division), '[]'::jsonb)
        from public.department_function_owner o join public.departments d on d.id = o.department_id join public.profiles h on h.id = o.operations_head_id),
    'pendingWithoutOwner', (select count(*) from public.approval_requests r where r.status = 'PENDING' and r.source <> 'REGISTRATION' and r.approver_kind = 'OPERATIONS_HEAD'
                              and private.operations_owner_for(r.department_id, r.requested_division) is null));
end $$;
revoke all on function public.function_scope_review() from public, anon;
grant execute on function public.function_scope_review() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The Operations reports board and department view: the authorised function only (copies of the latest definitions, narrowed)
-- ---------------------------------------------------------------------------
-- A report as seen by a scope of function p_division: a Team Member / Team Lead report by its team, a Department Head report by its author's side.
create or replace function private.report_in_division(r public.work_reports, p_division text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_division is null
      or (r.kind = 'DEPARTMENT_HEAD' and coalesce((select a.head_division from public.profiles a where a.id = r.author_id), p_division) = p_division)
      or (r.kind <> 'DEPARTMENT_HEAD' and private.team_in_division(r.team_id, p_division))
$$;
revoke all on function private.report_in_division(public.work_reports, text) from public, anon, authenticated;

create or replace function public.work_reports_operations(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
  v_me uuid := auth.uid();
begin
  if private.report_level() not in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only Operations Heads can open the company reports.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'VALIDATION_ERROR: Choose a valid reporting period.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(row_obj order by row_obj ->> 'name'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', d.id, 'name', d.name, 'slug', d.slug, 'function', s.dv,
      'departmentHeads', (select coalesce(jsonb_agg(h.full_name order by h.full_name), '[]'::jsonb) from public.profiles h
                           where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE' and private.base_department(h.department_id) = d.id
                             and (s.dv is null or h.head_division is null or h.head_division = s.dv)),
      'teamLeads', (select count(*) from public.profiles p where p.role = 'TEAM_HEAD' and p.status = 'ACTIVE' and private.base_department(p.department_id) = d.id and private.team_in_division(p.team_id, s.dv)),
      'teamMembers', (select count(*) from public.profiles p where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and private.base_department(p.department_id) = d.id and private.team_in_division(p.team_id, s.dv)),
      'counts', jsonb_build_object(
        'submitted', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
        'memberApproved', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'MEMBER' and r.status = 'APPROVED' and r.period_end >= p_from and r.period_start <= p_to),
        'memberPending', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'MEMBER' and r.status in ('SUBMITTED', 'UNDER_REVIEW', 'PENDING_DEPARTMENT_HEAD') and r.period_end >= p_from and r.period_start <= p_to),
        'memberPendingTl', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'MEMBER' and r.status in ('SUBMITTED', 'UNDER_REVIEW') and r.period_end >= p_from and r.period_start <= p_to),
        'memberPendingDh', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'MEMBER' and r.status = 'PENDING_DEPARTMENT_HEAD' and r.period_end >= p_from and r.period_start <= p_to),
        'memberRevision', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'MEMBER' and r.status = 'REVISION_REQUIRED' and r.period_end >= p_from and r.period_start <= p_to),
        'memberRejected', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'MEMBER' and r.status = 'REJECTED' and r.period_end >= p_from and r.period_start <= p_to),
        'teamLeadReports', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'TEAM_LEAD' and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
        'headReports', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'DEPARTMENT_HEAD' and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
        'headPending', (select count(*) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'DEPARTMENT_HEAD' and r.status in ('SUBMITTED', 'UNDER_REVIEW') and r.period_end >= p_from and r.period_start <= p_to)),
      'headReportStatus', (select r.status from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.kind = 'DEPARTMENT_HEAD' and r.status <> 'DRAFT'
                              and r.period_end >= p_from and r.period_start <= p_to order by r.submitted_at desc limit 1),
      'lastSubmittedAt', (select max(r.submitted_at) from public.work_reports r where r.department_id = d.id and private.report_in_division(r, s.dv) and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
      'package', private.package_json((select pk from public.work_report_packages pk where pk.department_id = d.id and pk.period_start = p_from and pk.period_end = p_to))
    ) as row_obj
    from public.departments d
    cross join lateral (select case when private.report_level() = 'SUPER_ADMIN' then null else private.scope_division_in(v_me, d.id) end as dv) s
   where d.id in (select private.report_scope_departments())
  ) q;
  return jsonb_build_object('periodStart', p_from, 'periodEnd', p_to, 'departments', v_rows);
end $$;
revoke all on function public.work_reports_operations(date, date) from public, anon;
grant execute on function public.work_reports_operations(date, date) to authenticated;

create or replace function public.work_reports_operations_department(p_department uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  pk public.work_report_packages;
  v_released boolean;
  v_heads jsonb;
  v_leads jsonb;
  v_div text;
begin
  if private.report_level() not in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only Operations Heads can open the company reports.' using errcode = '42501';
  end if;
  if p_department not in (select private.report_scope_departments()) then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'VALIDATION_ERROR: Choose a valid reporting period.' using errcode = 'P0001';
  end if;
  v_div := case when private.report_level() = 'SUPER_ADMIN' then null else private.scope_division_in(auth.uid(), p_department) end;
  select * into pk from public.work_report_packages where department_id = p_department and period_start = p_from and period_end = p_to;
  -- the Super Admin always reads; the Operations Head once the Department Head submitted the week
  v_released := (pk.id is not null and pk.status not in ('DRAFT', 'COMPILING')) or private.report_level() = 'SUPER_ADMIN';
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.full_name, 'designation', nullif(h."position", ''),
      'reports', case when v_released then coalesce((select jsonb_agg(private.report_json(r, true) order by r.report_date desc, r.submitted_at desc)
                         from public.work_reports r where r.kind = 'DEPARTMENT_HEAD' and r.author_id = h.id and r.status <> 'DRAFT'
                          and r.report_date between p_from and p_to), '[]'::jsonb) else '[]'::jsonb end) order by h.full_name), '[]'::jsonb) into v_heads
    from public.profiles h
   where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE' and private.base_department(h.department_id) = p_department
     and (v_div is null or h.head_division is null or h.head_division = v_div);
  select coalesce(jsonb_agg(
      case when v_released then private.team_lead_box(l, p_from, p_to, true)
           else private.team_lead_box(l, p_from, p_to, true) || jsonb_build_object('leadReports', '[]'::jsonb, 'memberReports', '[]'::jsonb) end order by l.full_name), '[]'::jsonb) into v_leads
    from public.profiles l
   where l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and private.base_department(l.department_id) = p_department and private.team_in_division(l.team_id, v_div);
  return jsonb_build_object(
    'departmentId', p_department, 'department', (select d.name from public.departments d where d.id = p_department),
    'function', v_div, 'periodStart', p_from, 'periodEnd', p_to, 'package', private.package_json(pk), 'released', v_released,
    'stats', private.report_scope_stats(p_department, null, p_from, p_to),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'periodType', x.period_type, 'periodStart', x.period_start, 'periodEnd', x.period_end,
                                                              'submittedAt', x.submitted_at, 'status', x.status) order by x.period_end desc, x.submitted_at desc)
                           from (select * from public.work_report_packages k where k.department_id = p_department and k.status not in ('DRAFT', 'COMPILING')
                                  order by k.period_end desc, k.submitted_at desc limit 10) x), '[]'::jsonb),
    'departmentHeads', v_heads, 'teamLeads', v_leads);
end $$;
revoke all on function public.work_reports_operations_department(uuid, date, date) from public, anon;
grant execute on function public.work_reports_operations_department(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. A Department Head's task goes to a Team Lead of the head's ACTIVE department and function (the function was not checked before)
-- ---------------------------------------------------------------------------
create or replace function public.assign_task_to_team_lead(
  p_assignee uuid, p_title text, p_description text, p_priority text, p_due date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  lead public.profiles;
  v_id uuid;
begin
  select * into me from public.profiles where id = private.my_id();
  if me.id is null or me.role not in ('DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only a department head can assign tasks to team leads.' using errcode = '42501';
  end if;
  select * into lead from public.profiles where id = p_assignee;
  if lead.id is null or lead.role <> 'TEAM_HEAD' or lead.status <> 'ACTIVE'
     or (me.role = 'DEPARTMENT_HEAD' and lead.department_id is distinct from private.scoped_department(me.id, me.department_id)) then
    raise exception 'VALIDATION_ERROR: Choose an active team lead of your department.' using errcode = 'P0001';
  end if;
  -- the function too: a head working one side (Sales or Support) gives tasks to that side's Team Leads only
  if me.role = 'DEPARTMENT_HEAD' and not private.sales_scope_team(lead.team_id) then
    raise exception 'FORBIDDEN: You give tasks to the % teams only.', initcap(private.active_head_division()) using errcode = '42501';
  end if;
  if coalesce(p_priority, 'MEDIUM') not in ('LOW', 'MEDIUM', 'HIGH') then
    raise exception 'VALIDATION_ERROR: Unknown priority.' using errcode = 'P0001';
  end if;

  insert into public.work_tasks (department_id, team_id, title, description, priority, due_date, assigned_by, assignee_id)
  values (lead.department_id, lead.team_id, trim(p_title), nullif(trim(coalesce(p_description, '')), ''),
          coalesce(p_priority, 'MEDIUM'), p_due, me.id, lead.id)
  returning id into v_id;

  perform private.write_audit('TASK_ASSIGNED', 'work_task', v_id, lead.department_id, lead.team_id,
    jsonb_build_object('assignee', lead.id, 'title', p_title));
  perform private.notify(lead.id, 'TASK_ASSIGNED', format('New task: %s', trim(p_title)),
    format('Assigned by %s%s', me.full_name, case when p_due is null then '' else format(' · due %s', to_char(p_due, 'DD Mon')) end),
    'work_task', v_id);
  return v_id;
end $$;
revoke all on function public.assign_task_to_team_lead(uuid, text, text, text, date) from public, anon;
grant execute on function public.assign_task_to_team_lead(uuid, text, text, text, date) to authenticated;

notify pgrst, 'reload schema';
