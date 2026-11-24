-- =============================================================================
-- HR Awards (docs/HR_AWARDS.md). Run after 20270202000200_notification_coverage.sql. Additive and safe to run twice.
--
-- HR dashboard > Award Management > Awards: seven monthly awards. For every award and month HR adds any number of nominees (an employee,
-- a team or a department, chosen from the CRM, never typed in), edits or removes them, and declares one or more of them winners (a winner
-- can be revoked, with a reason). Every month is its own period, so earlier months stay as they were.
--
--   hr_award_categories   the seven awards (seeded here) and the kind of nominee each takes
--   hr_award_periods      one row per award and month (created with the first nominee)
--   hr_award_nominees     the nominees of a period (removed ones are kept, status REMOVED)
--   hr_award_winners      the winners of a period (revoked ones are kept, revoked_at set)
--
-- Only HR staff (not HR Recruiters) and the Super Admin read or change any of it (private.is_hr_staff), checked in every function below;
-- the tables have no grants. Every change is written to the audit log.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.hr_award_categories (
  code text primary key check (code ~ '^[A-Z][A-Z_]{2,40}$'),
  name text not null unique check (length(btrim(name)) between 3 and 120),
  description text check (length(description) <= 500),
  nominee_type text not null check (nominee_type in ('INDIVIDUAL', 'TEAM', 'DEPARTMENT')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- the seven awards (names and order as HR asked for them)
insert into public.hr_award_categories (code, name, description, nominee_type, sort_order)
select * from (values
  ('PROFESSIONALISM_EXCELLENCE', 'Professionalism Excellence of the Month', 'Conduct, reliability and quality of work that set the standard.', 'INDIVIDUAL', 1),
  ('RISING_STAR', 'Rising Star of the Month', 'A newer team member growing fast and already making a difference.', 'INDIVIDUAL', 2),
  ('PLAYER', 'Player of the Month', 'The standout performer of the month.', 'INDIVIDUAL', 3),
  ('EMERGING_LEADER', 'Emerging Leader of the Month', 'Leadership shown by guiding, helping and lifting others.', 'INDIVIDUAL', 4),
  ('DEPARTMENT', 'Department of the Month', 'The department with the strongest results and teamwork.', 'DEPARTMENT', 5),
  ('TEAM', 'Team of the Month', 'The team that delivered together.', 'TEAM', 6),
  ('BUSINESS_ICON', 'Business Icon of the Month', 'Outstanding contribution to the business and its customers.', 'INDIVIDUAL', 7)
) v (code, name, description, nominee_type, sort_order)
on conflict (code) do update set name = excluded.name, description = excluded.description,
  nominee_type = excluded.nominee_type, sort_order = excluded.sort_order;

create table if not exists public.hr_award_periods (
  id uuid primary key default gen_random_uuid(),
  category_code text not null references public.hr_award_categories (code) on delete restrict,
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (category_code, period_month)
);
create index if not exists hr_award_periods_month_idx on public.hr_award_periods (period_month desc);

create table if not exists public.hr_award_nominees (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.hr_award_periods (id) on delete restrict,
  nominee_type text not null check (nominee_type in ('INDIVIDUAL', 'TEAM', 'DEPARTMENT')),
  -- the nominated employee / team / department (kept as a reference; the names below are what they were when nominated)
  profile_id uuid references public.profiles (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,
  department_id uuid references public.departments (id) on delete set null,
  -- the nominated entity's id, kept even if that record is later deleted, so the same entity cannot be nominated twice in a period
  entity_id uuid not null,
  nominee_name text not null check (length(btrim(nominee_name)) between 1 and 160),
  department_name text check (length(department_name) <= 160),
  team_name text check (length(team_name) <= 160),
  designation text check (length(designation) <= 160),
  reason text not null check (length(btrim(reason)) between 3 and 2000),
  remarks text check (length(remarks) <= 2000),
  status text not null default 'NOMINATED' check (status in ('NOMINATED', 'REMOVED')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  removed_by uuid references public.profiles (id) on delete set null,
  removed_at timestamptz,
  removed_reason text check (length(removed_reason) <= 500),
  check ((nominee_type = 'INDIVIDUAL' and team_id is null and department_id is null)
      or (nominee_type = 'TEAM' and profile_id is null and department_id is null)
      or (nominee_type = 'DEPARTMENT' and profile_id is null and team_id is null)),
  check ((status = 'REMOVED') = (removed_at is not null))
);
-- no duplicate nomination of the same employee / team / department for the same award and month
create unique index if not exists hr_award_nominees_unique_idx on public.hr_award_nominees (period_id, entity_id) where status = 'NOMINATED';
create index if not exists hr_award_nominees_period_idx on public.hr_award_nominees (period_id, created_at);
create index if not exists hr_award_nominees_profile_idx on public.hr_award_nominees (profile_id) where profile_id is not null;

create table if not exists public.hr_award_winners (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.hr_award_periods (id) on delete restrict,
  nominee_id uuid not null references public.hr_award_nominees (id) on delete restrict,
  remarks text check (length(remarks) <= 2000),
  declared_by uuid references public.profiles (id) on delete set null,
  declared_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  revoked_by uuid references public.profiles (id) on delete set null,
  revoked_at timestamptz,
  revoke_reason text check (length(revoke_reason) <= 500),
  check ((revoked_at is null) = (revoke_reason is null))
);
-- a nominee is declared a winner once (until that declaration is revoked); any number of nominees of a period can win
create unique index if not exists hr_award_winners_active_idx on public.hr_award_winners (nominee_id) where revoked_at is null;
create index if not exists hr_award_winners_period_idx on public.hr_award_winners (period_id, declared_at);

alter table public.hr_award_categories enable row level security;
alter table public.hr_award_periods enable row level security;
alter table public.hr_award_nominees enable row level security;
alter table public.hr_award_winners enable row level security;
revoke all on public.hr_award_categories, public.hr_award_periods, public.hr_award_nominees, public.hr_award_winners from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.award_require_hr()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR staff manage awards.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.award_require_hr() from public, anon;
grant execute on function private.award_require_hr() to authenticated, service_role;

-- the award month: the first day of the month; from January 2020 to 12 months ahead
create or replace function private.award_month(p_month date)
returns date language plpgsql stable security definer set search_path = '' as $$
declare
  v date := date_trunc('month', p_month)::date;
begin
  if p_month is null then
    raise exception 'VALIDATION_ERROR: Choose the award month and year.' using errcode = 'P0001';
  end if;
  if v < date '2020-01-01' or v > (date_trunc('month', now() at time zone 'Asia/Kolkata') + interval '12 months')::date then
    raise exception 'VALIDATION_ERROR: Choose a month between January 2020 and 12 months from now.' using errcode = 'P0001';
  end if;
  return v;
end $$;
revoke all on function private.award_month(date) from public, anon;
grant execute on function private.award_month(date) to authenticated, service_role;

create or replace function private.award_category(p_code text)
returns public.hr_award_categories language plpgsql stable security definer set search_path = '' as $$
declare
  c public.hr_award_categories;
begin
  select * into c from public.hr_award_categories where code = upper(btrim(coalesce(p_code, ''))) and is_active;
  if c.code is null then
    raise exception 'NOT_FOUND: That award does not exist.' using errcode = 'P0002';
  end if;
  return c;
end $$;
revoke all on function private.award_category(text) from public, anon;
grant execute on function private.award_category(text) to authenticated, service_role;

create or replace function private.award_text(p text, p_max integer)
returns text language sql immutable set search_path = '' as $$
  select nullif(left(btrim(coalesce(p, '')), p_max), '')
$$;

create or replace function private.award_nominee_json(n public.hr_award_nominees)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id, 'periodId', n.period_id, 'nomineeType', n.nominee_type,
    'entityId', n.entity_id, 'profileId', n.profile_id, 'teamId', n.team_id, 'departmentId', n.department_id,
    'name', n.nominee_name, 'departmentName', n.department_name, 'teamName', n.team_name, 'designation', n.designation,
    'reason', n.reason, 'remarks', n.remarks,
    'status', case when exists (select 1 from public.hr_award_winners w where w.nominee_id = n.id and w.revoked_at is null) then 'WINNER' else n.status end,
    'nominatedAt', n.created_at, 'nominatedBy', (select full_name from public.profiles where id = n.created_by),
    'updatedAt', n.updated_at, 'updatedBy', (select full_name from public.profiles where id = n.updated_by))
$$;

create or replace function private.award_winner_json(w public.hr_award_winners)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', w.id, 'periodId', w.period_id, 'nomineeId', w.nominee_id,
    'name', n.nominee_name, 'nomineeType', n.nominee_type, 'departmentName', n.department_name, 'teamName', n.team_name,
    'designation', n.designation, 'remarks', w.remarks,
    'declaredAt', w.declared_at, 'declaredBy', (select full_name from public.profiles where id = w.declared_by),
    'updatedAt', w.updated_at,
    'revokedAt', w.revoked_at, 'revokedBy', (select full_name from public.profiles where id = w.revoked_by), 'revokeReason', w.revoke_reason)
  from public.hr_award_nominees n where n.id = w.nominee_id
$$;

revoke all on function private.award_text(text, integer), private.award_nominee_json(public.hr_award_nominees),
  private.award_winner_json(public.hr_award_winners) from public, anon;
grant execute on function private.award_text(text, integer), private.award_nominee_json(public.hr_award_nominees),
  private.award_winner_json(public.hr_award_winners) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Reading
-- ---------------------------------------------------------------------------
-- the seven award cards of a month, and the months that have award records (history)
create or replace function public.hr_awards_overview(p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_month date;
begin
  perform private.award_require_hr();
  v_month := private.award_month(p_month);
  return jsonb_build_object(
    'month', to_char(v_month, 'YYYY-MM'),
    'monthLabel', to_char(v_month, 'FMMonth YYYY'),
    'awards', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', c.code, 'name', c.name, 'description', c.description, 'nomineeType', c.nominee_type,
               'periodId', p.id, 'nominees', coalesce(s.nominees, 0), 'winners', coalesce(s.winners, 0),
               'status', case when coalesce(s.winners, 0) > 0 then 'WINNERS_DECLARED' when coalesce(s.nominees, 0) > 0 then 'NOMINATIONS_OPEN' else 'NO_NOMINEES' end,
               'winnerNames', coalesce(s.winner_names, '[]'::jsonb))
             order by c.sort_order, c.code)
        from public.hr_award_categories c
        left join public.hr_award_periods p on p.category_code = c.code and p.period_month = v_month
        left join lateral (
          select (select count(*) from public.hr_award_nominees n where n.period_id = p.id and n.status = 'NOMINATED') as nominees,
                 (select count(*) from public.hr_award_winners w where w.period_id = p.id and w.revoked_at is null) as winners,
                 (select jsonb_agg(n.nominee_name order by w.declared_at, n.nominee_name) from public.hr_award_winners w
                    join public.hr_award_nominees n on n.id = w.nominee_id where w.period_id = p.id and w.revoked_at is null) as winner_names
        ) s on p.id is not null
       where c.is_active), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('month', to_char(h.period_month, 'YYYY-MM'), 'monthLabel', to_char(h.period_month, 'FMMonth YYYY'),
                                          'nominees', h.nominees, 'winners', h.winners) order by h.period_month desc)
        from (select p.period_month,
                     count(n.id) filter (where n.status = 'NOMINATED') as nominees,
                     (select count(*) from public.hr_award_winners w join public.hr_award_periods p2 on p2.id = w.period_id
                       where p2.period_month = p.period_month and w.revoked_at is null) as winners
                from public.hr_award_periods p
                left join public.hr_award_nominees n on n.period_id = p.id
               group by p.period_month
               order by p.period_month desc
               limit 36) h), '[]'::jsonb));
end $$;
revoke all on function public.hr_awards_overview(date) from public, anon;
grant execute on function public.hr_awards_overview(date) to authenticated;

-- one award in one month: overview, nominees and winners (plus revoked declarations, for the record)
create or replace function public.hr_award_detail(p_category text, p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.hr_award_categories;
  v_month date;
  v_period public.hr_award_periods;
  v_nominees integer := 0;
  v_winners integer := 0;
begin
  perform private.award_require_hr();
  c := private.award_category(p_category);
  v_month := private.award_month(p_month);
  select * into v_period from public.hr_award_periods where category_code = c.code and period_month = v_month;
  if v_period.id is not null then
    select count(*) into v_nominees from public.hr_award_nominees where period_id = v_period.id and status = 'NOMINATED';
    select count(*) into v_winners from public.hr_award_winners where period_id = v_period.id and revoked_at is null;
  end if;
  return jsonb_build_object(
    'award', jsonb_build_object('code', c.code, 'name', c.name, 'description', c.description, 'nomineeType', c.nominee_type),
    'month', to_char(v_month, 'YYYY-MM'),
    'monthLabel', to_char(v_month, 'FMMonth YYYY'),
    'periodId', v_period.id,
    'totalNominees', v_nominees,
    'totalWinners', v_winners,
    'status', case when v_winners > 0 then 'WINNERS_DECLARED' when v_nominees > 0 then 'NOMINATIONS_OPEN' else 'NO_NOMINEES' end,
    'nominees', coalesce((select jsonb_agg(private.award_nominee_json(n) order by n.created_at, n.nominee_name)
                            from public.hr_award_nominees n where n.period_id = v_period.id and n.status = 'NOMINATED'), '[]'::jsonb),
    'winners', coalesce((select jsonb_agg(private.award_winner_json(w) order by w.declared_at, w.id)
                           from public.hr_award_winners w where w.period_id = v_period.id and w.revoked_at is null), '[]'::jsonb),
    'revokedWinners', coalesce((select jsonb_agg(private.award_winner_json(w) order by w.revoked_at desc)
                                  from public.hr_award_winners w where w.period_id = v_period.id and w.revoked_at is not null), '[]'::jsonb),
    'removedNominees', (select count(*) from public.hr_award_nominees n where n.period_id = v_period.id and n.status = 'REMOVED'));
end $$;
revoke all on function public.hr_award_detail(text, date) from public, anon;
grant execute on function public.hr_award_detail(text, date) to authenticated;

-- who can be nominated: active employees (not the Super Admin), the teams and the departments of the CRM
create or replace function public.hr_award_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.award_require_hr();
  return jsonb_build_object(
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'departmentId', d.id, 'departmentName', d.name,
                                          'teamId', t.id, 'teamName', t.name,
                                          'designation', coalesce(nullif(p.position, ''), h.designation)) order by p.full_name)
        from public.profiles p
        left join public.departments d on d.id = p.department_id
        left join public.teams t on t.id = p.team_id
        left join lateral (select nullif(x.designation, '') as designation from public.hr_employees x where x.profile_id = p.id
                            order by x.created_at limit 1) h on true
       where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'departmentId', d.id, 'departmentName', d.name,
                                          'members', (select count(*) from public.profiles p where p.team_id = t.id and p.status = 'ACTIVE'))
                       order by d.name, t.name)
        from public.teams t join public.departments d on d.id = t.department_id), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name,
                                          'members', (select count(*) from public.profiles p where p.department_id = d.id and p.status = 'ACTIVE'))
                       order by d.name)
        from public.departments d), '[]'::jsonb));
end $$;
revoke all on function public.hr_award_options() from public, anon;
grant execute on function public.hr_award_options() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Nominees
-- ---------------------------------------------------------------------------
create or replace function public.hr_award_nominate(p_category text, p_month date, p_nominee_type text, p_entity_id uuid,
                                                    p_reason text, p_remarks text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_award_categories;
  v_month date;
  v_period uuid;
  v_type text := upper(btrim(coalesce(p_nominee_type, '')));
  v_reason text := private.award_text(p_reason, 2001);
  v_remarks text := private.award_text(p_remarks, 2001);
  v_name text; v_dept text; v_team text; v_designation text;
  v_profile uuid; v_team_id uuid; v_dept_id uuid; v_audit_dept uuid;
  v_id uuid;
begin
  perform private.award_require_hr();
  c := private.award_category(p_category);
  v_month := private.award_month(p_month);
  if v_type not in ('INDIVIDUAL', 'TEAM', 'DEPARTMENT') then
    raise exception 'VALIDATION_ERROR: Choose the nominee type: Individual, Team or Department.' using errcode = 'P0001';
  end if;
  if v_type <> c.nominee_type then
    raise exception 'VALIDATION_ERROR: % takes % nominees.', c.name,
      case c.nominee_type when 'INDIVIDUAL' then 'individual' when 'TEAM' then 'team' else 'department' end using errcode = 'P0001';
  end if;
  if p_entity_id is null then
    raise exception 'VALIDATION_ERROR: Choose the %.', case v_type when 'INDIVIDUAL' then 'employee' when 'TEAM' then 'team' else 'department' end using errcode = 'P0001';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'VALIDATION_ERROR: Enter the reason for the nomination (at least 3 characters).' using errcode = 'P0001';
  end if;
  if length(v_reason) > 2000 or length(coalesce(v_remarks, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep the reason and the remarks under 2000 characters each.' using errcode = 'P0001';
  end if;

  -- the nominee comes from the CRM's own records
  if v_type = 'INDIVIDUAL' then
    select p.id, p.full_name, d.name, t.name, coalesce(nullif(p.position, ''), (select nullif(x.designation, '') from public.hr_employees x
                                                                                  where x.profile_id = p.id order by x.created_at limit 1)), p.department_id
      into v_profile, v_name, v_dept, v_team, v_designation, v_audit_dept
      from public.profiles p left join public.departments d on d.id = p.department_id left join public.teams t on t.id = p.team_id
     where p.id = p_entity_id and p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN';
    if v_profile is null then
      raise exception 'NOT_FOUND: That employee is not an active employee.' using errcode = 'P0002';
    end if;
  elsif v_type = 'TEAM' then
    select t.id, t.name, d.name, t.name, t.department_id into v_team_id, v_name, v_dept, v_team, v_audit_dept
      from public.teams t join public.departments d on d.id = t.department_id where t.id = p_entity_id;
    if v_team_id is null then
      raise exception 'NOT_FOUND: That team does not exist.' using errcode = 'P0002';
    end if;
  else
    select d.id, d.name, d.name into v_dept_id, v_name, v_dept from public.departments d where d.id = p_entity_id;
    if v_dept_id is null then
      raise exception 'NOT_FOUND: That department does not exist.' using errcode = 'P0002';
    end if;
    v_audit_dept := v_dept_id;
  end if;

  insert into public.hr_award_periods (category_code, period_month, created_by, updated_by)
  values (c.code, v_month, auth.uid(), auth.uid())
  on conflict (category_code, period_month) do nothing;
  -- one change to a period at a time (two HR people nominating the same person at once get one nomination and a clear message)
  select id into v_period from public.hr_award_periods where category_code = c.code and period_month = v_month for update;

  if exists (select 1 from public.hr_award_nominees where period_id = v_period and entity_id = p_entity_id and status = 'NOMINATED') then
    raise exception 'CONFLICT: % is already nominated for % – %.', v_name, c.name, to_char(v_month, 'FMMonth YYYY') using errcode = 'P0001';
  end if;

  insert into public.hr_award_nominees (period_id, nominee_type, profile_id, team_id, department_id, entity_id, nominee_name,
                                        department_name, team_name, designation, reason, remarks, created_by, updated_by)
  values (v_period, v_type, v_profile, v_team_id, v_dept_id, p_entity_id, left(v_name, 160),
          left(v_dept, 160), left(v_team, 160), left(v_designation, 160), v_reason, v_remarks, auth.uid(), auth.uid())
  returning id into v_id;
  update public.hr_award_periods set updated_by = auth.uid(), updated_at = now() where id = v_period;

  perform private.write_audit('HR_AWARD_NOMINATED', 'hr_award_nominee', v_id, v_audit_dept, null,
    jsonb_build_object('award', c.code, 'month', to_char(v_month, 'YYYY-MM'), 'nomineeType', v_type, 'entityId', p_entity_id, 'nominee', v_name));
  return public.hr_award_detail(c.code, v_month);
end $$;
revoke all on function public.hr_award_nominate(text, date, text, uuid, text, text) from public, anon;
grant execute on function public.hr_award_nominate(text, date, text, uuid, text, text) to authenticated;

-- the reason and remarks of a nomination (who was nominated does not change: remove and nominate again instead)
create or replace function public.hr_award_update_nominee(p_nominee uuid, p_reason text, p_remarks text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n public.hr_award_nominees;
  p public.hr_award_periods;
  v_reason text := private.award_text(p_reason, 2001);
  v_remarks text := private.award_text(p_remarks, 2001);
begin
  perform private.award_require_hr();
  select * into n from public.hr_award_nominees where id = p_nominee for update;
  if n.id is null or n.status <> 'NOMINATED' then
    raise exception 'NOT_FOUND: That nomination does not exist or was removed.' using errcode = 'P0002';
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'VALIDATION_ERROR: Enter the reason for the nomination (at least 3 characters).' using errcode = 'P0001';
  end if;
  if length(v_reason) > 2000 or length(coalesce(v_remarks, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep the reason and the remarks under 2000 characters each.' using errcode = 'P0001';
  end if;
  update public.hr_award_nominees set reason = v_reason, remarks = v_remarks, updated_by = auth.uid(), updated_at = now() where id = n.id;
  select * into p from public.hr_award_periods where id = n.period_id;
  perform private.write_audit('HR_AWARD_NOMINEE_UPDATED', 'hr_award_nominee', n.id, null, null,
    jsonb_build_object('award', p.category_code, 'month', to_char(p.period_month, 'YYYY-MM'), 'nominee', n.nominee_name,
                       'before', jsonb_build_object('reason', n.reason, 'remarks', n.remarks),
                       'after', jsonb_build_object('reason', v_reason, 'remarks', v_remarks)));
  return public.hr_award_detail(p.category_code, p.period_month);
end $$;
revoke all on function public.hr_award_update_nominee(uuid, text, text) from public, anon;
grant execute on function public.hr_award_update_nominee(uuid, text, text) to authenticated;

-- removing a nominee keeps the row (status REMOVED); a declared winner must be revoked first
create or replace function public.hr_award_remove_nominee(p_nominee uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n public.hr_award_nominees;
  p public.hr_award_periods;
begin
  perform private.award_require_hr();
  select * into n from public.hr_award_nominees where id = p_nominee for update;
  if n.id is null or n.status <> 'NOMINATED' then
    raise exception 'NOT_FOUND: That nomination does not exist or was already removed.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.hr_award_winners where nominee_id = n.id and revoked_at is null) then
    raise exception 'CONFLICT: % is a declared winner. Revoke the winner declaration first, then remove the nomination.', n.nominee_name using errcode = 'P0001';
  end if;
  update public.hr_award_nominees
     set status = 'REMOVED', removed_by = auth.uid(), removed_at = now(), removed_reason = private.award_text(p_reason, 500),
         updated_by = auth.uid(), updated_at = now()
   where id = n.id;
  select * into p from public.hr_award_periods where id = n.period_id;
  perform private.write_audit('HR_AWARD_NOMINEE_REMOVED', 'hr_award_nominee', n.id, null, null,
    jsonb_build_object('award', p.category_code, 'month', to_char(p.period_month, 'YYYY-MM'), 'nominee', n.nominee_name,
                       'reason', private.award_text(p_reason, 500)));
  return public.hr_award_detail(p.category_code, p.period_month);
end $$;
revoke all on function public.hr_award_remove_nominee(uuid, text) from public, anon;
grant execute on function public.hr_award_remove_nominee(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Winners
-- ---------------------------------------------------------------------------
-- declare one or more nominees of the same award and month winners (nominees already declared are left as they are)
create or replace function public.hr_award_declare_winners(p_nominees uuid[], p_remarks text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_period uuid;
  p public.hr_award_periods;
  n public.hr_award_nominees;
  v_remarks text := private.award_text(p_remarks, 2001);
  v_id uuid;
begin
  perform private.award_require_hr();
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_nominees, '{}')) x where x is not null;
  if cardinality(v_ids) = 0 then
    raise exception 'VALIDATION_ERROR: Choose at least one nominee to declare a winner.' using errcode = 'P0001';
  end if;
  if cardinality(v_ids) > 200 then
    raise exception 'VALIDATION_ERROR: Declare at most 200 winners at a time.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_remarks, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep the winner remarks under 2000 characters.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.hr_award_nominees where id = any (v_ids) and status = 'NOMINATED') <> cardinality(v_ids) then
    raise exception 'NOT_FOUND: One of the chosen nominees does not exist or was removed. Reload the award and try again.' using errcode = 'P0002';
  end if;
  if (select count(distinct period_id) from public.hr_award_nominees where id = any (v_ids)) <> 1 then
    raise exception 'VALIDATION_ERROR: Declare winners of one award and month at a time.' using errcode = 'P0001';
  end if;
  select period_id into v_period from public.hr_award_nominees where id = v_ids[1];
  select * into p from public.hr_award_periods where id = v_period for update;

  for n in select * from public.hr_award_nominees where id = any (v_ids) and status = 'NOMINATED' order by created_at for update loop
    if not exists (select 1 from public.hr_award_winners where nominee_id = n.id and revoked_at is null) then
      insert into public.hr_award_winners (period_id, nominee_id, remarks, declared_by, updated_by)
      values (v_period, n.id, v_remarks, auth.uid(), auth.uid()) returning id into v_id;
      perform private.write_audit('HR_AWARD_WINNER_DECLARED', 'hr_award_winner', v_id, null, null,
        jsonb_build_object('award', p.category_code, 'month', to_char(p.period_month, 'YYYY-MM'), 'nominee', n.nominee_name, 'nomineeId', n.id));
    end if;
  end loop;
  update public.hr_award_periods set updated_by = auth.uid(), updated_at = now() where id = v_period;
  return public.hr_award_detail(p.category_code, p.period_month);
end $$;
revoke all on function public.hr_award_declare_winners(uuid[], text) from public, anon;
grant execute on function public.hr_award_declare_winners(uuid[], text) to authenticated;

create or replace function public.hr_award_update_winner(p_winner uuid, p_remarks text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.hr_award_winners;
  p public.hr_award_periods;
  v_remarks text := private.award_text(p_remarks, 2001);
begin
  perform private.award_require_hr();
  select * into w from public.hr_award_winners where id = p_winner for update;
  if w.id is null or w.revoked_at is not null then
    raise exception 'NOT_FOUND: That winner declaration does not exist or was revoked.' using errcode = 'P0002';
  end if;
  if length(coalesce(v_remarks, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep the winner remarks under 2000 characters.' using errcode = 'P0001';
  end if;
  update public.hr_award_winners set remarks = v_remarks, updated_by = auth.uid(), updated_at = now() where id = w.id;
  select * into p from public.hr_award_periods where id = w.period_id;
  perform private.write_audit('HR_AWARD_WINNER_UPDATED', 'hr_award_winner', w.id, null, null,
    jsonb_build_object('award', p.category_code, 'month', to_char(p.period_month, 'YYYY-MM'),
                       'before', jsonb_build_object('remarks', w.remarks), 'after', jsonb_build_object('remarks', v_remarks)));
  return public.hr_award_detail(p.category_code, p.period_month);
end $$;
revoke all on function public.hr_award_update_winner(uuid, text) from public, anon;
grant execute on function public.hr_award_update_winner(uuid, text) to authenticated;

-- revoking keeps the declaration on record (revoked_at, by whom, why); the nominee stays a nominee and can be declared again
create or replace function public.hr_award_revoke_winner(p_winner uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.hr_award_winners;
  p public.hr_award_periods;
  v_reason text := private.award_text(p_reason, 501);
begin
  perform private.award_require_hr();
  select * into w from public.hr_award_winners where id = p_winner for update;
  if w.id is null or w.revoked_at is not null then
    raise exception 'NOT_FOUND: That winner declaration does not exist or was already revoked.' using errcode = 'P0002';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 500 then
    raise exception 'VALIDATION_ERROR: Enter the reason for revoking the winner (3 to 500 characters).' using errcode = 'P0001';
  end if;
  update public.hr_award_winners set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = v_reason,
                                     updated_by = auth.uid(), updated_at = now() where id = w.id;
  select * into p from public.hr_award_periods where id = w.period_id;
  perform private.write_audit('HR_AWARD_WINNER_REVOKED', 'hr_award_winner', w.id, null, null,
    jsonb_build_object('award', p.category_code, 'month', to_char(p.period_month, 'YYYY-MM'), 'nomineeId', w.nominee_id, 'reason', v_reason));
  return public.hr_award_detail(p.category_code, p.period_month);
end $$;
revoke all on function public.hr_award_revoke_winner(uuid, text) from public, anon;
grant execute on function public.hr_award_revoke_winner(uuid, text) to authenticated;
