-- =============================================================================
-- Superadmin: the Performance Leaderboard, department / employee performance and the facts the AI analysis is written from.
--
--  * Everything is calculated from records the CRM already keeps: work_tasks (task completion), work_reports (reporting compliance,
--    on-time submission, approval and revision patterns) and the submitted HR reviews (rating). Nothing is typed in and no ranking is stored.
--  * The score is a weighted average with the weights in report_settings.score_weights (the Super Admin changes them; the screens show the
--    weights and the breakdown of every score). A measure with no data is left out and the others are scaled up, never counted as zero.
--  * Not penalised: tasks not assigned to the person (only their own tasks count), approved full-day leave (those days are not expected
--    reports), anything outside the chosen period. A person with too little data in the period is "INSUFFICIENT_DATA": no score, no rank,
--    and never listed among the lowest performers.
--  * Trend: the score of the period against the previous period of the same length.
--  * AI analysis: report_ai_analyses keeps what the AI (or the rules) wrote, with the measurable facts it was written from and the period.
--    It is kept apart from the reports and from the HR ratings and changes neither.
--
-- Safe to run again. Run after 20261221000300_hr_performance_reviews.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------
alter table public.report_settings
  add column if not exists score_weights jsonb not null default '{"taskCompletion":35,"compliance":20,"onTime":10,"approvalQuality":10,"hrRating":25}'::jsonb,
  add column if not exists min_tasks integer not null default 3 check (min_tasks between 1 and 100),
  add column if not exists min_expected_reports integer not null default 3 check (min_expected_reports between 1 and 100),
  add column if not exists updated_by uuid references public.profiles (id) on delete set null;

create or replace function public.report_settings_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.report_level() = 'SUPER_ADMIN' or private.is_hr_reviewer()) then
    raise exception 'FORBIDDEN: The scoring settings are for HR and the Super Admin.' using errcode = '42501';
  end if;
  return (select jsonb_build_object('workingDays', s.working_days, 'weights', s.score_weights, 'minTasks', s.min_tasks,
                                    'minExpectedReports', s.min_expected_reports, 'ratingScale', s.rating_scale, 'canEdit', private.report_level() = 'SUPER_ADMIN',
                                    'updatedAt', s.updated_at) from public.report_settings s where s.id);
end $$;
revoke all on function public.report_settings_get() from public, anon;
grant execute on function public.report_settings_get() to authenticated;

create or replace function public.report_settings_update(p_weights jsonb, p_min_tasks integer, p_min_expected integer, p_working_days integer[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  k text;
  v numeric;
  v_total numeric := 0;
  v_keys text[] := array['taskCompletion', 'compliance', 'onTime', 'approvalQuality', 'hrRating'];
begin
  if private.report_level() <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin changes the scoring settings.' using errcode = '42501';
  end if;
  if p_weights is null or jsonb_typeof(p_weights) <> 'object' then
    raise exception 'VALIDATION_ERROR: Give a weight for every measure.' using errcode = 'P0001';
  end if;
  foreach k in array v_keys loop
    begin
      v := (p_weights ->> k)::numeric;
    exception when others then
      raise exception 'VALIDATION_ERROR: The weight of "%" must be a number from 0 to 100.', k using errcode = 'P0001';
    end;
    if v is null or v < 0 or v > 100 then
      raise exception 'VALIDATION_ERROR: The weight of "%" must be a number from 0 to 100.', k using errcode = 'P0001';
    end if;
    v_total := v_total + v;
  end loop;
  if v_total <= 0 then
    raise exception 'VALIDATION_ERROR: At least one measure needs a weight above 0.' using errcode = 'P0001';
  end if;
  if p_min_tasks is null or p_min_tasks < 1 or p_min_tasks > 100 or p_min_expected is null or p_min_expected < 1 or p_min_expected > 100 then
    raise exception 'VALIDATION_ERROR: The minimum data limits must be between 1 and 100.' using errcode = 'P0001';
  end if;
  if p_working_days is null or cardinality(p_working_days) = 0 or exists (select 1 from unnest(p_working_days) d where d not between 1 and 7) then
    raise exception 'VALIDATION_ERROR: Choose the working days (Monday = 1 ... Sunday = 7).' using errcode = 'P0001';
  end if;
  update public.report_settings
     set score_weights = (select jsonb_object_agg(x, (p_weights ->> x)::numeric) from unnest(v_keys) x),
         min_tasks = p_min_tasks, min_expected_reports = p_min_expected, working_days = (select array_agg(distinct d order by d) from unnest(p_working_days) d),
         updated_by = auth.uid(), updated_at = now()
   where id;
  perform private.write_audit('REPORT_SCORING_UPDATED', 'report_settings', null, null, null,
    jsonb_build_object('weights', p_weights, 'minTasks', p_min_tasks, 'minExpectedReports', p_min_expected, 'workingDays', p_working_days));
  return public.report_settings_get();
end $$;
revoke all on function public.report_settings_update(jsonb, integer, integer, integer[]) from public, anon;
grant execute on function public.report_settings_update(jsonb, integer, integer, integer[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The score of every person in a period (one row each; nothing is stored)
-- ---------------------------------------------------------------------------
create or replace function private.person_score_rows(p_from date, p_to date, p_person uuid default null)
returns table (
  id uuid, full_name text, role_kind text, designation text, department_id uuid, department text, team_id uuid, team text, lead_id uuid, lead_name text,
  expected integer, submitted integer, on_time integer, approved integer, revision_requests integer, rejected integer,
  tasks integer, tasks_done integer, hr_avg numeric, hr_n integer,
  c_task numeric, c_comp numeric, c_ontime numeric, c_appr numeric, c_hr numeric, score numeric, sufficient boolean, breakdown jsonb)
language sql stable security definer set search_path = '' as $$
  with st as (select * from public.report_settings s where s.id),
  sc as (select min((x ->> 'value')::numeric) as lo, max((x ->> 'value')::numeric) as hi from public.report_settings s cross join jsonb_array_elements(s.rating_scale) x where s.id),
  ppl as (
    select p.id, p.full_name, case p.role when 'TEAM_MEMBER' then 'TEAM_MEMBER' when 'TEAM_HEAD' then 'TEAM_LEAD' else 'DEPARTMENT_HEAD' end as role_kind,
           nullif(p."position", '') as designation, private.base_department(p.department_id) as department_id, p.team_id
      from public.profiles p
     where p.status = 'ACTIVE' and p.role in ('TEAM_MEMBER', 'TEAM_HEAD', 'DEPARTMENT_HEAD') and not p.is_operations_head and p.department_id is not null
       and (p_person is null or p.id = p_person)
  ),
  rep as (
    select r.author_id, count(*)::integer as submitted, count(*) filter (where r.status = 'APPROVED')::integer as approved,
           count(*) filter (where r.status = 'REJECTED')::integer as rejected,
           count(*) filter (where r.submitted_at is not null and (r.submitted_at at time zone 'Asia/Kolkata')::date <= r.report_date + 1)::integer as on_time
      from public.work_reports r where r.status <> 'DRAFT' and r.report_date between p_from and p_to group by r.author_id
  ),
  rv as (
    select r.author_id, count(*)::integer as n from public.work_report_events e join public.work_reports r on r.id = e.report_id
     where e.action = 'REVISION_REQUESTED' and r.report_date between p_from and p_to group by r.author_id
  ),
  tk as (
    select w.assignee_id, count(*)::integer as n, count(*) filter (where w.status = 'COMPLETED')::integer as done from public.work_tasks w
     where coalesce(w.due_date, (w.created_at at time zone 'Asia/Kolkata')::date) between p_from and p_to group by w.assignee_id
  ),
  hr as (
    select v.subject_id, avg(v.rating) as a, count(*)::integer as n from public.hr_performance_reviews v
     where v.status = 'SUBMITTED' and v.period_start <= p_to and v.period_end >= p_from group by v.subject_id
  ),
  base as (
    select ppl.*, d.name as dept_name, t.name as team_name,
           (select l.id from public.profiles l where l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and l.team_id = ppl.team_id and ppl.role_kind = 'TEAM_MEMBER' order by l.full_name limit 1) as lead_id,
           (select l.full_name from public.profiles l where l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and l.team_id = ppl.team_id and ppl.role_kind = 'TEAM_MEMBER' order by l.full_name limit 1) as lead_name,
           private.report_expected_days(ppl.id, p_from, p_to) as expected,
           coalesce(rep.submitted, 0) as submitted, coalesce(rep.on_time, 0) as on_time, coalesce(rep.approved, 0) as approved,
           coalesce(rv.n, 0) as revision_requests, coalesce(rep.rejected, 0) as rejected,
           coalesce(tk.n, 0) as tasks, coalesce(tk.done, 0) as tasks_done, hr.a as hr_avg, coalesce(hr.n, 0) as hr_n
      from ppl
      join public.departments d on d.id = ppl.department_id
      left join public.teams t on t.id = ppl.team_id
      left join rep on rep.author_id = ppl.id left join rv on rv.author_id = ppl.id
      left join tk on tk.assignee_id = ppl.id left join hr on hr.subject_id = ppl.id
  ),
  comp as (
    select b.*,
      case when b.tasks >= (select min_tasks from st) then round(100.0 * b.tasks_done / b.tasks, 1) end as c_task,
      case when b.expected >= 1 then least(100, round(100.0 * b.submitted / b.expected, 1)) end as c_comp,
      case when b.submitted >= 1 then round(100.0 * b.on_time / b.submitted, 1) end as c_ontime,
      case when b.approved + b.revision_requests + b.rejected >= 1 then round(100.0 * b.approved / (b.approved + b.revision_requests + b.rejected), 1) end as c_appr,
      case when b.hr_n >= 1 and (select hi from sc) > (select lo from sc) then round(100.0 * (b.hr_avg - (select lo from sc)) / ((select hi from sc) - (select lo from sc)), 1) end as c_hr
      from base b
  )
  select c.id, c.full_name, c.role_kind, c.designation, c.department_id, c.dept_name, c.team_id, c.team_name, c.lead_id, c.lead_name,
         c.expected, c.submitted, c.on_time, c.approved, c.revision_requests, c.rejected, c.tasks, c.tasks_done, round(c.hr_avg, 2), c.hr_n,
         c.c_task, c.c_comp, c.c_ontime, c.c_appr, c.c_hr,
         (select round(sum(m.w * m.v) / nullif(sum(m.w), 0), 1) from (values
            ((select (score_weights ->> 'taskCompletion')::numeric from st), c.c_task), ((select (score_weights ->> 'compliance')::numeric from st), c.c_comp),
            ((select (score_weights ->> 'onTime')::numeric from st), c.c_ontime), ((select (score_weights ->> 'approvalQuality')::numeric from st), c.c_appr),
            ((select (score_weights ->> 'hrRating')::numeric from st), c.c_hr)) m (w, v) where m.v is not null and m.w > 0) as score,
         c.expected >= (select min_expected_reports from st)
           and (select count(*) from (values (c.c_task), (c.c_comp), (c.c_ontime), (c.c_appr), (c.c_hr)) m (v) where m.v is not null) >= 2 as sufficient,
         jsonb_build_array(
           jsonb_build_object('key', 'taskCompletion', 'label', 'Task completion', 'value', c.c_task, 'weight', (select (score_weights ->> 'taskCompletion')::numeric from st),
                              'detail', format('%s of %s tasks completed', c.tasks_done, c.tasks)),
           jsonb_build_object('key', 'compliance', 'label', 'Daily reporting compliance', 'value', c.c_comp, 'weight', (select (score_weights ->> 'compliance')::numeric from st),
                              'detail', format('%s reports for %s expected days', c.submitted, c.expected)),
           jsonb_build_object('key', 'onTime', 'label', 'On-time submission', 'value', c.c_ontime, 'weight', (select (score_weights ->> 'onTime')::numeric from st),
                              'detail', format('%s of %s sent on the day or the next day', c.on_time, c.submitted)),
           jsonb_build_object('key', 'approvalQuality', 'label', 'Approvals without revision', 'value', c.c_appr, 'weight', (select (score_weights ->> 'approvalQuality')::numeric from st),
                              'detail', format('%s approved, %s revision requests, %s rejected', c.approved, c.revision_requests, c.rejected)),
           jsonb_build_object('key', 'hrRating', 'label', 'HR review rating', 'value', c.c_hr, 'weight', (select (score_weights ->> 'hrRating')::numeric from st),
                              'detail', case when c.hr_n > 0 then format('average %s from %s review%s', round(c.hr_avg, 2), c.hr_n, case when c.hr_n = 1 then '' else 's' end) else 'no HR review in the period' end)) as breakdown
    from comp c
$$;
revoke all on function private.person_score_rows(date, date, uuid) from public, anon, authenticated;

-- the period a request means
create or replace function private.leaderboard_period(p_type text, p_from date, p_to date)
returns table (period_type text, d_from date, d_to date) language plpgsql stable set search_path = '' as $$
declare
  v_type text := upper(coalesce(p_type, 'WEEKLY'));
  v_today date := private.office_today();
  v_a date := coalesce(p_from, v_today);
begin
  if v_type not in ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM') then
    raise exception 'VALIDATION_ERROR: Choose daily, weekly, monthly or a custom period.' using errcode = 'P0001';
  end if;
  if v_type = 'DAILY' then
    return query select v_type, v_a, v_a;
  elsif v_type = 'WEEKLY' then
    return query select v_type, date_trunc('week', v_a)::date, (date_trunc('week', v_a)::date + 6);
  elsif v_type = 'MONTHLY' then
    return query select v_type, date_trunc('month', v_a)::date, (date_trunc('month', v_a) + interval '1 month - 1 day')::date;
  else
    if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
      raise exception 'VALIDATION_ERROR: Choose a custom period of at most a year.' using errcode = 'P0001';
    end if;
    return query select v_type, p_from, p_to;
  end if;
end $$;
revoke all on function private.leaderboard_period(text, date, date) from public, anon, authenticated;

create or replace function private.perf_category(p_score numeric, p_sufficient boolean)
returns text language sql immutable set search_path = '' as $$
  select case when not p_sufficient or p_score is null then 'INSUFFICIENT_DATA' when p_score >= 75 then 'STRONG' when p_score >= 50 then 'AVERAGE' else 'NEEDS_ATTENTION' end
$$;
revoke all on function private.perf_category(numeric, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The Leaderboard
-- ---------------------------------------------------------------------------
-- p_filters (all optional, all work together): periodType, from, to, department, team, designation, role (TEAM_MEMBER / TEAM_LEAD / DEPARTMENT_HEAD),
-- person, teamLead, departmentHead, operationsHead, category (TOP10, BOTTOM10, TOP_MEMBERS, LOWEST_MEMBERS, TOP_LEADS, LOWEST_LEADS,
-- TOP_DEPARTMENTS, LOWEST_DEPARTMENTS, ALL), performance (STRONG, AVERAGE, NEEDS_ATTENTION, INSUFFICIENT_DATA), ratingMin/ratingMax,
-- complianceMin/complianceMax, completionMin/completionMax, limit, offset.
create or replace function public.report_leaderboard(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_type text; v_from date; v_to date;
  v_prev_from date; v_prev_to date;
  v_cat text := upper(coalesce(nullif(f ->> 'category', ''), 'ALL'));
  v_limit integer;
  v_offset integer := greatest(coalesce((f ->> 'offset')::int, 0), 0);
  v_role text := nullif(f ->> 'role', '');
  v_rows jsonb; v_insuf jsonb; v_depts jsonb;
  v_ranked integer; v_insuf_n integer; v_total integer;
  v_settings jsonb;
begin
  if private.report_level() <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: The performance leaderboard is for the Super Admin.' using errcode = '42501';
  end if;
  if v_cat not in ('ALL', 'TOP10', 'BOTTOM10', 'TOP_MEMBERS', 'LOWEST_MEMBERS', 'TOP_LEADS', 'LOWEST_LEADS', 'TOP_DEPARTMENTS', 'LOWEST_DEPARTMENTS') then
    raise exception 'VALIDATION_ERROR: Choose a leaderboard category.' using errcode = 'P0001';
  end if;
  if v_role is not null and v_role not in ('TEAM_MEMBER', 'TEAM_LEAD', 'DEPARTMENT_HEAD') then
    raise exception 'VALIDATION_ERROR: Choose a valid role.' using errcode = 'P0001';
  end if;
  select pp.period_type, pp.d_from, pp.d_to into v_type, v_from, v_to
    from private.leaderboard_period(f ->> 'periodType', nullif(f ->> 'from', '')::date, nullif(f ->> 'to', '')::date) pp;
  v_prev_to := v_from - 1;
  v_prev_from := v_prev_to - (v_to - v_from);
  v_limit := least(greatest(coalesce((f ->> 'limit')::int, case when v_cat = 'ALL' then 50 else 10 end), 1), 200);
  -- the role of the category narrows the people (Team Members / Team Leads), unless a role filter was chosen
  if v_cat in ('TOP_MEMBERS', 'LOWEST_MEMBERS') then v_role := 'TEAM_MEMBER'; end if;
  if v_cat in ('TOP_LEADS', 'LOWEST_LEADS') then v_role := 'TEAM_LEAD'; end if;

  with cur as (select * from private.person_score_rows(v_from, v_to)),
  prev as (select s.id, s.score, s.sufficient from private.person_score_rows(v_prev_from, v_prev_to) s),
  flt as (
    select c.*, pv.score as prev_score, pv.sufficient as prev_sufficient
      from cur c left join prev pv on pv.id = c.id
     where (nullif(f ->> 'department', '') is null or c.department_id = (f ->> 'department')::uuid)
       and (nullif(f ->> 'team', '') is null or c.team_id = (f ->> 'team')::uuid)
       and (nullif(f ->> 'designation', '') is null or c.designation ilike (f ->> 'designation'))
       and (v_role is null or c.role_kind = v_role)
       and (nullif(f ->> 'person', '') is null or c.id = (f ->> 'person')::uuid)
       and (nullif(f ->> 'teamLead', '') is null or c.lead_id = (f ->> 'teamLead')::uuid or c.id = (f ->> 'teamLead')::uuid)
       and (nullif(f ->> 'departmentHead', '') is null or private.head_covers((f ->> 'departmentHead')::uuid, c.department_id, c.team_id) or c.id = (f ->> 'departmentHead')::uuid)
       and (nullif(f ->> 'operationsHead', '') is null or private.owner_of_department(c.department_id) = (f ->> 'operationsHead')::uuid)
       and (nullif(f ->> 'performance', '') is null or private.perf_category(c.score, c.sufficient) = f ->> 'performance')
       and (nullif(f ->> 'ratingMin', '') is null or c.hr_avg >= (f ->> 'ratingMin')::numeric)
       and (nullif(f ->> 'ratingMax', '') is null or c.hr_avg <= (f ->> 'ratingMax')::numeric)
       and (nullif(f ->> 'complianceMin', '') is null or c.c_comp >= (f ->> 'complianceMin')::numeric)
       and (nullif(f ->> 'complianceMax', '') is null or c.c_comp <= (f ->> 'complianceMax')::numeric)
       and (nullif(f ->> 'completionMin', '') is null or c.c_task >= (f ->> 'completionMin')::numeric)
       and (nullif(f ->> 'completionMax', '') is null or c.c_task <= (f ->> 'completionMax')::numeric)
  ),
  ranked as (
    select fl.*, case when fl.sufficient and fl.score is not null then rank() over (order by case when fl.sufficient and fl.score is not null then fl.score end desc nulls last) end as rnk
      from flt fl
  ),
  shaped as (
    select r.*, jsonb_build_object(
        'rank', r.rnk, 'id', r.id, 'employeeId', 'EMP-' || upper(substr(r.id::text, 1, 8)), 'name', r.full_name, 'role', r.role_kind, 'designation', r.designation,
        'departmentId', r.department_id, 'department', r.department, 'teamId', r.team_id, 'team', r.team, 'teamLead', r.lead_name,
        'assignedTasks', r.tasks, 'completedTasks', r.tasks_done, 'completionRate', r.c_task,
        'reportsExpected', r.expected, 'reportsSubmitted', r.submitted, 'compliance', r.c_comp, 'onTimeRate', r.c_ontime, 'approvalRate', r.c_appr,
        'hrRating', r.hr_avg, 'hrRatingLabel', private.rating_label(round(r.hr_avg)::int), 'hrReviews', r.hr_n,
        'score', case when r.sufficient then r.score end, 'breakdown', r.breakdown,
        'status', case when r.sufficient and r.score is not null then 'RANKED' else 'INSUFFICIENT_DATA' end,
        'category', private.perf_category(r.score, r.sufficient),
        'previousScore', case when r.prev_sufficient then r.prev_score end,
        'trend', case when not r.sufficient or r.score is null or not coalesce(r.prev_sufficient, false) or r.prev_score is null then 'NO_TREND'
                      when r.score - r.prev_score >= 5 then 'IMPROVING' when r.score - r.prev_score <= -5 then 'DECLINING' else 'STABLE' end) as j
      from ranked r
  )
  select
    (select count(*) from shaped where rnk is not null), (select count(*) from shaped where rnk is null), (select count(*) from shaped),
    -- the list asked for: the best first, or the worst first (a bottom list never contains people with insufficient data)
    coalesce((select jsonb_agg(x.j order by x.o) from (
        select s.j, row_number() over (order by (s.rnk is null), case when v_cat in ('BOTTOM10', 'LOWEST_MEMBERS', 'LOWEST_LEADS') then -s.score else s.score end desc, s.full_name) as o
          from shaped s
         where case when v_cat = 'ALL' then true else s.rnk is not null end
         order by o
         limit case when v_cat in ('TOP_DEPARTMENTS', 'LOWEST_DEPARTMENTS') then 0 when v_cat = 'ALL' then v_limit else least(v_limit, 100) end
         offset case when v_cat = 'ALL' then v_offset else 0 end) x), '[]'::jsonb),
    coalesce((select jsonb_agg(s.j order by s.full_name) from (select * from shaped where rnk is null order by full_name limit 100) s), '[]'::jsonb),
    -- departments: average of the ranked people, the shares computed from the totals
    coalesce((select jsonb_agg(dd order by (dd ->> 'score')::numeric desc nulls last) from (
        select jsonb_build_object('departmentId', s.department_id, 'department', s.department,
          'score', round(avg(s.score) filter (where s.rnk is not null), 1),
          'status', case when count(*) filter (where s.rnk is not null) > 0 then 'RANKED' else 'INSUFFICIENT_DATA' end,
          'people', count(*), 'ranked', count(*) filter (where s.rnk is not null), 'insufficient', count(*) filter (where s.rnk is null),
          'assignedTasks', sum(s.tasks), 'completedTasks', sum(s.tasks_done),
          'completionRate', case when sum(s.tasks) > 0 then round(100.0 * sum(s.tasks_done) / sum(s.tasks), 1) end,
          'reportsExpected', sum(s.expected), 'reportsSubmitted', sum(s.submitted),
          'compliance', case when sum(s.expected) > 0 then least(100, round(100.0 * sum(s.submitted) / sum(s.expected), 1)) end,
          'hrRating', round(avg(s.hr_avg), 2)) as dd
          from shaped s group by s.department_id, s.department) q), '[]'::jsonb)
    into v_ranked, v_insuf_n, v_total, v_rows, v_insuf, v_depts;

  -- departments are ranked among themselves
  if v_cat in ('TOP_DEPARTMENTS', 'LOWEST_DEPARTMENTS') then
    select coalesce(jsonb_agg(d || jsonb_build_object('rank', case when d ->> 'status' = 'RANKED' then rn end) order by o), '[]'::jsonb) into v_rows from (
      select d, row_number() over (order by (d ->> 'score')::numeric desc nulls last) as rn,
             row_number() over (order by case when v_cat = 'LOWEST_DEPARTMENTS' then -(d ->> 'score')::numeric else (d ->> 'score')::numeric end desc nulls last) as o
        from jsonb_array_elements(v_depts) d where d ->> 'status' = 'RANKED' order by o limit least(v_limit, 100)) q;
  end if;
  select jsonb_build_object('weights', s.score_weights, 'minTasks', s.min_tasks, 'minExpectedReports', s.min_expected_reports, 'ratingScale', s.rating_scale)
    into v_settings from public.report_settings s where s.id;
  return jsonb_build_object(
    'category', v_cat, 'period', jsonb_build_object('type', v_type, 'from', v_from, 'to', v_to, 'previousFrom', v_prev_from, 'previousTo', v_prev_to),
    'rows', v_rows, 'insufficientData', case when v_cat = 'ALL' or v_cat in ('TOP_DEPARTMENTS', 'LOWEST_DEPARTMENTS') then '[]'::jsonb else v_insuf end,
    'departments', case when v_cat in ('TOP_DEPARTMENTS', 'LOWEST_DEPARTMENTS') then '[]'::jsonb else v_depts end,
    'counts', jsonb_build_object('people', v_total, 'ranked', v_ranked, 'insufficient', v_insuf_n),
    'methodology', v_settings);
end $$;
revoke all on function public.report_leaderboard(jsonb) from public, anon;
grant execute on function public.report_leaderboard(jsonb) to authenticated;

-- The choices for the leaderboard filters (everything from the database).
create or replace function public.report_leaderboard_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.report_level() <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: The performance leaderboard is for the Super Admin.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name) from public.departments d where d.facet_of is null), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'departmentId', t.department_id) order by t.name) from public.teams t where not t.is_pool), '[]'::jsonb),
    'designations', coalesce((select jsonb_agg(x order by x) from (select distinct nullif(p."position", '') as x from public.profiles p
                               where p.status = 'ACTIVE' and p.role in ('TEAM_MEMBER', 'TEAM_HEAD', 'DEPARTMENT_HEAD')) q where x is not null), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role, 'departmentId', private.base_department(p.department_id), 'teamId', p.team_id) order by p.full_name)
                          from public.profiles p where p.status = 'ACTIVE' and p.role in ('TEAM_MEMBER', 'TEAM_HEAD', 'DEPARTMENT_HEAD') and not p.is_operations_head), '[]'::jsonb),
    'operationsHeads', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name) from public.profiles p
                                   where p.role = 'DEPARTMENT_HEAD' and p.is_operations_head and p.status = 'ACTIVE'), '[]'::jsonb),
    'ratingScale', (select s.rating_scale from public.report_settings s where s.id));
end $$;
revoke all on function public.report_leaderboard_options() from public, anon;
grant execute on function public.report_leaderboard_options() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. One employee: the score, the weekly history, the HR reviews and the underlying reports
-- ---------------------------------------------------------------------------
create or replace function public.report_employee_profile(p_person uuid, p_period_type text default 'MONTHLY', p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_type text; v_from date; v_to date;
  me record;
  v_cur record;
  v_weeks jsonb;
begin
  if private.report_level() <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Employee performance is for the Super Admin.' using errcode = '42501';
  end if;
  select pp.period_type, pp.d_from, pp.d_to into v_type, v_from, v_to from private.leaderboard_period(p_period_type, p_from, p_to) pp;
  select * into v_cur from private.person_score_rows(v_from, v_to, p_person);
  if v_cur.id is null then
    raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('weekStart', w.d, 'weekEnd', w.d + 6, 'score', case when s.sufficient then s.score end, 'status', case when s.sufficient and s.score is not null then 'RANKED' else 'INSUFFICIENT_DATA' end,
           'completionRate', s.c_task, 'compliance', s.c_comp, 'tasks', s.tasks, 'completed', s.tasks_done, 'submitted', s.submitted, 'expected', s.expected) order by w.d), '[]'::jsonb) into v_weeks
    from (select (date_trunc('week', v_to)::date - 7 * g) as d from generate_series(0, 7) g) w
    cross join lateral (select * from private.person_score_rows(w.d, w.d + 6, p_person) limit 1) s;
  return jsonb_build_object(
    'id', v_cur.id, 'employeeId', 'EMP-' || upper(substr(v_cur.id::text, 1, 8)), 'name', v_cur.full_name, 'role', v_cur.role_kind, 'designation', v_cur.designation,
    'department', v_cur.department, 'team', v_cur.team, 'teamLead', v_cur.lead_name,
    'period', jsonb_build_object('type', v_type, 'from', v_from, 'to', v_to),
    'score', case when v_cur.sufficient then v_cur.score end, 'status', case when v_cur.sufficient and v_cur.score is not null then 'RANKED' else 'INSUFFICIENT_DATA' end,
    'category', private.perf_category(v_cur.score, v_cur.sufficient), 'breakdown', v_cur.breakdown,
    'stats', private.report_person_stats(p_person, v_from, v_to),
    'weeks', v_weeks,
    'hrReviews', coalesce((select jsonb_agg(private.hr_review_json(v) order by v.period_end desc) from public.hr_performance_reviews v where v.subject_id = p_person and v.status = 'SUBMITTED'), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(private.report_json(r, true) order by r.report_date desc) from (
        select * from public.work_reports x where x.author_id = p_person and x.status <> 'DRAFT' and x.report_date between v_from and v_to order by x.report_date desc limit 60) r), '[]'::jsonb));
end $$;
revoke all on function public.report_employee_profile(uuid, text, date, date) from public, anon;
grant execute on function public.report_employee_profile(uuid, text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Company reports for the Super Admin: the consolidated reports HR submitted
-- ---------------------------------------------------------------------------
create or replace function public.sa_consolidated_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.report_level() <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: The consolidated performance reports are for the Super Admin.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'weekStart', c.period_start, 'weekEnd', c.period_end, 'status', c.status, 'revision', c.revision,
      'note', c.note, 'submittedBy', c.submitted_by_name, 'submittedAt', c.submitted_at, 'snapshot', c.readiness,
      'departments', (select count(*) from public.hr_consolidated_packages x where x.consolidated_id = c.id),
      'analysis', (select jsonb_build_object('id', a.id, 'status', a.status, 'source', a.source, 'createdAt', a.created_at)
                     from public.report_ai_analyses a where a.period_start = c.period_start and a.period_end = c.period_end and a.status in ('OK', 'NOT_CONFIGURED')
                    order by a.created_at desc limit 1)) order by c.period_start desc)
    from (select * from public.hr_consolidated_reports x where x.status <> 'DRAFT' order by x.period_start desc limit 60) c), '[]'::jsonb);
end $$;
-- (the analysis table is created below; the function body is checked when it first runs)
revoke all on function public.sa_consolidated_list() from public, anon;
grant execute on function public.sa_consolidated_list() to authenticated;

-- One submitted consolidated report: its departments with the figures and the HR ratings (kept apart from the figures).
create or replace function public.sa_consolidated_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.hr_consolidated_reports;
begin
  if private.report_level() <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: The consolidated performance reports are for the Super Admin.' using errcode = '42501';
  end if;
  select * into c from public.hr_consolidated_reports where id = p_id and status <> 'DRAFT';
  if c.id is null then
    raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', c.id, 'weekStart', c.period_start, 'weekEnd', c.period_end, 'status', c.status, 'revision', c.revision, 'note', c.note,
    'submittedBy', c.submitted_by_name, 'submittedAt', c.submitted_at, 'snapshot', c.readiness,
    'departments', coalesce((select jsonb_agg(jsonb_build_object(
        'packageId', k.id, 'departmentId', d.id, 'department', d.name, 'package', private.package_json(k),
        'departmentHeads', (select coalesce(jsonb_agg(h.full_name order by h.full_name), '[]'::jsonb) from public.profiles h
                             where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE' and private.base_department(h.department_id) = d.id),
        'stats', private.report_scope_stats(d.id, null, k.period_start, k.period_end),
        'reviews', private.hr_review_counts(k.id),
        'avgRating', (select round(avg(v.rating), 2) from public.hr_performance_reviews v where v.package_id = k.id and v.status = 'SUBMITTED')) order by d.name)
      from public.hr_consolidated_packages cp join public.work_report_packages k on k.id = cp.package_id join public.departments d on d.id = k.department_id
     where cp.consolidated_id = c.id), '[]'::jsonb));
end $$;
revoke all on function public.sa_consolidated_get(uuid) from public, anon;
grant execute on function public.sa_consolidated_get(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. AI analysis: the measurable facts, and where the written analysis is kept
-- ---------------------------------------------------------------------------
create table if not exists public.report_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  -- the measurable facts the analysis was written from (each names its people, numbers and period)
  facts jsonb not null,
  narrative jsonb not null,
  source text not null check (source in ('AI', 'RULES')),
  status text not null check (status in ('OK', 'FAILED', 'NOT_CONFIGURED')),
  model text,
  error text check (length(error) <= 500),
  created_at timestamptz not null default now(),
  constraint report_ai_period_check check (period_end >= period_start and period_end - period_start <= 366)
);
create index if not exists report_ai_analyses_period_idx on public.report_ai_analyses (period_start, period_end, created_at desc);
alter table public.report_ai_analyses enable row level security;
revoke all on public.report_ai_analyses from public, anon, authenticated;

-- The facts. Every item names the record it comes from (a person, a team or a department and the period) so it can be checked; nothing
-- is guessed and no reason for a result is assumed. Used by the Super Admin screen and, with the service key, by the writer.
create or replace function private.report_analysis_facts(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_n int := p_to - p_from + 1;
  v_prev_to date := p_from - 1;
  v_prev_from date := p_from - (p_to - p_from + 1);
  v_weeks date[] := array(select (date_trunc('week', p_to)::date - 7 * g) from generate_series(0, 3) g);
  st record;
  v_out jsonb;
begin
  select * into st from public.report_settings where id;
  with cur as (select * from private.person_score_rows(p_from, p_to)),
  prev as (select * from private.person_score_rows(v_prev_from, v_prev_to)),
  wk as (
    select w.d as wk_start, s.id, s.tasks, s.tasks_done, s.c_task, s.revision_requests, s.expected, s.submitted
      from unnest(v_weeks) w (d) cross join lateral private.person_score_rows(w.d, w.d + 6) s
  ),
  strong as (
    select c.id, c.full_name, c.department, c.team, c.c_task, c.tasks, c.tasks_done,
           (select jsonb_agg(jsonb_build_object('weekStart', x.wk_start, 'completionRate', x.c_task, 'tasks', x.tasks) order by x.wk_start) from wk x where x.id = c.id and x.tasks > 0) as weeks
      from cur c
     where c.tasks >= st.min_tasks and c.c_task >= 85
       and (select count(*) from wk x where x.id = c.id and x.tasks > 0) >= 2
       and not exists (select 1 from wk x where x.id = c.id and x.tasks > 0 and x.c_task < 85)
  ),
  revs as (
    select c.id, c.full_name, c.department, c.team, c.revision_requests, c.submitted,
           (select count(*) from wk x where x.id = c.id and x.revision_requests > 0) as weeks_with_revision
      from cur c where c.revision_requests >= 3 or (select count(*) from wk x where x.id = c.id and x.revision_requests > 0) >= 2
  ),
  team_cur as (
    select s.team_id, s.team, s.department, count(*) filter (where s.sufficient) as ranked, avg(s.score) filter (where s.sufficient) as score,
           sum(s.tasks) as tasks, sum(s.tasks_done) as done, sum(s.expected) as expected, sum(s.submitted) as submitted
      from cur s where s.team_id is not null group by s.team_id, s.team, s.department
  ),
  team_prev as (
    select s.team_id, avg(s.score) filter (where s.sufficient) as score from prev s where s.team_id is not null group by s.team_id
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'days', v_n, 'previousFrom', v_prev_from, 'previousTo', v_prev_to),
    'thresholds', jsonb_build_object('strongCompletion', 85, 'lowCompletion', 50, 'lowCompliance', 60, 'repeatedRevisions', 3, 'wellPerformingTeamScore', 75,
                                     'performanceChange', 10, 'minTasks', st.min_tasks, 'minExpectedReports', st.min_expected_reports),
    'counts', jsonb_build_object('people', (select count(*) from cur), 'ranked', (select count(*) from cur where sufficient), 'insufficient', (select count(*) from cur where not sufficient)),
    'strongCompletion', coalesce((select jsonb_agg(jsonb_build_object('factId', 'SC-' || substr(s.id::text, 1, 8), 'subjectType', 'PERSON', 'subjectId', s.id, 'name', s.full_name,
          'department', s.department, 'team', s.team, 'completionRate', s.c_task, 'tasks', s.tasks, 'completed', s.tasks_done, 'weeks', s.weeks,
          'sources', jsonb_build_array('work_tasks')) order by s.c_task desc, s.full_name) from (select * from strong order by c_task desc limit 10) s), '[]'::jsonb),
    'lowCompletion', coalesce((select jsonb_agg(jsonb_build_object('factId', 'LC-' || substr(c.id::text, 1, 8), 'subjectType', 'PERSON', 'subjectId', c.id, 'name', c.full_name,
          'department', c.department, 'team', c.team, 'completionRate', c.c_task, 'tasks', c.tasks, 'completed', c.tasks_done, 'sources', jsonb_build_array('work_tasks')) order by c.c_task, c.full_name)
          from (select * from cur where c_task is not null and c_task < 50 order by c_task limit 10) c), '[]'::jsonb),
    'missingReports', coalesce((select jsonb_agg(jsonb_build_object('factId', 'MR-' || substr(c.id::text, 1, 8), 'subjectType', 'PERSON', 'subjectId', c.id, 'name', c.full_name,
          'department', c.department, 'team', c.team, 'compliance', c.c_comp, 'expected', c.expected, 'submitted', c.submitted, 'missing', greatest(c.expected - c.submitted, 0),
          'sources', jsonb_build_array('work_reports', 'leave_requests')) order by c.c_comp, c.full_name)
          from (select * from cur where expected >= st.min_expected_reports and c_comp < 60 order by c_comp limit 10) c), '[]'::jsonb),
    'repeatedRevisions', coalesce((select jsonb_agg(jsonb_build_object('factId', 'RR-' || substr(r.id::text, 1, 8), 'subjectType', 'PERSON', 'subjectId', r.id, 'name', r.full_name,
          'department', r.department, 'team', r.team, 'revisionRequests', r.revision_requests, 'reportsSubmitted', r.submitted, 'weeksWithRevision', r.weeks_with_revision,
          'sources', jsonb_build_array('work_report_events')) order by r.revision_requests desc, r.full_name) from (select * from revs order by revision_requests desc limit 10) r), '[]'::jsonb),
    'wellPerformingTeams', coalesce((select jsonb_agg(jsonb_build_object('factId', 'TW-' || substr(t.team_id::text, 1, 8), 'subjectType', 'TEAM', 'subjectId', t.team_id, 'name', t.team,
          'department', t.department, 'score', round(t.score, 1), 'previousScore', round(p.score, 1), 'people', t.ranked,
          'completionRate', case when t.tasks > 0 then round(100.0 * t.done / t.tasks, 1) end, 'sources', jsonb_build_array('work_tasks', 'work_reports')) order by t.score desc)
          from team_cur t join team_prev p on p.team_id = t.team_id where t.ranked >= 2 and t.score >= 75 and p.score >= 75), '[]'::jsonb),
    'taskGaps', coalesce((select jsonb_agg(jsonb_build_object('factId', 'TG-' || substr(t.team_id::text, 1, 8), 'subjectType', 'TEAM', 'subjectId', t.team_id, 'name', t.team,
          'department', t.department, 'assigned', t.tasks, 'completed', t.done, 'gap', t.tasks - t.done, 'completionRate', round(100.0 * t.done / t.tasks, 1),
          'sources', jsonb_build_array('work_tasks')) order by (t.tasks - t.done) desc)
          from (select * from team_cur where tasks >= 5 and 100.0 * done / tasks < 60 order by tasks - done desc limit 10) t), '[]'::jsonb),
    'performanceChanges', coalesce((select jsonb_agg(jsonb_build_object('factId', 'PC-' || substr(c.id::text, 1, 8), 'subjectType', 'PERSON', 'subjectId', c.id, 'name', c.full_name,
          'department', c.department, 'team', c.team, 'score', c.score, 'previousScore', p.score, 'change', round(c.score - p.score, 1),
          'direction', case when c.score > p.score then 'IMPROVING' else 'DECLINING' end, 'sources', jsonb_build_array('work_tasks', 'work_reports', 'hr_performance_reviews'))
          order by abs(c.score - p.score) desc)
          from (select cc.*, row_number() over (order by abs(cc.score - pp.score) desc) rn from cur cc join prev pp on pp.id = cc.id and pp.sufficient where cc.sufficient and abs(cc.score - pp.score) >= 10) c
          join prev p on p.id = c.id where c.rn <= 20), '[]'::jsonb),
    'departmentDelays', coalesce((select jsonb_agg(jsonb_build_object('factId', 'DD-' || substr(d.id::text, 1, 8) || '-' || to_char(w.d, 'MMDD'), 'subjectType', 'DEPARTMENT', 'subjectId', d.id, 'name', d.name,
          'weekStart', w.d, 'weekEnd', w.d + 6, 'submittedAt', k.submitted_at, 'status', coalesce(k.status, 'NOT_SUBMITTED'),
          'daysLate', case when k.submitted_at is not null then greatest(((k.submitted_at at time zone 'Asia/Kolkata')::date - (w.d + 6)), 0) end,
          'sources', jsonb_build_array('work_report_packages')) order by w.d desc, d.name)
          from public.departments d
          cross join unnest(array(select distinct (date_trunc('week', g)::date) from generate_series(p_from::timestamp, least(p_to, private.office_today())::timestamp, interval '1 day') g)) w (d)
          left join public.work_report_packages k on k.department_id = d.id and k.period_start = w.d
         where d.facet_of is null and w.d + 6 < private.office_today() and exists (select 1 from private.report_people(d.id, null))
           and (k.id is null or k.status in ('DRAFT', 'COMPILING') or (k.submitted_at at time zone 'Asia/Kolkata')::date > w.d + 9)), '[]'::jsonb),
    'hrRatings', coalesce((select jsonb_agg(jsonb_build_object('departmentId', q.id, 'department', q.name, 'average', q.avg_rating, 'reviews', q.n) order by q.name)
          from (select d.id, d.name, round(avg(v.rating), 2) as avg_rating, count(*) as n
                  from public.hr_performance_reviews v join public.departments d on d.id = v.department_id
                 where v.status = 'SUBMITTED' and v.period_start <= p_to and v.period_end >= p_from group by d.id, d.name) q), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;
revoke all on function private.report_analysis_facts(date, date) from public, anon, authenticated;

create or replace function public.report_analysis_facts(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.report_level() <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: The performance analysis is for the Super Admin.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'VALIDATION_ERROR: Choose a period of at most a year.' using errcode = 'P0001';
  end if;
  return private.report_analysis_facts(p_from, p_to);
end $$;
revoke all on function public.report_analysis_facts(date, date) from public, anon;
grant execute on function public.report_analysis_facts(date, date) to authenticated;

-- the same facts for the server's writer (service key; no login)
create or replace function public.report_analysis_facts_service(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'VALIDATION_ERROR: Choose a period of at most a year.' using errcode = 'P0001';
  end if;
  return private.report_analysis_facts(p_from, p_to);
end $$;
revoke all on function public.report_analysis_facts_service(date, date) from public, anon, authenticated;
grant execute on function public.report_analysis_facts_service(date, date) to service_role;

-- Keep what was written (the writer calls this with the service key). A consolidated report of that week is marked analysed and the
-- Super Admin is told once.
create or replace function public.report_analysis_store(
  p_from date, p_to date, p_facts jsonb, p_narrative jsonb, p_source text, p_status text, p_model text, p_error text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  c public.hr_consolidated_reports;
  v_sa uuid;
begin
  insert into public.report_ai_analyses (period_start, period_end, facts, narrative, source, status, model, error)
  values (p_from, p_to, p_facts, p_narrative, p_source, p_status, p_model, left(p_error, 500)) returning id into v_id;
  select * into c from public.hr_consolidated_reports where period_start = p_from and period_end = p_to for update;
  if c.id is not null and c.status = 'SUBMITTED_TO_SUPERADMIN' and p_status in ('OK', 'NOT_CONFIGURED') then
    update public.hr_consolidated_reports set status = 'AI_ANALYSIS_COMPLETED', updated_at = now() where id = c.id;
    for v_sa in select * from private.super_admin_ids() loop
      insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, data, priority)
      values (v_sa, 'REPORT_ANALYSIS_READY', 'Performance analysis ready',
              format('The analysis of the company report for %s to %s is ready, and the leaderboard is up to date.', to_char(p_from, 'DD Mon'), to_char(p_to, 'DD Mon YYYY')),
              'hr_consolidated_report', c.id, '{}'::jsonb, 'normal');
    end loop;
    insert into public.work_report_signals (recipient_id, report_id, event) select s, null, 'ANALYSIS' from private.super_admin_ids() s;
  end if;
  return v_id;
end $$;
revoke all on function public.report_analysis_store(date, date, jsonb, jsonb, text, text, text, text) from public, anon, authenticated;
grant execute on function public.report_analysis_store(date, date, jsonb, jsonb, text, text, text, text) to service_role;

-- Consolidated weeks that still wait for their analysis (the daily run writes them).
create or replace function public.report_analysis_pending()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('from', c.period_start, 'to', c.period_end) order by c.period_start desc), '[]'::jsonb)
    from public.hr_consolidated_reports c
   where c.status = 'SUBMITTED_TO_SUPERADMIN'
     and not exists (select 1 from public.report_ai_analyses a where a.period_start = c.period_start and a.period_end = c.period_end and a.status in ('OK', 'NOT_CONFIGURED') and a.created_at >= c.submitted_at)
$$;
revoke all on function public.report_analysis_pending() from public, anon, authenticated;
grant execute on function public.report_analysis_pending() to service_role;

-- The latest written analysis of a period (Super Admin).
create or replace function public.report_analysis_latest(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  a public.report_ai_analyses;
begin
  if private.report_level() <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: The performance analysis is for the Super Admin.' using errcode = '42501';
  end if;
  select * into a from public.report_ai_analyses x where x.period_start = p_from and x.period_end = p_to order by x.created_at desc limit 1;
  if a.id is null then
    return null;
  end if;
  return jsonb_build_object('id', a.id, 'periodStart', a.period_start, 'periodEnd', a.period_end, 'facts', a.facts, 'narrative', a.narrative, 'source', a.source,
                            'status', a.status, 'model', a.model, 'error', a.error, 'createdAt', a.created_at);
end $$;
revoke all on function public.report_analysis_latest(date, date) from public, anon;
grant execute on function public.report_analysis_latest(date, date) to authenticated;

notify pgrst, 'reload schema';
