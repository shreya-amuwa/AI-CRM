-- =============================================================================
-- Attendance: location REQUIRED for Punch In / Punch Out, attendance states, CRM sign-out record, and HR's daily attendance register.
-- Run after 20261230000600_attendance_place_names.sql. Safe to run again. Nothing is deleted: earlier punches (including the ones recorded
-- with "location unavailable" under 20261230000400) stay exactly as they are.
--
-- 1. Punch In and Punch Out now need a real device location. A punch without coordinates (permission denied, location off, timed out,
--    unsupported) is REFUSED instead of being recorded as "location unavailable", and so is a position less precise than
--    attendance_settings.max_location_accuracy_m (default 1000 m: an approximate network / IP position is typically several kilometres and is
--    refused; GPS and Wi-Fi positions are well inside it). The coordinates are checked again here; the time is always the server's (now()).
--    No office location or geofence radius exists in the CRM, so none is invented: the punch is NOT restricted to a workplace boundary until
--    the business approves office locations and a radius.
-- 2. CRM sign-in and sign-out stay separate from attendance. Sign-ins are already recorded by the API (audit_logs SESSION_STARTED, one per
--    session) and the first CRM opening of the day (attendance_records.rm_login_at). Sign-outs were not recorded: public.record_crm_logout()
--    records SESSION_ENDED for the caller's own session (session id from the verified token, server time). Neither ever punches.
-- 3. Attendance state of a person's day: NOT_PUNCHED_IN, PUNCHED_IN, ON_LUNCH, RESUMED_WORK, PUNCHED_OUT, INCOMPLETE (punched in and never
--    out on a past day; or today, signed out of the CRM after punching in without punching out and not signed in again).
-- 4. public.hr_attendance_register(date, department, employee, status): HR and the Super Admin see EVERY active employee for one office day
--    (Asia/Kolkata) - CRM sign-ins / sign-outs and sessions, Punch In / Out with coordinates, accuracy and place, lunch breaks, worked time,
--    state. Each read is written to the audit log (ATTENDANCE_LOCATIONS_VIEWED).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings: the least precise position accepted for a punch
-- ---------------------------------------------------------------------------
alter table public.attendance_settings
  add column if not exists max_location_accuracy_m integer not null default 1000;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_settings_max_accuracy_check') then
    alter table public.attendance_settings add constraint attendance_settings_max_accuracy_check check (max_location_accuracy_m between 10 and 10000);
  end if;
end $$;

create or replace function private.max_location_accuracy()
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select max_location_accuracy_m from public.attendance_settings where id), 1000)
$$;
revoke all on function private.max_location_accuracy() from public, anon, authenticated;

-- The location of a punch: must be captured, valid and precise enough. Never invented, never replaced by an approximate one.
create or replace function private.attendance_required_location(p_status text, p_lat numeric, p_lng numeric, p_accuracy integer)
returns table (status text, latitude numeric, longitude numeric, accuracy integer) language plpgsql stable security definer set search_path = '' as $$
declare
  loc record;
  v_max integer := private.max_location_accuracy();
begin
  select * into loc from private.attendance_location(p_status, p_lat, p_lng, p_accuracy);   -- unknown status, bad coordinates: refused
  if loc.status <> 'CAPTURED' then
    raise exception 'VALIDATION_ERROR: Your current location is required to punch in or out. Turn on location services and allow location access for the CRM, then try again.'
      using errcode = 'P0001';
  end if;
  if loc.accuracy > v_max then
    raise exception 'VALIDATION_ERROR: Your location is not precise enough (within % m; at most % m is accepted). Turn on precise location (GPS or Wi-Fi) and try again.',
      loc.accuracy, v_max using errcode = 'P0001';
  end if;
  return query select loc.status, loc.latitude, loc.longitude, loc.accuracy;
end $$;
revoke all on function private.attendance_required_location(text, numeric, numeric, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. CRM sign-in / sign-out (separate from attendance)
-- ---------------------------------------------------------------------------
-- "Chrome on Windows" from a user-agent string (the same rule as the API's deviceLabel()).
create or replace function private.device_label(p_ua text)
returns text language sql immutable set search_path = '' as $$
  select case when coalesce(btrim(p_ua), '') = '' then null else
    (case when p_ua ~* 'edg/' then 'Edge' when p_ua ~* '(opr/|opera)' then 'Opera' when p_ua ~* '(chrome|crios)/' then 'Chrome'
          when p_ua ~* '(firefox|fxios)/' then 'Firefox' when p_ua ~* 'safari/' then 'Safari' else 'Browser' end)
    || coalesce(' on ' || (case when p_ua ~* 'android' then 'Android' when p_ua ~* '(iphone|ipad|ipod)' then 'iOS' when p_ua ~* 'windows' then 'Windows'
                                when p_ua ~* '(mac os x|macintosh)' then 'macOS' when p_ua ~* 'cros' then 'ChromeOS' when p_ua ~* 'linux' then 'Linux' end), '')
  end
$$;
revoke all on function private.device_label(text) from public, anon;

-- Sign-out of the CRM: records the end of the caller's own session (once). It never touches attendance (no Punch Out).
create or replace function public.record_crm_logout()
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_sid text;
begin
  -- the session id of the verified token (what auth.jwt() returns), never a value the caller chooses
  begin
    v_sid := nullif(btrim(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id', '')), '');
  exception when others then
    v_sid := null;
  end;
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then
    raise exception 'FORBIDDEN: Not signed in.' using errcode = '42501';
  end if;
  if v_sid is null or v_sid !~ '^[0-9a-fA-F-]{8,64}$' then
    v_sid := 'nosession-' || gen_random_uuid()::text;
  end if;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, outcome, dedupe_key, metadata)
  values (me.id, 'SESSION_ENDED', 'session',
          case when v_sid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then v_sid::uuid end,
          me.department_id, me.team_id, 'SUCCESS', 'session-end:' || v_sid,
          jsonb_strip_nulls(jsonb_build_object('device', private.device_label(private.request_header('user-agent')))))
  on conflict (dedupe_key) where dedupe_key is not null do nothing;
end $$;
revoke all on function public.record_crm_logout() from public, anon;
grant execute on function public.record_crm_logout() to authenticated;

-- A person's CRM sessions touching one office day: first sign-in, last sign-out, each session, sessions with no sign-out recorded.
create or replace function private.crm_sessions_json(p_profile uuid, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with b as (select (p_date::timestamp at time zone 'Asia/Kolkata') as t0, ((p_date + 1)::timestamp at time zone 'Asia/Kolkata') as t1),
  sids as (
    select distinct regexp_replace(l.dedupe_key, '^session(-end)?:', '') as sid
      from public.audit_logs l, b
     where l.actor_id = p_profile and l.action in ('SESSION_STARTED', 'SESSION_ENDED') and l.dedupe_key ~ '^session(-end)?:'
       and l.created_at >= b.t0 and l.created_at < b.t1),
  s as (
    select x.sid,
           (select l.created_at from public.audit_logs l where l.dedupe_key = 'session:' || x.sid) as started_at,
           (select l.created_at from public.audit_logs l where l.dedupe_key = 'session-end:' || x.sid) as ended_at,
           coalesce((select l.metadata ->> 'device' from public.audit_logs l where l.dedupe_key = 'session:' || x.sid),
                    (select l.metadata ->> 'device' from public.audit_logs l where l.dedupe_key = 'session-end:' || x.sid)) as device,
           (select l.metadata ->> 'method' from public.audit_logs l where l.dedupe_key = 'session:' || x.sid) as method
      from sids x)
  select jsonb_build_object(
    'systemLoginAt', (select a.rm_login_at from public.attendance_records a where a.profile_id = p_profile and a.attendance_date = p_date),
    'firstLoginAt', (select min(t) from (select a.rm_login_at as t from public.attendance_records a where a.profile_id = p_profile and a.attendance_date = p_date
                                         union all select s.started_at from s, b where s.started_at >= b.t0 and s.started_at < b.t1) z),
    'lastLogoutAt', (select max(s.ended_at) from s, b where s.ended_at >= b.t0 and s.ended_at < b.t1),
    'logoutMissing', exists (select 1 from s where s.started_at is not null and s.ended_at is null),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('startedAt', s.started_at, 'endedAt', s.ended_at, 'device', s.device, 'method', s.method,
                                                              'logoutRecorded', s.ended_at is not null) order by coalesce(s.started_at, s.ended_at)) from s), '[]'::jsonb))
$$;
revoke all on function private.crm_sessions_json(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The state of a person's attendance day
-- ---------------------------------------------------------------------------
create or replace function private.attendance_status(p_profile uuid, p_date date)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when r.punch_in_at is null then 'NOT_PUNCHED_IN'
    when r.punch_out_at is not null then 'PUNCHED_OUT'
    when p_date < private.office_today() then 'INCOMPLETE'
    when exists (select 1 from public.attendance_lunches l where l.profile_id = p_profile and l.attendance_date = p_date and l.ended_at is null) then 'ON_LUNCH'
    -- signed out of the CRM after punching in, without punching out, and not signed in again since
    when exists (select 1 from public.audit_logs e
                  where e.actor_id = p_profile and e.action = 'SESSION_ENDED' and e.created_at > r.punch_in_at
                    and not exists (select 1 from public.audit_logs s where s.actor_id = p_profile and s.action = 'SESSION_STARTED' and s.created_at > e.created_at))
      then 'INCOMPLETE'
    when exists (select 1 from public.attendance_lunches l where l.profile_id = p_profile and l.attendance_date = p_date and l.ended_at is not null) then 'RESUMED_WORK'
    else 'PUNCHED_IN' end
  from (select (select a.punch_in_at from public.attendance_records a where a.profile_id = p_profile and a.attendance_date = p_date) as punch_in_at,
               (select a.punch_out_at from public.attendance_records a where a.profile_id = p_profile and a.attendance_date = p_date) as punch_out_at) r
$$;
revoke all on function private.attendance_status(uuid, date) from public, anon, authenticated;

-- The lunch of a day: allowance, taken, remaining, exceeded, each break.
create or replace function private.attendance_lunch_json(p_profile uuid, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'allowanceMinutes', x.allowance, 'minutes', x.taken,
    'remainingMinutes', greatest(x.allowance - x.taken, 0), 'exceededMinutes', greatest(x.taken - x.allowance, 0),
    'open', (select jsonb_build_object('id', l.id, 'startedAt', l.started_at) from public.attendance_lunches l
              where l.profile_id = p_profile and l.attendance_date = p_date and l.ended_at is null),
    'sessions', coalesce((select jsonb_agg(jsonb_build_object('startedAt', l.started_at, 'endedAt', l.ended_at, 'endedBy', l.ended_by,
                            'minutes', floor(extract(epoch from (coalesce(l.ended_at, now()) - l.started_at)) / 60)::integer) order by l.started_at)
                            from public.attendance_lunches l where l.profile_id = p_profile and l.attendance_date = p_date), '[]'::jsonb))
  from (select private.lunch_allowance() as allowance, private.lunch_minutes(p_profile, p_date) as taken) x
$$;
revoke all on function private.attendance_lunch_json(uuid, date) from public, anon, authenticated;

-- One punch as the screens show it.
create or replace function private.attendance_punch_json(e public.attendance_events)
returns jsonb language sql stable set search_path = '' as $$
  select case when e.id is null then null else
    jsonb_build_object('at', e.occurred_at, 'locationStatus', e.location_status, 'latitude', e.latitude, 'longitude', e.longitude,
                       'accuracy', e.accuracy_m, 'place', e.place_name) end
$$;
revoke all on function private.attendance_punch_json(public.attendance_events) from public, anon, authenticated;

-- The signed-in person's day (same shape as before, plus the state, the remaining lunch and the location rule).
create or replace function private.attendance_day_json(p_profile uuid, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'date', p_date, 'serverTime', now(), 'timeZone', 'Asia/Kolkata',
    'status', private.attendance_status(p_profile, p_date),
    'punchIn', (select private.attendance_punch_json(e) from public.attendance_events e
                 where e.profile_id = p_profile and e.attendance_date = p_date and e.kind = 'PUNCH_IN' order by e.id limit 1),
    'punchOut', (select private.attendance_punch_json(e) from public.attendance_events e
                  where e.profile_id = p_profile and e.attendance_date = p_date and e.kind = 'PUNCH_OUT' order by e.occurred_at desc, e.id desc limit 1),
    'punchOutCount', (select count(*) from public.attendance_events e where e.profile_id = p_profile and e.attendance_date = p_date and e.kind = 'PUNCH_OUT'),
    'workedMinutes', (select case when a.punch_in_at is null then null
                                  when a.punch_out_at is null and p_date < private.office_today() then null
                                  else floor(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at)) / 60)::integer end
                        from public.attendance_records a where a.profile_id = p_profile and a.attendance_date = p_date),
    'maxAccuracyM', private.max_location_accuracy(),
    'lunch', private.attendance_lunch_json(p_profile, p_date))
$$;
revoke all on function private.attendance_day_json(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Punch In / Punch Out: the location is required (same idempotency and rules as 20261230000400 otherwise)
-- ---------------------------------------------------------------------------
create or replace function public.attendance_punch_in(p_location_status text, p_lat numeric, p_lng numeric, p_accuracy integer, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.attendance_me();
  v_day date := private.office_today();
  loc record;
begin
  select * into loc from private.attendance_required_location(p_location_status, p_lat, p_lng, p_accuracy);
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
    perform private.write_audit('ATTENDANCE_PUNCH_IN', 'profile', me.id, me.department_id, me.team_id,
      jsonb_build_object('location', loc.status, 'accuracy', loc.accuracy));
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
  perform pg_advisory_xact_lock(hashtext('attendance:' || me.id::text));
  if not exists (select 1 from public.attendance_events e where e.profile_id = me.id and e.attendance_date = v_day and e.kind = 'PUNCH_IN') then
    raise exception 'CONFLICT: Punch in first.' using errcode = 'P0001';
  end if;
  -- a fresh location of its own (never the Punch In one)
  select * into loc from private.attendance_required_location(p_location_status, p_lat, p_lng, p_accuracy);
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
    jsonb_build_object('location', loc.status, 'accuracy', loc.accuracy, 'again', v_last is not null));
  return private.attendance_day_json(me.id, v_day);
end $$;
revoke all on function public.attendance_punch_out(text, numeric, numeric, integer, uuid) from public, anon;
grant execute on function public.attendance_punch_out(text, numeric, numeric, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. HR and the Super Admin: the attendance register of one office day (every active employee; each read is audited)
-- ---------------------------------------------------------------------------
create or replace function public.hr_attendance_register(p_date date, p_department uuid default null, p_profile uuid default null, p_status text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.office_today();
  v_status text := nullif(upper(btrim(coalesce(p_status, ''))), '');
  v_rows jsonb;
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR and the Super Admin see the attendance register.' using errcode = '42501';
  end if;
  if p_date is null or p_date > v_today or p_date < v_today - 730 then
    raise exception 'VALIDATION_ERROR: Choose a date up to today (at most two years back).' using errcode = 'P0001';
  end if;
  if v_status is not null and v_status not in ('NOT_PUNCHED_IN', 'PUNCHED_IN', 'ON_LUNCH', 'RESUMED_WORK', 'PUNCHED_OUT', 'INCOMPLETE') then
    raise exception 'VALIDATION_ERROR: Unknown attendance status.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(r.row order by r.row ->> 'name'), '[]'::jsonb) into v_rows
    from (
      select jsonb_build_object(
          'profileId', p.id, 'name', p.full_name, 'role', p.role,
          'designation', coalesce(nullif(p.position, ''), (select pd.designation from public.employee_personal_details pd where pd.profile_id = p.id)),
          'departmentId', private.base_department(p.department_id),
          'department', (select d.name from public.departments d where d.id = private.base_department(p.department_id)),
          'date', p_date,
          'status', private.attendance_status(p.id, p_date),
          'crm', private.crm_sessions_json(p.id, p_date),
          'punchIn', (select private.attendance_punch_json(e) from public.attendance_events e
                       where e.profile_id = p.id and e.attendance_date = p_date and e.kind = 'PUNCH_IN' order by e.id limit 1),
          'punchOut', (select private.attendance_punch_json(e) from public.attendance_events e
                        where e.profile_id = p.id and e.attendance_date = p_date and e.kind = 'PUNCH_OUT' order by e.occurred_at desc, e.id desc limit 1),
          'punchOutHistory', coalesce((select jsonb_agg(private.attendance_punch_json(e) order by e.occurred_at, e.id) from public.attendance_events e
                                        where e.profile_id = p.id and e.attendance_date = p_date and e.kind = 'PUNCH_OUT'), '[]'::jsonb),
          'workedMinutes', (select case when a.punch_in_at is null then null
                                        when a.punch_out_at is not null then floor(extract(epoch from (a.punch_out_at - a.punch_in_at)) / 60)::integer
                                        when p_date = v_today then floor(extract(epoch from (now() - a.punch_in_at)) / 60)::integer end
                              from public.attendance_records a where a.profile_id = p.id and a.attendance_date = p_date),
          'lunch', private.attendance_lunch_json(p.id, p_date)) as row
        from public.profiles p
       where ((p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN')
              or exists (select 1 from public.attendance_records a where a.profile_id = p.id and a.attendance_date = p_date and a.punch_in_at is not null))
         and (p_department is null or private.base_department(p.department_id) = private.base_department(p_department))
         and (p_profile is null or p.id = p_profile)) r
   where v_status is null or r.row ->> 'status' = v_status;
  -- reading other people's punch locations and sign-ins is recorded
  perform private.write_audit('ATTENDANCE_LOCATIONS_VIEWED', 'attendance', null, p_department, null,
    jsonb_build_object('date', p_date, 'profile', p_profile, 'status', v_status, 'rows', jsonb_array_length(v_rows)));
  return jsonb_build_object(
    'date', p_date, 'today', v_today, 'serverTime', now(), 'timeZone', 'Asia/Kolkata',
    'allowanceMinutes', private.lunch_allowance(), 'maxAccuracyM', private.max_location_accuracy(),
    'retentionDays', coalesce((select location_retention_days from public.attendance_settings where id), 90),
    -- no office locations / geofence are configured in the CRM: punches are not limited to a workplace boundary
    'geofence', null,
    'rows', v_rows);
end $$;
revoke all on function public.hr_attendance_register(date, uuid, uuid, text) from public, anon;
grant execute on function public.hr_attendance_register(date, uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
