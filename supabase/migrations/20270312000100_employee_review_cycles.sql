-- =============================================================================
-- HR dashboard upgrade, Phase 1: employee confirmation reviews (docs/hr-dashboard-upgrade.md).
--
-- Extends the EXISTING probation confirmation (hr_probation_cycles, hr_email_events, hr_schedule_emails, hr_confirm_probation). Nothing new
-- replaces it:
--  * One cycle per employee and period (the existing unique key). An extension moves the SAME cycle to the next review round (review_round),
--    keeps original_end and writes hr_review_extensions; obsolete queued reminders are marked SKIPPED.
--  * The Department Head, the CEO (Operations Head) and HR each have their own evaluation (hr_review_evaluations, one per cycle, round and role);
--    every submission is copied to hr_review_evaluation_versions; a submitted report changes only after HR returns it for revision.
--  * Reminders: T-10 and T-4 (calendar days before the current confirmation date) to HR, the Department Head and the CEO, through the existing
--    e-mail queue (kinds REVIEW_FIRST / REVIEW_SECOND, one per cycle, round, stage, role and recipient) and the in-app notifications
--    (hr_review_notice_log, one per cycle, round, stage and recipient). After downtime only the current stage is sent, with the real days left.
--  * HR records the final decision (hr_review_decide): Confirm (the existing CONFIRMING -> e-mail -> APPROVED path, so paid leave and the
--    confirmation e-mails work exactly as before), Extend, Not confirmed, On hold. Both management reports are required, unless the HR
--    Department Head / Super Admin records an exceptional decision with a reason. Nothing confirms, deactivates or removes anybody by itself.
--  * The shared attendance day engine (private.att_day_rows) and the holiday calendar (office_holidays) are defined here: the review's attendance
--    summary, the attendance statement (Phase 2) and the Telecaller working days (Phase 3) all use it.
--
-- Additive and safe to run twice. Run after 20270311000100_recharge_invoices.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Holiday calendar (there was none: only HR's single "off today" date)
-- ---------------------------------------------------------------------------
create table if not exists public.office_holidays (
  day date primary key,
  name text not null check (length(btrim(name)) between 2 and 120),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.office_holidays enable row level security;
revoke all on public.office_holidays from public, anon, authenticated;

-- A working day: one of the office's working weekdays, not a holiday and not HR's "off today" date.
create or replace function private.office_working_day(p_day date)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select extract(isodow from p_day)::integer = any(s.reminder_days) and s.reminders_paused_on is distinct from p_day
                     from public.attendance_settings s where s.id), extract(isodow from p_day)::integer between 1 and 6)
     and not exists (select 1 from public.office_holidays h where h.day = p_day)
$$;
revoke all on function private.office_working_day(date) from public, anon, authenticated;

create or replace function public.office_holidays_list(p_year integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('day', h.day, 'name', h.name) order by h.day) from public.office_holidays h
                    where p_year is null or extract(year from h.day) = p_year), '[]'::jsonb);
end $$;
revoke all on function public.office_holidays_list(integer) from public, anon;
grant execute on function public.office_holidays_list(integer) to authenticated;

create or replace function public.office_holiday_set(p_day date, p_name text, p_remove boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_hr_staff() then raise exception 'FORBIDDEN: Only HR can manage the holiday calendar.' using errcode = '42501'; end if;
  if p_day is null or p_day < date '2020-01-01' or p_day > private.office_today() + 730 then
    raise exception 'VALIDATION_ERROR: Choose a date within the next two years.' using errcode = 'P0001';
  end if;
  if p_remove then
    delete from public.office_holidays where day = p_day;
  else
    if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'VALIDATION_ERROR: Name the holiday.' using errcode = 'P0001'; end if;
    insert into public.office_holidays (day, name, created_by) values (p_day, left(btrim(p_name), 120), auth.uid())
    on conflict (day) do update set name = excluded.name;
  end if;
  perform private.write_audit(case when p_remove then 'HOLIDAY_REMOVED' else 'HOLIDAY_SET' end, 'office_holiday', null, null, null,
    jsonb_build_object('day', p_day, 'name', p_name));
  return public.office_holidays_list(extract(year from p_day)::int);
end $$;
revoke all on function public.office_holiday_set(date, text, boolean) from public, anon;
grant execute on function public.office_holiday_set(date, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The attendance day engine: one row per employee and calendar day, with the existing status rules
-- ---------------------------------------------------------------------------
-- Status (one per row, nothing counted twice):
--   NOT_JOINED (before the joining date), UPCOMING (a future day), HOLIDAY, WEEKLY_OFF, APPROVED_LEAVE (full day, or morning half day without a
--   Punch In), HALF_DAY (half-day leave and punched in), LATE (punched in after the company late time), PRESENT, MISSING_PUNCH_OUT (a past day
--   punched in and never out: the hours stay empty, nothing is invented), IN_PROGRESS (today, punched in), NOT_STARTED (today, not punched in
--   yet: not an absence), ABSENT (a past working day without a Punch In).
-- scheduled = a working day the person was expected (after joining, not a holiday / weekly off). Breaks are the union of the day's lunches
-- inside the punch window (overlapping lunches are counted once); net = gross - breaks. Early departure = before the person's own day end.
create or replace function private.att_day_rows(p_from date, p_to date, p_profiles uuid[])
returns table (profile_id uuid, day date, status text, scheduled boolean, punch_in_at timestamptz, punch_out_at timestamptz,
               day_start time, day_end time, lunch_start timestamptz, lunch_end timestamptz, break_count integer, break_minutes integer,
               gross_minutes integer, net_minutes integer, late_minutes integer, early_minutes integer, leave text, holiday text,
               correction text, incomplete boolean)
language sql stable security definer set search_path = '' as $$
  with cfg as (select private.office_today() as today, (select s.reminders_paused_on from public.attendance_settings s where s.id) as paused),
  people as (
    select p.id, coalesce(x.joining_date, private.hr_safe_date((select h.joining_date from public.hr_employees h where h.profile_id = p.id limit 1))) as joined,
           t.punch_in as t_in, t.punch_out as t_out
      from public.profiles p
      left join public.employee_personal_details x on x.profile_id = p.id
      left join lateral private.reminder_times(p.id) t on true
     where p.id = any (p_profiles)
  ),
  days as (
    select pe.*, d::date as day, private.office_working_day(d::date) as working,
           (select h.name from public.office_holidays h where h.day = d::date) as holiday_name
      from people pe cross join generate_series(p_from, p_to, interval '1 day') d
  ),
  base as (
    select dy.*, a.punch_in_at, a.punch_out_at,
           (select case when bool_or(l.leave_type = 'FULL_DAY') then 'FULL_DAY' when bool_or(l.half_day_shift = 'MORNING') then 'MORNING'
                        when bool_or(l.half_day_shift = 'AFTERNOON') then 'AFTERNOON' end
              from public.leave_requests l where l.employee_id = dy.id and l.status = 'APPROVED' and dy.day between l.start_date and l.end_date) as leave,
           (select min(l.started_at) from public.attendance_lunches l where l.profile_id = dy.id and l.attendance_date = dy.day) as l_start,
           (select max(l.ended_at) from public.attendance_lunches l where l.profile_id = dy.id and l.attendance_date = dy.day) as l_end,
           (select count(*)::int from public.attendance_lunches l where l.profile_id = dy.id and l.attendance_date = dy.day) as l_count,
           (select coalesce(sum(extract(epoch from (upper(r) - lower(r)))), 0)
              from unnest((select range_agg(tstzrange(greatest(l.started_at, a.punch_in_at), least(coalesce(l.ended_at, a.punch_out_at), a.punch_out_at)))
                             from public.attendance_lunches l
                            where l.profile_id = dy.id and l.attendance_date = dy.day and a.punch_in_at is not null and a.punch_out_at is not null
                              and least(coalesce(l.ended_at, a.punch_out_at), a.punch_out_at) > greatest(l.started_at, a.punch_in_at))) r) as break_secs,
           (select r.status from public.attendance_correction_requests r where r.profile_id = dy.id and r.attendance_date = dy.day
             order by r.created_at desc limit 1) as corr
      from days dy
      left join public.attendance_records a on a.profile_id = dy.id and a.attendance_date = dy.day
  )
  select b.id, b.day,
         case
           when b.joined is not null and b.day < b.joined then 'NOT_JOINED'
           when b.punch_in_at is not null then
             case when b.punch_out_at is null and b.day < c.today then 'MISSING_PUNCH_OUT'
                  when b.punch_out_at is null then 'IN_PROGRESS'
                  when b.leave in ('MORNING', 'AFTERNOON') then 'HALF_DAY'
                  when private.attendance_late_minutes(b.punch_in_at) > 0 then 'LATE'
                  else 'PRESENT' end
           when b.day > c.today then case when b.holiday_name is not null or b.day = c.paused then 'HOLIDAY' when not b.working then 'WEEKLY_OFF' else 'UPCOMING' end
           when b.leave in ('FULL_DAY', 'MORNING') then 'APPROVED_LEAVE'
           when b.holiday_name is not null or b.day = c.paused then 'HOLIDAY'
           when not b.working then 'WEEKLY_OFF'
           when b.day = c.today then 'NOT_STARTED'
           else 'ABSENT' end,
         (b.working and (b.joined is null or b.day >= b.joined)),
         b.punch_in_at, b.punch_out_at, b.t_in, b.t_out,
         b.l_start, b.l_end, b.l_count,
         case when b.punch_out_at is null then null else floor(b.break_secs / 60)::int end,
         case when b.punch_in_at is null or b.punch_out_at is null then null else floor(extract(epoch from (b.punch_out_at - b.punch_in_at)) / 60)::int end,
         case when b.punch_in_at is null or b.punch_out_at is null then null
              else greatest(0, floor((extract(epoch from (b.punch_out_at - b.punch_in_at)) - b.break_secs) / 60))::int end,
         case when b.punch_in_at is null then 0 else private.attendance_late_minutes(b.punch_in_at) end,
         case when b.punch_out_at is null or b.t_out is null then 0
              else greatest(0, floor(extract(epoch from ((b.day + b.t_out) - (b.punch_out_at at time zone 'Asia/Kolkata'))) / 60))::int end,
         b.leave, coalesce(b.holiday_name, case when b.day = c.paused then 'Office closed' end), b.corr,
         (b.punch_in_at is not null and b.punch_out_at is null and b.day < c.today)
    from base b cross join cfg c
$$;
revoke all on function private.att_day_rows(date, date, uuid[]) from public, anon, authenticated;

-- Totals for one person over a period (the review page). Scheduled days exclude weekly offs, holidays and days before joining.
create or replace function private.att_summary(p_profile uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_profile is null or p_from is null or p_to is null or p_to < p_from then null else (
    select jsonb_build_object(
      'from', p_from, 'to', p_to,
      'workingDays', count(*) filter (where r.scheduled and r.status not in ('UPCOMING', 'NOT_STARTED')),
      'presentDays', count(*) filter (where r.status in ('PRESENT', 'LATE', 'MISSING_PUNCH_OUT', 'IN_PROGRESS'))
                     + 0.5 * count(*) filter (where r.status = 'HALF_DAY'),
      'halfDays', count(*) filter (where r.status = 'HALF_DAY'),
      'absentDays', count(*) filter (where r.status = 'ABSENT'),
      'approvedLeaveDays', count(*) filter (where r.status = 'APPROVED_LEAVE') + 0.5 * count(*) filter (where r.status = 'HALF_DAY'),
      'lateArrivals', count(*) filter (where r.late_minutes > 0 and r.punch_in_at is not null),
      'earlyDepartures', count(*) filter (where r.early_minutes > 0),
      'missingPunchOut', count(*) filter (where r.status = 'MISSING_PUNCH_OUT'),
      'discrepancies', count(*) filter (where r.status = 'MISSING_PUNCH_OUT' or r.correction = 'PENDING'),
      'netMinutes', coalesce(sum(r.net_minutes), 0),
      'breakMinutes', coalesce(sum(r.break_minutes), 0))
      from private.att_day_rows(p_from, p_to, array[p_profile]) r) end
$$;
revoke all on function private.att_summary(uuid, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The review cycle: new columns on the existing table
-- ---------------------------------------------------------------------------
alter table public.hr_probation_cycles add column if not exists cycle_type text not null default 'PROBATION';
alter table public.hr_probation_cycles drop constraint if exists hr_probation_cycles_cycle_type_check;
alter table public.hr_probation_cycles add constraint hr_probation_cycles_cycle_type_check check (cycle_type in ('PROBATION', 'INTERNSHIP'));
alter table public.hr_probation_cycles
  add column if not exists original_end date,
  add column if not exists period_months integer not null default 6,
  add column if not exists review_round integer not null default 1,
  add column if not exists employment_type text,
  add column if not exists designation text,
  add column if not exists dh_reviewer_id uuid references public.profiles (id) on delete set null,
  add column if not exists ceo_reviewer_id uuid references public.profiles (id) on delete set null,
  add column if not exists hr_reviewer_id uuid references public.profiles (id) on delete set null,
  add column if not exists review_started_at timestamptz,
  add column if not exists config_issue text,
  add column if not exists decision text,
  add column if not exists decision_reason text check (decision_reason is null or length(decision_reason) <= 4000),
  add column if not exists decided_by uuid references public.profiles (id) on delete set null,
  add column if not exists decided_at timestamptz,
  add column if not exists decision_exceptional boolean not null default false,
  add column if not exists hold_next_review date,
  add column if not exists hold_owner uuid references public.profiles (id) on delete set null,
  add column if not exists converted_from uuid references public.hr_probation_cycles (id) on delete set null,
  add column if not exists completed_on date;
update public.hr_probation_cycles set original_end = probation_end where original_end is null;
alter table public.hr_probation_cycles drop constraint if exists hr_probation_cycles_status_check;
alter table public.hr_probation_cycles add constraint hr_probation_cycles_status_check
  check (status in ('PENDING', 'CONFIRMING', 'APPROVED', 'DISMISSED', 'ON_HOLD', 'NOT_CONFIRMED', 'COMPLETED', 'CONVERTED', 'NOT_CONTINUED'));
alter table public.hr_probation_cycles drop constraint if exists hr_probation_cycles_decision_check;
alter table public.hr_probation_cycles add constraint hr_probation_cycles_decision_check
  check (decision is null or decision in ('CONFIRM', 'EXTEND', 'NOT_CONFIRM', 'HOLD', 'COMPLETE', 'CONVERT', 'NOT_CONTINUE'));
create index if not exists hr_probation_cycles_dh_idx on public.hr_probation_cycles (dh_reviewer_id) where dh_reviewer_id is not null;
create index if not exists hr_probation_cycles_ceo_idx on public.hr_probation_cycles (ceo_reviewer_id) where ceo_reviewer_id is not null;
create index if not exists hr_probation_cycles_type_idx on public.hr_probation_cycles (cycle_type, status, probation_end);

-- The evaluations (one per cycle, round and reviewer role), their submitted versions, assignment history, extensions and decisions
create table if not exists public.hr_review_evaluations (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.hr_probation_cycles (id) on delete cascade,
  round integer not null,
  reviewer_role text not null check (reviewer_role in ('DH', 'CEO', 'HR')),
  reviewer_id uuid references public.profiles (id) on delete set null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'RETURNED')),
  ratings jsonb not null default '{}'::jsonb check (jsonb_typeof(ratings) = 'object' and pg_column_size(ratings) <= 4096),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 32768),
  recommendation text,
  submitted_at timestamptz,
  returned_reason text check (returned_reason is null or length(returned_reason) <= 1000),
  returned_by uuid references public.profiles (id) on delete set null,
  returned_at timestamptz,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, round, reviewer_role)
);
alter table public.hr_review_evaluations enable row level security;
revoke all on public.hr_review_evaluations from public, anon, authenticated;

create table if not exists public.hr_review_evaluation_versions (
  id bigint generated always as identity primary key,
  evaluation_id uuid not null references public.hr_review_evaluations (id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),
  unique (evaluation_id, version)
);
alter table public.hr_review_evaluation_versions enable row level security;
revoke all on public.hr_review_evaluation_versions from public, anon, authenticated;

create table if not exists public.hr_review_assignments (
  id bigint generated always as identity primary key,
  cycle_id uuid not null references public.hr_probation_cycles (id) on delete cascade,
  round integer not null,
  reviewer_role text not null check (reviewer_role in ('DH', 'CEO', 'HR')),
  from_id uuid references public.profiles (id) on delete set null,
  to_id uuid references public.profiles (id) on delete set null,
  reason text check (reason is null or length(reason) <= 500),
  changed_by uuid references public.profiles (id) on delete set null,   -- null = assigned automatically
  created_at timestamptz not null default now()
);
create index if not exists hr_review_assignments_cycle_idx on public.hr_review_assignments (cycle_id, created_at);
alter table public.hr_review_assignments enable row level security;
revoke all on public.hr_review_assignments from public, anon, authenticated;

create table if not exists public.hr_review_extensions (
  id bigint generated always as identity primary key,
  cycle_id uuid not null references public.hr_probation_cycles (id) on delete cascade,
  from_round integer not null,
  old_end date not null,
  new_end date not null check (new_end > old_end),
  reason text not null,
  expectations text,
  decided_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (cycle_id, from_round)
);
alter table public.hr_review_extensions enable row level security;
revoke all on public.hr_review_extensions from public, anon, authenticated;

create table if not exists public.hr_review_decisions (
  id bigint generated always as identity primary key,
  cycle_id uuid not null references public.hr_probation_cycles (id) on delete cascade,
  round integer not null,
  decision text not null,
  reason text,
  details jsonb not null default '{}'::jsonb,
  exceptional boolean not null default false,
  decided_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists hr_review_decisions_cycle_idx on public.hr_review_decisions (cycle_id, created_at);
alter table public.hr_review_decisions enable row level security;
revoke all on public.hr_review_decisions from public, anon, authenticated;

-- in-app reminders: once per cycle, round, stage and recipient (e-mails are de-duplicated by hr_email_events.event_key)
create table if not exists public.hr_review_notice_log (
  cycle_id uuid not null references public.hr_probation_cycles (id) on delete cascade,
  round integer not null,
  stage text not null,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cycle_id, round, stage, recipient_id)
);
alter table public.hr_review_notice_log enable row level security;
revoke all on public.hr_review_notice_log from public, anon, authenticated;

-- the e-mail queue learns the two review reminder kinds
alter table public.hr_email_events drop constraint if exists hr_email_events_kind_check;
alter table public.hr_email_events add constraint hr_email_events_kind_check
  check (kind in ('BIRTHDAY', 'ANNIVERSARY', 'PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR', 'PROBATION_OVERDUE_HR',
                  'CONFIRMATION_EMPLOYEE', 'CONFIRMATION_HR', 'REVIEW_FIRST', 'REVIEW_SECOND'));

-- ---------------------------------------------------------------------------
-- 4. Who is who for a cycle
-- ---------------------------------------------------------------------------
-- the configured reminder time (crm_settings "hr.review_reminder_time", 'HH:MM', default 10:00 India time) on a date
create or replace function private.rv_send_time(p_date date)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select (p_date::timestamp + coalesce(
            (select case when s.value #>> '{}' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then (s.value #>> '{}')::time end
               from public.crm_settings s where s.key = 'hr.review_reminder_time'), time '10:00')) at time zone 'Asia/Kolkata'
$$;
revoke all on function private.rv_send_time(date) from public, anon, authenticated;

-- the decision-makers: the Super Admin, the HR Department Head / Team Head, the department's own HR (Department HR); never the employee
create or replace function private.rv_can_decide(c public.hr_probation_cycles)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(c.profile_id is distinct from auth.uid() and (
    private.is_super_admin()
    or exists (select 1 from public.profiles me join public.departments d on d.id = me.department_id
                where me.id = auth.uid() and me.status = 'ACTIVE' and d.slug = 'hr' and me.role in ('DEPARTMENT_HEAD', 'TEAM_HEAD'))
    or (c.department_id is not null and c.department_id = private.department_hr_scope())), false)
$$;
revoke all on function private.rv_can_decide(public.hr_probation_cycles) from public, anon, authenticated;

-- an exceptional decision (a management report missing): the HR Department Head or the Super Admin only
create or replace function private.rv_can_decide_exception()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_super_admin() or exists (
    select 1 from public.profiles me join public.departments d on d.id = me.department_id
     where me.id = auth.uid() and me.status = 'ACTIVE' and d.slug = 'hr' and me.role = 'DEPARTMENT_HEAD')
$$;
revoke all on function private.rv_can_decide_exception() from public, anon, authenticated;

-- HR side of a cycle: HR staff (not recruiters) and the department's own HR
create or replace function private.rv_is_hr_for(c public.hr_probation_cycles)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(c.profile_id is distinct from auth.uid()
     and (private.is_hr_staff() or (c.department_id is not null and c.department_id = private.department_hr_scope())), false)
$$;
revoke all on function private.rv_is_hr_for(public.hr_probation_cycles) from public, anon, authenticated;

-- who may open a cycle: HR, the assigned reviewers, the Department Heads and CEOs covering the employee's department; never the employee
create or replace function private.rv_can_view(c public.hr_probation_cycles)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(c.profile_id is distinct from auth.uid() and (
    private.rv_is_hr_for(c)
    or auth.uid() in (c.dh_reviewer_id, c.ceo_reviewer_id)
    or exists (select 1 from public.hr_review_evaluations e where e.cycle_id = c.id and e.reviewer_id = auth.uid())
    or exists (select 1 from public.profiles me
                where me.id = auth.uid() and me.status = 'ACTIVE' and me.role = 'DEPARTMENT_HEAD' and c.department_id is not null
                  and ((me.is_operations_head and private.scope_covers(me.id, c.department_id,
                          (select private.leave_employee_division(c.profile_id))))
                    or (not me.is_operations_head and private.head_covers(me.id, private.base_department(c.department_id),
                          (select p.team_id from public.profiles p where p.id = c.profile_id)))))), false)
$$;
revoke all on function private.rv_can_view(public.hr_probation_cycles) from public, anon, authenticated;

-- The default reviewers for a cycle (only empty roles are filled; a reassigned reviewer stays). A missing Department Head / CEO is recorded as a
-- configuration issue so HR sees it: the review is never silently skipped.
create or replace function private.rv_assign(p_cycle uuid)
returns public.hr_probation_cycles language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
  e public.profiles;
  v_dh uuid;
  v_ceo uuid;
  v_hr uuid;
  v_issue text[] := '{}';
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  select * into e from public.profiles where id = c.profile_id;
  if c.dh_reviewer_id is null or not exists (select 1 from public.profiles p where p.id = c.dh_reviewer_id and p.status = 'ACTIVE') then
    select h.id into v_dh from public.profiles h
     where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE' and h.id is distinct from c.profile_id
       and c.department_id is not null and private.head_covers(h.id, private.base_department(c.department_id), e.team_id)
     order by (private.base_department(h.department_id) = private.base_department(c.department_id)) desc, h.created_at limit 1;
    if v_dh is not null or c.dh_reviewer_id is not null then
      insert into public.hr_review_assignments (cycle_id, round, reviewer_role, from_id, to_id, reason)
      values (c.id, c.review_round, 'DH', c.dh_reviewer_id, v_dh, 'Assigned automatically from the department hierarchy.');
    end if;
    c.dh_reviewer_id := v_dh;
  end if;
  if c.ceo_reviewer_id is null or not exists (select 1 from public.profiles p where p.id = c.ceo_reviewer_id and p.status = 'ACTIVE') then
    -- the CEO accountable for the department and function; else the first CEO whose scope covers them
    v_ceo := case when c.department_id is null then null
                  else coalesce(private.operations_owner_for(c.department_id, private.leave_employee_division(c.profile_id)),
                                (select o.id from public.profiles o
                                  where o.role = 'DEPARTMENT_HEAD' and o.is_operations_head and o.status = 'ACTIVE' and o.id is distinct from c.profile_id
                                    and private.scope_covers(o.id, c.department_id, private.leave_employee_division(c.profile_id))
                                  order by o.created_at limit 1)) end;
    if v_ceo is not distinct from c.profile_id then v_ceo := null; end if;
    if v_ceo is not null or c.ceo_reviewer_id is not null then
      insert into public.hr_review_assignments (cycle_id, round, reviewer_role, from_id, to_id, reason)
      values (c.id, c.review_round, 'CEO', c.ceo_reviewer_id, v_ceo, 'Assigned automatically from the department hierarchy.');
    end if;
    c.ceo_reviewer_id := v_ceo;
  end if;
  if c.hr_reviewer_id is null then
    select p.id into v_hr from public.profiles p join public.departments d on d.id = p.department_id
     where d.slug = 'hr' and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.id is distinct from c.profile_id order by p.created_at limit 1;
    if v_hr is not null then
      insert into public.hr_review_assignments (cycle_id, round, reviewer_role, from_id, to_id, reason)
      values (c.id, c.review_round, 'HR', null, v_hr, 'Assigned automatically (HR Department Head).');
    end if;
    c.hr_reviewer_id := v_hr;
  end if;
  if c.dh_reviewer_id is null then v_issue := array_append(v_issue, 'NO_DEPARTMENT_HEAD'); end if;
  if c.ceo_reviewer_id is null then v_issue := array_append(v_issue, 'NO_CEO'); end if;
  update public.hr_probation_cycles
     set dh_reviewer_id = c.dh_reviewer_id, ceo_reviewer_id = c.ceo_reviewer_id, hr_reviewer_id = c.hr_reviewer_id,
         config_issue = nullif(array_to_string(v_issue, ','), ''),
         review_started_at = coalesce(review_started_at, now()),
         designation = coalesce(private.hr_designation(c.profile_id, c.hr_record_id), designation),
         employment_type = coalesce((select h.status from public.hr_employees h where h.id = c.hr_record_id), employment_type),
         updated_at = now()
   where id = c.id returning * into c;
  return c;
end $$;
revoke all on function private.rv_assign(uuid) from public, anon, authenticated;

-- the status of one role's report for the current round: NOT_STARTED, DRAFT, SUBMITTED, RETURNED (and OVERDUE when the date has passed)
create or replace function private.rv_report_status(c public.hr_probation_cycles, p_role text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when c.status in ('DISMISSED') then 'CANCELLED'
    when e.status = 'SUBMITTED' then 'SUBMITTED'
    when c.status not in ('PENDING', 'ON_HOLD') then coalesce(e.status, 'NOT_SUBMITTED')
    when c.probation_end < private.hr_today() then 'OVERDUE'
    else coalesce(e.status, 'NOT_STARTED') end
    from (select 1) x left join public.hr_review_evaluations e on e.cycle_id = c.id and e.round = c.review_round and e.reviewer_role = p_role
$$;
revoke all on function private.rv_report_status(public.hr_probation_cycles, text) from public, anon, authenticated;

-- the cycle's overall stage
create or replace function private.rv_overall(c public.hr_probation_cycles)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when c.status = 'PENDING' and c.probation_end < private.hr_today() then 'OVERDUE'
    when c.status = 'PENDING' and c.review_started_at is null then 'UPCOMING'
    when c.status = 'PENDING' and private.rv_report_status(c, 'DH') = 'SUBMITTED' and private.rv_report_status(c, 'CEO') = 'SUBMITTED' then 'AWAITING_HR_DECISION'
    when c.status = 'PENDING' then 'IN_REVIEW'
    else c.status end
$$;
revoke all on function private.rv_overall(public.hr_probation_cycles) from public, anon, authenticated;

create or replace function private.rv_person(p uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p is null then null else (select jsonb_build_object('id', x.id, 'name', x.full_name, 'active', x.status = 'ACTIVE') from public.profiles x where x.id = p) end
$$;
revoke all on function private.rv_person(uuid) from public, anon, authenticated;

-- one list row
create or replace function private.rv_row(c public.hr_probation_cycles)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'cycleType', c.cycle_type, 'profileId', c.profile_id, 'employeeName', c.employee_name, 'employeeCode', c.employee_code,
    'departmentId', c.department_id, 'department', c.department_name,
    'designation', coalesce(c.designation, private.hr_designation(c.profile_id, c.hr_record_id)),
    'employmentType', coalesce(c.employment_type, (select h.status from public.hr_employees h where h.id = c.hr_record_id)),
    'joiningDate', c.joining_date, 'periodMonths', c.period_months, 'originalEnd', c.original_end, 'dueDate', c.probation_end,
    'daysLeft', c.probation_end - private.hr_today(), 'round', c.review_round, 'status', c.status, 'overall', private.rv_overall(c),
    'reviewStarted', c.review_started_at is not null, 'configIssue', c.config_issue,
    'dh', jsonb_build_object('reviewer', private.rv_person(c.dh_reviewer_id), 'status', private.rv_report_status(c, 'DH')),
    'ceo', jsonb_build_object('reviewer', private.rv_person(c.ceo_reviewer_id), 'status', private.rv_report_status(c, 'CEO')),
    'hr', jsonb_build_object('reviewer', private.rv_person(c.hr_reviewer_id), 'status', private.rv_report_status(c, 'HR')),
    'decision', c.decision, 'decidedAt', c.decided_at, 'holdNextReview', c.hold_next_review,
    'extensionCount', (select count(*) from public.hr_review_extensions x where x.cycle_id = c.id))
$$;
revoke all on function private.rv_row(public.hr_probation_cycles) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Opening cycles and the reminders (called by the existing daily planner)
-- ---------------------------------------------------------------------------
-- Probation cycles exactly as before (6 calendar months; recent joiners and everyone marked "Training / Probation"; interns have none here).
-- 20270312000500 (Phase 4) adds the internship cycles to this function.
create or replace function private.rv_open_cycles(p_today date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  e record;
  v_end date;
  v_rows integer;
  v_n integer := 0;
begin
  for e in select * from private.hr_mail_employees() m
            where m.is_active and m.joining_date is not null and m.joining_date <= p_today and coalesce(m.hr_status, '') <> 'Intern' loop
    v_end := (e.joining_date + interval '6 months')::date;
    if coalesce(e.hr_status, '') = 'Training / Probation' or v_end >= p_today - 30 then
      insert into public.hr_probation_cycles (employee_key, profile_id, hr_record_id, employee_name, employee_email, employee_code,
                                              department_id, department_name, joining_date, probation_end, original_end, period_months, cycle_type,
                                              employment_type)
      values (e.employee_key, e.profile_id, e.hr_record_id, e.full_name, e.email, e.employee_code, e.department_id, e.department_name,
              e.joining_date, v_end, v_end, 6, 'PROBATION', coalesce(e.hr_status, 'Full-Time'))
      on conflict (employee_key, joining_date) do update
         set employee_name = excluded.employee_name, employee_email = excluded.employee_email, employee_code = excluded.employee_code,
             department_id = excluded.department_id, department_name = excluded.department_name, hr_record_id = excluded.hr_record_id, updated_at = now()
       where public.hr_probation_cycles.status = 'PENDING'
         and (public.hr_probation_cycles.employee_name, public.hr_probation_cycles.employee_email, public.hr_probation_cycles.employee_code,
              public.hr_probation_cycles.department_name) is distinct from (excluded.employee_name, excluded.employee_email, excluded.employee_code, excluded.department_name);
      get diagnostics v_rows = row_count;
      v_n := v_n + v_rows;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function private.rv_open_cycles(date) from public, anon, authenticated;

-- The e-mail and in-app reminder of one stage to everyone concerned. Stage FIRST = 5 to 10 days left, SECOND = 0 to 4 days left (a cycle found
-- late gets the stage it is in, with the real number of days; after downtime only the current stage goes out).
create or replace function private.rv_remind(c public.hr_probation_cycles, p_stage text, p_today date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_left integer := c.probation_end - p_today;
  v_kind text := case p_stage when 'FIRST' then 'REVIEW_FIRST' else 'REVIEW_SECOND' end;
  v_base jsonb;
  r record;
  v_n integer := 0;
  v_new boolean;
  v_title text;
  v_body text;
  v_intern boolean := c.cycle_type = 'INTERNSHIP';
begin
  v_base := jsonb_build_object(
    'cycleType', c.cycle_type, 'stage', p_stage, 'employeeName', c.employee_name, 'employeeCode', c.employee_code,
    'department', coalesce(c.department_name, ''), 'designation', coalesce(c.designation, private.hr_designation(c.profile_id, c.hr_record_id), 'Not recorded'),
    'employmentType', coalesce(c.employment_type, case when v_intern then 'Intern' else 'Full-Time' end),
    'joiningDate', c.joining_date, 'periodMonths', c.period_months, 'probationEndDate', c.probation_end, 'daysLeft', v_left,
    'round', c.review_round, 'configIssue', c.config_issue, 'reportingManager', private.hr_reporting_manager(c.profile_id),
    'dhStatus', private.rv_report_status(c, 'DH'), 'ceoStatus', private.rv_report_status(c, 'CEO'), 'hrStatus', private.rv_report_status(c, 'HR'),
    'reviewPath', '/?review=' || c.id);
  -- the recipients: HR (the HR copy addresses), the assigned Department Head and CEO
  for r in
    select 'HR'::text as role, n.email, n.name, (select p.id from public.profiles p where lower(p.email) = n.email and p.status = 'ACTIVE' limit 1) as pid
      from private.hr_notify_recipients() n where n.email is distinct from c.employee_email
       -- an HR person who is also this cycle's Department Head / CEO reviewer gets the reviewer's copy only
       and not exists (select 1 from public.profiles x where x.id in (c.dh_reviewer_id, c.ceo_reviewer_id) and x.status = 'ACTIVE' and lower(x.email) = n.email)
    union all
    select 'DH', lower(p.email), p.full_name, p.id from public.profiles p where p.id = c.dh_reviewer_id and p.status = 'ACTIVE'
    union all
    select 'CEO', lower(p.email), p.full_name, p.id from public.profiles p where p.id = c.ceo_reviewer_id and p.status = 'ACTIVE'
  loop
    if r.email is not null then
      v_new := private.hr_enqueue(v_kind || ':' || c.id || ':' || c.review_round || ':' || r.role || ':' || r.email, v_kind, c.employee_key, c.profile_id, c.id,
                r.email, r.name, v_base || jsonb_build_object('recipientRole', r.role, 'recipientName', r.name,
                  'ownStatus', case r.role when 'HR' then private.rv_report_status(c, 'HR') else private.rv_report_status(c, r.role) end),
                p_today, greatest(now(), private.rv_send_time(p_today)));
      if v_new then v_n := v_n + 1; end if;
    end if;
    if r.pid is not null and r.pid is distinct from c.profile_id then
      insert into public.hr_review_notice_log (cycle_id, round, stage, recipient_id) values (c.id, c.review_round, p_stage, r.pid) on conflict do nothing;
      if found then
        v_title := case when v_intern then 'Internship review: ' else 'Confirmation review: ' end || c.employee_name || ' — ' ||
                   case when v_left = 0 then 'due today' else v_left || ' day' || case when v_left = 1 then '' else 's' end || ' remaining' end;
        v_body := case
          when r.role = 'HR' then 'The review has started. Department Head: ' || lower(replace(private.rv_report_status(c, 'DH'), '_', ' ')) ||
                                  ', CEO: ' || lower(replace(private.rv_report_status(c, 'CEO'), '_', ' ')) || '.'
          when private.rv_report_status(c, r.role) = 'SUBMITTED' then 'Your evaluation has been submitted. Thank you.'
          else 'Please submit your evaluation before ' || to_char(c.probation_end, 'DD Mon YYYY') || '.' end;
        perform private.notify(r.pid, 'EMPLOYEE_REVIEW_REMINDER', v_title, v_body, 'hr_review', c.id,
          jsonb_build_object('cycleId', c.id, 'stage', p_stage, 'daysLeft', v_left, 'role', r.role), case when v_left <= 4 then 'urgent' else 'normal' end);
      end if;
      -- a missing reviewer is a configuration problem HR must see (once per problem)
      if r.role = 'HR' and c.config_issue is not null then
        insert into public.hr_review_notice_log (cycle_id, round, stage, recipient_id) values (c.id, c.review_round, 'ISSUE:' || c.config_issue, r.pid) on conflict do nothing;
        if found then
          perform private.notify(r.pid, 'EMPLOYEE_REVIEW_CONFIG', 'Reviewer missing: ' || c.employee_name,
            'Reviewer missing (' || replace(replace(c.config_issue, 'NO_DEPARTMENT_HEAD', 'no Department Head'), 'NO_CEO', 'no CEO') || '). Assign one in the review.',
            'hr_review', c.id, jsonb_build_object('cycleId', c.id, 'issue', c.config_issue), 'urgent');
        end if;
      end if;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function private.rv_remind(public.hr_probation_cycles, text, date) from public, anon, authenticated;

-- every open cycle: start the review 10 days before, send the current stage, put on-hold cases back in front of HR on their next review date
create or replace function private.rv_reminders(p_today date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
  v_left integer;
  v_n integer := 0;
  v_started integer := 0;
  r record;
begin
  for c in select * from public.hr_probation_cycles x where x.status = 'PENDING' and x.probation_end between p_today and p_today + 10 order by x.probation_end loop
    if not exists (select 1 from private.hr_mail_employees() m where m.employee_key = c.employee_key and m.is_active) then
      continue;   -- inactive / left: no reviews (the planner closes the cycle)
    end if;
    if c.review_started_at is null or c.config_issue is not null
       or exists (select 1 from unnest(array[c.dh_reviewer_id, c.ceo_reviewer_id]) x
                   where x is not null and not exists (select 1 from public.profiles p where p.id = x and p.status = 'ACTIVE')) then
      c := private.rv_assign(c.id);
      v_started := v_started + 1;
    end if;
    v_left := c.probation_end - p_today;
    v_n := v_n + private.rv_remind(c, case when v_left >= 5 then 'FIRST' else 'SECOND' end, p_today);
  end loop;
  -- a decision on hold comes back to HR (and whoever owns it) on its next review date
  for c in select * from public.hr_probation_cycles x where x.status = 'ON_HOLD' and x.hold_next_review <= p_today loop
    for r in select distinct x as pid from unnest(array[c.hold_owner, c.hr_reviewer_id]) x where x is not null loop
      insert into public.hr_review_notice_log (cycle_id, round, stage, recipient_id) values (c.id, c.review_round, 'HOLD:' || c.hold_next_review, r.pid)
      on conflict do nothing;
      if found then
        perform private.notify(r.pid, 'EMPLOYEE_REVIEW_HOLD_DUE', 'Decision on hold due: ' || c.employee_name,
          'The decision was put on hold until ' || to_char(c.hold_next_review, 'DD Mon YYYY') || '. Please record the final decision.',
          'hr_review', c.id, jsonb_build_object('cycleId', c.id), 'urgent');
      end if;
    end loop;
  end loop;
  return jsonb_build_object('reviewsStarted', v_started, 'reviewReminders', v_n);
end $$;
revoke all on function private.rv_reminders(date) from public, anon, authenticated;

-- The daily planner (latest definition from 20261115000100). Birthdays, anniversaries and the employee's own 7-day reminder are unchanged; HR's old
-- 7-day copy is replaced by the T-10 / T-4 review reminders to HR, the Department Head and the CEO. Reminder keys of a later round carry the round,
-- so an extended cycle is reminded again.
create or replace function public.hr_schedule_emails(p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := coalesce(p_today, private.hr_today());
  e record;
  c record;
  r record;
  d integer;
  v_occ date;
  v_n integer;
  v_birthdays integer := 0;
  v_anniversaries integer := 0;
  v_cycles integer := 0;
  v_reminders integer := 0;
  v_overdue integer := 0;
  v_new boolean;
  v_rv jsonb;
  v_sfx text;
begin
  -- 3a. Birthdays and work anniversaries: today, and the two days before (a run that was missed still sends, late but once).
  for e in select * from private.hr_mail_employees() m where m.is_active loop
    for d in 0..2 loop
      v_occ := v_today - d;
      if e.date_of_birth is not null and e.date_of_birth <= v_occ
         and private.hr_occasion_date(e.date_of_birth, extract(year from v_occ)::int) = v_occ then
        v_new := private.hr_enqueue('BIRTHDAY:' || e.employee_key || ':' || extract(year from v_occ)::int, 'BIRTHDAY', e.employee_key, e.profile_id, null,
                  e.email, e.full_name, jsonb_build_object('employeeName', e.full_name), v_occ, private.hr_nine_am(v_occ));
        if v_new then v_birthdays := v_birthdays + 1; end if;
      end if;
      if e.joining_date is not null and extract(year from v_occ) > extract(year from e.joining_date)
         and private.hr_occasion_date(e.joining_date, extract(year from v_occ)::int) = v_occ then
        v_new := private.hr_enqueue('ANNIVERSARY:' || e.employee_key || ':' || (extract(year from v_occ)::int - extract(year from e.joining_date)::int),
                  'ANNIVERSARY', e.employee_key, e.profile_id, null, e.email, e.full_name,
                  jsonb_build_object('employeeName', e.full_name, 'years', extract(year from v_occ)::int - extract(year from e.joining_date)::int),
                  v_occ, private.hr_nine_am(v_occ));
        if v_new then v_anniversaries := v_anniversaries + 1; end if;
      end if;
    end loop;
  end loop;

  -- 3b. Close the cycles nobody needs any more (not decided yet only) ...
  update public.hr_probation_cycles pc
     set status = 'DISMISSED', decision_note = 'Closed automatically: the employee is no longer active.', updated_at = now()
   where pc.status in ('PENDING', 'ON_HOLD')
     and not exists (select 1 from private.hr_mail_employees() m where m.employee_key = pc.employee_key and m.is_active);
  update public.hr_probation_cycles pc
     set status = 'DISMISSED', decision_note = 'Closed automatically: the joining date was changed.', updated_at = now()
   where pc.status = 'PENDING' and pc.converted_from is null and pc.review_round = 1
     and exists (select 1 from private.hr_mail_employees() m where m.employee_key = pc.employee_key and m.joining_date is distinct from pc.joining_date);
  update public.hr_email_events ev
     set status = 'SKIPPED', last_error = 'The review was closed.', updated_at = now()
   where ev.kind in ('REVIEW_FIRST', 'REVIEW_SECOND', 'PROBATION_REMINDER_EMPLOYEE', 'PROBATION_OVERDUE_HR') and ev.status in ('PENDING', 'RETRY', 'DRY_RUN')
     and exists (select 1 from public.hr_probation_cycles pc where pc.id = ev.cycle_id and pc.status = 'DISMISSED');

  -- ... and open the new ones.
  v_cycles := private.rv_open_cycles(v_today);

  -- 3c. The employee's own 7-day reminder (probation only) and HR's weekly overdue reminder.
  for c in select * from public.hr_probation_cycles pc where pc.status = 'PENDING' loop
    v_sfx := case when c.review_round > 1 then ':R' || c.review_round else '' end;
    if c.cycle_type = 'PROBATION' and v_today >= c.probation_end - 7 and v_today <= c.probation_end then
      v_new := private.hr_enqueue('PROBATION_REMINDER_EMPLOYEE:' || c.id || v_sfx, 'PROBATION_REMINDER_EMPLOYEE', c.employee_key, c.profile_id, c.id,
                c.employee_email, c.employee_name,
                jsonb_build_object('employeeName', c.employee_name, 'probationEndDate', c.probation_end, 'daysLeft', c.probation_end - v_today),
                greatest(c.probation_end - 7, v_today), private.hr_nine_am(greatest(c.probation_end - 7, v_today)));
      if v_new then v_reminders := v_reminders + 1; end if;
    elsif v_today > c.probation_end then
      -- still not decided after the date: HR is reminded weekly (at most 8 times); nobody is confirmed
      v_n := least(7, (v_today - c.probation_end - 1) / 7);
      for r in select * from private.hr_notify_recipients() n where n.email is distinct from c.employee_email loop
        v_new := private.hr_enqueue('PROBATION_OVERDUE_HR:' || c.id || v_sfx || ':' || v_n || ':' || r.email, 'PROBATION_OVERDUE_HR', c.employee_key, c.profile_id, c.id,
                  r.email, r.name,
                  jsonb_build_object('employeeName', c.employee_name, 'employeeCode', c.employee_code, 'department', coalesce(c.department_name, ''),
                                     'joiningDate', c.joining_date, 'probationEndDate', c.probation_end, 'daysOverdue', v_today - c.probation_end,
                                     'cycleType', c.cycle_type),
                  v_today, private.hr_nine_am(v_today));
        if v_new then v_overdue := v_overdue + 1; end if;
      end loop;
    end if;
  end loop;

  -- 3d. The confirmation / internship reviews (T-10, T-4) to HR, the Department Head and the CEO.
  v_rv := private.rv_reminders(v_today);
  v_reminders := v_reminders + coalesce((v_rv ->> 'reviewReminders')::int, 0);

  insert into public.hr_automation_state (key, value, updated_at)
  values ('last_schedule', jsonb_build_object('ranAt', now(), 'day', v_today, 'birthdays', v_birthdays, 'anniversaries', v_anniversaries,
                                              'cyclesOpened', v_cycles, 'reminders', v_reminders, 'overdueReminders', v_overdue,
                                              'reviewsStarted', v_rv -> 'reviewsStarted'), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return jsonb_build_object('day', v_today, 'birthdays', v_birthdays, 'anniversaries', v_anniversaries, 'cyclesOpened', v_cycles,
                            'reminders', v_reminders, 'overdueReminders', v_overdue, 'reviewsStarted', v_rv -> 'reviewsStarted');
end $$;
revoke all on function public.hr_schedule_emails(date) from public, anon, authenticated;
grant execute on function public.hr_schedule_emails(date) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Reading: the list (HR / Department HR / reviewers), my queue (Department Head, CEO), one review
-- ---------------------------------------------------------------------------
-- Filters (all optional): type (PROBATION | INTERNSHIP), departmentId, employee (text), from, to (due date), status (overall), pendingRole
-- (DH | CEO | HR), window (UPCOMING | DUE_10 | DUE_4 | OVERDUE | COMPLETED | PENDING_DECISION | EXTENDED | CONFIRMED).
create or replace function public.hr_reviews_list(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_today date := private.hr_today();
  v_type text := nullif(f ->> 'type', '');
  v_dept uuid := case when f ->> 'departmentId' ~* '^[0-9a-f-]{36}$' then (f ->> 'departmentId')::uuid end;
  v_q text := nullif(btrim(coalesce(f ->> 'employee', '')), '');
  v_from date := case when f ->> 'from' ~ '^\d{4}-\d{2}-\d{2}$' then (f ->> 'from')::date end;
  v_to date := case when f ->> 'to' ~ '^\d{4}-\d{2}-\d{2}$' then (f ->> 'to')::date end;
  v_status text := nullif(f ->> 'status', '');
  v_pending text := nullif(f ->> 'pendingRole', '');
  v_window text := nullif(f ->> 'window', '');
  v_rows jsonb;
  v_cards jsonb;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501'; end if;
  if v_type is not null and v_type not in ('PROBATION', 'INTERNSHIP') then raise exception 'VALIDATION_ERROR: Unknown review type.' using errcode = 'P0001'; end if;
  with visible as (
    select c.*, private.rv_overall(c) as overall, private.rv_report_status(c, 'DH') as dh_s, private.rv_report_status(c, 'CEO') as ceo_s,
           exists (select 1 from public.hr_review_extensions x where x.cycle_id = c.id) as was_extended
      from public.hr_probation_cycles c
     where private.rv_can_view(c)
       and (c.status in ('PENDING', 'ON_HOLD', 'CONFIRMING') or c.updated_at > now() - interval '180 days')
  ),
  filtered as (
    select * from visible v
     where (v_type is null or v.cycle_type = v_type)
       and (v_dept is null or v.department_id = v_dept)
       and (v_q is null or v.employee_name ilike '%' || v_q || '%' or v.employee_code ilike '%' || v_q || '%')
       and (v_from is null or v.probation_end >= v_from) and (v_to is null or v.probation_end <= v_to)
       and (v_status is null or v.overall = v_status)
       and (v_pending is null
         or (v_pending in ('DH', 'CEO') and v.status = 'PENDING' and v.review_started_at is not null
             and (case v_pending when 'DH' then v.dh_s else v.ceo_s end) <> 'SUBMITTED')
         or (v_pending = 'HR' and v.overall in ('AWAITING_HR_DECISION', 'OVERDUE', 'ON_HOLD')))
       and (v_window is null
         or (v_window = 'UPCOMING' and v.status = 'PENDING' and v.probation_end >= v_today)
         or (v_window = 'DUE_10' and v.status = 'PENDING' and v.probation_end between v_today and v_today + 10)
         or (v_window = 'DUE_4' and v.status = 'PENDING' and v.probation_end between v_today and v_today + 4)
         or (v_window = 'OVERDUE' and v.overall = 'OVERDUE')
         or (v_window = 'PENDING_DECISION' and v.overall in ('AWAITING_HR_DECISION', 'OVERDUE', 'ON_HOLD'))
         or (v_window = 'EXTENDED' and v.was_extended)
         or (v_window = 'CONFIRMED' and v.status in ('APPROVED', 'CONFIRMING', 'COMPLETED', 'CONVERTED'))
         or (v_window = 'COMPLETED' and v.status not in ('PENDING', 'ON_HOLD')))
  )
  select
    (select coalesce(jsonb_agg(private.rv_row(pc) order by (pc.status in ('PENDING', 'ON_HOLD')) desc, pc.probation_end), '[]'::jsonb)
       from (select id from filtered order by (status in ('PENDING', 'ON_HOLD')) desc, probation_end limit 500) x
       join public.hr_probation_cycles pc on pc.id = x.id),
    (select jsonb_build_object(
      'upcoming', count(*) filter (where v.status = 'PENDING' and v.probation_end >= v_today and v.cycle_type = 'PROBATION'),
      'due10', count(*) filter (where v.status = 'PENDING' and v.probation_end between v_today and v_today + 10 and v.cycle_type = 'PROBATION'),
      'due4', count(*) filter (where v.status = 'PENDING' and v.probation_end between v_today and v_today + 4 and v.cycle_type = 'PROBATION'),
      'pendingDh', count(*) filter (where v.status = 'PENDING' and v.review_started_at is not null and v.dh_s <> 'SUBMITTED'),
      'pendingCeo', count(*) filter (where v.status = 'PENDING' and v.review_started_at is not null and v.ceo_s <> 'SUBMITTED'),
      'pendingHr', count(*) filter (where v.overall in ('AWAITING_HR_DECISION', 'OVERDUE', 'ON_HOLD')),
      'overdue', count(*) filter (where v.overall = 'OVERDUE'),
      'confirmed', count(*) filter (where v.status in ('APPROVED', 'CONFIRMING') and v.cycle_type = 'PROBATION'),
      'extended', count(*) filter (where v.was_extended),
      'internshipsUpcoming', count(*) filter (where v.status = 'PENDING' and v.probation_end >= v_today and v.cycle_type = 'INTERNSHIP'),
      'configIssues', count(*) filter (where v.status = 'PENDING' and v.config_issue is not null))
       from visible v)
    into v_rows, v_cards;

  return jsonb_build_object('today', v_today, 'cards', v_cards, 'rows', v_rows,
    'canManage', private.is_hr_staff() or private.department_hr_scope() is not null,
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name)
                               from public.departments d where d.id in (select distinct department_id from public.hr_probation_cycles c where private.rv_can_view(c))), '[]'::jsonb));
end $$;
revoke all on function public.hr_reviews_list(jsonb) from public, anon;
grant execute on function public.hr_reviews_list(jsonb) to authenticated;

-- An evaluation as its reader may see it (HR and decision-makers see every report; a reviewer sees their own; nobody else)
create or replace function private.rv_eval_json(e public.hr_review_evaluations)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', e.id, 'round', e.round, 'role', e.reviewer_role, 'reviewer', private.rv_person(e.reviewer_id), 'status', e.status,
    'ratings', e.ratings, 'answers', e.answers, 'recommendation', e.recommendation, 'submittedAt', e.submitted_at, 'version', e.version,
    'returnedReason', e.returned_reason, 'returnedAt', e.returned_at, 'returnedBy', private.rv_person(e.returned_by), 'updatedAt', e.updated_at,
    'versions', (select count(*) from public.hr_review_evaluation_versions v where v.evaluation_id = e.id))
$$;
revoke all on function private.rv_eval_json(public.hr_review_evaluations) from public, anon, authenticated;

-- The employee's work in the period: tasks (work_tasks), where there are any; nothing is shown as zero performance when there is no data
create or replace function private.rv_work_summary(p_profile uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_profile is null then null
    when not exists (select 1 from public.work_tasks t where t.assignee_id = p_profile and t.created_at::date between p_from and p_to) then null
    else (select jsonb_build_object('assigned', count(*), 'completed', count(*) filter (where t.status = 'COMPLETED'),
                   'pending', count(*) filter (where t.status in ('ASSIGNED', 'IN_PROGRESS')),
                   'notCompleted', count(*) filter (where t.status = 'NOT_COMPLETED'),
                   'overdue', count(*) filter (where t.status in ('ASSIGNED', 'IN_PROGRESS') and t.due_date < private.hr_today()))
            from public.work_tasks t where t.assignee_id = p_profile and t.created_at::date between p_from and p_to) end
$$;
revoke all on function private.rv_work_summary(uuid, date, date) from public, anon, authenticated;

create or replace function public.hr_review_detail(p_cycle uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
  v_hr boolean;
  v_decider boolean;
  v_role text;
  v_from date;
  v_to date;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle;
  if c.id is null or not private.rv_can_view(c) then raise exception 'NOT_FOUND: Review not found.' using errcode = 'P0001'; end if;
  v_hr := private.rv_is_hr_for(c);
  v_decider := private.rv_can_decide(c);
  v_role := case when auth.uid() = c.dh_reviewer_id then 'DH' when auth.uid() = c.ceo_reviewer_id then 'CEO'
                 when v_hr then 'HR' end;
  v_from := c.joining_date;
  v_to := least(private.hr_today(), c.probation_end);
  return private.rv_row(c) || jsonb_build_object(
    'myRole', v_role, 'isHr', v_hr, 'canDecide', v_decider and c.status in ('PENDING', 'ON_HOLD'),
    'canDecideException', private.rv_can_decide_exception(),
    'canReassign', v_hr and c.status in ('PENDING', 'ON_HOLD'),
    'employee', jsonb_build_object('name', c.employee_name, 'code', c.employee_code, 'email', case when v_hr then c.employee_email end,
       'department', c.department_name, 'designation', coalesce(c.designation, private.hr_designation(c.profile_id, c.hr_record_id)),
       'employmentType', coalesce(c.employment_type, (select h.status from public.hr_employees h where h.id = c.hr_record_id)),
       'joiningDate', c.joining_date, 'periodMonths', c.period_months, 'originalEnd', c.original_end, 'currentEnd', c.probation_end,
       'team', (select t.name from public.profiles p join public.teams t on t.id = p.team_id where p.id = c.profile_id),
       'salesSubRole', (select p.sales_sub_role from public.profiles p where p.id = c.profile_id)),
    'attendance', private.att_summary(c.profile_id, v_from, v_to),
    'work', private.rv_work_summary(c.profile_id, v_from, v_to),
    -- every report for HR and the decision-makers; a reviewer sees only their own
    'evaluations', coalesce((select jsonb_agg(private.rv_eval_json(e) order by e.round desc, e.reviewer_role)
                               from public.hr_review_evaluations e
                              where e.cycle_id = c.id and (v_hr or v_decider or e.reviewer_id = auth.uid())), '[]'::jsonb),
    'extensions', coalesce((select jsonb_agg(jsonb_build_object('fromRound', x.from_round, 'oldEnd', x.old_end, 'newEnd', x.new_end, 'reason', x.reason,
                               'expectations', x.expectations, 'by', private.rv_person(x.decided_by), 'at', x.created_at) order by x.created_at)
                              from public.hr_review_extensions x where x.cycle_id = c.id and (v_hr or v_decider)), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('round', x.round, 'decision', x.decision, 'reason', x.reason, 'details', x.details,
                               'exceptional', x.exceptional, 'by', private.rv_person(x.decided_by), 'at', x.created_at) order by x.created_at)
                              from public.hr_review_decisions x where x.cycle_id = c.id and (v_hr or v_decider)), '[]'::jsonb),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('round', x.round, 'role', x.reviewer_role, 'from', private.rv_person(x.from_id),
                               'to', private.rv_person(x.to_id), 'reason', x.reason, 'by', private.rv_person(x.changed_by), 'at', x.created_at) order by x.created_at)
                              from public.hr_review_assignments x where x.cycle_id = c.id and v_hr), '[]'::jsonb),
    'reminders', coalesce((select jsonb_agg(jsonb_build_object('kind', ev.kind, 'to', ev.recipient_name, 'role', ev.payload ->> 'recipientRole',
                               'status', ev.status, 'error', ev.last_error, 'sentAt', ev.sent_at, 'sendAfter', ev.send_after) order by ev.send_after desc)
                              from public.hr_email_events ev where ev.cycle_id = c.id and v_hr and ev.kind in ('REVIEW_FIRST', 'REVIEW_SECOND', 'PROBATION_OVERDUE_HR')), '[]'::jsonb),
    'meetings', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'startsAt', m.starts_at, 'status', m.status) order by m.starts_at desc)
                              from public.meetings m join public.meeting_attendees a on a.meeting_id = m.id
                             where a.profile_id = c.profile_id and m.kind = 'HR_MEETING' and (v_hr or v_decider)
                               and m.starts_at::date between v_from and greatest(v_to, private.hr_today())), '[]'::jsonb),
    'confirmationEmail', (select jsonb_build_object('status', ev.status, 'error', ev.last_error, 'sentAt', ev.sent_at)
                            from public.hr_email_events ev where ev.event_key = 'CONFIRMATION_EMPLOYEE:' || c.id and v_hr),
    'hrPeople', case when v_hr then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role) order by p.full_name)
                     from public.profiles p where p.status = 'ACTIVE' and p.id is distinct from c.profile_id
                       and (p.role = 'DEPARTMENT_HEAD' or exists (select 1 from public.departments d where d.id = p.department_id and d.slug = 'hr'
                                                                     and coalesce(p.hr_sub_role, '') <> 'HR_RECRUITER'))), '[]'::jsonb) end);
end $$;
revoke all on function public.hr_review_detail(uuid) from public, anon;
grant execute on function public.hr_review_detail(uuid) to authenticated;

-- The Department Head's / CEO's own queue: cycles assigned to them (any round), soonest first, with a short attendance line
create or replace function public.hr_review_my_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
begin
  if auth.uid() is null then raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501'; end if;
  return jsonb_build_object('today', v_today, 'rows', coalesce((
    select jsonb_agg(private.rv_row(c) || jsonb_build_object(
             'myRole', case when c.dh_reviewer_id = auth.uid() then 'DH' else 'CEO' end,
             'myStatus', private.rv_report_status(c, case when c.dh_reviewer_id = auth.uid() then 'DH' else 'CEO' end),
             'attendance', private.att_summary(c.profile_id, c.joining_date, least(v_today, c.probation_end)))
           order by (c.status = 'PENDING') desc, c.probation_end)
      from public.hr_probation_cycles c
     where auth.uid() in (c.dh_reviewer_id, c.ceo_reviewer_id) and c.profile_id is distinct from auth.uid()
       and (c.status in ('PENDING', 'ON_HOLD') or c.updated_at > now() - interval '120 days')), '[]'::jsonb));
end $$;
revoke all on function public.hr_review_my_queue() from public, anon;
grant execute on function public.hr_review_my_queue() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Writing: save / submit an evaluation, return it for revision, reassign a reviewer
-- ---------------------------------------------------------------------------
-- p: { ratings: {criterion: 1..5 | null (not applicable)}, answers: {...text fields...}, recommendation, submit: bool }
-- Recommendations: CONFIRM, EXTEND, NOT_CONFIRM, DISCUSS (probation); COMPLETE, CONVERT, EXTEND, NOT_CONTINUE, DISCUSS (internship).
create or replace function public.hr_review_save(p_cycle uuid, p_role text, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
  e public.hr_review_evaluations;
  v_submit boolean := coalesce((p ->> 'submit')::boolean, false);
  v_rec text := nullif(p ->> 'recommendation', '');
  v_ratings jsonb := coalesce(p -> 'ratings', '{}'::jsonb);
  v_answers jsonb := coalesce(p -> 'answers', '{}'::jsonb);
  k text;
  v jsonb;
  v_reason text;
  r record;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if c.id is null or not private.rv_can_view(c) then raise exception 'NOT_FOUND: Review not found.' using errcode = 'P0001'; end if;
  if p_role not in ('DH', 'CEO', 'HR') then raise exception 'VALIDATION_ERROR: Unknown reviewer.' using errcode = 'P0001'; end if;
  if (p_role = 'DH' and auth.uid() is distinct from c.dh_reviewer_id) or (p_role = 'CEO' and auth.uid() is distinct from c.ceo_reviewer_id)
     or (p_role = 'HR' and not private.rv_is_hr_for(c)) then
    raise exception 'FORBIDDEN: Only the assigned reviewer can write this evaluation.' using errcode = '42501';
  end if;
  if c.status not in ('PENDING', 'ON_HOLD') then raise exception 'CONFLICT: This review is already decided.' using errcode = 'P0001'; end if;
  if jsonb_typeof(v_ratings) <> 'object' or jsonb_typeof(v_answers) <> 'object' then
    raise exception 'VALIDATION_ERROR: The evaluation could not be read.' using errcode = 'P0001';
  end if;
  for k, v in select * from jsonb_each(v_ratings) loop
    if length(k) > 60 or not (v = 'null'::jsonb or (jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric in (1, 2, 3, 4, 5))) then
      raise exception 'VALIDATION_ERROR: Ratings are 1 to 5, or not applicable.' using errcode = 'P0001';
    end if;
  end loop;
  for k, v in select * from jsonb_each(v_answers) loop
    if length(k) > 60 or (jsonb_typeof(v) = 'string' and length(v #>> '{}') > 4000) then
      raise exception 'VALIDATION_ERROR: An answer is too long (4000 characters at most).' using errcode = 'P0001';
    end if;
  end loop;
  if v_rec is not null and v_rec not in ('CONFIRM', 'EXTEND', 'NOT_CONFIRM', 'DISCUSS', 'COMPLETE', 'CONVERT', 'NOT_CONTINUE') then
    raise exception 'VALIDATION_ERROR: Choose a recommendation.' using errcode = 'P0001';
  end if;
  if v_rec in ('CONFIRM', 'NOT_CONFIRM') and c.cycle_type = 'INTERNSHIP' or v_rec in ('COMPLETE', 'CONVERT', 'NOT_CONTINUE') and c.cycle_type = 'PROBATION' then
    raise exception 'VALIDATION_ERROR: That recommendation does not apply to this review.' using errcode = 'P0001';
  end if;

  select * into e from public.hr_review_evaluations where cycle_id = c.id and round = c.review_round and reviewer_role = p_role for update;
  if e.status = 'SUBMITTED' then
    raise exception 'CONFLICT: This evaluation was submitted. HR can return it for revision if it needs to change.' using errcode = 'P0001';
  end if;

  if v_submit and p_role <> 'HR' then
    if v_rec is null then raise exception 'VALIDATION_ERROR: Choose an overall recommendation before submitting.' using errcode = 'P0001'; end if;
    if not exists (select 1 from jsonb_each(v_ratings) x where x.value <> 'null'::jsonb) then
      raise exception 'VALIDATION_ERROR: Rate at least one criterion before submitting.' using errcode = 'P0001';
    end if;
    v_reason := btrim(coalesce(v_answers ->> 'recommendationReason', ''));
    if v_rec in ('NOT_CONFIRM', 'NOT_CONTINUE') and length(v_reason) < 30 then
      raise exception 'VALIDATION_ERROR: Explain in detail why confirmation is not recommended (30 characters at least).' using errcode = 'P0001';
    end if;
    if v_rec = 'EXTEND' and (length(v_reason) < 15 or coalesce(v_answers ->> 'extensionMonths', '') !~ '^[1-6]$'
                             or length(btrim(coalesce(v_answers ->> 'improvementExpectations', ''))) < 10) then
      raise exception 'VALIDATION_ERROR: For an extension give the duration (1 to 6 months), the reason and the improvement expected.' using errcode = 'P0001';
    end if;
  end if;

  insert into public.hr_review_evaluations as x (cycle_id, round, reviewer_role, reviewer_id, status, ratings, answers, recommendation, submitted_at, version)
  values (c.id, c.review_round, p_role, auth.uid(), case when v_submit then 'SUBMITTED' else 'DRAFT' end, v_ratings, v_answers, v_rec,
          case when v_submit then now() end, case when v_submit then 1 else 0 end)
  on conflict (cycle_id, round, reviewer_role) do update
     set reviewer_id = auth.uid(), ratings = excluded.ratings, answers = excluded.answers, recommendation = excluded.recommendation,
         status = case when v_submit then 'SUBMITTED' when x.status = 'RETURNED' then 'RETURNED' else 'DRAFT' end,
         submitted_at = case when v_submit then now() else x.submitted_at end,
         version = x.version + case when v_submit then 1 else 0 end, updated_at = now()
  returning * into e;

  if v_submit then
    insert into public.hr_review_evaluation_versions (evaluation_id, version, snapshot, submitted_by)
    values (e.id, e.version, jsonb_build_object('ratings', e.ratings, 'answers', e.answers, 'recommendation', e.recommendation), auth.uid());
    perform private.write_audit('EMPLOYEE_REVIEW_SUBMITTED', 'hr_review', c.id, c.department_id, null,
      jsonb_build_object('employee', c.employee_name, 'role', p_role, 'round', c.review_round, 'version', e.version));
    if p_role <> 'HR' then
      -- HR is told (the report itself stays in the CRM; the notification carries no review content)
      for r in select distinct x as pid from unnest(array[c.hr_reviewer_id] || array(
                 select p.id from public.profiles p join public.departments d on d.id = p.department_id
                  where d.slug = 'hr' and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD')) x where x is not null loop
        perform private.notify_once(r.pid, 'EMPLOYEE_REVIEW_SUBMITTED',
          case p_role when 'DH' then 'Department Head' else 'CEO' end || ' evaluation submitted: ' || c.employee_name,
          'Open the review to read it.', 'hr_review', c.id, jsonb_build_object('cycleId', c.id, 'role', p_role));
      end loop;
    end if;
  end if;
  return public.hr_review_detail(c.id);
end $$;
revoke all on function public.hr_review_save(uuid, text, jsonb) from public, anon;
grant execute on function public.hr_review_save(uuid, text, jsonb) to authenticated;

-- HR returns a submitted Department Head / CEO evaluation for revision (the submitted version stays in the history)
create or replace function public.hr_review_return(p_cycle uuid, p_role text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
  e public.hr_review_evaluations;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if c.id is null or not private.rv_can_view(c) then raise exception 'NOT_FOUND: Review not found.' using errcode = 'P0001'; end if;
  if not private.rv_is_hr_for(c) then raise exception 'FORBIDDEN: Only HR can return an evaluation.' using errcode = '42501'; end if;
  if c.status not in ('PENDING', 'ON_HOLD') then raise exception 'CONFLICT: This review is already decided.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'VALIDATION_ERROR: Say what should be revised.' using errcode = 'P0001'; end if;
  update public.hr_review_evaluations
     set status = 'RETURNED', returned_reason = left(btrim(p_reason), 1000), returned_by = auth.uid(), returned_at = now(), updated_at = now()
   where cycle_id = c.id and round = c.review_round and reviewer_role = p_role and status = 'SUBMITTED'
   returning * into e;
  if e.id is null then raise exception 'CONFLICT: Only a submitted evaluation can be returned.' using errcode = 'P0001'; end if;
  perform private.notify_once(e.reviewer_id, 'EMPLOYEE_REVIEW_RETURNED', 'Evaluation returned for revision: ' || c.employee_name,
    left(btrim(p_reason), 300), 'hr_review', c.id, jsonb_build_object('cycleId', c.id, 'role', p_role), 'urgent');
  perform private.write_audit('EMPLOYEE_REVIEW_RETURNED', 'hr_review', c.id, c.department_id, null,
    jsonb_build_object('employee', c.employee_name, 'role', p_role, 'round', c.review_round));
  return public.hr_review_detail(c.id);
end $$;
revoke all on function public.hr_review_return(uuid, text, text) from public, anon;
grant execute on function public.hr_review_return(uuid, text, text) to authenticated;

-- HR reassigns a pending reviewer (an employee moved departments, a reviewer left). The history is kept.
create or replace function public.hr_review_reassign(p_cycle uuid, p_role text, p_profile uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
  t public.profiles;
  v_old uuid;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if c.id is null or not private.rv_can_view(c) then raise exception 'NOT_FOUND: Review not found.' using errcode = 'P0001'; end if;
  if not private.rv_is_hr_for(c) then raise exception 'FORBIDDEN: Only HR can reassign a reviewer.' using errcode = '42501'; end if;
  if c.status not in ('PENDING', 'ON_HOLD') then raise exception 'CONFLICT: This review is already decided.' using errcode = 'P0001'; end if;
  if p_role not in ('DH', 'CEO', 'HR') then raise exception 'VALIDATION_ERROR: Unknown reviewer.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'VALIDATION_ERROR: Say why the reviewer changes.' using errcode = 'P0001'; end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null or t.status <> 'ACTIVE' or t.id = c.profile_id or t.role = 'SUPER_ADMIN' and p_role <> 'CEO' then
    raise exception 'VALIDATION_ERROR: Choose an active reviewer (not the employee).' using errcode = 'P0001';
  end if;
  if p_role in ('DH', 'CEO') and t.role <> 'DEPARTMENT_HEAD' and t.role <> 'SUPER_ADMIN' then
    raise exception 'VALIDATION_ERROR: The reviewer must be a Department Head or CEO.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.hr_review_evaluations e where e.cycle_id = c.id and e.round = c.review_round and e.reviewer_role = p_role and e.status = 'SUBMITTED') then
    raise exception 'CONFLICT: This reviewer already submitted. Return the evaluation first if it must be redone.' using errcode = 'P0001';
  end if;
  v_old := case p_role when 'DH' then c.dh_reviewer_id when 'CEO' then c.ceo_reviewer_id else c.hr_reviewer_id end;
  update public.hr_probation_cycles
     set dh_reviewer_id = case when p_role = 'DH' then t.id else dh_reviewer_id end,
         ceo_reviewer_id = case when p_role = 'CEO' then t.id else ceo_reviewer_id end,
         hr_reviewer_id = case when p_role = 'HR' then t.id else hr_reviewer_id end, updated_at = now()
   where id = c.id returning * into c;
  update public.hr_probation_cycles
     set config_issue = nullif(array_to_string(array_remove(array_remove(array[case when dh_reviewer_id is null then 'NO_DEPARTMENT_HEAD' end,
                                                                         case when ceo_reviewer_id is null then 'NO_CEO' end], null), null), ','), '')
   where id = c.id returning * into c;
  -- an unsubmitted draft of the previous reviewer is handed over (kept, with its author)
  insert into public.hr_review_assignments (cycle_id, round, reviewer_role, from_id, to_id, reason, changed_by)
  values (c.id, c.review_round, p_role, v_old, t.id, left(btrim(p_reason), 500), auth.uid());
  perform private.notify_once(t.id, 'EMPLOYEE_REVIEW_ASSIGNED', case when c.cycle_type = 'INTERNSHIP' then 'Internship review' else 'Confirmation review' end ||
    ' assigned to you: ' || c.employee_name, 'Please submit your evaluation before ' || to_char(c.probation_end, 'DD Mon YYYY') || '.',
    'hr_review', c.id, jsonb_build_object('cycleId', c.id, 'role', p_role), 'urgent');
  perform private.write_audit('EMPLOYEE_REVIEW_REASSIGNED', 'hr_review', c.id, c.department_id, null,
    jsonb_build_object('employee', c.employee_name, 'role', p_role, 'from', v_old, 'to', t.id));
  return public.hr_review_detail(c.id);
end $$;
revoke all on function public.hr_review_reassign(uuid, text, uuid, text) from public, anon;
grant execute on function public.hr_review_reassign(uuid, text, uuid, text) to authenticated;

-- HR starts a review now (a cycle more than 10 days away, e.g. to collect reports early)
create or replace function public.hr_review_start(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle;
  if c.id is null or not private.rv_can_view(c) then raise exception 'NOT_FOUND: Review not found.' using errcode = 'P0001'; end if;
  if not private.rv_is_hr_for(c) then raise exception 'FORBIDDEN: Only HR can start a review.' using errcode = '42501'; end if;
  if c.status <> 'PENDING' then raise exception 'CONFLICT: This review is already decided.' using errcode = 'P0001'; end if;
  c := private.rv_assign(c.id);
  perform private.write_audit('EMPLOYEE_REVIEW_STARTED', 'hr_review', c.id, c.department_id, null, jsonb_build_object('employee', c.employee_name));
  return public.hr_review_detail(c.id);
end $$;
revoke all on function public.hr_review_start(uuid) from public, anon;
grant execute on function public.hr_review_start(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The final decision (HR)
-- ---------------------------------------------------------------------------
-- The existing Confirm keeps working for cycles that are not in a review yet; once a review has started, the decision is recorded here
-- (hr_review_decide calls it with app.hr_review_decide = on).
create or replace function public.hr_confirm_probation(p_cycle uuid, p_effective date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
  me public.profiles;
  v_eff date;
  v_send timestamptz;
  v_direct boolean;
  r record;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if c.id is null then raise exception 'NOT_FOUND: Confirmation not found.' using errcode = 'P0001'; end if;
  if not private.can_confirm_probation(c.id) then
    raise exception 'FORBIDDEN: Only the HR lead, the department''s HR, the employee''s Department Head or the Super Admin can confirm an employee, and nobody can confirm themselves.' using errcode = '42501';
  end if;
  if c.cycle_type <> 'PROBATION' then raise exception 'CONFLICT: An internship is completed in the internship review, not confirmed here.' using errcode = 'P0001'; end if;
  v_direct := c.review_started_at is not null and coalesce(current_setting('app.hr_review_decide', true), '') <> 'on';
  if v_direct and not (private.rv_can_decide(c) and private.rv_report_status(c, 'DH') = 'SUBMITTED' and private.rv_report_status(c, 'CEO') = 'SUBMITTED') then
    raise exception 'CONFLICT: The confirmation review has started. HR records the final decision in Employee Confirmations, after the Department Head and CEO reports.' using errcode = 'P0001';
  end if;
  if c.status = 'CONFIRMING' then
    raise exception 'CONFLICT: This confirmation is already in progress. Retry the confirmation e-mail instead.' using errcode = 'P0001';
  end if;
  if c.status <> 'PENDING' then raise exception 'CONFLICT: This confirmation was already decided.' using errcode = 'P0001'; end if;
  v_eff := coalesce(p_effective, c.probation_end);
  if v_eff < c.joining_date or v_eff > private.hr_today() + 366 then
    raise exception 'VALIDATION_ERROR: Enter a valid confirmation effective date.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from private.hr_mail_employees() m where m.employee_key = c.employee_key and m.is_active) then
    raise exception 'VALIDATION_ERROR: This employee is no longer active, so they cannot be confirmed. Close the confirmation instead.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();

  update public.hr_probation_cycles
     set status = 'CONFIRMING', effective_date = v_eff, approved_by = auth.uid(), approved_at = now(),
         decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), updated_at = now()
   where id = c.id returning * into c;

  v_send := greatest(now(), private.hr_nine_am(c.probation_end));
  perform private.hr_enqueue('CONFIRMATION_EMPLOYEE:' || c.id, 'CONFIRMATION_EMPLOYEE', c.employee_key, c.profile_id, c.id, c.employee_email, c.employee_name,
    jsonb_build_object('employeeName', c.employee_name, 'confirmationEffectiveDate', v_eff), private.hr_today(), v_send);
  for r in select * from private.hr_notify_recipients() n where n.email is distinct from c.employee_email loop
    perform private.hr_enqueue('CONFIRMATION_HR:' || c.id || ':' || r.email, 'CONFIRMATION_HR', c.employee_key, c.profile_id, c.id, r.email, r.name,
      jsonb_build_object('employeeName', c.employee_name, 'employeeCode', c.employee_code, 'department', coalesce(c.department_name, ''),
                         'joiningDate', c.joining_date, 'probationEndDate', c.probation_end, 'confirmationEffectiveDate', v_eff,
                         'approvalStatus', 'Approved', 'approvedBy', me.full_name),
      private.hr_today(), v_send);
  end loop;

  if v_direct then
    -- Confirm pressed on the old page after both reports: recorded as the review's decision too
    insert into public.hr_review_decisions (cycle_id, round, decision, reason, details, decided_by)
    values (c.id, c.review_round, 'CONFIRM', nullif(left(btrim(coalesce(p_note, '')), 4000), ''), jsonb_build_object('effectiveDate', v_eff), auth.uid());
    update public.hr_probation_cycles set decision = 'CONFIRM', decision_reason = nullif(left(btrim(coalesce(p_note, '')), 4000), ''),
           decided_by = auth.uid(), decided_at = now() where id = c.id returning * into c;
  end if;
  perform private.write_audit('EMPLOYEE_CONFIRMATION_STARTED', 'hr_probation', c.id, c.department_id, null,
    jsonb_build_object('employee', c.employee_name, 'effectiveDate', v_eff));
  return private.hr_cycle_json(c);
end $$;
revoke all on function public.hr_confirm_probation(uuid, date, text) from public, anon;
grant execute on function public.hr_confirm_probation(uuid, date, text) to authenticated;

-- the people told about a decision (in the CRM; no review content in the text)
create or replace function private.rv_tell(c public.hr_probation_cycles, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  for r in select distinct x as pid from unnest(array[c.dh_reviewer_id, c.ceo_reviewer_id, c.hr_reviewer_id] || array(
             select p.id from public.profiles p join public.departments d on d.id = p.department_id
              where d.slug = 'hr' and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD')) x
            where x is not null and x is distinct from c.profile_id loop
    perform private.notify_once(r.pid, 'EMPLOYEE_REVIEW_DECIDED', p_title, p_body, 'hr_review', c.id, jsonb_build_object('cycleId', c.id));
  end loop;
end $$;
revoke all on function private.rv_tell(public.hr_probation_cycles, text, text) from public, anon, authenticated;

-- Move a cycle to its next round with a new date (an extension). The original date and every report stay; reminders of the old date are dropped.
create or replace function private.rv_extend(p_cycle uuid, p_new_end date, p_reason text, p_expectations text)
returns public.hr_probation_cycles language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if p_new_end is null or p_new_end <= c.probation_end or p_new_end > c.probation_end + interval '12 months' then
    raise exception 'VALIDATION_ERROR: The revised date must be after % and within 12 months of it.', to_char(c.probation_end, 'DD Mon YYYY') using errcode = 'P0001';
  end if;
  insert into public.hr_review_extensions (cycle_id, from_round, old_end, new_end, reason, expectations, decided_by)
  values (c.id, c.review_round, c.probation_end, p_new_end, left(btrim(p_reason), 4000), nullif(left(btrim(coalesce(p_expectations, '')), 4000), ''), auth.uid());
  update public.hr_email_events
     set status = 'SKIPPED', last_error = 'Superseded: the review date changed.', locked_until = null, updated_at = now()
   where cycle_id = c.id and status in ('PENDING', 'RETRY', 'DRY_RUN')
     and kind in ('REVIEW_FIRST', 'REVIEW_SECOND', 'PROBATION_REMINDER_EMPLOYEE', 'PROBATION_OVERDUE_HR');
  update public.hr_probation_cycles
     set probation_end = p_new_end, review_round = review_round + 1, status = 'PENDING', review_started_at = null,
         hold_next_review = null, hold_owner = null, updated_at = now()
   where id = c.id returning * into c;
  insert into public.hr_review_assignments (cycle_id, round, reviewer_role, from_id, to_id, reason, changed_by)
  select c.id, c.review_round, x.r, x.p, x.p, 'Carried to the next review round.', auth.uid()
    from (values ('DH', c.dh_reviewer_id), ('CEO', c.ceo_reviewer_id), ('HR', c.hr_reviewer_id)) x(r, p) where x.p is not null;
  return c;
end $$;
revoke all on function private.rv_extend(uuid, date, text, text) from public, anon, authenticated;

-- The internship outcomes (Complete, Convert). 20270312000500 (Phase 4) replaces this placeholder; until it runs they are refused.
-- Created only when missing, so running this file again never replaces the real function.
do $do$
begin
  if to_regprocedure('private.rv_internship_outcome(uuid, text, jsonb, text, boolean)') is null then
    execute $f$
      create function private.rv_internship_outcome(p_cycle uuid, p_decision text, p jsonb, p_reason text, p_exceptional boolean)
      returns public.hr_probation_cycles language plpgsql security definer set search_path = '' as $b$
      begin
        raise exception 'VALIDATION_ERROR: Run the internship migration first.' using errcode = 'P0001';
      end $b$
    $f$;
  end if;
end $do$;
revoke all on function private.rv_internship_outcome(uuid, text, jsonb, text, boolean) from public, anon, authenticated;

-- p: { decision, reason, effectiveDate, extensionMonths | newDate, expectations, nextReviewDate, exceptional, hrEvaluation: {ratings, answers} }
create or replace function public.hr_review_decide(p_cycle uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
  v_dec text := upper(coalesce(p ->> 'decision', ''));
  v_reason text := btrim(coalesce(p ->> 'reason', ''));
  v_missing boolean;
  v_exc boolean := coalesce((p ->> 'exceptional')::boolean, false);
  v_new date;
  v_next date;
  v_eff date;
  v_hr jsonb := p -> 'hrEvaluation';
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if c.id is null or not private.rv_can_view(c) then raise exception 'NOT_FOUND: Review not found.' using errcode = 'P0001'; end if;
  if not private.rv_can_decide(c) then
    raise exception 'FORBIDDEN: Only the HR Department Head / Team Head, the department''s HR or the Super Admin record the final decision.' using errcode = '42501';
  end if;
  if c.status not in ('PENDING', 'ON_HOLD') then raise exception 'CONFLICT: This review is already decided.' using errcode = 'P0001'; end if;
  if c.cycle_type = 'PROBATION' and v_dec not in ('CONFIRM', 'EXTEND', 'NOT_CONFIRM', 'HOLD')
     or c.cycle_type = 'INTERNSHIP' and v_dec not in ('COMPLETE', 'CONVERT', 'EXTEND', 'NOT_CONTINUE', 'HOLD') then
    raise exception 'VALIDATION_ERROR: Choose a decision.' using errcode = 'P0001';
  end if;
  if length(v_reason) < 10 then raise exception 'VALIDATION_ERROR: Give the reasons for the decision (10 characters at least).' using errcode = 'P0001'; end if;
  if v_dec in ('NOT_CONFIRM', 'NOT_CONTINUE') and length(v_reason) < 30 then
    raise exception 'VALIDATION_ERROR: A decision not to confirm needs a detailed reason (30 characters at least).' using errcode = 'P0001';
  end if;
  if not exists (select 1 from private.hr_mail_employees() m where m.employee_key = c.employee_key and m.is_active) and v_dec not in ('HOLD') then
    raise exception 'VALIDATION_ERROR: This employee is no longer active. Close the review instead.' using errcode = 'P0001';
  end if;

  -- both management reports first (Hold needs none); otherwise an exceptional decision with a reason, by the HR Department Head / Super Admin
  v_missing := private.rv_report_status(c, 'DH') <> 'SUBMITTED' or private.rv_report_status(c, 'CEO') <> 'SUBMITTED';
  if v_dec <> 'HOLD' and v_missing then
    if not v_exc then
      raise exception 'CONFLICT: The Department Head and CEO reports are both needed before the final decision.' using errcode = 'P0001';
    end if;
    if not private.rv_can_decide_exception() then
      raise exception 'FORBIDDEN: Only the HR Department Head or the Super Admin can decide with a management report missing.' using errcode = '42501';
    end if;
    if length(v_reason) < 30 then
      raise exception 'VALIDATION_ERROR: Document why the decision is taken without both reports (30 characters at least).' using errcode = 'P0001';
    end if;
  else
    v_exc := false;
  end if;

  -- HR's own evaluation of this round is saved with the decision (submitted)
  if v_hr is not null and jsonb_typeof(v_hr) = 'object' then
    perform set_config('app.hr_review_decide', 'on', true);
    insert into public.hr_review_evaluations as x (cycle_id, round, reviewer_role, reviewer_id, status, ratings, answers, recommendation, submitted_at, version)
    values (c.id, c.review_round, 'HR', auth.uid(), 'SUBMITTED', coalesce(v_hr -> 'ratings', '{}'::jsonb), coalesce(v_hr -> 'answers', '{}'::jsonb),
            v_dec, now(), 1)
    on conflict (cycle_id, round, reviewer_role) do update
       set reviewer_id = auth.uid(), status = 'SUBMITTED', ratings = excluded.ratings, answers = excluded.answers, recommendation = excluded.recommendation,
           submitted_at = now(), version = x.version + 1, updated_at = now();
    insert into public.hr_review_evaluation_versions (evaluation_id, version, snapshot, submitted_by)
    select e.id, e.version, jsonb_build_object('ratings', e.ratings, 'answers', e.answers, 'recommendation', e.recommendation), auth.uid()
      from public.hr_review_evaluations e where e.cycle_id = c.id and e.round = c.review_round and e.reviewer_role = 'HR'
    on conflict do nothing;
  end if;

  insert into public.hr_review_decisions (cycle_id, round, decision, reason, details, exceptional, decided_by)
  values (c.id, c.review_round, v_dec, left(v_reason, 4000), p - 'hrEvaluation' - 'reason' - 'decision', v_exc, auth.uid());

  if v_dec = 'CONFIRM' then
    v_eff := case when p ->> 'effectiveDate' ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'effectiveDate')::date else c.probation_end end;
    update public.hr_probation_cycles set status = 'PENDING', review_started_at = coalesce(review_started_at, now()) where id = c.id;
    perform set_config('app.hr_review_decide', 'on', true);
    perform public.hr_confirm_probation(c.id, v_eff, left(v_reason, 500));
    perform set_config('app.hr_review_decide', '', true);
    update public.hr_probation_cycles
       set decision = 'CONFIRM', decision_reason = left(v_reason, 4000), decided_by = auth.uid(), decided_at = now(), decision_exceptional = v_exc
     where id = c.id returning * into c;
    perform private.rv_tell(c, 'Employee confirmation approved: ' || c.employee_name,
      'Effective ' || to_char(v_eff, 'DD Mon YYYY') || '. The confirmation e-mail is sent once the probation period is over.');
  elsif v_dec = 'EXTEND' then
    v_new := case when p ->> 'newDate' ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'newDate')::date
                  when coalesce(p ->> 'extensionMonths', '') ~ '^([1-9]|1[0-2])$' then (c.probation_end + make_interval(months => (p ->> 'extensionMonths')::int))::date end;
    if v_new is null then raise exception 'VALIDATION_ERROR: Give the extension (months) or the revised date.' using errcode = 'P0001'; end if;
    if length(btrim(coalesce(p ->> 'expectations', ''))) < 10 then
      raise exception 'VALIDATION_ERROR: Record the improvement expected during the extension.' using errcode = 'P0001';
    end if;
    c := private.rv_extend(c.id, v_new, v_reason, p ->> 'expectations');
    update public.hr_probation_cycles set decision = 'EXTEND', decision_reason = left(v_reason, 4000), decided_by = auth.uid(), decided_at = now(),
           decision_exceptional = v_exc where id = c.id returning * into c;
    perform private.rv_tell(c, case when c.cycle_type = 'INTERNSHIP' then 'Internship extended: ' else 'Probation extended: ' end || c.employee_name,
      'New review date ' || to_char(c.probation_end, 'DD Mon YYYY') || '. A new evaluation will be requested before it.');
  elsif v_dec in ('NOT_CONFIRM', 'NOT_CONTINUE') then
    update public.hr_probation_cycles
       set status = case v_dec when 'NOT_CONFIRM' then 'NOT_CONFIRMED' else 'NOT_CONTINUED' end, decision = v_dec, decision_reason = left(v_reason, 4000),
           decided_by = auth.uid(), decided_at = now(), decision_exceptional = v_exc, updated_at = now()
     where id = c.id returning * into c;
    -- the employee's account and HR record are NOT changed here: any exit follows the existing offboarding process
    perform private.rv_tell(c, case when v_dec = 'NOT_CONFIRM' then 'Not confirmed: ' else 'Internship not continued: ' end || c.employee_name,
      'Recorded by HR. Any exit follows the employee offboarding process; nothing was changed on the account.');
  elsif v_dec = 'HOLD' then
    v_next := case when p ->> 'nextReviewDate' ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'nextReviewDate')::date end;
    if v_next is null or v_next <= private.hr_today() or v_next > private.hr_today() + 180 then
      raise exception 'VALIDATION_ERROR: Choose the next review date (within 180 days).' using errcode = 'P0001';
    end if;
    update public.hr_probation_cycles
       set status = 'ON_HOLD', decision = 'HOLD', decision_reason = left(v_reason, 4000), decided_by = auth.uid(), decided_at = now(),
           hold_next_review = v_next,
           hold_owner = coalesce(case when p ->> 'ownerId' ~* '^[0-9a-f-]{36}$' then (p ->> 'ownerId')::uuid end, auth.uid()), updated_at = now()
     where id = c.id returning * into c;
  else
    -- COMPLETE / CONVERT: the internship outcomes (20270312000500, Phase 4)
    c := private.rv_internship_outcome(c.id, v_dec, p, v_reason, v_exc);
  end if;

  perform private.write_audit('EMPLOYEE_REVIEW_DECIDED', 'hr_review', c.id, c.department_id, null,
    jsonb_build_object('employee', c.employee_name, 'decision', v_dec, 'round', c.review_round, 'exceptional', v_exc));
  return public.hr_review_detail(c.id);
end $$;
revoke all on function public.hr_review_decide(uuid, jsonb) from public, anon;
grant execute on function public.hr_review_decide(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
