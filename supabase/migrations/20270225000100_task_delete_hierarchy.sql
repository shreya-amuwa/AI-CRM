-- =============================================================================
-- Deleting an assigned task: by team and department (docs/TASK_DELETION.md). Run after 20270224000100_notice_sales_support_audience.sql.
-- Builds on 20270220000100_task_deletion.sql (the delete functions, the confirmation, the cascade, the notifications and the audit log, all kept).
-- Safe to run twice; nothing is deleted by this file; no table or column is added.
--
-- WHAT CHANGES (who may delete; checked here, in the database, for the button and the delete alike):
--   * Team Lead: any task of a Team Member who reports directly to them (private.direct_lead_of: their manager line, or the sole Team Lead of the team),
--     whoever gave it (the Team Lead, the Department Head, the Super Admin, another Team Lead); and, as before, a task they gave. Never another Team Lead's
--     team, another department or an unrelated employee. Was: only the tasks they gave.
--   * Department Head (not an Operations Head): any task inside the department and function they head (private.head_covers), whoever gave it.
--     Was: not a task given by the Super Admin or an Operations Head.
--   * Super Admin: an explicit AI STUDIO DEPARTMENT-HEAD permission, because the Super Admin heads AI Studio: any Task module task of the AI Studio
--     department (private.ai_studio_department(), the department itself, never a name of a person) and any AI Studio project task. Nothing else: a task
--     of Sales, Support, Accounts, HR, AI Design Studio or any other department stays refused. Was: no delete at all.
--   * UNCHANGED: Operations Heads (their function scope; not a task the Super Admin gave), Team Members, Telecallers, Business Associates and every
--     other role (no delete), and the rule that nobody deletes a task assigned to themselves.
--   * AI Design Studio follows the same Team Lead / Department Head rules; the Super Admin is not an AI Design Studio actor and gets nothing there.
-- THE CARDS: the delete option moves onto the task cards too, so the lists say which tasks the caller may delete, in the same request:
--   * ai_studio_tasks_page and ads_assignments_list items carry canDelete;
--   * the Task module reads its tasks straight from the table, so work_tasks_deletable(ids) answers for a whole list in ONE call.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The Task module (work_tasks): the rule (copy of 20270220000100; changed where marked 20270225000100)
-- ---------------------------------------------------------------------------
create or replace function private.work_task_delete_problem(p_me uuid, t public.work_tasks)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when me.id is null then 'FORBIDDEN: Your account is not active.'
    -- (20270225000100) the Super Admin, as the Department Head of AI Studio: AI Studio's tasks only
    when me.role = 'SUPER_ADMIN' then case
      when t.assignee_id = me.id then 'FORBIDDEN: You cannot delete a task that was assigned to you.'
      when private.ai_studio_department() is not null and private.base_department(t.department_id) = private.ai_studio_department() then null
      else 'FORBIDDEN: The Super Admin deletes only AI Studio tasks, as the Department Head of AI Studio.' end
    when me.role not in ('TEAM_HEAD', 'DEPARTMENT_HEAD') then 'FORBIDDEN: Only a Team Lead, a Department Head or an Operations Head can delete tasks.'
    when t.assignee_id = me.id then 'FORBIDDEN: You cannot delete a task that was assigned to you.'
    when t.assigned_by = me.id then null
    -- (20270225000100) a Team Lead: any task of a member who reports directly to them, whoever gave it
    when me.role = 'TEAM_HEAD' then case
      when private.direct_lead_of(t.assignee_id) = me.id then null
      else 'FORBIDDEN: A Team Lead can delete only the tasks of their own team members.' end
    -- an Operations Head: unchanged (not a task the Super Admin gave; their departments and functions)
    when me.is_operations_head and giver.role = 'SUPER_ADMIN'
      then 'FORBIDDEN: This task was given by the Super Admin. Only tasks within your authority can be deleted.'
    when me.is_operations_head and exists (
           select 1 from private.scopes_of(me.id) s
            where s.department_id = private.base_department(t.department_id)
              and (s.division is null
                   or coalesce((select tm.division::text from public.teams tm where tm.id = coalesce(t.team_id, who.team_id)), 'GENERAL') in ('GENERAL', s.division))) then null
    -- (20270225000100) a Department Head: any task of the department and function they head, whoever gave it
    when not me.is_operations_head and private.head_covers(me.id, private.base_department(t.department_id), coalesce(t.team_id, who.team_id)) then null
    else 'FORBIDDEN: This task is outside the department and teams you manage.'
  end
    from (select 1) one
    left join public.profiles me on me.id = p_me and me.status = 'ACTIVE'
    left join public.profiles giver on giver.id = t.assigned_by
    left join public.profiles who on who.id = t.assignee_id
$$;
revoke all on function private.work_task_delete_problem(uuid, public.work_tasks) from public, anon, authenticated;

-- may the caller reach this task for a delete: the tasks they may already open, or one the rule above lets them delete (a task another Team Lead gave one
-- of their members is theirs to delete even where it is not in their own list)
create or replace function private.work_task_delete_reachable(p_me uuid, t public.work_tasks)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.can_view_work_task(t.id) or private.work_task_delete_problem(p_me, t) is null, false)
$$;
revoke all on function private.work_task_delete_reachable(uuid, public.work_tasks) from public, anon, authenticated;

-- the confirmation's data (copy of 20270220000100; the reach check changed)
create or replace function public.work_task_delete_preview(p_task uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.work_tasks;
  v_problem text;
begin
  select * into t from public.work_tasks where id = p_task;
  if t.id is null or not private.work_task_delete_reachable(private.my_id(), t) then
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

-- the delete (copy of 20270220000100; the Super Admin may call it now, and the reach check changed; the rest is unchanged)
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
  if me.id is null or me.role not in ('TEAM_HEAD', 'DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only a Team Lead, a Department Head or an Operations Head can delete tasks.' using errcode = '42501';
  end if;
  -- the row lock makes two deletes (or a delete and an update) of the same task wait for each other
  select * into t from public.work_tasks where id = p_task for update;
  if t.id is null or not private.work_task_delete_reachable(me.id, t) then
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

-- (20270225000100) which of these tasks the caller may delete: one call for a whole list of cards (at most 1000 ids; unknown or unreachable ids are left out)
create or replace function public.work_tasks_deletable(p_ids uuid[])
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.my_id();
begin
  if coalesce(cardinality(p_ids), 0) > 1000 then
    raise exception 'VALIDATION_ERROR: Ask for at most 1000 tasks at a time.' using errcode = '22023';
  end if;
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and status = 'ACTIVE' and role in ('TEAM_HEAD', 'DEPARTMENT_HEAD', 'SUPER_ADMIN')) then
    return '{}';   -- nobody else deletes anything: no need to look at the tasks
  end if;
  return coalesce((select array_agg(t.id) from public.work_tasks t
                    where t.id = any (p_ids) and private.work_task_delete_problem(v_me, t) is null and private.work_task_delete_reachable(v_me, t)), '{}');
end $$;
revoke all on function public.work_tasks_deletable(uuid[]) from public, anon;
grant execute on function public.work_tasks_deletable(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. AI Studio project tasks (copy of 20270220000100's rule; changed where marked 20270225000100)
-- ---------------------------------------------------------------------------
create or replace function private.ai_studio_delete_problem(t public.ai_studio_tasks)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when private.ai_studio_role() is null then 'FORBIDDEN: This page is only for the people of AI Studio.'
    -- (20270225000100) the Managing Director (Super Admin) is the Department Head of AI Studio: any AI Studio task, whoever gave it
    when private.ai_studio_role() = 'ADMIN' then case
      when t.assignee_id = auth.uid() then 'FORBIDDEN: You cannot delete a task that was assigned to you.' end
    when private.ai_studio_role() not in ('LEAD', 'HEAD') then 'FORBIDDEN: Only a Team Lead, a Department Head or an Operations Head can delete tasks.'
    when t.assignee_id = auth.uid() then 'FORBIDDEN: You cannot delete a task that was assigned to you.'
    when t.assigned_by = auth.uid() then null
    -- (20270225000100) a Team Lead: any task of a member who reports directly to them (a cross-team task given by another Team Lead too)
    when private.ai_studio_role() = 'LEAD' then case
      when private.direct_lead_of(t.assignee_id) = auth.uid() then null
      else 'FORBIDDEN: A Team Lead can delete only the tasks of their own team members.' end
    -- an Operations Head with the AI Studio head role keeps the earlier limit; the Department Head deletes any AI Studio task, whoever gave it
    when coalesce((select is_operations_head from public.profiles where id = auth.uid()), false)
         and (select role from public.profiles where id = t.assigned_by) = 'SUPER_ADMIN'
      then 'FORBIDDEN: This task was given by the Managing Director. Only tasks within your authority can be deleted.'
    else null
  end
$$;
revoke all on function private.ai_studio_delete_problem(public.ai_studio_tasks) from public, anon, authenticated;

-- the delete (copy of 20270220000100; the Managing Director may call it now; the rest is unchanged)
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
  if v_role is null or v_role not in ('LEAD', 'HEAD', 'ADMIN') then
    raise exception 'FORBIDDEN: Only a Team Lead, a Department Head or an Operations Head can delete tasks.' using errcode = '42501';
  end if;
  select * into t from public.ai_studio_tasks where id = p_task for update;
  if t.id is null or not private.ai_studio_can_see_task(t) then
    raise exception 'NOT_FOUND: Task not found. It may already have been deleted.' using errcode = 'P0001';
  end if;
  v_problem := private.ai_studio_delete_problem(t);
  if v_problem is not null then raise exception '%', v_problem using errcode = '42501'; end if;

  select count(*) into v_updates from public.ai_studio_task_updates where task_id = t.id;
  select count(distinct report_id) into v_reports from public.ai_studio_report_tasks where task_id = t.id;
  select full_name into v_by from public.profiles where id = v_me;

  perform private.write_audit('AI_STUDIO_TASK_DELETED', 'ai_studio_task', t.id, private.ai_studio_department(), null, jsonb_build_object(
    'task', jsonb_build_object('title', t.title, 'description', t.description, 'projectId', t.project_id, 'priority', t.priority, 'status', t.status,
                               'progress', t.progress, 'dueDate', t.due_date, 'assigneeId', t.assignee_id, 'assignedBy', t.assigned_by, 'createdAt', t.created_at),
    'updates', v_updates, 'reports', coalesce(v_reports, 0)));

  delete from public.notifications where entity_type = 'ai_studio_task' and entity_id = t.id;
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

-- the task lists (copy of 20270221000100's ai_studio_tasks_page; each item now says whether the caller may delete it)
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
  select coalesce(jsonb_agg(private.ai_studio_task_row(x) || jsonb_build_object('canDelete', private.ai_studio_delete_problem(x) is null)
                            order by (x.status = 'COMPLETED'), x.due_date nulls last, x.created_at desc), '[]'::jsonb) into v_items
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

-- ---------------------------------------------------------------------------
-- 3. AI Design Studio assignments (copy of 20270220000100's rule; changed where marked 20270225000100)
-- ---------------------------------------------------------------------------
create or replace function private.ads_delete_problem(me public.profiles, a public.ads_assignments)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when me.role not in ('TEAM_HEAD', 'DEPARTMENT_HEAD') then 'FORBIDDEN: Only a Team Lead, a Department Head or an Operations Head can delete assignments.'
    when a.assignee_id = me.id then 'FORBIDDEN: You cannot delete work that was assigned to you.'
    when a.assigned_by = me.id then null
    -- (20270225000100) a Team Lead: the work of a member who reports directly to them, whoever gave it
    when me.role = 'TEAM_HEAD' then case
      when private.direct_lead_of(a.assignee_id) = me.id then null
      else 'FORBIDDEN: A Team Lead can delete only the work of their own team members.' end
    -- an Operations Head keeps the earlier limit; the Department Head deletes any work of the department, whoever gave it
    when me.is_operations_head and (select role from public.profiles where id = a.assigned_by) = 'SUPER_ADMIN'
      then 'FORBIDDEN: This assignment was given by the Super Admin. Only work within your authority can be deleted.'
    else null
  end
$$;
revoke all on function private.ads_delete_problem(public.profiles, public.ads_assignments) from public, anon, authenticated;

-- the list (copy of 20270110000100; each item now says whether the caller may delete it)
create or replace function public.ads_assignments_list(p_view text default 'all', p_status text default null, p_client uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := private.ads_actor();
  return coalesce((
    select jsonb_agg(private.ads_assignment_json(a) || jsonb_build_object('canDelete', private.ads_delete_problem(me, a) is null)
                     order by a.due_date nulls last, a.created_at desc)
      from (select * from public.ads_assignments a
             where a.department_id = me.department_id
               and private.ads_sees_row(me.id, me.role, a.assignee_id, a.assigned_by)
               and (p_view = 'all' or (p_view = 'mine' and a.assignee_id = me.id) or (p_view = 'team' and a.assignee_id <> me.id))
               and (p_status is null or a.status = upper(p_status))
               and (p_client is null or a.client_id = p_client)
             order by a.due_date nulls last, a.created_at desc limit 300) a), '[]'::jsonb);
end $$;
revoke all on function public.ads_assignments_list(text, text, uuid) from public, anon;
grant execute on function public.ads_assignments_list(text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
