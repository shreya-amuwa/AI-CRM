-- Run this ONE file once in the Supabase SQL editor (safe to run again). It is the migration 20261214000100_top_performers.sql.
-- It needs the work reports migration (20261213000100) and the earlier performance / hierarchy migrations to be applied already.

-- =============================================================================
-- Top Performers & Rankings: monthly performance scores, rankings, AI evaluations and monthly recognition.
-- Safe to run again; nothing is deleted or rewritten (only new tables and functions).
--
-- Where the numbers come from (no manual entry, no copies of existing records):
--   * public.work_tasks / public.work_task_updates      the tasks (assigned, deadline, completion time, priority, BLOCKED status)
--   * public.work_reports                                the reports. ONLY reports with status APPROVED count as verified work; drafts,
--                                                        submitted-but-not-approved, rejected and revision-required reports never raise a score.
--   * profiles / teams                                   who is in which department and team
--
-- Methodology (one source of truth: private.rank_methodology(), shown on the screen):
--   Team Member: weighted completion 30, on time 20, speed 10, report consistency 15, report quality 15, steadiness 10
--   Team Lead:   own completion 15, own on time 10, report consistency 10, report quality 10, team completion 15, team on time 10,
--                review timeliness 10, task distribution 10, team improvement 10
--   A component without data is left out and the others are scaled (score = sum(value x weight) / sum(weights present)).
--   Fairness rules: tasks are weighted by priority; a duplicate task (same title and deadline) counts once; a task completed within five
--   minutes of being created is not credited; a task a Team Lead split among members belongs to the members; a task that is BLOCKED (an external
--   dependency) is neither counted as missed nor as late; open tasks whose deadline has not passed are not counted yet.
--   Fewer than 3 judged tasks (or, for a Team Lead, fewer than 3 judged team tasks) = "Insufficient Data": no score, no rank.
--
-- Who may do what (all through security definer functions that look at the caller; the tables have no direct access):
--   Department Head: the rankings of their own department; approves or rejects the monthly recommendations of their own department
--   Operations Head: the rankings of the departments they manage (read only)    Super Admin: every department (read only)
--   Team Leads and Team Members: nothing here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
-- One current score per person per month (the department is the real/base department).
create table if not exists public.performer_scores (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  role_kind text not null check (role_kind in ('MEMBER', 'TEAM_LEAD')),
  period_start date not null,
  period_end date not null,
  status text not null check (status in ('RANKED', 'INSUFFICIENT_DATA')),
  score numeric(5, 2) check (score between 0 and 100),
  components jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  fingerprint text not null,
  version integer not null default 1,
  rank integer,
  previous_score numeric(5, 2),
  active boolean not null default true,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint performer_scores_period_ok check (period_end >= period_start and period_end - period_start <= 31),
  constraint performer_scores_ranked_ok check ((status = 'RANKED' and score is not null) or (status = 'INSUFFICIENT_DATA' and score is null and rank is null)),
  unique (profile_id, period_start)
);
create index if not exists performer_scores_department_idx on public.performer_scores (department_id, period_start, role_kind, rank);

-- every version of a score (a new row whenever the figures change), so months and quarters can be compared later
create table if not exists public.performer_score_history (
  id bigint generated always as identity primary key,
  score_id uuid not null references public.performer_scores (id) on delete cascade,
  version integer not null,
  status text not null,
  score numeric(5, 2),
  fingerprint text not null,
  components jsonb not null,
  metrics jsonb not null,
  computed_at timestamptz not null default now(),
  unique (score_id, version)
);

-- the written explanation of a score (AI when configured, otherwise rules) and the log of the attempt; one row per figures version
create table if not exists public.performer_evaluations (
  id uuid primary key default gen_random_uuid(),
  score_id uuid not null references public.performer_scores (id) on delete cascade,
  fingerprint text not null,
  narrative jsonb,
  source text check (source in ('AI', 'RULES')),
  ai_status text not null default 'PENDING' check (ai_status in ('PENDING', 'OK', 'FAILED', 'NOT_CONFIGURED')),
  ai_model text,
  ai_error text check (length(ai_error) <= 300),
  attempts integer not null default 0,
  attempted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (score_id, fingerprint)
);

-- the monthly recognition: the system RECOMMENDS, only the Department Head makes it official
create table if not exists public.performer_recognitions (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  period_start date not null,
  award_type text not null check (award_type in ('EMPLOYEE_OF_MONTH', 'TOP_EMPLOYEE', 'BEST_TEAM_LEAD', 'MOST_IMPROVED', 'HIGHEST_COMPLETION', 'BEST_REPORT_CONSISTENCY')),
  place smallint not null default 1 check (place between 1 and 3),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  score numeric(5, 2),
  value numeric(7, 2),
  reason text not null check (length(reason) <= 500),
  status text not null default 'RECOMMENDED' check (status in ('RECOMMENDED', 'APPROVED', 'REJECTED')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text check (length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint performer_recognitions_decision_ok check ((status = 'RECOMMENDED' and decided_at is null) or (status <> 'RECOMMENDED' and decided_at is not null)),
  unique (department_id, period_start, award_type, place)
);
create index if not exists performer_recognitions_profile_idx on public.performer_recognitions (profile_id);

-- the history of every recommendation and decision
create table if not exists public.performer_recognition_events (
  id bigint generated always as identity primary key,
  recognition_id uuid not null references public.performer_recognitions (id) on delete cascade,
  action text not null check (action in ('RECOMMENDED', 'CHANGED', 'APPROVED', 'REJECTED')),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  profile_id uuid,
  score numeric(5, 2),
  note text check (length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists performer_recognition_events_idx on public.performer_recognition_events (recognition_id, id);

alter table public.performer_scores enable row level security;
alter table public.performer_score_history enable row level security;
alter table public.performer_evaluations enable row level security;
alter table public.performer_recognitions enable row level security;
alter table public.performer_recognition_events enable row level security;
revoke all on public.performer_scores, public.performer_score_history, public.performer_evaluations, public.performer_recognitions,
  public.performer_recognition_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The methodology (shown on the screen and used by the scoring)
-- ---------------------------------------------------------------------------
create or replace function private.rank_methodology()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'member', jsonb_build_array(
      jsonb_build_object('key', 'completion', 'label', 'Task completion (weighted by priority)', 'weight', 30),
      jsonb_build_object('key', 'on_time', 'label', 'Deadlines met', 'weight', 20),
      jsonb_build_object('key', 'speed', 'label', 'Completion time against the planned window', 'weight', 10),
      jsonb_build_object('key', 'report_consistency', 'label', 'Approved report coverage of working days', 'weight', 15),
      jsonb_build_object('key', 'report_quality', 'label', 'Report quality (Team Lead review outcome)', 'weight', 15),
      jsonb_build_object('key', 'steadiness', 'label', 'Consistency from week to week', 'weight', 10)),
    'teamLead', jsonb_build_array(
      jsonb_build_object('key', 'own_completion', 'label', 'Own task completion (weighted)', 'weight', 15),
      jsonb_build_object('key', 'own_on_time', 'label', 'Own deadlines met', 'weight', 10),
      jsonb_build_object('key', 'report_consistency', 'label', 'Own approved report coverage', 'weight', 10),
      jsonb_build_object('key', 'report_quality', 'label', 'Own report quality (Department Head review)', 'weight', 10),
      jsonb_build_object('key', 'team_completion', 'label', 'Team task completion (weighted)', 'weight', 15),
      jsonb_build_object('key', 'team_on_time', 'label', 'Team deadlines met', 'weight', 10),
      jsonb_build_object('key', 'review_timeliness', 'label', 'Team reports reviewed within 48 hours', 'weight', 10),
      jsonb_build_object('key', 'distribution', 'label', 'Task distribution across the team', 'weight', 10),
      jsonb_build_object('key', 'team_improvement', 'label', 'Team improvement against last month', 'weight', 10)),
    'thresholds', jsonb_build_object('minJudgedTasks', 3, 'minWeightPresent', 40, 'minRankedForAwards', 2, 'trendPoints', 3, 'reviewHours', 48),
    'rules', jsonb_build_array(
      'Only APPROVED reports count. Drafts, reports still waiting, rejected and revision-required reports never raise a score.',
      'Tasks are weighted by priority (High 3, Medium 2, Low 1): finishing many small tasks does not outrank finishing the important ones.',
      'A duplicate task (same title and deadline) counts once, and a task completed within five minutes of being created is not credited.',
      'A task a Team Lead split among members belongs to the members. A task that is BLOCKED (an external dependency) is neither missed nor late.',
      'Open tasks whose deadline has not passed yet are not counted.',
      'With fewer than 3 judged tasks a person is shown as Insufficient Data and is not ranked.',
      'The CRM records no task complexity or quality score: priority stands in for complexity and the Team Lead / Department Head review of the reports stands in for quality.',
      'Scores are recalculated from the live records whenever the page is opened and once a day; every version is kept so months and quarters can be compared.',
      'Recommendations become official only when the Department Head approves them, and only after the month has ended.'))
$$;
revoke all on function private.rank_methodology() from public, anon;
grant execute on function private.rank_methodology() to authenticated, service_role;

create or replace function private.rank_weight(p_kind text, p_key text)
returns numeric language sql immutable set search_path = '' as $$
  select (c ->> 'weight')::numeric from jsonb_array_elements(private.rank_methodology() -> p_kind) c where c ->> 'key' = p_key
$$;
revoke all on function private.rank_weight(text, text) from public, anon;
grant execute on function private.rank_weight(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The figures
-- ---------------------------------------------------------------------------
-- Task figures for a set of people over a period (see the rules above).
create or replace function private.rank_task_stats(p_people uuid[], p_start date, p_end date, p_today date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with base as (
    select t.id, t.assignee_id, t.priority, t.status, t.due_date, t.created_at, t.completed_at,
           (t.created_at at time zone 'Asia/Kolkata')::date as created_on,
           (t.completed_at at time zone 'Asia/Kolkata')::date as completed_on,
           lower(regexp_replace(btrim(t.title), '\s+', ' ', 'g')) as norm,
           case t.priority when 'HIGH' then 3 when 'MEDIUM' then 2 else 1 end as w,
           (t.status = 'BLOCKED' or exists (select 1 from public.work_task_updates u where u.task_id = t.id and u.status = 'BLOCKED')) as blocked,
           exists (select 1 from public.work_tasks c where c.parent_id = t.id) as delegated
      from public.work_tasks t
     where t.assignee_id = any (p_people)
       and coalesce(t.due_date, (t.created_at at time zone 'Asia/Kolkata')::date) between p_start and p_end
  ), numbered as (
    select b.*, row_number() over (partition by b.assignee_id, b.norm, coalesce(b.due_date, b.created_on) order by b.created_at, b.id) as dup_n from base b
  ), flagged as (
    select n.*, (n.dup_n > 1) as is_dup,
           (n.status = 'COMPLETED' and n.completed_at is not null and n.completed_at - n.created_at < interval '5 minutes') as is_instant,
           (n.blocked and n.status <> 'COMPLETED') as is_excused
      from numbered n
  ), counted as (
    select f.*, (f.status = 'COMPLETED') as done from flagged f where not f.is_dup and not f.is_instant and not f.delegated and not f.is_excused
  ), matured as (
    select c.* from counted c where c.done or (c.due_date is not null and c.due_date < p_today) or (c.due_date is null and c.created_on <= p_today - 7)
  ), weekly as (
    select 100.0 * sum(m.w) filter (where m.done) / sum(m.w) as pct
      from matured m group by date_trunc('week', coalesce(m.due_date, m.created_on)::timestamp) having count(*) >= 2
  )
  select jsonb_build_object(
    'assigned', (select count(*) from counted),
    'completed', (select count(*) from counted where done),
    'judged', (select count(*) from matured),
    'judgedDone', (select count(*) from matured where done),
    'weightedDone', (select coalesce(sum(w), 0) from matured where done),
    'weightedTotal', (select coalesce(sum(w), 0) from matured),
    'onTime', (select count(*) from matured where done and due_date is not null and completed_on <= due_date),
    'late', (select count(*) from matured where done and due_date is not null and completed_on > due_date and not blocked),
    'speed', (select round(avg(least(100.0, 100.0 * greatest(due_date - created_on, 1) / greatest(completed_on - created_on, 1))), 2)
                from matured where done and due_date is not null and completed_on is not null and not blocked),
    'weeks', (select count(*) from weekly),
    'weekStd', (select round(stddev_pop(pct)::numeric, 2) from weekly),
    'perPerson', (select coalesce(jsonb_object_agg(x.assignee_id, x.n), '{}'::jsonb) from (select assignee_id, count(*) as n from counted group by assignee_id) x),
    'excluded', jsonb_build_object(
      'duplicates', (select count(*) from flagged where is_dup),
      'instant', (select count(*) from flagged where is_instant and not is_dup),
      'delegated', (select count(*) from flagged where delegated and not is_dup),
      'blocked', (select count(*) from flagged where is_excused and not is_dup and not delegated)))
$$;
revoke all on function private.rank_task_stats(uuid[], date, date, date) from public, anon, authenticated;

-- Report figures for one author over a period. Only APPROVED reports are verified work.
create or replace function private.rank_report_stats(p_author uuid, p_start date, p_end date, p_today date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with rep as (
    select r.status, r.revision, r.period_start, r.period_end from public.work_reports r
     where r.author_id = p_author and r.status <> 'DRAFT' and r.period_end >= p_start and r.period_start <= p_end
  ), days as (
    select g.d::date as d from generate_series(p_start::timestamp, least(p_end, p_today)::timestamp, interval '1 day') g(d) where extract(isodow from g.d) < 6
  )
  select jsonb_build_object(
    'workingDays', (select count(*) from days),
    'coveredDays', (select count(*) from days where exists (select 1 from rep where rep.status = 'APPROVED' and days.d between rep.period_start and rep.period_end)),
    'approved', (select count(*) from rep where status = 'APPROVED'),
    'pending', (select count(*) from rep where status in ('SUBMITTED', 'UNDER_REVIEW')),
    'rejected', (select count(*) from rep where status = 'REJECTED'),
    'revision', (select count(*) from rep where status = 'REVISION_REQUIRED'),
    'quality', (select round(avg(case when status = 'APPROVED' and revision <= 1 then 100 when status = 'APPROVED' then 70 when status = 'REVISION_REQUIRED' then 40 else 0 end), 2)
                  from rep where status in ('APPROVED', 'REJECTED', 'REVISION_REQUIRED')))
$$;
revoke all on function private.rank_report_stats(uuid, date, date, date) from public, anon, authenticated;

-- How fast a Team Lead reviewed the reports of their team: within 48 hours, or still waiting after 48 hours.
create or replace function private.rank_review_stats(p_team uuid, p_start date, p_end date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'timely', count(*) filter (where r.reviewed_at is not null and r.reviewed_at - r.submitted_at <= interval '48 hours'),
    'late', count(*) filter (where (r.reviewed_at is not null and r.reviewed_at - r.submitted_at > interval '48 hours')
                                or (r.reviewed_at is null and now() - r.submitted_at > interval '48 hours')))
    from public.work_reports r
   where r.kind = 'MEMBER' and r.team_id = p_team and r.status <> 'DRAFT' and r.submitted_at is not null
     and (r.submitted_at at time zone 'Asia/Kolkata')::date between p_start and p_end
$$;
revoke all on function private.rank_review_stats(uuid, date, date) from public, anon, authenticated;

create or replace function private.rank_comp(p_kind text, p_key text, p_value numeric, p_detail text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('key', p_key,
    'label', (select c ->> 'label' from jsonb_array_elements(private.rank_methodology() -> p_kind) c where c ->> 'key' = p_key),
    'weight', private.rank_weight(p_kind, p_key),
    'value', case when p_value is null then null else round(greatest(0, least(100, p_value)), 2) end,
    'detail', p_detail)
$$;
revoke all on function private.rank_comp(text, text, numeric, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. One person's score for a month
-- ---------------------------------------------------------------------------
create or replace function private.rank_person(p_profile uuid, p_start date, p_end date, p_today date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  p public.profiles;
  v_kind text;
  v_prev_start date := (p_start - interval '1 month')::date;
  v_prev_end date := p_start - 1;
  v_comps jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  own jsonb;
  rep jsonb;
  team jsonb;
  prev jsonb;
  rev jsonb;
  v_members uuid[];
  v_n integer;
  v_pct numeric;
  v_prev_pct numeric;
  v_ontime numeric;
  v_sum numeric := 0;
  v_weight numeric := 0;
  v_score numeric;
  v_status text;
  v_prod numeric;
  v_judged integer;
  v_cov numeric;
  v_active integer;
  v_sd numeric;
  v_mean numeric;
  c jsonb;
begin
  select * into p from public.profiles where id = p_profile;
  v_kind := case when p.role = 'TEAM_HEAD' then 'TEAM_LEAD' else 'MEMBER' end;
  own := private.rank_task_stats(array[p_profile], p_start, p_end, p_today);
  rep := private.rank_report_stats(p_profile, p_start, p_end, p_today);
  v_cov := case when (rep ->> 'workingDays')::int > 0 then round(100.0 * (rep ->> 'coveredDays')::int / (rep ->> 'workingDays')::int, 2) end;

  if v_kind = 'MEMBER' then
    v_judged := (own ->> 'judged')::int;
    v_pct := case when (own ->> 'weightedTotal')::numeric > 0 then 100.0 * (own ->> 'weightedDone')::numeric / (own ->> 'weightedTotal')::numeric end;
    v_ontime := case when (own ->> 'onTime')::int + (own ->> 'late')::int > 0 then 100.0 * (own ->> 'onTime')::int / ((own ->> 'onTime')::int + (own ->> 'late')::int) end;
    v_comps := jsonb_build_array(
      private.rank_comp('member', 'completion', v_pct, format('%s of %s judged tasks completed', own ->> 'judgedDone', own ->> 'judged')),
      private.rank_comp('member', 'on_time', v_ontime, format('%s on time, %s late', own ->> 'onTime', own ->> 'late')),
      private.rank_comp('member', 'speed', (own ->> 'speed')::numeric, 'Time taken against the window between assignment and deadline'),
      private.rank_comp('member', 'report_consistency', v_cov, format('%s of %s working days covered by approved reports', rep ->> 'coveredDays', rep ->> 'workingDays')),
      private.rank_comp('member', 'report_quality', (rep ->> 'quality')::numeric, format('%s approved, %s waiting, %s sent back or rejected', rep ->> 'approved', rep ->> 'pending', (rep ->> 'rejected')::int + (rep ->> 'revision')::int)),
      private.rank_comp('member', 'steadiness', case when (own ->> 'weeks')::int >= 2 then 100 - 2 * (own ->> 'weekStd')::numeric end,
        case when (own ->> 'weeks')::int >= 2 then format('Weekly completion varied by %s points', own ->> 'weekStd') else 'Needs two weeks with tasks' end));
    if v_judged < 3 then
      v_reasons := v_reasons || to_jsonb(format('Only %s judged task(s) this month; at least 3 are needed for a fair ranking.', v_judged));
    end if;
    v_prod := (select avg((x ->> 'value')::numeric) from jsonb_array_elements(v_comps) x where x ->> 'key' in ('completion', 'on_time', 'speed') and x ->> 'value' is not null);
    team := null;
  else
    select coalesce(array_agg(m.id), array[]::uuid[]) into v_members from public.profiles m where m.team_id = p.team_id and m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE';
    team := private.rank_task_stats(v_members, p_start, p_end, p_today);
    prev := private.rank_task_stats(v_members, v_prev_start, v_prev_end, v_prev_end);
    rev := private.rank_review_stats(p.team_id, p_start, p_end);
    v_judged := (team ->> 'judged')::int;
    v_pct := case when (team ->> 'weightedTotal')::numeric > 0 then 100.0 * (team ->> 'weightedDone')::numeric / (team ->> 'weightedTotal')::numeric end;
    v_prev_pct := case when (prev ->> 'weightedTotal')::numeric > 0 and (prev ->> 'judged')::int >= 3 then 100.0 * (prev ->> 'weightedDone')::numeric / (prev ->> 'weightedTotal')::numeric end;
    -- own tasks
    v_ontime := case when (own ->> 'onTime')::int + (own ->> 'late')::int > 0 then 100.0 * (own ->> 'onTime')::int / ((own ->> 'onTime')::int + (own ->> 'late')::int) end;
    -- task distribution: how many members got work, and how evenly
    v_n := coalesce(array_length(v_members, 1), 0);
    v_active := (select count(*) from jsonb_object_keys(team -> 'perPerson'));
    v_mean := case when v_n > 0 then (team ->> 'assigned')::numeric / v_n end;
    v_sd := (select sqrt(avg(power(coalesce((team -> 'perPerson' ->> m::text)::numeric, 0) - v_mean, 2))) from unnest(v_members) m);
    v_comps := jsonb_build_array(
      private.rank_comp('teamLead', 'own_completion',
        case when (own ->> 'weightedTotal')::numeric > 0 then 100.0 * (own ->> 'weightedDone')::numeric / (own ->> 'weightedTotal')::numeric end,
        format('%s of %s judged own tasks completed', own ->> 'judgedDone', own ->> 'judged')),
      private.rank_comp('teamLead', 'own_on_time', v_ontime, format('%s on time, %s late', own ->> 'onTime', own ->> 'late')),
      private.rank_comp('teamLead', 'report_consistency', v_cov, format('%s of %s working days covered by approved reports', rep ->> 'coveredDays', rep ->> 'workingDays')),
      private.rank_comp('teamLead', 'report_quality', (rep ->> 'quality')::numeric, format('%s approved, %s waiting, %s sent back or rejected', rep ->> 'approved', rep ->> 'pending', (rep ->> 'rejected')::int + (rep ->> 'revision')::int)),
      private.rank_comp('teamLead', 'team_completion', v_pct, format('%s of %s judged team tasks completed', team ->> 'judgedDone', team ->> 'judged')),
      private.rank_comp('teamLead', 'team_on_time',
        case when (team ->> 'onTime')::int + (team ->> 'late')::int > 0 then 100.0 * (team ->> 'onTime')::int / ((team ->> 'onTime')::int + (team ->> 'late')::int) end,
        format('%s on time, %s late across the team', team ->> 'onTime', team ->> 'late')),
      private.rank_comp('teamLead', 'review_timeliness',
        case when (rev ->> 'timely')::int + (rev ->> 'late')::int > 0 then 100.0 * (rev ->> 'timely')::int / ((rev ->> 'timely')::int + (rev ->> 'late')::int) end,
        format('%s reviewed within 48 hours, %s later or still waiting', rev ->> 'timely', rev ->> 'late')),
      private.rank_comp('teamLead', 'distribution',
        case when v_n >= 2 and v_mean > 0 then 100.0 * (v_active::numeric / v_n) * (1 - 0.5 * least(v_sd / v_mean, 1)) end,
        format('%s of %s team members were given tasks', v_active, v_n)),
      private.rank_comp('teamLead', 'team_improvement',
        case when v_pct is not null and v_prev_pct is not null then 50 + 2.5 * (v_pct - v_prev_pct) end,
        case when v_prev_pct is null then 'Needs last month''s team tasks' else format('Team completion %s%% against %s%% last month', round(v_pct, 1), round(v_prev_pct, 1)) end));
    if v_judged < 3 then
      v_reasons := v_reasons || to_jsonb(format('Only %s judged team task(s) this month; at least 3 are needed for a fair ranking.', v_judged));
    end if;
    v_prod := v_pct;
  end if;

  for c in select * from jsonb_array_elements(v_comps) loop
    if c ->> 'value' is not null then
      v_sum := v_sum + (c ->> 'value')::numeric * (c ->> 'weight')::numeric;
      v_weight := v_weight + (c ->> 'weight')::numeric;
    end if;
  end loop;
  if v_weight < (private.rank_methodology() -> 'thresholds' ->> 'minWeightPresent')::numeric then
    v_reasons := v_reasons || to_jsonb('Too few of the measures have data yet.'::text);
  end if;
  if jsonb_array_length(v_reasons) = 0 then
    v_status := 'RANKED';
    v_score := round(v_sum / v_weight, 2);
  else
    v_status := 'INSUFFICIENT_DATA';
  end if;
  return jsonb_build_object('roleKind', v_kind, 'status', v_status, 'score', v_score, 'components', v_comps, 'reasons', v_reasons,
    'metrics', jsonb_build_object(
      'tasks', jsonb_build_object('assigned', (own ->> 'assigned')::int, 'completed', (own ->> 'completed')::int, 'judged', (own ->> 'judged')::int,
         'judgedDone', (own ->> 'judgedDone')::int, 'weightedDone', (own ->> 'weightedDone')::numeric, 'onTime', (own ->> 'onTime')::int, 'late', (own ->> 'late')::int,
         'completionPct', case when (own ->> 'judged')::int > 0 then round(100.0 * (own ->> 'judgedDone')::int / (own ->> 'judged')::int, 1) end,
         'excluded', own -> 'excluded'),
      'reports', jsonb_build_object('approved', (rep ->> 'approved')::int, 'pending', (rep ->> 'pending')::int, 'rejected', (rep ->> 'rejected')::int,
         'revision', (rep ->> 'revision')::int, 'coveragePct', v_cov, 'quality', (rep ->> 'quality')::numeric,
         'workingDays', (rep ->> 'workingDays')::int, 'coveredDays', (rep ->> 'coveredDays')::int),
      'team', case when team is null then null else jsonb_build_object('members', v_n, 'assigned', (team ->> 'assigned')::int, 'judged', (team ->> 'judged')::int,
         'judgedDone', (team ->> 'judgedDone')::int, 'weightedDone', (team ->> 'weightedDone')::numeric, 'completionPct', case when (team ->> 'judged')::int > 0 then round(100.0 * (team ->> 'judgedDone')::int / (team ->> 'judged')::int, 1) end,
         'reviewsTimely', (rev ->> 'timely')::int, 'reviewsLate', (rev ->> 'late')::int) end,
      'weightedCompletionPct', case when v_pct is null then null else round(v_pct, 1) end,
      'productivityPct', case when v_prod is null then null else round(v_prod, 1) end,
      'weightPresent', v_weight));
end $$;
revoke all on function private.rank_person(uuid, date, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Who may look, and recalculating a department
-- ---------------------------------------------------------------------------
-- The (base) departments the caller ranks: a Department Head their own, an Operations Head the ones they manage, the Super Admin all.
create or replace function private.rank_scope_departments()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select private.base_department(p.department_id) from public.profiles p
   where p.id = auth.uid() and p.status = 'ACTIVE' and p.department_id is not null and private.report_level() = 'DEPARTMENT_HEAD'
  union
  select x from private.report_scope_departments() x
$$;
revoke all on function private.rank_scope_departments() from public, anon, authenticated;

create or replace function private.rank_month(p_month date)
returns date language plpgsql stable set search_path = '' as $$
declare
  v_today date := private.hr_today();
begin
  if p_month is null then p_month := date_trunc('month', v_today::timestamp)::date; end if;
  if p_month <> date_trunc('month', p_month::timestamp)::date then
    raise exception 'VALIDATION_ERROR: Choose a month.' using errcode = 'P0001';
  end if;
  if p_month > v_today or p_month < (date_trunc('month', v_today::timestamp) - interval '24 months')::date then
    raise exception 'VALIDATION_ERROR: Choose a month from the last 24 months, up to this month.' using errcode = 'P0001';
  end if;
  return p_month;
end $$;
revoke all on function private.rank_month(date) from public, anon, authenticated;

-- The recommendations of a department for a month. Rows already decided are never touched; open ones follow the latest scores.
create or replace function private.rank_recommend(p_department uuid, p_month date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_end date := (p_month + interval '1 month - 1 day')::date;
  v_min integer := (private.rank_methodology() -> 'thresholds' ->> 'minRankedForAwards')::int;
  v_trend numeric := (private.rank_methodology() -> 'thresholds' ->> 'trendPoints')::numeric;
  v_members integer;
  v_leads integer;
  v_had boolean;
  v_new integer := 0;
  v_slots jsonb;
  sl record;
  ex public.performer_recognitions;
  v_id uuid;
  h uuid;
begin
  select count(*) filter (where role_kind = 'MEMBER'), count(*) filter (where role_kind = 'TEAM_LEAD') into v_members, v_leads
    from public.performer_scores where department_id = p_department and period_start = p_month and active and status = 'RANKED';
  select exists (select 1 from public.performer_recognitions where department_id = p_department and period_start = p_month) into v_had;

  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_slots from (
    select 'EMPLOYEE_OF_MONTH' as award, 1 as place, s.profile_id as profile, s.score, s.score as value,
           format('Highest overall score (%s) of %s ranked employees.', s.score, v_members) as reason
      from public.performer_scores s
     where v_members >= v_min and s.department_id = p_department and s.period_start = p_month and s.active and s.status = 'RANKED' and s.role_kind = 'MEMBER' and s.rank = 1
    union all
    select 'TOP_EMPLOYEE', s.rank, s.profile_id, s.score, s.score,
           format('Ranked number %s of %s employees with an overall score of %s.', s.rank, v_members, s.score)
      from public.performer_scores s
     where v_members >= v_min and s.department_id = p_department and s.period_start = p_month and s.active and s.status = 'RANKED' and s.role_kind = 'MEMBER' and s.rank <= 3
    union all
    select 'MOST_IMPROVED', 1, x.profile_id, x.score, round(x.score - x.previous_score, 2),
           format('Score up %s points on last month (%s to %s).', round(x.score - x.previous_score, 1), x.previous_score, x.score)
      from (select * from public.performer_scores s
             where v_members >= v_min and s.department_id = p_department and s.period_start = p_month and s.active and s.status = 'RANKED'
               and s.role_kind = 'MEMBER' and s.previous_score is not null and s.score - s.previous_score >= v_trend
             order by s.score - s.previous_score desc, s.score desc, s.id limit 1) x
    union all
    select 'HIGHEST_COMPLETION', 1, x.profile_id, x.score, (x.metrics ->> 'weightedCompletionPct')::numeric,
           format('Completed %s%% of the priority-weighted work judged this month.', x.metrics ->> 'weightedCompletionPct')
      from (select * from public.performer_scores s
             where v_members >= v_min and s.department_id = p_department and s.period_start = p_month and s.active and s.status = 'RANKED'
               and s.role_kind = 'MEMBER' and (s.metrics ->> 'weightedCompletionPct')::numeric > 0
             order by (s.metrics ->> 'weightedCompletionPct')::numeric desc, s.score desc, s.id limit 1) x
    union all
    select 'BEST_REPORT_CONSISTENCY', 1, x.profile_id, x.score, (x.metrics -> 'reports' ->> 'coveragePct')::numeric,
           format('Approved reports covered %s%% of the working days.', x.metrics -> 'reports' ->> 'coveragePct')
      from (select * from public.performer_scores s
             where v_members >= v_min and s.department_id = p_department and s.period_start = p_month and s.active and s.status = 'RANKED'
               and s.role_kind = 'MEMBER' and (s.metrics -> 'reports' ->> 'coveragePct')::numeric > 0
             order by (s.metrics -> 'reports' ->> 'coveragePct')::numeric desc, (s.metrics -> 'reports' ->> 'quality')::numeric desc nulls last, s.score desc, s.id limit 1) x
    union all
    select 'BEST_TEAM_LEAD', 1, s.profile_id, s.score, s.score,
           format('Highest overall score (%s) of %s ranked Team Leads.', s.score, v_leads)
      from public.performer_scores s
     where v_leads >= v_min and s.department_id = p_department and s.period_start = p_month and s.active and s.status = 'RANKED' and s.role_kind = 'TEAM_LEAD' and s.rank = 1
  ) x;

  for sl in select * from jsonb_to_recordset(v_slots) as t(award text, place smallint, profile uuid, score numeric, value numeric, reason text) loop
    select * into ex from public.performer_recognitions where department_id = p_department and period_start = p_month and award_type = sl.award and place = sl.place;
    if ex.id is null then
      insert into public.performer_recognitions (department_id, period_start, award_type, place, profile_id, score, value, reason)
      values (p_department, p_month, sl.award, sl.place, sl.profile, sl.score, sl.value, sl.reason) returning id into v_id;
      insert into public.performer_recognition_events (recognition_id, action, profile_id, score, note) values (v_id, 'RECOMMENDED', sl.profile, sl.score, sl.reason);
      v_new := v_new + 1;
    elsif ex.status = 'RECOMMENDED' and (ex.profile_id <> sl.profile or ex.value is distinct from sl.value or ex.score is distinct from sl.score) then
      update public.performer_recognitions set profile_id = sl.profile, score = sl.score, value = sl.value, reason = sl.reason, updated_at = now() where id = ex.id;
      if ex.profile_id <> sl.profile then
        insert into public.performer_recognition_events (recognition_id, action, profile_id, score, note) values (ex.id, 'CHANGED', sl.profile, sl.score, sl.reason);
      end if;
    end if;
  end loop;
  -- an open recommendation nobody qualifies for any more is withdrawn (a decided one is never touched)
  delete from public.performer_recognitions r
   where r.department_id = p_department and r.period_start = p_month and r.status = 'RECOMMENDED'
     and not exists (select 1 from jsonb_to_recordset(v_slots) as t(award text, place smallint, profile uuid, score numeric, value numeric, reason text) where t.award = r.award_type and t.place = r.place);

  -- once the month is over, the Department Head is told that the recommendations are ready (once per department and month)
  if v_new > 0 and not v_had and v_end < private.hr_today() then
    for h in select p.id from public.profiles p where p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and not p.is_operations_head and private.base_department(p.department_id) = p_department loop
      perform private.notify(h, 'TOP_PERFORMERS_READY', 'Monthly recognition is ready for your review',
        format('The recommended top performers for %s are ready. Approve or reject them under Top Performers & Rankings.', to_char(p_month, 'FMMonth YYYY')),
        'department', p_department, jsonb_build_object('month', p_month));
    end loop;
  end if;
end $$;
revoke all on function private.rank_recommend(uuid, date) from public, anon, authenticated;

-- Recalculate every person of a department for a month from the live records, keep a version when the figures changed, rank, recommend.
create or replace function private.rank_refresh(p_department uuid, p_month date, p_with_previous boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_end date := (p_month + interval '1 month - 1 day')::date;
  v_today date := private.hr_today();
  v_prev date := (p_month - interval '1 month')::date;
  r record;
  j jsonb;
  ex public.performer_scores;
  v_fp text;
  v_id uuid;
  v_ver integer;
begin
  perform pg_advisory_xact_lock(hashtext('rank:' || p_department::text || ':' || p_month::text));
  -- last month is calculated once (it is closed) so the trend has something to compare with
  if p_with_previous and not exists (select 1 from public.performer_scores where department_id = p_department and period_start = v_prev) then
    perform private.rank_refresh(p_department, v_prev, false);
  end if;
  for r in select p.id, p.team_id, p.role from public.profiles p
            where p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and p.department_id is not null and private.base_department(p.department_id) = p_department loop
    j := private.rank_person(r.id, p_month, v_end, v_today);
    v_fp := md5(concat_ws('|', j ->> 'status', j ->> 'score', (j -> 'components')::text, (j -> 'metrics')::text, (j -> 'reasons')::text));
    select * into ex from public.performer_scores where profile_id = r.id and period_start = p_month;
    if ex.id is null then
      insert into public.performer_scores (profile_id, department_id, team_id, role_kind, period_start, period_end, status, score, components, metrics, reasons, fingerprint)
      values (r.id, p_department, r.team_id, j ->> 'roleKind', p_month, v_end, j ->> 'status', (j ->> 'score')::numeric, j -> 'components', j -> 'metrics', j -> 'reasons', v_fp)
      returning id, version into v_id, v_ver;
      insert into public.performer_score_history (score_id, version, status, score, fingerprint, components, metrics)
      values (v_id, v_ver, j ->> 'status', (j ->> 'score')::numeric, v_fp, j -> 'components', j -> 'metrics');
    elsif ex.fingerprint <> v_fp then
      update public.performer_scores set status = j ->> 'status', score = (j ->> 'score')::numeric, components = j -> 'components', metrics = j -> 'metrics', reasons = j -> 'reasons',
             fingerprint = v_fp, version = ex.version + 1, team_id = r.team_id, role_kind = j ->> 'roleKind', department_id = p_department, active = true,
             rank = case when j ->> 'status' = 'RANKED' then rank end, computed_at = now(), updated_at = now() where id = ex.id;
      insert into public.performer_score_history (score_id, version, status, score, fingerprint, components, metrics)
      values (ex.id, ex.version + 1, j ->> 'status', (j ->> 'score')::numeric, v_fp, j -> 'components', j -> 'metrics');
    else
      update public.performer_scores set computed_at = now(), active = true, team_id = r.team_id where id = ex.id;
    end if;
  end loop;
  -- people who left the department (or were deactivated) stay in the history but leave the current ranking
  update public.performer_scores s set active = false
   where s.department_id = p_department and s.period_start = p_month and s.active
     and not exists (select 1 from public.profiles p where p.id = s.profile_id and p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'TEAM_MEMBER')
                        and private.base_department(p.department_id) = p_department);
  update public.performer_scores s set rank = null where s.department_id = p_department and s.period_start = p_month and (not s.active or s.status <> 'RANKED');
  update public.performer_scores s set rank = x.rk
    from (select s2.id, row_number() over (partition by s2.role_kind order by s2.score desc, (s2.metrics ->> 'weightedCompletionPct')::numeric desc nulls last, p.full_name, s2.id) as rk
            from public.performer_scores s2 join public.profiles p on p.id = s2.profile_id
           where s2.department_id = p_department and s2.period_start = p_month and s2.active and s2.status = 'RANKED') x
   where s.id = x.id and s.rank is distinct from x.rk;
  update public.performer_scores s set previous_score = (select q.score from public.performer_scores q where q.profile_id = s.profile_id and q.period_start = v_prev and q.status = 'RANKED')
   where s.department_id = p_department and s.period_start = p_month and s.previous_score is distinct from
     (select q.score from public.performer_scores q where q.profile_id = s.profile_id and q.period_start = v_prev and q.status = 'RANKED');
  perform private.rank_recommend(p_department, p_month);
end $$;
revoke all on function private.rank_refresh(uuid, date, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. What the screens read
-- ---------------------------------------------------------------------------
create or replace function private.rank_person_json(p_score uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'scoreId', s.id, 'profileId', p.id, 'name', p.full_name,
    'designation', coalesce(nullif(btrim(p.position), ''), case s.role_kind when 'TEAM_LEAD' then 'Team Lead' else 'Team Member' end),
    'roleKind', s.role_kind, 'avatarUrl', p.avatar_url, 'teamId', s.team_id, 'teamName', t.name,
    'status', s.status, 'score', s.score, 'rank', s.rank, 'previousScore', s.previous_score,
    'change', case when s.score is not null and s.previous_score is not null then round(s.score - s.previous_score, 1) end,
    'trend', case when s.score is null or s.previous_score is null then null
                  when s.score - s.previous_score >= (private.rank_methodology() -> 'thresholds' ->> 'trendPoints')::numeric then 'IMPROVING'
                  when s.previous_score - s.score >= (private.rank_methodology() -> 'thresholds' ->> 'trendPoints')::numeric then 'DECLINING'
                  else 'STEADY' end,
    'metrics', s.metrics, 'components', s.components, 'insufficientReasons', s.reasons,
    'evaluation', case when e.id is null then null else jsonb_build_object(
        'summary', e.narrative ->> 'summary', 'strengths', coalesce(e.narrative -> 'strengths', '[]'::jsonb),
        'improvementAreas', coalesce(e.narrative -> 'improvementAreas', '[]'::jsonb), 'whyRanked', e.narrative ->> 'whyRanked',
        'source', e.source, 'status', e.ai_status, 'current', e.fingerprint = s.fingerprint) end)
    from public.performer_scores s
    join public.profiles p on p.id = s.profile_id
    left join public.teams t on t.id = s.team_id
    left join lateral (select e2.* from public.performer_evaluations e2 where e2.score_id = s.id and e2.narrative is not null
                        order by (e2.fingerprint = s.fingerprint) desc, e2.created_at desc limit 1) e on true
   where s.id = p_score
$$;
revoke all on function private.rank_person_json(uuid) from public, anon, authenticated;

create or replace function private.rank_recognition_json(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'departmentId', r.department_id, 'month', r.period_start, 'awardType', r.award_type, 'place', r.place,
    'profileId', r.profile_id, 'name', p.full_name, 'avatarUrl', p.avatar_url, 'designation', coalesce(nullif(btrim(p.position), ''), case p.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end),
    'score', r.score, 'value', r.value, 'reason', r.reason, 'status', r.status,
    'decidedBy', r.decided_by_name, 'decidedAt', r.decided_at, 'decisionNote', r.decision_note,
    'summary', (select e.narrative ->> 'summary' from public.performer_scores s join public.performer_evaluations e on e.score_id = s.id and e.fingerprint = s.fingerprint
                  where s.profile_id = r.profile_id and s.period_start = r.period_start and e.narrative is not null limit 1))
    from public.performer_recognitions r join public.profiles p on p.id = r.profile_id where r.id = p_id
$$;
revoke all on function private.rank_recognition_json(uuid) from public, anon, authenticated;

-- A department's rankings for a month (Department Head: their own; Operations Head / Super Admin: one they may see, read only).
create or replace function public.performers_department(p_month date default null, p_department uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_level text := private.report_level();
  v_month date := private.rank_month(p_month);
  v_end date := (v_month + interval '1 month - 1 day')::date;
  v_today date := private.hr_today();
  v_dept uuid;
  v_name text;
  v_prev date := (v_month - interval '1 month')::date;
  v_summary jsonb;
begin
  if v_level is null or v_level not in ('DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Top performers are for Department Heads, Operations Heads and the Super Admin.' using errcode = '42501';
  end if;
  if v_level = 'DEPARTMENT_HEAD' then
    select x into v_dept from private.rank_scope_departments() x limit 1;
    if p_department is not null and p_department is distinct from private.base_department(p_department) then p_department := private.base_department(p_department); end if;
    if p_department is not null and p_department is distinct from v_dept then
      raise exception 'FORBIDDEN: You can only see the rankings of your own department.' using errcode = '42501';
    end if;
  else
    if p_department is null then raise exception 'VALIDATION_ERROR: Choose a department.' using errcode = 'P0001'; end if;
    v_dept := private.base_department(p_department);
    if not exists (select 1 from private.rank_scope_departments() x where x = v_dept) then
      raise exception 'FORBIDDEN: That department is not one of yours.' using errcode = '42501';
    end if;
  end if;
  if v_dept is null then raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0002'; end if;
  select name into v_name from public.departments where id = v_dept;

  perform private.rank_refresh(v_dept, v_month, true);

  select jsonb_build_object(
    'people', count(*), 'ranked', count(*) filter (where status = 'RANKED'), 'insufficient', count(*) filter (where status = 'INSUFFICIENT_DATA'),
    'avgScore', round(avg(score), 1),
    'taskCompletionPct', round(avg((metrics ->> 'weightedCompletionPct')::numeric) filter (where role_kind = 'MEMBER'), 1),
    'reportCoveragePct', round(avg((metrics -> 'reports' ->> 'coveragePct')::numeric), 1),
    'previousAvgScore', (select round(avg(q.score), 1) from public.performer_scores q where q.department_id = v_dept and q.period_start = v_prev and q.status = 'RANKED'))
    into v_summary
    from public.performer_scores where department_id = v_dept and period_start = v_month and active;

  return jsonb_build_object(
    'department', jsonb_build_object('id', v_dept, 'name', v_name),
    'month', v_month, 'monthEnd', v_end, 'today', v_today, 'monthClosed', v_end < v_today,
    'canDecide', v_level = 'DEPARTMENT_HEAD', 'level', v_level,
    'summary', v_summary,
    'evaluationsPending', (select count(*) from public.performer_scores s where s.department_id = v_dept and s.period_start = v_month and s.active and s.status = 'RANKED'
                              and not exists (select 1 from public.performer_evaluations e where e.score_id = s.id and e.fingerprint = s.fingerprint and e.narrative is not null)),
    'employees', (select coalesce(jsonb_agg(private.rank_person_json(s.id) order by (s.status = 'RANKED') desc, s.rank, s.profile_id), '[]'::jsonb)
                    from public.performer_scores s where s.department_id = v_dept and s.period_start = v_month and s.active and s.role_kind = 'MEMBER'),
    'teamLeads', (select coalesce(jsonb_agg(private.rank_person_json(s.id) order by (s.status = 'RANKED') desc, s.rank, s.profile_id), '[]'::jsonb)
                    from public.performer_scores s where s.department_id = v_dept and s.period_start = v_month and s.active and s.role_kind = 'TEAM_LEAD'),
    'recognitions', (select coalesce(jsonb_agg(private.rank_recognition_json(r.id) order by r.award_type, r.place), '[]'::jsonb)
                       from public.performer_recognitions r where r.department_id = v_dept and r.period_start = v_month),
    'approvedHistory', (select coalesce(jsonb_agg(private.rank_recognition_json(r.id) order by r.period_start desc, r.award_type, r.place), '[]'::jsonb)
                          from (select * from public.performer_recognitions where department_id = v_dept and status = 'APPROVED' and period_start <> v_month
                                 order by period_start desc, award_type, place limit 60) r),
    'monthly', (select coalesce(jsonb_agg(m order by m ->> 'month'), '[]'::jsonb) from (
                  select jsonb_build_object('month', q.period_start, 'avgScore', round(avg(q.score), 1), 'ranked', count(*),
                           'taskCompletionPct', round(avg((q.metrics ->> 'weightedCompletionPct')::numeric), 1)) as m
                    from public.performer_scores q where q.department_id = v_dept and q.status = 'RANKED' and q.period_start <= v_month
                     and q.period_start > (v_month - interval '6 months')::date group by q.period_start) z),
    'quarterly', (select coalesce(jsonb_agg(m order by m ->> 'quarterStart'), '[]'::jsonb) from (
                  select jsonb_build_object('quarterStart', date_trunc('quarter', q.period_start::timestamp)::date, 'avgScore', round(avg(q.score), 1), 'ranked', count(*)) as m
                    from public.performer_scores q where q.department_id = v_dept and q.status = 'RANKED' and q.period_start <= v_month
                     and q.period_start >= (date_trunc('quarter', v_month::timestamp) - interval '9 months')::date group by date_trunc('quarter', q.period_start::timestamp)) z),
    'methodology', private.rank_methodology());
end $$;

-- Company view for an Operations Head (their departments) and the Super Admin (all). Read only.
create or replace function public.performers_company(p_month date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_level text := private.report_level();
  v_month date := private.rank_month(p_month);
  v_end date := (v_month + interval '1 month - 1 day')::date;
  d uuid;
begin
  if v_level is null or v_level not in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: The company rankings are for Operations Heads and the Super Admin.' using errcode = '42501';
  end if;
  -- recalculate what is missing or older than five minutes (the department page always recalculates)
  for d in select x from private.rank_scope_departments() x loop
    if not exists (select 1 from public.performer_scores where department_id = d and period_start = v_month and computed_at > now() - interval '5 minutes')
       and exists (select 1 from public.profiles p where p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and private.base_department(p.department_id) = d) then
      perform private.rank_refresh(d, v_month, true);
    end if;
  end loop;
  return jsonb_build_object(
    'month', v_month, 'monthEnd', v_end, 'monthClosed', v_end < private.hr_today(), 'level', v_level,
    'departments', (select coalesce(jsonb_agg(rw order by (rw ->> 'avgScore')::numeric desc nulls last, rw ->> 'name'), '[]'::jsonb) from (
        select jsonb_build_object('id', dep.id, 'name', dep.name,
          'people', (select count(*) from public.performer_scores s where s.department_id = dep.id and s.period_start = v_month and s.active),
          'ranked', (select count(*) from public.performer_scores s where s.department_id = dep.id and s.period_start = v_month and s.active and s.status = 'RANKED'),
          'insufficient', (select count(*) from public.performer_scores s where s.department_id = dep.id and s.period_start = v_month and s.active and s.status = 'INSUFFICIENT_DATA'),
          'avgScore', (select round(avg(s.score), 1) from public.performer_scores s where s.department_id = dep.id and s.period_start = v_month and s.active and s.status = 'RANKED'),
          'previousAvgScore', (select round(avg(s.score), 1) from public.performer_scores s where s.department_id = dep.id and s.period_start = (v_month - interval '1 month')::date and s.status = 'RANKED'),
          'taskCompletionPct', (select round(avg((s.metrics ->> 'weightedCompletionPct')::numeric), 1) from public.performer_scores s where s.department_id = dep.id and s.period_start = v_month and s.active and s.role_kind = 'MEMBER'),
          'reportCoveragePct', (select round(avg((s.metrics -> 'reports' ->> 'coveragePct')::numeric), 1) from public.performer_scores s where s.department_id = dep.id and s.period_start = v_month and s.active),
          'topEmployee', (select jsonb_build_object('name', p.full_name, 'score', s.score) from public.performer_scores s join public.profiles p on p.id = s.profile_id
                            where s.department_id = dep.id and s.period_start = v_month and s.active and s.role_kind = 'MEMBER' and s.rank = 1),
          'topTeamLead', (select jsonb_build_object('name', p.full_name, 'score', s.score) from public.performer_scores s join public.profiles p on p.id = s.profile_id
                            where s.department_id = dep.id and s.period_start = v_month and s.active and s.role_kind = 'TEAM_LEAD' and s.rank = 1),
          'pendingRecommendations', (select count(*) from public.performer_recognitions r where r.department_id = dep.id and r.period_start = v_month and r.status = 'RECOMMENDED'),
          'approvedRecognitions', (select count(*) from public.performer_recognitions r where r.department_id = dep.id and r.period_start = v_month and r.status = 'APPROVED')) as rw
          from public.departments dep where dep.id in (select x from private.rank_scope_departments() x)) q),
    'topEmployees', (select coalesce(jsonb_agg(private.rank_person_json(s.id) || jsonb_build_object('departmentName', dep.name, 'departmentId', dep.id) order by s.score desc, s.id), '[]'::jsonb)
                       from (select * from public.performer_scores where period_start = v_month and active and status = 'RANKED' and role_kind = 'MEMBER'
                                and department_id in (select x from private.rank_scope_departments() x) order by score desc, id limit 10) s
                       join public.departments dep on dep.id = s.department_id),
    'topTeamLeads', (select coalesce(jsonb_agg(private.rank_person_json(s.id) || jsonb_build_object('departmentName', dep.name, 'departmentId', dep.id) order by s.score desc, s.id), '[]'::jsonb)
                       from (select * from public.performer_scores where period_start = v_month and active and status = 'RANKED' and role_kind = 'TEAM_LEAD'
                                and department_id in (select x from private.rank_scope_departments() x) order by score desc, id limit 5) s
                       join public.departments dep on dep.id = s.department_id),
    'trends', (select coalesce(jsonb_agg(jsonb_build_object('departmentId', t.department_id, 'name', t.name, 'points', t.points) order by t.name), '[]'::jsonb) from (
                 select q.department_id, dep.name, jsonb_agg(jsonb_build_object('month', q.period_start, 'avgScore', q.avg) order by q.period_start) as points
                   from (select department_id, period_start, round(avg(score), 1) as avg from public.performer_scores
                          where status = 'RANKED' and period_start <= v_month and period_start > (v_month - interval '6 months')::date
                            and department_id in (select x from private.rank_scope_departments() x) group by department_id, period_start) q
                   join public.departments dep on dep.id = q.department_id group by q.department_id, dep.name) t),
    'recognitions', (select coalesce(jsonb_agg(private.rank_recognition_json(r.id) || jsonb_build_object('departmentName', dep.name) order by r.status, dep.name, r.award_type, r.place), '[]'::jsonb)
                       from public.performer_recognitions r join public.departments dep on dep.id = r.department_id
                      where r.period_start = v_month and r.department_id in (select x from private.rank_scope_departments() x)),
    'methodology', private.rank_methodology());
end $$;

-- ---------------------------------------------------------------------------
-- 7. The Department Head's decision
-- ---------------------------------------------------------------------------
create or replace function public.performer_recognition_decide(p_id uuid, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.performer_recognitions;
  r2 public.performer_recognitions;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_status text;
  v_label text;
begin
  if private.report_level() is distinct from 'DEPARTMENT_HEAD' then
    raise exception 'FORBIDDEN: Only the Department Head of the department approves recognition.' using errcode = '42501';
  end if;
  select * into me from public.profiles where id = auth.uid();
  select * into r from public.performer_recognitions where id = p_id;
  if r.id is null or r.department_id not in (select x from private.rank_scope_departments() x) then
    raise exception 'NOT_FOUND: Recommendation not found.' using errcode = 'P0002';
  end if;
  if upper(coalesce(p_decision, '')) not in ('APPROVE', 'REJECT') then
    raise exception 'VALIDATION_ERROR: Choose approve or reject.' using errcode = 'P0001';
  end if;
  if upper(p_decision) = 'REJECT' and (v_note is null or length(v_note) < 3) then
    raise exception 'VALIDATION_ERROR: Give the reason for rejecting.' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'VALIDATION_ERROR: Keep the note under 500 characters.' using errcode = 'P0001';
  end if;
  if (r.period_start + interval '1 month - 1 day')::date >= private.hr_today() then
    raise exception 'CONFLICT: The month is not over yet. Recognition can be decided after it ends.' using errcode = 'P0001';
  end if;
  -- the scores are recalculated first: the Department Head decides on today's figures, and a recommendation that changed is not approved blindly
  perform private.rank_refresh(r.department_id, r.period_start, true);
  select * into r2 from public.performer_recognitions where id = p_id for update;
  if r2.id is null then
    raise exception 'CONFLICT: This recommendation no longer applies. Review the list again.' using errcode = 'P0001';
  end if;
  if r2.status <> 'RECOMMENDED' then
    raise exception 'CONFLICT: This recommendation was already decided.' using errcode = 'P0001';
  end if;
  if r2.profile_id <> r.profile_id then
    raise exception 'CONFLICT: The recommendation changed after the latest figures. Review it again.' using errcode = 'P0001';
  end if;
  v_status := case upper(p_decision) when 'APPROVE' then 'APPROVED' else 'REJECTED' end;
  update public.performer_recognitions set status = v_status, decided_by = me.id, decided_by_name = me.full_name, decided_at = now(), decision_note = v_note, updated_at = now()
   where id = r2.id returning * into r2;
  insert into public.performer_recognition_events (recognition_id, action, actor_id, actor_name, profile_id, score, note)
  values (r2.id, v_status, me.id, me.full_name, r2.profile_id, r2.score, v_note);
  perform private.write_audit('PERFORMER_RECOGNITION_' || v_status, 'performer_recognition', r2.id, r2.department_id, null,
    jsonb_build_object('award', r2.award_type, 'place', r2.place, 'month', r2.period_start, 'profile', r2.profile_id, 'score', r2.score));
  if v_status = 'APPROVED' then
    v_label := case r2.award_type when 'EMPLOYEE_OF_MONTH' then 'Employee of the Month' when 'TOP_EMPLOYEE' then format('Top 3 Employee of the Month (number %s)', r2.place)
                 when 'BEST_TEAM_LEAD' then 'Best Performing Team Lead' when 'MOST_IMPROVED' then 'Most Improved Employee'
                 when 'HIGHEST_COMPLETION' then 'Highest Task Completion Rate' else 'Best Report Consistency' end;
    perform private.notify(r2.profile_id, 'RECOGNITION_APPROVED', format('Congratulations: %s', v_label),
      format('You were recognised as %s for %s.', v_label, to_char(r2.period_start, 'FMMonth YYYY')), 'department', r2.department_id, jsonb_build_object('award', r2.award_type, 'month', r2.period_start));
  end if;
  return private.rank_recognition_json(r2.id);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Server side: the daily run and the written evaluations (service role only)
-- ---------------------------------------------------------------------------
-- Recalculate this month and last month for every department that has people.
create or replace function public.performer_schedule(p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := coalesce(p_today, private.hr_today());
  v_month date := date_trunc('month', v_today::timestamp)::date;
  d record;
  v_ids jsonb := '[]'::jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('performer_schedule')) then
    return jsonb_build_object('skipped', 'Another run is in progress.');
  end if;
  for d in select dep.id from public.departments dep where dep.facet_of is null
            and exists (select 1 from public.profiles p where p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and private.base_department(p.department_id) = dep.id) loop
    perform private.rank_refresh(d.id, v_month, true);
    perform private.rank_refresh(d.id, (v_month - interval '1 month')::date, false);
    v_ids := v_ids || to_jsonb(d.id);
  end loop;
  return jsonb_build_object('day', v_today, 'departments', jsonb_array_length(v_ids), 'departmentIds', v_ids,
                            'months', jsonb_build_array(v_month, (v_month - interval '1 month')::date));
end $$;

-- The ranked people of a department and month whose evaluation is missing for the current figures (or failed and is due for a retry).
create or replace function public.performer_evaluations_to_write(p_department uuid, p_month date, p_limit integer default 10, p_retry_not_configured boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'scoreId', s.id, 'fingerprint', s.fingerprint, 'roleKind', s.role_kind, 'status', s.status, 'month', s.period_start,
      'designation', coalesce(nullif(btrim(p.position), ''), case s.role_kind when 'TEAM_LEAD' then 'Team Lead' else 'Team Member' end),
      'score', s.score, 'previousScore', s.previous_score, 'components', s.components, 'metrics', s.metrics, 'reasons', s.reasons,
      'department', (select jsonb_build_object('avgScore', round(avg(q.score), 1), 'ranked', count(*)) from public.performer_scores q
                      where q.department_id = s.department_id and q.period_start = s.period_start and q.active and q.status = 'RANKED' and q.role_kind = s.role_kind),
      'feedback', (select coalesce(jsonb_agg(left(f.review_comment, 200)), '[]'::jsonb) from (
                     select r.review_comment from public.work_reports r where r.author_id = s.profile_id and r.review_comment is not null and btrim(r.review_comment) <> ''
                        and r.period_end >= s.period_start and r.period_start <= s.period_end order by r.reviewed_at desc nulls last limit 5) f)
    ) order by s.id), '[]'::jsonb)
    from (select s0.* from public.performer_scores s0
           where s0.department_id = p_department and s0.period_start = p_month and s0.active and s0.status = 'RANKED'
             and not exists (select 1 from public.performer_evaluations e where e.score_id = s0.id and e.fingerprint = s0.fingerprint
                              and (e.ai_status = 'OK'
                                   or (e.narrative is not null and e.ai_status = 'FAILED' and e.attempted_at > now() - interval '6 hours')
                                   or (e.narrative is not null and e.ai_status = 'NOT_CONFIGURED' and not p_retry_not_configured)))
           order by s0.id limit greatest(1, least(coalesce(p_limit, 10), 50))) s
    join public.profiles p on p.id = s.profile_id
$$;

create or replace function public.performer_evaluation_store(
  p_score uuid, p_fingerprint text, p_narrative jsonb, p_source text, p_status text, p_model text default null, p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  s public.performer_scores;
begin
  select * into s from public.performer_scores where id = p_score;
  if s.id is null or s.fingerprint is distinct from p_fingerprint then return false; end if;
  if p_status not in ('OK', 'FAILED', 'NOT_CONFIGURED') or (p_narrative is not null and p_source not in ('AI', 'RULES')) then
    raise exception 'VALIDATION_ERROR: Unknown evaluation state.' using errcode = 'P0001';
  end if;
  insert into public.performer_evaluations (score_id, fingerprint, narrative, source, ai_status, ai_model, ai_error, attempts, attempted_at)
  values (p_score, p_fingerprint, p_narrative, case when p_narrative is null then null else p_source end, p_status, p_model, left(p_error, 300), 1, now())
  on conflict (score_id, fingerprint) do update
     set narrative = coalesce(excluded.narrative, public.performer_evaluations.narrative),
         source = case when excluded.narrative is null then public.performer_evaluations.source else excluded.source end,
         ai_status = excluded.ai_status, ai_model = excluded.ai_model, ai_error = excluded.ai_error,
         attempts = public.performer_evaluations.attempts + 1, attempted_at = now();
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.performers_department(date, uuid) from public, anon;
revoke all on function public.performers_company(date) from public, anon;
revoke all on function public.performer_recognition_decide(uuid, text, text) from public, anon;
grant execute on function public.performers_department(date, uuid) to authenticated;
grant execute on function public.performers_company(date) to authenticated;
grant execute on function public.performer_recognition_decide(uuid, text, text) to authenticated;
revoke all on function public.performer_schedule(date) from public, anon, authenticated;
revoke all on function public.performer_evaluations_to_write(uuid, date, integer, boolean) from public, anon, authenticated;
revoke all on function public.performer_evaluation_store(uuid, text, jsonb, text, text, text, text) from public, anon, authenticated;
grant execute on function public.performer_schedule(date) to service_role;
grant execute on function public.performer_evaluations_to_write(uuid, date, integer, boolean) to service_role;
grant execute on function public.performer_evaluation_store(uuid, text, jsonb, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
