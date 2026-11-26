-- =============================================================================
-- Company-wide late marking: Late only after 10:30 India time (docs/ATTENDANCE_MANAGEMENT.md "Late marking").
-- Run after 20270210000100_unified_performance_hierarchy.sql. Safe to run twice; no temp tables; no data is changed or deleted.
--
-- The error: "Late" was worked out in two places (private.attendance_team_rows for Team attendance, the Department Head / CEO / HR /
-- Super Admin team views and their filters and counts; private.attendance_overview_json for Today's Attendance Overview and the Super
-- Admin's 11:00 alert) by comparing the Punch In with each person's own Punch In *reminder* time (else the company's 10:00) plus
-- attendance_settings.late_grace_minutes (0 by default). So a Punch In at 10:01 was Late by 1 minute, and a person who had moved their
-- reminder changed their own late rule.
--
-- The rule now, for every employee of every department, role and team (existing and future), in ONE function used by every view:
--   * official reporting time 10:00 (unchanged; the reminders, "Not punched in" and "Absent" keep using each person's day start);
--   * Late only when the Punch In (India time, to the minute) is strictly after 10:30; at or before 10:30 it is Present;
--   * the late duration counts from 10:30: 10:31 = 1 minute, 10:45 = 15, 11:00 = 30.
--   Nothing overrides it: not a department, not a personal reminder time, not attendance_settings.late_grace_minutes (kept, unused).
--
-- History: no late flag is stored anywhere. Every screen, filter, count and report recomputes it from attendance_records.punch_in_at,
-- so all past days are corrected by this migration without touching a single attendance row; approved attendance corrections (which
-- set punch_in_at / punch_out_at) and leave are preserved exactly as they are.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The one late rule
-- ---------------------------------------------------------------------------
create or replace function private.attendance_reporting_time()
returns time language sql immutable set search_path = '' as $$ select time '10:00' $$;
create or replace function private.attendance_late_after()
returns time language sql immutable set search_path = '' as $$ select time '10:30' $$;
create or replace function private.attendance_late_grace_minutes()
returns integer language sql immutable set search_path = '' as $$
  select (extract(epoch from (private.attendance_late_after() - private.attendance_reporting_time())) / 60)::integer $$;

-- Minutes late for a Punch In (0 when on time or not punched in). The Punch In is read in India time and cut to the whole minute, so
-- 10:30:59 is still 10:30 (Present) and 10:31:00 to 10:31:59 is Late by 1 minute, matching the time shown on every screen.
create or replace function private.attendance_late_minutes(p_punch_in_at timestamptz)
returns integer language sql stable set search_path = '' as $$
  select case when p_punch_in_at is null then 0
              else greatest(0, floor(extract(epoch from (date_trunc('minute', p_punch_in_at at time zone 'Asia/Kolkata')::time
                                                         - private.attendance_late_after())) / 60))::integer end
$$;
revoke all on function private.attendance_reporting_time(), private.attendance_late_after(), private.attendance_late_grace_minutes(),
  private.attendance_late_minutes(timestamptz) from public, anon, authenticated;

comment on column public.attendance_settings.late_grace_minutes is
  'Not used since 20270212000100: late marking is the company-wide rule private.attendance_late_minutes (Late only after 10:30 India time).';

-- ---------------------------------------------------------------------------
-- 2. Team attendance (managers, HR, Super Admin): same rows, the late rule from section 1
-- ---------------------------------------------------------------------------
-- one row per employee for one office day, with a single status
create or replace function private.attendance_team_rows(p_date date, p_now timestamptz default now())
returns table (
  profile_id uuid, full_name text, avatar_url text, designation text, role text, department_id uuid, department text, team_id uuid, team text,
  team_lead text, status text, late boolean, late_minutes integer, punch_in_at timestamptz, punch_out_at timestamptz, day_start time,
  day_end time, leave text, on_break boolean, worked_minutes integer, early_out_reason text, correction_pending boolean)
language sql stable security definer set search_path = '' as $$
  with cfg as (
    select coalesce(s.absent_after_minutes, 60) as absent_after,
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
                  when private.attendance_late_minutes(s.punch_in_at) > 0 then 'LATE'
                  else 'PRESENT' end
           when s.leave in ('FULL_DAY', 'MORNING') then 'APPROVED_LEAVE'
           when not c.working then case when c.paused then 'HOLIDAY' else 'WEEKLY_OFF' end
           when p_date < c.today then 'ABSENT'
           when p_date > c.today then 'SHIFT_NOT_STARTED'
           when c.now_t < s.day_start then 'SHIFT_NOT_STARTED'
           when c.now_t < s.day_start + make_interval(mins => c.absent_after) then 'NOT_PUNCHED_IN'
           else 'ABSENT' end,
         private.attendance_late_minutes(s.punch_in_at) > 0,
         private.attendance_late_minutes(s.punch_in_at),
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
    -- the company-wide late rule (private.attendance_late_minutes), for the screen's explanation; never a per-department setting
    'graceMinutes', private.attendance_late_grace_minutes(),
    'reportingTime', to_char(private.attendance_reporting_time(), 'HH24:MI'),
    'lateAfter', to_char(private.attendance_late_after(), 'HH24:MI'),
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
revoke all on function private.attendance_team_rows(date, timestamptz) from public, anon, authenticated;
revoke all on function public.attendance_team_overview(date, uuid, uuid, text, text) from public, anon;
grant execute on function public.attendance_team_overview(date, uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Today's Attendance Overview and the Super Admin's 11:00 alert: the late rule from section 1
-- ---------------------------------------------------------------------------
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
           private.attendance_late_minutes(s.punch_in_at) as late_minutes
      from staff s cross join cfg c
  )
  select jsonb_build_object(
    'date', p_date, 'today', (select today from cfg), 'workingDay', (select working from cfg), 'timeZone', 'Asia/Kolkata',
    'absentAfterMinutes', (select absent_after from cfg), 'generatedAt', p_now,
    'reportingTime', to_char(private.attendance_reporting_time(), 'HH24:MI'), 'lateAfter', to_char(private.attendance_late_after(), 'HH24:MI'),
    'graceMinutes', private.attendance_late_grace_minutes(),
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
revoke all on function private.attendance_overview_json(date, timestamptz) from public, anon, authenticated;
