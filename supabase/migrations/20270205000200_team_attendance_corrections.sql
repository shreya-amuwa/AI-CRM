-- =============================================================================
-- Team attendance for management, a confirmed (and explained) early Punch Out, and attendance correction requests.
-- docs/ATTENDANCE_MANAGEMENT.md. Additive and safe to run twice; no temp tables; nothing existing is changed or deleted.
--
--   1. attendance_team_overview(date, department, team, status, search): one row per employee with ONE status (no double counting):
--      SHIFT_NOT_STARTED, PRESENT, LATE, NOT_PUNCHED_IN, ABSENT, APPROVED_LEAVE, HALF_DAY, ON_BREAK, SHIFT_COMPLETED, WEEKLY_OFF, HOLIDAY,
--      and the counts by status and department. The rules are the existing ones (attendance_overview_json, the Managing Director's 11:00
--      alert): each person's day starts at their own Punch In time (else the company's), ends at their own Punch Out time; "absent" once
--      attendance_settings.absent_after_minutes have passed without a Punch In; working days and HR's "off for today" are the reminder
--      settings; approved leave from leave_requests. New: attendance_settings.late_grace_minutes (default 0 = the current rule).
--      Who sees whom (database, not the screen):
--        HR staff and the Managing Director (Super Admin): every active employee (as the register, without locations);
--        a CEO (Operations Head) and a Department Head: the employees of the departments and functions in their own scope
--          (private.scope_covers: a Support CEO never sees Sales);
--        a Team Lead: their own team;  anyone else: refused.
--      No location is returned (locations stay with HR and the Managing Director in the register).
--   2. attendance_punch_out_preview() and attendance_punch_out_confirmed(..., p_early_reason): the Punch Out dialog's figures from the
--      server (worked, break, net time, shift end) and, before the shift end, a required reason (attendance_settings
--      .early_punch_out_reason_required, default on). The Punch Out itself is the existing attendance_punch_out (same location rules,
--      idempotency and duplicate-click protection); the reason is stored with that punch (attendance_events.note) in the same transaction.
--   3. Attendance correction requests (e.g. an accidental Punch Out): the employee asks, never edits. HR staff, the Managing Director, or
--      the CEO / Department Head whose scope covers the employee decide (not the employee themself). Approving applies the correction in
--      the same transaction: "resume my day" (the Punch Out is set aside, the day is open again), a corrected Punch Out time, or a missed
--      Punch In. Every request keeps the original record, the requested change, the applied change, who decided, when and why.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------
alter table public.attendance_settings add column if not exists late_grace_minutes integer not null default 0;
alter table public.attendance_settings add column if not exists early_punch_out_reason_required boolean not null default true;
alter table public.attendance_settings add column if not exists correction_window_days integer not null default 30;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'attendance_settings_late_grace_check') then
    alter table public.attendance_settings add constraint attendance_settings_late_grace_check check (late_grace_minutes between 0 and 120);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_settings_correction_window_check') then
    alter table public.attendance_settings add constraint attendance_settings_correction_window_check check (correction_window_days between 1 and 365);
  end if;
end $$;

-- the correction requests (section 4 below); made first because the team view shows which days have one pending
create table if not exists public.attendance_correction_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  attendance_date date not null,
  kind text not null check (kind in ('RESUME_DAY', 'SET_PUNCH_OUT', 'SET_PUNCH_IN')),
  requested_time time,
  reason text not null check (length(btrim(reason)) between 5 and 1000),
  details text check (details is null or length(details) <= 2000),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  original jsonb not null default '{}'::jsonb,
  applied jsonb,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 1000),
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'RESUME_DAY' or requested_time is not null),
  unique (profile_id, client_request_id)
);
-- one open request per person and day (a retry or a second click returns the first)
create unique index if not exists attendance_correction_one_pending on public.attendance_correction_requests (profile_id, attendance_date) where status = 'PENDING';
create index if not exists attendance_correction_status_idx on public.attendance_correction_requests (status, created_at desc);
alter table public.attendance_correction_requests enable row level security;
revoke all on table public.attendance_correction_requests from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Team attendance
-- ---------------------------------------------------------------------------
-- HR staff (as private.is_hr_staff, for any person: HR department, not a recruiter) or the Super Admin
create or replace function private.is_hr_staff_profile(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p left join public.departments d on d.id = p.department_id
                  where p.id = p_profile and p.status = 'ACTIVE'
                    and (p.role = 'SUPER_ADMIN' or (d.slug = 'hr' and coalesce(p.hr_sub_role, '') <> 'HR_RECRUITER')))
$$;
revoke all on function private.is_hr_staff_profile(uuid) from public, anon, authenticated;
-- may the caller see this employee's attendance status?
create or replace function private.attendance_team_visible(p_viewer uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles v, public.profiles p
     where v.id = p_viewer and v.status = 'ACTIVE' and p.id = p_profile and p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
       and (v.role = 'SUPER_ADMIN'
            or private.is_hr_staff_profile(v.id)
            or (v.role = 'DEPARTMENT_HEAD' and p.department_id is not null
                and private.scope_covers(v.id, p.department_id, private.mms_division_of(p.id)))
            or (v.role = 'TEAM_HEAD' and v.team_id is not null and p.team_id = v.team_id)))
$$;

-- one row per employee for one office day, with a single status
create or replace function private.attendance_team_rows(p_date date, p_now timestamptz default now())
returns table (
  profile_id uuid, full_name text, avatar_url text, designation text, role text, department_id uuid, department text, team_id uuid, team text,
  team_lead text, status text, late boolean, late_minutes integer, punch_in_at timestamptz, punch_out_at timestamptz, day_start time,
  day_end time, leave text, on_break boolean, worked_minutes integer, early_out_reason text, correction_pending boolean)
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select coalesce(s.absent_after_minutes, 60) as absent_after, coalesce(s.late_grace_minutes, 0) as grace,
           private.office_working_day(p_date) as working, (s.reminders_paused_on is not distinct from p_date) as paused,
           private.office_today() as today, (p_now at time zone 'Asia/Kolkata')::time as now_t
      from (select 1) x left join public.attendance_settings s on s.id
  ),
  staff as (
    select p.id, p.full_name, p.avatar_url, p.role::text as role, p.team_id,
           coalesce(nullif(p.position, ''), (select pd.designation from public.employee_personal_details pd where pd.profile_id = p.id)) as designation,
           private.base_department(p.department_id) as dept,
           a.punch_in_at, a.punch_out_at,
           (select t.punch_in from private.reminder_times(p.id) t) as day_start,
           (select t.punch_out from private.reminder_times(p.id) t) as day_end,
           (select case when bool_or(l.leave_type = 'FULL_DAY') then 'FULL_DAY' when bool_or(l.half_day_shift = 'MORNING') then 'MORNING'
                        when bool_or(l.half_day_shift = 'AFTERNOON') then 'AFTERNOON' end
              from public.leave_requests l where l.employee_id = p.id and l.status = 'APPROVED' and p_date between l.start_date and l.end_date) as leave,
           exists (select 1 from public.attendance_lunches l where l.profile_id = p.id and l.attendance_date = p_date and l.ended_at is null) as on_break,
           (select e.note from public.attendance_events e where e.profile_id = p.id and e.attendance_date = p_date and e.kind = 'PUNCH_OUT'
             order by e.occurred_at desc, e.id desc limit 1) as out_note,
           exists (select 1 from public.attendance_correction_requests r where r.profile_id = p.id and r.attendance_date = p_date and r.status = 'PENDING') as pending
      from public.profiles p
      left join public.attendance_records a on a.profile_id = p.id and a.attendance_date = p_date
     where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
  )
  select s.id, s.full_name, s.avatar_url, s.designation, s.role, s.dept,
         (select d.name from public.departments d where d.id = s.dept), s.team_id, (select t.name from public.teams t where t.id = s.team_id),
         (select l.full_name from public.profiles l where l.id = coalesce(private.direct_lead_of(s.id), private.sole_team_lead(s.team_id)) and l.id <> s.id),
         case
           when s.punch_in_at is not null then
             case when s.punch_out_at is not null then 'SHIFT_COMPLETED'
                  when s.on_break and p_date = c.today then 'ON_BREAK'
                  when s.leave in ('MORNING', 'AFTERNOON') then 'HALF_DAY'
                  when (s.punch_in_at at time zone 'Asia/Kolkata')::time > s.day_start + make_interval(mins => c.grace) then 'LATE'
                  else 'PRESENT' end
           when s.leave in ('FULL_DAY', 'MORNING') then 'APPROVED_LEAVE'
           when not c.working then case when c.paused then 'HOLIDAY' else 'WEEKLY_OFF' end
           when p_date < c.today then 'ABSENT'
           when p_date > c.today then 'SHIFT_NOT_STARTED'
           when c.now_t < s.day_start then 'SHIFT_NOT_STARTED'
           when c.now_t < s.day_start + make_interval(mins => c.absent_after) then 'NOT_PUNCHED_IN'
           else 'ABSENT' end,
         s.punch_in_at is not null and (s.punch_in_at at time zone 'Asia/Kolkata')::time > s.day_start + make_interval(mins => c.grace),
         case when s.punch_in_at is not null and (s.punch_in_at at time zone 'Asia/Kolkata')::time > s.day_start
              then floor(extract(epoch from ((s.punch_in_at at time zone 'Asia/Kolkata')::time - s.day_start)) / 60)::integer else 0 end,
         s.punch_in_at, s.punch_out_at, s.day_start, s.day_end, s.leave, s.on_break and p_date = c.today,
         case when s.punch_in_at is null then null
              when s.punch_out_at is null and p_date < c.today then null
              else floor(extract(epoch from (coalesce(s.punch_out_at, p_now) - s.punch_in_at)) / 60)::integer end,
         case when s.out_note like 'Early Punch Out: %' then substr(s.out_note, 18) end,
         s.pending
    from staff s cross join cfg c
$$;

create or replace function public.attendance_team_overview(p_date date default null, p_department uuid default null, p_team uuid default null,
  p_status text default null, p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_today date := private.office_today();
  v_date date := coalesce(p_date, v_today);
  v_status text := nullif(upper(btrim(coalesce(p_status, ''))), '');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_result jsonb;
begin
  if me is null or not exists (select 1 from public.profiles v where v.id = me and v.status = 'ACTIVE'
       and (v.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD') or private.is_hr_staff_profile(v.id))) then
    raise exception 'FORBIDDEN: Team attendance is for managers and HR.' using errcode = '42501';
  end if;
  if v_date > v_today or v_date < v_today - 730 then
    raise exception 'VALIDATION_ERROR: Choose a date up to today (at most two years back).' using errcode = 'P0001';
  end if;
  if v_status is not null and v_status not in ('SHIFT_NOT_STARTED', 'PRESENT', 'LATE', 'NOT_PUNCHED_IN', 'ABSENT', 'APPROVED_LEAVE', 'HALF_DAY',
       'ON_BREAK', 'SHIFT_COMPLETED', 'WEEKLY_OFF', 'HOLIDAY', 'UNAVAILABLE', 'LATE_ARRIVALS', 'PUNCHED_IN') then
    raise exception 'VALIDATION_ERROR: Unknown attendance status.' using errcode = 'P0001';
  end if;
  if v_search is not null and length(v_search) > 100 then
    raise exception 'VALIDATION_ERROR: Search for at most 100 characters.' using errcode = 'P0001';
  end if;
  with mine as (
    select r.* from private.attendance_team_rows(v_date) r where private.attendance_team_visible(me, r.profile_id)
  ),
  scoped as (
    select * from mine
     where (p_department is null or department_id = private.base_department(p_department))
       and (p_team is null or team_id = p_team)
  ),
  shown as (
    select * from scoped
     where (v_search is null or full_name ilike '%' || v_search || '%' or coalesce(designation, '') ilike '%' || v_search || '%')
       and (v_status is null
            or status = v_status
            or (v_status = 'UNAVAILABLE' and status in ('ABSENT', 'NOT_PUNCHED_IN', 'APPROVED_LEAVE'))
            or (v_status = 'LATE_ARRIVALS' and late)
            or (v_status = 'PUNCHED_IN' and punch_in_at is not null))
  ),
  counts as (
    select count(*) filter (where status not in ('WEEKLY_OFF', 'HOLIDAY')) as scheduled,
           count(*) filter (where punch_in_at is not null) as present,
           count(*) filter (where status = 'ABSENT') as absent,
           count(*) filter (where status = 'NOT_PUNCHED_IN') as not_punched_in,
           count(*) filter (where status = 'SHIFT_NOT_STARTED') as not_started,
           count(*) filter (where late) as late,
           count(*) filter (where status = 'APPROVED_LEAVE') as on_leave,
           count(*) filter (where status = 'HALF_DAY') as half_day,
           count(*) filter (where status = 'ON_BREAK') as on_break,
           count(*) filter (where status = 'SHIFT_COMPLETED') as completed,
           count(*) filter (where status in ('WEEKLY_OFF', 'HOLIDAY')) as off_today,
           count(*) as total
      from scoped
  )
  select jsonb_build_object(
    'date', v_date, 'today', v_today, 'serverTime', now(), 'timeZone', 'Asia/Kolkata',
    'workingDay', private.office_working_day(v_date),
    'graceMinutes', (select coalesce(s.late_grace_minutes, 0) from public.attendance_settings s where s.id),
    'absentAfterMinutes', (select coalesce(s.absent_after_minutes, 60) from public.attendance_settings s where s.id),
    'totals', (select jsonb_build_object('total', total, 'scheduled', scheduled, 'present', present, 'absent', absent,
                 'notPunchedIn', not_punched_in, 'shiftNotStarted', not_started, 'late', late, 'onLeave', on_leave, 'halfDay', half_day,
                 'onBreak', on_break, 'shiftCompleted', completed, 'offToday', off_today) from counts),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', g.department_id, 'name', coalesce(g.department, 'No department'),
                     'total', g.n, 'available', g.available, 'present', g.present, 'unavailable', g.unavailable, 'late', g.late)
                     order by coalesce(g.department, '~'))
                   from (select department_id, department, count(*) n,
                                count(*) filter (where status in ('PRESENT', 'LATE', 'HALF_DAY')) available,
                                count(*) filter (where punch_in_at is not null) present,
                                count(*) filter (where status in ('ABSENT', 'NOT_PUNCHED_IN', 'APPROVED_LEAVE')) unavailable,
                                count(*) filter (where late) late
                           from scoped group by department_id, department) g), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(distinct jsonb_build_object('id', team_id, 'name', team, 'departmentId', department_id))
                         from mine where team_id is not null), '[]'::jsonb),
    'departmentOptions', coalesce((select jsonb_agg(distinct jsonb_build_object('id', department_id, 'name', department))
                         from mine where department_id is not null), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
               'profileId', profile_id, 'name', full_name, 'avatarUrl', avatar_url, 'designation', designation, 'role', role,
               'departmentId', department_id, 'department', department, 'teamId', team_id, 'team', team, 'teamLead', team_lead,
               'status', status, 'late', late, 'lateMinutes', late_minutes, 'punchInAt', punch_in_at, 'punchOutAt', punch_out_at,
               'dayStart', to_char(day_start, 'HH24:MI'), 'dayEnd', to_char(day_end, 'HH24:MI'), 'leave', leave, 'onBreak', on_break,
               'workedMinutes', worked_minutes, 'earlyOutReason', early_out_reason, 'correctionPending', correction_pending,
               'available', status in ('PRESENT', 'LATE', 'HALF_DAY'))
             order by case status when 'ABSENT' then 0 when 'NOT_PUNCHED_IN' then 1 when 'APPROVED_LEAVE' then 2 when 'LATE' then 3 else 4 end,
                      full_name)
             from (select * from shown limit 1000) x), '[]'::jsonb),
    'shown', (select count(*) from shown))
    into v_result;
  return v_result;
end $$;
revoke all on function private.attendance_team_visible(uuid, uuid), private.attendance_team_rows(date, timestamptz) from public, anon, authenticated;
revoke all on function public.attendance_team_overview(date, uuid, uuid, text, text) from public, anon;
grant execute on function public.attendance_team_overview(date, uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Punch Out: the figures for the confirmation, and a reason when it is before the shift end
-- ---------------------------------------------------------------------------
create or replace function private.attendance_out_figures(p_profile uuid, p_now timestamptz default now())
returns jsonb language sql stable security definer set search_path = '' as $$
  with d as (select private.office_today() as day),
       r as (select a.punch_in_at, a.punch_out_at from public.attendance_records a, d where a.profile_id = p_profile and a.attendance_date = d.day),
       t as (select x.punch_out as shift_end from private.reminder_times(p_profile) x),
       b as (select coalesce(sum(floor(extract(epoch from (coalesce(l.ended_at, p_now) - l.started_at)) / 60)), 0)::integer as break_minutes
               from public.attendance_lunches l, d where l.profile_id = p_profile and l.attendance_date = d.day)
  select jsonb_build_object(
    'serverTime', p_now, 'timeZone', 'Asia/Kolkata',
    'punchInAt', (select punch_in_at from r), 'punchedOut', (select punch_out_at is not null from r),
    'workedMinutes', (select floor(extract(epoch from (p_now - punch_in_at)) / 60)::integer from r),
    'breakMinutes', (select break_minutes from b),
    'netMinutes', greatest(coalesce((select floor(extract(epoch from (p_now - punch_in_at)) / 60)::integer from r), 0) - (select break_minutes from b), 0),
    'shiftEnd', (select to_char(shift_end, 'HH24:MI') from t),
    'early', coalesce((select (p_now at time zone 'Asia/Kolkata')::time < shift_end from t), false),
    'reasonRequired', coalesce((select (p_now at time zone 'Asia/Kolkata')::time < shift_end from t), false)
                      and coalesce((select s.early_punch_out_reason_required from public.attendance_settings s where s.id), true))
$$;
revoke all on function private.attendance_out_figures(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.attendance_punch_out_preview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.attendance_me();
begin
  return private.attendance_out_figures(me.id);
end $$;
revoke all on function public.attendance_punch_out_preview() from public, anon;
grant execute on function public.attendance_punch_out_preview() to authenticated;

-- the Punch Out after the employee confirmed it: the existing Punch Out (same location rules, the same request id is not a second punch),
-- with the reason stored on that punch when it is before the shift end
create or replace function public.attendance_punch_out_confirmed(p_location_status text, p_lat numeric, p_lng numeric, p_accuracy integer,
  p_request uuid, p_early_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.attendance_me();
  v_fig jsonb := private.attendance_out_figures(me.id);
  v_reason text := nullif(btrim(coalesce(p_early_reason, '')), '');
  v_out jsonb;
begin
  if p_request is null then
    raise exception 'VALIDATION_ERROR: The request id is missing. Reload the page and try again.' using errcode = 'P0001';
  end if;
  if v_reason is not null and length(v_reason) > 480 then
    raise exception 'VALIDATION_ERROR: Keep the reason under 480 characters.' using errcode = 'P0001';
  end if;
  -- a retry of a Punch Out already recorded needs no reason again
  if (v_fig ->> 'reasonRequired')::boolean and v_reason is null
     and not exists (select 1 from public.attendance_events e where e.profile_id = me.id and e.client_request_id = p_request) then
    raise exception 'VALIDATION_ERROR: You are punching out before your scheduled shift end (%). Say why.', v_fig ->> 'shiftEnd' using errcode = 'P0001';
  end if;
  v_out := public.attendance_punch_out(p_location_status, p_lat, p_lng, p_accuracy, p_request);
  if v_reason is not null and (v_fig ->> 'early')::boolean then
    update public.attendance_events set note = left('Early Punch Out: ' || v_reason, 500)
     where profile_id = me.id and client_request_id = p_request and kind = 'PUNCH_OUT' and note is null;
    perform private.write_audit('ATTENDANCE_EARLY_PUNCH_OUT', 'profile', me.id, me.department_id, me.team_id,
      jsonb_build_object('shiftEnd', v_fig ->> 'shiftEnd', 'reason', v_reason));
  end if;
  return v_out;
end $$;
revoke all on function public.attendance_punch_out_confirmed(text, numeric, numeric, integer, uuid, text) from public, anon;
grant execute on function public.attendance_punch_out_confirmed(text, numeric, numeric, integer, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Attendance correction requests
-- ---------------------------------------------------------------------------


-- may p_approver decide p_profile's correction? HR staff and the Managing Director; a CEO / Department Head whose scope covers them; never
-- the employee themself
create or replace function private.attendance_can_approve(p_approver uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_approver is distinct from p_profile and exists (
    select 1 from public.profiles v, public.profiles p
     where v.id = p_approver and v.status = 'ACTIVE' and p.id = p_profile
       and (v.role = 'SUPER_ADMIN' or private.is_hr_staff_profile(v.id)
            or (v.role = 'DEPARTMENT_HEAD' and p.role <> 'SUPER_ADMIN' and p.department_id is not null
                and not (p.role = 'DEPARTMENT_HEAD' and not v.is_operations_head)
                and private.scope_covers(v.id, p.department_id, private.mms_division_of(p.id)))))
$$;
revoke all on function private.attendance_can_approve(uuid, uuid) from public, anon, authenticated;

-- the signed-in person, whatever their role (private.attendance_me refuses the Super Admin, who records no attendance but may decide)
create or replace function private.attendance_actor()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  return me;
end $$;
revoke all on function private.attendance_actor() from public, anon, authenticated;

create or replace function private.attendance_correction_json(r public.attendance_correction_requests, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'profileId', r.profile_id, 'employee', (select p.full_name from public.profiles p where p.id = r.profile_id),
    'department', (select d.name from public.departments d join public.profiles p on d.id = private.base_department(p.department_id) where p.id = r.profile_id),
    'date', r.attendance_date, 'kind', r.kind, 'requestedTime', to_char(r.requested_time, 'HH24:MI'), 'reason', r.reason, 'details', r.details,
    'status', r.status, 'original', r.original, 'applied', r.applied,
    'decidedBy', (select p.full_name from public.profiles p where p.id = r.decided_by), 'decidedAt', r.decided_at, 'decisionNote', r.decision_note,
    'createdAt', r.created_at,
    'canDecide', r.status = 'PENDING' and private.attendance_can_approve(p_viewer, r.profile_id),
    'canCancel', r.status = 'PENDING' and r.profile_id = p_viewer)
$$;
revoke all on function private.attendance_correction_json(public.attendance_correction_requests, uuid) from public, anon, authenticated;

create or replace function private.attendance_record_snapshot(p_profile uuid, p_date date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'punchInAt', (select a.punch_in_at from public.attendance_records a where a.profile_id = p_profile and a.attendance_date = p_date),
    'punchOutAt', (select a.punch_out_at from public.attendance_records a where a.profile_id = p_profile and a.attendance_date = p_date),
    'punchOuts', (select count(*) from public.attendance_events e where e.profile_id = p_profile and e.attendance_date = p_date and e.kind = 'PUNCH_OUT'))
$$;
revoke all on function private.attendance_record_snapshot(uuid, date) from public, anon, authenticated;

create or replace function public.attendance_correction_request(p_date date, p_kind text, p_time time, p_reason text, p_details text, p_request uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.attendance_me();
  v_today date := private.office_today();
  v_window integer := coalesce((select s.correction_window_days from public.attendance_settings s where s.id), 30);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  rec public.attendance_records;
  r public.attendance_correction_requests;
  v uuid;
begin
  if p_request is null then
    raise exception 'VALIDATION_ERROR: The request id is missing. Reload the page and try again.' using errcode = 'P0001';
  end if;
  select * into r from public.attendance_correction_requests where profile_id = me.id and client_request_id = p_request;
  if r.id is not null then
    return private.attendance_correction_json(r, me.id);
  end if;
  if p_date is null or p_date > v_today or p_date < v_today - v_window then
    raise exception 'VALIDATION_ERROR: Choose a day up to today (at most % days back).', v_window using errcode = 'P0001';
  end if;
  if p_kind not in ('RESUME_DAY', 'SET_PUNCH_OUT', 'SET_PUNCH_IN') then
    raise exception 'VALIDATION_ERROR: Choose what should be corrected.' using errcode = 'P0001';
  end if;
  if v_reason is null or length(v_reason) < 5 or length(v_reason) > 1000 then
    raise exception 'VALIDATION_ERROR: Explain the correction (5 to 1000 characters).' using errcode = 'P0001';
  end if;
  if v_details is not null and length(v_details) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep the details under 2000 characters.' using errcode = 'P0001';
  end if;
  if p_kind <> 'RESUME_DAY' and p_time is null then
    raise exception 'VALIDATION_ERROR: Give the correct time.' using errcode = 'P0001';
  end if;
  select * into rec from public.attendance_records where profile_id = me.id and attendance_date = p_date;
  if p_kind = 'RESUME_DAY' and (p_date <> v_today or rec.punch_out_at is null) then
    raise exception 'CONFLICT: Only today''s Punch Out can be set aside so you can keep working.' using errcode = 'P0001';
  end if;
  if p_kind = 'SET_PUNCH_OUT' and rec.punch_in_at is null then
    raise exception 'CONFLICT: There is no Punch In on that day; ask for the Punch In first.' using errcode = 'P0001';
  end if;
  if p_kind = 'SET_PUNCH_OUT' and (p_date + p_time) at time zone 'Asia/Kolkata' <= rec.punch_in_at then
    raise exception 'VALIDATION_ERROR: The Punch Out must be after the Punch In.' using errcode = 'P0001';
  end if;
  if p_kind <> 'RESUME_DAY' and (p_date + p_time) at time zone 'Asia/Kolkata' > now() then
    raise exception 'VALIDATION_ERROR: The corrected time cannot be in the future.' using errcode = 'P0001';
  end if;
  if p_kind = 'SET_PUNCH_IN' and (rec.punch_in_at is not null
       or exists (select 1 from public.attendance_events e where e.profile_id = me.id and e.attendance_date = p_date and e.kind = 'PUNCH_IN')) then
    raise exception 'CONFLICT: That day already has a Punch In.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.attendance_correction_requests x where x.profile_id = me.id and x.attendance_date = p_date and x.status = 'PENDING') then
    raise exception 'CONFLICT: A correction for that day is already waiting for a decision.' using errcode = 'P0001';
  end if;
  insert into public.attendance_correction_requests (profile_id, attendance_date, kind, requested_time, reason, details, original, client_request_id)
  values (me.id, p_date, p_kind, case when p_kind <> 'RESUME_DAY' then p_time end, v_reason, v_details,
          private.attendance_record_snapshot(me.id, p_date), p_request)
  returning * into r;
  perform private.write_audit('ATTENDANCE_CORRECTION_REQUESTED', 'attendance_correction', r.id, me.department_id, me.team_id,
    jsonb_build_object('date', p_date, 'kind', p_kind, 'time', p_time));
  -- the approvers: HR staff, and the Operations Head / Department Head in charge (never the Super Admin's whole company by default)
  for v in select p.id from public.profiles p
            where p.status = 'ACTIVE' and p.id <> me.id and p.role <> 'SUPER_ADMIN'
              and private.attendance_can_approve(p.id, me.id) loop
    perform private.notify_once(v, 'ATTENDANCE_CORRECTION_REQUESTED', 'Attendance correction: ' || me.full_name,
      me.full_name || ' asks to correct ' || to_char(p_date, 'DD Mon YYYY') || ': ' || left(v_reason, 200), 'attendance_correction', r.id,
      jsonb_build_object('correctionId', r.id), 'normal');
  end loop;
  return private.attendance_correction_json(r, me.id);
end $$;

create or replace function public.attendance_correction_cancel(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.attendance_me();
  r public.attendance_correction_requests;
begin
  select * into r from public.attendance_correction_requests where id = p_id and profile_id = me.id for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Correction request not found.' using errcode = 'P0002';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'CONFLICT: This request was already %.', lower(r.status) using errcode = 'P0001';
  end if;
  update public.attendance_correction_requests set status = 'CANCELLED', updated_at = now() where id = r.id returning * into r;
  perform private.write_audit('ATTENDANCE_CORRECTION_CANCELLED', 'attendance_correction', r.id, me.department_id, me.team_id, '{}'::jsonb);
  return private.attendance_correction_json(r, me.id);
end $$;

-- p_scope MINE: my own requests; DECIDE: the requests I may decide (pending first)
create or replace function public.attendance_corrections(p_scope text default 'MINE', p_status text default null, p_limit integer default 50,
  p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.attendance_actor();
  v_status text := nullif(upper(btrim(coalesce(p_status, ''))), '');
begin
  if p_scope not in ('MINE', 'DECIDE') then
    raise exception 'VALIDATION_ERROR: Unknown list.' using errcode = 'P0001';
  end if;
  if v_status is not null and v_status not in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('items', coalesce((select jsonb_agg(private.attendance_correction_json(r, me.id) order by (r.status = 'PENDING') desc, r.created_at desc)
      from (select * from public.attendance_correction_requests x
             where (case when p_scope = 'MINE' then x.profile_id = me.id else private.attendance_can_approve(me.id, x.profile_id) end)
               and (v_status is null or x.status = v_status)
             order by (x.status = 'PENDING') desc, x.created_at desc
             limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb),
    'pending', (select count(*) from public.attendance_correction_requests x where x.status = 'PENDING'
                  and (case when p_scope = 'MINE' then x.profile_id = me.id else private.attendance_can_approve(me.id, x.profile_id) end)));
end $$;

-- approve (applied in the same transaction) or reject, with the reason
create or replace function public.attendance_correction_decide(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.attendance_actor();
  r public.attendance_correction_requests;
  rec public.attendance_records;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_at timestamptz;
  v_applied jsonb;
begin
  select * into r from public.attendance_correction_requests where id = p_id for update;
  if r.id is null or not (r.profile_id = me.id or private.attendance_can_approve(me.id, r.profile_id)) then
    raise exception 'NOT_FOUND: Correction request not found.' using errcode = 'P0002';
  end if;
  if not private.attendance_can_approve(me.id, r.profile_id) then
    raise exception 'FORBIDDEN: You cannot decide your own attendance correction.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'CONFLICT: This request was already %.', lower(r.status) using errcode = 'P0001';
  end if;
  if p_approve is null then
    raise exception 'VALIDATION_ERROR: Approve or reject.' using errcode = 'P0001';
  end if;
  if not p_approve and (v_note is null or length(v_note) < 3) then
    raise exception 'VALIDATION_ERROR: Give the reason for rejecting.' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'VALIDATION_ERROR: Keep the note under 1000 characters.' using errcode = 'P0001';
  end if;
  if p_approve then
    perform pg_advisory_xact_lock(hashtext('attendance:' || r.profile_id::text));
    select * into rec from public.attendance_records where profile_id = r.profile_id and attendance_date = r.attendance_date for update;
    v_at := case when r.requested_time is not null then (r.attendance_date + r.requested_time) at time zone 'Asia/Kolkata' end;
    if r.kind = 'RESUME_DAY' then
      if rec.punch_out_at is null then
        raise exception 'CONFLICT: The day is already open (no Punch Out to set aside).' using errcode = 'P0001';
      end if;
      -- the Punch Out events stay as they were (history); the day is open again and the next Punch Out is the effective one
      update public.attendance_records set punch_out_at = null, updated_at = now() where id = rec.id;
    elsif r.kind = 'SET_PUNCH_OUT' then
      if rec.punch_in_at is null or v_at <= rec.punch_in_at then
        raise exception 'CONFLICT: The day has no Punch In before that time any more.' using errcode = 'P0001';
      end if;
      insert into public.attendance_events (profile_id, attendance_date, kind, occurred_at, location_status, recorded_by, note)
      values (r.profile_id, r.attendance_date, 'PUNCH_OUT', v_at, 'UNAVAILABLE', me.id, left('Correction approved: ' || r.reason, 500));
      update public.attendance_records set punch_out_at = v_at, updated_at = now() where id = rec.id;
      update public.attendance_lunches set ended_at = v_at, ended_by = 'PUNCH_OUT'
       where profile_id = r.profile_id and attendance_date = r.attendance_date and ended_at is null and started_at < v_at;
    else
      if rec.punch_in_at is not null
         or exists (select 1 from public.attendance_events e where e.profile_id = r.profile_id and e.attendance_date = r.attendance_date and e.kind = 'PUNCH_IN') then
        raise exception 'CONFLICT: That day already has a Punch In.' using errcode = 'P0001';
      end if;
      insert into public.attendance_events (profile_id, attendance_date, kind, occurred_at, location_status, recorded_by, note)
      values (r.profile_id, r.attendance_date, 'PUNCH_IN', v_at, 'UNAVAILABLE', me.id, left('Correction approved: ' || r.reason, 500));
      insert into public.attendance_records (profile_id, attendance_date, punch_in_at)
      values (r.profile_id, r.attendance_date, v_at)
      on conflict (profile_id, attendance_date) do update set punch_in_at = excluded.punch_in_at, updated_at = now();
    end if;
    v_applied := private.attendance_record_snapshot(r.profile_id, r.attendance_date);
  end if;
  update public.attendance_correction_requests
     set status = case when p_approve then 'APPROVED' else 'REJECTED' end, applied = v_applied, decided_by = me.id, decided_at = now(),
         decision_note = v_note, updated_at = now()
   where id = r.id returning * into r;
  perform private.write_audit(case when p_approve then 'ATTENDANCE_CORRECTION_APPROVED' else 'ATTENDANCE_CORRECTION_REJECTED' end,
    'attendance_correction', r.id, me.department_id, me.team_id,
    jsonb_build_object('employee', r.profile_id, 'date', r.attendance_date, 'kind', r.kind, 'original', r.original, 'applied', v_applied, 'note', v_note));
  perform private.notify(r.profile_id, 'ATTENDANCE_CORRECTION_DECIDED',
    case when p_approve then 'Attendance correction approved' else 'Attendance correction rejected' end,
    to_char(r.attendance_date, 'DD Mon YYYY') || case when p_approve then ': corrected.' else ': ' || v_note end,
    'attendance_correction', r.id, jsonb_build_object('correctionId', r.id), 'normal');
  return private.attendance_correction_json(r, me.id);
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['public.attendance_correction_request(date, text, time, text, text, uuid)', 'public.attendance_correction_cancel(uuid)',
    'public.attendance_corrections(text, text, integer, integer)', 'public.attendance_correction_decide(uuid, boolean, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
