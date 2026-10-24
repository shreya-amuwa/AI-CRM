-- Run this ONE file once in the Supabase SQL editor (safe to run again), AFTER run_this_department_head_division.sql. It is the migration 20261121000100_sales_department_head.sql.

-- =============================================================================
-- Sales Department Head dashboard (a Department Head whose side is SALES - see 20261120000100_department_head_division.sql).
--
--  1. Who is a Sales head, the dashboard value 'sales-department-head', and the SEPARATION from Support: a Sales head reads, and
--     creates people in, the Sales teams of the department only (customers, tasks, people, tickets, performance, chat).
--     Support heads and every other role are untouched.
--  2. Lead Assign: Excel sheets of leads assigned to a Sales team member (history, duplicate protection, original file reference).
--     A Telecaller gets the sheet through the existing Telecaller sheet workflow; any other eligible member gets the leads in their pipeline.
--  3. Lead List, lead detail, assigning an inbound (unassigned) enquiry.
--  4. Overview, Daily Tasks, Reports (Team Lead / Team Member) and Department Income - all for the Sales teams only.
-- Additive / idempotent. Run the whole file at once.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Sales head: identity, dashboard, separation
-- ---------------------------------------------------------------------------
create or replace function private.is_sales_head()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                  where p.id = private.my_id() and p.role = 'DEPARTMENT_HEAD' and p.status = 'ACTIVE' and p.head_division = 'SALES')
$$;
revoke all on function private.is_sales_head() from public, anon;
grant execute on function private.is_sales_head() to authenticated, service_role;

create or replace function private.require_sales_head()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_sales_head() then
    raise exception 'FORBIDDEN: This page is for the Sales Department Head.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_sales_head() from public, anon;
grant execute on function private.require_sales_head() to authenticated, service_role;

-- True unless the caller is a Sales head looking at a team that is not a Sales team. A row without a team is not Support data.
create or replace function private.sales_scope_team(p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_team is null or not private.is_sales_head()
         or exists (select 1 from public.teams t where t.id = p_team and t.division = 'SALES')
$$;
revoke all on function private.sales_scope_team(uuid) from public, anon;
grant execute on function private.sales_scope_team(uuid) to authenticated, service_role;

-- The dashboard value: a Department Head of the Sales side opens the Sales Department Head dashboard.
create or replace function private.tg_profiles_default_dashboard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_division text;
  v_slug text;
begin
  select division into v_division from public.teams where id = new.team_id;
  select slug into v_slug from public.departments where id = new.department_id;
  if new.sales_sub_role is not null and (new.role is distinct from 'TEAM_MEMBER' or v_division is distinct from 'SALES') then
    new.sales_sub_role := null;
  end if;
  new.default_dashboard := case new.role
    when 'SUPER_ADMIN' then 'super-admin'
    when 'DEPARTMENT_HEAD' then case
      when v_slug = 'hr' then 'hr-head'
      when new.head_division = 'SALES' and v_slug is distinct from 'accounts' then 'sales-department-head'
      else 'department-head' end
    when 'TEAM_HEAD' then case
      when v_slug = 'accounts' then 'accounts-staff'
      when v_division = 'SUPPORT' then 'support-lead'
      when v_division = 'SALES' then 'sales-lead'
      else 'team-lead'
    end
    else case
      when v_slug = 'accounts' then 'accounts-staff'
      when v_division = 'SUPPORT' and coalesce(new.is_technical_consultant, false) then 'technical-consultant'
      when v_division = 'SUPPORT' then 'support-member'
      when v_division = 'SALES' and new.sales_sub_role = 'TELECALLER' then 'telecaller'
      when v_division = 'SALES' and new.sales_sub_role = 'BUSINESS_ASSOCIATE' then 'business-associate'
      when v_division = 'SALES' and new.sales_sub_role is not null then 'sales-' || lower(replace(new.sales_sub_role, '_', '-'))
      when v_division = 'SALES' then 'sales-member'
      else 'team-member'
    end
  end;
  return new;
end $$;
revoke all on function private.tg_profiles_default_dashboard() from public, anon, authenticated;
update public.profiles set updated_at = updated_at where role = 'DEPARTMENT_HEAD';

-- A Sales head reads (and works on) the Sales teams of the department, not the Support teams. Everyone else: unchanged.
drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers for select to authenticated
  using ((( select private.my_role()) = 'SUPER_ADMIN'::public.app_role)
      or ((( select private.my_role()) = 'DEPARTMENT_HEAD'::public.app_role) and department_id = ( select private.my_department_id()) and private.sales_scope_team(team_id))
      or ((( select private.my_role()) = 'TEAM_HEAD'::public.app_role) and team_id = ( select private.my_team_id()))
      or ((( select private.my_role()) = 'TEAM_MEMBER'::public.app_role) and owner_id = ( select private.my_id())));

drop policy if exists work_tasks_select on public.work_tasks;
create policy work_tasks_select on public.work_tasks for select to authenticated
  using (assignee_id = ( select private.my_id()) or assigned_by = ( select private.my_id())
      or (( select private.my_role()) = 'SUPER_ADMIN'::public.app_role)
      or ((( select private.my_role()) = 'DEPARTMENT_HEAD'::public.app_role) and department_id = ( select private.my_department_id()) and private.sales_scope_team(team_id))
      or ((( select private.my_role()) = 'TEAM_HEAD'::public.app_role) and team_id = ( select private.my_team_id())));

create or replace function private.can_view_work_task(p_task uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.work_tasks t
    where t.id = p_task and (
      t.assignee_id = private.my_id() or t.assigned_by = private.my_id()
      or private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD' and t.department_id = private.my_department_id() and private.sales_scope_team(t.team_id))
      or (private.my_role() = 'TEAM_HEAD' and t.team_id = private.my_team_id())))
$$;

create or replace function private.can_view_profile(p_id uuid, p_role public.app_role, p_department_id uuid, p_team_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_id = auth.uid() then true
    when private.my_role() = 'SUPER_ADMIN' then true
    when private.my_role() = 'DEPARTMENT_HEAD' then p_department_id = private.my_department_id() and private.sales_scope_team(p_team_id)
      -- the Support-side head of the same department is not part of the Sales head's people
      and (p_role <> 'DEPARTMENT_HEAD' or not private.is_sales_head()
           or exists (select 1 from public.profiles h where h.id = p_id and h.head_division = 'SALES'))
    when private.my_role() in ('TEAM_HEAD', 'TEAM_MEMBER') then
      p_team_id = private.my_team_id()
      or (p_role = 'DEPARTMENT_HEAD' and p_department_id = private.my_department_id())
    else false
  end
$$;

drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets for select to authenticated
  using (assignee_id = ( select private.my_id()) or created_by = ( select private.my_id()) or escalated_to = ( select private.my_id())
      or (( select private.my_role()) = 'SUPER_ADMIN'::public.app_role)
      or ((( select private.my_role()) = 'DEPARTMENT_HEAD'::public.app_role) and department_id = ( select private.my_department_id()) and private.sales_scope_team(team_id))
      or ((( select private.my_role()) = 'TEAM_HEAD'::public.app_role) and team_id = ( select private.my_team_id())));

-- Performance reports: a Sales head sees people and teams of the Sales teams, never the whole-department report (it includes Support).
create or replace function private.perf_can_view(p_scope text, p_subject uuid, p_team uuid, p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case private.my_role()
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then p_department is not null and p_department = private.my_department_id()
                                and (p_subject is null or p_subject <> private.my_id())
                                and (not private.is_sales_head() or (p_scope <> 'DEPARTMENT' and private.sales_scope_team(p_team)
                                     and (p_subject is null or exists (select 1 from public.profiles s where s.id = p_subject and private.sales_scope_team(s.team_id)))))
    when 'TEAM_HEAD' then p_scope in ('MEMBER', 'TEAM') and p_team is not null and p_team = private.my_team_id()
                          and (p_subject is null or exists (select 1 from public.profiles s where s.id = p_subject and s.role = 'TEAM_MEMBER'))
    else false
  end
$$;

-- People are created in the Sales teams only: a Sales head cannot create a Support Team Lead or member.
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
    -- the Sales Department Head works with the Sales teams only
    if v_me.role = 'DEPARTMENT_HEAD' and v_me.head_division = 'SALES' and v_team_division is distinct from 'SALES' then
      return false;
    end if;
  end if;

  return case v_me.role
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then p_role in ('TEAM_HEAD', 'TEAM_MEMBER') and p_department_id = v_me.department_id
    when 'TEAM_HEAD' then p_role = 'TEAM_MEMBER' and p_team_id = v_me.team_id
    else false
  end;
end $$;

-- Chat: nobody in a Support team (and no Support-side head of the same department) can be messaged by the Sales head, and the other way round.
create or replace function private.chat_may_message(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_a is not null and p_b is not null and p_a <> p_b
     and (select count(*) from public.profiles p where p.id in (p_a, p_b) and p.status = 'ACTIVE') = 2
     and not exists (
       select 1 from public.profiles h
        join public.profiles o on o.id = case when h.id = p_a then p_b else p_a end
        left join public.teams ot on ot.id = o.team_id
       where h.id in (p_a, p_b) and h.role = 'DEPARTMENT_HEAD' and h.head_division = 'SALES'
         and ((ot.division = 'SUPPORT')
              or (o.role = 'DEPARTMENT_HEAD' and o.department_id = h.department_id and o.head_division is distinct from 'SALES')))
$$;

-- Performance Management lists: a Sales head sees the Sales teams and their people only (and no whole-department card).
create or replace function public.performance_people(p_kind text, p_start date, p_end date, p_department uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.my_role();
  v_dept uuid;
  v_team uuid := private.my_team_id();
  v_today date := private.hr_today();
  v_people jsonb;
  v_teams jsonb := '[]'::jsonb;
  v_dep jsonb;
begin
  perform private.perf_check_period(p_kind, p_start, p_end);
  if v_role = 'SUPER_ADMIN' then
    v_dept := p_department;
    if v_dept is null then raise exception 'VALIDATION_ERROR: Choose a department.' using errcode = 'P0001'; end if;
  elsif v_role = 'DEPARTMENT_HEAD' then
    v_dept := private.my_department_id();
  elsif v_role = 'TEAM_HEAD' then
    v_dept := private.my_department_id();
  else
    raise exception 'FORBIDDEN: Performance reports are for Team Leads and Department Heads.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x order by (x ->> 'teamName'), (x ->> 'role') desc, (x ->> 'name')), '[]'::jsonb) into v_people from (
    select jsonb_build_object('scope', 'MEMBER', 'id', p.id, 'name', p.full_name, 'role', case p.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end,
             'teamId', p.team_id, 'teamName', coalesce(t.name, ''), 'position', p.position,
             'summary', private.perf_metrics('MEMBER', p.id, p.team_id, p.department_id, p_start, p_end, v_today, true),
             'report', (select jsonb_build_object('id', r.id, 'generatedAt', r.generated_at, 'checkedAt', r.checked_at, 'narrativeSource', r.narrative_source, 'aiStatus', r.ai_status)
                          from public.performance_reports r where r.scope = 'MEMBER' and r.subject_id = p.id and r.period_kind = p_kind and r.period_start = p_start and r.period_end = p_end)) as x
      from public.profiles p left join public.teams t on t.id = p.team_id
     where p.status = 'ACTIVE' and p.department_id = v_dept and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and p.id <> private.my_id() and private.sales_scope_team(p.team_id)
       and (v_role <> 'TEAM_HEAD' or (p.role = 'TEAM_MEMBER' and p.team_id = v_team))) q;

  if v_role in ('DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) into v_teams from (
      select jsonb_build_object('scope', 'TEAM', 'id', t.id, 'name', t.name,
               'lead', (select h.full_name from public.profiles h where h.team_id = t.id and h.role = 'TEAM_HEAD' and h.status = 'ACTIVE' order by h.created_at limit 1),
               'members', (select count(*) from public.profiles m where m.team_id = t.id and m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE'),
               'summary', private.perf_metrics('TEAM', null, t.id, t.department_id, p_start, p_end, v_today, true),
               'report', (select jsonb_build_object('id', r.id, 'generatedAt', r.generated_at, 'checkedAt', r.checked_at, 'narrativeSource', r.narrative_source, 'aiStatus', r.ai_status)
                            from public.performance_reports r where r.scope = 'TEAM' and r.team_id = t.id and r.period_kind = p_kind and r.period_start = p_start and r.period_end = p_end)) as x
        from public.teams t where t.department_id = v_dept and private.sales_scope_team(t.id)) q;
    select jsonb_build_object('scope', 'DEPARTMENT', 'id', d.id, 'name', d.name,
             'summary', private.perf_metrics('DEPARTMENT', null, null, d.id, p_start, p_end, v_today, true),
             'report', (select jsonb_build_object('id', r.id, 'generatedAt', r.generated_at, 'checkedAt', r.checked_at, 'narrativeSource', r.narrative_source, 'aiStatus', r.ai_status)
                          from public.performance_reports r where r.scope = 'DEPARTMENT' and r.department_id = d.id and r.period_kind = p_kind and r.period_start = p_start and r.period_end = p_end))
      into v_dep from public.departments d where d.id = v_dept and not private.is_sales_head();   -- the whole-department report includes Support
  elsif v_role = 'TEAM_HEAD' and v_team is not null then
    -- a Team Lead reads their own team's overall report
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_teams from (
      select jsonb_build_object('scope', 'TEAM', 'id', t.id, 'name', t.name, 'lead', null,
               'members', (select count(*) from public.profiles m where m.team_id = t.id and m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE'),
               'summary', private.perf_metrics('TEAM', null, t.id, t.department_id, p_start, p_end, v_today, true),
               'report', (select jsonb_build_object('id', r.id, 'generatedAt', r.generated_at, 'checkedAt', r.checked_at, 'narrativeSource', r.narrative_source, 'aiStatus', r.ai_status)
                            from public.performance_reports r where r.scope = 'TEAM' and r.team_id = t.id and r.period_kind = p_kind and r.period_start = p_start and r.period_end = p_end)) as x
        from public.teams t where t.id = v_team) q;
  end if;
  return jsonb_build_object('period', jsonb_build_object('kind', p_kind, 'start', p_start, 'end', p_end), 'today', v_today,
                            'people', v_people, 'teams', v_teams, 'department', v_dep, 'role', v_role);
end $$;

-- ---------------------------------------------------------------------------
-- 2. Lead Assign: Excel sheets of leads
-- ---------------------------------------------------------------------------
create table if not exists public.sales_lead_sheets (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  assigned_to uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('LEADS', 'TELECALLER')),            -- LEADS: leads in the member's pipeline; TELECALLER: the existing Telecaller contact sheet
  telecaller_list_id uuid references public.telecaller_contact_lists(id) on delete set null,
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  note text check (note is null or length(note) <= 500),
  content_hash text not null,
  total_rows integer not null check (total_rows between 1 and 2000),
  valid_count integer not null check (valid_count >= 1),
  invalid_count integer not null default 0,
  duplicate_count integer not null default 0,
  status text not null default 'ASSIGNED' check (status in ('ASSIGNED')),
  uploaded_at timestamptz not null default now(),
  assigned_at timestamptz not null default now(),
  source_bucket text, source_path text, source_provider text, source_ref text, source_etag text, source_size bigint, source_stored_at timestamptz,
  unique (department_id, content_hash)                                   -- the same file is not imported twice
);
create index if not exists sales_lead_sheets_dept_idx on public.sales_lead_sheets (department_id, uploaded_at desc);
create index if not exists sales_lead_sheets_assignee_idx on public.sales_lead_sheets (assigned_to, uploaded_at desc);
alter table public.customers add column if not exists source_sheet_id uuid references public.sales_lead_sheets(id) on delete set null;
create index if not exists customers_source_sheet_idx on public.customers (source_sheet_id) where source_sheet_id is not null;

alter table public.sales_lead_sheets enable row level security;
drop policy if exists sales_lead_sheets_select on public.sales_lead_sheets;
create policy sales_lead_sheets_select on public.sales_lead_sheets for select to authenticated
  using (assigned_to = (select private.my_id()) or (select private.my_role()) = 'SUPER_ADMIN'
         or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()) and private.is_sales_head()));
revoke all on public.sales_lead_sheets from public, anon, authenticated;
grant select on public.sales_lead_sheets to authenticated;
grant all on public.sales_lead_sheets to service_role;

-- Sales people a lead sheet may be assigned to: Team Members without a Sales role or with Telecaller, and Team Leads - of the Sales teams
-- of the head's department. (Business Associate, Influencer, Visit Sales and Business Partner have their own workflows and no lead sheet.)
create or replace function public.sales_lead_assignees()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_sales_head();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'team', t.name, 'teamId', t.id, 'role', case p.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end,
      'subRole', p.sales_sub_role, 'mode', case when p.sales_sub_role = 'TELECALLER' then 'TELECALLER' else 'LEADS' end,
      'openLeads', (select count(*) from public.customers c where c.owner_id = p.id and c.lifecycle_stage = 'LEAD')) order by p.full_name)
    from public.profiles p join public.teams t on t.id = p.team_id
   where p.status = 'ACTIVE' and p.department_id = private.my_department_id() and t.division = 'SALES'
     and (p.role = 'TEAM_HEAD' or (p.role = 'TEAM_MEMBER' and (p.sales_sub_role is null or p.sales_sub_role = 'TELECALLER')))), '[]'::jsonb);
end $$;
revoke all on function public.sales_lead_assignees() from public, anon;
grant execute on function public.sales_lead_assignees() to authenticated;

-- Check the rows of a sheet and, with p_commit, assign the valid ones. p_rows: [{"row":2,"name","company","phone","email","source","temperature","remarks"}].
-- Rows with a problem, and phone numbers / e-mails already in the CRM or twice in the sheet, are listed and left out - never dropped silently.
create or replace function public.sales_lead_sheet_assign(p_assignee uuid, p_file_name text, p_note text, p_rows jsonb, p_hash text, p_commit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.profiles;
  v_team public.teams;
  v_dept uuid := private.my_department_id();
  r jsonb;
  v_issues jsonb := '[]'::jsonb;
  v_clean jsonb := '[]'::jsonb;
  v_seen_phone text[] := '{}';
  v_seen_email text[] := '{}';
  v_phones text[];
  v_emails text[];
  v_known_phone text[];
  v_known_email text[];
  v_mode text;
  v_row integer; v_name text; v_phone text; v_email text; v_temp text; v_source text;
  v_valid integer := 0; v_invalid integer := 0; v_dup integer := 0;
  v_sheet uuid;
  v_list jsonb;
  v_exists boolean;
begin
  perform private.require_sales_head();
  select * into a from public.profiles where id = p_assignee;
  select * into v_team from public.teams where id = a.team_id;
  if a.id is null or a.status <> 'ACTIVE' or a.department_id is distinct from v_dept or v_team.division is distinct from 'SALES'
     or not (a.role = 'TEAM_HEAD' or (a.role = 'TEAM_MEMBER' and (a.sales_sub_role is null or a.sales_sub_role = 'TELECALLER'))) then
    raise exception 'VALIDATION_ERROR: Choose an active Sales Team Lead or Team Member of your department.' using errcode = 'P0001';
  end if;
  v_mode := case when a.sales_sub_role = 'TELECALLER' then 'TELECALLER' else 'LEADS' end;
  if length(btrim(coalesce(p_file_name, ''))) < 1 or length(p_file_name) > 200 then raise exception 'VALIDATION_ERROR: The file name is missing.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'VALIDATION_ERROR: The sheet has no lead rows.' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'VALIDATION_ERROR: A sheet can have at most 2,000 leads.' using errcode = 'P0001'; end if;
  if length(coalesce(p_hash, '')) < 16 then raise exception 'VALIDATION_ERROR: The sheet could not be identified.' using errcode = 'P0001'; end if;

  -- what the CRM already knows (one query, not one per row)
  select array_agg(distinct regexp_replace(coalesce(x ->> 'phone', ''), '[\s().-]', '', 'g')), array_agg(distinct lower(nullif(btrim(coalesce(x ->> 'email', '')), '')))
    into v_phones, v_emails from jsonb_array_elements(p_rows) x;
  select array_agg(regexp_replace(c.phone, '[\s().-]', '', 'g')) filter (where c.phone is not null),
         array_agg(c.email) filter (where c.email is not null)
    into v_known_phone, v_known_email from public.customers c
   where c.department_id = v_dept
     and (regexp_replace(coalesce(c.phone, ''), '[\s().-]', '', 'g') = any (v_phones) or c.email = any (v_emails));
  v_known_phone := coalesce(v_known_phone, '{}'); v_known_email := coalesce(v_known_email, '{}');

  for r in select * from jsonb_array_elements(p_rows) loop
    v_row := coalesce((r ->> 'row')::int, 0);
    v_name := nullif(btrim(coalesce(r ->> 'name', '')), '');
    v_phone := regexp_replace(coalesce(r ->> 'phone', ''), '[\s().-]', '', 'g');
    v_email := lower(nullif(btrim(coalesce(r ->> 'email', '')), ''));
    v_temp := upper(nullif(btrim(coalesce(r ->> 'temperature', '')), ''));
    v_source := left(nullif(btrim(coalesce(r ->> 'source', '')), ''), 60);
    if v_name is null then v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', 'INVALID', 'message', 'The customer name is missing.'); v_invalid := v_invalid + 1;
    elsif length(v_name) > 200 then v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', 'INVALID', 'message', 'The customer name is too long.'); v_invalid := v_invalid + 1;
    elsif v_phone !~ '^\+?[0-9]{7,15}$' then v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', 'INVALID', 'message', 'The phone number is missing or not valid (7 to 15 digits).'); v_invalid := v_invalid + 1;
    elsif v_email is not null and (v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 254) then v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', 'INVALID', 'message', 'The e-mail address is not valid.'); v_invalid := v_invalid + 1;
    elsif v_temp is not null and v_temp not in ('HOT', 'WARM', 'COLD') then v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', 'INVALID', 'message', 'The lead temperature must be Hot, Warm or Cold.'); v_invalid := v_invalid + 1;
    elsif length(coalesce(r ->> 'company', '')) > 200 or length(coalesce(r ->> 'remarks', '')) > 1000 then v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', 'INVALID', 'message', 'The company or remarks text is too long.'); v_invalid := v_invalid + 1;
    elsif v_phone = any (v_seen_phone) or (v_email is not null and v_email = any (v_seen_email)) then v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', 'DUPLICATE', 'message', 'This phone number or e-mail appears twice in the sheet.'); v_dup := v_dup + 1;
    elsif v_phone = any (v_known_phone) or (v_email is not null and v_email = any (v_known_email)) then v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', 'DUPLICATE', 'message', 'This person is already in the CRM (same phone number or e-mail).'); v_dup := v_dup + 1;
    else
      v_seen_phone := v_seen_phone || v_phone;
      if v_email is not null then v_seen_email := v_seen_email || v_email; end if;
      v_valid := v_valid + 1;
      v_clean := v_clean || jsonb_build_object('row', v_row, 'name', v_name, 'company', nullif(btrim(coalesce(r ->> 'company', '')), ''), 'phone', v_phone, 'email', v_email,
        'source', v_source, 'temperature', v_temp, 'remarks', nullif(btrim(coalesce(r ->> 'remarks', '')), ''));
    end if;
  end loop;

  select exists (select 1 from public.sales_lead_sheets s where s.department_id = v_dept and s.content_hash = p_hash) into v_exists;
  if p_commit and v_exists then raise exception 'CONFLICT: This sheet has already been uploaded and assigned.' using errcode = 'P0001'; end if;
  if p_commit and v_valid = 0 then raise exception 'VALIDATION_ERROR: The sheet has no valid lead to assign. Fix the rows listed and upload it again.' using errcode = 'P0001'; end if;

  if p_commit then
    if v_mode = 'TELECALLER' then
      -- the existing Telecaller workflow: the contacts go to the Telecaller's sheet list, who calls them and turns the interested ones into leads
      v_list := public.telecaller_list_assign(a.id, p_file_name, p_note,
        (select jsonb_agg(jsonb_build_object('row', x ->> 'row', 'name', x ->> 'name', 'company', x ->> 'company', 'phone', x ->> 'phone', 'email', x ->> 'email', 'remarks', x ->> 'remarks')) from jsonb_array_elements(v_clean) x),
        p_hash, true);
      if not coalesce((v_list ->> 'committed')::boolean, false) then raise exception 'VALIDATION_ERROR: The sheet could not be assigned to the Telecaller.' using errcode = 'P0001'; end if;
    end if;
    insert into public.sales_lead_sheets (department_id, uploaded_by, assigned_to, mode, telecaller_list_id, file_name, note, content_hash, total_rows, valid_count, invalid_count, duplicate_count)
    values (v_dept, private.my_id(), a.id, v_mode, case when v_mode = 'TELECALLER' then (v_list ->> 'listId')::uuid end, btrim(p_file_name),
            nullif(btrim(coalesce(p_note, '')), ''), p_hash, jsonb_array_length(p_rows), v_valid, v_invalid, v_dup)
    returning id into v_sheet;
    if v_mode = 'LEADS' then
      with ins as (
        insert into public.customers (owner_id, lifecycle_stage, lead_status, name, company, phone, email, lead_source, lead_temperature, call_status, notes, source_sheet_id)
        select a.id, 'LEAD', 'NEW', x ->> 'name', x ->> 'company', x ->> 'phone', x ->> 'email', coalesce(x ->> 'source', 'Excel sheet'), x ->> 'temperature', 'PENDING', x ->> 'remarks', v_sheet
          from jsonb_array_elements(v_clean) x
        returning id)
      insert into public.customer_activities (customer_id, type, note)
      select id, 'LEAD_CREATED', 'Lead added from the Excel sheet ' || btrim(p_file_name) from ins;
      perform private.notify(a.id, 'LEAD_SHEET_ASSIGNED', format('New leads: %s', btrim(p_file_name)), format('%s lead%s assigned to you.', v_valid, case when v_valid = 1 then '' else 's' end), 'sales_lead_sheet', v_sheet);
    end if;
    perform private.write_audit('SALES_LEAD_SHEET_ASSIGNED', 'sales_lead_sheet', v_sheet, v_dept, a.team_id,
      jsonb_build_object('assignee', a.id, 'mode', v_mode, 'valid', v_valid, 'invalid', v_invalid, 'duplicates', v_dup));
  end if;
  return jsonb_build_object('committed', v_sheet is not null, 'sheetId', v_sheet, 'mode', v_mode, 'alreadyAssigned', v_exists,
    'assignee', jsonb_build_object('id', a.id, 'name', a.full_name, 'role', case a.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end, 'team', v_team.name),
    'issues', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(v_issues) x limit 300) q),
    'summary', jsonb_build_object('rows', jsonb_array_length(p_rows), 'valid', v_valid, 'invalid', v_invalid, 'duplicates', v_dup),
    'preview', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(v_clean) x limit 25) q));
end $$;
revoke all on function public.sales_lead_sheet_assign(uuid, text, text, jsonb, text, boolean) from public, anon;
grant execute on function public.sales_lead_sheet_assign(uuid, text, text, jsonb, text, boolean) to authenticated;

-- The original file of a sheet the head assigned (the API stores it, then records the reference).
create or replace function public.sales_lead_sheet_source_begin(p_sheet uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.sales_lead_sheets;
begin
  perform private.require_sales_head();
  select * into s from public.sales_lead_sheets where id = p_sheet;
  if s.id is null or s.department_id is distinct from private.my_department_id() or s.uploaded_by is distinct from private.my_id() then
    raise exception 'NOT_FOUND: Lead sheet not found.' using errcode = 'P0001';
  end if;
  if s.source_stored_at is not null then raise exception 'CONFLICT: The original file is already stored.' using errcode = 'P0001'; end if;
  return jsonb_build_object('id', s.id, 'fileName', s.file_name, 'departmentId', s.department_id, 'contentHash', s.content_hash);
end $$;
create or replace function public.sales_lead_sheet_record_source(p_sheet uuid, p_bucket text, p_path text, p_provider text, p_ref text, p_etag text, p_size bigint)
returns void language sql security definer set search_path = '' as $$
  update public.sales_lead_sheets set source_bucket = p_bucket, source_path = p_path, source_provider = p_provider, source_ref = p_ref, source_etag = p_etag, source_size = p_size, source_stored_at = now()
   where id = p_sheet and source_stored_at is null
$$;
revoke all on function public.sales_lead_sheet_source_begin(uuid) from public, anon;
grant execute on function public.sales_lead_sheet_source_begin(uuid) to authenticated;
-- recording the stored file is the API's job (service role only), after the begin check passed
revoke all on function public.sales_lead_sheet_record_source(uuid, text, text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.sales_lead_sheet_record_source(uuid, text, text, text, text, text, bigint) to service_role;

-- Previous uploads and where they stand.
create or replace function public.sales_lead_sheets_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_sales_head();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'fileName', s.file_name, 'note', s.note, 'mode', s.mode, 'uploadedAt', s.uploaded_at, 'assignedAt', s.assigned_at,
      'uploadedBy', (select u.full_name from public.profiles u where u.id = s.uploaded_by), 'assigneeId', s.assigned_to,
      'assignedTo', (select t.full_name from public.profiles t where t.id = s.assigned_to),
      'rows', s.total_rows, 'valid', s.valid_count, 'invalid', s.invalid_count, 'duplicates', s.duplicate_count, 'status', s.status,
      'hasSourceFile', s.source_stored_at is not null,
      'leadsNow', case when s.mode = 'LEADS' then (select count(*) from public.customers c where c.source_sheet_id = s.id and c.lifecycle_stage = 'LEAD') end,
      'converted', case when s.mode = 'LEADS' then (select count(*) from public.customers c where c.source_sheet_id = s.id and c.lifecycle_stage <> 'LEAD') end,
      'contactsPending', case when s.mode = 'TELECALLER' then (select count(*) from public.telecaller_contacts c where c.list_id = s.telecaller_list_id and c.call_status = 'PENDING') end,
      'contactsCalled', case when s.mode = 'TELECALLER' then (select count(*) from public.telecaller_contacts c where c.list_id = s.telecaller_list_id and c.call_status <> 'PENDING') end
    ) order by s.uploaded_at desc)
    from public.sales_lead_sheets s where s.department_id = private.my_department_id()), '[]'::jsonb);
end $$;
revoke all on function public.sales_lead_sheets_list() from public, anon;
grant execute on function public.sales_lead_sheets_list() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Lead List, a lead's details, and assigning an inbound enquiry
-- ---------------------------------------------------------------------------
-- The leads of the Sales teams of the head's department: customers in the lead pipeline (and those that moved on from it), plus the inbound
-- enquiries nobody has taken yet ("unassigned").
create or replace function private.sales_leads_base(p_dept uuid)
returns table (
  id text, lead_code text, name text, company text, phone text, email text, source text, temperature text, call_status text,
  owner_id uuid, owner_name text, team_name text, assigned_at timestamptz, last_contacted timestamptz, follow_up timestamptz,
  converted boolean, stage text, kind text, sheet_name text)
language sql stable security definer set search_path = '' as $$
  select c.id::text, c.customer_code, c.name, c.company, c.phone, c.email, c.lead_source, c.lead_temperature, c.call_status,
         c.owner_id, o.full_name, t.name, coalesce(sh.assigned_at, c.created_at),
         (select max(a.created_at) from public.customer_activities a where a.customer_id = c.id and a.type <> 'LEAD_CREATED'),
         c.next_follow_up_at, c.lifecycle_stage <> 'LEAD', c.lifecycle_stage, 'CUSTOMER', sh.file_name
    from public.customers c
    join public.teams t on t.id = c.team_id and t.division = 'SALES'
    left join public.profiles o on o.id = c.owner_id
    left join public.sales_lead_sheets sh on sh.id = c.source_sheet_id
   where c.department_id = p_dept
     and (c.lifecycle_stage = 'LEAD'
          or (c.lifecycle_stage in ('POTENTIAL', 'ONBOARDING', 'CUSTOMER')
              and (c.source_lead_id is not null or c.source_sheet_id is not null
                   or exists (select 1 from public.customer_activities a where a.customer_id = c.id and a.type = 'LEAD_CREATED'))))
  union all
  select l.id, 'INB-' || upper(left(l.id, 6)), l.name, l.company, l.phone, l.email, l.channel, null, null,
         null::uuid, null, null, null::timestamptz, null::timestamptz, null::timestamptz, false, l.stage, 'INBOUND', null
    from public.crm_leads l
   where l.department = (select d.slug from public.departments d where d.id = p_dept) and coalesce(l.sub_department, 'sales') = 'sales'
     and l.assigned_to is null and l.converted_customer_id is null
$$;
revoke all on function private.sales_leads_base(uuid) from public, anon, authenticated;

create or replace function public.sales_leads_list(
  p_search text default null, p_filter text default 'ALL', p_assignee uuid default null, p_sort text default 'assignedAt', p_dir text default 'desc',
  p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.my_department_id();
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_filter text := upper(coalesce(p_filter, 'ALL'));
  v_sort text;
  v_dir text := case when lower(coalesce(p_dir, 'desc')) = 'asc' then 'asc' else 'desc' end;
  v_where text;
  v_out jsonb;
begin
  perform private.require_sales_head();
  if v_filter not in ('ALL', 'HOT', 'WARM', 'COLD', 'UNASSIGNED', 'ASSIGNED', 'FOLLOW_UP', 'CONVERTED') then
    raise exception 'VALIDATION_ERROR: Unknown lead filter.' using errcode = 'P0001';
  end if;
  v_sort := case p_sort when 'name' then 'name' when 'company' then 'company' when 'temperature' then 'temperature' when 'callStatus' then 'call_status'
              when 'lastContacted' then 'last_contacted' when 'followUp' then 'follow_up' when 'assignee' then 'owner_name' else 'assigned_at' end;
  v_where := case v_filter
    when 'HOT' then 'temperature = ''HOT''' when 'WARM' then 'temperature = ''WARM''' when 'COLD' then 'temperature = ''COLD'''
    when 'UNASSIGNED' then 'kind = ''INBOUND''' when 'ASSIGNED' then 'kind = ''CUSTOMER'''
    when 'FOLLOW_UP' then '(not converted and (call_status = ''FOLLOW_UP_REQUIRED'' or (follow_up is not null and follow_up < now() + interval ''1 day'')))'
    when 'CONVERTED' then 'converted' else 'true' end;

  execute format($q$
    with a as (select * from private.sales_leads_base($1)),
    b as (select * from a
                where ($2::text is null or lower(coalesce(name, '') || ' ' || coalesce(company, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(email, '') || ' ' || lead_code) like '%%' || $2 || '%%')
                  and ($3::uuid is null or owner_id = $3)),
    f as (select * from b where %1$s),
    pg as (select * from f order by %2$I %3$s nulls last, name limit $5 offset ($4 - 1) * $5)
    select jsonb_build_object(
      'total', (select count(*) from f), 'page', $4, 'pageSize', $5,
      'counts', jsonb_build_object('all', (select count(*) from a), 'hot', (select count(*) from a where temperature = 'HOT'), 'warm', (select count(*) from a where temperature = 'WARM'),
        'cold', (select count(*) from a where temperature = 'COLD'), 'unassigned', (select count(*) from a where kind = 'INBOUND'), 'assigned', (select count(*) from a where kind = 'CUSTOMER'),
        'followUp', (select count(*) from a where not converted and (call_status = 'FOLLOW_UP_REQUIRED' or (follow_up is not null and follow_up < now() + interval '1 day'))),
        'converted', (select count(*) from a where converted)),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'leadCode', lead_code, 'kind', kind, 'name', name, 'company', company, 'phone', phone, 'email', email,
          'source', source, 'temperature', temperature, 'callStatus', call_status, 'assigneeId', owner_id, 'assignee', owner_name, 'team', team_name,
          'assignedAt', assigned_at, 'lastContacted', last_contacted, 'followUp', follow_up, 'converted', converted, 'stage', stage, 'sheet', sheet_name)
          order by %2$I %3$s nulls last, name) from pg), '[]'::jsonb))
  $q$, v_where, v_sort, v_dir) into v_out using v_dept, v_term, p_assignee, v_page, v_size;
  return v_out;
end $$;
revoke all on function public.sales_leads_list(text, text, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.sales_leads_list(text, text, uuid, text, text, integer, integer) to authenticated;

-- One lead in detail: the contact, who owns it, the latest follow-up and its history.
create or replace function public.sales_lead_get(p_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.my_department_id();
  b record;
begin
  perform private.require_sales_head();
  select * into b from private.sales_leads_base(v_dept) x where x.id = p_id;
  if b.id is null then raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'id', b.id, 'leadCode', b.lead_code, 'kind', b.kind, 'name', b.name, 'company', b.company, 'phone', b.phone, 'email', b.email, 'source', b.source,
    'temperature', b.temperature, 'callStatus', b.call_status, 'assigneeId', b.owner_id, 'assignee', b.owner_name, 'team', b.team_name,
    'assignedAt', b.assigned_at, 'lastContacted', b.last_contacted, 'followUp', b.follow_up, 'converted', b.converted, 'stage', b.stage, 'sheet', b.sheet_name,
    'details', case when b.kind = 'CUSTOMER' then (select jsonb_build_object('leadStatus', c.lead_status, 'city', c.city, 'requirement', c.requirement, 'notes', c.notes, 'expectedBudget', c.expected_budget,
         'services', (select coalesce(jsonb_agg(s.service_code order by s.service_code), '[]'::jsonb) from public.customer_services s where s.customer_id = c.id))
         from public.customers c where c.id = b.id::uuid) else (select jsonb_build_object('notes', l.notes, 'channel', l.channel, 'received', l.created_at) from public.crm_leads l where l.id = b.id) end,
    'history', case when b.kind = 'CUSTOMER' then (select coalesce(jsonb_agg(jsonb_build_object('at', a.created_at, 'type', a.type, 'note', a.note) order by a.created_at desc), '[]'::jsonb)
         from (select * from public.customer_activities x where x.customer_id = b.id::uuid order by x.created_at desc limit 30) a) else '[]'::jsonb end);
end $$;
revoke all on function public.sales_lead_get(text) from public, anon;
grant execute on function public.sales_lead_get(text) to authenticated;

-- Give an inbound enquiry nobody has taken to a Sales Team Lead or Team Member (it becomes a lead in their pipeline).
create or replace function public.sales_inbound_assign(p_lead text, p_assignee uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l public.crm_leads;
  a public.profiles;
  v_team public.teams;
  v_customer uuid;
begin
  perform private.require_sales_head();
  select * into a from public.profiles where id = p_assignee;
  select * into v_team from public.teams where id = a.team_id;
  if a.id is null or a.status <> 'ACTIVE' or a.department_id is distinct from private.my_department_id() or v_team.division is distinct from 'SALES'
     or not (a.role = 'TEAM_HEAD' or (a.role = 'TEAM_MEMBER' and a.sales_sub_role is null)) then
    raise exception 'VALIDATION_ERROR: Choose an active Sales Team Lead or Team Member (without a Sales role) of your department.' using errcode = 'P0001';
  end if;
  select * into l from public.crm_leads where id = p_lead for update;
  if l.id is null or l.department is distinct from (select slug from public.departments where id = private.my_department_id()) or coalesce(l.sub_department, 'sales') <> 'sales' then
    raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001';
  end if;
  if l.converted_customer_id is not null or l.assigned_to is not null then raise exception 'CONFLICT: This lead is already assigned.' using errcode = 'P0001'; end if;
  v_customer := private.customer_from_inbound_lead(l, a.id);
  perform private.notify(a.id, 'LEAD_ASSIGNED', 'New lead assigned', format('%s was assigned to you.', coalesce(l.name, 'A lead')), 'customer', v_customer);
  perform private.write_audit('SALES_INBOUND_LEAD_ASSIGNED', 'customer', v_customer, a.department_id, a.team_id, jsonb_build_object('assignee', a.id, 'inboundLead', l.id));
  return jsonb_build_object('customerId', v_customer, 'assignee', a.full_name);
end $$;
revoke all on function public.sales_inbound_assign(text, uuid) from public, anon;
grant execute on function public.sales_inbound_assign(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Daily Tasks, Overview, Reports, Income (the Sales teams only)
-- ---------------------------------------------------------------------------
-- A Sales head gives work to the Sales teams only: a task about a Support team is refused whoever sends it.
create or replace function private.tg_work_tasks_sales_scope()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.team_id is not null and exists (select 1 from public.profiles h where h.id = new.assigned_by and h.role = 'DEPARTMENT_HEAD' and h.head_division = 'SALES')
     and not exists (select 1 from public.teams t where t.id = new.team_id and t.division = 'SALES') then
    raise exception 'FORBIDDEN: The Sales Department Head can give tasks to the Sales teams only.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_work_tasks_sales_scope() from public, anon, authenticated;
drop trigger if exists work_tasks_sales_scope on public.work_tasks;
create trigger work_tasks_sales_scope before insert on public.work_tasks for each row execute function private.tg_work_tasks_sales_scope();

-- Team Leads of the Sales teams a task can go to.
create or replace function public.sales_task_assignees()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_sales_head();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'team', t.name, 'teamId', t.id, 'role', 'Team Lead') order by p.full_name)
    from public.profiles p join public.teams t on t.id = p.team_id
   where p.status = 'ACTIVE' and p.role = 'TEAM_HEAD' and p.department_id = private.my_department_id() and t.division = 'SALES'), '[]'::jsonb);
end $$;
revoke all on function public.sales_task_assignees() from public, anon;
grant execute on function public.sales_task_assignees() to authenticated;

-- Give a task to a Sales Team Lead (the existing assign_task_to_team_lead, after checking the lead is in a Sales team).
create or replace function public.sales_task_assign(p_assignee uuid, p_title text, p_description text, p_priority text, p_due date)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_sales_head();
  if not exists (select 1 from public.profiles p join public.teams t on t.id = p.team_id
                  where p.id = p_assignee and p.role = 'TEAM_HEAD' and p.status = 'ACTIVE' and p.department_id = private.my_department_id() and t.division = 'SALES') then
    raise exception 'VALIDATION_ERROR: Choose a Team Lead of a Sales team.' using errcode = 'P0001';
  end if;
  return public.assign_task_to_team_lead(p_assignee, p_title, p_description, p_priority, p_due);
end $$;
revoke all on function public.sales_task_assign(uuid, text, text, text, date) from public, anon;
grant execute on function public.sales_task_assign(uuid, text, text, text, date) to authenticated;

-- The tasks of the Sales teams (a Team Lead's task and the member tasks under it are each listed).
create or replace function public.sales_tasks_list(
  p_filter text default 'ALL', p_search text default null, p_assignee uuid default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.my_department_id();
  v_today date := private.hr_today();
  v_filter text := upper(coalesce(p_filter, 'ALL'));
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_out jsonb;
begin
  perform private.require_sales_head();
  if v_filter not in ('ALL', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE') then
    raise exception 'VALIDATION_ERROR: Unknown task filter.' using errcode = 'P0001';
  end if;
  with t as (
    select w.id, w.title, w.description, w.priority, w.due_date, w.status, w.progress, w.last_update_note, w.last_update_at, w.created_at, w.parent_id,
           w.assignee_id, a.full_name assignee_name, w.assigned_by, b.full_name by_name, tm.name team_name,
           (w.due_date is not null and w.status <> 'COMPLETED' and w.due_date < v_today) overdue,
           (select count(*) from public.work_tasks c where c.parent_id = w.id) subtasks
      from public.work_tasks w
      join public.teams tm on tm.id = w.team_id and tm.division = 'SALES'
      join public.profiles a on a.id = w.assignee_id
      join public.profiles b on b.id = w.assigned_by
     where w.department_id = v_dept
       and (v_term is null or lower(w.title || ' ' || coalesce(w.description, '') || ' ' || a.full_name) like '%' || v_term || '%')
       and (p_assignee is null or w.assignee_id = p_assignee)),
  f as (select * from t where case v_filter when 'PENDING' then status = 'ASSIGNED' when 'IN_PROGRESS' then status = 'IN_PROGRESS' when 'COMPLETED' then status = 'COMPLETED'
                                    when 'OVERDUE' then overdue else true end),
  pg as (select * from f order by overdue desc, (status = 'COMPLETED'), due_date nulls last, created_at desc limit v_size offset (v_page - 1) * v_size)
  select jsonb_build_object('total', (select count(*) from f), 'page', v_page, 'pageSize', v_size, 'today', v_today,
    'counts', jsonb_build_object('all', (select count(*) from t), 'pending', (select count(*) from t where status = 'ASSIGNED'), 'inProgress', (select count(*) from t where status = 'IN_PROGRESS'),
       'completed', (select count(*) from t where status = 'COMPLETED'), 'overdue', (select count(*) from t where overdue)),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'description', description, 'priority', priority, 'startDate', created_at, 'dueDate', due_date,
        'status', status, 'progress', progress, 'remarks', last_update_note, 'lastUpdateAt', last_update_at, 'assigneeId', assignee_id, 'assignee', assignee_name,
        'assignedById', assigned_by, 'assignedBy', by_name, 'team', team_name, 'overdue', overdue, 'dueSoon', (due_date is not null and status <> 'COMPLETED' and due_date >= v_today and due_date <= v_today + 2),
        'level', case when parent_id is null then 'LEAD' else 'MEMBER' end, 'subtasks', subtasks)
        order by overdue desc, (status = 'COMPLETED'), due_date nulls last, created_at desc) from pg), '[]'::jsonb))
    into v_out;
  return v_out;
end $$;
revoke all on function public.sales_tasks_list(text, text, uuid, integer, integer) from public, anon;
grant execute on function public.sales_tasks_list(text, text, uuid, integer, integer) to authenticated;

-- Overview: the whole Sales department at a glance. Every figure is counted from the Sales teams' own records.
create or replace function public.sales_head_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.my_department_id();
  v_today date := private.hr_today();
  v_eod timestamptz := (private.hr_today() + 1)::timestamp at time zone 'Asia/Kolkata';
  v_out jsonb;
  v_income jsonb;
begin
  perform private.require_sales_head();
  begin
    v_income := (public.department_income_report(v_dept, null, null) -> 'byDivision' -> 'sales');
  exception when others then v_income := null;
  end;
  with b as (select * from private.sales_leads_base(v_dept)),
  staff as (select p.id, p.full_name, p.role, p.sales_sub_role, t.name team_name from public.profiles p join public.teams t on t.id = p.team_id
             where p.department_id = v_dept and t.division = 'SALES' and p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'TEAM_MEMBER')),
  tk as (select w.*, tm.name team_name from public.work_tasks w join public.teams tm on tm.id = w.team_id and tm.division = 'SALES'
          where w.department_id = v_dept and not exists (select 1 from public.work_tasks c where c.parent_id = w.id)),
  fu as (select 1 from b where not converted and follow_up is not null and follow_up < v_eod),
  tcfu as (select 1 from public.telecaller_contacts c where c.department_id = v_dept and c.call_status = 'FOLLOW_UP_REQUIRED' and c.follow_up_date is not null and c.follow_up_date <= v_today)
  select jsonb_build_object(
    'cards', jsonb_build_object(
      'totalLeads', (select count(*) from b), 'hot', (select count(*) from b where temperature = 'HOT'), 'warm', (select count(*) from b where temperature = 'WARM'),
      'cold', (select count(*) from b where temperature = 'COLD'), 'assigned', (select count(*) from b where kind = 'CUSTOMER'), 'pendingAssignment', (select count(*) from b where kind = 'INBOUND'),
      'teamMembers', (select count(*) from staff), 'tasksPending', (select count(*) from tk where status <> 'COMPLETED'), 'tasksCompleted', (select count(*) from tk where status = 'COMPLETED'),
      'followUpsDue', (select count(*) from fu) + (select count(*) from tcfu), 'converted', (select count(*) from b where converted),
      'income', case when v_income is null then null else (v_income ->> 'collected')::numeric end),
    'statusDistribution', jsonb_build_object(
      'temperature', jsonb_build_object('HOT', (select count(*) from b where temperature = 'HOT'), 'WARM', (select count(*) from b where temperature = 'WARM'), 'COLD', (select count(*) from b where temperature = 'COLD'),
                                        'NONE', (select count(*) from b where temperature is null)),
      'callStatus', coalesce((select jsonb_object_agg(coalesce(call_status, 'NONE'), n) from (select call_status, count(*) n from b group by 1) q), '{}'::jsonb)),
    'recentActivities', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('at', a.occurred_at, 'type', a.type, 'note', a.note, 'customer', c.name, 'customerId', c.id, 'by', (select p.full_name from public.profiles p where p.id = a.actor_id)) x
          from public.customer_activities a join public.customers c on c.id = a.customer_id join public.teams t on t.id = c.team_id and t.division = 'SALES'
         where c.department_id = v_dept order by a.occurred_at desc limit 8) q), '[]'::jsonb),
    'teamActivity', coalesce((select jsonb_agg(x order by (x ->> 'leads')::int desc) from (
        select jsonb_build_object('id', s.id, 'name', s.full_name, 'role', case s.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end, 'team', s.team_name,
          'leads', (select count(*) from b where b.owner_id = s.id), 'contacted7d', (select count(*) from b where b.owner_id = s.id and b.last_contacted > now() - interval '7 days'),
          'tasksOpen', (select count(*) from tk where tk.assignee_id = s.id and tk.status <> 'COMPLETED'), 'tasksDone', (select count(*) from tk where tk.assignee_id = s.id and tk.status = 'COMPLETED')) x
          from staff s) q), '[]'::jsonb),
    'upcomingFollowUps', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', id, 'name', name, 'company', company, 'followUp', follow_up, 'assignee', owner_name, 'temperature', temperature) x
          from b where not converted and follow_up is not null order by follow_up limit 8) q), '[]'::jsonb),
    'pendingTasks', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', tk.id, 'title', tk.title, 'dueDate', tk.due_date, 'priority', tk.priority, 'status', tk.status,
          'assignee', (select p.full_name from public.profiles p where p.id = tk.assignee_id), 'overdue', tk.due_date is not null and tk.due_date < v_today) x
          from tk where tk.status <> 'COMPLETED' order by (tk.due_date < v_today) desc nulls last, tk.due_date nulls last limit 8) q), '[]'::jsonb),
    'recentSheets', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', s.id, 'fileName', s.file_name, 'mode', s.mode, 'valid', s.valid_count, 'assignedAt', s.assigned_at,
          'assignedTo', (select p.full_name from public.profiles p where p.id = s.assigned_to)) x from public.sales_lead_sheets s where s.department_id = v_dept order by s.uploaded_at desc limit 5) q), '[]'::jsonb),
    'recentConversions', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', c.id, 'name', c.name, 'company', c.company, 'stage', c.lifecycle_stage, 'at', c.stage_changed_at,
          'owner', (select p.full_name from public.profiles p where p.id = c.owner_id)) x
          from public.customers c join b on b.id = c.id::text where b.converted order by c.stage_changed_at desc limit 5) q), '[]'::jsonb),
    'highlights', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', s.id, 'name', s.full_name,
          'tasksDone', (select count(*) from tk where tk.assignee_id = s.id and tk.status = 'COMPLETED'), 'converted', (select count(*) from b where b.owner_id = s.id and b.converted)) x
          from staff s order by (select count(*) from tk where tk.assignee_id = s.id and tk.status = 'COMPLETED') + (select count(*) from b where b.owner_id = s.id and b.converted) desc, s.full_name limit 3) q), '[]'::jsonb),
    'today', v_today)
    into v_out;
  return v_out;
end $$;
revoke all on function public.sales_head_overview() from public, anon;
grant execute on function public.sales_head_overview() to authenticated;

-- Reports: one row per Team Lead (their team) or per Team Member, for a period. Counts come from the leads, call statuses and tasks of the Sales teams.
create or replace function public.sales_head_reports(p_who text, p_from date, p_to date, p_task_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.my_department_id();
  v_today date := private.hr_today();
  v_who text := upper(coalesce(p_who, 'TEAM_MEMBER'));
  v_from date := coalesce(p_from, v_today - 29);
  v_to date := coalesce(p_to, v_today);
  v_status text := upper(nullif(btrim(coalesce(p_task_status, '')), ''));
  v_rows jsonb;
begin
  perform private.require_sales_head();
  if v_who not in ('TEAM_LEAD', 'TEAM_MEMBER') then raise exception 'VALIDATION_ERROR: Choose Team Lead or Team Member.' using errcode = 'P0001'; end if;
  if v_to < v_from then raise exception 'VALIDATION_ERROR: The end date is before the start date.' using errcode = 'P0001'; end if;
  if v_to - v_from > 400 then raise exception 'VALIDATION_ERROR: Choose a period of at most 400 days.' using errcode = 'P0001'; end if;
  if v_status is not null and v_status not in ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE') then raise exception 'VALIDATION_ERROR: Unknown task status.' using errcode = 'P0001'; end if;
  with b as (select * from private.sales_leads_base(v_dept) where kind = 'CUSTOMER'),
  tk as (select w.* from public.work_tasks w join public.teams tm on tm.id = w.team_id and tm.division = 'SALES'
          where w.department_id = v_dept and not exists (select 1 from public.work_tasks c where c.parent_id = w.id)
            and coalesce(w.due_date, (w.created_at at time zone 'Asia/Kolkata')::date) between v_from and v_to
            and (v_status is null or case v_status when 'PENDING' then w.status = 'ASSIGNED' when 'IN_PROGRESS' then w.status = 'IN_PROGRESS' when 'COMPLETED' then w.status = 'COMPLETED'
                                                  else w.due_date is not null and w.status <> 'COMPLETED' and w.due_date < v_today end)),
  p as (select pr.id, pr.full_name, pr.role, pr.sales_sub_role, pr.team_id, t.name team_name
          from public.profiles pr join public.teams t on t.id = pr.team_id and t.division = 'SALES'
         where pr.department_id = v_dept and pr.status = 'ACTIVE' and pr.role = case when v_who = 'TEAM_LEAD' then 'TEAM_HEAD'::public.app_role else 'TEAM_MEMBER'::public.app_role end)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'team', p.team_name, 'subRole', p.sales_sub_role,
      'members', case when v_who = 'TEAM_LEAD' then (select count(*) from public.profiles m where m.team_id = p.team_id and m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE') end,
      'leadsAssigned', (select count(*) from b where (v_who = 'TEAM_LEAD' and b.team_name = p.team_name or v_who = 'TEAM_MEMBER' and b.owner_id = p.id) and b.assigned_at::date between v_from and v_to),
      'leadsContacted', (select count(*) from b where (v_who = 'TEAM_LEAD' and b.team_name = p.team_name or v_who = 'TEAM_MEMBER' and b.owner_id = p.id) and b.last_contacted::date between v_from and v_to),
      'hot', (select count(*) from b where (v_who = 'TEAM_LEAD' and b.team_name = p.team_name or v_who = 'TEAM_MEMBER' and b.owner_id = p.id) and b.temperature = 'HOT'),
      'warm', (select count(*) from b where (v_who = 'TEAM_LEAD' and b.team_name = p.team_name or v_who = 'TEAM_MEMBER' and b.owner_id = p.id) and b.temperature = 'WARM'),
      'cold', (select count(*) from b where (v_who = 'TEAM_LEAD' and b.team_name = p.team_name or v_who = 'TEAM_MEMBER' and b.owner_id = p.id) and b.temperature = 'COLD'),
      'followUps', (select count(*) from b where (v_who = 'TEAM_LEAD' and b.team_name = p.team_name or v_who = 'TEAM_MEMBER' and b.owner_id = p.id) and not b.converted and (b.call_status = 'FOLLOW_UP_REQUIRED' or b.follow_up is not null)),
      'conversions', (select count(*) from b where (v_who = 'TEAM_LEAD' and b.team_name = p.team_name or v_who = 'TEAM_MEMBER' and b.owner_id = p.id) and b.converted),
      'tasksAssigned', (select count(*) from tk where (v_who = 'TEAM_LEAD' and tk.team_id = p.team_id) or (v_who = 'TEAM_MEMBER' and tk.assignee_id = p.id)),
      'tasksCompleted', (select count(*) from tk where ((v_who = 'TEAM_LEAD' and tk.team_id = p.team_id) or (v_who = 'TEAM_MEMBER' and tk.assignee_id = p.id)) and tk.status = 'COMPLETED'),
      'tasksPending', (select count(*) from tk where ((v_who = 'TEAM_LEAD' and tk.team_id = p.team_id) or (v_who = 'TEAM_MEMBER' and tk.assignee_id = p.id)) and tk.status <> 'COMPLETED'),
      'tasksOverdue', (select count(*) from tk where ((v_who = 'TEAM_LEAD' and tk.team_id = p.team_id) or (v_who = 'TEAM_MEMBER' and tk.assignee_id = p.id)) and tk.due_date is not null and tk.due_date < v_today and tk.status <> 'COMPLETED')
    ) order by p.team_name, p.full_name), '[]'::jsonb) into v_rows from p;
  return jsonb_build_object('who', v_who, 'from', v_from, 'to', v_to, 'taskStatus', v_status, 'rows', v_rows, 'today', v_today);
end $$;
revoke all on function public.sales_head_reports(text, date, date, text) from public, anon;
grant execute on function public.sales_head_reports(text, date, date, text) to authenticated;

-- Department Income, Sales side: collected money, counted once, from the payments the Accounts department verified (an invoice or quotation that is not paid is not income).
create or replace function public.sales_head_income(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.my_department_id();
  v_rep jsonb;
begin
  perform private.require_sales_head();
  v_rep := public.department_income_report(v_dept, p_from, p_to);
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'basis', v_rep -> 'basis',
    'figures', coalesce(v_rep -> 'byDivision' -> 'sales', '{}'::jsonb),
    'transactions', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('date', l.occurred_at, 'customer', c.name, 'customerId', c.id, 'reference', coalesce(g.invoice_number, l.reference), 'type', l.tx_type, 'service', l.service,
               'amount', l.amount, 'status', l.status, 'method', l.method, 'source', l.source) x
          from private.business_ledger() l
          join public.customers c on c.id = l.customer_id
          left join public.invoice_payments ip on l.source = 'INVOICE_PAYMENT' and ip.id = l.source_id
          left join public.generated_invoices g on g.invoice_id = ip.invoice_id
         where l.department_id = v_dept and l.division = 'SALES' and l.status <> 'REJECTED'
           and (p_from is null or l.occurred_at >= private.business_day_start(p_from)) and (p_to is null or l.occurred_at < private.business_day_start(p_to + 1))
         order by l.occurred_at desc limit 200) q), '[]'::jsonb),
    'expenses', null);
end $$;
revoke all on function public.sales_head_income(date, date) from public, anon;
grant execute on function public.sales_head_income(date, date) to authenticated;

-- Client Notices: a Sales head sees and ends the notices they published (the audience of a notice is the department's clients).
create or replace function public.client_announcements_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.app_role := private.my_role();
begin
  if v_role is null or v_role not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only a Department Head can see this.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'kind', a.kind, 'title', a.title, 'body', a.body, 'serviceCode', a.service_code,
      'serviceName', (select s.name from public.crm_services s where s.code = a.service_code),
      'eventDate', a.event_date, 'eventEnd', a.event_end, 'recurrence', a.recurrence, 'noticeDays', a.notice_days,
      'audience', coalesce((select d.name from public.departments d where d.id = a.department_id), 'All clients'),
      'active', a.active, 'createdAt', a.created_at,
      'createdBy', (select p.full_name from public.profiles p where p.id = a.created_by),
      'live', a.active and case a.kind
                 when 'NEW_SERVICE' then private.office_today() between a.shows_from and coalesce(a.expires_on, a.shows_from + 30)
                 else private.announcement_occurrence(a) is not null end,
      'nextDate', private.announcement_occurrence(a)) order by a.created_at desc)
    from public.client_announcements a
   where (private.can_notice_all_clients() or a.department_id is null or a.department_id = private.my_department_id())
       and (not private.is_sales_head() or a.created_by = private.my_id())), '[]'::jsonb);   -- the Sales head sees the notices they published
end $$;
revoke all on function public.client_announcements_overview() from public, anon;
grant execute on function public.client_announcements_overview() to authenticated;

create or replace function public.end_client_announcement(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := private.my_role();
  a public.client_announcements;
begin
  if v_role is null or v_role not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only a Department Head can do this.' using errcode = '42501';
  end if;
  select * into a from public.client_announcements where id = p_id for update;
  if a.id is null or (not private.can_notice_all_clients() and a.department_id is distinct from private.my_department_id())
     or (private.is_sales_head() and a.created_by is distinct from private.my_id()) then
    raise exception 'NOT_FOUND: Notice not found.' using errcode = 'P0001';
  end if;
  update public.client_announcements set active = false where id = p_id;
  perform private.write_audit('CLIENT_ANNOUNCEMENT_ENDED', 'client_announcement', p_id, a.department_id, null, jsonb_build_object('title', a.title));
end $$;
revoke all on function public.end_client_announcement(uuid) from public, anon;
grant execute on function public.end_client_announcement(uuid) to authenticated;

-- Notification Center: the Sales head is not shown Support's work (tickets, add-ons, onboarding and delivery events), which the whole-department
-- notifications would otherwise bring along. Everyone else sees all of theirs, as before.
create or replace function private.sales_notification_visible(p_type text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not private.is_sales_head() or p_type !~ '^(TICKET_|ADDON|ONBOARDING_|SENT_TO_ADDONS|SERVICE_SENT_TO_DELIVERY|HANDOVER_TO_)'
$$;
revoke all on function private.sales_notification_visible(text) from public, anon;
grant execute on function private.sales_notification_visible(text) to authenticated;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (recipient_id = (select private.my_id()) and private.sales_notification_visible(type));
