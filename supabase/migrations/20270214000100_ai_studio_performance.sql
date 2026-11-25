-- =============================================================================
-- Performance Management in AI Studio (docs/TASK_DAILY_REPORTS_PERFORMANCE.md, "AI Studio"). Run after 20270213000100_performance_lead_primary.sql.
-- Safe to run twice; no temp tables; nothing is deleted and no column changes meaning.
--
-- Why it was missing: AI Studio people use their own dashboard (AiStudioDashboard) whose side panel never had Performance Management, and AI Studio
-- keeps its own tasks (ai_studio_tasks) and two-step daily reports (ai_studio_daily_reports: Team Lead, then Department Head), while the shared
-- performance figures read work_tasks and task_daily_reports only - so even a link to the shared page would have shown an AI Studio team with no data.
--
-- This migration makes the shared Performance Management (the same records, approvals, ratings, histories and permissions as every department since
-- 20270213000100) read AI Studio's own work for AI Studio people:
--   1. private.perf2_member / private.perf2_lead dispatch: an AI Studio person's figures come from ai_studio_tasks and ai_studio_daily_reports
--      (perf2_member_ai / perf2_lead_ai, the same shape), everybody else's from the task records as before (perf2_member_tasks / perf2_lead_tasks,
--      the 20270209000100 bodies unchanged).
--      An AI Studio report counts as Approved once its Team Lead approved it (or the Department Head, for a member without a Team Lead); Returned when
--      sent back at either step; Pending while it waits at the Team Lead's step (a member without a Team Lead: at the Department Head's).
--   2. perf2_waiting_reports, performance_overview (pending reports, department figures, `source`) and performance_member_work (the drill-down) read
--      AI Studio's tasks and reports for AI Studio.
--   3. ai_studio_report_lead_edit: the reviewer at the Team Lead's step corrects an AI Studio report before deciding it (with a reason the member reads);
--      kept in the report's history (EDITED, with each change), audited, the member notified.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. AI Studio's own work as performance figures
-- ---------------------------------------------------------------------------
create or replace function private.perf2_is_ai_studio(p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_department is not null and p_department is not distinct from private.ai_studio_department()
$$;
revoke all on function private.perf2_is_ai_studio(uuid) from public, anon, authenticated;

-- An AI Studio report as performance counts it (drafts are not counted at all).
create or replace function private.perf2_ai_report_state(r public.ai_studio_daily_reports)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when r.status = 'DRAFT' then null
    when r.status in ('RETURNED_BY_TL', 'RETURNED_BY_DH') then 'RETURNED'
    when r.status = 'APPROVED' then 'APPROVED'
    when r.status = 'PENDING_DH_APPROVAL' and r.tl_reviewed_at is not null then 'APPROVED'   -- the Team Lead approved it; the head's step follows
    else 'PENDING' end
$$;
revoke all on function private.perf2_ai_report_state(public.ai_studio_daily_reports) from public, anon, authenticated;

create or replace function private.perf2_member_ai(p_member uuid, p_start date, p_end date, p_today date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz constant text := 'Asia/Kolkata';
  k record;
  g record;
  v_expected integer;
  v_parts jsonb;
  v_consistency numeric;
  v_approval numeric;
  v_progress numeric;
begin
  select count(*)::int as total,
         count(*) filter (where t.status = 'COMPLETED')::int as completed,
         count(*) filter (where t.status <> 'COMPLETED' and not (t.due_date is not null and t.due_date < p_today))::int as pending,
         count(*) filter (where t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < p_today)::int as overdue,
         count(*) filter (where t.status = 'COMPLETED' and t.completed_at is not null and t.due_date is not null and (t.completed_at at time zone v_tz)::date <= t.due_date)::int as on_time,
         count(*) filter (where t.status = 'COMPLETED' and t.completed_at is not null and t.due_date is not null and (t.completed_at at time zone v_tz)::date > t.due_date)::int as late,
         avg(case when t.status = 'COMPLETED' then 100 else t.progress end) as avg_progress
    into k
    from public.ai_studio_tasks t
   where t.assignee_id = p_member and coalesce(t.due_date, (t.created_at at time zone v_tz)::date) between p_start and p_end;

  select count(*)::int as submitted, count(*) filter (where s = 'APPROVED')::int as approved,
         count(*) filter (where s = 'RETURNED')::int as returned, count(*) filter (where s = 'PENDING')::int as pending,
         count(distinct d) filter (where s = 'APPROVED')::int as approved_days
    into g
    from (select private.perf2_ai_report_state(r) as s, r.report_date as d from public.ai_studio_daily_reports r
           where r.author_id = p_member and r.status <> 'DRAFT' and r.report_date between p_start and p_end) x;

  -- the working days (not Sunday, not after today) on which the person had an AI Studio task open
  select count(*)::int into v_expected
    from generate_series(p_start::timestamp, least(p_end, p_today)::timestamp, interval '1 day') d(day)
   where extract(dow from d.day) <> 0 and exists (
     select 1 from public.ai_studio_tasks t where t.assignee_id = p_member and (t.created_at at time zone v_tz)::date <= d.day::date
        and (t.status <> 'COMPLETED' or (t.completed_at at time zone v_tz)::date >= d.day::date));
  v_consistency := case when v_expected > 0 then least(100, private.perf2_pct(g.approved_days, v_expected)) end;
  v_approval := private.perf2_pct(g.approved, g.approved + g.returned);
  v_progress := case when k.total > 0 then round(k.avg_progress, 1) end;

  v_parts := jsonb_build_array(
    jsonb_build_object('key', 'completion', 'label', 'Task completion', 'weight', 35, 'value', private.perf2_pct(k.completed, k.total)),
    jsonb_build_object('key', 'progress', 'label', 'Task progress', 'weight', 15, 'value', v_progress),
    jsonb_build_object('key', 'onTime', 'label', 'On-time completion', 'weight', 20, 'value', private.perf2_pct(k.on_time, k.on_time + k.late)),
    jsonb_build_object('key', 'reportApproval', 'label', 'Daily reports approved', 'weight', 15, 'value', v_approval),
    jsonb_build_object('key', 'consistency', 'label', 'Reporting consistency', 'weight', 15, 'value', v_consistency));
  return jsonb_build_object(
    'tasks', jsonb_build_object('total', k.total, 'completed', k.completed, 'pending', k.pending, 'overdue', k.overdue, 'onTime', k.on_time, 'late', k.late),
    'completionPct', private.perf2_pct(k.completed, k.total), 'onTimePct', private.perf2_pct(k.on_time, k.on_time + k.late), 'progressPct', v_progress,
    'reports', jsonb_build_object('submitted', g.submitted, 'approved', g.approved, 'returned', g.returned, 'pending', g.pending,
        'approvalPct', v_approval, 'expectedDays', v_expected, 'approvedDays', g.approved_days, 'consistencyPct', v_consistency),
    'parts', v_parts, 'score', private.perf2_score(v_parts));
end $$;
revoke all on function private.perf2_member_ai(uuid, date, date, date) from public, anon, authenticated;

-- An AI Studio Team Lead: their own AI Studio tasks, the team (the members' figures passed in), the reports they reviewed. AI Studio has no task split,
-- so "work handed down" is not measured (left out of the score, which re-weights the other parts).
create or replace function private.perf2_lead_ai(p_lead uuid, p_start date, p_end date, p_today date, p_members jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz constant text := 'Asia/Kolkata';
  own record;
  mg record;
  rv record;
  tm record;
  v_parts jsonb;
begin
  select count(*)::int as total, count(*) filter (where t.status = 'COMPLETED')::int as completed,
         count(*) filter (where t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < p_today)::int as overdue
    into own from public.ai_studio_tasks t
   where t.assignee_id = p_lead and coalesce(t.due_date, (t.created_at at time zone v_tz)::date) between p_start and p_end;

  select count(*)::int as assigned into mg from public.ai_studio_tasks t
   where t.assigned_by = p_lead and t.assignee_id <> p_lead and (t.created_at at time zone v_tz)::date between p_start and p_end;

  -- the reports of the members this lead reviews (the report's Team Lead)
  select count(*)::int as submitted, count(*) filter (where s = 'APPROVED')::int as approved, count(*) filter (where s = 'RETURNED')::int as returned,
         count(*) filter (where s = 'PENDING')::int as pending,
         count(*) filter (where s = 'PENDING' and submitted_at < now() - interval '1 day')::int as waiting,
         round(avg(extract(epoch from tl_reviewed_at - submitted_at) / 3600) filter (where tl_reviewed_at is not null)::numeric, 1) as avg_hours
    into rv
    from (select private.perf2_ai_report_state(r) as s, r.submitted_at, r.tl_reviewed_at from public.ai_studio_daily_reports r
           where r.author_role = 'MEMBER' and r.status <> 'DRAFT' and r.report_date between p_start and p_end and private.ai_studio_report_lead(r) = p_lead) x;

  select coalesce(sum((m ->> 'total')::int), 0)::int as total, coalesce(sum((m ->> 'completed')::int), 0)::int as completed,
         coalesce(sum((m ->> 'pending')::int), 0)::int as pending, coalesce(sum((m ->> 'overdue')::int), 0)::int as overdue,
         coalesce(sum((m ->> 'onTime')::int), 0)::int as on_time, coalesce(sum((m ->> 'late')::int), 0)::int as late,
         count(*)::int as members, round(avg((m ->> 'progress')::numeric) filter (where m ->> 'progress' is not null), 1) as progress
    into tm from (select (x -> 'tasks') || jsonb_build_object('progress', x -> 'progressPct') as m from jsonb_array_elements(p_members) x) q;

  v_parts := jsonb_build_array(
    jsonb_build_object('key', 'ownCompletion', 'label', 'Own task completion', 'weight', 20, 'value', private.perf2_pct(own.completed, own.total)),
    jsonb_build_object('key', 'teamCompletion', 'label', 'Team task completion', 'weight', 25, 'value', private.perf2_pct(tm.completed, tm.total)),
    jsonb_build_object('key', 'teamOnTime', 'label', 'Team on-time completion', 'weight', 15, 'value', private.perf2_pct(tm.on_time, tm.on_time + tm.late)),
    jsonb_build_object('key', 'reviews', 'label', 'Daily reports reviewed', 'weight', 25, 'value', private.perf2_pct(rv.approved + rv.returned, rv.approved + rv.returned + rv.waiting)));
  return jsonb_build_object(
    'own', jsonb_build_object('total', own.total, 'completed', own.completed, 'overdue', own.overdue, 'completionPct', private.perf2_pct(own.completed, own.total)),
    'team', jsonb_build_object('members', tm.members, 'total', tm.total, 'completed', tm.completed, 'pending', tm.pending, 'overdue', tm.overdue,
        'onTime', tm.on_time, 'late', tm.late, 'completionPct', private.perf2_pct(tm.completed, tm.total),
        'onTimePct', private.perf2_pct(tm.on_time, tm.on_time + tm.late), 'progressPct', tm.progress),
    'reports', jsonb_build_object('submitted', rv.submitted, 'approved', rv.approved, 'returned', rv.returned, 'pending', rv.pending, 'waitingOverOneDay', rv.waiting,
        'reviewedPct', private.perf2_pct(rv.approved + rv.returned, rv.submitted), 'avgReviewHours', rv.avg_hours),
    'management', jsonb_build_object('tasksAssignedToTeam', mg.assigned, 'tasksReceived', own.total, 'handedDown', 0, 'handledOrDelegated', own.total, 'delegationPct', null),
    'parts', v_parts, 'score', private.perf2_score(v_parts));
end $$;
revoke all on function private.perf2_lead_ai(uuid, date, date, date, jsonb) from public, anon, authenticated;

-- The task-record figures of every other department: 20270209000100's perf2_member / perf2_lead, unchanged, under a new name.
create or replace function private.perf2_member_tasks(p_member uuid, p_start date, p_end date, p_today date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz constant text := 'Asia/Kolkata';
  k record;
  g record;
  v_expected integer;
  v_approved_days integer;
  v_parts jsonb;
  v_consistency numeric;
  v_approval numeric;
  v_progress numeric;
begin
  select count(*)::int as total,
         count(*) filter (where t.status = 'COMPLETED')::int as completed,
         count(*) filter (where t.status <> 'COMPLETED' and not (t.due_date is not null and t.due_date < p_today))::int as pending,
         count(*) filter (where t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < p_today)::int as overdue,
         count(*) filter (where t.status = 'COMPLETED' and t.completed_at is not null and t.due_date is not null and (t.completed_at at time zone v_tz)::date <= t.due_date)::int as on_time,
         count(*) filter (where t.status = 'COMPLETED' and t.completed_at is not null and t.due_date is not null and (t.completed_at at time zone v_tz)::date > t.due_date)::int as late,
         avg(case when t.status = 'COMPLETED' then 100
                  else coalesce((select r.progress from public.task_daily_reports r where r.task_id = t.id and r.status = 'APPROVED' and r.report_date <= p_end
                                  order by r.report_date desc, r.submitted_at desc limit 1), 0) end) as avg_progress
    into k
    from public.work_tasks t
   where t.assignee_id = p_member and coalesce(t.due_date, (t.created_at at time zone v_tz)::date) between p_start and p_end;

  select count(*)::int as submitted, count(*) filter (where r.status = 'APPROVED')::int as approved,
         count(*) filter (where r.status = 'RETURNED')::int as returned, count(*) filter (where r.status = 'PENDING')::int as pending,
         count(distinct r.report_date) filter (where r.status = 'APPROVED')::int as approved_days
    into g from public.task_daily_reports r where r.author_id = p_member and r.report_date between p_start and p_end;

  -- the working days (not Sunday, not after today) on which the person had a task open
  select count(*)::int into v_expected
    from generate_series(p_start::timestamp, least(p_end, p_today)::timestamp, interval '1 day') d(day)
   where extract(dow from d.day) <> 0 and exists (
     select 1 from public.work_tasks t where t.assignee_id = p_member and (t.created_at at time zone v_tz)::date <= d.day::date
        and (t.status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED') or (t.status = 'COMPLETED' and (t.completed_at at time zone v_tz)::date >= d.day::date)));
  v_approved_days := g.approved_days;
  v_consistency := case when v_expected > 0 then least(100, private.perf2_pct(v_approved_days, v_expected)) end;
  v_approval := private.perf2_pct(g.approved, g.approved + g.returned);
  v_progress := case when k.total > 0 then round(k.avg_progress, 1) end;

  v_parts := jsonb_build_array(
    jsonb_build_object('key', 'completion', 'label', 'Task completion', 'weight', 35, 'value', private.perf2_pct(k.completed, k.total)),
    jsonb_build_object('key', 'progress', 'label', 'Progress (approved reports)', 'weight', 15, 'value', v_progress),
    jsonb_build_object('key', 'onTime', 'label', 'On-time completion', 'weight', 20, 'value', private.perf2_pct(k.on_time, k.on_time + k.late)),
    jsonb_build_object('key', 'reportApproval', 'label', 'Reports approved', 'weight', 15, 'value', v_approval),
    jsonb_build_object('key', 'consistency', 'label', 'Reporting consistency', 'weight', 15, 'value', v_consistency));
  return jsonb_build_object(
    'tasks', jsonb_build_object('total', k.total, 'completed', k.completed, 'pending', k.pending, 'overdue', k.overdue, 'onTime', k.on_time, 'late', k.late),
    'completionPct', private.perf2_pct(k.completed, k.total), 'onTimePct', private.perf2_pct(k.on_time, k.on_time + k.late), 'progressPct', v_progress,
    'reports', jsonb_build_object('submitted', g.submitted, 'approved', g.approved, 'returned', g.returned, 'pending', g.pending,
        'approvalPct', v_approval, 'expectedDays', v_expected, 'approvedDays', v_approved_days, 'consistencyPct', v_consistency),
    'parts', v_parts, 'score', private.perf2_score(v_parts));
end $$;
revoke all on function private.perf2_member_tasks(uuid, date, date, date) from public, anon, authenticated;

create or replace function private.perf2_lead_tasks(p_lead uuid, p_start date, p_end date, p_today date, p_members jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz constant text := 'Asia/Kolkata';
  own record;
  mg record;
  rv record;
  tm record;
  v_parts jsonb;
begin
  select count(*)::int as total, count(*) filter (where t.status = 'COMPLETED')::int as completed,
         count(*) filter (where t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < p_today)::int as overdue,
         count(*) filter (where t.handling = 'SELF' or exists (select 1 from public.work_tasks c where c.parent_id = t.id))::int as handled,
         count(*) filter (where exists (select 1 from public.work_tasks c where c.parent_id = t.id))::int as delegated
    into own from public.work_tasks t
   where t.assignee_id = p_lead and coalesce(t.due_date, (t.created_at at time zone v_tz)::date) between p_start and p_end;

  select count(*)::int as assigned into mg from public.work_tasks t join public.profiles m on m.id = t.assignee_id and m.role = 'TEAM_MEMBER'
   where t.assigned_by = p_lead and (t.created_at at time zone v_tz)::date between p_start and p_end;

  -- the team's reports (reviews of the members the lead leads)
  select count(*)::int as submitted, count(*) filter (where r.status = 'APPROVED')::int as approved, count(*) filter (where r.status = 'RETURNED')::int as returned,
         count(*) filter (where r.status = 'PENDING')::int as pending,
         count(*) filter (where r.status = 'PENDING' and r.submitted_at < now() - interval '1 day')::int as waiting,
         round(avg(extract(epoch from r.reviewed_at - r.submitted_at) / 3600) filter (where r.reviewed_at is not null)::numeric, 1) as avg_hours
    into rv from public.task_daily_reports r
   where r.report_date between p_start and p_end and private.direct_lead_of(r.author_id) = p_lead;

  select coalesce(sum((m ->> 'total')::int), 0)::int as total, coalesce(sum((m ->> 'completed')::int), 0)::int as completed,
         coalesce(sum((m ->> 'pending')::int), 0)::int as pending, coalesce(sum((m ->> 'overdue')::int), 0)::int as overdue,
         coalesce(sum((m ->> 'onTime')::int), 0)::int as on_time, coalesce(sum((m ->> 'late')::int), 0)::int as late,
         count(*)::int as members, round(avg((m ->> 'progress')::numeric) filter (where m ->> 'progress' is not null), 1) as progress
    into tm from (select (x -> 'tasks') || jsonb_build_object('progress', x -> 'progressPct') as m from jsonb_array_elements(p_members) x) q;

  v_parts := jsonb_build_array(
    jsonb_build_object('key', 'ownCompletion', 'label', 'Own task completion', 'weight', 20, 'value', private.perf2_pct(own.completed, own.total)),
    jsonb_build_object('key', 'teamCompletion', 'label', 'Team task completion', 'weight', 25, 'value', private.perf2_pct(tm.completed, tm.total)),
    jsonb_build_object('key', 'teamOnTime', 'label', 'Team on-time completion', 'weight', 15, 'value', private.perf2_pct(tm.on_time, tm.on_time + tm.late)),
    jsonb_build_object('key', 'reviews', 'label', 'Reports reviewed', 'weight', 25, 'value', private.perf2_pct(rv.approved + rv.returned, rv.approved + rv.returned + rv.waiting)),
    jsonb_build_object('key', 'delegation', 'label', 'Work handed down', 'weight', 15, 'value', private.perf2_pct(own.handled, own.total)));
  return jsonb_build_object(
    'own', jsonb_build_object('total', own.total, 'completed', own.completed, 'overdue', own.overdue, 'completionPct', private.perf2_pct(own.completed, own.total)),
    'team', jsonb_build_object('members', tm.members, 'total', tm.total, 'completed', tm.completed, 'pending', tm.pending, 'overdue', tm.overdue,
        'onTime', tm.on_time, 'late', tm.late, 'completionPct', private.perf2_pct(tm.completed, tm.total),
        'onTimePct', private.perf2_pct(tm.on_time, tm.on_time + tm.late), 'progressPct', tm.progress),
    'reports', jsonb_build_object('submitted', rv.submitted, 'approved', rv.approved, 'returned', rv.returned, 'pending', rv.pending, 'waitingOverOneDay', rv.waiting,
        'reviewedPct', private.perf2_pct(rv.approved + rv.returned, rv.submitted), 'avgReviewHours', rv.avg_hours),
    'management', jsonb_build_object('tasksAssignedToTeam', mg.assigned, 'tasksReceived', own.total, 'handedDown', own.delegated, 'handledOrDelegated', own.handled,
        'delegationPct', private.perf2_pct(own.handled, own.total)),
    'parts', v_parts, 'score', private.perf2_score(v_parts));
end $$;
revoke all on function private.perf2_lead_tasks(uuid, date, date, date, jsonb) from public, anon, authenticated;

-- Every caller (the overview, the records, refreshes, resubmissions) keeps calling perf2_member / perf2_lead; the person's department picks the source.
create or replace function private.perf2_member(p_member uuid, p_start date, p_end date, p_today date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.perf2_is_ai_studio((select p.department_id from public.profiles p where p.id = p_member)) then
    return private.perf2_member_ai(p_member, p_start, p_end, p_today);
  end if;
  return private.perf2_member_tasks(p_member, p_start, p_end, p_today);
end $$;
revoke all on function private.perf2_member(uuid, date, date, date) from public, anon, authenticated;

create or replace function private.perf2_lead(p_lead uuid, p_start date, p_end date, p_today date, p_members jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.perf2_is_ai_studio((select p.department_id from public.profiles p where p.id = p_lead)) then
    return private.perf2_lead_ai(p_lead, p_start, p_end, p_today, p_members);
  end if;
  return private.perf2_lead_tasks(p_lead, p_start, p_end, p_today, p_members);
end $$;
revoke all on function private.perf2_lead(uuid, date, date, date, jsonb) from public, anon, authenticated;

-- A member's reports still waiting for a decision in the record's period (a member's performance is not approved while one waits): AI Studio's own reports
-- for an AI Studio member.
create or replace function private.perf2_waiting_reports(r public.performance_records)
returns integer language sql stable security definer set search_path = '' as $$
  select case when r.subject_role <> 'TEAM_MEMBER' then 0
              when private.perf2_is_ai_studio(r.department_id) then
                (select count(*)::int from public.ai_studio_daily_reports x where x.author_id = r.subject_id and x.status <> 'DRAFT'
                    and x.report_date between r.period_start and r.period_end and private.perf2_ai_report_state(x) = 'PENDING')
              else (select count(*)::int from public.task_daily_reports x where x.author_id = r.subject_id and x.status = 'PENDING' and x.report_date between r.period_start and r.period_end) end
$$;
revoke all on function private.perf2_waiting_reports(public.performance_records) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The overview (20270213000100 + AI Studio's pending reports and department figures, and `source`) and a person's work (+ AI Studio)
-- ---------------------------------------------------------------------------
create or replace function public.performance_overview(p_start date, p_end date, p_department uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_today date := private.perf2_today();
  v_dept uuid;
  v_dept_name text;
  lead public.profiles;
  m public.profiles;
  v_people jsonb;
  v_members jsonb;
  v_member_metrics jsonb;
  v_leads jsonb := '[]'::jsonb;
  v_unled jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_lead_json jsonb;
  v_me jsonb;
  v_ai boolean;
begin
  select * into me from public.profiles where id = private.my_id();
  if me.id is null or me.role not in ('TEAM_MEMBER', 'TEAM_HEAD', 'DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Performance is not available for your role.' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366 then
    raise exception 'VALIDATION_ERROR: Choose a period of at most one year.' using errcode = 'P0001';
  end if;

  if me.role = 'TEAM_MEMBER' then
    -- every department (20270213000100): performance is the Team Lead's; the member reports on their tasks and sees nothing of their performance
    if private.perf2_strict(me.department_id) then
      raise exception 'FORBIDDEN: Performance Management is for Team Leads and Department Heads. Submit your daily reports on your assigned tasks; your Team Lead reviews them.' using errcode = '42501';
    end if;
    return jsonb_build_object('role', 'TEAM_MEMBER', 'periodStart', p_start, 'periodEnd', p_end, 'today', v_today,
                              'me', private.perf2_person(me, p_start, p_end, v_today));
  end if;

  if me.role = 'TEAM_HEAD' then
    v_members := '[]'::jsonb; v_member_metrics := '[]'::jsonb;
    for m in select * from private.perf2_members_of(me.id) order by full_name loop
      v_people := private.perf2_person(m, p_start, p_end, v_today);
      v_members := v_members || jsonb_build_array(v_people);
      v_member_metrics := v_member_metrics || jsonb_build_array(v_people -> 'metrics');
    end loop;
    v_me := private.perf2_person(me, p_start, p_end, v_today, v_member_metrics);
    return jsonb_build_object('role', 'TEAM_HEAD', 'periodStart', p_start, 'periodEnd', p_end, 'today', v_today, 'me', v_me, 'members', v_members,
      -- AI Studio: its own daily reports waiting at the Team Lead's step
      'pendingReports', case when private.perf2_is_ai_studio(me.department_id)
                             then (select count(*) from public.ai_studio_daily_reports r where r.status in ('SUBMITTED', 'PENDING_TL_APPROVAL') and private.ai_studio_report_lead(r) = me.id)
                             else (select count(*) from public.task_daily_reports r where r.status = 'PENDING' and private.direct_lead_of(r.author_id) = me.id) end,
      'source', case when private.perf2_is_ai_studio(me.department_id) then 'AI_STUDIO' else 'TASKS' end,
      'pendingRecords', (select count(*) from jsonb_array_elements(v_members) x where x #>> '{record,status}' = 'PENDING'),
      -- every department: the Team Lead evaluates their members
      'leadDecidesMembers', true);
  end if;

  -- Department Head (own department) or Super Admin (the department asked for)
  if me.role = 'SUPER_ADMIN' then
    if p_department is null then
      raise exception 'VALIDATION_ERROR: Choose a department.' using errcode = 'P0001';
    end if;
    v_dept := p_department;
  else
    v_dept := me.department_id;
  end if;
  select name into v_dept_name from public.departments where id = v_dept;
  if v_dept_name is null then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;

  for lead in select * from public.profiles l where l.department_id = v_dept and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE'
                 and (me.role = 'SUPER_ADMIN' or private.head_covers(me.id, l.department_id, l.team_id)) order by l.full_name loop
    v_members := '[]'::jsonb; v_member_metrics := '[]'::jsonb;
    for m in select * from private.perf2_members_of(lead.id) order by full_name loop
      v_people := private.perf2_person(m, p_start, p_end, v_today);
      v_members := v_members || jsonb_build_array(v_people);
      v_member_metrics := v_member_metrics || jsonb_build_array(v_people -> 'metrics');
    end loop;
    v_lead_json := private.perf2_person(lead, p_start, p_end, v_today, v_member_metrics);
    v_leads := v_leads || jsonb_build_array(v_lead_json || jsonb_build_object('members', v_members));
  end loop;
  -- members nobody leads (a Department Head covers them directly)
  for m in select * from public.profiles x where x.department_id = v_dept and x.role = 'TEAM_MEMBER' and x.status = 'ACTIVE' and private.direct_lead_of(x.id) is null
              and (me.role = 'SUPER_ADMIN' or private.head_covers(me.id, x.department_id, x.team_id)) order by x.full_name loop
    v_unled := v_unled || jsonb_build_array(private.perf2_person(m, p_start, p_end, v_today));
  end loop;

  v_ai := private.perf2_is_ai_studio(v_dept);
  -- the department, every task counted once (a task a Team Lead split is counted through the parts); AI Studio: its own tasks
  if v_ai then
    select jsonb_build_object(
        'total', count(*), 'completed', count(*) filter (where t.status = 'COMPLETED'),
        'pending', count(*) filter (where t.status <> 'COMPLETED' and not (t.due_date is not null and t.due_date < v_today)),
        'overdue', count(*) filter (where t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < v_today),
        'completionPct', private.perf2_pct(count(*) filter (where t.status = 'COMPLETED'), count(*)))
      into v_summary
      from public.ai_studio_tasks t join public.profiles a on a.id = t.assignee_id and a.department_id = v_dept
     where coalesce(t.due_date, (t.created_at at time zone 'Asia/Kolkata')::date) between p_start and p_end;
  else
  select jsonb_build_object(
      'total', count(*), 'completed', count(*) filter (where t.status = 'COMPLETED'),
      'pending', count(*) filter (where t.status <> 'COMPLETED' and not (t.due_date is not null and t.due_date < v_today)),
      'overdue', count(*) filter (where t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < v_today),
      'completionPct', private.perf2_pct(count(*) filter (where t.status = 'COMPLETED'), count(*)))
    into v_summary
    from public.work_tasks t
   where t.department_id = v_dept and not exists (select 1 from public.work_tasks c where c.parent_id = t.id)
     and coalesce(t.due_date, (t.created_at at time zone 'Asia/Kolkata')::date) between p_start and p_end
     and (me.role = 'SUPER_ADMIN' or private.head_covers(me.id, t.department_id, t.team_id));
  end if;

  return jsonb_build_object('role', me.role, 'periodStart', p_start, 'periodEnd', p_end, 'today', v_today,
    'department', jsonb_build_object('id', v_dept, 'name', v_dept_name),
    'tasks', v_summary,
    'reports', case when v_ai then
                 (select jsonb_build_object('submitted', count(*), 'approved', count(*) filter (where private.perf2_ai_report_state(r) = 'APPROVED'),
                    'returned', count(*) filter (where private.perf2_ai_report_state(r) = 'RETURNED'), 'pending', count(*) filter (where private.perf2_ai_report_state(r) = 'PENDING'),
                    'approvedPct', private.perf2_pct(count(*) filter (where private.perf2_ai_report_state(r) = 'APPROVED'), count(*)))
                   from public.ai_studio_daily_reports r join public.profiles a on a.id = r.author_id and a.department_id = v_dept
                  where r.status <> 'DRAFT' and r.report_date between p_start and p_end)
               else
                 (select jsonb_build_object('submitted', count(*), 'approved', count(*) filter (where r.status = 'APPROVED'),
                    'returned', count(*) filter (where r.status = 'RETURNED'), 'pending', count(*) filter (where r.status = 'PENDING'),
                    'approvedPct', private.perf2_pct(count(*) filter (where r.status = 'APPROVED'), count(*)))
                   from public.task_daily_reports r where r.department_id = v_dept and r.report_date between p_start and p_end
                    and private.tdr_can_view(r.author_id, r.department_id, r.team_id)) end,
    'source', case when v_ai then 'AI_STUDIO' else 'TASKS' end,
    'leads', v_leads, 'unassignedMembers', v_unled,
    'pendingRecords', (select count(*) from jsonb_array_elements(v_leads) x where x #>> '{record,status}' = 'PENDING'),
    -- members WITHOUT a Team Lead: they wait for one (International / Reseller) or the Department Head decides them (every other department)
    'leadDecidesMembers', private.dept_is_unified(v_dept));
end $$;
revoke all on function public.performance_overview(date, date, uuid) from public, anon;
grant execute on function public.performance_overview(date, date, uuid) to authenticated;

create or replace function public.performance_member_work(p_subject uuid, p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.profiles;
  v_today date := private.perf2_today();
begin
  if private.my_id() is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366 then
    raise exception 'VALIDATION_ERROR: Choose a period of at most one year.' using errcode = 'P0001';
  end if;
  select * into s from public.profiles where id = p_subject;
  -- the person themselves is refused too (a member has no performance; a Team Lead reads their own in the overview)
  if s.id is null or s.id = auth.uid() or s.role not in ('TEAM_MEMBER', 'TEAM_HEAD')
     or not private.perf2_can_view(s.id, s.role::text, s.department_id, s.team_id) then
    raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001';
  end if;
  -- AI Studio: its own tasks and daily reports (the report's state as performance counts it: Pending / Approved / Returned)
  if private.perf2_is_ai_studio(s.department_id) then
    return jsonb_build_object('id', s.id, 'name', s.full_name, 'role', s.role, 'periodStart', p_start, 'periodEnd', p_end, 'source', 'AI_STUDIO',
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id, 'title', t.title, 'status', t.status, 'priority', t.priority, 'dueDate', t.due_date, 'progress', t.progress,
                 'assignedAt', t.created_at, 'completedAt', t.completed_at, 'project', (select p.name from public.ai_studio_projects p where p.id = t.project_id),
                 'overdue', t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < v_today,
                 'onTime', case when t.status = 'COMPLETED' and t.completed_at is not null and t.due_date is not null
                                then (t.completed_at at time zone 'Asia/Kolkata')::date <= t.due_date end,
                 'reports', (select count(*) from public.ai_studio_daily_reports x where x.task_id = t.id and x.status <> 'DRAFT' and x.report_date between p_start and p_end),
                 'pendingReports', (select count(*) from public.ai_studio_daily_reports x where x.task_id = t.id and x.status <> 'DRAFT' and x.report_date between p_start and p_end
                                       and private.perf2_ai_report_state(x) = 'PENDING'),
                 'lastReport', (select jsonb_build_object('id', x.id, 'reportDate', x.report_date, 'progress', t.progress, 'status', private.perf2_ai_report_state(x))
                                  from public.ai_studio_daily_reports x where x.task_id = t.id and x.status <> 'DRAFT' order by x.report_date desc, x.updated_at desc limit 1))
               order by (t.status = 'COMPLETED'), t.due_date nulls last, t.created_at desc)
          from (select w.* from public.ai_studio_tasks w
                 where w.assignee_id = s.id and coalesce(w.due_date, (w.created_at at time zone 'Asia/Kolkata')::date) between p_start and p_end
                 order by w.due_date nulls last, w.created_at desc limit 300) t), '[]'::jsonb));
  end if;
  return jsonb_build_object('id', s.id, 'name', s.full_name, 'role', s.role, 'periodStart', p_start, 'periodEnd', p_end, 'source', 'TASKS',
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'title', t.title, 'status', t.status, 'priority', t.priority, 'dueDate', t.due_date, 'progress', t.progress,
               'assignedAt', t.created_at, 'completedAt', t.completed_at,
               'overdue', t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < v_today,
               'onTime', case when t.status = 'COMPLETED' and t.completed_at is not null and t.due_date is not null
                              then (t.completed_at at time zone 'Asia/Kolkata')::date <= t.due_date end,
               'reports', (select count(*) from public.task_daily_reports x where x.task_id = t.id and x.report_date between p_start and p_end),
               'pendingReports', (select count(*) from public.task_daily_reports x where x.task_id = t.id and x.status = 'PENDING' and x.report_date between p_start and p_end),
               'lastReport', (select jsonb_build_object('id', x.id, 'reportDate', x.report_date, 'progress', x.progress, 'status', x.status)
                                from public.task_daily_reports x where x.task_id = t.id order by x.report_date desc, x.submitted_at desc limit 1))
             order by (t.status = 'COMPLETED'), t.due_date nulls last, t.created_at desc)
        from (select w.* from public.work_tasks w
               where w.assignee_id = s.id and coalesce(w.due_date, (w.created_at at time zone 'Asia/Kolkata')::date) between p_start and p_end
               order by w.due_date nulls last, w.created_at desc limit 300) t), '[]'::jsonb));
end $$;
revoke all on function public.performance_member_work(uuid, date, date) from public, anon;
grant execute on function public.performance_member_work(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The reviewer at the Team Lead's step corrects an AI Studio report before deciding it
-- ---------------------------------------------------------------------------
alter table public.ai_studio_report_events add column if not exists changes jsonb;
alter table public.ai_studio_report_events drop constraint if exists ai_studio_report_events_action_check;
alter table public.ai_studio_report_events add constraint ai_studio_report_events_action_check
  check (action in ('CREATED', 'SUBMITTED', 'RESUBMITTED', 'APPROVED', 'RETURNED', 'EDITED'));

-- 20270105000100's detail + canLeadEdit and each history step's changes
create or replace function private.ai_studio_report_detail(r public.ai_studio_daily_reports)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.ai_studio_report_row(r) || jsonb_build_object(
    'workCompleted', r.work_completed, 'workInProgress', r.work_in_progress, 'pendingWork', r.pending_work, 'blockers', r.blockers, 'remarks', r.remarks,
    'tlComment', r.tl_comment, 'tlReviewedAt', r.tl_reviewed_at, 'tlReviewerName', (select p.full_name from public.profiles p where p.id = r.tl_reviewed_by),
    'dhComment', r.dh_comment, 'dhReviewedAt', r.dh_reviewed_at, 'dhReviewerName', (select p.full_name from public.profiles p where p.id = r.dh_reviewed_by),
    'canEdit', r.author_id = auth.uid() and r.status in ('DRAFT', 'RETURNED_BY_TL', 'RETURNED_BY_DH'),
    'canReview', private.ai_studio_can_review(r),
    -- 20270214000100: the reviewer at the Team Lead's step may correct the report before deciding it
    'canLeadEdit', r.status = 'PENDING_TL_APPROVAL' and private.ai_studio_can_review(r),
    'reviewStage', case when r.status = 'PENDING_TL_APPROVAL' then 'TEAM_LEAD' when r.status = 'PENDING_DH_APPROVAL' then 'DEPARTMENT_HEAD' end,
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'action', e.action, 'stage', e.stage, 'fromStatus', e.from_status, 'toStatus', e.to_status,
                                                               'comment', e.comment, 'actorName', e.actor_name, 'actorRole', e.actor_role, 'revision', e.revision,
                                                               'createdAt', e.created_at, 'changes', e.changes) order by e.seq)
                           from public.ai_studio_report_events e where e.report_id = r.id), '[]'::jsonb))
$$;
revoke all on function private.ai_studio_report_detail(public.ai_studio_daily_reports) from public, anon;
grant execute on function private.ai_studio_report_detail(public.ai_studio_daily_reports) to authenticated, service_role;

create or replace function public.ai_studio_report_lead_edit(
  p_report uuid, p_work_completed text, p_work_in_progress text, p_pending_work text, p_blockers text, p_remarks text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD']);
  r public.ai_studio_daily_reports;
  v_completed text := nullif(btrim(coalesce(p_work_completed, '')), '');
  v_progress text := nullif(btrim(coalesce(p_work_in_progress, '')), '');
  v_pending text := nullif(btrim(coalesce(p_pending_work, '')), '');
  v_blockers text := nullif(btrim(coalesce(p_blockers, '')), '');
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_changes jsonb := '{}'::jsonb;
begin
  select * into r from public.ai_studio_daily_reports where id = p_report for update;
  if r.id is null or not private.ai_studio_can_see_report(r) then
    raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
  end if;
  if r.status <> 'PENDING_TL_APPROVAL' or not private.ai_studio_can_review(r) then
    raise exception 'FORBIDDEN: Only the Team Lead reviewing this report can edit it, while it waits for their approval.' using errcode = '42501';
  end if;
  -- the author's own rules (ai_studio_report_save) apply to the corrected report
  if v_completed is null then
    raise exception 'VALIDATION_ERROR: Describe the work completed today.' using errcode = 'P0001';
  end if;
  if greatest(length(v_completed), length(coalesce(v_progress, '')), length(coalesce(v_pending, '')), length(coalesce(v_blockers, '')), length(coalesce(v_remarks, ''))) > 4000 then
    raise exception 'VALIDATION_ERROR: Each part of the report can have at most 4000 characters.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_reason, '')) < 5 or length(v_reason) > 1000 then
    raise exception 'VALIDATION_ERROR: Say why you changed the report (5 to 1000 characters); the team member reads it.' using errcode = 'P0001';
  end if;
  if r.work_completed is distinct from v_completed then v_changes := v_changes || jsonb_build_object('workCompleted', jsonb_build_object('from', r.work_completed, 'to', v_completed)); end if;
  if r.work_in_progress is distinct from v_progress then v_changes := v_changes || jsonb_build_object('workInProgress', jsonb_build_object('from', r.work_in_progress, 'to', v_progress)); end if;
  if r.pending_work is distinct from v_pending then v_changes := v_changes || jsonb_build_object('pendingWork', jsonb_build_object('from', r.pending_work, 'to', v_pending)); end if;
  if r.blockers is distinct from v_blockers then v_changes := v_changes || jsonb_build_object('blockers', jsonb_build_object('from', r.blockers, 'to', v_blockers)); end if;
  if r.remarks is distinct from v_remarks then v_changes := v_changes || jsonb_build_object('remarks', jsonb_build_object('from', r.remarks, 'to', v_remarks)); end if;
  -- the same values again (a double click or a retry): nothing to record
  if v_changes = '{}'::jsonb then
    return private.ai_studio_report_detail(r);
  end if;
  update public.ai_studio_daily_reports set work_completed = v_completed, work_in_progress = v_progress, pending_work = v_pending, blockers = v_blockers, remarks = v_remarks
   where id = r.id returning * into r;
  insert into public.ai_studio_report_events (report_id, actor_id, actor_name, actor_role, action, stage, from_status, to_status, comment, revision, changes)
  select r.id, p.id, p.full_name, v_role, 'EDITED', 'TEAM_LEAD', r.status, r.status, v_reason, r.revision, v_changes from public.profiles p where p.id = auth.uid();
  perform private.write_audit('AI_STUDIO_REPORT_EDITED', 'ai_studio_daily_report', r.id, (select a.department_id from public.profiles a where a.id = r.author_id), null,
    jsonb_build_object('reportDate', r.report_date, 'changes', v_changes, 'reason', v_reason));
  perform private.notify(r.author_id, 'AI_STUDIO_REPORT_EDITED', 'Your Team Lead edited your daily report',
    format('%s · %s', to_char(r.report_date, 'DD Mon'), left(v_reason, 160)), 'ai_studio_report', r.id, '{}'::jsonb, 'normal');
  return private.ai_studio_report_detail(r);
end $$;
revoke all on function public.ai_studio_report_lead_edit(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.ai_studio_report_lead_edit(uuid, text, text, text, text, text, text) to authenticated;
