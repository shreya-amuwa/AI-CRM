-- =============================================================================
-- HR dashboard upgrade, Phase 3: Telecaller weekly performance and HR performance review meetings (docs/hr-dashboard-upgrade.md).
--
-- Reuses what exists: the Crocodial call records (crocodial_ext_calls, one row per provider call id, so a call synchronised twice is ONE call),
-- the approved employee mappings (private.croc_person_at: the person who had the Crocodial account at the time of the call, never a name),
-- the call-log sync state (crocodial_sync_state), the attendance day engine (private.att_day_rows: shifts, approved leave, holidays, weekly
-- offs, joining date), the meetings engine (meetings / meeting_attendees through private.mtg_mirror) and the in-app / e-mail notifications.
--  * Eligible call = an outgoing call with a provider id, attributed through an approved mapping, not missing at the source. Connected / not
--    connected come from Crocodial's own flag. Dispositions, campaigns and call quality are not in the stored calls: shown as unavailable.
--  * Targets (telecaller_targets): department / team / designation defaults and employee overrides, each with an effective date. A change closes
--    the old row and adds a new one (the history). Adjusted weekly target = daily target x eligible working days (scheduled working days minus
--    approved leave; a half day counts half; days before joining, holidays and weekly offs are not working days; an unapproved absence does
--    not lower the target). Achievement = actual eligible calls / adjusted target x 100 (not capped).
--  * One row per Telecaller and week (telecaller_weekly_performance): PRELIMINARY until the week is over and the call logs were synchronised
--    after it, then FINAL. A FINAL row changes only through an authorised recalculation with a reason (telecaller_performance_recalcs).
--    No target -> Not evaluated; no mapping -> Not evaluated; calls not synchronised -> Sync pending; too few working days -> Insufficient data.
--    Missing call data never makes anyone a low performer.
--  * Review meetings: OFF until management approves the thresholds (telecaller_review_policy.enabled = false). When on, a FINAL week below the
--    threshold (and the consecutive-week / frequency rules) opens ONE review per concern: a meeting in the existing meetings engine with HR and
--    the Telecaller at the next slot free for both (working hours, leave, holidays), else "Pending scheduling" for HR. Nothing disciplinary.
-- Additive and safe to run twice. Run after 20270312000200_attendance_statement.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.telecaller_targets (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('DEPARTMENT', 'TEAM', 'DESIGNATION', 'EMPLOYEE')),
  department_id uuid references public.departments (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  designation text check (designation is null or length(designation) <= 80),
  profile_id uuid references public.profiles (id) on delete cascade,
  daily_calls integer not null check (daily_calls between 1 and 2000),
  weekly_calls integer check (weekly_calls is null or weekly_calls between 1 and 14000),
  effective_from date not null,
  effective_to date,
  note text check (note is null or length(note) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  ended_by uuid references public.profiles (id) on delete set null,
  check (effective_to is null or effective_to >= effective_from),
  check ((scope_type = 'DEPARTMENT' and department_id is not null) or (scope_type = 'TEAM' and team_id is not null)
      or (scope_type = 'DESIGNATION' and designation is not null and department_id is not null) or (scope_type = 'EMPLOYEE' and profile_id is not null))
);
create index if not exists telecaller_targets_scope_idx on public.telecaller_targets (scope_type, department_id, team_id, profile_id, effective_from);
alter table public.telecaller_targets enable row level security;
revoke all on public.telecaller_targets from public, anon, authenticated;

create table if not exists public.telecaller_review_policy (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  achieved_pct numeric not null default 100 check (achieved_pct between 1 and 500),
  on_track_pct numeric not null default 80 check (on_track_pct between 1 and 500),
  needs_improvement_pct numeric not null default 70 check (needs_improvement_pct between 1 and 500),
  review_below_pct numeric not null default 70 check (review_below_pct between 1 and 500),
  min_working_days numeric not null default 3 check (min_working_days between 0 and 7),
  consecutive_weeks integer not null default 1 check (consecutive_weeks between 1 and 8),
  min_days_between_reviews integer not null default 14 check (min_days_between_reviews between 0 and 180),
  max_auto_reviews integer not null default 6 check (max_auto_reviews between 0 and 52),
  meeting_minutes integer not null default 30 check (meeting_minutes between 15 and 120),
  invite_department_head boolean not null default false,
  invite_team_lead boolean not null default true,
  invite_operations_head boolean not null default false,
  hr_reviewer_id uuid references public.profiles (id) on delete set null,
  excluded_profiles uuid[] not null default '{}',
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (achieved_pct >= on_track_pct and on_track_pct >= needs_improvement_pct)
);
insert into public.telecaller_review_policy (id) values (true) on conflict do nothing;
alter table public.telecaller_review_policy enable row level security;
revoke all on public.telecaller_review_policy from public, anon, authenticated;

create table if not exists public.telecaller_weekly_performance (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  week_end date not null,
  department_id uuid references public.departments (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,
  status text not null default 'PRELIMINARY' check (status in ('PRELIMINARY', 'FINAL')),
  category text not null,
  scheduled_days numeric not null default 0,
  leave_days numeric not null default 0,
  eligible_days numeric not null default 0,
  daily_target integer,
  weekly_target integer,
  adjusted_target integer,
  target_id uuid references public.telecaller_targets (id) on delete set null,
  actual_calls integer not null default 0,
  connected_calls integer not null default 0,
  not_connected_calls integer not null default 0,
  incoming_calls integer not null default 0,
  missed_calls integer not null default 0,
  unique_contacts integer not null default 0,
  talk_seconds integer not null default 0,
  achievement numeric,
  mapping_ok boolean not null default false,
  data_complete boolean not null default false,
  reason text,
  breakdown jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  finalized_at timestamptz,
  recalc_count integer not null default 0,
  review_status text not null default 'NONE' check (review_status in ('NONE', 'PENDING_SCHEDULING', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NOT_REQUIRED')),
  meeting_id uuid references public.meetings (id) on delete set null,
  review_reason text,
  unique (profile_id, week_start),
  check (week_end = week_start + 6)
);
create index if not exists telecaller_weekly_week_idx on public.telecaller_weekly_performance (week_start, category);
create index if not exists telecaller_weekly_review_idx on public.telecaller_weekly_performance (review_status) where review_status in ('PENDING_SCHEDULING', 'SCHEDULED');
alter table public.telecaller_weekly_performance enable row level security;
revoke all on public.telecaller_weekly_performance from public, anon, authenticated;

create table if not exists public.telecaller_performance_recalcs (
  id bigint generated always as identity primary key,
  performance_id uuid not null references public.telecaller_weekly_performance (id) on delete cascade,
  before jsonb not null,
  after jsonb not null,
  reason text not null,
  recalculated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.telecaller_performance_recalcs enable row level security;
revoke all on public.telecaller_performance_recalcs from public, anon, authenticated;

create table if not exists public.performance_review_reports (
  id uuid primary key default gen_random_uuid(),
  performance_id uuid references public.telecaller_weekly_performance (id) on delete set null,
  meeting_id uuid references public.meetings (id) on delete set null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  reviewer_id uuid references public.profiles (id) on delete set null,
  fields jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object' and pg_column_size(fields) <= 32768),
  action_items jsonb not null default '[]'::jsonb check (jsonb_typeof(action_items) = 'array' and pg_column_size(action_items) <= 16384),
  outcome text not null check (outcome in ('PERFORMANCE_REVIEWED', 'TRAINING_REQUIRED', 'TECHNICAL_ISSUE', 'TARGET_ADJUSTMENT_RECOMMENDED', 'COACHING_REQUIRED',
                                            'IMPROVEMENT_PLAN', 'FOLLOW_UP_MEETING', 'CONCERN_RESOLVED', 'MANAGEMENT_DISCUSSION')),
  follow_up_date date,
  created_at timestamptz not null default now()
);
create index if not exists performance_review_reports_profile_idx on public.performance_review_reports (profile_id, created_at desc);
alter table public.performance_review_reports enable row level security;
revoke all on public.performance_review_reports from public, anon, authenticated;

create table if not exists public.performance_improvement_plans (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  report_id uuid references public.performance_review_reports (id) on delete set null,
  targets text not null check (length(targets) <= 4000),
  support text check (support is null or length(support) <= 4000),
  start_date date not null,
  review_deadline date not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED')),
  closed_remarks text check (closed_remarks is null or length(closed_remarks) <= 4000),
  closed_by uuid references public.profiles (id) on delete set null,
  closed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (review_deadline >= start_date)
);
create index if not exists performance_improvement_plans_profile_idx on public.performance_improvement_plans (profile_id, status);
alter table public.performance_improvement_plans enable row level security;
revoke all on public.performance_improvement_plans from public, anon, authenticated;

-- the meetings engine learns the review meeting as a source (a mirror, like the HR employee meetings)
alter table public.meetings drop constraint if exists meetings_source_type_check;
alter table public.meetings add constraint meetings_source_type_check
  check (source_type is null or source_type in ('ba_demo', 'career_interview', 'employee_meeting', 'performance_review'));
-- and the HR e-mail queue the meeting invitation
alter table public.hr_email_events drop constraint if exists hr_email_events_kind_check;
alter table public.hr_email_events add constraint hr_email_events_kind_check
  check (kind in ('BIRTHDAY', 'ANNIVERSARY', 'PROBATION_REMINDER_EMPLOYEE', 'PROBATION_REMINDER_HR', 'PROBATION_OVERDUE_HR',
                  'CONFIRMATION_EMPLOYEE', 'CONFIRMATION_HR', 'REVIEW_FIRST', 'REVIEW_SECOND', 'PERFORMANCE_REVIEW_MEETING'));

-- ---------------------------------------------------------------------------
-- 2. Who sees whose figures
-- ---------------------------------------------------------------------------
create or replace function private.tc_is_telecaller(p uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles x where x.id = p and x.role = 'TEAM_MEMBER' and x.sales_sub_role = 'TELECALLER')
$$;
revoke all on function private.tc_is_telecaller(uuid) from public, anon, authenticated;

-- the Telecaller themselves; HR staff; the Super Admin; their Team Lead; the Department Head covering them; the CEO whose scope covers them
create or replace function private.tc_can_view(p uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p = auth.uid() or private.is_hr_staff() or exists (
    select 1 from public.profiles me, public.profiles x
     where me.id = auth.uid() and me.status = 'ACTIVE' and x.id = p
       and ((me.role = 'TEAM_HEAD' and (private.direct_lead_of(x.id) = me.id or (x.team_id is not null and me.team_id = x.team_id)))
         or (me.role = 'DEPARTMENT_HEAD' and not me.is_operations_head and private.head_covers(me.id, private.base_department(x.department_id), x.team_id))
         or (me.role = 'DEPARTMENT_HEAD' and me.is_operations_head and private.scope_covers(me.id, x.department_id, 'SALES')))), false)
$$;
revoke all on function private.tc_can_view(uuid) from public, anon, authenticated;

-- may change targets / the policy: HR Department Head, a Sales Department Head (their department), a CEO (their scope), the Super Admin
create or replace function private.tc_can_manage(p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_super_admin() or exists (
    select 1 from public.profiles me left join public.departments d on d.id = me.department_id
     where me.id = auth.uid() and me.status = 'ACTIVE' and me.role = 'DEPARTMENT_HEAD'
       and (d.slug = 'hr'
         or (not me.is_operations_head and p_department is not null and private.head_covers(me.id, private.base_department(p_department), null))
         or (me.is_operations_head and p_department is not null and private.scope_covers(me.id, p_department, 'SALES')))), false)
$$;
revoke all on function private.tc_can_manage(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The week's figures
-- ---------------------------------------------------------------------------
-- the calls of one person in a period (India calendar days), attributed through the approved mappings at the time of each call
create or replace function private.tc_calls(p uuid, p_from date, p_to date)
returns table (day date, outgoing integer, connected integer, not_connected integer, incoming integer, missed integer, talk_seconds integer, contacts text[])
language sql stable security definer set search_path = '' as $$
  select (c.call_at at time zone 'Asia/Kolkata')::date,
         count(*) filter (where c.call_type = 'outgoing')::int,
         count(*) filter (where c.call_type = 'outgoing' and c.connected is true)::int,
         count(*) filter (where c.call_type = 'outgoing' and c.connected is false)::int,
         count(*) filter (where c.call_type = 'incoming')::int,
         count(*) filter (where c.call_type = 'missed')::int,
         coalesce(sum(c.duration_seconds) filter (where c.call_type = 'outgoing' and c.connected is true), 0)::int,
         array_agg(distinct right(regexp_replace(coalesce(c.phone_number, ''), '\D', '', 'g'), 10)) filter (where c.call_type = 'outgoing' and coalesce(c.phone_number, '') <> '')
    from public.crocodial_employee_mappings m
    join public.crocodial_ext_calls c on c.connection_id = m.connection_id and c.called_by_ext = m.external_employee_id
   where m.profile_id = p and m.status in ('APPROVED', 'REVOKED')
     and c.call_at >= (p_from::timestamp at time zone 'Asia/Kolkata') and c.call_at < ((p_to + 1)::timestamp at time zone 'Asia/Kolkata')
     and c.missing_since is null
     and private.croc_person_at(c.connection_id, c.called_by_ext, c.call_at) = p
   group by 1
$$;
revoke all on function private.tc_calls(uuid, date, date) from public, anon, authenticated;

-- the target that applies on a day: the employee's own, else the team's, else the designation's, else the department's
create or replace function private.tc_target_for(p uuid, p_day date)
returns public.telecaller_targets language sql stable security definer set search_path = '' as $$
  select t.* from public.telecaller_targets t, public.profiles x
   where x.id = p and t.effective_from <= p_day and (t.effective_to is null or t.effective_to >= p_day)
     and ((t.scope_type = 'EMPLOYEE' and t.profile_id = x.id)
       or (t.scope_type = 'TEAM' and t.team_id = x.team_id)
       or (t.scope_type = 'DESIGNATION' and t.department_id = private.base_department(x.department_id)
           and lower(t.designation) = lower(coalesce(nullif(x.position, ''), (select d.designation from public.employee_personal_details d where d.profile_id = x.id), 'Telecaller')))
       or (t.scope_type = 'DEPARTMENT' and t.department_id = private.base_department(x.department_id)))
   order by case t.scope_type when 'EMPLOYEE' then 1 when 'TEAM' then 2 when 'DESIGNATION' then 3 else 4 end, t.effective_from desc
   limit 1
$$;
revoke all on function private.tc_target_for(uuid, date) from public, anon, authenticated;

-- the call logs of every connection the person is mapped on were read completely after the week ended
create or replace function private.tc_data_complete(p uuid, p_week_end date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.crocodial_employee_mappings m where m.profile_id = p and m.status in ('APPROVED', 'REVOKED'))
     and not exists (
       select 1 from public.crocodial_employee_mappings m
         left join public.crocodial_sync_state s on s.connection_id = m.connection_id and s.resource = 'call-logs'
        where m.profile_id = p and m.status in ('APPROVED', 'REVOKED')
          and (m.ended_at is null or m.ended_at > (p_week_end - 6)::timestamp at time zone 'Asia/Kolkata')
          and (s.last_ok_at is null or s.last_ok_at < ((p_week_end + 1)::timestamp at time zone 'Asia/Kolkata')))
$$;
revoke all on function private.tc_data_complete(uuid, date) from public, anon, authenticated;

create or replace function private.tc_category(p_achievement numeric)
returns text language sql stable security definer set search_path = '' as $$
  select case when p_achievement is null then 'NOT_EVALUATED'
              when p_achievement >= pol.achieved_pct then 'TARGET_ACHIEVED'
              when p_achievement >= pol.on_track_pct then 'ON_TRACK'
              when p_achievement >= pol.needs_improvement_pct then 'NEEDS_IMPROVEMENT'
              else 'LOW_PERFORMANCE' end
    from public.telecaller_review_policy pol where pol.id
$$;
revoke all on function private.tc_category(numeric) from public, anon, authenticated;

-- Compute (or refresh) one person's week. A FINAL row is left as it is unless p_force (an authorised recalculation).
create or replace function private.tc_compute_week(p uuid, p_week_start date, p_force boolean default false)
returns public.telecaller_weekly_performance language plpgsql security definer set search_path = '' as $$
declare
  x public.profiles;
  w public.telecaller_weekly_performance;
  t public.telecaller_targets;
  pol public.telecaller_review_policy;
  v_end date := p_week_start + 6;
  v_today date := private.office_today();
  v_sched numeric;
  v_leave numeric;
  v_elig numeric;
  v_nominal integer;
  v_adj integer;
  v_calls record;
  v_ach numeric;
  v_cat text;
  v_reason text;
  v_complete boolean;
  v_mapped boolean;
  v_final boolean;
  v_days jsonb;
begin
  select * into x from public.profiles where id = p;
  select * into w from public.telecaller_weekly_performance where profile_id = p and week_start = p_week_start for update;
  if w.status = 'FINAL' and not p_force then return w; end if;
  select * into pol from public.telecaller_review_policy where id;

  -- working days from the attendance engine (shift days, approved leave, holidays, weekly offs, joining date); only days already started count
  select count(*) filter (where r.scheduled),
         -- approved leave from the leave itself: a full day 1, a half day 0.5 (punched in or not)
         count(*) filter (where r.scheduled and r.leave = 'FULL_DAY') + 0.5 * count(*) filter (where r.scheduled and r.leave in ('MORNING', 'AFTERNOON')),
         count(*) filter (where private.office_working_day(r.day))
    into v_sched, v_leave, v_nominal
    from private.att_day_rows(p_week_start, least(v_end, v_today), array[p]) r;
  v_elig := greatest(0, coalesce(v_sched, 0) - coalesce(v_leave, 0));

  select coalesce(sum(c.outgoing), 0)::int as outgoing, coalesce(sum(c.connected), 0)::int as connected, coalesce(sum(c.not_connected), 0)::int as not_connected,
         coalesce(sum(c.incoming), 0)::int as incoming, coalesce(sum(c.missed), 0)::int as missed, coalesce(sum(c.talk_seconds), 0)::int as talk,
         (select count(distinct u)::int from private.tc_calls(p, p_week_start, v_end) c2, unnest(c2.contacts) u where u <> '') as uniq
    into v_calls
    from private.tc_calls(p, p_week_start, v_end) c;
  select coalesce(jsonb_object_agg(c.day::text, jsonb_build_object('calls', c.outgoing, 'connected', c.connected)), '{}'::jsonb) into v_days
    from private.tc_calls(p, p_week_start, v_end) c;

  -- evaluated only when the mapping was in place from the start of the week (calls before a mapping are nobody's: a part week would be unfair)
  v_mapped := exists (select 1 from public.crocodial_employee_mappings m where m.profile_id = p and m.status in ('APPROVED', 'REVOKED')
                        and m.effective_from <= p_week_start::timestamp at time zone 'Asia/Kolkata'
                        and (m.ended_at is null or m.ended_at > p_week_start::timestamp at time zone 'Asia/Kolkata'));
  v_complete := v_end < v_today and private.tc_data_complete(p, v_end);
  t := private.tc_target_for(p, p_week_start);
  v_adj := case when t.id is null then null
                when t.weekly_calls is not null then round(t.weekly_calls * v_elig / greatest(v_nominal, 1))
                else round(t.daily_calls * v_elig) end;
  v_ach := case when v_adj is null or v_adj = 0 then null else round(v_calls.outgoing * 100.0 / v_adj, 1) end;
  v_cat := case
    when p = any (pol.excluded_profiles) then 'EXEMPT'
    when not v_mapped then 'NOT_EVALUATED'
    when t.id is null then 'NOT_EVALUATED'
    when v_end >= v_today then 'DATA_PENDING'
    when not v_complete then 'SYNC_PENDING'
    when v_elig < pol.min_working_days then 'INSUFFICIENT_DATA'
    when v_adj = 0 then 'NOT_EVALUATED'
    else private.tc_category(v_ach) end;
  v_reason := case v_cat
    when 'EXEMPT' then 'Exempt from evaluation (policy).'
    when 'NOT_EVALUATED' then case when not v_mapped then 'No approved Crocodial mapping for the whole week.' when t.id is null then 'No call target configured.' else 'No working days this week.' end
    when 'DATA_PENDING' then 'The week is not over yet.'
    when 'SYNC_PENDING' then 'Call logs not synchronised after the week ended.'
    when 'INSUFFICIENT_DATA' then 'Fewer eligible working days than the policy minimum.' end;
  v_final := v_end < v_today and v_complete;

  insert into public.telecaller_weekly_performance as z (profile_id, week_start, week_end, department_id, team_id, status, category, scheduled_days, leave_days,
         eligible_days, daily_target, weekly_target, adjusted_target, target_id, actual_calls, connected_calls, not_connected_calls, incoming_calls, missed_calls,
         unique_contacts, talk_seconds, achievement, mapping_ok, data_complete, reason, breakdown, computed_at, finalized_at)
  values (p, p_week_start, v_end, private.base_department(x.department_id), x.team_id, case when v_final then 'FINAL' else 'PRELIMINARY' end, v_cat,
          coalesce(v_sched, 0), coalesce(v_leave, 0), v_elig, t.daily_calls, t.weekly_calls, v_adj, t.id, v_calls.outgoing, v_calls.connected, v_calls.not_connected,
          v_calls.incoming, v_calls.missed, v_calls.uniq, v_calls.talk, v_ach, v_mapped, v_complete, v_reason,
          jsonb_build_object('days', v_days, 'nominalDays', v_nominal, 'formula',
            case when t.id is null then null when t.weekly_calls is not null then format('%s weekly x %s / %s working days', t.weekly_calls, trim_scale(v_elig), v_nominal)
                 else format('%s daily x %s eligible days', t.daily_calls, trim_scale(v_elig)) end),
          now(), case when v_final then now() end)
  on conflict (profile_id, week_start) do update
     set department_id = excluded.department_id, team_id = excluded.team_id, status = excluded.status, category = excluded.category,
         scheduled_days = excluded.scheduled_days, leave_days = excluded.leave_days, eligible_days = excluded.eligible_days, daily_target = excluded.daily_target,
         weekly_target = excluded.weekly_target, adjusted_target = excluded.adjusted_target, target_id = excluded.target_id, actual_calls = excluded.actual_calls,
         connected_calls = excluded.connected_calls, not_connected_calls = excluded.not_connected_calls, incoming_calls = excluded.incoming_calls,
         missed_calls = excluded.missed_calls, unique_contacts = excluded.unique_contacts, talk_seconds = excluded.talk_seconds, achievement = excluded.achievement,
         mapping_ok = excluded.mapping_ok, data_complete = excluded.data_complete, reason = excluded.reason, breakdown = excluded.breakdown, computed_at = now(),
         finalized_at = coalesce(z.finalized_at, excluded.finalized_at)
  returning * into w;
  return w;
end $$;
revoke all on function private.tc_compute_week(uuid, date, boolean) from public, anon, authenticated;

-- the Monday of a day's week
create or replace function private.tc_week_of(p_day date)
returns date language sql immutable set search_path = '' as $$ select p_day - (extract(isodow from p_day)::int - 1) $$;

-- ---------------------------------------------------------------------------
-- 4. The review meeting
-- ---------------------------------------------------------------------------
-- a slot free for HR (their availability and meetings, through the meetings engine) and the Telecaller (a working day for them, no leave, no other
-- meeting they attend), within the next 10 working days; null when none
create or replace function private.tc_find_slot(p_hr uuid, p_employee uuid, p_minutes integer)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := now() + interval '1 day';
  v_slot timestamptz;
  v_day date;
  r record;
begin
  for i in 1..25 loop
    v_slot := private.mtg_next_free_slot(p_hr, v_from, p_minutes);
    if v_slot is null then return null; end if;
    v_day := (v_slot at time zone 'Asia/Kolkata')::date;
    if v_day > private.office_today() + 21 then return null; end if;
    select * into r from private.att_day_rows(v_day, v_day, array[p_employee]);
    if r.scheduled and r.status not in ('APPROVED_LEAVE', 'HALF_DAY')
       and not exists (select 1 from public.meetings m join public.meeting_attendees a on a.meeting_id = m.id
                        where (a.profile_id = p_employee or m.host_id = p_employee) and m.status in ('REQUESTED', 'PROPOSED', 'SCHEDULED', 'PENDING_AVAILABILITY')
                          and tstzrange(m.starts_at, m.ends_at) && tstzrange(v_slot, v_slot + make_interval(mins => p_minutes))) then
      return v_slot;
    end if;
    v_from := v_slot + interval '15 minutes';
  end loop;
  return null;
end $$;
revoke all on function private.tc_find_slot(uuid, uuid, integer) from public, anon, authenticated;

-- create / move / cancel the review meeting of a week (a mirror in the meetings engine: one per week, never two) and tell the people on it
create or replace function private.tc_meeting_write(w public.telecaller_weekly_performance, p_hr uuid, p_start timestamptz, p_status text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  x public.profiles;
  pol public.telecaller_review_policy;
  v_id uuid;
  v_title text;
  v_desc text;
  v_when text;
  r record;
  v_hr public.profiles;
begin
  select * into x from public.profiles where id = w.profile_id;
  select * into pol from public.telecaller_review_policy where id;
  select * into v_hr from public.profiles where id = p_hr;
  v_title := 'Performance Review Meeting — ' || x.full_name;
  v_desc := 'Employee: ' || x.full_name || E'\nDepartment: ' || coalesce((select d.name from public.departments d where d.id = w.department_id), '') ||
    E'\nEvaluation Period: ' || to_char(w.week_start, 'DD Mon YYYY') || ' to ' || to_char(w.week_end, 'DD Mon YYYY') ||
    E'\nAdjusted Weekly Target: ' || coalesce(w.adjusted_target::text, '-') || E'\nActual Calls: ' || w.actual_calls ||
    E'\nAchievement: ' || coalesce(w.achievement::text || '%', '-') || E'\nReason for Review: ' || coalesce(w.review_reason, 'Weekly call target review') ||
    E'\n\nDiscussion objectives:\n- Understand the reasons for the performance gap\n- Identify technical or operational challenges\n- Identify training and support requirements\n- Agree achievable improvement expectations\n- Schedule a follow-up evaluation where required';
  perform private.mtg_mirror('performance_review', w.id, 'HR_MEETING', v_title, v_desc, p_hr, p_hr, p_start, p_start + make_interval(mins => pol.meeting_minutes),
    'IN_PERSON', null, null, p_status, null, null, null, w.profile_id, null);
  select id into v_id from public.meetings where source_type = 'performance_review' and source_id = w.id;
  -- the optional participants the policy names (never anybody else)
  for r in
    select private.direct_lead_of(x.id) as pid where pol.invite_team_lead
    union select h.id from public.profiles h where pol.invite_department_head and h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE'
                                             and private.head_covers(h.id, private.base_department(x.department_id), x.team_id)
    union select private.operations_owner_for(x.department_id, 'SALES') where pol.invite_operations_head
  loop
    if r.pid is not null and r.pid not in (p_hr, x.id) then
      insert into public.meeting_attendees (meeting_id, profile_id, role) values (v_id, r.pid, 'OPTIONAL') on conflict do nothing;
    end if;
  end loop;
  v_when := to_char(p_start at time zone 'Asia/Kolkata', 'Dy DD Mon YYYY, HH12:MI AM');
  -- in-app to everyone on the meeting; the invitation by e-mail to the Telecaller (the HR queue; no performance label in either)
  for r in select a.profile_id as pid from public.meeting_attendees a where a.meeting_id = v_id and a.profile_id is not null union select p_hr loop
    perform private.notify(r.pid, 'PERFORMANCE_REVIEW_MEETING',
      case p_status when 'CANCELLED' then 'Performance review meeting cancelled' else 'Performance review meeting: ' || v_when end,
      case p_status when 'CANCELLED' then x.full_name || '''s review meeting on ' || v_when || ' was cancelled.'
                    else 'With ' || coalesce(v_hr.full_name, 'HR') || ' about the week of ' || to_char(w.week_start, 'DD Mon') || '. Open Meetings for the details or to ask for another time.' end,
      'meeting', v_id, jsonb_build_object('meetingId', v_id, 'performanceId', w.id), 'normal');
  end loop;
  perform private.hr_enqueue('PERFORMANCE_REVIEW_MEETING:' || w.id || ':' || coalesce((select version from public.meetings where id = v_id), 1), 'PERFORMANCE_REVIEW_MEETING',
    x.id::text, x.id, null, lower(x.email), x.full_name,
    jsonb_build_object('employeeName', x.full_name, 'meetingAt', p_start, 'meetingStatus', p_status, 'hrName', coalesce(v_hr.full_name, 'HR'),
                       'weekStart', w.week_start, 'weekEnd', w.week_end, 'minutes', pol.meeting_minutes, 'meetingId', v_id),
    private.office_today(), now());
  return v_id;
end $$;
revoke all on function private.tc_meeting_write(public.telecaller_weekly_performance, uuid, timestamptz, text) from public, anon, authenticated;

-- Should this FINAL week open a review? (policy on, below the threshold for the required consecutive weeks, not too soon, not too many, not excluded,
-- no unresolved review or open improvement plan for the same person)
create or replace function private.tc_review_due(w public.telecaller_weekly_performance)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  pol public.telecaller_review_policy;
  v_low integer;
begin
  select * into pol from public.telecaller_review_policy where id;
  if not pol.enabled or pol.approved_at is null then return null; end if;
  if w.status <> 'FINAL' or w.achievement is null or w.achievement >= pol.review_below_pct or w.eligible_days < pol.min_working_days then return null; end if;
  if w.profile_id = any (pol.excluded_profiles) then return null; end if;
  select count(*) into v_low from public.telecaller_weekly_performance z
   where z.profile_id = w.profile_id and z.status = 'FINAL' and z.achievement is not null and z.achievement < pol.review_below_pct
     and z.week_start > w.week_start - 7 * pol.consecutive_weeks and z.week_start <= w.week_start;
  if v_low < pol.consecutive_weeks then return null; end if;
  if exists (select 1 from public.telecaller_weekly_performance z where z.profile_id = w.profile_id and z.id <> w.id
               and (z.review_status in ('PENDING_SCHEDULING', 'SCHEDULED')
                 or (z.review_status = 'COMPLETED' and z.week_start > w.week_start - pol.min_days_between_reviews)))
     or exists (select 1 from public.performance_improvement_plans ip where ip.profile_id = w.profile_id and ip.status = 'OPEN') then
    return null;
  end if;
  if (select count(*) from public.telecaller_weekly_performance z where z.profile_id = w.profile_id and z.review_status in ('SCHEDULED', 'COMPLETED', 'PENDING_SCHEDULING'))
     >= pol.max_auto_reviews then
    return null;
  end if;
  return format('Achievement %s%% of the adjusted target, below %s%%%s.', w.achievement, pol.review_below_pct,
                case when pol.consecutive_weeks > 1 then format(' for %s consecutive weeks', pol.consecutive_weeks) else '' end);
end $$;
revoke all on function private.tc_review_due(public.telecaller_weekly_performance) from public, anon, authenticated;

create or replace function private.tc_hr_reviewer()
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce((select p.id from public.telecaller_review_policy pol join public.profiles p on p.id = pol.hr_reviewer_id and p.status = 'ACTIVE' where pol.id),
                  (select p.id from public.profiles p join public.departments d on d.id = p.department_id
                    where d.slug = 'hr' and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' order by p.created_at limit 1))
$$;
revoke all on function private.tc_hr_reviewer() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The weekly run (the existing scheduler, nobody signed in): last week's figures, finalised once the call logs are in, then the reviews
-- ---------------------------------------------------------------------------
create or replace function public.tc_weekly_run(p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := coalesce(p_today, private.office_today());
  v_last date := private.tc_week_of(v_today) - 7;
  x record;
  w public.telecaller_weekly_performance;
  v_reason text;
  v_hr uuid := private.tc_hr_reviewer();
  v_slot timestamptz;
  v_n integer := 0;
  v_final integer := 0;
  v_reviews integer := 0;
  v_pending integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('tc_weekly_run')) then
    return jsonb_build_object('skipped', 'another run is in progress');
  end if;
  for x in select p.id from public.profiles p where p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER' and p.sales_sub_role = 'TELECALLER' loop
    -- last week (finalised when complete), and the week before if it is still preliminary (late call logs)
    for i in 0..1 loop
      continue when exists (select 1 from public.telecaller_weekly_performance z where z.profile_id = x.id and z.week_start = v_last - 7 * i and z.status = 'FINAL');
      w := private.tc_compute_week(x.id, v_last - 7 * i);
      v_n := v_n + 1;
      if w.status = 'FINAL' then v_final := v_final + 1; end if;
    end loop;
    -- this week so far (preliminary, for the dashboards)
    perform private.tc_compute_week(x.id, private.tc_week_of(v_today));
  end loop;
  -- the reviews of final weeks (one per concern)
  -- each person's latest final week (the consecutive-week rule looks back from it)
  for w in select distinct on (z.profile_id) * from public.telecaller_weekly_performance z
            where z.status = 'FINAL' and z.week_start >= v_last - 7 order by z.profile_id, z.week_start desc loop
    continue when w.review_status <> 'NONE';
    v_reason := private.tc_review_due(w);
    if v_reason is null then continue; end if;
    update public.telecaller_weekly_performance set review_reason = v_reason where id = w.id returning * into w;
    v_slot := case when v_hr is null then null else private.tc_find_slot(v_hr, w.profile_id, (select meeting_minutes from public.telecaller_review_policy where id)) end;
    if v_slot is null then
      update public.telecaller_weekly_performance set review_status = 'PENDING_SCHEDULING' where id = w.id;
      for x in select v_hr as pid union select p.id from public.profiles p join public.departments d on d.id = p.department_id where d.slug = 'hr' and p.role = 'DEPARTMENT_HEAD' and p.status = 'ACTIVE' loop
        perform private.notify_once(x.pid, 'PERFORMANCE_REVIEW_PENDING', 'Performance review to schedule',
          'A Telecaller performance review is waiting for a meeting time (no common free slot was found).', 'telecaller_performance', w.id,
          jsonb_build_object('performanceId', w.id), 'normal');
      end loop;
      v_pending := v_pending + 1;
    else
      perform private.tc_meeting_write(w, v_hr, v_slot, 'SCHEDULED');
      update public.telecaller_weekly_performance set review_status = 'SCHEDULED', meeting_id = (select id from public.meetings where source_type = 'performance_review' and source_id = w.id)
       where id = w.id;
      v_reviews := v_reviews + 1;
    end if;
    perform private.write_audit('PERFORMANCE_REVIEW_OPENED', 'telecaller_performance', w.id, w.department_id, w.team_id,
      jsonb_build_object('week', w.week_start, 'achievement', w.achievement, 'scheduled', v_slot is not null));
  end loop;
  insert into public.hr_automation_state (key, value, updated_at)
  values ('telecaller_weekly', jsonb_build_object('ranAt', now(), 'week', v_last, 'computed', v_n, 'finalised', v_final, 'meetings', v_reviews, 'pendingScheduling', v_pending), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
  return jsonb_build_object('week', v_last, 'computed', v_n, 'finalised', v_final, 'meetings', v_reviews, 'pendingScheduling', v_pending);
end $$;
revoke all on function public.tc_weekly_run(date) from public, anon, authenticated;
grant execute on function public.tc_weekly_run(date) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Reading
-- ---------------------------------------------------------------------------
create or replace function private.tc_row_json(w public.telecaller_weekly_performance)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', w.id, 'profileId', w.profile_id, 'name', p.full_name,
    'employeeCode', coalesce((select h.id from public.hr_employees h where h.profile_id = p.id order by h.created_at limit 1), 'EMP-' || upper(left(p.id::text, 8))),
    'department', (select d.name from public.departments d where d.id = w.department_id), 'team', (select t.name from public.teams t where t.id = w.team_id),
    'weekStart', w.week_start, 'weekEnd', w.week_end, 'status', w.status, 'category', w.category, 'reason', w.reason,
    'scheduledDays', w.scheduled_days, 'leaveDays', w.leave_days, 'eligibleDays', w.eligible_days, 'dailyTarget', w.daily_target, 'weeklyTarget', w.weekly_target,
    'adjustedTarget', w.adjusted_target, 'actualCalls', w.actual_calls, 'connectedCalls', w.connected_calls, 'notConnectedCalls', w.not_connected_calls,
    'incomingCalls', w.incoming_calls, 'missedCalls', w.missed_calls, 'uniqueContacts', w.unique_contacts, 'talkSeconds', w.talk_seconds,
    'averageConnectedSeconds', case when w.connected_calls > 0 then w.talk_seconds / w.connected_calls end,
    'connectionRate', case when w.actual_calls > 0 then round(w.connected_calls * 100.0 / w.actual_calls, 1) end,
    'achievement', w.achievement, 'mappingOk', w.mapping_ok, 'dataComplete', w.data_complete, 'breakdown', w.breakdown, 'computedAt', w.computed_at,
    'finalizedAt', w.finalized_at, 'recalcCount', w.recalc_count, 'reviewStatus', w.review_status, 'reviewReason', w.review_reason, 'meetingId', w.meeting_id,
    'meeting', (select jsonb_build_object('id', m.id, 'startsAt', m.starts_at, 'status', m.status) from public.meetings m where m.id = w.meeting_id),
    'previousAchievement', (select z.achievement from public.telecaller_weekly_performance z where z.profile_id = w.profile_id and z.week_start = w.week_start - 7),
    -- what the provider does not give is unavailable, never zero
    'unavailable', jsonb_build_array('dispositions', 'qualifiedLeads', 'campaign', 'callQuality'))
    from public.profiles p where p.id = w.profile_id
$$;
revoke all on function private.tc_row_json(public.telecaller_weekly_performance) from public, anon, authenticated;

-- f: { weekStart, departmentId, teamId, profileId, category, reviewStatus }. Scope: HR all; others the Telecallers they may see.
create or replace function public.tc_performance_list(f jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_week date := coalesce(case when f ->> 'weekStart' ~ '^\d{4}-\d{2}-\d{2}$' then private.tc_week_of((f ->> 'weekStart')::date) end, private.tc_week_of(private.office_today()) - 7);
  v_dept uuid := case when f ->> 'departmentId' ~* '^[0-9a-f-]{36}$' then (f ->> 'departmentId')::uuid end;
  v_team uuid := case when f ->> 'teamId' ~* '^[0-9a-f-]{36}$' then (f ->> 'teamId')::uuid end;
  v_person uuid := case when f ->> 'profileId' ~* '^[0-9a-f-]{36}$' then (f ->> 'profileId')::uuid end;
  v_cat text := nullif(f ->> 'category', '');
  v_rev text := nullif(f ->> 'reviewStatus', '');
  v_rows jsonb;
  v_cards jsonb;
  v_sync jsonb;
begin
  if auth.uid() is null then raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501'; end if;
  with vis as (
    select w.* from public.telecaller_weekly_performance w join public.profiles p on p.id = w.profile_id
     where w.week_start = v_week and private.tc_can_view(w.profile_id)
       and (v_dept is null or w.department_id = private.base_department(v_dept)) and (v_team is null or w.team_id = v_team)
       and (v_person is null or w.profile_id = v_person)
  )
  select (select coalesce(jsonb_agg(private.tc_row_json(v) order by v.achievement nulls last, p.full_name), '[]'::jsonb)
            from vis v join public.profiles p on p.id = v.profile_id where (v_cat is null or v.category = v_cat) and (v_rev is null or v.review_status = v_rev)),
         (select jsonb_build_object('telecallers', (select count(*) from public.profiles p where p.status = 'ACTIVE' and p.sales_sub_role = 'TELECALLER' and p.role = 'TEAM_MEMBER' and private.tc_can_view(p.id)),
                   'evaluated', count(*) filter (where v.achievement is not null), 'achieved', count(*) filter (where v.category = 'TARGET_ACHIEVED'),
                   'onTrack', count(*) filter (where v.category = 'ON_TRACK'), 'needsImprovement', count(*) filter (where v.category = 'NEEDS_IMPROVEMENT'),
                   'low', count(*) filter (where v.category = 'LOW_PERFORMANCE'), 'insufficient', count(*) filter (where v.category in ('INSUFFICIENT_DATA', 'SYNC_PENDING', 'NOT_EVALUATED', 'DATA_PENDING')),
                   'average', round(avg(v.achievement), 1),
                   'pendingMeetings', (select count(*) from public.telecaller_weekly_performance z where z.review_status in ('PENDING_SCHEDULING', 'SCHEDULED') and private.tc_can_view(z.profile_id)),
                   'completedMeetings', (select count(*) from public.telecaller_weekly_performance z where z.review_status = 'COMPLETED' and private.tc_can_view(z.profile_id)))
            from vis v)
    into v_rows, v_cards;
  select jsonb_agg(jsonb_build_object('connection', c.name, 'lastOkAt', s.last_ok_at, 'error', s.last_error)) into v_sync
    from public.crocodial_connections c left join public.crocodial_sync_state s on s.connection_id = c.id and s.resource = 'call-logs';
  return jsonb_build_object('weekStart', v_week, 'weekEnd', v_week + 6, 'rows', v_rows, 'cards', v_cards, 'sync', coalesce(v_sync, '[]'::jsonb),
    'policy', (select jsonb_build_object('enabled', pol.enabled, 'approvedAt', pol.approved_at, 'achievedPct', pol.achieved_pct, 'onTrackPct', pol.on_track_pct,
                 'needsImprovementPct', pol.needs_improvement_pct, 'reviewBelowPct', pol.review_below_pct) from public.telecaller_review_policy pol where pol.id),
    'canManage', private.tc_can_manage(v_dept) or private.is_hr_staff(), 'isHr', private.is_hr_staff(),
    'lastRun', (select value from public.hr_automation_state where key = 'telecaller_weekly'));
end $$;
revoke all on function public.tc_performance_list(jsonb) from public, anon;
grant execute on function public.tc_performance_list(jsonb) to authenticated;

-- one Telecaller: daily calls (this week, live), the weekly history, reviews, reports and plans
create or replace function public.tc_performance_profile(p uuid, p_weeks integer default 12)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_week date := private.tc_week_of(private.office_today());
  v_self boolean := p = auth.uid();
  v_hr boolean := private.is_hr_staff();
  t public.telecaller_targets;
begin
  if not private.tc_can_view(p) or not private.tc_is_telecaller(p) then raise exception 'NOT_FOUND: Telecaller not found.' using errcode = 'P0001'; end if;
  t := private.tc_target_for(p, private.office_today());
  return jsonb_build_object(
    'profileId', p, 'name', (select full_name from public.profiles where id = p), 'isSelf', v_self, 'isHr', v_hr,
    'today', private.office_today(), 'dailyTarget', t.daily_calls, 'weeklyTarget', t.weekly_calls,
    'todayCalls', coalesce((select c.outgoing from private.tc_calls(p, private.office_today(), private.office_today()) c), 0),
    'thisWeek', (select private.tc_row_json(w) from public.telecaller_weekly_performance w where w.profile_id = p and w.week_start = v_week),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', c.day, 'calls', c.outgoing, 'connected', c.connected, 'talkSeconds', c.talk_seconds) order by c.day)
                        from private.tc_calls(p, v_week - 21, private.office_today()) c), '[]'::jsonb),
    'weeks', coalesce((select jsonb_agg(private.tc_row_json(w) order by w.week_start desc) from (select * from public.telecaller_weekly_performance z
                        where z.profile_id = p order by z.week_start desc limit least(52, greatest(1, p_weeks))) w), '[]'::jsonb),
    -- meeting reports and plans: HR and the managers who may see this Telecaller; the Telecaller sees their own plans and meetings, not HR's notes
    'reports', case when v_self and not v_hr then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'meetingId', r.meeting_id, 'outcome', r.outcome,
                   'fields', r.fields, 'actionItems', r.action_items, 'followUpDate', r.follow_up_date, 'by', (select full_name from public.profiles where id = r.reviewer_id),
                   'at', r.created_at) order by r.created_at desc) from public.performance_review_reports r where r.profile_id = p), '[]'::jsonb) end,
    'plans', coalesce((select jsonb_agg(jsonb_build_object('id', ip.id, 'targets', ip.targets, 'support', ip.support, 'startDate', ip.start_date, 'deadline', ip.review_deadline,
                   'status', ip.status, 'closedRemarks', case when v_self and not v_hr then null else ip.closed_remarks end, 'closedAt', ip.closed_at) order by ip.created_at desc)
                 from public.performance_improvement_plans ip where ip.profile_id = p), '[]'::jsonb),
    'meetings', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'title', m.title, 'startsAt', m.starts_at, 'status', m.status) order by m.starts_at desc)
                 from public.meetings m where m.source_type = 'performance_review' and m.source_id in (select id from public.telecaller_weekly_performance where profile_id = p)), '[]'::jsonb),
    'actionItems', coalesce((select jsonb_agg(a) from public.performance_review_reports r, jsonb_array_elements(r.action_items) a
                 where r.profile_id = p and r.created_at > now() - interval '90 days'), '[]'::jsonb));
end $$;
revoke all on function public.tc_performance_profile(uuid, integer) from public, anon;
grant execute on function public.tc_performance_profile(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Writing: targets, policy, recalculation, manual scheduling, reports, plans
-- ---------------------------------------------------------------------------
-- p: { scopeType, departmentId, teamId, designation, profileId, dailyCalls, weeklyCalls, effectiveFrom, note }. The current target of that
-- scope ends the day before; the history stays. Finalised weeks keep the target they were calculated with.
create or replace function public.tc_target_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_scope text := upper(coalesce(p ->> 'scopeType', ''));
  v_dept uuid := case when p ->> 'departmentId' ~* '^[0-9a-f-]{36}$' then (p ->> 'departmentId')::uuid end;
  v_team uuid := case when p ->> 'teamId' ~* '^[0-9a-f-]{36}$' then (p ->> 'teamId')::uuid end;
  v_person uuid := case when p ->> 'profileId' ~* '^[0-9a-f-]{36}$' then (p ->> 'profileId')::uuid end;
  v_from date := case when p ->> 'effectiveFrom' ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'effectiveFrom')::date end;
  v_check uuid;
  t public.telecaller_targets;
begin
  if v_scope not in ('DEPARTMENT', 'TEAM', 'DESIGNATION', 'EMPLOYEE') then raise exception 'VALIDATION_ERROR: Choose where the target applies.' using errcode = 'P0001'; end if;
  v_check := coalesce(v_dept, (select t2.department_id from public.teams t2 where t2.id = v_team), (select x.department_id from public.profiles x where x.id = v_person));
  if v_scope = 'TEAM' then v_dept := null; end if;
  if v_scope = 'EMPLOYEE' then v_dept := null; v_team := null; end if;
  if not private.tc_can_manage(v_check) then raise exception 'FORBIDDEN: Only the department''s head, its CEO, the HR Department Head or the Super Admin set call targets.' using errcode = '42501'; end if;
  if v_from is null or v_from < private.office_today() - 365 then raise exception 'VALIDATION_ERROR: Choose the date the target starts.' using errcode = 'P0001'; end if;
  if v_scope = 'EMPLOYEE' and not private.tc_is_telecaller(v_person) then raise exception 'VALIDATION_ERROR: Choose a Telecaller.' using errcode = 'P0001'; end if;
  update public.telecaller_targets x set effective_to = v_from - 1, ended_by = auth.uid()
   where x.scope_type = v_scope and x.department_id is not distinct from case when v_scope in ('DEPARTMENT', 'DESIGNATION') then v_dept end
     and x.team_id is not distinct from case when v_scope = 'TEAM' then v_team end and x.profile_id is not distinct from case when v_scope = 'EMPLOYEE' then v_person end
     and lower(coalesce(x.designation, '')) = lower(coalesce(case when v_scope = 'DESIGNATION' then p ->> 'designation' end, ''))
     and (x.effective_to is null or x.effective_to >= v_from) and x.effective_from < v_from;
  delete from public.telecaller_targets x
   where x.scope_type = v_scope and x.effective_from >= v_from and x.department_id is not distinct from case when v_scope in ('DEPARTMENT', 'DESIGNATION') then v_dept end
     and x.team_id is not distinct from case when v_scope = 'TEAM' then v_team end and x.profile_id is not distinct from case when v_scope = 'EMPLOYEE' then v_person end
     and lower(coalesce(x.designation, '')) = lower(coalesce(case when v_scope = 'DESIGNATION' then p ->> 'designation' end, ''))
     and not exists (select 1 from public.telecaller_weekly_performance w where w.target_id = x.id and w.status = 'FINAL');
  insert into public.telecaller_targets (scope_type, department_id, team_id, designation, profile_id, daily_calls, weekly_calls, effective_from, note, created_by)
  values (v_scope, case when v_scope in ('DEPARTMENT', 'DESIGNATION') then v_dept end, case when v_scope = 'TEAM' then v_team end,
          case when v_scope = 'DESIGNATION' then nullif(btrim(p ->> 'designation'), '') end, case when v_scope = 'EMPLOYEE' then v_person end,
          (p ->> 'dailyCalls')::int, nullif(p ->> 'weeklyCalls', '')::int, v_from, nullif(left(btrim(coalesce(p ->> 'note', '')), 500), ''), auth.uid())
  returning * into t;
  perform private.write_audit('TELECALLER_TARGET_SET', 'telecaller_target', t.id, v_check, v_team,
    jsonb_build_object('scope', v_scope, 'daily', t.daily_calls, 'weekly', t.weekly_calls, 'from', v_from));
  return public.tc_targets_list();
exception when check_violation or invalid_text_representation then
  raise exception 'VALIDATION_ERROR: The daily target is a number of calls (1 to 2000).' using errcode = 'P0001';
end $$;
revoke all on function public.tc_target_set(jsonb) from public, anon;
grant execute on function public.tc_target_set(jsonb) to authenticated;

create or replace function public.tc_targets_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_hr_staff() or private.tc_can_manage(null) or exists (select 1 from public.profiles me where me.id = auth.uid() and me.role in ('DEPARTMENT_HEAD', 'TEAM_HEAD'))) then
    raise exception 'FORBIDDEN: Not allowed.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'scopeType', t.scope_type, 'department', (select d.name from public.departments d where d.id = t.department_id),
            'team', (select x.name from public.teams x where x.id = t.team_id), 'designation', t.designation, 'employee', (select x.full_name from public.profiles x where x.id = t.profile_id),
            'dailyCalls', t.daily_calls, 'weeklyCalls', t.weekly_calls, 'effectiveFrom', t.effective_from, 'effectiveTo', t.effective_to, 'note', t.note,
            'by', (select x.full_name from public.profiles x where x.id = t.created_by), 'at', t.created_at,
            'canManage', private.tc_can_manage(coalesce(t.department_id, (select x.department_id from public.teams x where x.id = t.team_id), (select x.department_id from public.profiles x where x.id = t.profile_id))))
          order by (t.effective_to is null) desc, t.effective_from desc)
     from public.telecaller_targets t), '[]'::jsonb);
end $$;
revoke all on function public.tc_targets_list() from public, anon;
grant execute on function public.tc_targets_list() to authenticated;

-- the review policy (HR Department Head, a CEO or the Super Admin). Switching the automatic meetings on records who approved the thresholds.
create or replace function public.tc_policy_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pol public.telecaller_review_policy;
  v_on boolean := coalesce((p ->> 'enabled')::boolean, false);
begin
  if not (private.rv_can_decide_exception() or exists (select 1 from public.profiles me where me.id = auth.uid() and me.status = 'ACTIVE' and me.role = 'DEPARTMENT_HEAD' and me.is_operations_head)) then
    raise exception 'FORBIDDEN: Only the HR Department Head, a CEO or the Super Admin approve the performance review policy.' using errcode = '42501';
  end if;
  update public.telecaller_review_policy set
    achieved_pct = coalesce((p ->> 'achievedPct')::numeric, achieved_pct), on_track_pct = coalesce((p ->> 'onTrackPct')::numeric, on_track_pct),
    needs_improvement_pct = coalesce((p ->> 'needsImprovementPct')::numeric, needs_improvement_pct), review_below_pct = coalesce((p ->> 'reviewBelowPct')::numeric, review_below_pct),
    min_working_days = coalesce((p ->> 'minWorkingDays')::numeric, min_working_days), consecutive_weeks = coalesce((p ->> 'consecutiveWeeks')::int, consecutive_weeks),
    min_days_between_reviews = coalesce((p ->> 'minDaysBetweenReviews')::int, min_days_between_reviews), max_auto_reviews = coalesce((p ->> 'maxAutoReviews')::int, max_auto_reviews),
    meeting_minutes = coalesce((p ->> 'meetingMinutes')::int, meeting_minutes),
    invite_department_head = coalesce((p ->> 'inviteDepartmentHead')::boolean, invite_department_head), invite_team_lead = coalesce((p ->> 'inviteTeamLead')::boolean, invite_team_lead),
    invite_operations_head = coalesce((p ->> 'inviteOperationsHead')::boolean, invite_operations_head),
    hr_reviewer_id = case when p ? 'hrReviewerId' then nullif(p ->> 'hrReviewerId', '')::uuid else hr_reviewer_id end,
    excluded_profiles = case when p ? 'excludedProfiles' then private.att_uuid_list(p -> 'excludedProfiles') else excluded_profiles end,
    enabled = v_on, approved_by = case when v_on then auth.uid() else approved_by end, approved_at = case when v_on then now() else approved_at end,
    updated_by = auth.uid(), updated_at = now()
   where id returning * into pol;
  perform private.write_audit('TELECALLER_POLICY_SET', 'telecaller_policy', null, null, null, to_jsonb(pol) - 'excluded_profiles');
  return to_jsonb(pol);
exception when check_violation then
  raise exception 'VALIDATION_ERROR: The thresholds must go down: achieved >= on track >= needs improvement.' using errcode = 'P0001';
end $$;
revoke all on function public.tc_policy_set(jsonb) from public, anon;
grant execute on function public.tc_policy_set(jsonb) to authenticated;

create or replace function public.tc_policy_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501'; end if;
  return (select to_jsonb(pol) || jsonb_build_object('approvedByName', (select full_name from public.profiles where id = pol.approved_by),
            'canEdit', private.rv_can_decide_exception() or exists (select 1 from public.profiles me where me.id = auth.uid() and me.status = 'ACTIVE' and me.role = 'DEPARTMENT_HEAD' and me.is_operations_head))
            from public.telecaller_review_policy pol where pol.id);
end $$;
revoke all on function public.tc_policy_get() from public, anon;
grant execute on function public.tc_policy_get() to authenticated;

-- an authorised recalculation of a finalised week (late call logs, a corrected target), with the reason and the before / after kept
create or replace function public.tc_recalculate(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.telecaller_weekly_performance;
  v_before jsonb;
begin
  select * into w from public.telecaller_weekly_performance where id = p_id for update;
  if w.id is null or not private.tc_can_view(w.profile_id) then raise exception 'NOT_FOUND: Week not found.' using errcode = 'P0001'; end if;
  if not (private.is_hr_staff() or private.tc_can_manage(w.department_id)) then raise exception 'FORBIDDEN: Only HR or the department''s head recalculate a week.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'VALIDATION_ERROR: Say why the week is recalculated.' using errcode = 'P0001'; end if;
  v_before := private.tc_row_json(w);
  w := private.tc_compute_week(w.profile_id, w.week_start, true);
  update public.telecaller_weekly_performance set recalc_count = recalc_count + 1 where id = w.id returning * into w;
  insert into public.telecaller_performance_recalcs (performance_id, before, after, reason, recalculated_by) values (w.id, v_before, private.tc_row_json(w), left(btrim(p_reason), 1000), auth.uid());
  perform private.write_audit('TELECALLER_WEEK_RECALCULATED', 'telecaller_performance', w.id, w.department_id, w.team_id, jsonb_build_object('reason', left(p_reason, 200)));
  return private.tc_row_json(w);
end $$;
revoke all on function public.tc_recalculate(uuid, text) from public, anon;
grant execute on function public.tc_recalculate(uuid, text) to authenticated;

-- HR schedules (or moves / cancels) a review meeting: a pending one, a reschedule, or a review HR opens by hand
create or replace function public.tc_review_schedule(p_id uuid, p_starts_at timestamptz, p_cancel boolean default false, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.telecaller_weekly_performance;
  v_hr uuid := auth.uid();
begin
  select * into w from public.telecaller_weekly_performance where id = p_id for update;
  if w.id is null then raise exception 'NOT_FOUND: Week not found.' using errcode = 'P0001'; end if;
  if not private.is_hr_staff() then raise exception 'FORBIDDEN: Only HR schedules performance review meetings.' using errcode = '42501'; end if;
  if w.review_status = 'COMPLETED' then raise exception 'CONFLICT: This review was completed.' using errcode = 'P0001'; end if;
  if p_cancel then
    if w.meeting_id is null then raise exception 'CONFLICT: There is no meeting to cancel.' using errcode = 'P0001'; end if;
    perform private.tc_meeting_write(w, (select host_id from public.meetings where id = w.meeting_id), (select starts_at from public.meetings where id = w.meeting_id), 'CANCELLED');
    update public.telecaller_weekly_performance set review_status = 'CANCELLED' where id = w.id returning * into w;
  else
    if p_starts_at is null or p_starts_at < now() then raise exception 'VALIDATION_ERROR: Choose a future time.' using errcode = 'P0001'; end if;
    if private.mtg_host_conflict(v_hr, p_starts_at, p_starts_at + make_interval(mins => (select meeting_minutes from public.telecaller_review_policy where id)), w.meeting_id) is not null then
      raise exception 'CONFLICT: You already have a meeting at that time.' using errcode = 'P0001';
    end if;
    if w.review_reason is null then
      update public.telecaller_weekly_performance set review_reason = coalesce(nullif(left(btrim(coalesce(p_note, '')), 300), ''), 'Weekly call target review (opened by HR).') where id = w.id returning * into w;
    end if;
    perform private.tc_meeting_write(w, v_hr, p_starts_at, 'SCHEDULED');
    update public.telecaller_weekly_performance set review_status = 'SCHEDULED',
           meeting_id = (select id from public.meetings where source_type = 'performance_review' and source_id = w.id) where id = w.id returning * into w;
  end if;
  perform private.write_audit(case when p_cancel then 'PERFORMANCE_REVIEW_CANCELLED' else 'PERFORMANCE_REVIEW_SCHEDULED' end, 'telecaller_performance', w.id, w.department_id, w.team_id,
    jsonb_build_object('startsAt', p_starts_at));
  return private.tc_row_json(w);
end $$;
revoke all on function public.tc_review_schedule(uuid, timestamptz, boolean, text) from public, anon;
grant execute on function public.tc_review_schedule(uuid, timestamptz, boolean, text) to authenticated;

-- HR's report after the meeting; an improvement plan when the outcome is one. The meeting is marked completed. Nothing disciplinary is created.
create or replace function public.tc_review_report(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.telecaller_weekly_performance;
  v_out text := upper(coalesce(p ->> 'outcome', ''));
  v_report uuid;
  v_plan jsonb := p -> 'plan';
begin
  select * into w from public.telecaller_weekly_performance where id = p_id for update;
  if w.id is null then raise exception 'NOT_FOUND: Week not found.' using errcode = 'P0001'; end if;
  if not private.is_hr_staff() then raise exception 'FORBIDDEN: Only HR submits the performance review report.' using errcode = '42501'; end if;
  if w.review_status not in ('SCHEDULED', 'PENDING_SCHEDULING') then raise exception 'CONFLICT: There is no open review for this week.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p -> 'fields' ->> 'performanceGap', ''))) < 5 or length(btrim(coalesce(p -> 'fields' ->> 'hrObservations', ''))) < 5 then
    raise exception 'VALIDATION_ERROR: Record the performance gap and your observations.' using errcode = 'P0001';
  end if;
  insert into public.performance_review_reports (performance_id, meeting_id, profile_id, reviewer_id, fields, action_items, outcome, follow_up_date)
  values (w.id, w.meeting_id, w.profile_id, auth.uid(), coalesce(p -> 'fields', '{}'::jsonb), coalesce(p -> 'actionItems', '[]'::jsonb), v_out,
          case when p ->> 'followUpDate' ~ '^\d{4}-\d{2}-\d{2}$' then (p ->> 'followUpDate')::date end)
  returning id into v_report;
  update public.telecaller_weekly_performance set review_status = 'COMPLETED' where id = w.id;
  update public.meetings set status = 'COMPLETED', updated_at = now() where id = w.meeting_id and status = 'SCHEDULED';
  if v_out = 'IMPROVEMENT_PLAN' or v_plan is not null then
    if v_plan is null or length(btrim(coalesce(v_plan ->> 'targets', ''))) < 5 or coalesce(v_plan ->> 'deadline', '') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'VALIDATION_ERROR: An improvement plan needs the agreed targets and the review deadline.' using errcode = 'P0001';
    end if;
    insert into public.performance_improvement_plans (profile_id, report_id, targets, support, start_date, review_deadline, created_by)
    values (w.profile_id, v_report, left(v_plan ->> 'targets', 4000), nullif(left(coalesce(v_plan ->> 'support', ''), 4000), ''),
            coalesce(case when v_plan ->> 'startDate' ~ '^\d{4}-\d{2}-\d{2}$' then (v_plan ->> 'startDate')::date end, private.office_today()), (v_plan ->> 'deadline')::date, auth.uid());
  end if;
  perform private.write_audit('PERFORMANCE_REVIEW_REPORTED', 'telecaller_performance', w.id, w.department_id, w.team_id, jsonb_build_object('outcome', v_out));
  return public.tc_performance_profile(w.profile_id);
exception when check_violation then
  raise exception 'VALIDATION_ERROR: Choose the meeting outcome.' using errcode = 'P0001';
end $$;
revoke all on function public.tc_review_report(uuid, jsonb) from public, anon;
grant execute on function public.tc_review_report(uuid, jsonb) to authenticated;

create or replace function public.tc_plan_close(p_plan uuid, p_remarks text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ip public.performance_improvement_plans;
begin
  if not private.is_hr_staff() then raise exception 'FORBIDDEN: Only HR closes an improvement plan.' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_remarks, ''))) < 5 then raise exception 'VALIDATION_ERROR: Add closing remarks.' using errcode = 'P0001'; end if;
  update public.performance_improvement_plans set status = 'CLOSED', closed_remarks = left(btrim(p_remarks), 4000), closed_by = auth.uid(), closed_at = now()
   where id = p_plan and status = 'OPEN' returning * into ip;
  if ip.id is null then raise exception 'CONFLICT: Only an open plan can be closed.' using errcode = 'P0001'; end if;
  perform private.write_audit('IMPROVEMENT_PLAN_CLOSED', 'improvement_plan', ip.id, null, null, '{}'::jsonb);
  return public.tc_performance_profile(ip.profile_id);
end $$;
revoke all on function public.tc_plan_close(uuid, text) from public, anon;
grant execute on function public.tc_plan_close(uuid, text) to authenticated;

notify pgrst, 'reload schema';
