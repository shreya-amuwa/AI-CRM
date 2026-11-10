-- =============================================================================
-- Attendance: the place name of each punch (e.g. "Baner Road, Pune, Maharashtra") instead of bare coordinates. Run after 20261230000500.
-- Safe to run again. No punch is changed except for filling its place name.
--
-- * attendance_events.place_name: filled ONCE per punch by the API (server/automations/attendancePlaces.ts), which looks the coordinates up
--   with a reverse-geocoding service (Google Geocoding when GOOGLE_MAPS_API_KEY is set, else OpenStreetMap Nominatim, at most one request a
--   second, as its usage policy asks). A lookup that fails is tried again later, at most 3 times; the punch keeps its coordinates either way.
-- * The place name is part of the location: it is erased together with the coordinates after the retention period (90 days), and it is
--   shown only to the people who already see the location (the employee their own; HR and the Super Admin everyone; never an Operations Head).
-- * attendance_places_pending / attendance_set_place are for the API's service role only.
-- =============================================================================

alter table public.attendance_events
  add column if not exists place_name text,
  add column if not exists place_attempts integer not null default 0,
  add column if not exists place_resolved_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_events_place_check') then
    alter table public.attendance_events add constraint attendance_events_place_check check (place_name is null or length(place_name) <= 300);
  end if;
end $$;
create index if not exists attendance_events_place_pending_idx on public.attendance_events (occurred_at)
  where latitude is not null and place_name is null;

-- Punches with coordinates and no place name yet (newest first; a lookup that failed 3 times is not tried again).
create or replace function public.attendance_places_pending(p_limit integer default 10)
returns table (id bigint, latitude numeric, longitude numeric) language sql stable security definer set search_path = '' as $$
  select e.id, e.latitude, e.longitude from public.attendance_events e
   where e.latitude is not null and e.longitude is not null and e.place_name is null and e.place_attempts < 3
   order by e.occurred_at desc
   limit least(greatest(coalesce(p_limit, 10), 1), 50)
$$;
revoke all on function public.attendance_places_pending(integer) from public, anon, authenticated;
grant execute on function public.attendance_places_pending(integer) to service_role;

-- Store the looked-up name (null = the lookup failed: counts as an attempt). Only while the coordinates are still there.
create or replace function public.attendance_set_place(p_event bigint, p_place text)
returns void language sql security definer set search_path = '' as $$
  update public.attendance_events
     set place_name = case when nullif(btrim(coalesce(p_place, '')), '') is null then null else left(btrim(p_place), 300) end,
         place_attempts = place_attempts + 1,
         place_resolved_at = case when nullif(btrim(coalesce(p_place, '')), '') is null then place_resolved_at else now() end
   where id = p_event and latitude is not null and place_name is null
$$;
revoke all on function public.attendance_set_place(bigint, text) from public, anon, authenticated;
grant execute on function public.attendance_set_place(bigint, text) to service_role;

-- (copies of 20261230000400: the place name is shown with the location, and erased with it)

create or replace function private.attendance_day_json(p_profile uuid, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'date', p_date, 'serverTime', now(),
    'punchIn', (select jsonb_build_object('at', e.occurred_at, 'locationStatus', e.location_status, 'latitude', e.latitude, 'longitude', e.longitude, 'accuracy', e.accuracy_m, 'place', e.place_name)
                  from public.attendance_events e where e.profile_id = p_profile and e.attendance_date = p_date and e.kind = 'PUNCH_IN' order by e.id limit 1),
    'punchOut', (select jsonb_build_object('at', e.occurred_at, 'locationStatus', e.location_status, 'latitude', e.latitude, 'longitude', e.longitude, 'accuracy', e.accuracy_m, 'place', e.place_name)
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
      'punchIn', (select jsonb_build_object('at', e.occurred_at, 'locationStatus', e.location_status, 'latitude', e.latitude, 'longitude', e.longitude, 'accuracy', e.accuracy_m, 'place', e.place_name)
                    from public.attendance_events e where e.profile_id = p.id and e.attendance_date = a.attendance_date and e.kind = 'PUNCH_IN' order by e.id limit 1),
      'punchOut', (select jsonb_build_object('at', e.occurred_at, 'locationStatus', e.location_status, 'latitude', e.latitude, 'longitude', e.longitude, 'accuracy', e.accuracy_m, 'place', e.place_name)
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

create or replace function private.purge_attendance_locations()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_days integer := coalesce((select location_retention_days from public.attendance_settings where id), 90);
  n integer;
begin
  update public.attendance_events
     set latitude = null, longitude = null, accuracy_m = null, place_name = null, location_status = 'PURGED'
   where latitude is not null and occurred_at < now() - make_interval(days => v_days);
  get diagnostics n = row_count;
  return n;
end $$;


notify pgrst, 'reload schema';
