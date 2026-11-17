-- =============================================================================
-- Attendance reminders: Punch In, Start Lunch, Lunch ends soon and Punch Out reminders, in the CRM bell and as Web Push notifications on
-- each person's phones and laptops.
--
-- 1. Times. HR keeps the company defaults (10:00 / 14:00 / 19:00, a follow-up after 15 minutes, a lunch warning 5 minutes before the
--    allowance runs out, Monday to Saturday, a master switch, "off for today"). Each person may choose their own times within fixed ranges.
-- 2. Devices. One row per browser push subscription; the last person to sign in on a device owns it, and signing out removes it.
-- 3. What is due. The API's 5-minute scheduled run asks attendance_reminders_due(): each reminder is recorded once (per person, day, kind,
--    first/follow-up), written to the bell, and returned with the person's devices so the API can push it. A reminder more than 30 minutes
--    late is never sent. Nobody is reminded of something already done, on approved leave, on a day off, or when switched off.
--
-- Office time is India (Asia/Kolkata), as in the attendance migrations (20261230000400). Safe to run twice; pasteable in the SQL editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Company defaults and personal times
-- ---------------------------------------------------------------------------
alter table public.attendance_settings
  add column if not exists reminders_enabled boolean not null default true,
  add column if not exists reminder_punch_in time not null default '10:00',
  add column if not exists reminder_lunch time not null default '14:00',
  add column if not exists reminder_punch_out time not null default '19:00',
  add column if not exists reminder_follow_up_minutes integer not null default 15,
  add column if not exists reminder_lunch_warning_minutes integer not null default 5,
  add column if not exists reminder_days integer[] not null default '{1,2,3,4,5,6}',
  add column if not exists reminders_paused_on date;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_settings_reminder_follow_up_check') then
    alter table public.attendance_settings add constraint attendance_settings_reminder_follow_up_check check (reminder_follow_up_minutes between 5 and 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_settings_reminder_warning_check') then
    alter table public.attendance_settings add constraint attendance_settings_reminder_warning_check check (reminder_lunch_warning_minutes between 2 and 15);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_settings_reminder_days_check') then
    alter table public.attendance_settings add constraint attendance_settings_reminder_days_check
      check (cardinality(reminder_days) between 1 and 7 and reminder_days <@ '{1,2,3,4,5,6,7}'::integer[]);
  end if;
end $$;

create table if not exists public.attendance_reminder_prefs (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  enabled boolean not null default true,
  punch_in time check (punch_in between '06:00' and '13:00'),     -- null = the company default
  lunch time check (lunch between '11:00' and '17:00'),
  punch_out time check (punch_out between '14:00' and '23:30'),
  updated_at timestamptz not null default now()
);
alter table public.attendance_reminder_prefs enable row level security;
revoke all on public.attendance_reminder_prefs from public, anon, authenticated;

-- The person's effective reminder settings: their own time where they chose one, the company default otherwise.
create or replace function private.reminder_times(p_profile uuid)
returns table (enabled boolean, punch_in time, lunch time, punch_out time)
language sql stable security definer set search_path = '' as $$
  select s.reminders_enabled and coalesce(p.enabled, true),
         coalesce(p.punch_in, s.reminder_punch_in), coalesce(p.lunch, s.reminder_lunch), coalesce(p.punch_out, s.reminder_punch_out)
    from public.attendance_settings s
    left join public.attendance_reminder_prefs p on p.profile_id = p_profile
   where s.id
$$;
revoke all on function private.reminder_times(uuid) from public, anon, authenticated;

-- One rule for every time the screens accept (personal and company): the ranges, and Punch Out after Punch In.
create or replace function private.reminder_times_check(p_punch_in time, p_lunch time, p_punch_out time)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_punch_in is not null and p_punch_in not between '06:00' and '13:00' then
    raise exception 'VALIDATION_ERROR: Punch In reminder must be between 06:00 and 13:00' using errcode = 'P0001';
  end if;
  if p_lunch is not null and p_lunch not between '11:00' and '17:00' then
    raise exception 'VALIDATION_ERROR: Lunch reminder must be between 11:00 and 17:00' using errcode = 'P0001';
  end if;
  if p_punch_out is not null and p_punch_out not between '14:00' and '23:30' then
    raise exception 'VALIDATION_ERROR: Punch Out reminder must be between 14:00 and 23:30' using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.reminder_times_check(time, time, time) from public, anon, authenticated;

create or replace function private.hhmm(p_time time) returns text language sql immutable set search_path = '' as $$
  select to_char(p_time, 'HH24:MI')
$$;
revoke all on function private.hhmm(time) from public, anon, authenticated;

create or replace function private.attendance_reminder_settings_json(p_profile uuid, p_is_staff boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'company', jsonb_build_object('enabled', s.reminders_enabled, 'punchIn', private.hhmm(s.reminder_punch_in), 'lunch', private.hhmm(s.reminder_lunch),
                                  'punchOut', private.hhmm(s.reminder_punch_out), 'followUpMinutes', s.reminder_follow_up_minutes,
                                  'lunchWarningMinutes', s.reminder_lunch_warning_minutes, 'days', to_jsonb(s.reminder_days)),
    'mine', case when p_is_staff then jsonb_build_object('enabled', coalesce(p.enabled, true), 'punchIn', private.hhmm(p.punch_in),
                                                         'lunch', private.hhmm(p.lunch), 'punchOut', private.hhmm(p.punch_out)) else 'null'::jsonb end,
    'effective', case when p_is_staff then (select jsonb_build_object('enabled', t.enabled, 'punchIn', private.hhmm(t.punch_in), 'lunch', private.hhmm(t.lunch),
                                                                      'punchOut', private.hhmm(t.punch_out)) from private.reminder_times(p_profile) t)
                      else 'null'::jsonb end,
    'pausedToday', coalesce(s.reminders_paused_on = private.office_today(), false),
    'canManage', private.is_hr_staff())
  from public.attendance_settings s
  left join public.attendance_reminder_prefs p on p.profile_id = p_profile
  where s.id
$$;
revoke all on function private.attendance_reminder_settings_json(uuid, boolean) from public, anon, authenticated;

-- Everyone signed in and active: their times (staff) and the company defaults. The Super Admin, who does not punch, sees only the defaults.
create or replace function public.attendance_reminder_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  return private.attendance_reminder_settings_json(me.id, me.role <> 'SUPER_ADMIN');
end $$;
revoke all on function public.attendance_reminder_settings() from public, anon;
grant execute on function public.attendance_reminder_settings() to authenticated;

-- A person's own times; null = use the company time. Checked against the ranges and against each other after the defaults are applied.
create or replace function public.attendance_reminder_save_mine(p_enabled boolean, p_punch_in time, p_lunch time, p_punch_out time)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.attendance_me();
  s public.attendance_settings;
begin
  perform private.reminder_times_check(p_punch_in, p_lunch, p_punch_out);
  select * into s from public.attendance_settings where id;
  if coalesce(p_punch_out, s.reminder_punch_out) <= coalesce(p_punch_in, s.reminder_punch_in) then
    raise exception 'VALIDATION_ERROR: Punch Out must be after Punch In' using errcode = 'P0001';
  end if;
  insert into public.attendance_reminder_prefs (profile_id, enabled, punch_in, lunch, punch_out, updated_at)
  values (me.id, coalesce(p_enabled, true), p_punch_in, p_lunch, p_punch_out, now())
  on conflict (profile_id) do update
    set enabled = excluded.enabled, punch_in = excluded.punch_in, lunch = excluded.lunch, punch_out = excluded.punch_out, updated_at = now();
  return private.attendance_reminder_settings_json(me.id, true);
end $$;
revoke all on function public.attendance_reminder_save_mine(boolean, time, time, time) from public, anon;
grant execute on function public.attendance_reminder_save_mine(boolean, time, time, time) to authenticated;

create or replace function private.require_hr_reminders()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null or not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR can change the company reminder settings.' using errcode = '42501';
  end if;
  return me;
end $$;
revoke all on function private.require_hr_reminders() from public, anon, authenticated;

-- HR (and the Super Admin): the company defaults. Audited.
create or replace function public.hr_attendance_reminder_defaults_save(
  p_enabled boolean, p_punch_in time, p_lunch time, p_punch_out time, p_follow_up integer, p_warning integer, p_days integer[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_hr_reminders();
begin
  if p_enabled is null or p_punch_in is null or p_lunch is null or p_punch_out is null or p_follow_up is null or p_warning is null or p_days is null then
    raise exception 'VALIDATION_ERROR: Fill in every reminder setting' using errcode = 'P0001';
  end if;
  perform private.reminder_times_check(p_punch_in, p_lunch, p_punch_out);
  if p_punch_out <= p_punch_in then
    raise exception 'VALIDATION_ERROR: Punch Out must be after Punch In' using errcode = 'P0001';
  end if;
  if p_follow_up not between 5 and 60 then
    raise exception 'VALIDATION_ERROR: The follow-up must be between 5 and 60 minutes' using errcode = 'P0001';
  end if;
  if p_warning not between 2 and 15 then
    raise exception 'VALIDATION_ERROR: The lunch warning must be between 2 and 15 minutes' using errcode = 'P0001';
  end if;
  if cardinality(p_days) = 0 or not (p_days <@ '{1,2,3,4,5,6,7}'::integer[]) then
    raise exception 'VALIDATION_ERROR: Choose at least one reminder day (Monday to Sunday)' using errcode = 'P0001';
  end if;
  update public.attendance_settings
     set reminders_enabled = p_enabled, reminder_punch_in = p_punch_in, reminder_lunch = p_lunch, reminder_punch_out = p_punch_out,
         reminder_follow_up_minutes = p_follow_up, reminder_lunch_warning_minutes = p_warning,
         reminder_days = (select array_agg(distinct d order by d) from unnest(p_days) d), updated_at = now()
   where id;
  perform private.write_audit('ATTENDANCE_REMINDERS_UPDATED', 'attendance_settings', null, me.department_id, me.team_id,
    jsonb_build_object('enabled', p_enabled, 'punchIn', private.hhmm(p_punch_in), 'lunch', private.hhmm(p_lunch), 'punchOut', private.hhmm(p_punch_out),
                       'followUpMinutes', p_follow_up, 'lunchWarningMinutes', p_warning, 'days', to_jsonb(p_days)));
  return private.attendance_reminder_settings_json(me.id, me.role <> 'SUPER_ADMIN');
end $$;
revoke all on function public.hr_attendance_reminder_defaults_save(boolean, time, time, time, integer, integer, integer[]) from public, anon;
grant execute on function public.hr_attendance_reminder_defaults_save(boolean, time, time, time, integer, integer, integer[]) to authenticated;

-- HR: no reminders for the rest of today (a holiday, an office closure). Audited.
create or replace function public.hr_attendance_reminders_pause_today(p_paused boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_hr_reminders();
begin
  update public.attendance_settings
     set reminders_paused_on = case when coalesce(p_paused, false) then private.office_today() end, updated_at = now()
   where id;
  perform private.write_audit('ATTENDANCE_REMINDERS_PAUSED', 'attendance_settings', null, me.department_id, me.team_id,
    jsonb_build_object('paused', coalesce(p_paused, false), 'date', private.office_today()));
  return private.attendance_reminder_settings_json(me.id, me.role <> 'SUPER_ADMIN');
end $$;
revoke all on function public.hr_attendance_reminders_pause_today(boolean) from public, anon;
grant execute on function public.hr_attendance_reminders_pause_today(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Devices (Web Push subscriptions)
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 1 and 200),
  auth text not null check (length(auth) between 1 and 100),
  label text check (length(label) <= 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz
);
create index if not exists push_subscriptions_person_idx on public.push_subscriptions (profile_id) where active;
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;

-- "Turn on reminders" on this device. The last person to sign in on a browser owns its subscription (a shared phone never keeps sending
-- the previous person's reminders), and turning reminders on again re-activates a device the push service had reported as gone.
create or replace function public.push_subscription_save(p_endpoint text, p_p256dh text, p_auth text, p_label text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_id uuid;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000
     or coalesce(length(p_p256dh), 0) not between 1 and 200 or coalesce(length(p_auth), 0) not between 1 and 100 then
    raise exception 'VALIDATION_ERROR: This browser sent a reminder subscription that is not valid.' using errcode = 'P0001';
  end if;
  insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, label)
  values (me.id, p_endpoint, p_p256dh, p_auth, left(nullif(trim(p_label), ''), 120))
  on conflict (endpoint) do update
    set profile_id = excluded.profile_id, p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label, active = true,
        created_at = case when public.push_subscriptions.profile_id = excluded.profile_id then public.push_subscriptions.created_at else now() end
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.push_subscription_save(text, text, text, text) from public, anon;
grant execute on function public.push_subscription_save(text, text, text, text) to authenticated;

-- Signing out: this browser stops getting the person's reminders. Never fails (someone else's or an unknown device: nothing happens).
create or replace function public.push_subscription_remove(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and profile_id = auth.uid()
$$;
revoke all on function public.push_subscription_remove(text) from public, anon;
grant execute on function public.push_subscription_remove(text) to authenticated;

-- "Remove" in the person's device list.
create or replace function public.push_subscription_remove_by_id(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_subscriptions where id = p_id and profile_id = auth.uid();
  if not found then
    raise exception 'NOT_FOUND: This device is not in your list.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.push_subscription_remove_by_id(uuid) from public, anon;
grant execute on function public.push_subscription_remove_by_id(uuid) to authenticated;

-- The person's own devices, without the keys.
create or replace function public.my_push_devices()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'createdAt', created_at, 'lastSuccessAt', last_success_at, 'active', active)
                            order by created_at desc), '[]'::jsonb)
    from public.push_subscriptions where profile_id = auth.uid()
$$;
revoke all on function public.my_push_devices() from public, anon;
grant execute on function public.my_push_devices() to authenticated;

-- The API (service role only): where to push a person's reminders.
create or replace function public.push_targets_for(p_profile uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'endpoint', endpoint, 'p256dh', p256dh, 'auth', auth) order by created_at), '[]'::jsonb)
    from public.push_subscriptions where profile_id = p_profile and active
$$;
revoke all on function public.push_targets_for(uuid) from public, anon, authenticated;
grant execute on function public.push_targets_for(uuid) to service_role;

-- The API (service role only): what happened to each push. "Gone" (404 / 410 from the push service) switches the device off.
create or replace function public.push_subscriptions_report(p_ok uuid[], p_gone uuid[], p_failed uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.push_subscriptions set last_success_at = now() where id = any(coalesce(p_ok, '{}'));
  update public.push_subscriptions set active = false, last_failure_at = now() where id = any(coalesce(p_gone, '{}'));
  update public.push_subscriptions set last_failure_at = now() where id = any(coalesce(p_failed, '{}'));
end $$;
revoke all on function public.push_subscriptions_report(uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.push_subscriptions_report(uuid[], uuid[], uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 3. What is due
-- ---------------------------------------------------------------------------
create table if not exists public.attendance_reminder_log (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  attendance_date date not null,
  kind text not null check (kind in ('PUNCH_IN', 'LUNCH', 'LUNCH_END', 'PUNCH_OUT')),
  step smallint not null check (step in (0, 1)),      -- 0 = the reminder, 1 = the one follow-up
  lunch_id uuid,                                       -- LUNCH_END: once per break
  sent_at timestamptz not null default now()
);
create unique index if not exists attendance_reminder_log_once_uidx on public.attendance_reminder_log
  (profile_id, attendance_date, kind, step, coalesce(lunch_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists attendance_reminder_log_date_idx on public.attendance_reminder_log (attendance_date);
alter table public.attendance_reminder_log enable row level security;
revoke all on public.attendance_reminder_log from public, anon, authenticated;

-- Which reminders are due at p_now (writes nothing). For each person and kind only the latest step that is due is offered (a run that
-- comes when the follow-up is already due sends the follow-up alone, not both), and only if it is at most 30 minutes late.
create or replace function private.attendance_reminders_compute(p_now timestamptz)
returns table (profile_id uuid, attendance_date date, kind text, step smallint, lunch_id uuid, due_at timestamptz, title text, body text)
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.attendance_settings;
  v_day date := (p_now at time zone 'Asia/Kolkata')::date;
  v_allow_s numeric := private.lunch_allowance() * 60;
begin
  select * into s from public.attendance_settings where id;
  if s.id is null or not s.reminders_enabled or s.reminders_paused_on = v_day
     or not (extract(isodow from v_day)::integer = any(s.reminder_days)) then
    return;
  end if;
  return query
  with staff as (
    select p.id, t.punch_in, t.lunch, t.punch_out, r.punch_in_at, r.punch_out_at,
           exists (select 1 from public.leave_requests l where l.employee_id = p.id and l.status = 'APPROVED'
                     and v_day between l.start_date and l.end_date and l.leave_type = 'FULL_DAY') as leave_full,
           exists (select 1 from public.leave_requests l where l.employee_id = p.id and l.status = 'APPROVED'
                     and v_day between l.start_date and l.end_date and l.half_day_shift = 'MORNING') as leave_morning,
           exists (select 1 from public.leave_requests l where l.employee_id = p.id and l.status = 'APPROVED'
                     and v_day between l.start_date and l.end_date and l.half_day_shift = 'AFTERNOON') as leave_afternoon,
           exists (select 1 from public.attendance_lunches l where l.profile_id = p.id and l.attendance_date = v_day) as had_lunch
      from public.profiles p
      cross join lateral private.reminder_times(p.id) t
      left join public.attendance_records r on r.profile_id = p.id and r.attendance_date = v_day
     where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN' and t.enabled
  ),
  -- the three timed reminders: when they are wanted, at what time
  timed as (
    select st.id, 'PUNCH_IN'::text as kind, st.punch_in as at_time,
           'Time to Punch In'::text as title, format('Your day starts at %s. Open Attendance to punch in.', private.hhmm(st.punch_in)) as body
      from staff st where st.punch_in_at is null and not st.leave_full and not st.leave_morning
    union all
    select st.id, 'LUNCH', st.lunch, 'Lunch time', 'Start your lunch break in Attendance when you go.'
      from staff st where st.punch_in_at is not null and st.punch_out_at is null and not st.had_lunch and not st.leave_full and not st.leave_afternoon
    union all
    select st.id, 'PUNCH_OUT', st.punch_out, 'Time to Punch Out', format('Your day ends at %s. Punch out before you leave.', private.hhmm(st.punch_out))
      from staff st where st.punch_in_at is not null and st.punch_out_at is null and not st.leave_full and not st.leave_afternoon
  ),
  steps as (
    select tm.*, g.step::smallint as step,
           ((v_day + tm.at_time) at time zone 'Asia/Kolkata') + make_interval(mins => g.step * s.reminder_follow_up_minutes) as due
      from timed tm cross join generate_series(0, 1) g(step)
  ),
  latest as (
    select distinct on (st.id, st.kind) st.* from steps st where st.due <= p_now order by st.id, st.kind, st.step desc
  ),
  -- lunch ends soon: the open break, warned once, a few minutes before the day's allowance runs out
  lunch_end as (
    select st.id, l.id as lunch_id,
           l.started_at + make_interval(secs => (v_allow_s - c.closed_s - s.reminder_lunch_warning_minutes * 60)::double precision) as due,
           (v_allow_s - c.closed_s) as left_s
      from staff st
      join public.attendance_lunches l on l.profile_id = st.id and l.attendance_date = v_day and l.ended_at is null
      cross join lateral (select coalesce(sum(extract(epoch from (x.ended_at - x.started_at))), 0) as closed_s
                            from public.attendance_lunches x where x.profile_id = st.id and x.attendance_date = v_day and x.ended_at is not null) c
     where not st.leave_full
  )
  select lt.id, v_day, lt.kind, lt.step, null::uuid, lt.due,
         lt.title || case when lt.step = 1 then ' (reminder)' else '' end, lt.body
    from latest lt where lt.due > p_now - interval '30 minutes'
  union all
  select le.id, v_day, 'LUNCH_END', 0::smallint, le.lunch_id, le.due,
         format('Lunch ends in %s minutes', s.reminder_lunch_warning_minutes), 'End your lunch break in Attendance when you are back.'
    from lunch_end le
   where le.left_s > s.reminder_lunch_warning_minutes * 60 and le.due <= p_now and le.due > p_now - interval '30 minutes';
end $$;
revoke all on function private.attendance_reminders_compute(timestamptz) from public, anon, authenticated;

-- The API's scheduled run (service role only, every 5 minutes): record each due reminder once, put it in the bell, and return it with the
-- person's devices so the API can push it. Running twice, or two runs at once, never sends a reminder twice (the unique log entry).
create or replace function public.attendance_reminders_due(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_out jsonb := '[]'::jsonb;
  v_tag text;
  v_kind text;
begin
  for r in select * from private.attendance_reminders_compute(p_now) order by due_at loop
    insert into public.attendance_reminder_log (profile_id, attendance_date, kind, step, lunch_id)
    values (r.profile_id, r.attendance_date, r.kind, r.step, r.lunch_id)
    on conflict do nothing;
    continue when not found;
    v_kind := lower(r.kind);
    v_tag := 'att-' || v_kind || '-' || r.attendance_date;
    perform private.notify(r.profile_id, 'ATTENDANCE_REMINDER', r.title, r.body, 'attendance', null,
                           jsonb_build_object('kind', r.kind, 'step', r.step, 'date', r.attendance_date), 'normal');
    v_out := v_out || jsonb_build_object('profileId', r.profile_id, 'kind', r.kind, 'step', r.step, 'title', r.title, 'body', r.body,
                                         'tag', v_tag, 'url', '/?open=attendance', 'targets', public.push_targets_for(r.profile_id));
  end loop;
  return v_out;
end $$;
revoke all on function public.attendance_reminders_due(timestamptz) from public, anon, authenticated;
grant execute on function public.attendance_reminders_due(timestamptz) to service_role;
