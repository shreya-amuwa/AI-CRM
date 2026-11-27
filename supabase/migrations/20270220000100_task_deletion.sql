-- =============================================================================
-- Deleting an assigned task (Team Lead, Department Head, Operations Head)
--
-- Who may delete (checked here, never only in the screen):
--   * Team Lead (TEAM_HEAD): a task they gave to someone else (assigned_by = them).
--   * Department Head: a task they gave, or a task inside the department and function they head (private.head_covers), unless it was given by the
--     Super Admin or an Operations Head (a higher level).
--   * Operations Head: a task they gave, or a task inside a department and function they manage (private.scopes_of), unless given by the Super Admin.
--   * Nobody deletes a task assigned to themselves. Team Members (Telecallers, Business Associates and every other member-level designation) and the
--     Super Admin get FORBIDDEN: the Super Admin's access is unchanged by this feature.
--
-- The three task systems each get their own function, following their own permission model:
--   public.work_task_delete         the Task module (every department)
--   public.ai_studio_task_delete    AI Studio project tasks (Team Lead: own tasks; Department Head: the department's tasks)
--   public.ads_assignment_delete    AI Design Studio assignments (Team Lead: own assignments; Department Head: the department's)
--
-- A delete removes the task and the work that hangs off it (its sub-tasks / passed-on parts, their updates and update requests, the Task module's
-- per-task daily reports) through the existing "on delete cascade" keys, so nothing is left orphaned. Records that only point at the task
-- ("on delete set null": older one-task AI Studio daily reports, AI Design Studio reports and issues, field visits) stay, without the
-- link. The task's own notifications are removed (they would open a task that no longer exists), the assignees are told, and the audit log keeps a
-- snapshot of what was deleted. A second click finds nothing and gets NOT_FOUND.
--
-- Safe to run twice. Needs 20270219000100_ai_studio_consolidated_reports.sql (ai_studio_report_tasks).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The Task module (work_tasks)
-- ---------------------------------------------------------------------------
-- Why the caller may not delete this task, or null when they may. One rule for the button (work_task_delete_preview) and the delete itself.
create or replace function private.work_task_delete_problem(p_me uuid, t public.work_tasks)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when me.id is null then 'FORBIDDEN: Your account is not active.'
    when me.role not in ('TEAM_HEAD', 'DEPARTMENT_HEAD') then 'FORBIDDEN: Only a Team Lead, a Department Head or an Operations Head can delete tasks.'
    when t.assignee_id = me.id then 'FORBIDDEN: You cannot delete a task that was assigned to you.'
    when t.assigned_by = me.id then null
    when me.role = 'TEAM_HEAD' then 'FORBIDDEN: A Team Lead can delete only the tasks they assigned.'
    when giver.role = 'SUPER_ADMIN' then 'FORBIDDEN: This task was given by the Super Admin. Only tasks within your authority can be deleted.'
    when not me.is_operations_head and coalesce(giver.is_operations_head, false)
      then 'FORBIDDEN: This task was given by an Operations Head. Only tasks within your authority can be deleted.'
    when not me.is_operations_head and private.head_covers(me.id, private.base_department(t.department_id), coalesce(t.team_id, who.team_id)) then null
    when me.is_operations_head and exists (
           select 1 from private.scopes_of(me.id) s
            where s.department_id = private.base_department(t.department_id)
              and (s.division is null
                   or coalesce((select tm.division::text from public.teams tm where tm.id = coalesce(t.team_id, who.team_id)), 'GENERAL') in ('GENERAL', s.division))) then null
    else 'FORBIDDEN: This task is outside the department and teams you manage.'
  end
    from (select 1) one
    left join public.profiles me on me.id = p_me and me.status = 'ACTIVE'
    left join public.profiles giver on giver.id = t.assigned_by
    left join public.profiles who on who.id = t.assignee_id
$$;
revoke all on function private.work_task_delete_problem(uuid, public.work_tasks) from public, anon, authenticated;

-- the task and every sub-task under it
create or replace function private.work_task_subtree(p_task uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  with recursive tree as (
    select id from public.work_tasks where id = p_task
    union
    select c.id from public.work_tasks c join tree on c.parent_id = tree.id)
  select id from tree
$$;
revoke all on function private.work_task_subtree(uuid) from public, anon, authenticated;

-- What the confirmation shows: whether the caller may delete the task and what goes with it. Same visibility as the task itself.
create or replace function public.work_task_delete_preview(p_task uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.work_tasks;
  v_problem text;
begin
  select * into t from public.work_tasks where id = p_task;
  if t.id is null or not private.can_view_work_task(t.id) then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0002';
  end if;
  v_problem := private.work_task_delete_problem(private.my_id(), t);
  return jsonb_build_object(
    'taskId', t.id, 'title', t.title, 'status', t.status,
    'assigneeName', (select full_name from public.profiles where id = t.assignee_id),
    'canDelete', v_problem is null,
    'reason', case when v_problem is not null then regexp_replace(v_problem, '^[A-Z_]+: ', '') end,
    'subtasks', (select count(*) - 1 from private.work_task_subtree(t.id)),
    'updates', (select count(*) from public.work_task_updates u where u.task_id in (select private.work_task_subtree(t.id))),
    'dailyReports', (select count(*) from public.task_daily_reports r where r.task_id in (select private.work_task_subtree(t.id))));
end $$;
revoke all on function public.work_task_delete_preview(uuid) from public, anon;
grant execute on function public.work_task_delete_preview(uuid) to authenticated;

create or replace function public.work_task_delete(p_task uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.work_tasks;
  v_problem text;
  v_ids uuid[];
  v_notify uuid[];
  v_updates integer;
  v_reports integer;
  r record;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null or me.role not in ('TEAM_HEAD', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only a Team Lead, a Department Head or an Operations Head can delete tasks.' using errcode = '42501';
  end if;
  -- the row lock makes two deletes (or a delete and an update) of the same task wait for each other
  select * into t from public.work_tasks where id = p_task for update;
  if t.id is null or not private.can_view_work_task(t.id) then
    raise exception 'NOT_FOUND: Task not found. It may already have been deleted.' using errcode = 'P0002';
  end if;
  v_problem := private.work_task_delete_problem(me.id, t);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '42501';
  end if;

  select array_agg(s) into v_ids from private.work_task_subtree(t.id) s;
  perform 1 from public.work_tasks where id = any (v_ids) for update;
  select count(*) into v_updates from public.work_task_updates where task_id = any (v_ids);
  select count(*) into v_reports from public.task_daily_reports where task_id = any (v_ids);
  -- everyone who had a part of it (and the giver, when a head deletes a lead's task), except the caller
  select array_agg(distinct x) into v_notify from (
    select assignee_id as x from public.work_tasks where id = any (v_ids)
    union select assigned_by from public.work_tasks where id = any (v_ids)) s
   where x is not null and x <> me.id;

  perform private.write_audit('TASK_DELETED', 'work_task', t.id, private.base_department(t.department_id), t.team_id, jsonb_build_object(
    'task', jsonb_build_object('title', t.title, 'description', t.description, 'priority', t.priority, 'status', t.status, 'progress', t.progress,
                               'dueDate', t.due_date, 'assigneeId', t.assignee_id, 'assignedBy', t.assigned_by, 'parentId', t.parent_id, 'createdAt', t.created_at),
    'subtaskIds', to_jsonb(array_remove(v_ids, t.id)), 'updates', v_updates, 'dailyReports', v_reports));

  delete from public.notifications where entity_type = 'work_task' and entity_id = any (v_ids);
  delete from public.work_tasks where id = t.id;   -- sub-tasks, updates, update requests and per-task daily reports go with it (on delete cascade)

  for r in select unnest(coalesce(v_notify, '{}'::uuid[])) as pid loop
    perform private.notify(r.pid, 'TASK_DELETED', format('Task deleted: %s', t.title), format('%s deleted this task.', me.full_name), null, null,
                           jsonb_build_object('taskId', t.id));
  end loop;

  return jsonb_build_object('deleted', true, 'taskId', t.id, 'title', t.title,
                            'subtasks', coalesce(array_length(v_ids, 1), 1) - 1, 'updates', v_updates, 'dailyReports', v_reports);
end $$;
revoke all on function public.work_task_delete(uuid) from public, anon;
grant execute on function public.work_task_delete(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. AI Studio project tasks (ai_studio_tasks)
-- ---------------------------------------------------------------------------
-- The Team Lead who gave it; the AI Studio Department Head (or an Operations Head of AI Studio, who has the same AI Studio role), unless the
-- Managing Director gave it. Never a task assigned to the caller. The Managing Director (Super Admin) keeps today's access: no delete.
create or replace function private.ai_studio_delete_problem(t public.ai_studio_tasks)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when private.ai_studio_role() is null then 'FORBIDDEN: This page is only for the people of AI Studio.'
    when private.ai_studio_role() not in ('LEAD', 'HEAD') then 'FORBIDDEN: Only a Team Lead, a Department Head or an Operations Head can delete tasks.'
    when t.assignee_id = auth.uid() then 'FORBIDDEN: You cannot delete a task that was assigned to you.'
    when t.assigned_by = auth.uid() then null
    when private.ai_studio_role() = 'LEAD' then 'FORBIDDEN: A Team Lead can delete only the tasks they assigned.'
    when (select role from public.profiles where id = t.assigned_by) = 'SUPER_ADMIN'
      then 'FORBIDDEN: This task was given by the Managing Director. Only tasks within your authority can be deleted.'
    else null
  end
$$;
revoke all on function private.ai_studio_delete_problem(public.ai_studio_tasks) from public, anon, authenticated;

-- 20270105000100's task details + canDelete
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
    'canEdit', t.status <> 'COMPLETED' and private.ai_studio_role() in ('ADMIN', 'HEAD', 'LEAD') and t.assignee_id <> auth.uid(),
    'canDelete', private.ai_studio_delete_problem(t) is null,
    -- what a delete would take with it: the task's place in the daily reports that picked it (the confirmation says so)
    'reportCount', (select count(distinct x.report_id) from public.ai_studio_report_tasks x where x.task_id = t.id),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'kind', u.kind, 'status', u.status, 'progress', u.progress, 'note', u.note,
                                                               'authorName', u.author_name, 'createdAt', u.created_at) order by u.seq desc)
                           from public.ai_studio_task_updates u where u.task_id = t.id), '[]'::jsonb));
end $$;
revoke all on function public.ai_studio_task_get(uuid) from public, anon;
grant execute on function public.ai_studio_task_get(uuid) to authenticated;

create or replace function public.ai_studio_task_delete(p_task uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_role();
  v_me uuid := auth.uid();
  v_by text;
  t public.ai_studio_tasks;
  v_problem text;
  v_updates integer;
  v_reports integer;
  v_lead uuid;
begin
  if v_role is null or v_role not in ('LEAD', 'HEAD') then
    raise exception 'FORBIDDEN: Only a Team Lead, a Department Head or an Operations Head can delete tasks.' using errcode = '42501';
  end if;
  select * into t from public.ai_studio_tasks where id = p_task for update;
  if t.id is null or not private.ai_studio_can_see_task(t) then
    raise exception 'NOT_FOUND: Task not found. It may already have been deleted.' using errcode = 'P0001';
  end if;
  v_problem := private.ai_studio_delete_problem(t);
  if v_problem is not null then raise exception '%', v_problem using errcode = '42501'; end if;

  select count(*) into v_updates from public.ai_studio_task_updates where task_id = t.id;
  -- the consolidated daily reports that picked this task (20270219000100_ai_studio_consolidated_reports)
  select count(distinct report_id) into v_reports from public.ai_studio_report_tasks where task_id = t.id;
  select full_name into v_by from public.profiles where id = v_me;

  perform private.write_audit('AI_STUDIO_TASK_DELETED', 'ai_studio_task', t.id, private.ai_studio_department(), null, jsonb_build_object(
    'task', jsonb_build_object('title', t.title, 'description', t.description, 'projectId', t.project_id, 'priority', t.priority, 'status', t.status,
                               'progress', t.progress, 'dueDate', t.due_date, 'assigneeId', t.assignee_id, 'assignedBy', t.assigned_by, 'createdAt', t.created_at),
    'updates', v_updates, 'reports', coalesce(v_reports, 0)));

  delete from public.notifications where entity_type = 'ai_studio_task' and entity_id = t.id;
  -- its history goes with it (cascade), and so does its part in any daily report (the report keeps its own remarks); an older one-task report keeps
  -- its text and loses only the link (set null)
  delete from public.ai_studio_tasks where id = t.id;

  perform private.notify(t.assignee_id, 'AI_STUDIO_TASK_DELETED', format('Task deleted: %s', t.title), format('%s deleted this task.', v_by), null, null,
                         jsonb_build_object('taskId', t.id));
  if t.assigned_by is distinct from t.assignee_id then
    perform private.notify(t.assigned_by, 'AI_STUDIO_TASK_DELETED', format('Task deleted: %s', t.title), format('%s deleted this task.', v_by), null, null,
                           jsonb_build_object('taskId', t.id));
  end if;
  -- a task given by another Team Lead was in the employee's own Team Lead's workload plan
  v_lead := private.direct_lead_of(t.assignee_id);
  if v_lead is not null and v_lead is distinct from t.assigned_by then
    perform private.notify(v_lead, 'AI_STUDIO_TASK_DELETED', format('Task deleted: %s', t.title), format('%s deleted this task.', v_by), null, null,
                           jsonb_build_object('taskId', t.id));
  end if;
  return jsonb_build_object('deleted', true, 'taskId', t.id, 'title', t.title, 'updates', v_updates, 'reports', coalesce(v_reports, 0));
end $$;
revoke all on function public.ai_studio_task_delete(uuid) from public, anon;
grant execute on function public.ai_studio_task_delete(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. AI Design Studio assignments (ads_assignments)
-- ---------------------------------------------------------------------------
create or replace function private.ads_delete_problem(me public.profiles, a public.ads_assignments)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when me.role not in ('TEAM_HEAD', 'DEPARTMENT_HEAD') then 'FORBIDDEN: Only a Team Lead, a Department Head or an Operations Head can delete assignments.'
    when a.assignee_id = me.id then 'FORBIDDEN: You cannot delete work that was assigned to you.'
    when a.assigned_by = me.id then null
    when me.role = 'TEAM_HEAD' then 'FORBIDDEN: A Team Lead can delete only the assignments they gave.'
    when (select role from public.profiles where id = a.assigned_by) = 'SUPER_ADMIN'
      then 'FORBIDDEN: This assignment was given by the Super Admin. Only work within your authority can be deleted.'
    else null
  end
$$;
revoke all on function private.ads_delete_problem(public.profiles, public.ads_assignments) from public, anon, authenticated;

-- 20270110000100's assignment details + canDelete
create or replace function public.ads_assignment_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles; a public.ads_assignments;
begin
  me := private.ads_actor();
  select * into a from public.ads_assignments where id = p_id and department_id = me.department_id;
  if a.id is null or not private.ads_sees_row(me.id, me.role, a.assignee_id, a.assigned_by) then
    raise exception 'NOT_FOUND: Assignment not found.' using errcode = 'P0001';
  end if;
  return private.ads_assignment_json(a) || jsonb_build_object(
    'events', private.ads_events_json('assignment', a.id),
    'members', coalesce((select jsonb_agg(private.ads_assignment_json(ch) order by ch.created_at) from public.ads_assignments ch
                          where ch.parent_id = a.id and private.ads_sees_row(me.id, me.role, ch.assignee_id, ch.assigned_by)), '[]'::jsonb),
    'canReview', (a.assignee_id <> me.id and (a.assigned_by = me.id or me.role = 'DEPARTMENT_HEAD')),
    'canUpdateStatus', (a.assignee_id = me.id),
    'canDelete', private.ads_delete_problem(me, a) is null);
end $$;
revoke all on function public.ads_assignment_get(uuid) from public, anon;
grant execute on function public.ads_assignment_get(uuid) to authenticated;

create or replace function public.ads_assignment_delete(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  a public.ads_assignments;
  v_problem text;
  v_ids uuid[];
  v_notify uuid[];
  r record;
begin
  me := private.ads_actor();
  if me.role not in ('TEAM_HEAD', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only a Team Lead, a Department Head or an Operations Head can delete assignments.' using errcode = '42501';
  end if;
  select * into a from public.ads_assignments where id = p_id and department_id = me.department_id for update;
  if a.id is null or not private.ads_sees_row(me.id, me.role, a.assignee_id, a.assigned_by) then
    raise exception 'NOT_FOUND: Assignment not found. It may already have been deleted.' using errcode = 'P0001';
  end if;
  v_problem := private.ads_delete_problem(me, a);
  if v_problem is not null then raise exception '%', v_problem using errcode = '42501'; end if;

  select array_agg(id) into v_ids from public.ads_assignments where id = a.id or parent_id = a.id;
  select array_agg(distinct x) into v_notify from (
    select assignee_id as x from public.ads_assignments where id = any (v_ids)
    union select assigned_by from public.ads_assignments where id = any (v_ids)) s
   where x is not null and x <> me.id;

  perform private.ads_log('assignment', a.id, 'DELETED', a.status, null, a.title);
  perform private.write_audit('ADS_ASSIGNMENT_DELETED', 'ads_assignment', a.id, a.department_id, null, jsonb_build_object(
    'assignment', jsonb_build_object('title', a.title, 'clientId', a.client_id, 'parentId', a.parent_id, 'priority', a.priority, 'status', a.status,
                                     'progress', a.progress, 'dueDate', a.due_date, 'assigneeId', a.assignee_id, 'assignedBy', a.assigned_by, 'createdAt', a.created_at),
    'memberPartIds', to_jsonb(array_remove(v_ids, a.id))));

  delete from public.notifications where entity_type = 'ads_assignment' and entity_id = any (v_ids);
  -- the parts passed on to Team Members go with it (cascade); reports and issues keep their text and lose only the link (set null)
  delete from public.ads_assignments where id = a.id;

  for r in select unnest(coalesce(v_notify, '{}'::uuid[])) as pid loop
    perform private.notify(r.pid, 'ADS_ASSIGNMENT_DELETED', format('Assignment deleted: %s', a.title), format('%s deleted this assignment.', me.full_name), null, null,
                           jsonb_build_object('module', 'ai-design-studio', 'assignmentId', a.id));
  end loop;
  return jsonb_build_object('deleted', true, 'id', a.id, 'title', a.title, 'memberParts', coalesce(array_length(v_ids, 1), 1) - 1);
end $$;
revoke all on function public.ads_assignment_delete(uuid) from public, anon;
grant execute on function public.ads_assignment_delete(uuid) to authenticated;

notify pgrst, 'reload schema';
