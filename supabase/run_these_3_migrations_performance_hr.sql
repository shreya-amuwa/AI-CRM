-- =============================================================================
-- Performance Management + HR Recruitment + HR Training: the 3 migrations, in order.
-- Paste the whole file into the Supabase SQL editor and run it once.
-- Every part is idempotent (safe to run again); nothing is deleted.
--   1. 20261116000100_performance_management.sql
--   2. 20261116000200_hr_recruitment.sql
--   3. 20261116000300_hr_training.sql
-- Needs the earlier migrations (HR e-mail automation 20261107000100 and the HR cards 20261115000100) to be applied already.
-- =============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261116000100_performance_management.sql
-- =============================================================================
-- Performance Management (Team Lead and Department Head dashboards). Safe to run again; nothing is deleted.
--
-- The figures are calculated by the database from the real task records (public.work_tasks and public.work_task_updates):
-- assignment date (created_at), deadline (due_date), completion time (completed_at) and the status history. Where a figure cannot be
-- worked out (no deadline, a completed task without a completion time, nobody finished anything) it is NULL, never a guess.
-- A report = those figures (evidence) + a written analysis. The analysis is produced by the server (AI when an API key is configured,
-- otherwise plain rules over the same figures) and stored next to them. Every refresh whose figures changed keeps the previous version.
--
-- Reporting hierarchy: Team Member -> Team Lead -> Department Head. The database enforces who may read or generate what:
--   Team Lead:       the members of their own team, and their own team's overall report
--   Department Head: the Team Leads and members of their own department, each team, and the department
--   Super Admin:     everything (as everywhere else); a Team Member sees none of it
-- =============================================================================

create table if not exists public.performance_reports (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('MEMBER', 'TEAM', 'DEPARTMENT')),
  subject_id uuid references public.profiles(id) on delete cascade,     -- MEMBER: the person the report is about (a member or a Team Lead)
  team_id uuid references public.teams(id) on delete cascade,           -- TEAM: the team; MEMBER: the person's team when it was made
  department_id uuid not null references public.departments(id) on delete cascade,
  subject_name text not null,
  subject_role text,
  period_kind text not null check (period_kind in ('WEEK', 'MONTH', 'CUSTOM')),
  period_start date not null,
  period_end date not null,
  metrics jsonb not null,                                               -- the evidence: everything below is calculated from the task records
  fingerprint text not null,                                            -- hash of the figures: a refresh that changes nothing creates nothing
  source_task_count integer not null default 0,
  narrative jsonb,                                                      -- the written analysis (null until the server has written it)
  narrative_source text check (narrative_source in ('AI', 'RULES')),
  ai_status text not null default 'PENDING' check (ai_status in ('PENDING', 'OK', 'FAILED', 'NOT_CONFIGURED')),
  ai_model text,
  ai_error text,
  ai_attempted_at timestamptz,
  version integer not null default 1,
  trigger_kind text not null check (trigger_kind in ('SCHEDULED', 'MANUAL')),
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now(),                      -- when this content (figures) was produced
  checked_at timestamptz not null default now(),                        -- when the task data was last checked against it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint performance_reports_period_ok check (period_end >= period_start and period_end - period_start <= 366),
  constraint performance_reports_subject_ok check (
    (scope = 'MEMBER' and subject_id is not null) or
    (scope = 'TEAM' and team_id is not null and subject_id is null) or
    (scope = 'DEPARTMENT' and subject_id is null and team_id is null))
);
-- one current report per subject and period: a second scheduler run or a second click updates it, it never adds one
create unique index if not exists performance_reports_key
  on public.performance_reports (scope, coalesce(subject_id, team_id, department_id), period_kind, period_start, period_end);
create index if not exists performance_reports_department_idx on public.performance_reports (department_id, generated_at desc);

create table if not exists public.performance_report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.performance_reports(id) on delete cascade,
  version integer not null,
  metrics jsonb not null,
  fingerprint text not null,
  narrative jsonb,
  narrative_source text,
  ai_status text,
  trigger_kind text not null,
  generated_by uuid references public.profiles(id) on delete set null,
  generated_at timestamptz not null default now(),
  unique (report_id, version)
);

alter table public.performance_reports enable row level security;
alter table public.performance_report_versions enable row level security;
revoke all on public.performance_reports, public.performance_report_versions from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who may see a report
-- ---------------------------------------------------------------------------
create or replace function private.perf_can_view(p_scope text, p_subject uuid, p_team uuid, p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case private.my_role()
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then p_department is not null and p_department = private.my_department_id()
                                and (p_subject is null or p_subject <> private.my_id())
    when 'TEAM_HEAD' then p_scope in ('MEMBER', 'TEAM') and p_team is not null and p_team = private.my_team_id()
                          and (p_subject is null or exists (select 1 from public.profiles s where s.id = p_subject and s.role = 'TEAM_MEMBER'))
    else false
  end
$$;
revoke all on function private.perf_can_view(text, uuid, uuid, uuid) from public, anon;
grant execute on function private.perf_can_view(text, uuid, uuid, uuid) to authenticated, service_role;

drop policy if exists performance_reports_select on public.performance_reports;
create policy performance_reports_select on public.performance_reports for select to authenticated
  using (private.perf_can_view(scope, subject_id, team_id, department_id));
drop policy if exists performance_report_versions_select on public.performance_report_versions;
create policy performance_report_versions_select on public.performance_report_versions for select to authenticated
  using (exists (select 1 from public.performance_reports r where r.id = report_id and private.perf_can_view(r.scope, r.subject_id, r.team_id, r.department_id)));
grant select on public.performance_reports, public.performance_report_versions to authenticated;

-- ---------------------------------------------------------------------------
-- The figures. p_light = only the summary numbers (for the lists); the full report adds the weekly series, the task list,
-- the peak workload and the delay reasons.
-- A task belongs to a period by its deadline (or, without one, the day it was assigned). Teams and departments count the tasks nobody
-- split up further (a task a Team Lead handed to members is counted through the members' own tasks, not twice).
-- ---------------------------------------------------------------------------
create or replace function private.perf_metrics(
  p_scope text, p_subject uuid, p_team uuid, p_department uuid, p_start date, p_end date, p_today date, p_light boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tz constant text := 'Asia/Kolkata';
  r record;
  v_weekly jsonb := '[]'::jsonb;
  v_tasks jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_peak integer;
  v_trend jsonb;
  v_limits jsonb := '[]'::jsonb;
begin
  if to_regclass('pg_temp.perf_scoped') is null then
  create temporary table pg_temp.perf_scoped (
    id uuid, title text, priority text, status text, progress integer, assigned_on date, due date, completed_on date, completed_at timestamptz,
    created_at timestamptz, done boolean, on_time boolean, late boolean, overdue boolean, actual_days numeric, planned_days integer, updates integer
  ) on commit drop;
  end if;
  truncate pg_temp.perf_scoped;

  insert into pg_temp.perf_scoped
  select t.id, t.title, t.priority, t.status, t.progress,
         (t.created_at at time zone v_tz)::date, t.due_date, (t.completed_at at time zone v_tz)::date, t.completed_at, t.created_at,
         t.status = 'COMPLETED',
         t.status = 'COMPLETED' and t.completed_at is not null and t.due_date is not null and (t.completed_at at time zone v_tz)::date <= t.due_date,
         t.status = 'COMPLETED' and t.completed_at is not null and t.due_date is not null and (t.completed_at at time zone v_tz)::date > t.due_date,
         t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < p_today,
         case when t.status = 'COMPLETED' and t.completed_at is not null then round((extract(epoch from t.completed_at - t.created_at) / 86400)::numeric, 2) end,
         case when t.due_date is not null then greatest(t.due_date - (t.created_at at time zone v_tz)::date, 0) end,
         (select count(*)::int from public.work_task_updates u where u.task_id = t.id)
    from public.work_tasks t
   where case p_scope when 'MEMBER' then t.assignee_id = p_subject
                      when 'TEAM' then t.team_id = p_team
                      else t.department_id = p_department end
     and (p_scope = 'MEMBER' or not exists (select 1 from public.work_tasks c where c.parent_id = t.id))
     and coalesce(t.due_date, (t.created_at at time zone v_tz)::date) between p_start and p_end;

  if not p_light then
    -- weekly series (Monday to Sunday) for the charts
    select coalesce(jsonb_agg(jsonb_build_object('weekStart', w.d, 'total', w.total, 'completed', w.completed, 'onTime', w.on_time, 'late', w.late, 'overdue', w.overdue) order by w.d), '[]'::jsonb)
      into v_weekly
      from (select g.d::date as d,
                   count(s.id) as total, count(s.id) filter (where s.done) as completed, count(s.id) filter (where s.on_time) as on_time,
                   count(s.id) filter (where s.late) as late, count(s.id) filter (where s.overdue) as overdue
              from generate_series(date_trunc('week', p_start::timestamp), p_end::timestamp, interval '7 days') g(d)
              left join pg_temp.perf_scoped s on coalesce(s.due, s.assigned_on) >= g.d::date and coalesce(s.due, s.assigned_on) < g.d::date + 7
             group by g.d) w;
    -- the trend: the completion rate of the last week that had tasks against the one before it (needs two such weeks)
    select jsonb_build_object('recentWeek', a.d, 'recentRate', a.rate, 'previousWeek', b.d, 'previousRate', b.rate, 'change', round(a.rate - b.rate, 1))
      into v_trend
      from (select (x ->> 'weekStart') as d, round(100.0 * (x ->> 'completed')::numeric / (x ->> 'total')::numeric, 1) as rate
              from jsonb_array_elements(v_weekly) x where (x ->> 'total')::int > 0 order by x ->> 'weekStart' desc limit 1) a,
           (select (x ->> 'weekStart') as d, round(100.0 * (x ->> 'completed')::numeric / (x ->> 'total')::numeric, 1) as rate
              from jsonb_array_elements(v_weekly) x where (x ->> 'total')::int > 0 order by x ->> 'weekStart' desc limit 1 offset 1) b;
    -- the most tasks open at the same time on any day of the period (the workload)
    select max(n)::int into v_peak from (
      select count(*) as n from generate_series(p_start::timestamp, least(p_end, p_today)::timestamp, interval '1 day') d(day)
        join pg_temp.perf_scoped s on s.assigned_on <= d.day::date and (not s.done or s.completed_on is null or s.completed_on > d.day::date)
       group by d.day) pk;
    select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'title', k.title, 'priority', k.priority, 'status', k.status, 'progress', k.progress,
              'assignedOn', k.assigned_on, 'dueDate', k.due, 'completedAt', k.completed_at, 'onTime', case when k.done then k.on_time end,
              'daysToComplete', k.actual_days, 'plannedDays', k.planned_days,
              'daysLate', case when k.late then k.completed_on - k.due when k.overdue then p_today - k.due end,
              'overdue', k.overdue, 'updates', k.updates) order by coalesce(k.due, k.assigned_on) desc, k.title), '[]'::jsonb)
      into v_tasks from (select * from pg_temp.perf_scoped order by coalesce(due, assigned_on) desc, title limit 60) k;
    -- what people wrote when a task was not completed or was blocked (the only place the CRM records a reason for a delay)
    select coalesce(jsonb_agg(jsonb_build_object('task', q.title, 'status', q.status, 'note', q.note, 'at', q.created_at) order by q.created_at desc), '[]'::jsonb)
      into v_reasons
      from (select s.title, u.status, u.note, u.created_at from public.work_task_updates u join pg_temp.perf_scoped s on s.id = u.task_id
             where u.status in ('NOT_COMPLETED', 'BLOCKED') and nullif(btrim(u.note), '') is not null order by u.created_at desc limit 8) q;
  end if;

  select
    count(*)::int as total, count(*) filter (where done)::int as completed,
    count(*) filter (where not done and not overdue)::int as pending, count(*) filter (where overdue)::int as overdue,
    count(*) filter (where on_time)::int as on_time, count(*) filter (where late)::int as late,
    count(*) filter (where done and (completed_at is null or due is null))::int as done_unknown,
    count(*) filter (where due is null)::int as no_due, count(*) filter (where done and completed_at is null)::int as no_completed_at,
    count(*) filter (where status = 'BLOCKED')::int as blocked,
    count(*) filter (where updates = 0)::int as no_updates, coalesce(sum(updates), 0)::int as updates,
    count(*) filter (where priority = 'HIGH')::int as p_high, count(*) filter (where priority = 'MEDIUM')::int as p_med, count(*) filter (where priority = 'LOW')::int as p_low,
    round(avg(actual_days), 1) as avg_actual, round(avg(planned_days) filter (where planned_days is not null), 1) as avg_planned,
    count(*) filter (where actual_days is not null and planned_days is not null)::int as cmp_n,
    round(avg(actual_days) filter (where planned_days is not null), 1) as cmp_actual, round(avg(planned_days) filter (where actual_days is not null), 1) as cmp_planned
    into r from pg_temp.perf_scoped;

  if r.no_due > 0 then v_limits := v_limits || to_jsonb(format('%s task(s) have no deadline, so they cannot be judged on time or late.', r.no_due)); end if;
  if r.no_completed_at > 0 then v_limits := v_limits || to_jsonb(format('%s completed task(s) have no completion time, so their duration is not counted.', r.no_completed_at)); end if;
  if r.total > 0 and r.no_updates = r.total then v_limits := v_limits || to_jsonb('No progress updates were recorded on these tasks, so there is no status history to analyse.'::text); end if;
  v_limits := v_limits || to_jsonb('The CRM does not record an expected duration, a complexity or dependencies for a task. The planned window is the time from assignment to the deadline; workload is the number of open tasks.'::text);

  return jsonb_build_object(
    'scope', p_scope, 'periodStart', p_start, 'periodEnd', p_end, 'today', p_today,
    'tasks', jsonb_build_object('total', r.total, 'completed', r.completed, 'pending', r.pending, 'overdue', r.overdue, 'blocked', r.blocked),
    'completionPct', case when r.total > 0 then round(100.0 * r.completed / r.total, 1) end,
    'timing', jsonb_build_object('onTime', r.on_time, 'late', r.late, 'completedUnknownTiming', r.done_unknown,
        'onTimePct', case when r.on_time + r.late > 0 then round(100.0 * r.on_time / (r.on_time + r.late), 1) end),
    'duration', jsonb_build_object('avgActualDays', r.avg_actual, 'avgPlannedDays', r.avg_planned,
        'comparedTasks', r.cmp_n, 'comparedActualDays', r.cmp_actual, 'comparedPlannedDays', r.cmp_planned,
        'avgDifferenceDays', case when r.cmp_n > 0 then round(r.cmp_actual - r.cmp_planned, 1) end),
    'activity', jsonb_build_object('updates', r.updates, 'tasksWithoutUpdates', r.no_updates),
    'workload', jsonb_build_object('byPriority', jsonb_build_object('HIGH', r.p_high, 'MEDIUM', r.p_med, 'LOW', r.p_low), 'peakOpenTasks', v_peak),
    'trend', v_trend,
    'weekly', v_weekly, 'taskList', v_tasks, 'delayReasons', v_reasons, 'limitations', v_limits);
end $$;
revoke all on function private.perf_metrics(text, uuid, uuid, uuid, date, date, date, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A report as the application reads it
-- ---------------------------------------------------------------------------
create or replace function private.perf_report_json(r public.performance_reports)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'scope', r.scope, 'subjectId', r.subject_id, 'teamId', r.team_id, 'departmentId', r.department_id,
    'subjectName', r.subject_name, 'subjectRole', r.subject_role,
    'teamName', (select t.name from public.teams t where t.id = r.team_id), 'departmentName', (select d.name from public.departments d where d.id = r.department_id),
    'periodKind', r.period_kind, 'periodStart', r.period_start, 'periodEnd', r.period_end,
    'metrics', r.metrics, 'fingerprint', r.fingerprint, 'sourceTaskCount', r.source_task_count,
    'narrative', r.narrative, 'narrativeSource', r.narrative_source, 'aiStatus', r.ai_status, 'aiModel', r.ai_model, 'aiError', r.ai_error,
    'version', r.version, 'trigger', r.trigger_kind, 'generatedBy', (select p.full_name from public.profiles p where p.id = r.generated_by),
    'generatedAt', r.generated_at, 'checkedAt', r.checked_at, 'updatedAt', r.updated_at)
$$;
revoke all on function private.perf_report_json(public.performance_reports) from public, anon, authenticated;

-- Check a period and the kind that goes with it: a week is Monday to Sunday, a month is the whole calendar month.
create or replace function private.perf_check_period(p_kind text, p_start date, p_end date)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_kind not in ('WEEK', 'MONTH', 'CUSTOM') or p_start is null or p_end is null then
    raise exception 'VALIDATION_ERROR: Choose weekly, monthly or a custom date range.' using errcode = 'P0001';
  end if;
  if p_end < p_start then raise exception 'VALIDATION_ERROR: The end date is before the start date.' using errcode = 'P0001'; end if;
  if p_end - p_start > 366 then raise exception 'VALIDATION_ERROR: A report covers at most one year.' using errcode = 'P0001'; end if;
  if p_kind = 'WEEK' and (extract(isodow from p_start) <> 1 or p_end <> p_start + 6) then
    raise exception 'VALIDATION_ERROR: A weekly report runs from Monday to Sunday.' using errcode = 'P0001';
  end if;
  if p_kind = 'MONTH' and (p_start <> date_trunc('month', p_start)::date or p_end <> (date_trunc('month', p_start) + interval '1 month - 1 day')::date) then
    raise exception 'VALIDATION_ERROR: A monthly report covers one whole calendar month.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.perf_check_period(text, date, date) from public, anon, authenticated;

-- Resolve who/what a report is about and check the caller may read it. Returns subject id, team id, department id, name and role.
create or replace function private.perf_resolve(p_scope text, p_subject uuid, p_team uuid, p_department uuid, p_check boolean default true)
returns table (r_subject uuid, r_team uuid, r_department uuid, r_name text, r_role text) language plpgsql stable security definer set search_path = '' as $$
declare
  s public.profiles;
  t public.teams;
  d public.departments;
begin
  if p_scope = 'MEMBER' then
    select * into s from public.profiles where id = p_subject and role in ('TEAM_MEMBER', 'TEAM_HEAD');
    if s.id is null then raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001'; end if;
    r_subject := s.id; r_team := s.team_id; r_department := s.department_id; r_name := s.full_name;
    r_role := case s.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end;
  elsif p_scope = 'TEAM' then
    select * into t from public.teams where id = p_team;
    if t.id is null then raise exception 'NOT_FOUND: Team not found.' using errcode = 'P0001'; end if;
    r_subject := null; r_team := t.id; r_department := t.department_id; r_name := t.name; r_role := 'Team';
  elsif p_scope = 'DEPARTMENT' then
    select * into d from public.departments where id = p_department;
    if d.id is null then raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001'; end if;
    r_subject := null; r_team := null; r_department := d.id; r_name := d.name; r_role := 'Department';
  else
    raise exception 'VALIDATION_ERROR: Unknown report type.' using errcode = 'P0001';
  end if;
  if p_check and not private.perf_can_view(p_scope, r_subject, r_team, r_department) then
    raise exception 'FORBIDDEN: You cannot see this performance report.' using errcode = '42501';
  end if;
  return next;
end $$;
revoke all on function private.perf_resolve(text, uuid, uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Make or refresh a report. A refresh whose figures did not change only records that the data was checked: no new version, no new row.
-- ---------------------------------------------------------------------------
create or replace function private.perf_refresh(
  p_scope text, p_subject uuid, p_team uuid, p_department uuid, p_kind text, p_start date, p_end date,
  p_trigger text, p_actor uuid, p_today date, p_skip_empty boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k record;
  v_metrics jsonb;
  v_fp text;
  v_total integer;
  r public.performance_reports;
  v_state text;
begin
  select * into k from private.perf_resolve(p_scope, p_subject, p_team, p_department, false);
  v_metrics := private.perf_metrics(p_scope, k.r_subject, k.r_team, k.r_department, p_start, p_end, p_today, false);
  v_total := (v_metrics -> 'tasks' ->> 'total')::int;
  if v_total = 0 and p_skip_empty then return jsonb_build_object('state', 'EMPTY'); end if;
  v_fp := md5((v_metrics - 'today')::text);

  select * into r from public.performance_reports
   where scope = p_scope and coalesce(subject_id, team_id, department_id) = coalesce(k.r_subject, k.r_team, k.r_department)
     and period_kind = p_kind and period_start = p_start and period_end = p_end for update;
  if r.id is null then
    begin
    insert into public.performance_reports (scope, subject_id, team_id, department_id, subject_name, subject_role, period_kind, period_start, period_end,
                                            metrics, fingerprint, source_task_count, trigger_kind, generated_by)
    values (p_scope, k.r_subject, k.r_team, k.r_department, k.r_name, k.r_role, p_kind, p_start, p_end, v_metrics, v_fp, v_total, p_trigger, p_actor)
    returning * into r;
    insert into public.performance_report_versions (report_id, version, metrics, fingerprint, ai_status, trigger_kind, generated_by)
    values (r.id, 1, v_metrics, v_fp, r.ai_status, p_trigger, p_actor);
    v_state := 'CREATED';
  exception when unique_violation then
    -- two requests made the first report at the same moment: the other one won, this one only reads it
    select * into r from public.performance_reports
     where scope = p_scope and coalesce(subject_id, team_id, department_id) = coalesce(k.r_subject, k.r_team, k.r_department)
       and period_kind = p_kind and period_start = p_start and period_end = p_end;
    v_state := 'UNCHANGED';
  end;
  elsif r.fingerprint is distinct from v_fp then
    update public.performance_reports
       set metrics = v_metrics, fingerprint = v_fp, source_task_count = v_total, version = version + 1,
           narrative = null, narrative_source = null, ai_status = 'PENDING', ai_error = null,
           subject_name = k.r_name, subject_role = k.r_role, team_id = case when p_scope = 'MEMBER' then k.r_team else team_id end,
           trigger_kind = p_trigger, generated_by = p_actor, generated_at = now(), checked_at = now(), updated_at = now()
     where id = r.id returning * into r;
    insert into public.performance_report_versions (report_id, version, metrics, fingerprint, ai_status, trigger_kind, generated_by)
    values (r.id, r.version, v_metrics, v_fp, r.ai_status, p_trigger, p_actor);
    v_state := 'UPDATED';
  else
    update public.performance_reports set checked_at = now() where id = r.id returning * into r;
    v_state := 'UNCHANGED';
  end if;
  return jsonb_build_object('state', v_state, 'report', private.perf_report_json(r));
end $$;
revoke all on function private.perf_refresh(text, uuid, uuid, uuid, text, date, date, text, uuid, date, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the dashboards call (every function checks the caller itself)
-- ---------------------------------------------------------------------------
-- The people (and teams, and the department) the caller may open, with the live summary figures of the period and the state of their report.
create or replace function public.performance_people(p_kind text, p_start date, p_end date, p_department uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.my_role();
  v_dept uuid;
  v_team uuid := private.my_team_id();
  v_today date := private.hr_today();
  v_people jsonb;
  v_teams jsonb := '[]'::jsonb;
  v_dep jsonb;
begin
  perform private.perf_check_period(p_kind, p_start, p_end);
  if v_role = 'SUPER_ADMIN' then
    v_dept := p_department;
    if v_dept is null then raise exception 'VALIDATION_ERROR: Choose a department.' using errcode = 'P0001'; end if;
  elsif v_role = 'DEPARTMENT_HEAD' then
    v_dept := private.my_department_id();
  elsif v_role = 'TEAM_HEAD' then
    v_dept := private.my_department_id();
  else
    raise exception 'FORBIDDEN: Performance reports are for Team Leads and Department Heads.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x order by (x ->> 'teamName'), (x ->> 'role') desc, (x ->> 'name')), '[]'::jsonb) into v_people from (
    select jsonb_build_object('scope', 'MEMBER', 'id', p.id, 'name', p.full_name, 'role', case p.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end,
             'teamId', p.team_id, 'teamName', coalesce(t.name, ''), 'position', p.position,
             'summary', private.perf_metrics('MEMBER', p.id, p.team_id, p.department_id, p_start, p_end, v_today, true),
             'report', (select jsonb_build_object('id', r.id, 'generatedAt', r.generated_at, 'checkedAt', r.checked_at, 'narrativeSource', r.narrative_source, 'aiStatus', r.ai_status)
                          from public.performance_reports r where r.scope = 'MEMBER' and r.subject_id = p.id and r.period_kind = p_kind and r.period_start = p_start and r.period_end = p_end)) as x
      from public.profiles p left join public.teams t on t.id = p.team_id
     where p.status = 'ACTIVE' and p.department_id = v_dept and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and p.id <> private.my_id()
       and (v_role <> 'TEAM_HEAD' or (p.role = 'TEAM_MEMBER' and p.team_id = v_team))) q;

  if v_role in ('DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) into v_teams from (
      select jsonb_build_object('scope', 'TEAM', 'id', t.id, 'name', t.name,
               'lead', (select h.full_name from public.profiles h where h.team_id = t.id and h.role = 'TEAM_HEAD' and h.status = 'ACTIVE' order by h.created_at limit 1),
               'members', (select count(*) from public.profiles m where m.team_id = t.id and m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE'),
               'summary', private.perf_metrics('TEAM', null, t.id, t.department_id, p_start, p_end, v_today, true),
               'report', (select jsonb_build_object('id', r.id, 'generatedAt', r.generated_at, 'checkedAt', r.checked_at, 'narrativeSource', r.narrative_source, 'aiStatus', r.ai_status)
                            from public.performance_reports r where r.scope = 'TEAM' and r.team_id = t.id and r.period_kind = p_kind and r.period_start = p_start and r.period_end = p_end)) as x
        from public.teams t where t.department_id = v_dept) q;
    select jsonb_build_object('scope', 'DEPARTMENT', 'id', d.id, 'name', d.name,
             'summary', private.perf_metrics('DEPARTMENT', null, null, d.id, p_start, p_end, v_today, true),
             'report', (select jsonb_build_object('id', r.id, 'generatedAt', r.generated_at, 'checkedAt', r.checked_at, 'narrativeSource', r.narrative_source, 'aiStatus', r.ai_status)
                          from public.performance_reports r where r.scope = 'DEPARTMENT' and r.department_id = d.id and r.period_kind = p_kind and r.period_start = p_start and r.period_end = p_end))
      into v_dep from public.departments d where d.id = v_dept;
  elsif v_role = 'TEAM_HEAD' and v_team is not null then
    -- a Team Lead reads their own team's overall report
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_teams from (
      select jsonb_build_object('scope', 'TEAM', 'id', t.id, 'name', t.name, 'lead', null,
               'members', (select count(*) from public.profiles m where m.team_id = t.id and m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE'),
               'summary', private.perf_metrics('TEAM', null, t.id, t.department_id, p_start, p_end, v_today, true),
               'report', (select jsonb_build_object('id', r.id, 'generatedAt', r.generated_at, 'checkedAt', r.checked_at, 'narrativeSource', r.narrative_source, 'aiStatus', r.ai_status)
                            from public.performance_reports r where r.scope = 'TEAM' and r.team_id = t.id and r.period_kind = p_kind and r.period_start = p_start and r.period_end = p_end)) as x
        from public.teams t where t.id = v_team) q;
  end if;
  return jsonb_build_object('period', jsonb_build_object('kind', p_kind, 'start', p_start, 'end', p_end), 'today', v_today,
                            'people', v_people, 'teams', v_teams, 'department', v_dep, 'role', v_role);
end $$;

-- The stored report for a subject and period (null when nobody generated one yet).
create or replace function public.performance_report_get(p_scope text, p_subject uuid, p_team uuid, p_department uuid, p_kind text, p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  k record;
  r public.performance_reports;
begin
  perform private.perf_check_period(p_kind, p_start, p_end);
  select * into k from private.perf_resolve(p_scope, p_subject, p_team, p_department, true);
  select * into r from public.performance_reports
   where scope = p_scope and coalesce(subject_id, team_id, department_id) = coalesce(k.r_subject, k.r_team, k.r_department)
     and period_kind = p_kind and period_start = p_start and period_end = p_end;
  if r.id is null then return null; end if;
  return private.perf_report_json(r);
end $$;

-- Generate or refresh a report on request (Team Lead / Department Head / Super Admin, for what they may see).
create or replace function public.performance_report_refresh(p_scope text, p_subject uuid, p_team uuid, p_department uuid, p_kind text, p_start date, p_end date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k record;
  v_out jsonb;
begin
  perform private.perf_check_period(p_kind, p_start, p_end);
  select * into k from private.perf_resolve(p_scope, p_subject, p_team, p_department, true);
  v_out := private.perf_refresh(p_scope, k.r_subject, k.r_team, k.r_department, p_kind, p_start, p_end, 'MANUAL', private.my_id(), private.hr_today(), false);
  return v_out;
end $$;

create or replace function public.performance_report_history(p_report uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.performance_reports;
begin
  select * into r from public.performance_reports where id = p_report;
  if r.id is null or not private.perf_can_view(r.scope, r.subject_id, r.team_id, r.department_id) then
    raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('version', v.version, 'generatedAt', v.generated_at, 'trigger', v.trigger_kind,
            'generatedBy', (select p.full_name from public.profiles p where p.id = v.generated_by),
            'narrativeSource', v.narrative_source, 'aiStatus', v.ai_status,
            'tasks', v.metrics -> 'tasks', 'completionPct', v.metrics -> 'completionPct', 'onTimePct', v.metrics -> 'timing' -> 'onTimePct',
            'summary', v.narrative ->> 'summary') order by v.version desc)
       from public.performance_report_versions v where v.report_id = r.id), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- The server (service role only): the daily check, the reports that still need their written analysis, and storing it
-- ---------------------------------------------------------------------------
create or replace function public.performance_schedule(p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := coalesce(p_today, private.hr_today());
  v_periods jsonb;
  per record;
  x record;
  v_out jsonb;
  c_created integer := 0; c_updated integer := 0; c_unchanged integer := 0; c_empty integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('performance_schedule')) then
    return jsonb_build_object('skipped', 'Another run is in progress.');
  end if;
  -- the week (Monday to Sunday) and the month that contain today
  for per in select 'WEEK' as kind, date_trunc('week', v_today::timestamp)::date as s, (date_trunc('week', v_today::timestamp)::date + 6) as e
             union all select 'MONTH', date_trunc('month', v_today::timestamp)::date, (date_trunc('month', v_today::timestamp) + interval '1 month - 1 day')::date loop
    for x in select 'MEMBER' as scope, p.id as subject, null::uuid as team, null::uuid as department from public.profiles p
              where p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and p.department_id is not null
             union all select 'TEAM', null, t.id, null from public.teams t
             union all select 'DEPARTMENT', null, null, d.id from public.departments d loop
      v_out := private.perf_refresh(x.scope, x.subject, x.team, x.department, per.kind, per.s, per.e, 'SCHEDULED', null, v_today, true);
      case v_out ->> 'state'
        when 'CREATED' then c_created := c_created + 1;
        when 'UPDATED' then c_updated := c_updated + 1;
        when 'UNCHANGED' then c_unchanged := c_unchanged + 1;
        else c_empty := c_empty + 1;
      end case;
    end loop;
  end loop;
  return jsonb_build_object('day', v_today, 'created', c_created, 'updated', c_updated, 'unchanged', c_unchanged, 'skippedNoTasks', c_empty);
end $$;

-- Reports whose written analysis is missing, failed (tried again after six hours), or was written by rules while no AI was configured
-- (p_retry_not_configured: the server passes true once an AI key exists, so those are upgraded once).
create or replace function public.performance_reports_to_write(p_limit integer default 10, p_retry_not_configured boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'fingerprint', r.fingerprint, 'scope', r.scope, 'subjectName', r.subject_name, 'subjectRole', r.subject_role,
           'periodKind', r.period_kind, 'periodStart', r.period_start, 'periodEnd', r.period_end, 'metrics', r.metrics) order by r.updated_at desc), '[]'::jsonb)
    from (select * from public.performance_reports
           where narrative is null
              or (ai_status = 'FAILED' and ai_attempted_at < now() - interval '6 hours')
              or (p_retry_not_configured and ai_status = 'NOT_CONFIGURED')
           order by updated_at desc limit greatest(1, least(coalesce(p_limit, 10), 50))) r
$$;

-- Store the analysis. It is stored only if the figures it was written for are still the report's figures (a stale write is refused).
create or replace function public.performance_report_store_narrative(
  p_report uuid, p_fingerprint text, p_narrative jsonb, p_source text, p_status text, p_model text default null, p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  r public.performance_reports;
begin
  select * into r from public.performance_reports where id = p_report for update;
  if r.id is null or r.fingerprint is distinct from p_fingerprint then return false; end if;
  if p_status not in ('OK', 'FAILED', 'NOT_CONFIGURED') or (p_narrative is not null and p_source not in ('AI', 'RULES')) then
    raise exception 'VALIDATION_ERROR: Unknown narrative state.' using errcode = 'P0001';
  end if;
  update public.performance_reports
     set narrative = coalesce(p_narrative, narrative), narrative_source = case when p_narrative is null then narrative_source else p_source end,
         ai_status = p_status, ai_model = p_model, ai_error = left(p_error, 300), ai_attempted_at = now(), updated_at = now()
   where id = r.id;
  update public.performance_report_versions v
     set narrative = coalesce(p_narrative, v.narrative), narrative_source = case when p_narrative is null then v.narrative_source else p_source end, ai_status = p_status
   where v.report_id = r.id and v.version = r.version;
  return true;
end $$;

revoke all on function public.performance_people(text, date, date, uuid) from public, anon;
revoke all on function public.performance_report_get(text, uuid, uuid, uuid, text, date, date) from public, anon;
revoke all on function public.performance_report_refresh(text, uuid, uuid, uuid, text, date, date) from public, anon;
revoke all on function public.performance_report_history(uuid) from public, anon;
grant execute on function public.performance_people(text, date, date, uuid) to authenticated;
grant execute on function public.performance_report_get(text, uuid, uuid, uuid, text, date, date) to authenticated;
grant execute on function public.performance_report_refresh(text, uuid, uuid, uuid, text, date, date) to authenticated;
grant execute on function public.performance_report_history(uuid) to authenticated;
revoke all on function public.performance_schedule(date) from public, anon, authenticated;
drop function if exists public.performance_reports_to_write(integer);
revoke all on function public.performance_reports_to_write(integer, boolean) from public, anon, authenticated;
revoke all on function public.performance_report_store_narrative(uuid, text, jsonb, text, text, text, text) from public, anon, authenticated;
grant execute on function public.performance_schedule(date) to service_role;
grant execute on function public.performance_reports_to_write(integer, boolean) to service_role;
grant execute on function public.performance_report_store_narrative(uuid, text, jsonb, text, text, text, text) to service_role;

notify pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261116000200_hr_recruitment.sql
-- =============================================================================
-- HR Recruitment Management. Safe to run again; nothing is deleted.
--
-- The CRM had no candidate tables (the old "Recruitment Management" card on the HR dashboard counted a hard-coded "2 Active Candidates"
-- and listed offer letters kept in the browser), so these are new. They sit next to the existing HR employee records and use the same
-- accounts for "who is responsible" (an HR employee is a CRM profile of the HR department).
--
-- Three DIFFERENT things are tracked per candidate, never merged into one generic status:
--   Pending       what is still outstanding: interviews, documents, checks ... (hr_candidate_actions, each with a due date and a person)
--   Call          the call side: the next scheduled call, the last outcome and the follow-up date (hr_candidate_calls)
--   Confirmation  where the confirmation stands (not started / offer pending / offered / confirmed / declined / on hold) and its date
-- Every change is written to the candidate's history (hr_candidate_events). Only HR staff and the Super Admin can read or change any of it
-- (private.is_hr_staff()); the tables cannot be written directly, only through the functions below.
-- =============================================================================

create table if not exists public.hr_positions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 2 and 120),
  department_id uuid references public.departments(id) on delete set null,
  is_open boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists hr_positions_title_key on public.hr_positions (lower(btrim(title)), coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.hr_candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 160),
  email text not null check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and length(email) <= 254),
  phone text check (phone is null or length(phone) <= 40),
  position_id uuid not null references public.hr_positions(id) on delete restrict,
  source text check (source is null or length(source) <= 80),
  notes text check (notes is null or length(notes) <= 2000),
  owner_id uuid references public.profiles(id) on delete set null,       -- the responsible HR employee
  confirmation_status text not null default 'NOT_STARTED'
    check (confirmation_status in ('NOT_STARTED', 'OFFER_PENDING', 'OFFERED', 'CONFIRMED', 'DECLINED', 'ON_HOLD')),
  confirmation_date date,
  confirmation_note text check (confirmation_note is null or length(confirmation_note) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- the same person can apply for two positions, but not twice for the same one
create unique index if not exists hr_candidates_email_position_key on public.hr_candidates (lower(email), position_id);
create index if not exists hr_candidates_position_idx on public.hr_candidates (position_id);
create index if not exists hr_candidates_owner_idx on public.hr_candidates (owner_id) where owner_id is not null;

create table if not exists public.hr_candidate_actions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.hr_candidates(id) on delete cascade,
  kind text not null check (kind in ('INTERVIEW', 'DOCUMENTS', 'ASSESSMENT', 'BACKGROUND_CHECK', 'REFERENCE_CHECK', 'OTHER')),
  title text not null check (length(btrim(title)) between 2 and 200),
  due_date date,
  assignee_id uuid references public.profiles(id) on delete set null,    -- the HR employee responsible for this action
  status text not null default 'OPEN' check (status in ('OPEN', 'DONE', 'CANCELLED')),
  note text check (note is null or length(note) <= 500),
  done_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists hr_candidate_actions_candidate_idx on public.hr_candidate_actions (candidate_id, status);
create index if not exists hr_candidate_actions_open_idx on public.hr_candidate_actions (due_date) where status = 'OPEN';

create table if not exists public.hr_candidate_calls (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.hr_candidates(id) on delete cascade,
  scheduled_at timestamptz,                                              -- when the call is planned (null for a call that was simply logged)
  called_at timestamptz,                                                 -- when it was made (null until then)
  outcome text check (outcome in ('ANSWERED', 'NO_ANSWER', 'CALL_BACK', 'NOT_INTERESTED', 'WRONG_NUMBER')),
  note text check (note is null or length(note) <= 1000),
  follow_up_date date,
  made_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint hr_candidate_calls_state check ((called_at is null and outcome is null and scheduled_at is not null) or (called_at is not null and outcome is not null))
);
create index if not exists hr_candidate_calls_candidate_idx on public.hr_candidate_calls (candidate_id, created_at desc);

create table if not exists public.hr_candidate_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.hr_candidates(id) on delete cascade,
  kind text not null,
  summary text not null check (length(summary) <= 300),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists hr_candidate_events_candidate_idx on public.hr_candidate_events (candidate_id, created_at desc);

do $$ declare t text; begin
  foreach t in array array['hr_positions', 'hr_candidates', 'hr_candidate_actions', 'hr_candidate_calls', 'hr_candidate_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_hr_staff())', t || '_select', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
drop trigger if exists hr_candidates_set_updated_at on public.hr_candidates;
create trigger hr_candidates_set_updated_at before update on public.hr_candidates for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.rec_event(p_candidate uuid, p_kind text, p_summary text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.hr_candidate_events (candidate_id, kind, summary, detail, actor_id, actor_name)
  select p_candidate, p_kind, left(p_summary, 300), coalesce(p_detail, '{}'::jsonb), p.id, p.full_name
    from (select 1) x left join public.profiles p on p.id = private.my_id()
$$;
revoke all on function private.rec_event(uuid, text, text, jsonb) from public, anon, authenticated;

-- The three columns of a candidate, each calculated from its own records.
create or replace function private.rec_summary(c public.hr_candidates)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
  v_open integer;
  v_overdue integer;
  v_next_due date;
  v_items jsonb;
  v_next_call timestamptz;
  v_last public.hr_candidate_calls;
  v_newer boolean := false;
  v_calls integer;
  v_missed integer;
begin
  select count(*), count(*) filter (where a.due_date < v_today), min(a.due_date)
    into v_open, v_overdue, v_next_due from public.hr_candidate_actions a where a.candidate_id = c.id and a.status = 'OPEN';
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'dueDate', x.due_date, 'overdue', x.due_date < v_today,
                                               'assignee', (select p.full_name from public.profiles p where p.id = x.assignee_id)) order by x.due_date nulls last, x.created_at), '[]'::jsonb)
    into v_items from (select * from public.hr_candidate_actions a where a.candidate_id = c.id and a.status = 'OPEN' order by a.due_date nulls last, a.created_at limit 3) x;

  select min(k.scheduled_at) filter (where k.called_at is null and k.scheduled_at >= now()),
         count(*) filter (where k.called_at is null and k.scheduled_at < now()),
         count(*)
    into v_next_call, v_missed, v_calls from public.hr_candidate_calls k where k.candidate_id = c.id;
  select * into v_last from public.hr_candidate_calls k where k.candidate_id = c.id and k.called_at is not null order by k.called_at desc limit 1;
  if v_last.id is not null and v_last.follow_up_date is not null then
    -- a follow-up is outstanding until a later call is scheduled or made
    select exists (select 1 from public.hr_candidate_calls k where k.candidate_id = c.id and k.created_at > v_last.created_at) into v_newer;
  end if;

  return jsonb_build_object(
    'pending', jsonb_build_object('open', v_open, 'overdue', v_overdue, 'nextDue', v_next_due, 'items', v_items),
    'call', jsonb_build_object(
      'total', v_calls, 'nextAt', v_next_call, 'missedScheduled', v_missed,
      'last', case when v_last.id is null then null else jsonb_build_object('outcome', v_last.outcome, 'at', v_last.called_at, 'followUpDate', v_last.follow_up_date, 'note', v_last.note) end,
      'followUpOverdue', (v_last.id is not null and v_last.follow_up_date is not null and v_last.follow_up_date < v_today and not v_newer)),
    'confirmation', jsonb_build_object('status', c.confirmation_status, 'date', c.confirmation_date, 'note', c.confirmation_note));
end $$;
revoke all on function private.rec_summary(public.hr_candidates) from public, anon, authenticated;

create or replace function private.rec_candidate_json(c public.hr_candidates)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone, 'source', c.source, 'notes', c.notes,
    'positionId', c.position_id, 'position', (select p.title from public.hr_positions p where p.id = c.position_id),
    'ownerId', c.owner_id, 'owner', (select o.full_name from public.profiles o where o.id = c.owner_id),
    'createdAt', c.created_at, 'updatedAt', c.updated_at) || private.rec_summary(c)
$$;
revoke all on function private.rec_candidate_json(public.hr_candidates) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------
create or replace function public.hr_positions_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.hr_require_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'departmentId', p.department_id,
           'department', (select d.name from public.departments d where d.id = p.department_id), 'isOpen', p.is_open,
           'candidates', (select count(*) from public.hr_candidates c where c.position_id = p.id)) order by p.is_open desc, p.title)
         from public.hr_positions p), '[]'::jsonb);
end $$;

-- The HR employees a candidate or an action can be given to.
create or replace function public.hr_recruiters()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.hr_require_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'position', p.position) order by p.full_name)
                     from public.profiles p join public.departments d on d.id = p.department_id
                    where d.slug = 'hr' and p.status = 'ACTIVE'), '[]'::jsonb);
end $$;

create or replace function public.hr_recruitment_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
begin
  perform private.hr_require_staff();
  return jsonb_build_object(
    'today', v_today,
    'candidates', (select count(*) from public.hr_candidates),
    'withPending', (select count(distinct a.candidate_id) from public.hr_candidate_actions a where a.status = 'OPEN'),
    'overdueActions', (select count(*) from public.hr_candidate_actions a where a.status = 'OPEN' and a.due_date < v_today),
    'upcomingCalls', (select count(*) from public.hr_candidate_calls k where k.called_at is null and k.scheduled_at >= now() and k.scheduled_at < now() + interval '7 days'),
    'overdueFollowUps', (select count(*) from public.hr_candidates c where (private.rec_summary(c) -> 'call' ->> 'followUpOverdue')::boolean),
    'missedCalls', (select count(*) from public.hr_candidate_calls k where k.called_at is null and k.scheduled_at < now()),
    'confirmed', (select count(*) from public.hr_candidates c where c.confirmation_status = 'CONFIRMED'),
    'openPositions', (select count(*) from public.hr_positions p where p.is_open));
end $$;

create or replace function public.hr_recruitment_list(
  p_search text default null, p_position uuid default null, p_confirmation text default null, p_pending text default null,
  p_call text default null, p_owner uuid default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_search, '')));
  v_total bigint;
  v_items jsonb;
begin
  perform private.hr_require_staff();
  if p_confirmation is not null and p_confirmation not in ('NOT_STARTED', 'OFFER_PENDING', 'OFFERED', 'CONFIRMED', 'DECLINED', 'ON_HOLD') then
    raise exception 'VALIDATION_ERROR: Unknown confirmation status.' using errcode = 'P0001';
  end if;
  if p_pending is not null and p_pending not in ('OPEN', 'OVERDUE', 'NONE') then raise exception 'VALIDATION_ERROR: Unknown pending filter.' using errcode = 'P0001'; end if;
  if p_call is not null and p_call not in ('SCHEDULED', 'FOLLOW_UP_OVERDUE', 'NONE') then raise exception 'VALIDATION_ERROR: Unknown call filter.' using errcode = 'P0001'; end if;

  with rows as (
    select c.id, c.created_at, private.rec_candidate_json(c) as j
      from public.hr_candidates c
     where (v_q = '' or position(v_q in lower(c.name)) > 0 or position(v_q in lower(c.email)) > 0)
       and (p_position is null or c.position_id = p_position)
       and (p_confirmation is null or c.confirmation_status = p_confirmation)
       and (p_owner is null or c.owner_id = p_owner)),
  f as (
    select * from rows r
     where (p_pending is null or (p_pending = 'OPEN' and (r.j -> 'pending' ->> 'open')::int > 0)
                              or (p_pending = 'NONE' and (r.j -> 'pending' ->> 'open')::int = 0)
                              or (p_pending = 'OVERDUE' and (r.j -> 'pending' ->> 'overdue')::int > 0))
       and (p_call is null or (p_call = 'SCHEDULED' and (r.j -> 'call' ->> 'nextAt') is not null)
                           or (p_call = 'FOLLOW_UP_OVERDUE' and ((r.j -> 'call' ->> 'followUpOverdue')::boolean or (r.j -> 'call' ->> 'missedScheduled')::int > 0))
                           or (p_call = 'NONE' and (r.j -> 'call' ->> 'total')::int = 0)))
  select (select count(*) from f),
         coalesce((select jsonb_agg(x.j order by x.created_at desc, x.id)
                     from (select * from f order by created_at desc, id limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0))) x), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end $$;

create or replace function public.hr_recruitment_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.hr_candidates;
begin
  perform private.hr_require_staff();
  select * into c from public.hr_candidates where id = p_id;
  if c.id is null then raise exception 'NOT_FOUND: Candidate not found.' using errcode = 'P0001'; end if;
  return private.rec_candidate_json(c) || jsonb_build_object(
    'actions', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'title', a.title, 'dueDate', a.due_date, 'status', a.status, 'note', a.note, 'doneAt', a.done_at,
                     'assigneeId', a.assignee_id, 'assignee', (select p.full_name from public.profiles p where p.id = a.assignee_id), 'overdue', a.status = 'OPEN' and a.due_date < private.hr_today(),
                     'createdAt', a.created_at) order by (a.status = 'OPEN') desc, a.due_date nulls last, a.created_at desc)
                  from public.hr_candidate_actions a where a.candidate_id = c.id), '[]'::jsonb),
    'calls', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'scheduledAt', k.scheduled_at, 'calledAt', k.called_at, 'outcome', k.outcome, 'note', k.note, 'followUpDate', k.follow_up_date,
                     'madeBy', (select p.full_name from public.profiles p where p.id = k.made_by)) order by k.created_at desc)
                  from public.hr_candidate_calls k where k.candidate_id = c.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'summary', e.summary, 'actor', e.actor_name, 'at', e.created_at) order by e.created_at desc, e.id)
                  from (select * from public.hr_candidate_events ev where ev.candidate_id = c.id order by ev.created_at desc limit 100) e), '[]'::jsonb));
end $$;

-- Upcoming calls, overdue follow-ups and overdue actions in one place.
create or replace function public.hr_recruitment_agenda()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
begin
  perform private.hr_require_staff();
  return jsonb_build_object(
    'upcomingCalls', coalesce((select jsonb_agg(jsonb_build_object('candidateId', c.id, 'name', c.name, 'position', (select p.title from public.hr_positions p where p.id = c.position_id), 'at', k.scheduled_at, 'callId', k.id) order by k.scheduled_at)
        from public.hr_candidate_calls k join public.hr_candidates c on c.id = k.candidate_id where k.called_at is null and k.scheduled_at >= now() and k.scheduled_at < now() + interval '14 days'), '[]'::jsonb),
    'overdueCalls', coalesce((select jsonb_agg(jsonb_build_object('candidateId', c.id, 'name', c.name, 'position', (select p.title from public.hr_positions p where p.id = c.position_id), 'at', k.scheduled_at, 'callId', k.id) order by k.scheduled_at)
        from public.hr_candidate_calls k join public.hr_candidates c on c.id = k.candidate_id where k.called_at is null and k.scheduled_at < now()), '[]'::jsonb),
    'overdueFollowUps', coalesce((select jsonb_agg(jsonb_build_object('candidateId', x.id, 'name', x.name, 'position', x.pos_title, 'followUpDate', x.fu) order by x.fu)
        from (select c.id, c.name, (select p.title from public.hr_positions p where p.id = c.position_id) as pos_title, (private.rec_summary(c) -> 'call' -> 'last' ->> 'followUpDate')::date as fu
                from public.hr_candidates c where (private.rec_summary(c) -> 'call' ->> 'followUpOverdue')::boolean) x where x.fu is not null and x.fu < v_today), '[]'::jsonb),
    'overdueActions', coalesce((select jsonb_agg(jsonb_build_object('candidateId', c.id, 'name', c.name, 'actionId', a.id, 'title', a.title, 'dueDate', a.due_date,
                                   'assignee', (select p.full_name from public.profiles p where p.id = a.assignee_id)) order by a.due_date)
        from public.hr_candidate_actions a join public.hr_candidates c on c.id = a.candidate_id where a.status = 'OPEN' and a.due_date < v_today), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Writing (HR staff only; each change is written to the candidate's history)
-- ---------------------------------------------------------------------------
create or replace function public.hr_position_save(p_id uuid, p_title text, p_department uuid default null, p_open boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_positions;
begin
  perform private.hr_require_staff();
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'VALIDATION_ERROR: Enter the position title.' using errcode = 'P0001'; end if;
  begin
    if p_id is null then
      insert into public.hr_positions (title, department_id, is_open, created_by) values (btrim(p_title), p_department, coalesce(p_open, true), private.my_id()) returning * into r;
    else
      update public.hr_positions set title = btrim(p_title), department_id = p_department, is_open = coalesce(p_open, true), updated_at = now() where id = p_id returning * into r;
      if r.id is null then raise exception 'NOT_FOUND: Position not found.' using errcode = 'P0001'; end if;
    end if;
  exception when unique_violation then
    raise exception 'CONFLICT: This position already exists.' using errcode = 'P0001';
  end;
  return jsonb_build_object('id', r.id, 'title', r.title, 'isOpen', r.is_open);
end $$;

create or replace function public.hr_candidate_save(
  p_id uuid, p_name text, p_email text, p_phone text, p_position uuid, p_owner uuid default null, p_source text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_candidates;
  o public.hr_candidates;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_title text;
  v_changes text[] := '{}';
begin
  perform private.hr_require_staff();
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'VALIDATION_ERROR: Enter the candidate''s name.' using errcode = 'P0001'; end if;
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'VALIDATION_ERROR: Enter a valid e-mail address.' using errcode = 'P0001'; end if;
  select title into v_title from public.hr_positions where id = p_position;
  if v_title is null then raise exception 'VALIDATION_ERROR: Choose the position the candidate applied for.' using errcode = 'P0001'; end if;
  if p_owner is not null and not exists (select 1 from public.profiles p join public.departments d on d.id = p.department_id where p.id = p_owner and d.slug = 'hr' and p.status = 'ACTIVE') then
    raise exception 'VALIDATION_ERROR: The responsible person must be an active HR employee.' using errcode = 'P0001';
  end if;
  begin
    if p_id is null then
      insert into public.hr_candidates (name, email, phone, position_id, source, notes, owner_id, created_by)
      values (btrim(p_name), v_email, nullif(btrim(coalesce(p_phone, '')), ''), p_position, nullif(btrim(coalesce(p_source, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''), p_owner, private.my_id())
      returning * into c;
      perform private.rec_event(c.id, 'CREATED', format('Added for %s', v_title), jsonb_build_object('position', v_title));
      if p_owner is not null then
        perform private.notify(p_owner, 'RECRUITMENT_ASSIGNED', format('Candidate assigned to you: %s', c.name), format('For the position %s', v_title), 'hr_candidate', c.id);
      end if;
    else
      select * into o from public.hr_candidates where id = p_id for update;
      if o.id is null then raise exception 'NOT_FOUND: Candidate not found.' using errcode = 'P0001'; end if;
      update public.hr_candidates
         set name = btrim(p_name), email = v_email, phone = nullif(btrim(coalesce(p_phone, '')), ''), position_id = p_position,
             source = nullif(btrim(coalesce(p_source, '')), ''), notes = nullif(btrim(coalesce(p_notes, '')), ''), owner_id = p_owner
       where id = p_id returning * into c;
      if o.name is distinct from c.name then v_changes := v_changes || 'name'::text; end if;
      if o.email is distinct from c.email then v_changes := v_changes || 'e-mail'::text; end if;
      if o.phone is distinct from c.phone then v_changes := v_changes || 'phone'::text; end if;
      if o.position_id is distinct from c.position_id then v_changes := v_changes || format('position (now %s)', v_title); end if;
      if o.owner_id is distinct from c.owner_id then
        v_changes := v_changes || 'responsible HR employee'::text;
        perform private.notify(c.owner_id, 'RECRUITMENT_ASSIGNED', format('Candidate assigned to you: %s', c.name), format('For the position %s', v_title), 'hr_candidate', c.id);
      end if;
      if o.source is distinct from c.source or o.notes is distinct from c.notes then v_changes := v_changes || 'details'::text; end if;
      if array_length(v_changes, 1) > 0 then
        perform private.rec_event(c.id, 'UPDATED', 'Updated: ' || array_to_string(v_changes, ', '), jsonb_build_object('changed', to_jsonb(v_changes)));
      end if;
    end if;
  exception when unique_violation then
    raise exception 'CONFLICT: A candidate with this e-mail address already applied for this position.' using errcode = 'P0001';
  end;
  return private.rec_candidate_json(c);
end $$;

create or replace function public.hr_candidate_action_add(p_candidate uuid, p_kind text, p_title text, p_due date default null, p_assignee uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_candidates;
  a public.hr_candidate_actions;
begin
  perform private.hr_require_staff();
  select * into c from public.hr_candidates where id = p_candidate;
  if c.id is null then raise exception 'NOT_FOUND: Candidate not found.' using errcode = 'P0001'; end if;
  if p_kind not in ('INTERVIEW', 'DOCUMENTS', 'ASSESSMENT', 'BACKGROUND_CHECK', 'REFERENCE_CHECK', 'OTHER') then raise exception 'VALIDATION_ERROR: Choose what is pending.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'VALIDATION_ERROR: Describe what is pending.' using errcode = 'P0001'; end if;
  if p_assignee is not null and not exists (select 1 from public.profiles p join public.departments d on d.id = p.department_id where p.id = p_assignee and d.slug = 'hr' and p.status = 'ACTIVE') then
    raise exception 'VALIDATION_ERROR: The responsible person must be an active HR employee.' using errcode = 'P0001';
  end if;
  insert into public.hr_candidate_actions (candidate_id, kind, title, due_date, assignee_id, created_by)
  values (c.id, p_kind, btrim(p_title), p_due, coalesce(p_assignee, c.owner_id), private.my_id()) returning * into a;
  perform private.rec_event(c.id, 'PENDING_ADDED', format('Pending: %s%s', a.title, case when a.due_date is null then '' else format(' (due %s)', to_char(a.due_date, 'DD Mon YYYY')) end), jsonb_build_object('kind', a.kind));
  perform private.notify(a.assignee_id, 'RECRUITMENT_TASK', format('Recruitment task: %s', a.title), format('%s%s', c.name, case when a.due_date is null then '' else format(' · due %s', to_char(a.due_date, 'DD Mon')) end), 'hr_candidate', c.id);
  return jsonb_build_object('id', a.id);
end $$;

create or replace function public.hr_candidate_action_close(p_action uuid, p_done boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.hr_candidate_actions;
begin
  perform private.hr_require_staff();
  select * into a from public.hr_candidate_actions where id = p_action for update;
  if a.id is null then raise exception 'NOT_FOUND: Pending item not found.' using errcode = 'P0001'; end if;
  if a.status <> 'OPEN' then raise exception 'CONFLICT: This item is already closed.' using errcode = 'P0001'; end if;
  update public.hr_candidate_actions set status = case when p_done then 'DONE' else 'CANCELLED' end, done_at = now(), note = left(nullif(btrim(coalesce(p_note, '')), ''), 500) where id = a.id returning * into a;
  perform private.rec_event(a.candidate_id, case when p_done then 'PENDING_DONE' else 'PENDING_CANCELLED' end, format('%s: %s', case when p_done then 'Done' else 'Cancelled' end, a.title));
  return jsonb_build_object('id', a.id, 'status', a.status);
end $$;

create or replace function public.hr_candidate_call_schedule(p_candidate uuid, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_candidates;
  k public.hr_candidate_calls;
begin
  perform private.hr_require_staff();
  select * into c from public.hr_candidates where id = p_candidate;
  if c.id is null then raise exception 'NOT_FOUND: Candidate not found.' using errcode = 'P0001'; end if;
  if p_at is null or p_at < now() - interval '1 hour' or p_at > now() + interval '1 year' then raise exception 'VALIDATION_ERROR: Choose a time for the call (not in the past).' using errcode = 'P0001'; end if;
  insert into public.hr_candidate_calls (candidate_id, scheduled_at, created_by) values (c.id, p_at, private.my_id()) returning * into k;
  perform private.rec_event(c.id, 'CALL_SCHEDULED', format('Call scheduled for %s', to_char(p_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI')));
  return jsonb_build_object('id', k.id);
end $$;

-- Record a call that was made. With p_call the planned call is completed; without it a call that was not planned is logged.
create or replace function public.hr_candidate_call_record(p_candidate uuid, p_call uuid, p_outcome text, p_note text default null, p_follow_up date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_candidates;
  k public.hr_candidate_calls;
begin
  perform private.hr_require_staff();
  select * into c from public.hr_candidates where id = p_candidate;
  if c.id is null then raise exception 'NOT_FOUND: Candidate not found.' using errcode = 'P0001'; end if;
  if p_outcome not in ('ANSWERED', 'NO_ANSWER', 'CALL_BACK', 'NOT_INTERESTED', 'WRONG_NUMBER') then raise exception 'VALIDATION_ERROR: Choose the outcome of the call.' using errcode = 'P0001'; end if;
  if p_follow_up is not null and (p_follow_up < private.hr_today() - 1 or p_follow_up > private.hr_today() + 366) then raise exception 'VALIDATION_ERROR: Enter a valid follow-up date.' using errcode = 'P0001'; end if;
  if p_call is not null then
    update public.hr_candidate_calls set called_at = now(), outcome = p_outcome, note = left(nullif(btrim(coalesce(p_note, '')), ''), 1000), follow_up_date = p_follow_up, made_by = private.my_id()
     where id = p_call and candidate_id = c.id and called_at is null returning * into k;
    if k.id is null then raise exception 'NOT_FOUND: That planned call was not found (or was already recorded).' using errcode = 'P0001'; end if;
  else
    insert into public.hr_candidate_calls (candidate_id, called_at, outcome, note, follow_up_date, made_by, created_by)
    values (c.id, now(), p_outcome, left(nullif(btrim(coalesce(p_note, '')), ''), 1000), p_follow_up, private.my_id(), private.my_id()) returning * into k;
  end if;
  perform private.rec_event(c.id, 'CALL_RECORDED', format('Call: %s%s', initcap(replace(lower(p_outcome), '_', ' ')), case when p_follow_up is null then '' else format(' · follow up %s', to_char(p_follow_up, 'DD Mon YYYY')) end),
                            jsonb_build_object('outcome', p_outcome));
  return jsonb_build_object('id', k.id);
end $$;

create or replace function public.hr_candidate_confirmation_set(p_candidate uuid, p_status text, p_date date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_candidates;
begin
  perform private.hr_require_staff();
  if p_status not in ('NOT_STARTED', 'OFFER_PENDING', 'OFFERED', 'CONFIRMED', 'DECLINED', 'ON_HOLD') then raise exception 'VALIDATION_ERROR: Choose the confirmation status.' using errcode = 'P0001'; end if;
  if p_status in ('OFFERED', 'CONFIRMED', 'DECLINED') and p_date is null then raise exception 'VALIDATION_ERROR: Enter the date of the offer, confirmation or decision.' using errcode = 'P0001'; end if;
  update public.hr_candidates
     set confirmation_status = p_status, confirmation_date = case when p_status = 'NOT_STARTED' then null else p_date end, confirmation_note = left(nullif(btrim(coalesce(p_note, '')), ''), 500)
   where id = p_candidate returning * into c;
  if c.id is null then raise exception 'NOT_FOUND: Candidate not found.' using errcode = 'P0001'; end if;
  perform private.rec_event(c.id, 'CONFIRMATION', format('Confirmation: %s%s', initcap(replace(lower(p_status), '_', ' ')), case when c.confirmation_date is null then '' else format(' (%s)', to_char(c.confirmation_date, 'DD Mon YYYY')) end),
                            jsonb_build_object('status', p_status));
  return private.rec_candidate_json(c);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'hr_positions_list()', 'hr_recruiters()', 'hr_recruitment_overview()', 'hr_recruitment_list(text, uuid, text, text, text, uuid, integer, integer)',
    'hr_recruitment_get(uuid)', 'hr_recruitment_agenda()', 'hr_position_save(uuid, text, uuid, boolean)',
    'hr_candidate_save(uuid, text, text, text, uuid, uuid, text, text)', 'hr_candidate_action_add(uuid, text, text, date, uuid)',
    'hr_candidate_action_close(uuid, boolean, text)', 'hr_candidate_call_schedule(uuid, timestamptz)',
    'hr_candidate_call_record(uuid, uuid, text, text, date)', 'hr_candidate_confirmation_set(uuid, text, date, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261116000300_hr_training.sql
-- =============================================================================
-- HR Training workspace: structured three-day training programs with a report for every employee and every day.
-- Safe to run again; nothing is deleted.
--
--   hr_training_programs      a program: name, start date, the responsible HR employee. Its three days are made with it and always sit on
--                             consecutive dates from the start date (change the start date and the schedule follows).
--   hr_training_days          Day 1 Initial Training, Day 2 Practical Training, Day 3 Final Training and Assessment: the topics, the trainer
--                             and the assessment criteria are configured here (nothing about the content is hard-coded).
--   hr_training_enrollments   one employee in one program, with the overall status (Not Started / In Progress / Completed / Incomplete),
--                             the strengths, the areas to improve and, once the training is over, the consolidated report.
--                             The same employee can attend any number of programs; every enrollment stays as history.
--   hr_training_day_reports   one row per enrollment and day: attendance, topics done, tasks, assessment scores, feedback, remarks.
--
-- A day is COMPLETE only when the employee actually attended (present or late) AND something was recorded for it (a topic done, a task done
-- or an assessment score); Day 3 also needs its assessment. The date passing completes nothing. The status of an enrollment follows from that:
-- all three days complete = Completed; the program is over and not all complete = Incomplete; something recorded = In progress; else Not started.
-- HR staff (and the Super Admin) manage everything; the trainer named on a day can record that day's reports.
-- =============================================================================

create table if not exists public.hr_training_programs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 160),
  description text check (description is null or length(description) <= 2000),
  start_date date not null,
  owner_id uuid references public.profiles(id) on delete set null,       -- the responsible HR employee (gets the pending-report reminder)
  is_cancelled boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hr_training_days (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.hr_training_programs(id) on delete cascade,
  day_no integer not null check (day_no between 1 and 3),
  title text not null check (length(btrim(title)) between 2 and 160),
  topics jsonb not null default '[]'::jsonb check (jsonb_typeof(topics) = 'array' and jsonb_array_length(topics) <= 30),
  trainer_name text check (trainer_name is null or length(trainer_name) <= 160),
  trainer_id uuid references public.profiles(id) on delete set null,     -- a CRM user who may record this day's reports
  criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(criteria) = 'array' and jsonb_array_length(criteria) <= 20),   -- [{"name": "...", "max": 10}]
  pass_percent integer check (pass_percent is null or pass_percent between 1 and 100),
  unique (program_id, day_no)
);

create table if not exists public.hr_training_enrollments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.hr_training_programs(id) on delete cascade,
  employee_key text not null,                                            -- the HR employee key (a CRM profile id, or "HR:<record id>")
  profile_id uuid references public.profiles(id) on delete set null,
  employee_name text not null,
  employee_code text,
  department_name text,
  designation text,
  status text not null default 'NOT_STARTED' check (status in ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'INCOMPLETE')),
  strengths text check (strengths is null or length(strengths) <= 2000),
  improvements text check (improvements is null or length(improvements) <= 2000),
  trainer_remarks text check (trainer_remarks is null or length(trainer_remarks) <= 2000),
  consolidated jsonb,
  consolidated_at timestamptz,
  enrolled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, employee_key)
);
create index if not exists hr_training_enrollments_employee_idx on public.hr_training_enrollments (employee_key, created_at desc);
create index if not exists hr_training_enrollments_status_idx on public.hr_training_enrollments (program_id, status);

create table if not exists public.hr_training_day_reports (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.hr_training_enrollments(id) on delete cascade,
  day_no integer not null check (day_no between 1 and 3),
  attendance text check (attendance in ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED')),
  topics_completed jsonb not null default '[]'::jsonb check (jsonb_typeof(topics_completed) = 'array' and jsonb_array_length(topics_completed) <= 30),
  tasks jsonb not null default '[]'::jsonb check (jsonb_typeof(tasks) = 'array' and jsonb_array_length(tasks) <= 30),        -- [{"title": "...", "done": true}]
  scores jsonb not null default '[]'::jsonb check (jsonb_typeof(scores) = 'array' and jsonb_array_length(scores) <= 20),     -- [{"criterion": "...", "score": 8, "max": 10}]
  assessment_total numeric,
  assessment_max numeric,
  assessment_result text check (assessment_result in ('PASS', 'FAIL', 'RECORDED')),
  feedback text check (feedback is null or length(feedback) <= 2000),
  trainer_remarks text check (trainer_remarks is null or length(trainer_remarks) <= 2000),
  report text check (report is null or length(report) <= 4000),
  day_completed boolean not null default false,                          -- derived by the database from attendance + what was recorded
  reported_by uuid references public.profiles(id) on delete set null,
  reported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, day_no)
);

do $$ declare t text; begin
  foreach t in array array['hr_training_programs', 'hr_training_days', 'hr_training_enrollments', 'hr_training_day_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_hr_staff())', t || '_select', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
drop trigger if exists hr_training_programs_set_updated_at on public.hr_training_programs;
create trigger hr_training_programs_set_updated_at before update on public.hr_training_programs for each row execute function public.tg_set_updated_at();
drop trigger if exists hr_training_enrollments_set_updated_at on public.hr_training_enrollments;
create trigger hr_training_enrollments_set_updated_at before update on public.hr_training_enrollments for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
create or replace function private.training_day_date(p_program public.hr_training_programs, p_day integer)
returns date language sql immutable set search_path = '' as $$ select p_program.start_date + (p_day - 1) $$;

-- Who may record the reports of a day: HR staff, the Super Admin, and the trainer named on that day.
create or replace function private.training_can_report(p_program uuid, p_day integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_hr_staff() or exists (select 1 from public.hr_training_days d where d.program_id = p_program and d.day_no = p_day and d.trainer_id = private.my_id())
$$;
revoke all on function private.training_can_report(uuid, integer) from public, anon;
grant execute on function private.training_can_report(uuid, integer) to authenticated, service_role;
create or replace function private.training_can_view(p_program uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_hr_staff() or exists (select 1 from public.hr_training_days d where d.program_id = p_program and d.trainer_id = private.my_id())
$$;
revoke all on function private.training_can_view(uuid) from public, anon;
grant execute on function private.training_can_view(uuid) to authenticated, service_role;

-- Is a day complete? Attended (present or late) and something recorded; Day 3 also needs its assessment.
create or replace function private.training_day_done(r public.hr_training_day_reports)
returns boolean language sql stable set search_path = '' as $$
  select r.attendance in ('PRESENT', 'LATE')
     and (jsonb_array_length(r.topics_completed) > 0 or exists (select 1 from jsonb_array_elements(r.tasks) t where (t ->> 'done')::boolean is true) or r.assessment_result is not null)
     and (r.day_no < 3 or r.assessment_result is not null)
$$;

-- The status of an enrollment, from what was actually recorded (never from the calendar alone, except that an over program that is not complete is Incomplete).
create or replace function private.training_recompute(p_enrollment uuid, p_today date default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  e public.hr_training_enrollments;
  pr public.hr_training_programs;
  v_today date := coalesce(p_today, private.hr_today());
  v_done integer;
  v_any integer;
  v_status text;
begin
  select * into e from public.hr_training_enrollments where id = p_enrollment for update;
  if e.id is null then return null; end if;
  select * into pr from public.hr_training_programs where id = e.program_id;
  select count(*) filter (where day_completed), count(*) filter (where attendance is not null) into v_done, v_any from public.hr_training_day_reports where enrollment_id = e.id;
  v_status := case
    when v_done >= 3 then 'COMPLETED'
    when v_today > private.training_day_date(pr, 3) or pr.is_cancelled then 'INCOMPLETE'
    when v_any > 0 then 'IN_PROGRESS'
    else 'NOT_STARTED' end;
  if v_status is distinct from e.status then
    update public.hr_training_enrollments set status = v_status where id = e.id;
  end if;
  return v_status;
end $$;
revoke all on function private.training_recompute(uuid, date) from public, anon, authenticated;

-- The consolidated report of one employee's training, from the three day reports. Missing information reads as such, it is never filled in.
create or replace function private.training_consolidated(p_enrollment uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e public.hr_training_enrollments;
  pr public.hr_training_programs;
  v_days jsonb;
  v_att integer;
  v_done integer;
  v_total numeric;
  v_max numeric;
begin
  select * into e from public.hr_training_enrollments where id = p_enrollment;
  select * into pr from public.hr_training_programs where id = e.program_id;
  select coalesce(jsonb_agg(jsonb_build_object(
            'day', d.day_no, 'title', d.title, 'date', private.training_day_date(pr, d.day_no), 'trainer', d.trainer_name,
            'attendance', r.attendance, 'completed', coalesce(r.day_completed, false),
            'topicsPlanned', jsonb_array_length(d.topics), 'topicsCompleted', coalesce(jsonb_array_length(r.topics_completed), 0),
            'tasksTotal', coalesce(jsonb_array_length(r.tasks), 0), 'tasksDone', coalesce((select count(*) from jsonb_array_elements(r.tasks) t where (t ->> 'done')::boolean is true), 0),
            'assessmentTotal', r.assessment_total, 'assessmentMax', r.assessment_max,
            'assessmentPercent', case when coalesce(r.assessment_max, 0) > 0 then round(100 * r.assessment_total / r.assessment_max, 1) end,
            'assessmentResult', r.assessment_result, 'feedback', r.feedback, 'trainerRemarks', r.trainer_remarks, 'report', r.report) order by d.day_no), '[]'::jsonb)
    into v_days
    from public.hr_training_days d left join public.hr_training_day_reports r on r.enrollment_id = e.id and r.day_no = d.day_no where d.program_id = pr.id;
  select count(*) filter (where attendance in ('PRESENT', 'LATE')), count(*) filter (where day_completed), sum(assessment_total), sum(assessment_max)
    into v_att, v_done, v_total, v_max from public.hr_training_day_reports where enrollment_id = e.id;
  return jsonb_build_object(
    'program', pr.name, 'startDate', pr.start_date, 'endDate', private.training_day_date(pr, 3), 'status', e.status,
    'daysAttended', coalesce(v_att, 0), 'daysCompleted', coalesce(v_done, 0), 'days', v_days,
    'assessmentPercent', case when coalesce(v_max, 0) > 0 then round(100 * v_total / v_max, 1) end,
    'strengths', e.strengths, 'improvements', e.improvements, 'trainerRemarks', e.trainer_remarks,
    'missing', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select format('Day %s: no attendance recorded', d.day_no) as x from public.hr_training_days d
          left join public.hr_training_day_reports r on r.enrollment_id = e.id and r.day_no = d.day_no where d.program_id = pr.id and r.attendance is null
        union all select 'Strengths and areas to improve have not been written' where coalesce(btrim(e.strengths), '') = '' and coalesce(btrim(e.improvements), '') = '') m));
end $$;
revoke all on function private.training_consolidated(uuid) from public, anon, authenticated;

create or replace function private.training_program_json(p public.hr_training_programs, p_today date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description, 'startDate', p.start_date, 'endDate', p.start_date + 2, 'isCancelled', p.is_cancelled,
    'ownerId', p.owner_id, 'owner', (select o.full_name from public.profiles o where o.id = p.owner_id),
    'phase', case when p.is_cancelled then 'CANCELLED' when p_today < p.start_date then 'UPCOMING' when p_today > p.start_date + 2 then 'ENDED' else 'RUNNING' end,
    'enrolled', (select count(*) from public.hr_training_enrollments e where e.program_id = p.id),
    'byStatus', coalesce((select jsonb_object_agg(s.status, s.n) from (select e.status, count(*) n from public.hr_training_enrollments e where e.program_id = p.id group by e.status) s), '{}'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object('dayNo', d.day_no, 'date', p.start_date + (d.day_no - 1), 'title', d.title, 'topics', d.topics, 'trainerName', d.trainer_name,
                                                          'trainerId', d.trainer_id, 'criteria', d.criteria, 'passPercent', d.pass_percent) order by d.day_no)
                        from public.hr_training_days d where d.program_id = p.id), '[]'::jsonb))
$$;
revoke all on function private.training_program_json(public.hr_training_programs, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------
create or replace function public.hr_training_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
begin
  perform private.hr_require_staff();
  return jsonb_build_object(
    'today', v_today,
    'employeesEnrolled', (select count(distinct e.employee_key) from public.hr_training_enrollments e join public.hr_training_programs p on p.id = e.program_id where not p.is_cancelled),
    'activePrograms', (select count(*) from public.hr_training_programs p where not p.is_cancelled and v_today between p.start_date and p.start_date + 2),
    'upcomingPrograms', (select count(*) from public.hr_training_programs p where not p.is_cancelled and p.start_date > v_today),
    'completed', (select count(*) from public.hr_training_enrollments e where e.status = 'COMPLETED'),
    'incomplete', (select count(*) from public.hr_training_enrollments e where e.status = 'INCOMPLETE'),
    'pendingTraining', (select count(*) from public.hr_training_enrollments e join public.hr_training_programs p on p.id = e.program_id where e.status in ('NOT_STARTED', 'IN_PROGRESS') and not p.is_cancelled),
    'pendingReports', (select count(*) from public.hr_training_enrollments e join public.hr_training_programs p on p.id = e.program_id
                         cross join generate_series(1, 3) d(n)
                        where not p.is_cancelled and p.start_date + (d.n - 1) <= v_today
                          and not exists (select 1 from public.hr_training_day_reports r where r.enrollment_id = e.id and r.day_no = d.n and r.attendance is not null)));
end $$;

create or replace function public.hr_training_programs_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
begin
  if not (private.is_hr_staff() or exists (select 1 from public.hr_training_days d where d.trainer_id = private.my_id())) then
    raise exception 'FORBIDDEN: Only HR staff and trainers can use the training workspace.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(private.training_program_json(p, v_today) order by p.start_date desc, p.name)
                     from public.hr_training_programs p where private.training_can_view(p.id)), '[]'::jsonb);
end $$;

-- The employees that can be enrolled: active employees of the HR directory.
create or replace function public.hr_training_employees()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.hr_require_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('employeeKey', m.employee_key, 'name', m.full_name, 'department', m.department_name, 'code', m.employee_code,
                                    'designation', private.hr_designation(m.profile_id, m.hr_record_id)) order by m.full_name)
                     from private.hr_mail_employees() m where m.is_active), '[]'::jsonb);
end $$;

create or replace function private.training_enrollment_json(e public.hr_training_enrollments, p public.hr_training_programs, p_today date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'programId', e.program_id, 'program', p.name, 'startDate', p.start_date, 'endDate', p.start_date + 2,
    'employeeKey', e.employee_key, 'employeeName', e.employee_name, 'employeeCode', e.employee_code, 'department', e.department_name, 'designation', e.designation,
    'status', e.status, 'strengths', e.strengths, 'improvements', e.improvements, 'trainerRemarks', e.trainer_remarks,
    'consolidated', e.consolidated, 'consolidatedAt', e.consolidated_at,
    'days', (select jsonb_agg(jsonb_build_object('dayNo', g.n, 'date', p.start_date + (g.n - 1),
                'attendance', r.attendance, 'completed', coalesce(r.day_completed, false), 'reported', r.id is not null,
                'overdue', r.attendance is null and p.start_date + (g.n - 1) < p_today and not p.is_cancelled) order by g.n)
               from generate_series(1, 3) g(n) left join public.hr_training_day_reports r on r.enrollment_id = e.id and r.day_no = g.n))
$$;
revoke all on function private.training_enrollment_json(public.hr_training_enrollments, public.hr_training_programs, date) from public, anon, authenticated;

create or replace function public.hr_training_program_get(p_program uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  p public.hr_training_programs;
  v_today date := private.hr_today();
begin
  select * into p from public.hr_training_programs where id = p_program;
  if p.id is null or not private.training_can_view(p.id) then raise exception 'NOT_FOUND: Training program not found.' using errcode = 'P0001'; end if;
  return private.training_program_json(p, v_today) || jsonb_build_object('enrollments',
    coalesce((select jsonb_agg(private.training_enrollment_json(e, p, v_today) order by e.employee_name) from public.hr_training_enrollments e where e.program_id = p.id), '[]'::jsonb));
end $$;

-- One employee's training record in one program: the configuration of the three days and the report of each.
create or replace function public.hr_training_enrollment_get(p_enrollment uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e public.hr_training_enrollments;
  p public.hr_training_programs;
  v_today date := private.hr_today();
begin
  select * into e from public.hr_training_enrollments where id = p_enrollment;
  select * into p from public.hr_training_programs where id = e.program_id;
  if e.id is null or not private.training_can_view(p.id) then raise exception 'NOT_FOUND: Training record not found.' using errcode = 'P0001'; end if;
  return private.training_enrollment_json(e, p, v_today) || jsonb_build_object(
    'programConfig', private.training_program_json(p, v_today),
    'canReport', jsonb_build_object('1', private.training_can_report(p.id, 1), '2', private.training_can_report(p.id, 2), '3', private.training_can_report(p.id, 3)),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('dayNo', r.day_no, 'attendance', r.attendance, 'topicsCompleted', r.topics_completed, 'tasks', r.tasks, 'scores', r.scores,
                    'assessmentTotal', r.assessment_total, 'assessmentMax', r.assessment_max, 'assessmentResult', r.assessment_result, 'feedback', r.feedback,
                    'trainerRemarks', r.trainer_remarks, 'report', r.report, 'completed', r.day_completed, 'reportedAt', r.reported_at,
                    'reportedBy', (select a.full_name from public.profiles a where a.id = r.reported_by)) order by r.day_no)
                   from public.hr_training_day_reports r where r.enrollment_id = e.id), '[]'::jsonb),
    'preview', private.training_consolidated(e.id));
end $$;

-- Every training an employee attended (the history is never overwritten) - or all employees' records, newest first.
create or replace function public.hr_training_records(p_search text default null, p_status text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_search, '')));
  v_today date := private.hr_today();
  v_total bigint;
begin
  perform private.hr_require_staff();
  if p_status is not null and p_status not in ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'INCOMPLETE') then raise exception 'VALIDATION_ERROR: Unknown training status.' using errcode = 'P0001'; end if;
  select count(*) into v_total from public.hr_training_enrollments e
   where (v_q = '' or position(v_q in lower(e.employee_name)) > 0 or position(v_q in lower(coalesce(e.employee_code, ''))) > 0) and (p_status is null or e.status = p_status);
  return jsonb_build_object('total', v_total, 'items', coalesce((
    select jsonb_agg(private.training_enrollment_json(x.e, x.p, v_today) order by (x.p).start_date desc, (x.e).employee_name)
      from (select e, p from public.hr_training_enrollments e join public.hr_training_programs p on p.id = e.program_id
             where (v_q = '' or position(v_q in lower(e.employee_name)) > 0 or position(v_q in lower(coalesce(e.employee_code, ''))) > 0) and (p_status is null or e.status = p_status)
             order by p.start_date desc, e.employee_name limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------------
create or replace function public.hr_training_program_save(p_id uuid, p_name text, p_description text, p_start date, p_owner uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.hr_training_programs;
  v_today date := private.hr_today();
  d integer;
  v_titles text[] := array['Initial Training', 'Practical Training', 'Final Training and Assessment'];
begin
  perform private.hr_require_staff();
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'VALIDATION_ERROR: Enter the program name.' using errcode = 'P0001'; end if;
  if p_start is null or p_start < v_today - 366 or p_start > v_today + 730 then raise exception 'VALIDATION_ERROR: Enter a valid start date.' using errcode = 'P0001'; end if;
  if p_owner is not null and not exists (select 1 from public.profiles x join public.departments dep on dep.id = x.department_id where x.id = p_owner and dep.slug = 'hr' and x.status = 'ACTIVE') then
    raise exception 'VALIDATION_ERROR: The responsible person must be an active HR employee.' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.hr_training_programs (name, description, start_date, owner_id, created_by)
    values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_start, coalesce(p_owner, private.my_id()), private.my_id()) returning * into p;
    for d in 1..3 loop
      insert into public.hr_training_days (program_id, day_no, title) values (p.id, d, v_titles[d]);
    end loop;
    perform private.write_audit('TRAINING_PROGRAM_CREATED', 'hr_training_program', p.id, null, null, jsonb_build_object('name', p.name, 'start', p.start_date));
  else
    update public.hr_training_programs set name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), ''), start_date = p_start, owner_id = coalesce(p_owner, owner_id)
     where id = p_id returning * into p;
    if p.id is null then raise exception 'NOT_FOUND: Training program not found.' using errcode = 'P0001'; end if;
    -- the three days follow the start date: re-check every enrollment against the new dates
    perform private.training_recompute(e.id) from public.hr_training_enrollments e where e.program_id = p.id;
  end if;
  return private.training_program_json(p, v_today);
end $$;

create or replace function public.hr_training_program_cancel(p_program uuid, p_cancel boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.hr_training_programs;
begin
  perform private.hr_require_staff();
  update public.hr_training_programs set is_cancelled = coalesce(p_cancel, true) where id = p_program returning * into p;
  if p.id is null then raise exception 'NOT_FOUND: Training program not found.' using errcode = 'P0001'; end if;
  perform private.training_recompute(e.id) from public.hr_training_enrollments e where e.program_id = p.id;
  return private.training_program_json(p, private.hr_today());
end $$;

create or replace function public.hr_training_day_save(
  p_program uuid, p_day integer, p_title text, p_topics jsonb, p_trainer_name text, p_trainer_id uuid, p_criteria jsonb, p_pass_percent integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.hr_training_programs;
  c jsonb;
begin
  perform private.hr_require_staff();
  select * into p from public.hr_training_programs where id = p_program;
  if p.id is null then raise exception 'NOT_FOUND: Training program not found.' using errcode = 'P0001'; end if;
  if p_day not between 1 and 3 then raise exception 'VALIDATION_ERROR: A program has three days.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'VALIDATION_ERROR: Enter the title of the day.' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_topics, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_topics, '[]'::jsonb)) > 30 then raise exception 'VALIDATION_ERROR: Topics must be a list of at most 30.' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_criteria, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_criteria, '[]'::jsonb)) > 20 then raise exception 'VALIDATION_ERROR: Assessment criteria must be a list of at most 20.' using errcode = 'P0001'; end if;
  for c in select * from jsonb_array_elements(coalesce(p_criteria, '[]'::jsonb)) loop
    if length(btrim(coalesce(c ->> 'name', ''))) < 1 or coalesce((c ->> 'max')::numeric, 0) <= 0 or (c ->> 'max')::numeric > 1000 then
      raise exception 'VALIDATION_ERROR: Every assessment criterion needs a name and a maximum score above 0.' using errcode = 'P0001';
    end if;
  end loop;
  if p_trainer_id is not null and not exists (select 1 from public.profiles x where x.id = p_trainer_id and x.status = 'ACTIVE') then
    raise exception 'VALIDATION_ERROR: The trainer must be an active CRM user.' using errcode = 'P0001';
  end if;
  update public.hr_training_days
     set title = btrim(p_title), topics = coalesce(p_topics, '[]'::jsonb), trainer_name = nullif(btrim(coalesce(p_trainer_name, '')), ''), trainer_id = p_trainer_id,
         criteria = coalesce(p_criteria, '[]'::jsonb), pass_percent = p_pass_percent
   where program_id = p.id and day_no = p_day;
  return private.training_program_json(p, private.hr_today());
end $$;

create or replace function public.hr_training_enroll(p_program uuid, p_employee_keys text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.hr_training_programs;
  m record;
  v_added integer := 0;
  v_missing text[] := '{}';
  k text;
begin
  perform private.hr_require_staff();
  select * into p from public.hr_training_programs where id = p_program;
  if p.id is null then raise exception 'NOT_FOUND: Training program not found.' using errcode = 'P0001'; end if;
  if p.is_cancelled then raise exception 'CONFLICT: This program is cancelled.' using errcode = 'P0001'; end if;
  if coalesce(array_length(p_employee_keys, 1), 0) = 0 then raise exception 'VALIDATION_ERROR: Choose at least one employee.' using errcode = 'P0001'; end if;
  foreach k in array p_employee_keys loop
    select * into m from private.hr_mail_employees() x where x.employee_key = k and x.is_active;
    if m.employee_key is null then v_missing := v_missing || k; continue; end if;
    insert into public.hr_training_enrollments (program_id, employee_key, profile_id, employee_name, employee_code, department_name, designation, enrolled_by)
    values (p.id, m.employee_key, m.profile_id, m.full_name, m.employee_code, m.department_name, private.hr_designation(m.profile_id, m.hr_record_id), private.my_id())
    on conflict (program_id, employee_key) do nothing;
    if found then v_added := v_added + 1; end if;
  end loop;
  perform private.write_audit('TRAINING_ENROLLED', 'hr_training_program', p.id, null, null, jsonb_build_object('added', v_added));
  return jsonb_build_object('added', v_added, 'skipped', coalesce(array_length(p_employee_keys, 1), 0) - v_added, 'unknown', to_jsonb(v_missing));
end $$;

-- Remove an enrollment made by mistake (only while nothing has been recorded for it).
create or replace function public.hr_training_unenroll(p_enrollment uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.hr_require_staff();
  if exists (select 1 from public.hr_training_day_reports where enrollment_id = p_enrollment) then
    raise exception 'CONFLICT: Reports were already recorded for this employee, so the record is kept.' using errcode = 'P0001';
  end if;
  delete from public.hr_training_enrollments where id = p_enrollment;
  if not found then raise exception 'NOT_FOUND: Training record not found.' using errcode = 'P0001'; end if;
end $$;

-- Record (or correct) one day for one employee.
create or replace function public.hr_training_report_save(
  p_enrollment uuid, p_day integer, p_attendance text, p_topics_completed jsonb, p_tasks jsonb, p_scores jsonb, p_feedback text, p_trainer_remarks text, p_report text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.hr_training_enrollments;
  p public.hr_training_programs;
  d public.hr_training_days;
  r public.hr_training_day_reports;
  s jsonb;
  v_topics jsonb := coalesce(p_topics_completed, '[]'::jsonb);
  v_tasks jsonb := coalesce(p_tasks, '[]'::jsonb);
  v_scores jsonb := '[]'::jsonb;
  v_total numeric;
  v_max numeric;
  v_result text;
  v_crit jsonb;
  v_status text;
begin
  select * into e from public.hr_training_enrollments where id = p_enrollment for update;
  if e.id is null then raise exception 'NOT_FOUND: Training record not found.' using errcode = 'P0001'; end if;
  select * into p from public.hr_training_programs where id = e.program_id;
  if not private.training_can_report(p.id, p_day) then raise exception 'FORBIDDEN: Only HR staff or the trainer of this day can record its report.' using errcode = '42501'; end if;
  if p.is_cancelled then raise exception 'CONFLICT: This program is cancelled.' using errcode = 'P0001'; end if;
  select * into d from public.hr_training_days where program_id = p.id and day_no = p_day;
  if d.id is null then raise exception 'VALIDATION_ERROR: A program has three days.' using errcode = 'P0001'; end if;
  if p_attendance is not null and p_attendance not in ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED') then raise exception 'VALIDATION_ERROR: Choose the attendance.' using errcode = 'P0001'; end if;
  if private.training_day_date(p, p_day) > private.hr_today() then raise exception 'CONFLICT: Day % is on %: it cannot be reported before it takes place.', p_day, to_char(private.training_day_date(p, p_day), 'DD Mon YYYY') using errcode = 'P0001'; end if;
  if jsonb_typeof(v_topics) <> 'array' or jsonb_array_length(v_topics) > 30 then raise exception 'VALIDATION_ERROR: Topics must be a list.' using errcode = 'P0001'; end if;
  if jsonb_typeof(v_tasks) <> 'array' or jsonb_array_length(v_tasks) > 30 then raise exception 'VALIDATION_ERROR: Tasks must be a list.' using errcode = 'P0001'; end if;
  if p_attendance in ('ABSENT', 'EXCUSED') and (jsonb_array_length(v_topics) > 0 or exists (select 1 from jsonb_array_elements(v_tasks) t where (t ->> 'done')::boolean is true)) then
    raise exception 'VALIDATION_ERROR: An employee marked absent cannot have topics or tasks recorded as done.' using errcode = 'P0001';
  end if;

  -- scores are checked against the criteria configured for the day
  for s in select * from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) loop
    select c into v_crit from jsonb_array_elements(d.criteria) c where c ->> 'name' = s ->> 'criterion' limit 1;
    if v_crit is null then raise exception 'VALIDATION_ERROR: "%" is not an assessment criterion of this day.', s ->> 'criterion' using errcode = 'P0001'; end if;
    if (s ->> 'score') is null or (s ->> 'score')::numeric < 0 or (s ->> 'score')::numeric > (v_crit ->> 'max')::numeric then
      raise exception 'VALIDATION_ERROR: The score for "%" must be between 0 and %.', s ->> 'criterion', v_crit ->> 'max' using errcode = 'P0001';
    end if;
    v_scores := v_scores || jsonb_build_object('criterion', s ->> 'criterion', 'score', (s ->> 'score')::numeric, 'max', (v_crit ->> 'max')::numeric);
  end loop;
  if jsonb_array_length(v_scores) > 0 and p_attendance not in ('PRESENT', 'LATE') then
    raise exception 'VALIDATION_ERROR: Scores can only be recorded for an employee who attended.' using errcode = 'P0001';
  end if;
  select sum((x ->> 'score')::numeric), sum((x ->> 'max')::numeric) into v_total, v_max from jsonb_array_elements(v_scores) x;
  v_result := case when jsonb_array_length(v_scores) = 0 then null
                   when d.pass_percent is null then 'RECORDED'
                   when 100 * v_total / nullif(v_max, 0) >= d.pass_percent then 'PASS' else 'FAIL' end;

  insert into public.hr_training_day_reports (enrollment_id, day_no, attendance, topics_completed, tasks, scores, assessment_total, assessment_max, assessment_result,
                                              feedback, trainer_remarks, report, reported_by)
  values (e.id, p_day, p_attendance, v_topics, v_tasks, v_scores, v_total, v_max, v_result,
          left(nullif(btrim(coalesce(p_feedback, '')), ''), 2000), left(nullif(btrim(coalesce(p_trainer_remarks, '')), ''), 2000), left(nullif(btrim(coalesce(p_report, '')), ''), 4000), private.my_id())
  on conflict (enrollment_id, day_no) do update
     set attendance = excluded.attendance, topics_completed = excluded.topics_completed, tasks = excluded.tasks, scores = excluded.scores,
         assessment_total = excluded.assessment_total, assessment_max = excluded.assessment_max, assessment_result = excluded.assessment_result,
         feedback = excluded.feedback, trainer_remarks = excluded.trainer_remarks, report = excluded.report, reported_by = excluded.reported_by,
         reported_at = now(), updated_at = now()
  returning * into r;
  update public.hr_training_day_reports set day_completed = private.training_day_done(r) where id = r.id returning * into r;
  v_status := private.training_recompute(e.id);
  if v_status in ('COMPLETED', 'INCOMPLETE') then
    update public.hr_training_enrollments set consolidated = private.training_consolidated(e.id), consolidated_at = now() where id = e.id;
  end if;
  return jsonb_build_object('dayNo', r.day_no, 'completed', r.day_completed, 'status', v_status, 'assessmentResult', r.assessment_result);
end $$;

create or replace function public.hr_training_enrollment_review(p_enrollment uuid, p_strengths text, p_improvements text, p_remarks text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.hr_training_enrollments;
begin
  select * into e from public.hr_training_enrollments where id = p_enrollment for update;
  if e.id is null then raise exception 'NOT_FOUND: Training record not found.' using errcode = 'P0001'; end if;
  if not (private.is_hr_staff() or private.training_can_report(e.program_id, 3) or private.training_can_report(e.program_id, 1) or private.training_can_report(e.program_id, 2)) then
    raise exception 'FORBIDDEN: Only HR staff or a trainer of this program can write the review.' using errcode = '42501';
  end if;
  update public.hr_training_enrollments
     set strengths = left(nullif(btrim(coalesce(p_strengths, '')), ''), 2000), improvements = left(nullif(btrim(coalesce(p_improvements, '')), ''), 2000), trainer_remarks = left(nullif(btrim(coalesce(p_remarks, '')), ''), 2000)
   where id = e.id returning * into e;
  if e.status in ('COMPLETED', 'INCOMPLETE') then
    update public.hr_training_enrollments set consolidated = private.training_consolidated(e.id), consolidated_at = now() where id = e.id;
  end if;
  return jsonb_build_object('id', e.id, 'status', e.status);
end $$;

-- ---------------------------------------------------------------------------
-- The daily check (service role): statuses follow the calendar for programs that are over, the consolidated reports are made, and the
-- responsible HR employee is reminded of the day reports that are still missing (once per program and day).
-- ---------------------------------------------------------------------------
create or replace function public.hr_training_tick(p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := coalesce(p_today, private.hr_today());
  e record;
  p record;
  v_changed integer := 0;
  v_reports integer := 0;
  v_notified integer := 0;
  v_missing integer;
  v_status text;
begin
  if not pg_try_advisory_xact_lock(hashtext('hr_training_tick')) then return jsonb_build_object('skipped', 'Another run is in progress.'); end if;
  for e in select en.id, en.status, en.consolidated_at from public.hr_training_enrollments en join public.hr_training_programs pr on pr.id = en.program_id
            where pr.start_date + 2 >= v_today - 60 loop
    v_status := private.training_recompute(e.id, v_today);
    if v_status is distinct from e.status then v_changed := v_changed + 1; end if;
    -- the consolidated report once the training is over (completed or not)
    if v_status in ('COMPLETED', 'INCOMPLETE') and e.consolidated_at is null then
      update public.hr_training_enrollments set consolidated = private.training_consolidated(e.id), consolidated_at = now() where id = e.id;
      v_reports := v_reports + 1;
    end if;
  end loop;
  for p in select * from public.hr_training_programs where not is_cancelled and start_date <= v_today and start_date + 2 >= v_today - 7 loop
    select count(*) into v_missing from public.hr_training_enrollments en cross join generate_series(1, 3) d(n)
     where en.program_id = p.id and p.start_date + (d.n - 1) <= v_today
       and not exists (select 1 from public.hr_training_day_reports r where r.enrollment_id = en.id and r.day_no = d.n and r.attendance is not null);
    if v_missing > 0 and p.owner_id is not null then
      perform private.notify_once(p.owner_id, 'TRAINING_REPORTS_PENDING', format('Training reports pending: %s', p.name),
        format('%s day report(s) have no attendance recorded yet.', v_missing), 'hr_training_program', p.id, format('TRAINING_PENDING:%s:%s', p.id, v_today));
      v_notified := v_notified + 1;
    end if;
  end loop;
  return jsonb_build_object('day', v_today, 'statusesChanged', v_changed, 'consolidatedReports', v_reports, 'reminders', v_notified);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'hr_training_overview()', 'hr_training_programs_list()', 'hr_training_employees()', 'hr_training_program_get(uuid)', 'hr_training_enrollment_get(uuid)',
    'hr_training_records(text, text, integer, integer)', 'hr_training_program_save(uuid, text, text, date, uuid)', 'hr_training_program_cancel(uuid, boolean)',
    'hr_training_day_save(uuid, integer, text, jsonb, text, uuid, jsonb, integer)', 'hr_training_enroll(uuid, text[])', 'hr_training_unenroll(uuid)',
    'hr_training_report_save(uuid, integer, text, jsonb, jsonb, jsonb, text, text, text)', 'hr_training_enrollment_review(uuid, text, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.hr_training_tick(date) from public, anon, authenticated;
grant execute on function public.hr_training_tick(date) to service_role;

notify pgrst, 'reload schema';
