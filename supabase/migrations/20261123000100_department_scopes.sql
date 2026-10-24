-- =============================================================================
-- Department Heads that work in several departments, and heads that handle Sales AND Support.
--
-- Two arrangements, both DATA (nothing here names a department):
--   * a shared head: one Sales head and one Support head who each look after the same few departments;
--   * a combined head: the one person who handles both Sales and Support of a department.
-- A Department Head (`profiles.role = DEPARTMENT_HEAD`) keeps their "home" department (`profiles.department_id`, and `head_division`
-- when the side is set). The Super Admin may AUTHORISE more (department, function) pairs in `department_access`. The authorised pairs are
-- the head's only scopes; everything else is refused by the database.
--
-- Which pair is "active" is chosen per request by two headers (`x-active-department` = a department id, `x-active-division` = SALES or
-- SUPPORT). PostgREST hands them to the database (request.headers); the database accepts them ONLY when they match an authorised pair and
-- otherwise falls back to the head's home scope, so a forged header grants nothing. Every existing policy and function that asks
-- `private.my_department_id()` therefore follows the active department with no change, and the Sales-side separation of
-- 20261121000100 (`private.is_sales_head`, `private.sales_scope_team`) follows the active function. The few functions that read the
-- caller's own `profiles.department_id` directly (managing members, assigning tasks / tickets / customer owners, ticket SLA, announcements)
-- are replaced below to ask the active department instead.
--
-- Nothing changes for anybody without an extra pair: the Super Admin, Team Leads, Team Members, a Department Head with only a home
-- scope, HR, Accounts, Technical Consultants and clients behave exactly as before.
-- Additive and safe to run again; nothing is deleted.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The authorised (department, function) pairs, beyond the head's home scope
-- ---------------------------------------------------------------------------
create table if not exists public.department_access (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  division text not null check (division in ('SALES', 'SUPPORT')),
  granted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (profile_id, department_id, division)
);
create index if not exists department_access_department_idx on public.department_access (department_id);
alter table public.department_access enable row level security;
revoke all on public.department_access from public, anon, authenticated;   -- read and written only through the functions below

-- ---------------------------------------------------------------------------
-- 2. Which scope is active for this request
-- ---------------------------------------------------------------------------
-- A request header (PostgREST: request.headers), or null. Never raises.
create or replace function private.request_header(p_name text)
returns text language plpgsql stable set search_path = '' as $$
begin
  return nullif(btrim(current_setting('request.headers', true)::json ->> lower(p_name)), '');
exception when others then
  return null;
end $$;
revoke all on function private.request_header(text) from public, anon;
grant execute on function private.request_header(text) to authenticated, service_role;

-- The caller's authorised scopes (a Department Head only): the home scope plus the Super Admin's grants.
-- division NULL = the whole department (a head with no side set).
create or replace function private.my_scopes()
returns table (department_id uuid, division text)
language sql stable security definer set search_path = '' as $$
  select p.department_id, p.head_division
    from public.profiles p
   where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.department_id is not null
  union
  select a.department_id, a.division
    from public.department_access a
    join public.profiles p on p.id = a.profile_id
   where a.profile_id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD'
$$;
revoke all on function private.my_scopes() from public, anon;
grant execute on function private.my_scopes() to authenticated, service_role;

-- The department the caller works in right now: the one named by the header when it is an authorised scope, else the profile's own.
create or replace function private.active_department_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.department_id from private.my_scopes() s where s.department_id::text = lower(private.request_header('x-active-department')) limit 1),
    (select p.department_id from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE'))
$$;
revoke all on function private.active_department_id() from public, anon;
grant execute on function private.active_department_id() to authenticated, service_role;

-- The function (SALES / SUPPORT) a Department Head works in right now, or NULL (not a Department Head, or the whole department).
--   * the header's division when it is authorised for the active department;
--   * else the only division authorised there (a Sales head cannot become a Support head by sending a header);
--   * else NULL: a head with no side set keeps the whole department, as before.
create or replace function private.active_head_division()
returns text language sql stable security definer set search_path = '' as $$
  with me as (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD'),
       act as (select private.active_department_id() as d),
       mine as (select s.division from private.my_scopes() s, act where s.department_id = act.d)
  select case
    when not exists (select 1 from me) then null
    when upper(private.request_header('x-active-division')) in (select division from mine where division is not null) then upper(private.request_header('x-active-division'))
    when not exists (select 1 from mine where division is null) and (select count(distinct division) from mine) = 1 then (select division from mine limit 1)
    else null
  end
$$;
revoke all on function private.active_head_division() from public, anon;
grant execute on function private.active_head_division() to authenticated, service_role;

-- The department of `p_profile` as it applies to the CALLER: the active department for the caller themselves, the profile's own for anyone else.
create or replace function private.scoped_department(p_profile uuid, p_home uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select case when p_profile is not distinct from auth.uid() then coalesce(private.my_department_id(), p_home) else p_home end
$$;
revoke all on function private.scoped_department(uuid, uuid) from public, anon;
grant execute on function private.scoped_department(uuid, uuid) to authenticated, service_role;

-- every policy and function that asks for "my department" now gets the active one
create or replace function private.my_department_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select private.active_department_id()
$$;

-- The Sales / Support side of the head, for the active function (it was the profile's own side; the same for a head with one scope).
create or replace function private.is_sales_head()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.active_head_division() = 'SALES', false)
$$;
revoke all on function private.is_sales_head() from public, anon;
grant execute on function private.is_sales_head() to authenticated, service_role;

create or replace function private.is_support_head()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.active_head_division() = 'SUPPORT', false)
$$;
revoke all on function private.is_support_head() from public, anon;
grant execute on function private.is_support_head() to authenticated, service_role;

-- A head who works one function sees that function's teams only (Sales head: Sales teams; Support head: Support teams). A row without a team,
-- anyone who is not a Department Head, and a head with no side set are not narrowed (as before).
create or replace function private.sales_scope_team(p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_team is null
         or private.active_head_division() is null
         or exists (select 1 from public.teams t where t.id = p_team and t.division::text = private.active_head_division())
$$;
revoke all on function private.sales_scope_team(uuid) from public, anon;
grant execute on function private.sales_scope_team(uuid) to authenticated, service_role;

-- The scopes of any Department Head (the home scope plus the Super Admin's grants); my_scopes() is the caller's own.
create or replace function private.scopes_of(p_profile uuid)
returns table (department_id uuid, division text)
language sql stable security definer set search_path = '' as $$
  select p.department_id, p.head_division
    from public.profiles p
   where p.id = p_profile and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.department_id is not null
  union
  select a.department_id, a.division
    from public.department_access a
    join public.profiles p on p.id = a.profile_id
   where a.profile_id = p_profile and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD'
$$;
revoke all on function private.scopes_of(uuid) from public, anon;
grant execute on function private.scopes_of(uuid) to authenticated, service_role;

-- May this Department Head manage people / teams of `p_division` (NULL = any) in `p_department`?
--   * the caller themselves: only in the ACTIVE department, and only the active function (a head working one function manages that function's teams);
--   * anyone else (the sign-in trigger that provisions a new user, run without the caller's request headers): any department and function the head is authorised for.
create or replace function private.head_may_manage(p_actor uuid, p_department uuid, p_division text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_actor is not distinct from auth.uid() then
      p_department is not distinct from private.my_department_id()
      and (private.active_head_division() is null or p_division is null or private.active_head_division() = p_division)
    else exists (select 1 from private.scopes_of(p_actor) s
                  where s.department_id = p_department and (s.division is null or p_division is null or s.division = p_division))
  end
$$;
revoke all on function private.head_may_manage(uuid, uuid, text) from public, anon;
grant execute on function private.head_may_manage(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The API reads the active department from the same place (public.api_session)
-- ---------------------------------------------------------------------------
create or replace function public.api_session(p_buckets jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_profile jsonb;
  v_buckets jsonb := '[]'::jsonb;
  b jsonb;
begin
  if v_uid is null then
    raise exception 'UNAUTHENTICATED: Missing user.' using errcode = '28000';
  end if;
  if jsonb_typeof(p_buckets) <> 'array' or jsonb_array_length(p_buckets) > 5 then
    raise exception 'VALIDATION_ERROR: Invalid rate-limit buckets.' using errcode = 'P0001';
  end if;

  -- department_id is the ACTIVE department (a Department Head with several authorised departments); everyone else: their own
  select jsonb_build_object('id', p.id, 'email', p.email, 'role', p.role, 'status', p.status,
                            'department_id', case when p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' then coalesce(private.active_department_id(), p.department_id) else p.department_id end,
                            'team_id', p.team_id, 'head_division', case when p.status = 'ACTIVE' then private.active_head_division() end)
    into v_profile
    from public.profiles p where p.id = v_uid;
  if v_profile is null then
    return jsonb_build_object('profile', null, 'limits', '[]'::jsonb);
  end if;

  for b in select * from jsonb_array_elements(p_buckets) loop
    v_buckets := v_buckets || jsonb_build_array(jsonb_build_object(
      'key', format('user:%s%s', v_uid, coalesce(left(b ->> 'suffix', 30), '')),
      'limit', greatest(1, least(coalesce((b ->> 'limit')::integer, 120), 100000)),
      'window', greatest(1, least(coalesce((b ->> 'window')::integer, 60), 86400))));
  end loop;

  return jsonb_build_object(
    'profile', v_profile,
    'limits', coalesce((select jsonb_agg(to_jsonb(r)) from public.rate_limit_consume(v_buckets) r), '[]'::jsonb));
end $$;
revoke all on function public.api_session(jsonb) from public, anon;
grant execute on function public.api_session(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. What the dashboard may offer: the departments and functions this head is authorised for
-- ---------------------------------------------------------------------------
create or replace function public.my_department_scopes()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_home uuid;
  v jsonb;
begin
  select p.department_id into v_home from public.profiles p
   where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD';
  if v_home is null then
    return jsonb_build_object('departments', '[]'::jsonb, 'homeDepartmentId', null, 'activeDepartmentId', null, 'activeDivision', null);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'slug', d.slug, 'name', d.name, 'iconName', d.icon_name, 'accentColor', d.accent_color,
           'isHome', d.id = v_home,
           'divisions', (select coalesce(jsonb_agg(distinct s.division order by s.division), '[]'::jsonb) from private.my_scopes() s where s.department_id = d.id and s.division is not null),
           'wholeDepartment', exists (select 1 from private.my_scopes() s where s.department_id = d.id and s.division is null)
         ) order by (d.id = v_home) desc, d.name), '[]'::jsonb)
    into v
    from public.departments d
   where d.id in (select s.department_id from private.my_scopes() s);
  return jsonb_build_object('departments', v, 'homeDepartmentId', v_home,
                            'activeDepartmentId', private.active_department_id(), 'activeDivision', private.active_head_division());
end $$;
revoke all on function public.my_department_scopes() from public, anon;
grant execute on function public.my_department_scopes() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The Super Admin authorises (department, function) pairs for a Department Head
-- ---------------------------------------------------------------------------
create or replace function public.department_access_get(p_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.profiles;
begin
  if private.my_role() is distinct from 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin can see this.' using errcode = '42501';
  end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null then raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'profileId', t.id, 'name', t.full_name, 'role', t.role, 'homeDepartmentId', t.department_id, 'headDivision', t.head_division,
    'grants', (select coalesce(jsonb_agg(jsonb_build_object('departmentId', a.department_id, 'division', a.division) order by a.created_at), '[]'::jsonb)
                 from public.department_access a where a.profile_id = t.id),
    'departments', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', d.id, 'slug', d.slug, 'name', d.name,
                      'hasSales', exists (select 1 from public.teams x where x.department_id = d.id and x.division = 'SALES'),
                      'hasSupport', exists (select 1 from public.teams x where x.department_id = d.id and x.division = 'SUPPORT')) order by d.name), '[]'::jsonb)
                      from public.departments d));
end $$;
revoke all on function public.department_access_get(uuid) from public, anon;
grant execute on function public.department_access_get(uuid) to authenticated;

create or replace function public.department_access_set(p_profile uuid, p_department uuid, p_division text, p_granted boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  d public.departments;
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
    if not exists (select 1 from public.teams x where x.department_id = d.id and x.division::text = p_division) then
      raise exception 'VALIDATION_ERROR: % has no % team, so there is nothing for this head to manage there.', d.name, initcap(p_division) using errcode = 'P0001';
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

-- ---------------------------------------------------------------------------
-- 6. Functions that read the caller's own department directly now ask for the active one
--    (each is the latest definition with `me.department_id` replaced by private.scoped_department(me.id, me.department_id))
-- ---------------------------------------------------------------------------

-- from 20261006000200_authorization_helpers.sql
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
                                and v_target.department_id = private.scoped_department(v_me.id, v_me.department_id)
    when 'TEAM_HEAD' then v_target.role = 'TEAM_MEMBER'
                          and v_target.team_id = v_me.team_id
    else false
  end;
end $$;

-- from 20261121000100_sales_department_head.sql (the head's side check, which read the profile's own label, now asks head_may_manage: the active function, or the authorised ones)
create or replace function private.actor_can_assign_role(
  p_actor uuid, p_role public.app_role, p_department_id uuid, p_team_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.profiles;
  v_team_department uuid;
  v_team_division text;
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
    select department_id, division::text into v_team_department, v_team_division from public.teams where id = p_team_id;
    if v_team_department is null or v_team_department is distinct from coalesce(p_department_id, v_team_department) then
      return false;
    end if;
    p_department_id := v_team_department;
  end if;

  return case v_me.role
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then p_role in ('TEAM_HEAD', 'TEAM_MEMBER') and private.head_may_manage(p_actor, p_department_id, v_team_division)
    when 'TEAM_HEAD' then p_role = 'TEAM_MEMBER' and p_team_id = v_me.team_id
    else false
  end;
end $$;

-- from 20261006000200_authorization_helpers.sql
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
    when 'DEPARTMENT_HEAD' then v_owner.department_id = private.scoped_department(v_me.id, v_me.department_id)
    when 'TEAM_HEAD' then v_owner.team_id = v_me.team_id
    when 'TEAM_MEMBER' then v_owner.id = v_me.id
    else false
  end;
end $$;

-- from 20261006000400_workflow_functions.sql
create or replace function public.broadcast_announcement(
  p_title text, p_body text, p_priority text default 'announcement',
  p_department_id uuid default null, p_division public.team_division default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := private.my_role();
  v_department uuid := p_department_id;
  v_team uuid;
  v_count integer;
begin
  if v_role is null or v_role = 'TEAM_MEMBER' then
    raise exception 'FORBIDDEN: You cannot send announcements.' using errcode = '42501';
  end if;
  if length(coalesce(trim(p_title), '')) = 0 or length(p_title) > 200 or length(coalesce(p_body, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Title is required (max 200 chars); message max 2000 chars.' using errcode = 'P0001';
  end if;
  if p_priority not in ('normal', 'urgent', 'announcement') then
    raise exception 'VALIDATION_ERROR: Invalid priority.' using errcode = 'P0001';
  end if;

  if v_role = 'DEPARTMENT_HEAD' then
    if v_department is not null and v_department <> private.my_department_id() then
      raise exception 'FORBIDDEN: You can only message your own department.' using errcode = '42501';
    end if;
    v_department := private.my_department_id();
  elsif v_role = 'TEAM_HEAD' then
    v_team := private.my_team_id();
    v_department := null;
  end if;

  insert into public.notifications (recipient_id, type, title, body, priority, entity_type, entity_id, actor_id, data)
  select p.id, 'ANNOUNCEMENT', trim(p_title), coalesce(p_body, ''), p_priority,
         case when v_team is not null then 'team' when v_department is not null then 'department' end,
         coalesce(v_team, v_department), auth.uid(),
         jsonb_build_object('division', p_division,
                            'sender_name', (select full_name from public.profiles where id = auth.uid()),
                            'sender_department', (select d.name from public.profiles me
                                                  join public.departments d on d.id = private.scoped_department(me.id, me.department_id)
                                                  where me.id = auth.uid()))
  from public.profiles p
  left join public.teams t on t.id = p.team_id
  where p.status = 'ACTIVE' and p.id <> auth.uid()
    and (v_team is null or p.team_id = v_team)
    and (v_department is null or p.department_id = v_department)
    and (p_division is null or t.division = p_division or p.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD'));
  get diagnostics v_count = row_count;

  perform private.write_audit('ANNOUNCEMENT_SENT', coalesce(case when v_team is not null then 'team' end, 'department'),
    coalesce(v_team, v_department), v_department, v_team,
    jsonb_build_object('title', p_title, 'recipients', v_count, 'division', p_division));
  return v_count;
end $$;

-- from 20261008000600_work_tasks.sql
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

-- from 20261009000100_support_member_dashboard.sql
create or replace function private.can_assign_ticket_to(p_assignee uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  a public.profiles;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into a from public.profiles where id = p_assignee and status = 'ACTIVE';
  if me.id is null or a.id is null or a.team_id is null or a.role not in ('TEAM_MEMBER', 'TEAM_HEAD') then
    return false;
  end if;
  return case me.role
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then a.department_id = private.scoped_department(me.id, me.department_id)
    when 'TEAM_HEAD' then a.team_id = me.team_id
    when 'TEAM_MEMBER' then a.id = me.id
    else false
  end;
end $$;

-- from 20261009400000_customer_multiple_services.sql
create or replace function public.update_support_customer(
  p_customer uuid, p_name text, p_company text, p_phone text, p_email text, p_segment text, p_status text,
  p_services jsonb, p_requirement text, p_channel text, p_notes text,
  p_assignee uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.customers;
  new_owner public.profiles;
  v_list jsonb := private.normalize_service_list(p_services);
  v_service text;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into c from public.customers where id = p_customer for update;
  if me.id is null or c.id is null or not private.can_view_customer(c.id) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if not (c.owner_id = me.id
          or me.role = 'SUPER_ADMIN'
          or (me.role = 'DEPARTMENT_HEAD' and c.department_id = private.scoped_department(me.id, me.department_id))
          or (me.role = 'TEAM_HEAD' and c.team_id = me.team_id)) then
    raise exception 'FORBIDDEN: Only the assigned team member or their team lead can edit this customer.' using errcode = '42501';
  end if;
  v_service := v_list -> 0 ->> 'serviceCode';
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
         service_code = case when p_services is null then service_code else v_service end,
         service_interest = case when p_services is null then service_interest when v_service is null then null else (select name from public.crm_services where code = v_service) end,
         service_details = case when p_services is null then service_details else coalesce(v_list -> 0 -> 'serviceDetails', '{}'::jsonb) end,
         requirement = nullif(trim(coalesce(p_requirement, '')), ''),
         channel = nullif(trim(coalesce(p_channel, '')), ''),
         notes = nullif(trim(coalesce(p_notes, '')), ''),
         owner_id = coalesce(new_owner.id, owner_id)
   where id = c.id;

  if p_services is not null then
    perform private.save_customer_services(c.id, v_list);
  end if;

  insert into public.customer_activities (customer_id, actor_id, type, note)
  values (c.id, me.id, 'CUSTOMER_UPDATED', format('Details updated by %s%s', me.full_name,
          case when new_owner.id is not null then format('; assigned to %s', new_owner.full_name) else '' end));
  if new_owner.id is not null and new_owner.id <> me.id then
    perform private.notify(new_owner.id, 'CUSTOMER_ASSIGNED', format('Customer assigned: %s', trim(p_name)),
      format('%s (%s) was assigned to you by %s.', trim(p_name), c.customer_code, me.full_name), 'customer', c.id);
  end if;
end $$;

-- from 20261025000100_ticket_hierarchy_escalation.sql
create or replace function public.ticket_sla_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  s public.ticket_sla_settings;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null or not (me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') or private.is_support_staff()) then
    raise exception 'FORBIDDEN: Only Support staff can see the ticket SLA.' using errcode = '42501';
  end if;
  select * into s from public.ticket_sla_settings x
   where (me.role <> 'SUPER_ADMIN' and x.department_id = private.scoped_department(me.id, me.department_id)) or x.department_id is null
   order by x.department_id is null limit 1;
  return jsonb_build_object('rmMinutes', s.rm_response_minutes, 'tlMinutes', s.tl_response_minutes,
    'scope', case when s.department_id is null then 'DEFAULT' else 'DEPARTMENT' end,
    'canEdit', me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD'), 'updatedAt', s.updated_at);
end $$;

-- from 20261025000100_ticket_hierarchy_escalation.sql
create or replace function public.set_ticket_sla(p_rm_minutes integer, p_tl_minutes integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_dept uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null or me.role not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only a Department Head or the Super Admin can change the ticket SLA.' using errcode = '42501';
  end if;
  if p_rm_minutes is null or p_tl_minutes is null or p_rm_minutes not between 5 and 43200 or p_tl_minutes not between 5 and 43200 then
    raise exception 'VALIDATION_ERROR: Each SLA must be between 5 minutes and 30 days.' using errcode = 'P0001';
  end if;
  v_dept := case when me.role = 'DEPARTMENT_HEAD' then private.scoped_department(me.id, me.department_id) end;  -- the Super Admin sets the default
  update public.ticket_sla_settings set rm_response_minutes = p_rm_minutes, tl_response_minutes = p_tl_minutes, updated_by = me.id, updated_at = now()
   where department_id is not distinct from v_dept;
  if not found then
    insert into public.ticket_sla_settings (department_id, rm_response_minutes, tl_response_minutes, updated_by)
    values (v_dept, p_rm_minutes, p_tl_minutes, me.id);
  end if;
  perform private.write_audit('TICKET_SLA_CHANGED', 'ticket_sla_settings', null, v_dept, null,
    jsonb_build_object('rm_minutes', p_rm_minutes, 'tl_minutes', p_tl_minutes));
  return public.ticket_sla_settings();
end $$;

-- from 20261101000100_customer_usage_import.sql
create or replace function private.may_update_support_customer(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
      join public.profiles me on me.id = private.my_id() and me.status = 'ACTIVE'
      left join public.customer_onboarding o on o.customer_id = c.id
     where c.id = p_customer
       and c.lifecycle_stage not in ('LEAD', 'POTENTIAL', 'LOST')
       and (me.role = 'SUPER_ADMIN'
            or (me.role = 'DEPARTMENT_HEAD' and c.department_id = private.scoped_department(me.id, me.department_id))
            or c.owner_id = me.id or o.team_member_id = me.id or o.team_lead_id = me.id
            or (me.role = 'TEAM_HEAD' and c.team_id = me.team_id)))
$$;

notify pgrst, 'reload schema';
