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
