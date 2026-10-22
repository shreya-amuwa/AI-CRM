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
