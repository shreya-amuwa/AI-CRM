-- =============================================================================
-- Attendance: Punch In / Punch Out with the device's location, and the 50-minute lunch break. Run after 20261229000200. Safe to run again.
--
-- * Employees punch in and out themselves, from the Attendance section of the side panel. Nothing is recorded automatically at sign-in and
--   nothing blocks the CRM: when the browser does not give a location (permission denied, unavailable, timed out) the punch is recorded with
--   that status and NO coordinates - a location is never invented.
-- * Every time comes from the server (now()); the browser's clock is never trusted. The attendance day is the office day (Asia/Kolkata).
-- * Punches are append-only (attendance_events). Punch In: once per day (a second click, a refresh or another tab returns the same punch).
--   Punch Out: each later Punch Out is a new event and the LATEST one is the effective Punch Out; earlier ones stay in the history. The same
--   request sent twice (client_request_id), or a second click within 60 seconds, is not a new punch.
-- * Lunch: Start / End Lunch; one open lunch at a time; several breaks a day add up against the allowance (50 minutes, attendance_settings).
--   Ending the day with a lunch still open closes it at the Punch Out time. Exceeding is flagged only (no payroll or score effect).
-- * Who sees what: the employee their own; HR and the Super Admin everyone (locations included; each read of locations is audited);
--   an Operations Head only lunch durations and flags of the departments and functions they supervise - never punch times or locations;
--   Team Leads and Department Heads: their own only. The tables have no grants; everything goes through these functions.
-- * Retention: coordinates older than 90 days (attendance_settings.location_retention_days) are erased by private.purge_attendance_locations()
--   (daily with pg_cron, and on every Punch In); the punch times stay.
-- Extends attendance_records (one row per person and day, 20261027000100); the CRM-login and biometric times are unchanged.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Shape
-- ---------------------------------------------------------------------------
create table if not exists public.attendance_settings (
  id boolean primary key default true check (id),
  lunch_allowance_minutes integer not null default 50 check (lunch_allowance_minutes between 10 and 180),
  location_retention_days integer not null default 90 check (location_retention_days between 7 and 730),
  updated_at timestamptz not null default now()
);
insert into public.attendance_settings (id) values (true) on conflict (id) do nothing;
alter table public.attendance_settings enable row level security;
revoke all on public.attendance_settings from public, anon, authenticated;

alter table public.attendance_records
  add column if not exists punch_in_at timestamptz,
  add column if not exists punch_out_at timestamptz;      -- the effective (latest valid) Punch Out

create table if not exists public.attendance_events (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  attendance_date date not null,
  kind text not null check (kind in ('PUNCH_IN', 'PUNCH_OUT')),
  occurred_at timestamptz not null default now(),
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  accuracy_m integer check (accuracy_m between 0 and 100000),
  location_status text not null check (location_status in ('CAPTURED', 'DENIED', 'UNAVAILABLE', 'TIMEOUT', 'UNSUPPORTED', 'PURGED')),
  client_request_id uuid,
  recorded_by uuid references public.profiles (id) on delete set null,   -- someone else (HR correction); null = the employee
  note text check (length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint attendance_events_location_check check (
    (location_status = 'CAPTURED' and latitude is not null and longitude is not null)
    or (location_status <> 'CAPTURED' and latitude is null and longitude is null and accuracy_m is null))
);
create index if not exists attendance_events_person_idx on public.attendance_events (profile_id, attendance_date, id);
create index if not exists attendance_events_located_idx on public.attendance_events (occurred_at) where latitude is not null;
create unique index if not exists attendance_events_request_uidx on public.attendance_events (profile_id, client_request_id) where client_request_id is not null;
alter table public.attendance_events enable row level security;
revoke all on public.attendance_events from public, anon, authenticated;

create table if not exists public.attendance_lunches (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  attendance_date date not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by text check (ended_by in ('EMPLOYEE', 'PUNCH_OUT', 'HR')),
  created_at timestamptz not null default now(),
  constraint attendance_lunches_order_check check (ended_at is null or ended_at >= started_at)
);
create index if not exists attendance_lunches_person_idx on public.attendance_lunches (profile_id, attendance_date);
-- never two open lunches for one person
create unique index if not exists attendance_lunches_one_open_uidx on public.attendance_lunches (profile_id) where ended_at is null;
alter table public.attendance_lunches enable row level security;
revoke all on public.attendance_lunches from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.lunch_allowance()
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select lunch_allowance_minutes from public.attendance_settings where id), 50)
$$;
revoke all on function private.lunch_allowance() from public, anon, authenticated;

-- Whole minutes of lunch of a person on a day (an open lunch counts up to now).
create or replace function private.lunch_minutes(p_profile uuid, p_date date)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(floor(sum(extract(epoch from (coalesce(l.ended_at, now()) - l.started_at))) / 60), 0)::integer
    from public.attendance_lunches l where l.profile_id = p_profile and l.attendance_date = p_date
$$;
revoke all on function private.lunch_minutes(uuid, date) from public, anon, authenticated;

-- The location sent by the browser, checked: coordinates only with status CAPTURED, never invented.
create or replace function private.attendance_location(p_status text, p_lat numeric, p_lng numeric, p_accuracy integer)
returns table (status text, latitude numeric, longitude numeric, accuracy integer) language plpgsql immutable set search_path = '' as $$
declare
  v_status text := upper(btrim(coalesce(p_status, '')));
begin
  if v_status not in ('CAPTURED', 'DENIED', 'UNAVAILABLE', 'TIMEOUT', 'UNSUPPORTED') then
    raise exception 'VALIDATION_ERROR: Unknown location status.' using errcode = 'P0001';
  end if;
  if v_status = 'CAPTURED' then
    if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 or (p_lat = 0 and p_lng = 0)
       or p_accuracy is null or p_accuracy < 0 or p_accuracy > 100000 then
      raise exception 'VALIDATION_ERROR: The location is not valid.' using errcode = 'P0001';
    end if;
    return query select v_status, round(p_lat, 6), round(p_lng, 6), p_accuracy;
  else
    return query select v_status, null::numeric, null::numeric, null::integer;
  end if;
end $$;
revoke all on function private.attendance_location(text, numeric, numeric, integer) from public, anon, authenticated;

-- The signed-in person's day as the Attendance section shows it (server time included, so the lunch timer does not drift).
create or replace function private.attendance_day_json(p_profile uuid, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'date', p_date, 'serverTime', now(),
    'punchIn', (select jsonb_build_object('at', e.occurred_at, 'locationStatus', e.location_status, 'latitude', e.latitude, 'longitude', e.longitude, 'accuracy', e.accuracy_m)
                  from public.attendance_events e where e.profile_id = p_profile and e.attendance_date = p_date and e.kind = 'PUNCH_IN' order by e.id limit 1),
    'punchOut', (select jsonb_build_object('at', e.occurred_at, 'locationStatus', e.location_status, 'latitude', e.latitude, 'longitude', e.longitude, 'accuracy', e.accuracy_m)
                   from public.attendance_events e where e.profile_id = p_profile and e.attendance_date = p_date and e.kind = 'PUNCH_OUT' order by e.occurred_at desc, e.id desc limit 1),
    'punchOutCount', (select count(*) from public.attendance_events e where e.profile_id = p_profile and e.attendance_date = p_date and e.kind = 'PUNCH_OUT'),
    'workedMinutes', (select case when a.punch_in_at is null then null
                                  else floor(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at)) / 60)::integer end
                        from public.attendance_records a where a.profile_id = p_profile and a.attendance_date = p_date),
    'lunch', jsonb_build_object(
      'allowanceMinutes', private.lunch_allowance(),
      'minutes', private.lunch_minutes(p_profile, p_date),
      'exceededMinutes', greatest(private.lunch_minutes(p_profile, p_date) - private.lunch_allowance(), 0),
      'open', (select jsonb_build_object('id', l.id, 'startedAt', l.started_at) from public.attendance_lunches l where l.profile_id = p_profile and l.ended_at is null),
      'sessions', coalesce((select jsonb_agg(jsonb_build_object('startedAt', l.started_at, 'endedAt', l.ended_at, 'endedBy', l.ended_by,
                              'minutes', floor(extract(epoch from (coalesce(l.ended_at, now()) - l.started_at)) / 60)::integer) order by l.started_at)
                              from public.attendance_lunches l where l.profile_id = p_profile and l.attendance_date = p_date), '[]'::jsonb)))
$$;
revoke all on function private.attendance_day_json(uuid, date) from public, anon, authenticated;

-- Erase coordinates older than the retention period (the punch and its time stay; the status says the location was erased).
create or replace function private.purge_attendance_locations()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_days integer := coalesce((select location_retention_days from public.attendance_settings where id), 90);
  n integer;
begin
  update public.attendance_events
     set latitude = null, longitude = null, accuracy_m = null, location_status = 'PURGED'
   where latitude is not null and occurred_at < now() - make_interval(days => v_days);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.purge_attendance_locations() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('purge-attendance-locations', '27 21 * * *', 'select private.purge_attendance_locations()');
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The employee: punch in, punch out, lunch, their own days
-- ---------------------------------------------------------------------------
create or replace function private.attendance_me()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null or me.role = 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Attendance is recorded by employees.' using errcode = '42501';
  end if;
  return me;
end $$;
revoke all on function private.attendance_me() from public, anon, authenticated;

create or replace function public.attendance_today()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.attendance_me();
begin
  return private.attendance_day_json(me.id, private.office_today());
end $$;
revoke all on function public.attendance_today() from public, anon;
grant execute on function public.attendance_today() to authenticated;

create or replace function public.attendance_punch_in(p_location_status text, p_lat numeric, p_lng numeric, p_accuracy integer, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.attendance_me();
  v_day date := private.office_today();
  loc record;
begin
  select * into loc from private.attendance_location(p_location_status, p_lat, p_lng, p_accuracy);
  perform private.purge_attendance_locations();
  -- one Punch In a day: a second click, a refresh or another tab returns the first one
  perform pg_advisory_xact_lock(hashtext('attendance:' || me.id::text));
  if not exists (select 1 from public.attendance_events e where e.profile_id = me.id and e.attendance_date = v_day and e.kind = 'PUNCH_IN') then
    insert into public.attendance_events (profile_id, attendance_date, kind, latitude, longitude, accuracy_m, location_status, client_request_id)
    values (me.id, v_day, 'PUNCH_IN', loc.latitude, loc.longitude, loc.accuracy, loc.status, p_request)
    on conflict do nothing;
    insert into public.attendance_records as a (profile_id, attendance_date, punch_in_at)
    values (me.id, v_day, now())
    on conflict (profile_id, attendance_date) do update set punch_in_at = coalesce(a.punch_in_at, excluded.punch_in_at), updated_at = now();
    perform private.write_audit('ATTENDANCE_PUNCH_IN', 'profile', me.id, me.department_id, me.team_id, jsonb_build_object('location', loc.status));
  end if;
  return private.attendance_day_json(me.id, v_day);
end $$;
revoke all on function public.attendance_punch_in(text, numeric, numeric, integer, uuid) from public, anon;
grant execute on function public.attendance_punch_in(text, numeric, numeric, integer, uuid) to authenticated;

create or replace function public.attendance_punch_out(p_location_status text, p_lat numeric, p_lng numeric, p_accuracy integer, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.attendance_me();
  v_day date := private.office_today();
  loc record;
  v_last timestamptz;
begin
  select * into loc from private.attendance_location(p_location_status, p_lat, p_lng, p_accuracy);
  perform pg_advisory_xact_lock(hashtext('attendance:' || me.id::text));
  if not exists (select 1 from public.attendance_events e where e.profile_id = me.id and e.attendance_date = v_day and e.kind = 'PUNCH_IN') then
    raise exception 'CONFLICT: Punch in first.' using errcode = 'P0001';
  end if;
  -- the same request again (a network retry), or a second click within a minute: not a new Punch Out
  if p_request is not null and exists (select 1 from public.attendance_events e where e.profile_id = me.id and e.client_request_id = p_request) then
    return private.attendance_day_json(me.id, v_day);
  end if;
  select max(e.occurred_at) into v_last from public.attendance_events e where e.profile_id = me.id and e.attendance_date = v_day and e.kind = 'PUNCH_OUT';
  if v_last is not null and now() - v_last < interval '60 seconds' then
    return private.attendance_day_json(me.id, v_day);
  end if;
  -- a lunch still running ends with the day
  update public.attendance_lunches set ended_at = now(), ended_by = 'PUNCH_OUT' where profile_id = me.id and ended_at is null;
  insert into public.attendance_events (profile_id, attendance_date, kind, latitude, longitude, accuracy_m, location_status, client_request_id)
  values (me.id, v_day, 'PUNCH_OUT', loc.latitude, loc.longitude, loc.accuracy, loc.status, p_request);
  -- the latest valid Punch Out is the effective one; earlier ones stay in attendance_events
  update public.attendance_records set punch_out_at = now(), updated_at = now() where profile_id = me.id and attendance_date = v_day;
  perform private.write_audit('ATTENDANCE_PUNCH_OUT', 'profile', me.id, me.department_id, me.team_id,
    jsonb_build_object('location', loc.status, 'again', v_last is not null));
  return private.attendance_day_json(me.id, v_day);
end $$;
revoke all on function public.attendance_punch_out(text, numeric, numeric, integer, uuid) from public, anon;
grant execute on function public.attendance_punch_out(text, numeric, numeric, integer, uuid) to authenticated;

create or replace function public.attendance_lunch(p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.attendance_me();
  v_day date := private.office_today();
  v_action text := upper(btrim(coalesce(p_action, '')));
  r public.attendance_records;
begin
  if v_action not in ('START', 'END') then
    raise exception 'VALIDATION_ERROR: Choose start or end of lunch.' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('attendance:' || me.id::text));
  select * into r from public.attendance_records where profile_id = me.id and attendance_date = v_day;
  if v_action = 'START' then
    if r.punch_in_at is null then
      raise exception 'CONFLICT: Punch in before starting lunch.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.attendance_lunches l where l.profile_id = me.id and l.ended_at is null) then
      return private.attendance_day_json(me.id, v_day);          -- already on lunch: a second click or another tab changes nothing
    end if;
    if r.punch_out_at is not null then
      raise exception 'CONFLICT: You have punched out for the day.' using errcode = 'P0001';
    end if;
    insert into public.attendance_lunches (profile_id, attendance_date) values (me.id, v_day);
  else
    if not exists (select 1 from public.attendance_lunches l where l.profile_id = me.id and l.ended_at is null) then
      raise exception 'CONFLICT: Lunch has not been started.' using errcode = 'P0001';
    end if;
    update public.attendance_lunches set ended_at = now(), ended_by = 'EMPLOYEE' where profile_id = me.id and ended_at is null;
  end if;
  return private.attendance_day_json(me.id, v_day);
end $$;
revoke all on function public.attendance_lunch(text) from public, anon;
grant execute on function public.attendance_lunch(text) to authenticated;

-- The employee's own days (punches with their own locations, worked time, lunch).
create or replace function public.my_attendance(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.attendance_me();
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'VALIDATION_ERROR: Choose a period of up to three months.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(private.attendance_day_json(me.id, d.d) order by d.d desc)
                     from (select distinct x.attendance_date as d from (
                             select attendance_date from public.attendance_records where profile_id = me.id and punch_in_at is not null
                             union select attendance_date from public.attendance_lunches where profile_id = me.id) x
                            where x.attendance_date between p_from and p_to) d), '[]'::jsonb);
end $$;
revoke all on function public.my_attendance(date, date) from public, anon;
grant execute on function public.my_attendance(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. HR and the Super Admin: everyone's punches, locations, worked time, missing Punch Out, lunch (each read is audited)
-- ---------------------------------------------------------------------------
create or replace function public.hr_attendance_punches(p_from date, p_to date, p_department uuid default null, p_profile uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR and the Super Admin see punch times and locations.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'VALIDATION_ERROR: Choose a period of up to three months.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'profileId', p.id, 'name', p.full_name, 'department', (select d.name from public.departments d where d.id = private.base_department(p.department_id)),
      'date', a.attendance_date,
      'punchIn', (select jsonb_build_object('at', e.occurred_at, 'locationStatus', e.location_status, 'latitude', e.latitude, 'longitude', e.longitude, 'accuracy', e.accuracy_m)
                    from public.attendance_events e where e.profile_id = p.id and e.attendance_date = a.attendance_date and e.kind = 'PUNCH_IN' order by e.id limit 1),
      'punchOut', (select jsonb_build_object('at', e.occurred_at, 'locationStatus', e.location_status, 'latitude', e.latitude, 'longitude', e.longitude, 'accuracy', e.accuracy_m)
                     from public.attendance_events e where e.profile_id = p.id and e.attendance_date = a.attendance_date and e.kind = 'PUNCH_OUT' order by e.occurred_at desc, e.id desc limit 1),
      'punchOutHistory', coalesce((select jsonb_agg(jsonb_build_object('at', e.occurred_at, 'locationStatus', e.location_status) order by e.id)
                                    from public.attendance_events e where e.profile_id = p.id and e.attendance_date = a.attendance_date and e.kind = 'PUNCH_OUT'), '[]'::jsonb),
      'missingPunchOut', a.punch_in_at is not null and a.punch_out_at is null and a.attendance_date < private.office_today(),
      'workedMinutes', case when a.punch_in_at is not null and a.punch_out_at is not null then floor(extract(epoch from (a.punch_out_at - a.punch_in_at)) / 60)::integer end,
      'locationUnavailable', exists (select 1 from public.attendance_events e where e.profile_id = p.id and e.attendance_date = a.attendance_date
                                      and e.location_status in ('DENIED', 'UNAVAILABLE', 'TIMEOUT', 'UNSUPPORTED')),
      'lunchMinutes', private.lunch_minutes(p.id, a.attendance_date),
      'lunchExceededMinutes', greatest(private.lunch_minutes(p.id, a.attendance_date) - private.lunch_allowance(), 0))
      order by a.attendance_date desc, p.full_name), '[]'::jsonb) into v_rows
    from public.attendance_records a join public.profiles p on p.id = a.profile_id
   where a.attendance_date between p_from and p_to and a.punch_in_at is not null
     and (p_department is null or private.base_department(p.department_id) = private.base_department(p_department))
     and (p_profile is null or p.id = p_profile);
  -- reading other people's locations is recorded
  perform private.write_audit('ATTENDANCE_LOCATIONS_VIEWED', 'attendance', null, p_department, null,
    jsonb_build_object('from', p_from, 'to', p_to, 'profile', p_profile, 'rows', jsonb_array_length(v_rows)));
  return jsonb_build_object('allowanceMinutes', private.lunch_allowance(), 'retentionDays',
                            coalesce((select location_retention_days from public.attendance_settings where id), 90), 'rows', v_rows);
end $$;
revoke all on function public.hr_attendance_punches(date, date, uuid, uuid) from public, anon;
grant execute on function public.hr_attendance_punches(date, date, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Lunch only: HR / Super Admin everyone; an Operations Head the departments and functions they supervise (never punches or locations)
-- ---------------------------------------------------------------------------
create or replace function public.attendance_lunch_overview(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  v_all boolean := private.is_hr_staff();
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if not v_all and (me.id is null or me.role <> 'DEPARTMENT_HEAD' or not me.is_operations_head) then
    raise exception 'FORBIDDEN: Not allowed.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'VALIDATION_ERROR: Choose a period of up to three months.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('allowanceMinutes', private.lunch_allowance(), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
        'profileId', p.id, 'name', p.full_name, 'department', (select d.name from public.departments d where d.id = private.base_department(p.department_id)),
        'date', x.attendance_date,
        'firstStart', x.first_start, 'lastEnd', x.last_end,
        'minutes', private.lunch_minutes(p.id, x.attendance_date),
        'exceededMinutes', greatest(private.lunch_minutes(p.id, x.attendance_date) - private.lunch_allowance(), 0),
        'flagged', private.lunch_minutes(p.id, x.attendance_date) > private.lunch_allowance())
        order by x.attendance_date desc, p.full_name)
      from (select l.profile_id, l.attendance_date, min(l.started_at) as first_start, max(l.ended_at) as last_end
              from public.attendance_lunches l where l.attendance_date between p_from and p_to group by 1, 2) x
      join public.profiles p on p.id = x.profile_id
     where v_all
        or (p.id <> me.id and exists (
              select 1 from private.scopes_of(me.id) s
               where s.department_id = private.base_department(p.department_id)
                 and (s.division is null
                      or (p.role = 'DEPARTMENT_HEAD' and p.head_division = s.division)
                      or (p.role <> 'DEPARTMENT_HEAD' and p.team_id is not null and private.team_in_division(p.team_id, s.division)))))), '[]'::jsonb));
end $$;
revoke all on function public.attendance_lunch_overview(date, date) from public, anon;
grant execute on function public.attendance_lunch_overview(date, date) to authenticated;

notify pgrst, 'reload schema';
