-- =============================================================================
-- AI Studio: cross-team task assignment and multi-task daily reports (docs/AI_STUDIO_CROSS_TEAM.md).
-- Run after 20270217000100_weekly_report_direct_to_hr.sql. Safe to run twice; no temp tables; nothing is deleted; existing reports and tasks keep their meaning.
--
-- What was there (the audit): a Team Lead could give tasks to their OWN Team Members only, and only on a project the member was on
-- (ai_studio_task_assign); a Team Lead could edit every task they could see (ai_studio_task_get / _edit), which would let an employee's own Team Lead
-- change another team's task once tasks cross teams; a daily report was one project and at most one task (ai_studio_daily_reports, one row per person,
-- date, project and task). A "team" in AI Studio is a Team Lead and the people who report to them (private.direct_lead_of); a project's Team Leads are
-- its Team Lead members (ai_studio_project_members), so "a Team Lead who manages a project" = a Team Lead on that project.
--
--  1. Cross-team assignment, a task-level permission (no team, Team Lead, department, designation or project membership changes):
--     a Team Lead on a project gives a task of THAT project to a Team Member of another AI Studio team. The server works out the assignment type from the
--     reporting lines (the browser sends none) and keeps, on the task, the project-owning team (the assigning Team Lead), the employee's Team Lead and team
--     at that moment. The employee sees the task (and its project) because the task is theirs; nothing else of the project opens to them.
--     Who changes a cross-team task: the assigning Team Lead, the Department Head, the Managing Director (Super Admin) - never the employee's own Team
--     Lead, who sees it (workload) but does not own it. Same-team tasks keep their rules.
--  2. One daily report per person and day with one entry per task (ai_studio_report_entries): work, time spent, progress, blockers, next action. The same
--     two-step approval (Team Lead, then Department Head). On submission each entry's progress is written to its task through the task's own history
--     (kind REPORT), only ever upwards (a stale report never lowers newer progress) and never to 100% (completing a task stays its own step). Older
--     single-task reports stay as they were; each one that names a task also gets one entry (backfilled, flagged legacy) so the task histories include it.
--  3. Who reads what: the employee's own Team Lead and the Department Head read the whole report; the Team Lead who gave a cross-team task reads only the
--     entries about that task (in the task), never the rest of the report.
--  4. Notifications (the existing bell / push / e-mail rules): a cross-team task to the employee and to their Team Lead; deadline and priority changes; a
--     blocker in a daily report entry; completion (as before).
--  5. Performance figures (20270214000100) gain cross-team tasks, projects contributed to, reported minutes and blockers; tasks are still counted once.
--  6. Global search finds the AI Studio tasks, projects and daily reports the person may already open.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.ai_studio_tasks add column if not exists assignment_type text not null default 'STANDARD';
alter table public.ai_studio_tasks add column if not exists owner_lead_id uuid references public.profiles (id) on delete set null;      -- the project-owning team (the assigning Team Lead)
alter table public.ai_studio_tasks add column if not exists assignee_lead_id uuid references public.profiles (id) on delete set null;   -- the employee's Team Lead when assigned
alter table public.ai_studio_tasks add column if not exists assignee_team_id uuid references public.teams (id) on delete set null;      -- the employee's team when assigned
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ai_studio_tasks_assignment_type_check') then
    alter table public.ai_studio_tasks add constraint ai_studio_tasks_assignment_type_check check (assignment_type in ('STANDARD', 'CROSS_TEAM'));
  end if;
end $$;
create index if not exists ai_studio_tasks_cross_team_idx on public.ai_studio_tasks (assigned_by, status) where assignment_type = 'CROSS_TEAM';

-- task history: a daily report linked to the task, a blocker reported in one; the values before / after
alter table public.ai_studio_task_updates drop constraint if exists ai_studio_task_updates_kind_check;
alter table public.ai_studio_task_updates add constraint ai_studio_task_updates_kind_check check (kind in ('ASSIGNED', 'PROGRESS', 'EDITED', 'REPORT', 'BLOCKER'));
alter table public.ai_studio_task_updates add column if not exists details jsonb;
alter table public.ai_studio_task_updates add column if not exists report_id uuid references public.ai_studio_daily_reports (id) on delete set null;

-- a consolidated (multi-task) report has no single project; a single-task report still names its project
alter table public.ai_studio_daily_reports alter column project_id drop not null;
alter table public.ai_studio_daily_reports add column if not exists consolidated boolean not null default false;
alter table public.ai_studio_daily_reports add column if not exists total_minutes integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ai_studio_daily_reports_project_check') then
    alter table public.ai_studio_daily_reports add constraint ai_studio_daily_reports_project_check check (consolidated or project_id is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_studio_daily_reports_minutes_check') then
    alter table public.ai_studio_daily_reports add constraint ai_studio_daily_reports_minutes_check check (total_minutes is null or total_minutes between 0 and 1440);
  end if;
end $$;
-- one consolidated report per person and day: a double click or a retry finds the same report
create unique index if not exists ai_studio_daily_reports_one_per_day on public.ai_studio_daily_reports (author_id, report_date) where consolidated;

create table if not exists public.ai_studio_report_entries (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.ai_studio_daily_reports (id) on delete cascade,
  task_id uuid references public.ai_studio_tasks (id) on delete set null,
  project_id uuid references public.ai_studio_projects (id) on delete set null,
  -- what the task was when it was reported (kept if the task or project changes later)
  task_title text not null,
  project_name text,
  assignment_type text not null default 'STANDARD' check (assignment_type in ('STANDARD', 'CROSS_TEAM')),
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_by_name text,
  task_status text,
  previous_progress integer check (previous_progress is null or previous_progress between 0 and 100),
  reported_progress integer check (reported_progress is null or reported_progress between 0 and 100),
  minutes_spent integer check (minutes_spent is null or minutes_spent between 0 and 1440),
  work_completed text check (work_completed is null or length(work_completed) <= 4000),
  blockers text check (blockers is null or length(blockers) <= 4000),
  next_action text check (next_action is null or length(next_action) <= 4000),
  position smallint not null default 0,
  legacy boolean not null default false,          -- made from a single-task report written before this migration
  progress_synced boolean not null default false,  -- the reported progress was written to the task
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ai_studio_report_entries_one_task on public.ai_studio_report_entries (report_id, task_id) where task_id is not null;
create index if not exists ai_studio_report_entries_task_idx on public.ai_studio_report_entries (task_id);
drop trigger if exists ai_studio_report_entries_set_updated_at on public.ai_studio_report_entries;
create trigger ai_studio_report_entries_set_updated_at before update on public.ai_studio_report_entries for each row execute function public.tg_set_updated_at();
alter table public.ai_studio_report_entries enable row level security;
revoke all on public.ai_studio_report_entries from public, anon, authenticated;

-- Older single-task reports: one entry each, from the report's own text (nothing is invented: a report that names no task gets no entry). Idempotent.
insert into public.ai_studio_report_entries (report_id, task_id, project_id, task_title, project_name, assignment_type, assigned_by, assigned_by_name,
                                             work_completed, blockers, next_action, legacy, created_at, updated_at)
select r.id, r.task_id, r.project_id, t.title, p.name, 'STANDARD', t.assigned_by, b.full_name, r.work_completed, r.blockers, r.pending_work, true, r.created_at, r.updated_at
  from public.ai_studio_daily_reports r
  join public.ai_studio_tasks t on t.id = r.task_id
  left join public.ai_studio_projects p on p.id = r.project_id
  left join public.profiles b on b.id = t.assigned_by
 where not r.consolidated and r.task_id is not null
on conflict (report_id, task_id) where task_id is not null do nothing;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- "<Team Lead>'s team" (a team in AI Studio is a Team Lead and the people who report to them)
create or replace function private.ai_studio_team_label(p_lead uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when p_lead is null then 'No Team Lead' else (select l.full_name || '''s team' from public.profiles l where l.id = p_lead) end
$$;
revoke all on function private.ai_studio_team_label(uuid) from public, anon, authenticated;

-- A person's open work, as counts only (no task of another team is described)
create or replace function private.ai_studio_workload(p_profile uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'active', count(*) filter (where t.status <> 'COMPLETED'),
    'highPriority', count(*) filter (where t.status <> 'COMPLETED' and t.priority in ('HIGH', 'URGENT')),
    'dueToday', count(*) filter (where t.status <> 'COMPLETED' and t.due_date = private.ai_studio_today()),
    'overdue', count(*) filter (where t.status <> 'COMPLETED' and t.due_date < private.ai_studio_today()),
    'crossTeam', count(*) filter (where t.status <> 'COMPLETED' and t.assignment_type = 'CROSS_TEAM'))
    from public.ai_studio_tasks t where t.assignee_id = p_profile
$$;
revoke all on function private.ai_studio_workload(uuid) from public, anon, authenticated;

-- Who may change a task (title, description, priority, deadline): the Managing Director and the Department Head; a Team Lead for a task they gave, or a
-- same-team task of their own member (the earlier rule); never the assignee, never the employee's own Team Lead for another team's (cross-team) task.
create or replace function private.ai_studio_can_edit_task(t public.ai_studio_tasks)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(t.status <> 'COMPLETED' and case private.ai_studio_role()
    when 'ADMIN' then true
    when 'HEAD' then true
    when 'LEAD' then t.assignee_id <> auth.uid()
                     and (t.assigned_by = auth.uid() or (t.assignment_type = 'STANDARD' and private.direct_lead_of(t.assignee_id) = auth.uid()))
    else false end, false)
$$;
revoke all on function private.ai_studio_can_edit_task(public.ai_studio_tasks) from public, anon, authenticated;

-- 20270105000100's task row + who owns it and whose team the employee is in
create or replace function private.ai_studio_task_row(t public.ai_studio_tasks)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'projectId', t.project_id, 'projectName', pr.name, 'title', t.title, 'description', t.description,
    'priority', t.priority, 'status', t.status, 'progress', t.progress, 'dueDate', t.due_date,
    'assignedAt', t.created_at, 'startedAt', t.started_at, 'completedAt', t.completed_at,
    'assigneeId', t.assignee_id, 'assigneeName', a.full_name, 'assignedById', t.assigned_by, 'assignedByName', b.full_name,
    'lastUpdateNote', t.last_update_note, 'lastUpdateAt', t.last_update_at, 'completionNote', t.completion_note,
    'attachments', t.attachments,
    'overdue', (t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < private.ai_studio_today()),
    'assignmentType', t.assignment_type,
    -- the project-owning team: the Team Lead who gave it (older tasks: their giver when a Team Lead)
    'ownerTeam', case when coalesce(t.owner_lead_id, case when b.role = 'TEAM_HEAD' then b.id end) is not null
                      then private.ai_studio_team_label(coalesce(t.owner_lead_id, case when b.role = 'TEAM_HEAD' then b.id end)) end,
    'assigneeTeam', case when a.role = 'TEAM_MEMBER' then private.ai_studio_team_label(private.direct_lead_of(a.id)) end,
    'assigneeTeamAtAssignment', case when t.assignee_lead_id is not null then private.ai_studio_team_label(t.assignee_lead_id) end)
    from public.ai_studio_projects pr
    join public.profiles a on a.id = t.assignee_id
    left join public.profiles b on b.id = t.assigned_by
   where pr.id = t.project_id
$$;
revoke all on function private.ai_studio_task_row(public.ai_studio_tasks) from public, anon;
grant execute on function private.ai_studio_task_row(public.ai_studio_tasks) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Cross-team assignment
-- ---------------------------------------------------------------------------
-- The people a task of this project can go to, grouped by team, with their open workload (counts only), today's approved leave and whether they
-- punched in. The Managing Director / the Department Head: everybody on the project (the earlier rule). A Team Lead: their own Team Members on the
-- project (standard) and, when the Team Lead is on the project, the Team Members of every other AI Studio team (cross-team). Active people only.
create or replace function public.ai_studio_assignees(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD']);
  v_me uuid := auth.uid();
  v_today date := private.ai_studio_today();
  pr public.ai_studio_projects;
  v_manages boolean;
begin
  select * into pr from public.ai_studio_projects where id = p_project;
  if pr.id is null then raise exception 'NOT_FOUND: Project not found.' using errcode = 'P0001'; end if;
  v_manages := v_role in ('ADMIN', 'HEAD') or private.ai_studio_on_project(p_project, v_me);
  return jsonb_build_object('projectId', pr.id, 'projectName', pr.name, 'managesProject', v_manages, 'canAssignCrossTeam', v_role = 'LEAD' and v_manages,
    'people', coalesce((
      select jsonb_agg(x order by (x ->> 'myTeam')::boolean desc, x ->> 'team', x ->> 'fullName')
        from (select jsonb_build_object(
                'id', p.id, 'fullName', p.full_name, 'avatarUrl', p.avatar_url, 'designation', nullif(p.position, ''), 'role', p.role,
                'primaryLeadId', l.lead, 'primaryLeadName', (select x.full_name from public.profiles x where x.id = l.lead),
                'team', private.ai_studio_team_label(l.lead), 'myTeam', v_role = 'LEAD' and l.lead is not distinct from v_me,
                'onProject', private.ai_studio_on_project(p_project, p.id),
                'assignmentType', case when v_role = 'LEAD' and l.lead is distinct from v_me then 'CROSS_TEAM' else 'STANDARD' end,
                'eligible', case when v_role = 'LEAD' then (l.lead = v_me and private.ai_studio_on_project(p_project, p.id)) or (l.lead is distinct from v_me and v_manages)
                                 else private.ai_studio_on_project(p_project, p.id) end,
                'reason', case
                  when v_role = 'LEAD' and l.lead = v_me and not private.ai_studio_on_project(p_project, p.id) then 'Not on this project: add them to it first.'
                  when v_role = 'LEAD' and l.lead is distinct from v_me and not v_manages then 'You can give other teams tasks only on projects you are on.'
                  when v_role <> 'LEAD' and not private.ai_studio_on_project(p_project, p.id) then 'Not on this project.' end,
                'workload', private.ai_studio_workload(p.id),
                'onLeaveToday', exists (select 1 from public.leave_requests lr where lr.employee_id = p.id and lr.status = 'APPROVED' and v_today between lr.start_date and lr.end_date),
                'punchedInToday', exists (select 1 from public.attendance_records ar where ar.profile_id = p.id and ar.attendance_date = v_today and ar.punch_in_at is not null)) as x
                from public.profiles p
                cross join lateral (select case when p.role = 'TEAM_MEMBER' then private.direct_lead_of(p.id) end as lead) l
               where p.status = 'ACTIVE' and p.department_id = private.ai_studio_department() and p.id <> v_me
                 and (p.role = 'TEAM_MEMBER' or (p.role = 'TEAM_HEAD' and v_role in ('ADMIN', 'HEAD')))) s), '[]'::jsonb));
end $$;
revoke all on function public.ai_studio_assignees(uuid) from public, anon;
grant execute on function public.ai_studio_assignees(uuid) to authenticated;

-- 20270105000100 + the cross-team branch (the type is worked out here, never taken from the browser)
create or replace function public.ai_studio_task_assign(
  p_project uuid, p_assignee uuid, p_title text, p_description text, p_priority text, p_due date, p_links jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD']);
  v_me uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_priority text := coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'MEDIUM');
  pr public.ai_studio_projects;
  a public.profiles;
  v_lead uuid;
  v_cross boolean;
  t public.ai_studio_tasks;
  v_by text;
begin
  if length(v_title) < 1 or length(v_title) > 200 then raise exception 'VALIDATION_ERROR: Enter the task title (up to 200 characters).' using errcode = 'P0001'; end if;
  if v_desc is not null and length(v_desc) > 4000 then raise exception 'VALIDATION_ERROR: The description can have at most 4000 characters.' using errcode = 'P0001'; end if;
  if v_priority not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT') then raise exception 'VALIDATION_ERROR: Unknown priority.' using errcode = 'P0001'; end if;
  if p_due is not null and p_due < private.ai_studio_today() then raise exception 'VALIDATION_ERROR: The deadline cannot be in the past.' using errcode = 'P0001'; end if;
  select * into pr from public.ai_studio_projects where id = p_project;
  if pr.id is null then raise exception 'NOT_FOUND: Project not found.' using errcode = 'P0001'; end if;
  if pr.status <> 'ACTIVE' then raise exception 'VALIDATION_ERROR: "%" is not active, so no task can be added to it.', pr.name using errcode = 'P0001'; end if;
  select * into a from public.profiles where id = p_assignee;
  if a.id is null or a.status <> 'ACTIVE' or a.department_id is distinct from private.ai_studio_department() or a.role not in ('TEAM_HEAD', 'TEAM_MEMBER') then
    raise exception 'VALIDATION_ERROR: Choose an active Team Lead or Team Member of AI Studio.' using errcode = 'P0001';
  end if;
  v_lead := case when a.role = 'TEAM_MEMBER' then private.direct_lead_of(a.id) end;
  -- a Team Lead's task for somebody else's Team Member is cross-team; the Department Head's and the Managing Director's are not
  v_cross := v_role = 'LEAD' and a.role = 'TEAM_MEMBER' and v_lead is distinct from v_me;
  if v_role = 'LEAD' then
    if a.role <> 'TEAM_MEMBER' then
      raise exception 'FORBIDDEN: A Team Lead gives tasks to Team Members.' using errcode = '42501';
    end if;
    if v_cross and not private.ai_studio_on_project(p_project, v_me) then
      raise exception 'FORBIDDEN: You can give another team''s member a task only on a project you are on.' using errcode = '42501';
    end if;
  end if;
  -- a same-team task keeps the earlier rule (the person is on the project); a cross-team task gives access to that one task only
  if not v_cross and not private.ai_studio_on_project(p_project, a.id) then
    raise exception 'VALIDATION_ERROR: % is not on "%". Add them to the project first.', a.full_name, pr.name using errcode = 'P0001';
  end if;

  insert into public.ai_studio_tasks (project_id, title, description, priority, assigned_by, assignee_id, due_date, attachments,
                                      assignment_type, owner_lead_id, assignee_lead_id, assignee_team_id)
  values (p_project, v_title, v_desc, v_priority, v_me, a.id, p_due, coalesce(private.ai_studio_links(p_links), '[]'::jsonb),
          case when v_cross then 'CROSS_TEAM' else 'STANDARD' end, case when v_role = 'LEAD' then v_me end, v_lead, a.team_id)
  returning * into t;
  select full_name into v_by from public.profiles where id = v_me;
  insert into public.ai_studio_task_updates (task_id, author_id, author_name, kind, status, progress, note, details)
  values (t.id, v_me, v_by, 'ASSIGNED', 'ASSIGNED', 0,
          case when v_cross then format('Cross-team task from %s for a member of %s.', private.ai_studio_team_label(v_me), private.ai_studio_team_label(v_lead)) end,
          jsonb_build_object('assignmentType', t.assignment_type, 'assignee', a.full_name, 'assigneeTeam', private.ai_studio_team_label(v_lead),
                             'priority', t.priority, 'dueDate', t.due_date));
  perform private.write_audit(case when v_cross then 'AI_STUDIO_TASK_ASSIGNED_CROSS_TEAM' else 'AI_STUDIO_TASK_ASSIGNED' end, 'ai_studio_task', t.id, a.department_id, a.team_id,
    jsonb_build_object('assignee', a.id, 'project', p_project, 'title', v_title, 'assignmentType', t.assignment_type, 'assigneeLead', v_lead));
  if v_cross then
    perform private.notify(a.id, 'AI_STUDIO_TASK_ASSIGNED_CROSS_TEAM', 'New Cross-Team Task Assigned',
      format('You have been assigned "%s" under the "%s" project by %s. Deadline: %s · Priority: %s', v_title, pr.name, v_by,
             coalesce(to_char(p_due, 'DD Mon YYYY'), 'not set'), initcap(lower(v_priority))), 'ai_studio_task', t.id);
    if v_lead is not null then
      perform private.notify(v_lead, 'AI_STUDIO_CROSS_TEAM_ASSIGNMENT', 'Cross-Team Assignment — Team Member',
        format('%s from your team has been assigned a task by %s from %s. Project: %s · Task: %s · Deadline: %s. Please consider this assignment while planning your team''s workload.',
               a.full_name, v_by, private.ai_studio_team_label(v_me), pr.name, v_title, coalesce(to_char(p_due, 'DD Mon YYYY'), 'not set')), 'ai_studio_task', t.id);
    end if;
  else
    perform private.notify(a.id, 'AI_STUDIO_TASK_ASSIGNED', format('New task: %s', v_title),
      format('%s · assigned by %s%s', pr.name, v_by, case when p_due is null then '' else format(' · due %s', to_char(p_due, 'DD Mon')) end), 'ai_studio_task', t.id);
    -- the Department Head gave a Team Member work: their Team Lead is told as well
    if v_lead is not null and v_lead is distinct from v_me then
      perform private.notify(v_lead, 'AI_STUDIO_TASK_ASSIGNED_TEAM', format('%s got a task: %s', a.full_name, v_title), format('%s · assigned by %s', pr.name, v_by), 'ai_studio_task', t.id);
    end if;
  end if;
  return private.ai_studio_task_row(t);
end $$;
revoke all on function public.ai_studio_task_assign(uuid, uuid, text, text, text, date, jsonb) from public, anon;
grant execute on function public.ai_studio_task_assign(uuid, uuid, text, text, text, date, jsonb) to authenticated;

-- 20270105000100 + who may change it (private.ai_studio_can_edit_task), the before / after values, and the employee's Team Lead told about a cross-team
-- task's new deadline or priority
create or replace function public.ai_studio_task_edit(p_task uuid, p_title text, p_description text, p_priority text, p_due date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD']);
  v_me uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_priority text := coalesce(nullif(btrim(coalesce(p_priority, '')), ''), 'MEDIUM');
  t public.ai_studio_tasks;
  o public.ai_studio_tasks;
  v_by text;
  v_changes jsonb := '{}'::jsonb;
  v_notes text[] := '{}';
  v_lead uuid;
begin
  select * into t from public.ai_studio_tasks where id = p_task for update;
  if t.id is null or not private.ai_studio_can_see_task(t) or (v_role = 'LEAD' and t.assignee_id = v_me) then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0001';
  end if;
  if t.status = 'COMPLETED' then raise exception 'CONFLICT: A completed task cannot be changed.' using errcode = 'P0001'; end if;
  if not private.ai_studio_can_edit_task(t) then
    raise exception 'FORBIDDEN: Only the Team Lead who gave this cross-team task (or the Department Head) can change it.' using errcode = '42501';
  end if;
  if length(v_title) < 1 or length(v_title) > 200 then raise exception 'VALIDATION_ERROR: Enter the task title (up to 200 characters).' using errcode = 'P0001'; end if;
  if v_desc is not null and length(v_desc) > 4000 then raise exception 'VALIDATION_ERROR: The description can have at most 4000 characters.' using errcode = 'P0001'; end if;
  if v_priority not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT') then raise exception 'VALIDATION_ERROR: Unknown priority.' using errcode = 'P0001'; end if;
  if p_due is not null and p_due is distinct from t.due_date and p_due < private.ai_studio_today() then
    raise exception 'VALIDATION_ERROR: The deadline cannot be in the past.' using errcode = 'P0001';
  end if;
  o := t;
  if o.title is distinct from v_title then v_changes := v_changes || jsonb_build_object('title', jsonb_build_object('from', o.title, 'to', v_title)); end if;
  if o.description is distinct from v_desc then v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('from', o.description, 'to', v_desc)); end if;
  if o.priority is distinct from v_priority then
    v_changes := v_changes || jsonb_build_object('priority', jsonb_build_object('from', o.priority, 'to', v_priority));
    v_notes := v_notes || format('Priority changed from %s to %s.', initcap(lower(o.priority)), initcap(lower(v_priority)));
  end if;
  if o.due_date is distinct from p_due then
    v_changes := v_changes || jsonb_build_object('dueDate', jsonb_build_object('from', o.due_date, 'to', p_due));
    v_notes := v_notes || format('Deadline changed from %s to %s.', coalesce(to_char(o.due_date, 'DD Mon YYYY'), 'none'), coalesce(to_char(p_due, 'DD Mon YYYY'), 'none'));
  end if;
  if v_changes = '{}'::jsonb then
    return private.ai_studio_task_row(t);   -- nothing changed (a second click)
  end if;
  update public.ai_studio_tasks set title = v_title, description = v_desc, priority = v_priority, due_date = p_due where id = t.id returning * into t;
  select full_name into v_by from public.profiles where id = v_me;
  insert into public.ai_studio_task_updates (task_id, author_id, author_name, kind, status, progress, note, details)
  values (t.id, v_me, v_by, 'EDITED', t.status, t.progress, coalesce(nullif(array_to_string(v_notes, ' '), ''), 'Task details changed.'), v_changes);
  if o.due_date is distinct from p_due then
    perform private.notify(t.assignee_id, 'AI_STUDIO_TASK_DEADLINE', format('Deadline updated: %s', t.title),
      format('%s is now %s.', 'The deadline', coalesce(to_char(p_due, 'DD Mon YYYY'), 'not set')), 'ai_studio_task', t.id);
  end if;
  if o.priority is distinct from v_priority then
    perform private.notify(t.assignee_id, 'AI_STUDIO_TASK_PRIORITY', format('Priority updated: %s', t.title),
      format('The priority is now %s.', initcap(lower(v_priority))), 'ai_studio_task', t.id);
  end if;
  -- a cross-team task: the employee's own Team Lead plans their workload with it
  v_lead := private.direct_lead_of(t.assignee_id);
  if t.assignment_type = 'CROSS_TEAM' and v_lead is not null and v_lead is distinct from v_me and (o.due_date is distinct from p_due or o.priority is distinct from v_priority) then
    perform private.notify(v_lead, 'AI_STUDIO_CROSS_TEAM_CHANGED', format('Cross-team task changed: %s', t.title),
      format('%s · %s', (select full_name from public.profiles where id = t.assignee_id), array_to_string(v_notes, ' ')), 'ai_studio_task', t.id);
  end if;
  perform private.write_audit('AI_STUDIO_TASK_EDITED', 'ai_studio_task', t.id, private.ai_studio_department(), null, jsonb_build_object('changes', v_changes));
  return private.ai_studio_task_row(t);
end $$;
revoke all on function public.ai_studio_task_edit(uuid, text, text, text, date) from public, anon;
grant execute on function public.ai_studio_task_edit(uuid, text, text, text, date) to authenticated;

-- 20270105000100 + who may change it, the daily report entries about this task (whoever reads the task reads them: the assignee, the Team Lead who gave it,
-- the employee's Team Lead, the Department Head, the Managing Director - never the rest of the employee's report), and each history step's values
create or replace function public.ai_studio_task_get(p_task uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.ai_studio_tasks;
begin
  perform private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD', 'MEMBER']);
  select * into t from public.ai_studio_tasks where id = p_task;
  if t.id is null or not private.ai_studio_can_see_task(t) then raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0001'; end if;
  return private.ai_studio_task_row(t) || jsonb_build_object(
    'canUpdate', t.assignee_id = auth.uid() and t.status <> 'COMPLETED',
    'canEdit', private.ai_studio_can_edit_task(t),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'status', u.status, 'progress', u.progress, 'note', u.note,
                                                               'authorName', u.author_name, 'createdAt', u.created_at, 'details', u.details, 'reportId', u.report_id) order by u.seq desc)
                           from public.ai_studio_task_updates u where u.task_id = t.id), '[]'::jsonb),
    'reportEntries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'reportId', r.id, 'reportDate', r.report_date, 'reportStatus', r.status,
                                 'authorName', r.author_name, 'previousProgress', e.previous_progress, 'reportedProgress', e.reported_progress,
                                 'minutesSpent', e.minutes_spent, 'workCompleted', e.work_completed, 'blockers', e.blockers, 'nextAction', e.next_action,
                                 'legacy', e.legacy) order by r.report_date desc, e.created_at desc)
                               from public.ai_studio_report_entries e join public.ai_studio_daily_reports r on r.id = e.report_id
                              where e.task_id = t.id and r.status <> 'DRAFT'), '[]'::jsonb));
end $$;
revoke all on function public.ai_studio_task_get(uuid) from public, anon;
grant execute on function public.ai_studio_task_get(uuid) to authenticated;

-- The task lists (20270105000100) + "my team / cross-team" and "overdue", under a name of their own (ai_studio_tasks_page), so the earlier
-- ai_studio_tasks_list keeps its exact signature (an added argument would make a second version of it, and a call that names six arguments ambiguous).
-- A development database that ran an earlier draft of this file may hold a seven-argument ai_studio_tasks_list: it goes.
drop function if exists public.ai_studio_tasks_list(text, uuid, text, uuid, integer, integer, text);
create or replace function public.ai_studio_tasks_page(
  p_scope text default 'mine', p_project uuid default null, p_status text default null, p_assignee uuid default null, p_page integer default 1,
  p_page_size integer default 25, p_kind text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
  v_today date := private.ai_studio_today();
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_total bigint;
  v_items jsonb;
begin
  if p_scope not in ('mine', 'ongoing', 'team') then raise exception 'VALIDATION_ERROR: Unknown task list.' using errcode = 'P0001'; end if;
  if p_status is not null and p_status not in ('ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'OPEN', 'OVERDUE') then raise exception 'VALIDATION_ERROR: Unknown task status.' using errcode = 'P0001'; end if;
  if p_kind is not null and p_kind not in ('STANDARD', 'CROSS_TEAM') then raise exception 'VALIDATION_ERROR: Unknown assignment type.' using errcode = 'P0001'; end if;
  if p_scope = 'team' and v_role = 'MEMBER' then raise exception 'FORBIDDEN: Team tasks are for Team Leads and the Department Head.' using errcode = '42501'; end if;
  select count(*) into v_total from public.ai_studio_tasks t
   where private.ai_studio_can_see_task(t)
             and (p_scope = 'team' or t.assignee_id = v_me)
             and (p_scope <> 'ongoing' or t.status in ('IN_PROGRESS', 'ON_HOLD'))
             and (p_project is null or t.project_id = p_project)
             and (p_status is null or t.status = p_status or (p_status = 'OPEN' and t.status <> 'COMPLETED')
                  or (p_status = 'OVERDUE' and t.status <> 'COMPLETED' and t.due_date < v_today))
             and (p_assignee is null or t.assignee_id = p_assignee)
             and (p_kind is null or t.assignment_type = p_kind);
  select coalesce(jsonb_agg(private.ai_studio_task_row(x) order by (x.status = 'COMPLETED'), x.due_date nulls last, x.created_at desc), '[]'::jsonb) into v_items
    from (select t.* from public.ai_studio_tasks t
           where private.ai_studio_can_see_task(t)
             and (p_scope = 'team' or t.assignee_id = v_me)
             and (p_scope <> 'ongoing' or t.status in ('IN_PROGRESS', 'ON_HOLD'))
             and (p_project is null or t.project_id = p_project)
             and (p_status is null or t.status = p_status or (p_status = 'OPEN' and t.status <> 'COMPLETED')
                  or (p_status = 'OVERDUE' and t.status <> 'COMPLETED' and t.due_date < v_today))
             and (p_assignee is null or t.assignee_id = p_assignee)
             and (p_kind is null or t.assignment_type = p_kind)
           order by (t.status = 'COMPLETED'), t.due_date nulls last, t.created_at desc
           limit v_size offset (v_page - 1) * v_size) x;
  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.ai_studio_tasks_page(text, uuid, text, uuid, integer, integer, text) from public, anon;
grant execute on function public.ai_studio_tasks_page(text, uuid, text, uuid, integer, integer, text) to authenticated;

-- the earlier list, same arguments, now with "overdue" too (it reads through the page above)
create or replace function public.ai_studio_tasks_list(
  p_scope text default 'mine', p_project uuid default null, p_status text default null, p_assignee uuid default null, p_page integer default 1, p_page_size integer default 25)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.ai_studio_tasks_page(p_scope, p_project, p_status, p_assignee, p_page, p_page_size, null)
$$;
revoke all on function public.ai_studio_tasks_list(text, uuid, text, uuid, integer, integer) from public, anon;
grant execute on function public.ai_studio_tasks_list(text, uuid, text, uuid, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Daily report: one per person and day, one entry per task
-- ---------------------------------------------------------------------------
-- What the form needs for a date: who is writing, the tasks they may report on (open on that day, or completed that day or later, cross-team ones
-- included), the report already started for that date, and the net hours their attendance recorded (to warn, never to block).
create or replace function public.ai_studio_daily_context(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
  v_tz constant text := 'Asia/Kolkata';
  v_today date := private.ai_studio_today();
  v_date date := coalesce(p_date, private.ai_studio_today());
  me public.profiles;
  v_lead uuid;
  a public.attendance_records;
  v_worked integer;
  r public.ai_studio_daily_reports;
begin
  if v_date > v_today then raise exception 'VALIDATION_ERROR: The report date cannot be in the future.' using errcode = 'P0001'; end if;
  if v_date < v_today - 60 then raise exception 'VALIDATION_ERROR: A report can be written for the last 60 days only.' using errcode = 'P0001'; end if;
  select * into me from public.profiles where id = v_me;
  v_lead := case when v_role = 'MEMBER' then private.direct_lead_of(v_me) end;
  -- net working minutes from attendance (punch in to punch out, or now for today, less breaks); nothing when there is no punch
  select * into a from public.attendance_records x where x.profile_id = v_me and x.attendance_date = v_date;
  if a.punch_in_at is not null and (a.punch_out_at is not null or v_date = v_today) then
    v_worked := greatest(0, floor(extract(epoch from (coalesce(a.punch_out_at, now()) - a.punch_in_at)) / 60)::integer
      - coalesce((select floor(sum(extract(epoch from (coalesce(l.ended_at, now()) - l.started_at))) / 60)::integer
                    from public.attendance_lunches l where l.profile_id = v_me and l.attendance_date = v_date), 0));
  end if;
  select * into r from public.ai_studio_daily_reports x where x.author_id = v_me and x.report_date = v_date and x.consolidated;
  return jsonb_build_object(
    'date', v_date, 'today', v_today, 'role', v_role,
    'me', jsonb_build_object('name', me.full_name, 'department', (select d.name from public.departments d where d.id = me.department_id),
                             'team', case when v_role = 'MEMBER' then private.ai_studio_team_label(v_lead) else private.ai_studio_team_label(v_me) end),
    'reviewer', case when v_role = 'MEMBER' and v_lead is not null then (select l.full_name from public.profiles l where l.id = v_lead) else 'the Department Head' end,
    'route', case when v_role = 'MEMBER' and v_lead is not null then 'TEAM_LEAD' else 'DIRECT' end,
    'workedMinutes', v_worked,
    'report', case when r.id is not null then private.ai_studio_report_detail(r) end,
    'legacyReports', (select count(*) from public.ai_studio_daily_reports x where x.author_id = v_me and x.report_date = v_date and not x.consolidated),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'projectId', t.project_id, 'projectName', pr.name, 'status', t.status, 'progress', t.progress,
               'priority', t.priority, 'dueDate', t.due_date, 'assignmentType', t.assignment_type, 'assignedByName', b.full_name,
               'ownerTeam', case when coalesce(t.owner_lead_id, case when b.role = 'TEAM_HEAD' then b.id end) is not null
                                 then private.ai_studio_team_label(coalesce(t.owner_lead_id, case when b.role = 'TEAM_HEAD' then b.id end)) end,
               'completedAt', t.completed_at) order by pr.name, (t.status = 'COMPLETED'), t.due_date nulls last, t.title)
        from public.ai_studio_tasks t
        join public.ai_studio_projects pr on pr.id = t.project_id
        left join public.profiles b on b.id = t.assigned_by
       where t.assignee_id = v_me and (t.created_at at time zone v_tz)::date <= v_date
         and (t.status <> 'COMPLETED' or (t.completed_at at time zone v_tz)::date >= v_date)), '[]'::jsonb));
end $$;
revoke all on function public.ai_studio_daily_context(date) from public, anon;
grant execute on function public.ai_studio_daily_context(date) to authenticated;

-- Save (draft) or submit the day's report. p_entries: [{taskId, workCompleted, minutesSpent, reportedProgress, blockers, nextAction}]. All or nothing: one
-- transaction, the first problem is named with the task's number in the form ("Task 2: ..."). A second click finds the same report (one per day).
create or replace function public.ai_studio_daily_report_save(
  p_id uuid, p_date date, p_summary text, p_additional text, p_blockers text, p_tomorrow text, p_entries jsonb, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
  v_tz constant text := 'Asia/Kolkata';
  v_today date := private.ai_studio_today();
  v_summary text := nullif(btrim(coalesce(p_summary, '')), '');
  v_additional text := nullif(btrim(coalesce(p_additional, '')), '');
  v_blockers text := nullif(btrim(coalesce(p_blockers, '')), '');
  v_tomorrow text := nullif(btrim(coalesce(p_tomorrow, '')), '');
  v_entries jsonb := coalesce(p_entries, '[]'::jsonb);
  v_ids uuid[] := '{}';
  v_n integer := 0;
  e record;
  t public.ai_studio_tasks;
  me public.profiles;
  r public.ai_studio_daily_reports;
  v_task_id uuid;
  v_work text;
  v_block text;
  v_next text;
  v_minutes integer;
  v_progress integer;
  v_total integer := 0;
  v_from text;
  v_action text;
  v_lead uuid;
  v_label text;
  v_primary uuid;
  x record;
begin
  select * into me from public.profiles where id = v_me;
  if p_date is null then raise exception 'VALIDATION_ERROR: Choose the report date.' using errcode = 'P0001'; end if;
  if p_date > v_today then raise exception 'VALIDATION_ERROR: The report date cannot be in the future.' using errcode = 'P0001'; end if;
  if p_date < v_today - 60 then raise exception 'VALIDATION_ERROR: A report can be written for the last 60 days only.' using errcode = 'P0001'; end if;
  if greatest(length(coalesce(v_summary, '')), length(coalesce(v_additional, '')), length(coalesce(v_blockers, '')), length(coalesce(v_tomorrow, ''))) > 4000 then
    raise exception 'VALIDATION_ERROR: Each part of the report can have at most 4000 characters.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_entries) <> 'array' then raise exception 'VALIDATION_ERROR: The tasks of the report could not be read.' using errcode = 'P0001'; end if;
  if jsonb_array_length(v_entries) > 25 then raise exception 'VALIDATION_ERROR: A daily report can name at most 25 tasks.' using errcode = 'P0001'; end if;
  if p_submit and jsonb_array_length(v_entries) = 0 then raise exception 'VALIDATION_ERROR: Choose at least one task you worked on.' using errcode = 'P0001'; end if;
  if p_submit and (v_summary is null or length(v_summary) < 3) then raise exception 'VALIDATION_ERROR: Write the overall summary of the day before you submit.' using errcode = 'P0001'; end if;

  -- the tasks: read and lock them once (in id order, so two reports never wait on each other), then check every entry
  for e in select value as v, ordinality as n from jsonb_array_elements(v_entries) with ordinality loop
    begin
      v_task_id := (e.v ->> 'taskId')::uuid;
    exception when others then
      raise exception 'VALIDATION_ERROR: Task %: choose the task again.', e.n using errcode = 'P0001';
    end;
    if v_task_id is null then raise exception 'VALIDATION_ERROR: Task %: choose the task again.', e.n using errcode = 'P0001'; end if;
    if v_task_id = any(v_ids) then raise exception 'VALIDATION_ERROR: Task %: this task is already in the report once.', e.n using errcode = 'P0001'; end if;
    v_ids := v_ids || v_task_id;
  end loop;
  perform 1 from public.ai_studio_tasks where id = any(v_ids) order by id for update;

  for e in select value as v, ordinality as n from jsonb_array_elements(v_entries) with ordinality loop
    select * into t from public.ai_studio_tasks where id = (e.v ->> 'taskId')::uuid;
    if t.id is null or t.assignee_id <> v_me then
      raise exception 'VALIDATION_ERROR: Task %: this is not one of your tasks.', e.n using errcode = 'P0001';
    end if;
    if (t.created_at at time zone v_tz)::date > p_date then
      raise exception 'VALIDATION_ERROR: Task % ("%"): it was assigned after this date.', e.n, t.title using errcode = 'P0001';
    end if;
    if t.status = 'COMPLETED' and (t.completed_at at time zone v_tz)::date < p_date then
      raise exception 'VALIDATION_ERROR: Task % ("%"): it was completed before this date.', e.n, t.title using errcode = 'P0001';
    end if;
    v_work := nullif(btrim(coalesce(e.v ->> 'workCompleted', '')), '');
    v_block := nullif(btrim(coalesce(e.v ->> 'blockers', '')), '');
    v_next := nullif(btrim(coalesce(e.v ->> 'nextAction', '')), '');
    if greatest(length(coalesce(v_work, '')), length(coalesce(v_block, '')), length(coalesce(v_next, ''))) > 4000 then
      raise exception 'VALIDATION_ERROR: Task % ("%"): each part can have at most 4000 characters.', e.n, t.title using errcode = 'P0001';
    end if;
    begin
      v_minutes := nullif(e.v ->> 'minutesSpent', '')::integer;
      v_progress := nullif(e.v ->> 'reportedProgress', '')::integer;
    exception when others then
      raise exception 'VALIDATION_ERROR: Task % ("%"): enter the time and the progress as numbers.', e.n, t.title using errcode = 'P0001';
    end;
    if v_minutes is not null and (v_minutes < 1 or v_minutes > 1440) then
      raise exception 'VALIDATION_ERROR: Task % ("%"): the time spent is between 1 minute and 24 hours.', e.n, t.title using errcode = 'P0001';
    end if;
    -- a completed task is reported at 100%; an open one moves at most to 99% here (completing it is its own step, with completion details)
    if t.status = 'COMPLETED' then
      v_progress := 100;
    elsif v_progress is not null and (v_progress < 0 or v_progress > 99) then
      raise exception 'VALIDATION_ERROR: Task % ("%"): progress here is 0 to 99%%. Complete the task from the task itself, with its completion details.', e.n, t.title using errcode = 'P0001';
    end if;
    if p_submit then
      if v_work is null or length(v_work) < 3 then
        raise exception 'VALIDATION_ERROR: Task % ("%"): describe the work done on it today.', e.n, t.title using errcode = 'P0001';
      end if;
      if v_minutes is null then
        raise exception 'VALIDATION_ERROR: Task % ("%"): enter the time spent on it.', e.n, t.title using errcode = 'P0001';
      end if;
      if v_progress is null then
        raise exception 'VALIDATION_ERROR: Task % ("%"): enter its progress.', e.n, t.title using errcode = 'P0001';
      end if;
    end if;
    v_total := v_total + coalesce(v_minutes, 0);
  end loop;
  if v_total > 1440 then raise exception 'VALIDATION_ERROR: The time spent adds up to more than 24 hours.' using errcode = 'P0001'; end if;

  -- the report itself (one per person and day)
  if p_id is null then
    select * into r from public.ai_studio_daily_reports where author_id = v_me and report_date = p_date and consolidated for update;
  else
    select * into r from public.ai_studio_daily_reports where id = p_id for update;
    if r.id is null or r.author_id <> v_me or not r.consolidated then raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001'; end if;
  end if;
  if r.id is not null and r.status not in ('DRAFT', 'RETURNED_BY_TL', 'RETURNED_BY_DH') then
    raise exception 'CONFLICT: Your daily report for % is already submitted. Open it from My Daily Reports.', to_char(r.report_date, 'DD Mon YYYY') using errcode = 'P0001';
  end if;
  if r.id is null then
    begin
      insert into public.ai_studio_daily_reports (author_id, author_name, author_role, project_id, task_id, report_date, work_completed, remarks, blockers, pending_work, status, consolidated, total_minutes)
      values (v_me, me.full_name, v_role, null, null, p_date, v_summary, v_additional, v_blockers, v_tomorrow, 'DRAFT', true, v_total)
      returning * into r;
    exception when unique_violation then
      raise exception 'CONFLICT: You already have a daily report for %. Open it from My Daily Reports.', to_char(p_date, 'DD Mon YYYY') using errcode = 'P0001';
    end;
    perform private.ai_studio_event(r, 'CREATED', null, null, null);
  else
    begin
      update public.ai_studio_daily_reports set report_date = p_date, work_completed = v_summary, remarks = v_additional, blockers = v_blockers, pending_work = v_tomorrow,
             total_minutes = v_total where id = r.id returning * into r;
    exception when unique_violation then
      raise exception 'CONFLICT: You already have a daily report for %. Open it from My Daily Reports.', to_char(p_date, 'DD Mon YYYY') using errcode = 'P0001';
    end;
  end if;

  -- the entries: those taken out of the report go, the others are written (each task once)
  delete from public.ai_studio_report_entries where report_id = r.id and (task_id is null or task_id <> all(v_ids));
  for e in select value as v, ordinality as n from jsonb_array_elements(v_entries) with ordinality loop
    select * into t from public.ai_studio_tasks where id = (e.v ->> 'taskId')::uuid;
    insert into public.ai_studio_report_entries (report_id, task_id, project_id, task_title, project_name, assignment_type, assigned_by, assigned_by_name, task_status,
                                                 previous_progress, reported_progress, minutes_spent, work_completed, blockers, next_action, position)
    values (r.id, t.id, t.project_id, t.title, (select p.name from public.ai_studio_projects p where p.id = t.project_id), t.assignment_type, t.assigned_by,
            (select b.full_name from public.profiles b where b.id = t.assigned_by), t.status, t.progress,
            case when t.status = 'COMPLETED' then 100 else nullif(e.v ->> 'reportedProgress', '')::integer end,
            nullif(e.v ->> 'minutesSpent', '')::integer, nullif(btrim(coalesce(e.v ->> 'workCompleted', '')), ''),
            nullif(btrim(coalesce(e.v ->> 'blockers', '')), ''), nullif(btrim(coalesce(e.v ->> 'nextAction', '')), ''), e.n)
    on conflict (report_id, task_id) where task_id is not null do update
      set task_title = excluded.task_title, project_id = excluded.project_id, project_name = excluded.project_name, assignment_type = excluded.assignment_type,
          assigned_by = excluded.assigned_by, assigned_by_name = excluded.assigned_by_name, task_status = excluded.task_status,
          previous_progress = excluded.previous_progress, reported_progress = excluded.reported_progress, minutes_spent = excluded.minutes_spent,
          work_completed = excluded.work_completed, blockers = excluded.blockers, next_action = excluded.next_action, position = excluded.position, progress_synced = false;
  end loop;

  if p_submit then
    v_from := r.status;
    v_action := case when v_from in ('RETURNED_BY_TL', 'RETURNED_BY_DH') then 'RESUBMITTED' else 'SUBMITTED' end;
    -- the same route as every daily report: a Team Member with a Team Lead goes through them; otherwise straight to the Department Head
    if v_role = 'MEMBER' then v_lead := private.direct_lead_of(v_me); end if;
    update public.ai_studio_daily_reports
       set status = case when v_lead is not null then 'PENDING_TL_APPROVAL' else 'PENDING_DH_APPROVAL' end,
           lead_id = v_lead, lead_name = (select l.full_name from public.profiles l where l.id = v_lead),
           revision = case when v_action = 'RESUBMITTED' then revision + 1 else revision end,
           tl_reviewed_by = null, tl_reviewed_at = null, tl_comment = null, dh_reviewed_by = null, dh_reviewed_at = null, dh_comment = null,
           submitted_at = now(), approved_at = null
     where id = r.id returning * into r;
    perform private.ai_studio_event(r, v_action, null, v_from, case when v_role = 'MEMBER' and v_lead is null then 'No Team Lead is assigned: sent straight to the Department Head.' end);
    v_label := format('%s task%s · %s', jsonb_array_length(v_entries), case when jsonb_array_length(v_entries) = 1 then '' else 's' end, to_char(r.report_date, 'DD Mon YYYY'));
    if v_lead is not null then
      perform private.notify(v_lead, 'AI_STUDIO_REPORT_SUBMITTED', format('Daily report to review: %s', me.full_name),
        v_label || case when v_action = 'RESUBMITTED' then ' · resubmitted' else '' end, 'ai_studio_report', r.id);
    else
      perform private.notify(h, 'AI_STUDIO_REPORT_PENDING_HEAD', format('Daily report to review: %s', me.full_name),
        format('%s · %s', case when v_role = 'MEMBER' then 'No Team Lead assigned' else 'Team Lead' end, v_label), 'ai_studio_report', r.id) from private.ai_studio_head_ids() h;
    end if;

    -- each task: the report is linked in its history; its progress follows the report only upwards (a stale report never lowers newer progress) and
    -- never completes it; a blocker is told to the Team Lead who gave the task (and, for a cross-team task, the employee's own Team Lead)
    for x in select en.id as entry_id, en.reported_progress, en.work_completed, en.blockers, en.minutes_spent, tk.*
               from public.ai_studio_report_entries en join public.ai_studio_tasks tk on tk.id = en.task_id
              where en.report_id = r.id order by en.position loop
      if x.status <> 'COMPLETED' and x.reported_progress is not null and x.reported_progress > x.progress then
        update public.ai_studio_tasks
           set progress = x.reported_progress, status = case when status = 'ASSIGNED' then 'IN_PROGRESS' else status end,
               started_at = coalesce(started_at, now()), last_update_note = left('Daily report: ' || coalesce(x.work_completed, ''), 2000), last_update_at = now()
         where id = x.id;
        update public.ai_studio_report_entries set progress_synced = true where id = x.entry_id;
      end if;
      insert into public.ai_studio_task_updates (task_id, author_id, author_name, kind, status, progress, note, details, report_id)
      select tk.id, v_me, me.full_name, 'REPORT', tk.status, tk.progress,
             left(format('Daily report of %s%s: %s', to_char(r.report_date, 'DD Mon YYYY'),
                         case when x.minutes_spent is not null then format(' (%s h %s min)', x.minutes_spent / 60, x.minutes_spent % 60) else '' end, coalesce(x.work_completed, '')), 2000),
             jsonb_build_object('progressFrom', x.progress, 'progressTo', tk.progress, 'reported', x.reported_progress, 'minutes', x.minutes_spent), r.id
        from public.ai_studio_tasks tk where tk.id = x.id;
      if x.blockers is not null then
        insert into public.ai_studio_task_updates (task_id, author_id, author_name, kind, status, progress, note, report_id)
        select tk.id, v_me, me.full_name, 'BLOCKER', tk.status, tk.progress, left(x.blockers, 2000), r.id from public.ai_studio_tasks tk where tk.id = x.id;
        if x.assigned_by is not null and x.assigned_by <> v_me then
          perform private.notify(x.assigned_by, 'AI_STUDIO_TASK_BLOCKER', format('Blocker reported: %s', x.title), format('%s: %s', me.full_name, left(x.blockers, 200)), 'ai_studio_task', x.id);
        end if;
        v_primary := case when x.assignment_type = 'CROSS_TEAM' then private.direct_lead_of(v_me) end;
        if v_primary is not null and v_primary is distinct from x.assigned_by then
          perform private.notify(v_primary, 'AI_STUDIO_TASK_BLOCKER', format('Blocker reported: %s', x.title), format('%s (cross-team task): %s', me.full_name, left(x.blockers, 200)), 'ai_studio_task', x.id);
        end if;
      end if;
    end loop;
  end if;
  perform private.write_audit(case when p_submit then 'AI_STUDIO_DAILY_REPORT_SUBMITTED' else 'AI_STUDIO_DAILY_REPORT_SAVED' end, 'ai_studio_report', r.id, me.department_id, me.team_id,
    jsonb_build_object('date', r.report_date, 'tasks', jsonb_array_length(v_entries), 'minutes', v_total, 'revision', r.revision));
  return private.ai_studio_report_detail(r);
end $$;
revoke all on function public.ai_studio_daily_report_save(uuid, date, text, text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.ai_studio_daily_report_save(uuid, date, text, text, text, text, jsonb, boolean) to authenticated;

-- A report in a list: a consolidated report has no single project (its projects are named instead) and says how many tasks and minutes it holds
create or replace function private.ai_studio_report_row(r public.ai_studio_daily_reports)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'authorId', r.author_id, 'authorName', r.author_name, 'authorRole', r.author_role,
    'projectId', r.project_id,
    'projectName', coalesce(pr.name, (select string_agg(distinct e.project_name, ', ') from public.ai_studio_report_entries e where e.report_id = r.id), 'No task chosen yet'),
    'taskId', r.task_id, 'taskTitle', k.title,
    'reportDate', r.report_date, 'status', r.status, 'revision', r.revision,
    'leadId', private.ai_studio_report_lead(r), 'leadName', (select l.full_name from public.profiles l where l.id = private.ai_studio_report_lead(r)),
    'submittedAt', r.submitted_at, 'approvedAt', r.approved_at, 'updatedAt', r.updated_at,
    'consolidated', r.consolidated, 'totalMinutes', r.total_minutes,
    'taskCount', (select count(*) from public.ai_studio_report_entries e where e.report_id = r.id))
    from (select 1) one
    left join public.ai_studio_projects pr on pr.id = r.project_id
    left join public.ai_studio_tasks k on k.id = r.task_id
$$;
revoke all on function private.ai_studio_report_row(public.ai_studio_daily_reports) from public, anon;
grant execute on function private.ai_studio_report_row(public.ai_studio_daily_reports) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Global search: the AI Studio tasks, projects and daily reports the person may already open (the same checks as the AI Studio pages)
-- ---------------------------------------------------------------------------
create or replace function private.search_ai_studio(p_q text, p_tokens text[], p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_role();
  v_me uuid := auth.uid();
  v_tasks jsonb;
  v_projects jsonb;
  v_reports jsonb;
begin
  if v_me is null or v_role is null then
    return jsonb_build_object('tasks', '[]'::jsonb, 'projects', '[]'::jsonb, 'reports', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'title') filter (where (x ->> 'score')::int > 0), '[]'::jsonb) into v_tasks
    from (select jsonb_build_object('type', 'ai_studio_task', 'id', t.id, 'title', t.title,
                   'subtitle', concat_ws(' · ', pr.name, a.full_name, case when t.assignment_type = 'CROSS_TEAM' then 'Cross-team' end),
                   'meta', initcap(lower(replace(t.status, '_', ' '))),
                   'score', private.search_score(t.title, concat_ws(' ', t.title, pr.name, a.full_name, case when t.assignment_type = 'CROSS_TEAM' then 'cross team cross-team' end), p_q, p_tokens)) as x
            from public.ai_studio_tasks t join public.ai_studio_projects pr on pr.id = t.project_id join public.profiles a on a.id = t.assignee_id
           where (lower(t.title) like '%' || p_tokens[1] || '%' or lower(pr.name) like '%' || p_tokens[1] || '%' or lower(a.full_name) like '%' || p_tokens[1] || '%'
                  or (p_tokens[1] like 'cross%' and t.assignment_type = 'CROSS_TEAM'))
             and private.ai_studio_can_see_task(t)
           order by t.created_at desc limit 200) s;
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'title') filter (where (x ->> 'score')::int > 0), '[]'::jsonb) into v_projects
    from (select jsonb_build_object('type', 'ai_studio_project', 'id', pr.id, 'title', pr.name, 'subtitle', 'AI Studio project',
                   'meta', initcap(lower(pr.status)), 'score', private.search_score(pr.name, concat_ws(' ', pr.name, pr.description), p_q, p_tokens)) as x
            from public.ai_studio_projects pr
           where (lower(pr.name) like '%' || p_tokens[1] || '%' or lower(coalesce(pr.description, '')) like '%' || p_tokens[1] || '%')
             and (v_role in ('ADMIN', 'HEAD') or private.ai_studio_on_project(pr.id, v_me)
                  or exists (select 1 from public.ai_studio_tasks t where t.project_id = pr.id and t.assignee_id = v_me))
           limit 100) s;
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'title') filter (where (x ->> 'score')::int > 0), '[]'::jsonb) into v_reports
    from (select jsonb_build_object('type', 'ai_studio_report', 'id', r.id, 'title', format('Daily report · %s · %s', r.author_name, to_char(r.report_date, 'DD Mon YYYY')),
                   'subtitle', coalesce(pr.name, (select string_agg(distinct e.project_name, ', ') from public.ai_studio_report_entries e where e.report_id = r.id)),
                   'meta', initcap(lower(replace(r.status, '_', ' '))),
                   'score', private.search_score(r.author_name, concat_ws(' ', 'daily report', r.author_name, pr.name, to_char(r.report_date, 'DD Mon YYYY YYYY-MM-DD'),
                                                 (select string_agg(e.task_title || ' ' || coalesce(e.project_name, ''), ' ') from public.ai_studio_report_entries e where e.report_id = r.id)), p_q, p_tokens)) as x
            from public.ai_studio_daily_reports r left join public.ai_studio_projects pr on pr.id = r.project_id
           where (lower(r.author_name) like '%' || p_tokens[1] || '%' or to_char(r.report_date, 'DD Mon YYYY YYYY-MM-DD') ilike '%' || p_tokens[1] || '%'
                  or lower(coalesce(pr.name, '')) like '%' || p_tokens[1] || '%' or (p_tokens[1] in ('daily', 'report', 'reports'))
                  or exists (select 1 from public.ai_studio_report_entries e where e.report_id = r.id and (lower(e.task_title) like '%' || p_tokens[1] || '%' or lower(coalesce(e.project_name, '')) like '%' || p_tokens[1] || '%')))
             and private.ai_studio_can_see_report(r)
           order by r.report_date desc limit 200) s;
  return jsonb_build_object('tasks', (select coalesce(jsonb_agg(v), '[]'::jsonb) from (select v from jsonb_array_elements(v_tasks) with ordinality a(v, n) where n <= p_limit) z),
                            'projects', (select coalesce(jsonb_agg(v), '[]'::jsonb) from (select v from jsonb_array_elements(v_projects) with ordinality a(v, n) where n <= p_limit) z),
                            'reports', (select coalesce(jsonb_agg(v), '[]'::jsonb) from (select v from jsonb_array_elements(v_reports) with ordinality a(v, n) where n <= p_limit) z));
end $$;
revoke all on function private.search_ai_studio(text, text[], integer) from public, anon;
grant execute on function private.search_ai_studio(text, text[], integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Earlier functions that now read the task entries and the cross-team tasks (their bodies otherwise unchanged)
-- ---------------------------------------------------------------------------
-- 20270214000100's report detail + the report's task entries
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
    -- 20270218000100: a consolidated report's tasks (whoever reads the report reads them all: the author, their Team Lead, the Department Head)
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'taskId', e.task_id, 'taskTitle', e.task_title, 'projectId', e.project_id, 'projectName', e.project_name,
                           'assignmentType', e.assignment_type, 'assignedByName', e.assigned_by_name, 'taskStatus', e.task_status,
                           'currentStatus', (select k.status from public.ai_studio_tasks k where k.id = e.task_id),
                           'previousProgress', e.previous_progress, 'reportedProgress', e.reported_progress, 'minutesSpent', e.minutes_spent,
                           'workCompleted', e.work_completed, 'blockers', e.blockers, 'nextAction', e.next_action, 'legacy', e.legacy, 'progressSynced', e.progress_synced)
                           order by e.position, e.created_at) from public.ai_studio_report_entries e where e.report_id = r.id), '[]'::jsonb),
    'reviewStage', case when r.status = 'PENDING_TL_APPROVAL' then 'TEAM_LEAD' when r.status = 'PENDING_DH_APPROVAL' then 'DEPARTMENT_HEAD' end,
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'action', e.action, 'stage', e.stage, 'fromStatus', e.from_status, 'toStatus', e.to_status,
                                                               'comment', e.comment, 'actorName', e.actor_name, 'actorRole', e.actor_role, 'revision', e.revision,
                                                               'createdAt', e.created_at, 'changes', e.changes) order by e.seq)
                           from public.ai_studio_report_events e where e.report_id = r.id), '[]'::jsonb))
$$;
revoke all on function private.ai_studio_report_detail(public.ai_studio_daily_reports) from public, anon;
grant execute on function private.ai_studio_report_detail(public.ai_studio_daily_reports) to authenticated, service_role;
-- 20270105000100's report lists: a project filter also finds a consolidated report with a task of that project
create or replace function public.ai_studio_reports_list(
  p_view text default 'mine', p_project uuid default null, p_status text default null, p_lead uuid default null, p_author uuid default null,
  p_from date default null, p_to date default null, p_page integer default 1, p_page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_total bigint;
  v_items jsonb;
  v_counts jsonb;
begin
  if p_view not in ('mine', 'team', 'department') then raise exception 'VALIDATION_ERROR: Unknown report list.' using errcode = 'P0001'; end if;
  if p_view = 'mine' and v_role in ('ADMIN', 'HEAD') then raise exception 'FORBIDDEN: You do not write daily reports.' using errcode = '42501'; end if;
  if p_view = 'team' and v_role <> 'LEAD' then raise exception 'FORBIDDEN: Team reports are for Team Leads.' using errcode = '42501'; end if;
  if p_view = 'department' and v_role not in ('ADMIN', 'HEAD') then raise exception 'FORBIDDEN: Department reports are for the Department Head.' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('DRAFT', 'SUBMITTED', 'PENDING_TL_APPROVAL', 'RETURNED_BY_TL', 'PENDING_DH_APPROVAL', 'RETURNED_BY_DH', 'APPROVED') then
    raise exception 'VALIDATION_ERROR: Unknown report status.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) into v_counts
    from (select r.status, count(*) as n from public.ai_studio_daily_reports r
           where (case p_view when 'mine' then r.author_id = v_me
                              when 'team' then r.author_role = 'MEMBER' and r.status <> 'DRAFT' and private.ai_studio_report_lead(r) = v_me
                              else r.status <> 'DRAFT' end)
             and (p_project is null or r.project_id = p_project or exists (select 1 from public.ai_studio_report_entries pe where pe.report_id = r.id and pe.project_id = p_project))
             and (p_lead is null or r.lead_id = p_lead or r.author_id = p_lead)
             and (p_author is null or r.author_id = p_author)
             and (p_from is null or r.report_date >= p_from) and (p_to is null or r.report_date <= p_to)
           group by r.status) s;
  select count(*) into v_total from public.ai_studio_daily_reports r
   where (case p_view when 'mine' then r.author_id = v_me
                      when 'team' then r.author_role = 'MEMBER' and r.status <> 'DRAFT' and private.ai_studio_report_lead(r) = v_me
                      else r.status <> 'DRAFT' end)
     and (p_project is null or r.project_id = p_project or exists (select 1 from public.ai_studio_report_entries pe where pe.report_id = r.id and pe.project_id = p_project)) and (p_status is null or r.status = p_status)
     and (p_lead is null or r.lead_id = p_lead or r.author_id = p_lead) and (p_author is null or r.author_id = p_author)
     and (p_from is null or r.report_date >= p_from) and (p_to is null or r.report_date <= p_to);
  select coalesce(jsonb_agg(private.ai_studio_report_row(x) order by x.report_date desc, x.updated_at desc, x.id), '[]'::jsonb) into v_items
    from (select r.* from public.ai_studio_daily_reports r
           where (case p_view when 'mine' then r.author_id = v_me
                              when 'team' then r.author_role = 'MEMBER' and r.status <> 'DRAFT' and private.ai_studio_report_lead(r) = v_me
                              else r.status <> 'DRAFT' end)
             and (p_project is null or r.project_id = p_project or exists (select 1 from public.ai_studio_report_entries pe where pe.report_id = r.id and pe.project_id = p_project)) and (p_status is null or r.status = p_status)
             and (p_lead is null or r.lead_id = p_lead or r.author_id = p_lead) and (p_author is null or r.author_id = p_author)
             and (p_from is null or r.report_date >= p_from) and (p_to is null or r.report_date <= p_to)
           order by r.report_date desc, r.updated_at desc, r.id
           limit v_size offset (v_page - 1) * v_size) x;
  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size, 'counts', v_counts);
end $$;
revoke all on function public.ai_studio_reports_list(text, uuid, text, uuid, uuid, date, date, integer, integer) from public, anon;
grant execute on function public.ai_studio_reports_list(text, uuid, text, uuid, uuid, date, date, integer, integer) to authenticated;
-- 20270106000100's review, unchanged except the label of a consolidated report in the notifications
create or replace function public.ai_studio_report_review(p_report uuid, p_decision text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['LEAD', 'HEAD', 'ADMIN']);
  v_me uuid := auth.uid();
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  r public.ai_studio_daily_reports;
  v_from text;
  v_stage text;
  v_name text;
  pr_name text;
begin
  if p_decision not in ('APPROVE', 'RETURN') then raise exception 'VALIDATION_ERROR: Choose Approve or Return.' using errcode = 'P0001'; end if;
  if v_comment is not null and length(v_comment) > 2000 then raise exception 'VALIDATION_ERROR: The remarks can have at most 2000 characters.' using errcode = 'P0001'; end if;
  if p_decision = 'RETURN' and (v_comment is null or length(v_comment) < 3) then
    raise exception 'VALIDATION_ERROR: Write the remarks the employee should act on.' using errcode = 'P0001';
  end if;
  select * into r from public.ai_studio_daily_reports where id = p_report for update;
  if r.id is null or not private.ai_studio_can_see_report(r) then raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001'; end if;
  if r.author_id = v_me then raise exception 'FORBIDDEN: You cannot decide your own report.' using errcode = '42501'; end if;
  if not private.ai_studio_can_review(r) then
    raise exception 'CONFLICT: This report is not waiting for your decision.' using errcode = 'P0001';
  end if;
  v_from := r.status;
  select full_name into v_name from public.profiles where id = v_me;
  -- a consolidated report names its tasks instead of one project (20270218000100)
  pr_name := coalesce((select name from public.ai_studio_projects where id = r.project_id),
                      (select format('%s task%s', count(*), case when count(*) = 1 then '' else 's' end) from public.ai_studio_report_entries e where e.report_id = r.id));

  if v_from = 'PENDING_TL_APPROVAL' then
    v_stage := 'TEAM_LEAD';
    update public.ai_studio_daily_reports
       set status = case when p_decision = 'APPROVE' then 'PENDING_DH_APPROVAL' else 'RETURNED_BY_TL' end,
           lead_id = v_me, lead_name = v_name, tl_reviewed_by = v_me, tl_reviewed_at = now(), tl_comment = v_comment
     where id = r.id returning * into r;
  else
    v_stage := 'DEPARTMENT_HEAD';
    update public.ai_studio_daily_reports
       set status = case when p_decision = 'APPROVE' then 'APPROVED' else 'RETURNED_BY_DH' end,
           dh_reviewed_by = v_me, dh_reviewed_at = now(), dh_comment = v_comment,
           approved_at = case when p_decision = 'APPROVE' then now() else null end
     where id = r.id returning * into r;
  end if;
  perform private.ai_studio_event(r, case when p_decision = 'APPROVE' then 'APPROVED' else 'RETURNED' end, v_stage, v_from, v_comment);
  perform private.write_audit('AI_STUDIO_REPORT_' || case when p_decision = 'APPROVE' then 'APPROVED' else 'RETURNED' end, 'ai_studio_report', r.id,
                              private.ai_studio_department(), null, jsonb_build_object('stage', v_stage, 'from', v_from, 'to', r.status, 'author', r.author_id));

  if v_stage = 'TEAM_LEAD' and p_decision = 'APPROVE' then
    perform private.notify(r.author_id, 'AI_STUDIO_REPORT_TL_APPROVED', 'Your daily report was approved by your Team Lead',
      format('%s · %s. It now waits for the Department Head.', pr_name, to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id);
    perform private.notify(h, 'AI_STUDIO_REPORT_PENDING_HEAD', format('Daily report to review: %s', r.author_name),
      format('Approved by %s · %s · %s', v_name, pr_name, to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id) from private.ai_studio_head_ids() h;
  elsif v_stage = 'TEAM_LEAD' then
    perform private.notify(r.author_id, 'AI_STUDIO_REPORT_RETURNED', 'Your Team Lead returned your daily report',
      format('%s · %s: %s', pr_name, to_char(r.report_date, 'DD Mon YYYY'), v_comment), 'ai_studio_report', r.id);
  elsif p_decision = 'APPROVE' then
    perform private.notify(r.author_id, 'AI_STUDIO_REPORT_APPROVED', 'Your daily report was approved',
      format('%s · %s. Final approval by the Department Head.', pr_name, to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id);
    if r.lead_id is not null then
      perform private.notify(r.lead_id, 'AI_STUDIO_REPORT_APPROVED', format('%s''s daily report was approved', r.author_name),
        format('%s · %s · final approval by the Department Head.', pr_name, to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id);
    end if;
  else
    perform private.notify(r.author_id, 'AI_STUDIO_REPORT_RETURNED', 'The Department Head returned your daily report',
      format('%s · %s: %s', pr_name, to_char(r.report_date, 'DD Mon YYYY'), v_comment), 'ai_studio_report', r.id);
    if r.lead_id is not null then
      perform private.notify(r.lead_id, 'AI_STUDIO_REPORT_RETURNED', format('%s''s daily report was returned by the Department Head', r.author_name),
        format('%s · %s: %s', pr_name, to_char(r.report_date, 'DD Mon YYYY'), v_comment), 'ai_studio_report', r.id);
    end if;
  end if;
  return private.ai_studio_report_detail(r);
end $$;
revoke all on function public.ai_studio_report_review(uuid, text, text) from public, anon;
grant execute on function public.ai_studio_report_review(uuid, text, text) to authenticated;
-- 20270107000100's single-task save, unchanged except that it never touches a consolidated report
create or replace function public.ai_studio_report_save(
  p_id uuid, p_project uuid, p_task uuid, p_date date, p_work_completed text, p_work_in_progress text, p_pending_work text, p_blockers text, p_remarks text, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
  v_completed text := nullif(btrim(coalesce(p_work_completed, '')), '');
  v_progress text := nullif(btrim(coalesce(p_work_in_progress, '')), '');
  v_pending text := nullif(btrim(coalesce(p_pending_work, '')), '');
  v_blockers text := nullif(btrim(coalesce(p_blockers, '')), '');
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  me public.profiles;
  pr public.ai_studio_projects;
  tk public.ai_studio_tasks;
  r public.ai_studio_daily_reports;
  v_lead uuid;
  v_from text;
  v_action text;
begin
  select * into me from public.profiles where id = v_me;
  if p_date is null then raise exception 'VALIDATION_ERROR: Choose the report date.' using errcode = 'P0001'; end if;
  if p_date > private.ai_studio_today() then raise exception 'VALIDATION_ERROR: The report date cannot be in the future.' using errcode = 'P0001'; end if;
  if p_date < private.ai_studio_today() - 60 then raise exception 'VALIDATION_ERROR: A report can be written for the last 60 days only.' using errcode = 'P0001'; end if;
  if greatest(length(coalesce(v_completed, '')), length(coalesce(v_progress, '')), length(coalesce(v_pending, '')), length(coalesce(v_blockers, '')), length(coalesce(v_remarks, ''))) > 4000 then
    raise exception 'VALIDATION_ERROR: Each part of the report can have at most 4000 characters.' using errcode = 'P0001';
  end if;
  select * into pr from public.ai_studio_projects where id = p_project;
  if pr.id is null or pr.status = 'ARCHIVED' or not private.ai_studio_on_project(p_project, v_me) then
    raise exception 'VALIDATION_ERROR: Choose one of your projects.' using errcode = 'P0001';
  end if;
  if p_task is not null then
    select * into tk from public.ai_studio_tasks where id = p_task;
    if tk.id is null or tk.assignee_id <> v_me or tk.project_id <> p_project then
      raise exception 'VALIDATION_ERROR: Choose a task that was assigned to you in this project.' using errcode = 'P0001';
    end if;
  end if;
  if p_submit and v_completed is null then
    raise exception 'VALIDATION_ERROR: Describe the work completed today before you submit.' using errcode = 'P0001';
  end if;

  if p_id is null then
    if exists (select 1 from public.ai_studio_daily_reports x where x.author_id = v_me and x.report_date = p_date and x.project_id = p_project
                  and coalesce(x.task_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_task, '00000000-0000-0000-0000-000000000000'::uuid)) then
      raise exception 'CONFLICT: You already have a report for this project, task and date. Open it from My Daily Reports.' using errcode = 'P0001';
    end if;
    begin
      insert into public.ai_studio_daily_reports (author_id, author_name, author_role, project_id, task_id, report_date, work_completed, work_in_progress, pending_work, blockers, remarks, status)
      values (v_me, me.full_name, v_role, p_project, p_task, p_date, v_completed, v_progress, v_pending, v_blockers, v_remarks, 'DRAFT') returning * into r;
    exception when unique_violation then
      raise exception 'CONFLICT: You already have a report for this project, task and date. Open it from My Daily Reports.' using errcode = 'P0001';
    end;
    perform private.ai_studio_event(r, 'CREATED', null, null, null);
    v_from := 'DRAFT';
  else
    select * into r from public.ai_studio_daily_reports where id = p_id for update;
    if r.id is null or r.author_id <> v_me then raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001'; end if;
    -- 20270218000100: a report with several tasks is saved by ai_studio_daily_report_save only
    if r.consolidated then raise exception 'CONFLICT: This daily report has several tasks: open it in the daily report form.' using errcode = 'P0001'; end if;
    if r.status not in ('DRAFT', 'RETURNED_BY_TL', 'RETURNED_BY_DH') then
      raise exception 'CONFLICT: This report was already submitted and can no longer be changed.' using errcode = 'P0001';
    end if;
    begin
      update public.ai_studio_daily_reports
         set project_id = p_project, task_id = p_task, report_date = p_date, work_completed = v_completed, work_in_progress = v_progress,
             pending_work = v_pending, blockers = v_blockers, remarks = v_remarks
       where id = r.id returning * into r;
    exception when unique_violation then
      raise exception 'CONFLICT: You already have a report for this project, task and date. Open it from My Daily Reports.' using errcode = 'P0001';
    end;
    v_from := r.status;
  end if;

  if p_submit then
    -- a Team Member with a Team Lead goes through them; with none (yet) the report goes straight to the Department Head. The route is fixed when the report is
    -- submitted: a Team Lead assigned later does not take over reports that are already in.
    if v_role = 'MEMBER' then
      v_lead := private.direct_lead_of(v_me);
    end if;
    v_action := case when v_from in ('RETURNED_BY_TL', 'RETURNED_BY_DH') then 'RESUBMITTED' else 'SUBMITTED' end;
    update public.ai_studio_daily_reports
       set status = case when v_lead is not null then 'PENDING_TL_APPROVAL' else 'PENDING_DH_APPROVAL' end,
           lead_id = v_lead, lead_name = (select l.full_name from public.profiles l where l.id = v_lead),
           revision = case when v_action = 'RESUBMITTED' then revision + 1 else revision end,
           tl_reviewed_by = null, tl_reviewed_at = null, tl_comment = null, dh_reviewed_by = null, dh_reviewed_at = null, dh_comment = null,
           submitted_at = now(), approved_at = null
     where id = r.id returning * into r;
    perform private.ai_studio_event(r, v_action, null, v_from, case when v_role = 'MEMBER' and v_lead is null then 'No Team Lead is assigned: sent straight to the Department Head.' end);
    perform private.write_audit('AI_STUDIO_REPORT_' || v_action, 'ai_studio_report', r.id, me.department_id, me.team_id, jsonb_build_object('date', r.report_date, 'revision', r.revision));
    if v_lead is not null then
      perform private.notify(v_lead, 'AI_STUDIO_REPORT_SUBMITTED', format('Daily report to review: %s', me.full_name),
        format('%s · %s%s', pr.name, to_char(r.report_date, 'DD Mon YYYY'), case when v_action = 'RESUBMITTED' then ' · resubmitted' else '' end), 'ai_studio_report', r.id);
    else
      perform private.notify(h, 'AI_STUDIO_REPORT_PENDING_HEAD', format('Daily report to review: %s', me.full_name),
        format('%s · %s · %s', case when v_role = 'MEMBER' then 'No Team Lead assigned' else 'Team Lead' end, pr.name, to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id) from private.ai_studio_head_ids() h;
    end if;
  end if;
  return private.ai_studio_report_detail(r);
end $$;
revoke all on function public.ai_studio_report_save(uuid, uuid, uuid, date, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.ai_studio_report_save(uuid, uuid, uuid, date, text, text, text, text, text, boolean) to authenticated;
-- 20270120000100's project list + the projects of the person's own (cross-team) tasks
create or replace function public.ai_studio_projects_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pr.id, 'name', pr.name, 'description', pr.description, 'status', pr.status, 'createdAt', pr.created_at, 'deadlineAt', pr.deadline_at,
      'mine', exists (select 1 from public.ai_studio_project_members m where m.project_id = pr.id and m.profile_id = v_me),
      -- 20270218000100: a project the person is not on but has a task in (a cross-team task): only that task is theirs to see
      'viaTask', not exists (select 1 from public.ai_studio_project_members m where m.project_id = pr.id and m.profile_id = v_me)
                 and exists (select 1 from public.ai_studio_tasks t where t.project_id = pr.id and t.assignee_id = v_me),
      'leads', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.full_name) order by l.full_name)
                           from public.ai_studio_project_members m join public.profiles l on l.id = m.profile_id
                          where m.project_id = pr.id and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE'
                            and (v_role in ('ADMIN', 'HEAD') or l.id = v_me or v_role = 'MEMBER' and l.id = private.direct_lead_of(v_me))), '[]'::jsonb),
      'memberCount', (select count(*) from public.ai_studio_project_members m join public.profiles x on x.id = m.profile_id
                       where m.project_id = pr.id and x.role = 'TEAM_MEMBER' and x.status = 'ACTIVE'
                         and (v_role in ('ADMIN', 'HEAD') or v_role = 'LEAD' and private.direct_lead_of(x.id) = v_me or v_role = 'MEMBER' and x.id = v_me)),
      'tasks', (select jsonb_build_object('total', count(*), 'assigned', count(*) filter (where t.status = 'ASSIGNED'),
                         'ongoing', count(*) filter (where t.status = 'IN_PROGRESS'), 'onHold', count(*) filter (where t.status = 'ON_HOLD'),
                         'completed', count(*) filter (where t.status = 'COMPLETED'),
                         'progress', coalesce(round(avg(t.progress)), 0))
                  from public.ai_studio_tasks t where t.project_id = pr.id and private.ai_studio_can_see_task(t))
    ) order by (pr.status = 'ARCHIVED'), pr.name)
    from public.ai_studio_projects pr
   where v_role in ('ADMIN', 'HEAD')
      or exists (select 1 from public.ai_studio_project_members m where m.project_id = pr.id and m.profile_id = v_me)
      or exists (select 1 from public.ai_studio_tasks t where t.project_id = pr.id and t.assignee_id = v_me)), '[]'::jsonb);
end $$;
revoke all on function public.ai_studio_projects_list() from public, anon;
grant execute on function public.ai_studio_projects_list() to authenticated;
-- 20270214000100's AI Studio member figures + cross-team tasks, projects contributed to, reported minutes and blockers (each task still counted once,
-- for the person who did it)
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
  c record;
begin
  select count(*)::int as total,
         count(*) filter (where t.status = 'COMPLETED')::int as completed,
         count(*) filter (where t.status <> 'COMPLETED' and not (t.due_date is not null and t.due_date < p_today))::int as pending,
         count(*) filter (where t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < p_today)::int as overdue,
         count(*) filter (where t.status = 'COMPLETED' and t.completed_at is not null and t.due_date is not null and (t.completed_at at time zone v_tz)::date <= t.due_date)::int as on_time,
         count(*) filter (where t.status = 'COMPLETED' and t.completed_at is not null and t.due_date is not null and (t.completed_at at time zone v_tz)::date > t.due_date)::int as late,
         avg(case when t.status = 'COMPLETED' then 100 else t.progress end) as avg_progress,
         count(*) filter (where t.assignment_type = 'CROSS_TEAM')::int as cross_team,
         count(distinct t.project_id)::int as projects
    into k
    from public.ai_studio_tasks t
   where t.assignee_id = p_member and coalesce(t.due_date, (t.created_at at time zone v_tz)::date) between p_start and p_end;

  select count(*)::int as submitted, count(*) filter (where s = 'APPROVED')::int as approved,
         count(*) filter (where s = 'RETURNED')::int as returned, count(*) filter (where s = 'PENDING')::int as pending,
         count(distinct d) filter (where s = 'APPROVED')::int as approved_days
    into g
    from (select private.perf2_ai_report_state(r) as s, r.report_date as d from public.ai_studio_daily_reports r
           where r.author_id = p_member and r.status <> 'DRAFT' and r.report_date between p_start and p_end) x;

  -- 20270218000100: the day-by-day entries of the person's reports in the period (each task's minutes once per report)
  select coalesce(sum(e.minutes_spent), 0)::int as minutes, count(*) filter (where e.blockers is not null)::int as blockers
    into c from public.ai_studio_report_entries e join public.ai_studio_daily_reports r on r.id = e.report_id
   where r.author_id = p_member and r.status <> 'DRAFT' and r.report_date between p_start and p_end;

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
    'tasks', jsonb_build_object('total', k.total, 'completed', k.completed, 'pending', k.pending, 'overdue', k.overdue, 'onTime', k.on_time, 'late', k.late, 'crossTeam', k.cross_team),
    'contribution', jsonb_build_object('projects', k.projects, 'crossTeamTasks', k.cross_team, 'reportedMinutes', c.minutes, 'blockers', c.blockers),
    'completionPct', private.perf2_pct(k.completed, k.total), 'onTimePct', private.perf2_pct(k.on_time, k.on_time + k.late), 'progressPct', v_progress,
    'reports', jsonb_build_object('submitted', g.submitted, 'approved', g.approved, 'returned', g.returned, 'pending', g.pending,
        'approvalPct', v_approval, 'expectedDays', v_expected, 'approvedDays', g.approved_days, 'consistencyPct', v_consistency),
    'parts', v_parts, 'score', private.perf2_score(v_parts));
end $$;
revoke all on function private.perf2_member_ai(uuid, date, date, date) from public, anon, authenticated;
-- 20270214000100's AI Studio Team Lead figures + the cross-team tasks they gave
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

  select count(*)::int as assigned, count(*) filter (where t.assignment_type = 'CROSS_TEAM')::int as cross_team into mg from public.ai_studio_tasks t
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
    'management', jsonb_build_object('tasksAssignedToTeam', mg.assigned, 'crossTeamGiven', mg.cross_team, 'tasksReceived', own.total, 'handedDown', 0, 'handledOrDelegated', own.total, 'delegationPct', null),
    'parts', v_parts, 'score', private.perf2_score(v_parts));
end $$;
revoke all on function private.perf2_lead_ai(uuid, date, date, date, jsonb) from public, anon, authenticated;
-- 20270214000100's work view, reading AI Studio reports through their task entries
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
                 'assignmentType', t.assignment_type,
                 -- 20270218000100: reports through their task entries (a consolidated report names many tasks; older ones have one entry each)
                 'reports', (select count(*) from public.ai_studio_report_entries e join public.ai_studio_daily_reports x on x.id = e.report_id
                              where e.task_id = t.id and x.status <> 'DRAFT' and x.report_date between p_start and p_end),
                 'pendingReports', (select count(*) from public.ai_studio_report_entries e join public.ai_studio_daily_reports x on x.id = e.report_id
                                     where e.task_id = t.id and x.status <> 'DRAFT' and x.report_date between p_start and p_end and private.perf2_ai_report_state(x) = 'PENDING'),
                 'lastReport', (select jsonb_build_object('id', x.id, 'reportDate', x.report_date, 'progress', coalesce(e.reported_progress, t.progress), 'status', private.perf2_ai_report_state(x))
                                  from public.ai_studio_report_entries e join public.ai_studio_daily_reports x on x.id = e.report_id
                                 where e.task_id = t.id and x.status <> 'DRAFT' order by x.report_date desc, x.updated_at desc limit 1))
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
-- 20270215000100's global search + the AI Studio groups
create or replace function public.global_search(p_query text, p_limit integer default 5)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_q text := lower(btrim(regexp_replace(coalesce(p_query, ''), '\s+', ' ', 'g')));
  v_tokens text[];
  v_digits text;
  v_lim integer := least(greatest(coalesce(p_limit, 5), 1), 20);
  v_role text;
  v_my_dept uuid;
  v_emp jsonb;
  v_cust jsonb;
  v_lead jsonb;
  v_tic jsonb;
  v_dep jsonb;
  v_mtg jsonb;
  v_not jsonb;
  v_cust_ids uuid[];
  v_tic_ids uuid[];
  v_emp_ids uuid[];
  v_active boolean;
  v_ai jsonb;
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  select c.o_role, c.o_department, coalesce(c.o_active, false) into v_role, v_my_dept, v_active from private.search_caller() c;
  if not coalesce(v_active, false) then
    raise exception 'FORBIDDEN: Your account is not active.' using errcode = '42501';
  end if;
  -- The close-spelling threshold for the trigram "<%" operator, for this transaction only (the helpers below run inside it). It is set here and
  -- not with a function-level "set pg_trgm.word_similarity_threshold" clause: the Supabase SQL editor runs as a role that is not a superuser,
  -- and PostgreSQL refuses that clause from such a role when the pg_trgm library is not yet loaded in the session ("permission denied to set
  -- parameter"), so the migration could not be pasted there.
  perform set_config('pg_trgm.word_similarity_threshold', '0.5', true);
  -- punctuation other than what names, codes, e-mails and numbers use is ignored; at most 100 characters
  v_q := left(btrim(regexp_replace(v_q, '[^[:alnum:]@.+_\- ]', ' ', 'g')), 100);
  v_q := btrim(regexp_replace(v_q, '\s+', ' ', 'g'));
  if length(v_q) < 2 then
    return jsonb_build_object('query', v_q, 'groups', '[]'::jsonb);
  end if;
  v_tokens := array(select t from unnest(string_to_array(v_q, ' ')) t where t <> '' limit 6);
  -- the first word filters through the indexes: a word with digits (an id, a number) first, then the longest; every word must match
  v_tokens := array(select t from unnest(v_tokens) t order by (t ~ '[0-9]') desc, length(t) desc, t);
  v_digits := case when length(private.search_digits(v_q)) >= 4 and v_q ~ '^[0-9+() .\-]+$' then private.search_digits(v_q) end;

  -- the candidates first, as values: the row-level policies then run only on those rows (an id list is a plain, leakproof comparison that
  -- the primary key serves; a function call in the same place would make PostgreSQL apply every policy to every row first)
  v_cust_ids := private.search_customer_candidates(v_q, v_tokens, v_digits, 600);
  v_tic_ids := private.search_ticket_candidates(v_q, v_tokens, 600);
  v_emp_ids := private.search_profile_candidates(v_q, v_tokens, v_digits, 600);

  -- employees (profiles: row-level rule private.can_view_profile)
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'title', x ->> 'id'), '[]'::jsonb) into v_emp
    from (select jsonb_build_object('type', 'employee', 'id', p.id, 'title', p.full_name,
                   'subtitle', concat_ws(' · ', nullif(p.position, ''), d.name),
                   'meta', case when p.status <> 'ACTIVE' then initcap(lower(p.status::text)) end,
                   'score', greatest(private.search_score(p.full_name, concat_ws(' ', p.full_name, p.email, p.position, d.name), v_q, v_tokens),
                                     case when v_digits is not null and private.search_digits(p.phone) like '%' || v_digits || '%' then 75 else 0 end,
                                     case when p.id::text = v_q then 100 else 0 end)) as x
            from public.profiles p
            left join public.departments d on d.id = p.department_id
           where p.id = any(v_emp_ids)
           limit 300) s
   where (x ->> 'score')::int > 0;


  -- customers and leads (customers: the customer row-level policies)
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'title', x ->> 'id') filter (where x ->> 'type' = 'customer'), '[]'::jsonb),
         coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'title', x ->> 'id') filter (where x ->> 'type' = 'lead'), '[]'::jsonb)
    into v_cust, v_lead
    from (select jsonb_build_object('type', case when c.lifecycle_stage = 'LEAD' then 'lead' else 'customer' end, 'id', c.id,
                   'title', coalesce(nullif(c.company, ''), c.name),
                   'subtitle', concat_ws(' · ', case when nullif(c.company, '') is not null then c.name end, c.customer_code, d.name),
                   'meta', initcap(lower(c.status::text)),
                   'score', greatest(private.search_score(coalesce(nullif(c.company, ''), c.name), concat_ws(' ', c.search_text, c.customer_code, d.name), v_q, v_tokens),
                                     private.search_score(c.name, c.name, v_q, v_tokens),
                                     case when lower(coalesce(c.customer_code, '')) = v_q then 100 else 0 end,
                                     case when v_digits is not null and private.search_digits(c.phone) like '%' || v_digits || '%' then 75 else 0 end)) as x
            from public.customers c
            left join public.departments d on d.id = c.department_id
           where c.id = any(v_cust_ids)
           limit 400) s
   where (x ->> 'score')::int > 0;

  -- support tickets (support_tickets: the ticket row-level policies)
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'title', x ->> 'id'), '[]'::jsonb) into v_tic
    from (select jsonb_build_object('type', 'ticket', 'id', t.id, 'title', t.subject,
                   'subtitle', concat_ws(' · ', t.ticket_no, initcap(lower(replace(t.status::text, '_', ' ')))),
                   'meta', initcap(lower(t.priority::text)),
                   'score', greatest(private.search_score(t.subject, concat_ws(' ', t.subject, t.ticket_no, t.category), v_q, v_tokens),
                                     case when lower(coalesce(t.ticket_no, '')) = v_q or lower(coalesce(t.ticket_no, '')) like '%-' || v_q then 100 else 0 end)) as x
            from public.support_tickets t
           where t.id = any(v_tic_ids)
           order by t.created_at desc
           limit 300) s
   where (x ->> 'score')::int > 0;

  -- departments: the Managing Director all, a head / CEO their scopes, others their own
  select coalesce(jsonb_agg(x order by (x ->> 'score')::int desc, x ->> 'title', x ->> 'id'), '[]'::jsonb) into v_dep
    from (select jsonb_build_object('type', 'department', 'id', d.id, 'title', d.name,
                   'subtitle', (select string_agg(h.full_name, ', ' order by h.full_name) from public.profiles h
                                 where h.department_id = d.id and h.role = 'DEPARTMENT_HEAD' and h.status = 'ACTIVE'),
                   'score', private.search_score(d.name, concat_ws(' ', d.name, d.slug), v_q, v_tokens)) as x
            from public.departments d
           where (v_role = 'SUPER_ADMIN'
                  or d.id = v_my_dept
                  or (v_role = 'DEPARTMENT_HEAD' and exists (select 1 from private.scopes_of(auth.uid()) s where s.department_id = d.id)))
             and (lower(d.name) like '%' || v_tokens[1] || '%' or lower(coalesce(d.slug, '')) like '%' || v_tokens[1] || '%'
                  or (length(v_q) >= 4 and extensions.similarity(lower(d.name), v_q) >= 0.45))) s
   where (x ->> 'score')::int > 0;

  v_mtg := private.search_meetings(v_q, v_tokens, v_lim + 1);
  v_not := private.search_notices(v_q, v_tokens, v_lim + 1);
  -- 20270218000100: AI Studio tasks, projects and daily reports, with the AI Studio pages' own checks
  v_ai := private.search_ai_studio(v_q, v_tokens, v_lim + 1);

  return jsonb_build_object('query', v_q, 'groups', (
    select coalesce(jsonb_agg(jsonb_build_object('type', g.type, 'items', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(g.items) with ordinality a(e, n) where n <= v_lim) z),
                                                 'hasMore', jsonb_array_length(g.items) > v_lim) order by g.ord), '[]'::jsonb)
      from (values (1, 'employee', v_emp), (2, 'customer', v_cust), (3, 'lead', v_lead), (4, 'meeting', v_mtg), (5, 'ticket', v_tic),
                   (6, 'department', v_dep), (7, 'notice', v_not), (8, 'ai_studio_task', v_ai -> 'tasks'), (9, 'ai_studio_project', v_ai -> 'projects'),
                   (10, 'ai_studio_report', v_ai -> 'reports')) g(ord, type, items)
     where jsonb_array_length(g.items) > 0));
end $$;
revoke all on function public.global_search(text, integer) from public, anon;
grant execute on function public.global_search(text, integer) to authenticated, service_role;
