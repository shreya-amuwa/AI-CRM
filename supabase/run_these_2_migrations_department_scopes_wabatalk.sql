-- Paste this whole file into the Supabase SQL editor and run it once (safe to run again).
-- 1) shared / combined Department Heads (department_access, active scope)   2) Wabatalk = D Talk's Support department, revenue by department

-- ===== 20261123000100_department_scopes.sql =====
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

-- ===== 20261124000100_wabatalk_support_department.sql =====
-- =============================================================================
-- Wabatalk: the Support department of D Talk.
--
--   D Talk    the SALES department.
--   Wabatalk  the SUPPORT department of D Talk. Its Support is looked after by the SAME Department Head who looks after the Support of
--             Wabastore, Whatsbox and Wabastar (a shared head, see 20261123000100_department_scopes.sql).
--
-- Wabatalk is a department of its own (a row in `departments`, with its own revenue, expenses and picker card) that is LINKED to D Talk:
-- `departments.facet_of` / `facet_division` say "this department is the SUPPORT side of that one". The people, teams, customers and
-- tickets of D Talk stay where they are, because the customer a D Talk salesperson sold is the same customer D Talk's Support looks after,
-- and every access rule of the CRM is written around that one shared department. What changes is everything that is about WHICH
-- DEPARTMENT A THING BELONGS TO FOR THE PURPOSE OF A HEAD AND OF REVENUE:
--
--   * Revenue: an order earned by Support (an add-on, a renewal, a monthly plan, a Support-acquired sale, ...) is recorded in Wabatalk;
--     an order earned by Sales is recorded in D Talk. Income reports, the Accounts department income, the Super Admin dashboard and the
--     business reports all read that one recorded department, so they agree.
--   * Heads: a Department Head given Wabatalk (Super Admin > Departments & functions) works D Talk's Support side. The database turns
--     Wabatalk into "D Talk, Support" for every access rule; nothing is duplicated and nothing is moved.
--
-- Nothing else is renamed, created or moved. Safe to run again. The link is made only when a department with the slug `dtalk` exists.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. A department can be the Sales or Support side of another one
-- ---------------------------------------------------------------------------
alter table public.departments
  add column if not exists facet_of uuid references public.departments (id) on delete cascade,
  add column if not exists facet_division text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'departments_facet_check' and conrelid = 'public.departments'::regclass) then
    alter table public.departments add constraint departments_facet_check
      check ((facet_of is null) = (facet_division is null) and facet_of is distinct from id and (facet_division is null or facet_division in ('SALES', 'SUPPORT')));
  end if;
end $$;
create unique index if not exists departments_facet_unique on public.departments (facet_of, facet_division) where facet_of is not null;

-- one level only: a side cannot have sides of its own, and a department that has sides cannot become one
create or replace function private.tg_departments_facet()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.facet_of is not null then
    if exists (select 1 from public.departments b where b.id = new.facet_of and b.facet_of is not null) then
      raise exception 'VALIDATION_ERROR: A department that is itself the Sales or Support side of another cannot have sides.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.departments f where f.facet_of = new.id) then
      raise exception 'VALIDATION_ERROR: This department already has a Sales or Support side of its own.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists departments_facet on public.departments;
create trigger departments_facet before insert or update of facet_of, facet_division on public.departments
  for each row execute function private.tg_departments_facet();

-- ---------------------------------------------------------------------------
-- 2. Wabatalk, linked to D Talk's Support side
-- ---------------------------------------------------------------------------
do $$
declare
  v_base uuid;
  v_f uuid;
begin
  select id into v_base from public.departments where slug = 'dtalk';
  if v_base is null then
    raise notice 'No department with the slug dtalk: Wabatalk was not created or linked.';
    return;
  end if;
  select id into v_f from public.departments where slug = 'wabatalk' or lower(name) in ('wabatalk', 'waba talk') order by (slug = 'wabatalk') desc limit 1;
  if v_f is null then
    insert into public.departments (slug, name, description, icon_name, accent_color, generates_revenue)
    values ('wabatalk', 'Wabatalk', 'Support department of D Talk', 'Headset', '#7C3AED', true)
    returning id into v_f;
  end if;
  -- an existing Wabatalk department is linked, never renamed
  update public.departments set facet_of = v_base, facet_division = 'SUPPORT' where id = v_f and facet_of is null and not exists (select 1 from public.departments x where x.facet_of = v_base and x.facet_division = 'SUPPORT');
end $$;

-- The department that carries one function of another: the Support side of D Talk is Wabatalk; the Sales side is D Talk itself.
create or replace function private.shown_department(p_base uuid, p_division text)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce((select f.id from public.departments f where f.facet_of = p_base and f.facet_division = p_division), p_base)
$$;
revoke all on function private.shown_department(uuid, text) from public, anon;
grant execute on function private.shown_department(uuid, text) to authenticated, service_role;

-- The department an order of `p_division` belongs to, given the department of the customer (the department of the people who look
-- after it): Support's orders belong to the Support department (Wabatalk), Sales' to the Sales department (D Talk). A department
-- without sides is unchanged, so every other department behaves exactly as before.
create or replace function private.revenue_department(p_dept uuid, p_division text)
returns uuid language sql stable security definer set search_path = '' as $$
  select case
    when p_dept is null then null
    when p_division = 'SUPPORT' then private.shown_department(p_dept, 'SUPPORT')
    when p_division = 'SALES' then coalesce((select f.facet_of from public.departments f where f.id = p_dept and f.facet_division = 'SUPPORT'), p_dept)
    else p_dept
  end
$$;
revoke all on function private.revenue_department(uuid, text) from public, anon;
grant execute on function private.revenue_department(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. A Department Head given Wabatalk works D Talk's Support side
--    (grants and the header name Wabatalk; every access rule sees "D Talk, Support")
-- ---------------------------------------------------------------------------
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
           where a.profile_id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD') r
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
           where a.profile_id = p_profile and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD') r
    join public.departments d on d.id = r.department_id
$$;
revoke all on function private.scopes_of(uuid) from public, anon;
grant execute on function private.scopes_of(uuid) to authenticated, service_role;

-- What the request header asks for, as (data department, function): a side department (Wabatalk) means "its base department, that function".
create or replace function private.requested_scope()
returns table (department_id uuid, division text, is_facet boolean)
language sql stable security definer set search_path = '' as $$
  select coalesce(d.facet_of, d.id), coalesce(d.facet_division, upper(private.request_header('x-active-division'))), d.facet_of is not null
    from public.departments d
   where d.id::text = lower(private.request_header('x-active-department'))
$$;
revoke all on function private.requested_scope() from public, anon;
grant execute on function private.requested_scope() to authenticated, service_role;

create or replace function private.active_department_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select s.department_id from private.my_scopes() s join private.requested_scope() r on r.department_id = s.department_id
      where not r.is_facet or s.division is null or s.division = r.division limit 1),
    (select p.department_id from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE'))
$$;
revoke all on function private.active_department_id() from public, anon;
grant execute on function private.active_department_id() to authenticated, service_role;

create or replace function private.active_head_division()
returns text language sql stable security definer set search_path = '' as $$
  with me as (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD'),
       act as (select private.active_department_id() as d),
       mine as (select s.division from private.my_scopes() s, act where s.department_id = act.d),
       req as (select coalesce((select r.division from private.requested_scope() r, act where r.department_id = act.d and r.is_facet),
                               upper(private.request_header('x-active-division'))) as d)
  select case
    when not exists (select 1 from me) then null
    when (select d from req) in (select division from mine where division is not null) then (select d from req)
    when not exists (select 1 from mine where division is null) and (select count(distinct division) from mine) = 1 then (select division from mine limit 1)
    else null
  end
$$;
revoke all on function private.active_head_division() from public, anon;
grant execute on function private.active_head_division() to authenticated, service_role;

-- What the dashboard offers: one entry per department the head can work in, Wabatalk shown as its own department.
-- `dataDepartmentId` / `dataSlug` are the department whose people and customers the entry works on (D Talk for Wabatalk).
create or replace function public.my_department_scopes()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_home uuid;
  v_home_div text;
  v_home_shown uuid;
  v jsonb;
  v_act uuid := private.active_department_id();
begin
  select p.department_id, p.head_division into v_home, v_home_div from public.profiles p
   where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD';
  if v_home is null then
    return jsonb_build_object('departments', '[]'::jsonb, 'homeDepartmentId', null, 'activeDepartmentId', null, 'activeDivision', null);
  end if;
  v_home_shown := private.shown_department(v_home, v_home_div);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'slug', d.slug, 'name', d.name, 'iconName', d.icon_name, 'accentColor', d.accent_color,
           'isHome', d.id = v_home_shown,
           'dataDepartmentId', g.base, 'dataSlug', b.slug,
           'divisions', coalesce(to_jsonb(g.divs), '[]'::jsonb),
           'wholeDepartment', g.whole
         ) order by (d.id = v_home_shown) desc, d.name), '[]'::jsonb)
    into v
    from (select x.shown, min(x.base::text)::uuid as base,
                 array_agg(distinct x.division order by x.division) filter (where x.division is not null) as divs,
                 coalesce(bool_or(x.division is null), false) as whole
            from (select s.department_id as base, s.division, private.shown_department(s.department_id, s.division) as shown from private.my_scopes() s) x
           group by x.shown) g
    join public.departments d on d.id = g.shown
    join public.departments b on b.id = g.base;
  return jsonb_build_object('departments', v, 'homeDepartmentId', v_home_shown,
                            'activeDepartmentId', private.shown_department(v_act, private.active_head_division()),
                            'activeDivision', private.active_head_division());
end $$;
revoke all on function public.my_department_scopes() from public, anon;
grant execute on function public.my_department_scopes() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The Super Admin's list of (department, function) pairs knows about the sides
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
    'profileId', t.id, 'name', t.full_name, 'role', t.role, 'homeDepartmentId', private.shown_department(t.department_id, t.head_division), 'headDivision', t.head_division,
    'grants', (select coalesce(jsonb_agg(jsonb_build_object('departmentId', a.department_id, 'division', a.division) order by a.created_at), '[]'::jsonb)
                 from public.department_access a where a.profile_id = t.id),
    'departments', (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', d.id, 'slug', d.slug, 'name', d.name,
                      'hasSales', exists (select 1 from public.teams x where x.department_id = coalesce(d.facet_of, d.id) and x.division = 'SALES')
                                  and coalesce(d.facet_division, 'SALES') = 'SALES'
                                  and not exists (select 1 from public.departments f where f.facet_of = d.id and f.facet_division = 'SALES'),
                      'hasSupport', exists (select 1 from public.teams x where x.department_id = coalesce(d.facet_of, d.id) and x.division = 'SUPPORT')
                                    and coalesce(d.facet_division, 'SUPPORT') = 'SUPPORT'
                                    and not exists (select 1 from public.departments f where f.facet_of = d.id and f.facet_division = 'SUPPORT'),
                      'supportDepartment', (select f.name from public.departments f where f.facet_of = d.id and f.facet_division = 'SUPPORT'),
                      'salesDepartment', (select f.name from public.departments f where f.facet_of = d.id and f.facet_division = 'SALES')) order by d.name), '[]'::jsonb)
                      from public.departments d));
end $$;
revoke all on function public.department_access_get(uuid) from public, anon;
grant execute on function public.department_access_get(uuid) to authenticated;

create or replace function public.department_access_set(p_profile uuid, p_department uuid, p_division text, p_granted boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  d public.departments;
  v_side public.departments;
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
    if d.facet_of is not null and d.facet_division <> p_division then
      raise exception 'VALIDATION_ERROR: % is the % department, so only % can be given.', d.name, initcap(d.facet_division), initcap(d.facet_division) using errcode = 'P0001';
    end if;
    select * into v_side from public.departments f where f.facet_of = d.id and f.facet_division = p_division;
    if v_side.id is not null then
      raise exception 'VALIDATION_ERROR: The % side of % is the % department. Give % instead.', initcap(p_division), d.name, v_side.name, v_side.name using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.teams x where x.department_id = coalesce(d.facet_of, d.id) and x.division::text = p_division) then
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
-- 5. A head sees the income of the department of THEIR function (Support head: Wabatalk; Sales head: D Talk)
-- ---------------------------------------------------------------------------
create or replace function private.income_scope(p_department uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_base uuid;
  v_rev uuid;
begin
  if private.is_super_admin() or private.is_accounts_staff() then
    return p_department;
  end if;
  if private.my_role() = 'DEPARTMENT_HEAD' and private.my_department_id() is not null then
    v_base := private.my_department_id();
    v_rev := private.revenue_department(v_base, private.active_head_division());
    if p_department is not null and p_department not in (v_base, v_rev) then
      raise exception 'FORBIDDEN: A Department Head can see only their own department''s income.' using errcode = '42501';
    end if;
    return v_rev;
  end if;
  raise exception 'FORBIDDEN: Only the Super Admin, Accounts and Department Heads can see department income.' using errcode = '42501';
end $$;
revoke all on function private.income_scope(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The registration page offers real departments only (not a Support side such as Wabatalk, which has no teams of its own)
-- ---------------------------------------------------------------------------
create or replace function public.list_registration_options()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'slug', d.slug, 'name', d.name,
           'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'division', t.division)
                                               order by t.division, t.name)
                              from public.teams t where t.department_id = d.id), '[]'::jsonb))
         order by d.name), '[]'::jsonb)
  from public.departments d
  where not d.is_locked and d.facet_of is null
$$;
revoke all on function public.list_registration_options() from public;
grant execute on function public.list_registration_options() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Revenue: each order belongs to the department of the division that earns it
-- ---------------------------------------------------------------------------

-- from 20261114000100_revenue_attribution.sql: an order is recorded in the department of the division that earns it
create or replace function private.ensure_attribution(p_key text, p_customer uuid, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
  c public.customers;
begin
  if p_customer is null or exists (select 1 from public.revenue_attributions where order_key = p_key) then
    return;
  end if;
  select * into c from public.customers where id = p_customer;
  if c.id is null then return; end if;
  select * into r from private.attribution_rule(p_customer, p_kind);
  insert into public.revenue_attributions (order_key, customer_id, division, department_id, source, acquisition_division, referral_source)
  values (p_key, p_customer, r.o_division, private.revenue_department(c.department_id, r.o_division), r.o_source, c.acquisition_division, nullif(left(btrim(coalesce(c.lead_source, '')), 60), ''))
  on conflict (order_key) do nothing;
end $$;
revoke all on function private.ensure_attribution(text, uuid, text) from public, anon, authenticated;

-- from 20261114000100_revenue_attribution.sql: the department follows the division when the rule moves a Client Dashboard purchase
create or replace function private.tg_attr_client_addon()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if new.addon_request_id is null or new.addon_request_id is not distinct from old.addon_request_id then
    return null;
  end if;
  select * into r from private.attribution_rule(new.customer_id, 'CLIENT_PURCHASE');
  update public.revenue_attributions
     set division = r.o_division, department_id = private.revenue_department(department_id, r.o_division), source = 'CLIENT_DASHBOARD', updated_at = now()
   where order_key = 'ADDON:' || new.addon_request_id::text and source = 'SUPPORT_ADDON'
     and not exists (select 1 from public.addon_payments p where p.request_id = new.addon_request_id)
     and not exists (select 1 from public.generated_invoices g where g.addon_request_id = new.addon_request_id and exists
                       (select 1 from public.invoice_payments ip where ip.invoice_id = g.invoice_id));
  return null;
end $$;
revoke all on function private.tg_attr_client_addon() from public, anon, authenticated;

-- from 20261114000100_revenue_attribution.sql: the department of a payment / order follows the division that earns it
create or replace function private.verified_income_attributed()
returns table (id uuid, customer_id uuid, amount numeric, paid_at timestamptz, payment_type text, method text, reference text,
               verified_by uuid, recorded_at timestamptz, department_id uuid)
language sql stable security definer set search_path = '' as $$
  select p.id, p.customer_id, p.amount, p.paid_at, p.payment_type, p.method, p.reference, p.verified_by, p.recorded_at,
         coalesce(a.department_id, private.revenue_department(c.department_id, 'SALES'))
    from public.customer_payments p
    join public.customers c on c.id = p.customer_id
    left join public.revenue_attributions a on a.order_key = 'SALE:' || p.customer_id::text
   where p.status = 'VERIFIED'
  union all
  select ap.id, ap.customer_id, ap.amount, ap.paid_at, 'ADDON', ap.method, ap.reference, ap.verified_by, ap.recorded_at,
         coalesce(a.department_id, private.revenue_department(c.department_id, 'SUPPORT'))
    from public.addon_payments ap
    join public.customers c on c.id = ap.customer_id
    left join public.revenue_attributions a on a.order_key = 'ADDON:' || ap.request_id::text
   where ap.status = 'VERIFIED'
  union all
  select ip.id, ip.customer_id, ip.amount, (ip.paid_on::text || ' 12:00:00+05:30')::timestamptz, ip.payment_type, ip.method, ip.reference,
         ip.recorded_by, ip.recorded_at, coalesce(a.department_id, private.revenue_department(c.department_id, 'SALES'))
    from public.invoice_payments ip
    join public.customers c on c.id = ip.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || ip.invoice_id::text
   where ip.status = 'VERIFIED'
$$;
revoke all on function private.verified_income_attributed() from public, anon, authenticated;

create or replace function private.business_ledger()
returns table (tx_key text, source text, source_id uuid, customer_id uuid, department_id uuid, division text, tx_type text,
               amount numeric, status text, occurred_at timestamptz, employee_id uuid, service text, reference text, method text,
               order_key text)
language sql stable security definer set search_path = '' as $$
  -- initial sale: the payments of the agreed services
  select 'CP:' || p.id::text, 'CUSTOMER_PAYMENT', p.id, p.customer_id, coalesce(a.department_id, private.revenue_department(c.department_id, 'SALES')), coalesce(a.division, 'SALES'), 'INITIAL_SALE'::text, p.amount,
         case p.status when 'VERIFIED' then 'COLLECTED' when 'PENDING' then 'PENDING' when 'REVERSED' then 'REFUNDED' else 'REJECTED' end,
         p.paid_at,
         coalesce(pr.requested_by, case when p.source = 'SALES' then p.recorded_by end, fr.requested_by),
         null::text, p.reference, p.method, 'SALE:' || p.customer_id::text
    from public.customer_payments p
    join public.customers c on c.id = p.customer_id
    left join public.revenue_attributions a on a.order_key = 'SALE:' || p.customer_id::text
    left join public.payment_requests pr on pr.id = p.request_id
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = p.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
  union all
  -- add-on purchases
  select 'AP:' || ap.id::text, 'ADDON_PAYMENT', ap.id, ap.customer_id, coalesce(a.department_id, private.revenue_department(c.department_id, 'SUPPORT')), coalesce(a.division, 'SUPPORT'), 'ADDON', ap.amount,
         case ap.status when 'VERIFIED' then 'COLLECTED' when 'PENDING' then 'PENDING' else 'REJECTED' end,
         ap.paid_at, coalesce(r.submitted_by, r.created_by, r.consultant_id),
         (select string_agg(i.name, ', ' order by i.sort_order) from public.addon_request_items i where i.request_id = r.id),
         ap.reference, ap.method, 'ADDON:' || r.id::text
    from public.addon_payments ap
    join public.addon_requests r on r.id = ap.request_id
    join public.customers c on c.id = ap.customer_id
    left join public.revenue_attributions a on a.order_key = 'ADDON:' || r.id::text
  union all
  -- payments recorded on the invoice itself
  select 'IP:' || ip.id::text, 'INVOICE_PAYMENT', ip.id, ip.customer_id, coalesce(a.department_id, private.revenue_department(c.department_id, (case when g.purpose = 'SERVICES' then 'SALES' else 'SUPPORT' end))),
         case when g.purpose = 'SERVICES' then coalesce(a.division, 'SALES') when g.purpose = 'ADDON' or t.kind in ('ADDON', 'RENEWAL') then coalesce(a.division, 'SUPPORT') end,
         case when g.purpose = 'SERVICES' then 'INITIAL_SALE' when g.purpose = 'ADDON' or t.kind = 'ADDON' then 'ADDON'
              when t.kind = 'RENEWAL' then 'RENEWAL' else 'UNCLASSIFIED' end,
         ip.amount, case ip.status when 'VERIFIED' then 'COLLECTED' else 'REFUNDED' end,
         (ip.paid_on::text || ' 12:00:00+05:30')::timestamptz,
         case when g.purpose = 'SERVICES' then fr.requested_by when g.purpose = 'ADDITIONAL' then t.responsible_id end,
         (select s.name from public.crm_services s where s.code = t.service_code), ip.reference, ip.method, 'INV:' || ip.invoice_id::text
    from public.invoice_payments ip
    join public.generated_invoices g on g.invoice_id = ip.invoice_id
    join public.customers c on c.id = ip.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || ip.invoice_id::text
    left join public.invoice_business_tags t on t.invoice_id = ip.invoice_id
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = ip.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
  union all
  -- a monthly plan Accounts activated as paid
  select 'PL:' || cp.id::text, 'PLAN_ACTIVATION', cp.id, cp.customer_id, coalesce(a.department_id, private.revenue_department(c.department_id, 'SUPPORT')), coalesce(a.division, 'SUPPORT'), 'SUBSCRIPTION', cp.price_at_start,
         'COLLECTED', cp.started_at::timestamp at time zone 'Asia/Kolkata', null::uuid,
         (select p.name from public.monthly_plans p where p.id = cp.plan_id), null::text, null::text, 'PLAN:' || cp.id::text
    from public.customer_plans cp
    join public.customers c on c.id = cp.customer_id
    left join public.revenue_attributions a on a.order_key = 'PLAN:' || cp.id::text
   where cp.payment_status = 'PAID' and cp.price_at_start > 0
$$;
revoke all on function private.business_ledger() from public, anon, authenticated;

create or replace function private.business_orders()
returns table (order_key text, division text, order_type text, customer_id uuid, department_id uuid, employee_id uuid,
               billed numeric, billed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  -- the services agreed with the customer
  select 'SALE:' || c.id::text, coalesce(a.division, 'SALES'), 'INITIAL_SALE'::text, c.id, coalesce(a.department_id, private.revenue_department(c.department_id, 'SALES')), fr.requested_by, c.deal_amount,
         coalesce(fr.resolved_at, fr.requested_at, (select min(p.recorded_at) from public.customer_payments p where p.customer_id = c.id), c.created_at)
    from public.customers c
    left join public.revenue_attributions a on a.order_key = 'SALE:' || c.id::text
    left join lateral (select x.requested_by, x.resolved_at, x.requested_at from public.payment_requests x
                        where x.customer_id = c.id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
   where coalesce(c.deal_amount, 0) > 0
     and (fr.requested_by is not null or exists (select 1 from public.payment_requests x where x.customer_id = c.id and x.status <> 'RETURNED')
          or exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status <> 'REJECTED'))
  union all
  -- a services invoice whose payments are recorded on the invoice (the customer has no agreed amount)
  select 'INV:' || g.invoice_id::text, coalesce(a.division, 'SALES'), 'INITIAL_SALE', g.customer_id, coalesce(a.department_id, private.revenue_department(c.department_id, 'SALES')), fr.requested_by, g.total_amount,
         g.invoice_date::timestamp at time zone 'Asia/Kolkata'
    from public.generated_invoices g
    join public.customers c on c.id = g.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || g.invoice_id::text
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = g.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
   where g.purpose = 'SERVICES' and g.payment_ledger = 'INVOICE'
  union all
  -- approved add-ons that were invoiced
  select 'ADDON:' || r.id::text, coalesce(a.division, 'SUPPORT'), 'ADDON', r.customer_id, coalesce(a.department_id, private.revenue_department(c.department_id, 'SUPPORT')), coalesce(r.submitted_by, r.created_by, r.consultant_id), r.total,
         coalesce((select g.invoice_date::timestamp at time zone 'Asia/Kolkata' from public.generated_invoices g where g.addon_request_id = r.id limit 1),
                  r.decided_at, r.submitted_at, r.created_at)
    from public.addon_requests r
    join public.customers c on c.id = r.customer_id
    left join public.revenue_attributions a on a.order_key = 'ADDON:' || r.id::text
   where r.status in ('INVOICE_GENERATED', 'PAYMENT_CONFIRMED', 'IN_PROGRESS', 'COMPLETED') and r.total > 0
  union all
  -- additional invoices Accounts tagged as renewal / add-on
  select 'INV:' || g.invoice_id::text, coalesce(a.division, 'SUPPORT'), case t.kind when 'RENEWAL' then 'RENEWAL' else 'ADDON' end, g.customer_id, coalesce(a.department_id, private.revenue_department(c.department_id, 'SUPPORT')),
         t.responsible_id, g.total_amount, g.invoice_date::timestamp at time zone 'Asia/Kolkata'
    from public.generated_invoices g
    join public.invoice_business_tags t on t.invoice_id = g.invoice_id and t.kind in ('RENEWAL', 'ADDON')
    join public.customers c on c.id = g.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || g.invoice_id::text
   where g.purpose = 'ADDITIONAL'
$$;
revoke all on function private.business_orders() from public, anon, authenticated;

-- from 20261114000100_revenue_attribution.sql: a corrected order lands in the department of the division that earns it
create or replace function public.set_order_attribution(p_order_key text, p_division text, p_department uuid default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_customer uuid;
  v_dept uuid;
  old public.revenue_attributions;
  c public.customers;
begin
  if not (private.is_super_admin() or private.is_accounts_staff()) then
    raise exception 'FORBIDDEN: Only the Super Admin and Accounts can change attribution.' using errcode = '42501';
  end if;
  if p_division not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'VALIDATION_ERROR: Say why the attribution is being changed.' using errcode = 'P0001';
  end if;
  select x.customer_id into v_customer from (select order_key, customer_id from private.business_orders() union all select order_key, customer_id from private.business_ledger()) x
   where x.order_key = p_order_key limit 1;
  if v_customer is null then
    raise exception 'NOT_FOUND: Order not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = v_customer;
  select * into old from public.revenue_attributions where order_key = p_order_key;
  v_dept := private.revenue_department(coalesce(p_department, old.department_id, c.department_id), p_division);
  if not exists (select 1 from public.departments where id = v_dept and generates_revenue) then
    raise exception 'VALIDATION_ERROR: Choose a department that earns revenue.' using errcode = 'P0001';
  end if;
  insert into public.revenue_attributions (order_key, customer_id, division, department_id, source, acquisition_division, referral_source, needs_review, reason, updated_by)
  values (p_order_key, v_customer, p_division, v_dept, 'MANUAL', c.acquisition_division, nullif(left(btrim(coalesce(c.lead_source, '')), 60), ''), false, v_reason, auth.uid())
  on conflict (order_key) do update
     set division = excluded.division, department_id = excluded.department_id, source = 'MANUAL', needs_review = false, review_note = null,
         reason = excluded.reason, updated_at = now(), updated_by = excluded.updated_by;
  perform private.write_audit('ORDER_ATTRIBUTION_CHANGED', 'customer', v_customer, c.department_id, c.team_id,
    jsonb_build_object('order', p_order_key, 'from_division', old.division, 'to_division', p_division, 'from_department', old.department_id,
                       'to_department', v_dept, 'from_source', old.source, 'reason', v_reason));
  return jsonb_build_object('orderKey', p_order_key, 'division', p_division, 'departmentId', v_dept, 'source', 'MANUAL');
end $$;
revoke all on function public.set_order_attribution(text, text, uuid, text) from public, anon;
grant execute on function public.set_order_attribution(text, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Orders that were recorded before Wabatalk existed: Support's belong to Wabatalk now (Sales' stay with D Talk).
--    Only orders of a department that has a Support / Sales side are touched, once; a second run finds nothing to change.
-- ---------------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  update public.revenue_attributions a
     set department_id = private.revenue_department(a.department_id, a.division), updated_at = now()
   where a.department_id is not null
     and a.department_id is distinct from private.revenue_department(a.department_id, a.division);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    raise notice 'Moved the recorded department of % order(s) to the department of the division that earns them.', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
