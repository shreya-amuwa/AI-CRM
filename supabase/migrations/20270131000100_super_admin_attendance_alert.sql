-- =============================================================================
-- The Super Admin's 11:00 attendance alert and Today's Attendance Overview (docs/ATTENDANCE_PUNCH.md "Today's Attendance Overview").
-- Run after 20270130000100_unified_head_sales_pages.sql. Additive and safe to run twice.
--
--   * Every working day at 11:00 India time, each active Super Admin gets ONE notification "Look at today's attendance." in the CRM bell and,
--     through the existing push outbox (notification_deliveries, retries with a lease), on each of their devices. Nobody else gets it.
--     The Worker's 5-minute scheduled run asks sa_attendance_alert_generate(); the row in sa_attendance_alerts (unique per Super Admin and
--     day) is written in the same transaction as the bell notification and the delivery rows, so a retry or a second run creates nothing new.
--     Working days are the company's (attendance_settings.reminder_days, Monday to Saturday by default); HR's "off for today"
--     (reminders_paused_on: a holiday or an office closure) skips the day. Sent from 11:00 until 14:00 at the latest (a scheduler that was
--     down sends it when it comes back, never in the evening).
--   * Clicking it opens Attendance > Today's overview: Present, Absent, On leave, Not yet marked, Late, Total, and per department, with the
--     list of absent employees first (attendance_today_overview; HR and the Super Admin only, as the register).
--     - On leave: approved full-day leave, or morning half-day leave and not punched in.
--     - Late: punched in after their day start (their own Punch In time, else the company's, 10:00 by default).
--     - Absent: not punched in, not on leave, and their day start + attendance_settings.absent_after_minutes (60 by default) has passed (on a
--       working day; an earlier day: absent). Before that: Not yet marked.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings and the alert log
-- ---------------------------------------------------------------------------
alter table public.attendance_settings add column if not exists absent_after_minutes integer not null default 60;
alter table public.attendance_settings add column if not exists sa_alert_time time not null default '11:00';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_settings_absent_after_check') then
    alter table public.attendance_settings add constraint attendance_settings_absent_after_check check (absent_after_minutes between 0 and 480);
  end if;
end $$;

-- the push outbox carries this alert too (no "still due" check applies to it)
alter table public.notification_deliveries drop constraint if exists notification_deliveries_kind_check;
alter table public.notification_deliveries add constraint notification_deliveries_kind_check
  check (kind in ('ATTENDANCE_REMINDER', 'TEST', 'SA_ATTENDANCE'));

create table if not exists public.sa_attendance_alerts (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  alert_date date not null,
  -- one alert per Super Admin per office day: a retry or a second scheduled run finds it and creates nothing
  trigger_key text not null unique,
  notification_type text not null default 'SA_ATTENDANCE_OVERVIEW',
  notification_id uuid references public.notifications (id) on delete set null,
  destination text not null default '/?open=attendance&view=today' check (destination ~ '^/'),
  push_status text not null check (push_status in ('QUEUED', 'NO_DEVICE', 'PUSH_OFF')),
  devices smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (recipient_id, alert_date)
);
alter table public.sa_attendance_alerts enable row level security;
revoke all on public.sa_attendance_alerts from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Working days and the overview
-- ---------------------------------------------------------------------------
-- the company's working day: one of its days of the week, and not switched off by HR for the day (a holiday, an office closure)
create or replace function private.office_working_day(p_day date)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select extract(isodow from p_day)::integer = any(s.reminder_days) and s.reminders_paused_on is distinct from p_day
                     from public.attendance_settings s where s.id), extract(isodow from p_day)::integer between 1 and 6)
$$;

create or replace function private.attendance_overview_json(p_date date, p_now timestamptz default now())
returns jsonb language sql stable security definer set search_path = '' as $$
  with cfg as (
    select coalesce((select absent_after_minutes from public.attendance_settings where id), 60) as absent_after,
           private.office_working_day(p_date) as working,
           private.office_today() as today,
           (p_now at time zone 'Asia/Kolkata')::time as now_t
  ),
  staff as (
    select p.id, p.full_name, private.base_department(p.department_id) as dept,
           coalesce(nullif(p.position, ''), (select pd.designation from public.employee_personal_details pd where pd.profile_id = p.id)) as designation,
           a.punch_in_at, (select t.punch_in from private.reminder_times(p.id) t) as day_start,
           exists (select 1 from public.leave_requests l where l.employee_id = p.id and l.status = 'APPROVED' and p_date between l.start_date and l.end_date
                     and l.leave_type = 'FULL_DAY') as leave_full,
           exists (select 1 from public.leave_requests l where l.employee_id = p.id and l.status = 'APPROVED' and p_date between l.start_date and l.end_date
                     and l.half_day_shift = 'MORNING') as leave_morning,
           exists (select 1 from public.leave_requests l where l.employee_id = p.id and l.status = 'APPROVED' and p_date between l.start_date and l.end_date
                     and l.half_day_shift = 'AFTERNOON') as leave_afternoon
      from public.profiles p
      left join public.attendance_records a on a.profile_id = p.id and a.attendance_date = p_date
     where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
  ),
  rows as (
    select s.*, (select d.name from public.departments d where d.id = s.dept) as dept_name,
           case
             when s.punch_in_at is not null then 'PRESENT'
             when s.leave_full or s.leave_morning then 'ON_LEAVE'
             when not c.working then 'NOT_MARKED'
             when p_date < c.today then 'ABSENT'
             when p_date = c.today and c.now_t >= (s.day_start + make_interval(mins => c.absent_after)) then 'ABSENT'
             else 'NOT_MARKED' end as category,
           case when s.punch_in_at is not null and (s.punch_in_at at time zone 'Asia/Kolkata')::time > s.day_start
                then floor(extract(epoch from ((s.punch_in_at at time zone 'Asia/Kolkata')::time - s.day_start)) / 60)::integer end as late_minutes
      from staff s cross join cfg c
  )
  select jsonb_build_object(
    'date', p_date, 'today', (select today from cfg), 'workingDay', (select working from cfg), 'timeZone', 'Asia/Kolkata',
    'absentAfterMinutes', (select absent_after from cfg), 'generatedAt', p_now,
    'totals', (select jsonb_build_object('total', count(*), 'present', count(*) filter (where category = 'PRESENT'),
                 'absent', count(*) filter (where category = 'ABSENT'), 'onLeave', count(*) filter (where category = 'ON_LEAVE'),
                 'notMarked', count(*) filter (where category = 'NOT_MARKED'), 'late', count(*) filter (where late_minutes > 0)) from rows),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', dept, 'name', coalesce(dept_name, 'No department'), 'total', n, 'present', present,
                     'absent', absent, 'onLeave', on_leave, 'notMarked', not_marked, 'late', late) order by coalesce(dept_name, '~'))
                   from (select dept, dept_name, count(*) n, count(*) filter (where category = 'PRESENT') present, count(*) filter (where category = 'ABSENT') absent,
                                count(*) filter (where category = 'ON_LEAVE') on_leave, count(*) filter (where category = 'NOT_MARKED') not_marked,
                                count(*) filter (where late_minutes > 0) late
                           from rows group by dept, dept_name) g), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('profileId', id, 'name', full_name, 'designation', designation, 'departmentId', dept,
                 'department', dept_name, 'category', category, 'late', coalesce(late_minutes, 0) > 0, 'lateMinutes', coalesce(late_minutes, 0),
                 'punchInAt', punch_in_at, 'dayStart', to_char(day_start, 'HH24:MI'),
                 'leave', case when leave_full then 'FULL_DAY' when leave_morning then 'MORNING' when leave_afternoon then 'AFTERNOON' end)
               order by case category when 'ABSENT' then 0 when 'NOT_MARKED' then 1 when 'ON_LEAVE' then 2 else 3 end, full_name) from rows), '[]'::jsonb))
$$;

-- HR staff and the Super Admin (as the attendance register); reading it is audited like the register
create or replace function public.attendance_today_overview(p_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.office_today();
  v_date date := coalesce(p_date, v_today);
begin
  if not coalesce(private.is_hr_staff(), false) then
    raise exception 'FORBIDDEN: Only HR and the Super Admin see the attendance overview.' using errcode = '42501';
  end if;
  if v_date > v_today or v_date < v_today - 730 then
    raise exception 'VALIDATION_ERROR: Choose a date up to today (at most two years back).' using errcode = 'P0001';
  end if;
  perform private.write_audit('ATTENDANCE_OVERVIEW_VIEWED', 'attendance', null, null, null, jsonb_build_object('date', v_date));
  return private.attendance_overview_json(v_date);
end $$;

-- ---------------------------------------------------------------------------
-- 3. The 11:00 alert (the Worker's scheduled run, service role)
-- ---------------------------------------------------------------------------
create or replace function public.sa_attendance_alert_generate(p_now timestamptz default now(), p_push boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_day date := (p_now at time zone 'Asia/Kolkata')::date;
  v_time time := (p_now at time zone 'Asia/Kolkata')::time;
  v_at time := coalesce((select sa_alert_time from public.attendance_settings where id), '11:00');
  v_totals jsonb;
  v_body text;
  r record;
  v_alert bigint;
  v_note uuid;
  v_jobs integer;
  v_sent integer := 0;
  v_created integer := 0;
  v_no_device integer := 0;
begin
  if not private.office_working_day(v_day) then
    return jsonb_build_object('generated', 0, 'skipped', 'NOT_WORKING_DAY');
  end if;
  -- from 11:00 (India) to 14:00 at the latest: a scheduler that was down catches up, but never sends it in the evening
  if v_time < v_at or v_time >= v_at + interval '3 hours' then
    return jsonb_build_object('generated', 0, 'skipped', 'NOT_DUE');
  end if;
  v_totals := private.attendance_overview_json(v_day, p_now) -> 'totals';
  v_body := format('Absent: %s · Not yet marked: %s · On leave: %s · Present: %s of %s. Tap to open Today''s Attendance Overview.',
                   v_totals ->> 'absent', v_totals ->> 'notMarked', v_totals ->> 'onLeave', v_totals ->> 'present', v_totals ->> 'total');
  for r in select p.id from public.profiles p where p.role = 'SUPER_ADMIN' and p.status = 'ACTIVE' order by p.created_at, p.id loop
    insert into public.sa_attendance_alerts (recipient_id, alert_date, trigger_key, push_status)
    values (r.id, v_day, 'SA_ATTENDANCE:' || v_day || ':' || r.id, 'QUEUED')
    on conflict do nothing
    returning id into v_alert;
    continue when v_alert is null;   -- already sent today
    v_sent := v_sent + 1;
    insert into public.notifications (recipient_id, type, title, body, entity_type, data, priority)
    values (r.id, 'SA_ATTENDANCE_OVERVIEW', 'Look at today''s attendance.', v_body, 'attendance_overview',
            jsonb_build_object('view', 'today', 'date', v_day, 'destination', '/?open=attendance&view=today', 'totals', v_totals), 'normal')
    returning id into v_note;
    v_jobs := 0;
    if p_push then
      insert into public.notification_deliveries (kind, profile_id, subscription_id, device_label, title, body, tag, url, expires_at, next_attempt_at)
      select 'SA_ATTENDANCE', r.id, d.id, d.label, 'Look at today''s attendance.', left(v_body, 500), 'sa-attendance-' || v_day,
             '/?open=attendance&view=today', p_now + interval '3 hours', p_now
        from (select s.id, s.label from public.push_subscriptions s where s.profile_id = r.id and s.active order by s.created_at desc limit 10) d;
      get diagnostics v_jobs = row_count;
    end if;
    v_created := v_created + v_jobs;
    if p_push and v_jobs = 0 then v_no_device := v_no_device + 1; end if;
    update public.sa_attendance_alerts
       set notification_id = v_note, devices = v_jobs, push_status = case when not p_push then 'PUSH_OFF' when v_jobs = 0 then 'NO_DEVICE' else 'QUEUED' end
     where id = v_alert;
  end loop;
  return jsonb_build_object('generated', v_sent, 'jobsCreated', v_created, 'noDevice', v_no_device, 'date', v_day);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
revoke all on function private.office_working_day(date) from public, anon, authenticated;
revoke all on function private.attendance_overview_json(date, timestamptz) from public, anon, authenticated;
revoke all on function public.attendance_today_overview(date) from public, anon;
grant execute on function public.attendance_today_overview(date) to authenticated;
revoke all on function public.sa_attendance_alert_generate(timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.sa_attendance_alert_generate(timestamptz, boolean) to service_role;
