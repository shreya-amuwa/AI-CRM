-- =============================================================================
-- Task hierarchy: Operations Head -> Department Head -> Team Lead -> Team Member. Run after 20261230000200. Safe to run again.
--
-- Until now an Operations Head (a DEPARTMENT_HEAD with is_operations_head) used the Department Head's "assign to a Team Lead" and so saw Team
-- Leads. Now:
--   * The Operations Head gives a task to an active Department Head of a department and function they are authorised for
--     (assign_task_to_department_head; the people offered come from operations_task_assignees).
--   * The Department Head passes it to one or more of their eligible Team Leads, each with instructions and a due date
--     (delegate_task_to_team_lead). The Operations Head's task stays the parent; nothing is copied over it.
--   * The Team Lead either works on it themselves (take_task_myself: no new task, the same row is theirs) or hands it to their own Team Members
--     (delegate_task_to_members, which already existed; it now accepts a Team Lead task that came from a Department Head's delegation).
--   * Everyone above a task in its chain can read it (who it went to, progress, status, updates); task_hierarchy() returns the whole chain with
--     names for the screens. Progress still rolls up only through each owner's own updates: a parent is never completed by a child.
-- Reuses work_tasks (parent_id) and work_task_updates. Direct-manager isolation is unchanged: a Team Lead hands work only to their own
-- members, a Department Head only to Team Leads of the department and function they head, an Operations Head only within their scope.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Shape
-- ---------------------------------------------------------------------------
alter table public.work_tasks
  add column if not exists division text,      -- the function an Operations Head's task is for (SALES / SUPPORT; NULL = whole department)
  add column if not exists handling text,      -- what the owner chose: SELF (works on it themselves) or DELEGATED (handed it down)
  add column if not exists handled_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'work_tasks_division_check') then
    alter table public.work_tasks add constraint work_tasks_division_check check (division is null or division in ('SALES', 'SUPPORT'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'work_tasks_handling_check') then
    alter table public.work_tasks add constraint work_tasks_handling_check check (handling is null or handling in ('SELF', 'DELEGATED'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The chain of a task
-- ---------------------------------------------------------------------------
-- The task and its ancestors (at most a few levels).
create or replace function private.task_chain(p_task uuid)
returns table (id uuid, depth integer, assigned_by uuid, assignee_id uuid) language sql stable security definer set search_path = '' as $$
  with recursive up as (
    select t.id, t.parent_id, 0 as depth, t.assigned_by, t.assignee_id from public.work_tasks t where t.id = p_task
    union all
    select p.id, p.parent_id, up.depth + 1, p.assigned_by, p.assignee_id from public.work_tasks p join up on p.id = up.parent_id where up.depth < 8)
  select up.id, up.depth, up.assigned_by, up.assignee_id from up
$$;
revoke all on function private.task_chain(uuid) from public, anon, authenticated;

-- Is the signed-in person above (or on) this task in its chain: they gave or own one of its ancestors?
create or replace function private.task_in_my_chain(p_task uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.task_chain(p_task) c where c.assigned_by = private.my_id() or c.assignee_id = private.my_id())
$$;
revoke all on function private.task_in_my_chain(uuid) from public, anon;
-- used by the work_tasks policy: it answers only about the signed-in person
grant execute on function private.task_in_my_chain(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Operations Head -> Department Head
-- ---------------------------------------------------------------------------
-- The Department Heads an Operations Head may give a task to: active, not an Operations Head, heading a department (and function) the
-- Operations Head is authorised for. One row per (head, department, function).
create or replace function private.operations_task_targets(p_oh uuid)
returns table (head_id uuid, department_id uuid, division text) language sql stable security definer set search_path = '' as $$
  select distinct h.id, hs.department_id, coalesce(os.division, hs.division)
    from private.scopes_of(p_oh) os
    join public.profiles h on h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE' and h.id <> p_oh
    cross join lateral private.scopes_of(h.id) hs
   where hs.department_id = os.department_id
     -- same function, or one of the two heads covers the whole department
     and (os.division is null or hs.division is null or os.division = hs.division)
$$;
revoke all on function private.operations_task_targets(uuid) from public, anon, authenticated;

create or replace function public.operations_task_assignees()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null or me.role <> 'DEPARTMENT_HEAD' or not me.is_operations_head then
    raise exception 'FORBIDDEN: Only an Operations Head gives tasks to Department Heads.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'name', h.full_name, 'departmentId', d.id, 'department', d.name, 'function', coalesce(x.division, 'ALL'))
                     order by d.name, x.division nulls first, h.full_name)
      from private.operations_task_targets(me.id) x
      join public.profiles h on h.id = x.head_id
      join public.departments d on d.id = x.department_id), '[]'::jsonb);
end $$;
revoke all on function public.operations_task_assignees() from public, anon;
grant execute on function public.operations_task_assignees() to authenticated;

create or replace function public.assign_task_to_department_head(
  p_assignee uuid, p_department uuid, p_division text, p_title text, p_description text, p_priority text, p_due date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  head public.profiles;
  v_div text := nullif(nullif(upper(btrim(coalesce(p_division, ''))), ''), 'ALL');
  v_dept uuid := private.base_department(p_department);
  v_id uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null or me.role <> 'DEPARTMENT_HEAD' or not me.is_operations_head then
    raise exception 'FORBIDDEN: Only an Operations Head gives tasks to Department Heads.' using errcode = '42501';
  end if;
  if v_div is not null and v_div not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales, Support or the whole department.' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(p_title, ''))) < 1 or length(btrim(p_title)) > 200 then
    raise exception 'VALIDATION_ERROR: Enter the task (up to 200 characters).' using errcode = 'P0001';
  end if;
  if length(coalesce(p_description, '')) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep the details under 4000 characters.' using errcode = 'P0001';
  end if;
  if coalesce(p_priority, 'MEDIUM') not in ('LOW', 'MEDIUM', 'HIGH') then
    raise exception 'VALIDATION_ERROR: Unknown priority.' using errcode = 'P0001';
  end if;
  if p_due is not null and p_due < private.office_today() then
    raise exception 'VALIDATION_ERROR: The due date cannot be in the past.' using errcode = 'P0001';
  end if;
  -- the head must be one this Operations Head may reach, for that department and function (never a Team Lead, never another scope)
  if not exists (select 1 from private.operations_task_targets(me.id) x
                  where x.head_id = p_assignee and x.department_id = v_dept and x.division is not distinct from v_div) then
    raise exception 'VALIDATION_ERROR: Choose an active Department Head of a department and function you manage.' using errcode = 'P0001';
  end if;
  select * into head from public.profiles where id = p_assignee;

  insert into public.work_tasks (department_id, team_id, division, title, description, priority, due_date, assigned_by, assignee_id)
  values (v_dept, null, v_div, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_priority, 'MEDIUM'), p_due, me.id, head.id)
  returning id into v_id;
  perform private.write_audit('TASK_ASSIGNED', 'work_task', v_id, v_dept, null,
    jsonb_build_object('assignee', head.id, 'title', btrim(p_title), 'level', 'OPERATIONS_HEAD_TO_DEPARTMENT_HEAD', 'function', v_div));
  perform private.notify(head.id, 'TASK_ASSIGNED', format('New task from the Operations Head: %s', btrim(p_title)),
    format('Assigned by %s%s', me.full_name, case when p_due is null then '' else format(' · due %s', to_char(p_due, 'DD Mon')) end),
    'work_task', v_id);
  return v_id;
end $$;
revoke all on function public.assign_task_to_department_head(uuid, uuid, text, text, text, text, date) from public, anon;
grant execute on function public.assign_task_to_department_head(uuid, uuid, text, text, text, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Department Head -> Team Lead (a task the Department Head received)
-- ---------------------------------------------------------------------------
create or replace function public.delegate_task_to_team_lead(p_task uuid, p_lead uuid, p_instructions text, p_due date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.work_tasks;
  lead public.profiles;
  v_note text := nullif(btrim(coalesce(p_instructions, '')), '');
  v_due date := coalesce(p_due, null);
  v_id uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.work_tasks where id = p_task for update;
  if t.id is null or me.id is null or t.assignee_id is distinct from me.id or me.role <> 'DEPARTMENT_HEAD' or me.is_operations_head then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0001';
  end if;
  if t.status = 'COMPLETED' then
    raise exception 'CONFLICT: This task is already completed.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_note, '')) > 500 then
    raise exception 'VALIDATION_ERROR: Keep the instructions under 500 characters.' using errcode = 'P0001';
  end if;
  if v_due is not null and v_due < private.office_today() then
    raise exception 'VALIDATION_ERROR: The due date cannot be in the past.' using errcode = 'P0001';
  end if;
  select * into lead from public.profiles where id = p_lead;
  -- an active Team Lead of the task's department whom this head covers, on the task's function
  if lead.id is null or lead.role <> 'TEAM_HEAD' or lead.status <> 'ACTIVE'
     or private.base_department(lead.department_id) <> t.department_id
     or not private.head_covers(me.id, t.department_id, lead.team_id)
     or not private.team_in_division(lead.team_id, t.division) then
    raise exception 'VALIDATION_ERROR: Choose an active Team Lead of this department and function.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.work_tasks c where c.parent_id = t.id and c.assignee_id = lead.id) then
    raise exception 'CONFLICT: % already has this task.', lead.full_name using errcode = 'P0001';
  end if;

  insert into public.work_tasks (department_id, team_id, parent_id, division, title, description, priority, due_date, assigned_by, assignee_id, assignment_note)
  values (t.department_id, lead.team_id, t.id, t.division, t.title, t.description, t.priority, coalesce(v_due, t.due_date), me.id, lead.id, v_note)
  returning id into v_id;
  update public.work_tasks set handling = 'DELEGATED', handled_at = coalesce(handled_at, now()),
         status = case when status = 'ASSIGNED' then 'IN_PROGRESS' else status end, updated_at = now()
   where id = t.id;
  perform private.write_audit('TASK_DELEGATED', 'work_task', v_id, t.department_id, lead.team_id,
    jsonb_build_object('parent', t.id, 'assignee', lead.id, 'level', 'DEPARTMENT_HEAD_TO_TEAM_LEAD'));
  perform private.notify(lead.id, 'TASK_ASSIGNED', format('New task: %s', t.title),
    format('Assigned by %s%s%s', me.full_name, case when coalesce(v_due, t.due_date) is null then '' else format(' · due %s', to_char(coalesce(v_due, t.due_date), 'DD Mon')) end,
           coalesce(' · ' || left(v_note, 120), '')),
    'work_task', v_id);
  perform private.notify(t.assigned_by, 'TASK_UPDATE', format('%s passed a task to %s', me.full_name, lead.full_name), t.title, 'work_task', t.id);
  return v_id;
end $$;
revoke all on function public.delegate_task_to_team_lead(uuid, uuid, text, date) from public, anon;
grant execute on function public.delegate_task_to_team_lead(uuid, uuid, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Team Lead: work on it myself (the same task; no copy is made)
-- ---------------------------------------------------------------------------
create or replace function public.take_task_myself(p_task uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.work_tasks;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 2000);
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.work_tasks where id = p_task for update;
  if t.id is null or me.id is null or t.assignee_id is distinct from me.id or me.role <> 'TEAM_HEAD' then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.work_tasks c where c.parent_id = t.id) then
    raise exception 'CONFLICT: This task is already given to team members.' using errcode = 'P0001';
  end if;
  if t.status = 'COMPLETED' then
    raise exception 'CONFLICT: This task is already completed.' using errcode = 'P0001';
  end if;
  if t.handling = 'SELF' then
    return;                                             -- a second click changes nothing
  end if;
  update public.work_tasks set handling = 'SELF', handled_at = now(), status = case when status = 'ASSIGNED' then 'IN_PROGRESS' else status end,
         last_update_note = coalesce(v_note, 'Working on it myself'), last_update_at = now(), updated_at = now()
   where id = t.id returning * into t;
  insert into public.work_task_updates (task_id, author_id, status, progress, note) values (t.id, me.id, t.status, t.progress, coalesce(v_note, 'Working on it myself'));
  perform private.write_audit('TASK_TAKEN_SELF', 'work_task', t.id, t.department_id, t.team_id, '{}'::jsonb);
  perform private.notify(t.assigned_by, 'TASK_UPDATE', format('%s is working on it personally', me.full_name), t.title, 'work_task', t.id);
end $$;
revoke all on function public.take_task_myself(uuid, text) from public, anon;
grant execute on function public.take_task_myself(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Team Lead -> Team Members, and who can read a task (copies of the latest definitions, changed where marked)
-- ---------------------------------------------------------------------------
-- (20261224000300) a Team Lead's task may now also be one a Department Head passed down (it has a parent); only a member-level task is refused.

create or replace function public.delegate_task_to_members(p_task uuid, p_assignments jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.work_tasks;
  m public.profiles;
  a jsonb;
  v_work text;
  v_id uuid;
  n integer := 0;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.work_tasks where id = p_task for update;
  if t.id is null or me.id is null or t.assignee_id is distinct from me.id or me.role <> 'TEAM_HEAD' then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0001';
  end if;
  -- a Team Lead's task (from a Department Head, directly or passed down from an Operations Head); never a member's task
  if t.parent_id is not null and not exists (select 1 from public.work_tasks p join public.profiles a on a.id = p.assignee_id
                                              where p.id = t.parent_id and a.role = 'DEPARTMENT_HEAD') then
    raise exception 'VALIDATION_ERROR: This task is already a team member task.' using errcode = 'P0001';
  end if;
  if t.handling = 'SELF' and t.status = 'COMPLETED' then
    raise exception 'CONFLICT: This task is already completed.' using errcode = 'P0001';
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' or jsonb_array_length(p_assignments) = 0 then
    raise exception 'VALIDATION_ERROR: Choose at least one team member.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_assignments) > 50 then
    raise exception 'VALIDATION_ERROR: Too many team members at once.' using errcode = 'P0001';
  end if;

  for a in select * from jsonb_array_elements(p_assignments) loop
    if jsonb_typeof(a) <> 'object' or (a ->> 'memberId') !~* '^[0-9a-f-]{36}$' then
      raise exception 'VALIDATION_ERROR: Choose the team members again.' using errcode = 'P0001';
    end if;
    v_work := nullif(btrim(coalesce(a ->> 'work', '')), '');
    if length(v_work) > 500 then
      raise exception 'VALIDATION_ERROR: Keep each member''s share under 500 characters.' using errcode = 'P0001';
    end if;
    select * into m from public.profiles where id = (a ->> 'memberId')::uuid;
    if m.id is null or not private.is_ordinary_member(m) or m.status <> 'ACTIVE' or private.direct_lead_of(m.id) is distinct from me.id then
      raise exception 'VALIDATION_ERROR: % is not an active member of your team.', coalesce(m.full_name, 'This person') using errcode = 'P0001';
    end if;
    if exists (select 1 from public.work_tasks where parent_id = t.id and assignee_id = m.id) then
      continue;                                       -- a double click or a retry: never a second copy
    end if;
    insert into public.work_tasks (department_id, team_id, parent_id, division, title, description, priority, due_date, assigned_by, assignee_id, assignment_note)
    values (t.department_id, me.team_id, t.id, t.division, t.title, t.description, t.priority, t.due_date, me.id, m.id, v_work)
    returning id into v_id;
    n := n + 1;
    perform private.notify(m.id, 'TASK_ASSIGNED', format('New task: %s', t.title),
      format('Assigned by %s%s%s', me.full_name, case when t.due_date is null then '' else format(' · due %s', to_char(t.due_date, 'DD Mon')) end,
             case when v_work is null then '' else ' · ' || left(v_work, 120) end),
      'work_task', v_id);
  end loop;
  if n = 0 then
    raise exception 'CONFLICT: These team members already have this task.' using errcode = 'P0001';
  end if;
  update public.work_tasks set status = case when status = 'ASSIGNED' then 'IN_PROGRESS' else status end,
         handling = 'DELEGATED', handled_at = coalesce(handled_at, now())
   where id = t.id;
  perform private.write_audit('TASK_DELEGATED', 'work_task', t.id, t.department_id, t.team_id,
    jsonb_build_object('members', (select jsonb_agg(x ->> 'memberId') from jsonb_array_elements(p_assignments) x), 'with_shares', true));
  -- the Department Head who gave the task learns who has it now
  if t.assigned_by is not null and t.assigned_by <> me.id then
    perform private.notify(t.assigned_by, 'TASK_DELEGATED', format('%s shared out: %s', me.full_name, t.title),
      format('Now with %s team member(s).', (select count(*) from public.work_tasks c where c.parent_id = t.id)), 'work_task', t.id);
  end if;
  return n;
end $$;

-- (20261224000100) an Operations Head gives tasks to Department Heads, not straight to Team Leads.

create or replace function public.assign_task_to_team_lead(
  p_assignee uuid, p_title text, p_description text, p_priority text, p_due date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  lead public.profiles;
  v_id uuid;
begin
  select * into me from public.profiles where id = private.my_id();
  if me.id is null or me.role not in ('DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only a department head can assign tasks to team leads.' using errcode = '42501';
  end if;
  if me.role = 'DEPARTMENT_HEAD' and me.is_operations_head then
    raise exception 'FORBIDDEN: An Operations Head gives tasks to Department Heads; the Department Head passes them to a Team Lead.' using errcode = '42501';
  end if;
  select * into lead from public.profiles where id = p_assignee;
  if lead.id is null or lead.role <> 'TEAM_HEAD' or lead.status <> 'ACTIVE'
     or (me.role = 'DEPARTMENT_HEAD' and lead.department_id is distinct from private.scoped_department(me.id, me.department_id)) then
    raise exception 'VALIDATION_ERROR: Choose an active team lead of your department.' using errcode = 'P0001';
  end if;
  -- the function too: a head working one side (Sales or Support) gives tasks to that side's Team Leads only
  if me.role = 'DEPARTMENT_HEAD' and not private.sales_scope_team(lead.team_id) then
    raise exception 'FORBIDDEN: You give tasks to the % teams only.', initcap(private.active_head_division()) using errcode = '42501';
  end if;
  if coalesce(p_priority, 'MEDIUM') not in ('LOW', 'MEDIUM', 'HIGH') then
    raise exception 'VALIDATION_ERROR: Unknown priority.' using errcode = 'P0001';
  end if;

  insert into public.work_tasks (department_id, team_id, title, description, priority, due_date, assigned_by, assignee_id)
  values (lead.department_id, lead.team_id, trim(p_title), nullif(trim(coalesce(p_description, '')), ''),
          coalesce(p_priority, 'MEDIUM'), p_due, me.id, lead.id)
  returning id into v_id;

  perform private.write_audit('TASK_ASSIGNED', 'work_task', v_id, lead.department_id, lead.team_id,
    jsonb_build_object('assignee', lead.id, 'title', p_title));
  perform private.notify(lead.id, 'TASK_ASSIGNED', format('New task: %s', trim(p_title)),
    format('Assigned by %s%s', me.full_name, case when p_due is null then '' else format(' · due %s', to_char(p_due, 'DD Mon')) end),
    'work_task', v_id);
  return v_id;
end $$;

-- (20261225000100) + everyone above a task in its chain; a Department Head does not read another function's Operations Head task.

create or replace function private.can_view_work_task(p_task uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.work_tasks t
    where t.id = p_task and (
      t.assignee_id = private.my_id() or t.assigned_by = private.my_id()
      or private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD' and t.department_id = private.my_department_id() and private.sales_scope_team(t.team_id)
          and (t.division is null or coalesce(private.scope_division_in(private.my_id(), t.department_id), t.division) = t.division))
      or private.task_in_my_chain(t.id)
      or (private.my_role() = 'TEAM_HEAD' and private.lead_sees(t.team_id, t.assignee_id))))
$$;


-- ---------------------------------------------------------------------------
-- 7. The whole chain of a task, with names (Operations Head -> Department Head -> Team Lead -> Team Member)
-- ---------------------------------------------------------------------------
create or replace function private.task_node(p_task uuid, p_depth integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'parentId', t.parent_id, 'title', t.title, 'description', t.description, 'assignmentNote', t.assignment_note,
    'priority', t.priority, 'status', t.status, 'progress', t.progress, 'function', coalesce(t.division, 'ALL'), 'handling', t.handling,
    'assignee', jsonb_build_object('id', a.id, 'name', a.full_name,
                  'role', case when a.role = 'DEPARTMENT_HEAD' and a.is_operations_head then 'OPERATIONS_HEAD' else a.role::text end),
    'assignedBy', jsonb_build_object('id', b.id, 'name', b.full_name),
    'department', (select d.name from public.departments d where d.id = t.department_id),
    'team', (select tm.name from public.teams tm where tm.id = t.team_id),
    'assignedAt', t.created_at, 'dueDate', t.due_date, 'completedAt', t.completed_at,
    'latestUpdate', case when t.last_update_note is null then null else jsonb_build_object('note', t.last_update_note, 'at', t.last_update_at) end,
    'children', case when p_depth >= 4 then '[]'::jsonb else coalesce((
        select jsonb_agg(private.task_node(c.id, p_depth + 1) order by c.created_at) from public.work_tasks c where c.parent_id = t.id), '[]'::jsonb) end)
    from public.work_tasks t
    left join public.profiles a on a.id = t.assignee_id
    left join public.profiles b on b.id = t.assigned_by
   where t.id = p_task
$$;
revoke all on function private.task_node(uuid, integer) from public, anon, authenticated;

-- One task with everything below it. Only someone in its chain (or the Super Admin) may read it.
create or replace function public.task_hierarchy(p_task uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_id() is null or not (private.task_in_my_chain(p_task) or private.my_role() = 'SUPER_ADMIN') then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0001';
  end if;
  return private.task_node(p_task, 0);
end $$;
revoke all on function public.task_hierarchy(uuid) from public, anon;
grant execute on function public.task_hierarchy(uuid) to authenticated;

-- The Operations Head's tasks (what they gave to Department Heads), each with its whole chain and the counts of the leaf work.
create or replace function public.operations_tasks()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null or me.role <> 'DEPARTMENT_HEAD' or not me.is_operations_head then
    raise exception 'FORBIDDEN: Only an Operations Head opens these tasks.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(private.task_node(t.id, 0) order by t.created_at desc)
                     from (select * from public.work_tasks x where x.assigned_by = me.id and x.parent_id is null order by x.created_at desc limit 200) t), '[]'::jsonb);
end $$;
revoke all on function public.operations_tasks() from public, anon;
grant execute on function public.operations_tasks() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Operations Head: each person's daily reports and tasks in a period (read-only), within the department and function they supervise
-- ---------------------------------------------------------------------------
-- Department Heads, Team Leads and Team Members of the scope, with their submitted daily reports (drafts never) and their task counts.
create or replace function public.operations_people_daily(p_department uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.base_department(p_department);
  v_div text;
  v_sa boolean := private.report_level() = 'SUPER_ADMIN';
begin
  if private.report_level() not in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only Operations Heads can open the company reports.' using errcode = '42501';
  end if;
  if v_dept is null or v_dept not in (select private.report_scope_departments()) then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'VALIDATION_ERROR: Choose a period of up to three months.' using errcode = 'P0001';
  end if;
  v_div := case when v_sa then null else private.scope_division_in(auth.uid(), v_dept) end;
  return jsonb_build_object('departmentId', v_dept, 'department', (select d.name from public.departments d where d.id = v_dept),
    'function', coalesce(v_div, 'ALL'), 'from', p_from, 'to', p_to,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.id, 'name', p.full_name, 'kind', p.kind,
          'teamId', p.team_id, 'team', (select t.name from public.teams t where t.id = p.team_id),
          'teamLead', case when p.kind = 'MEMBER' then (select l.full_name from public.profiles l where l.id = private.direct_lead_of(p.id)) end,
          'teamLeadId', case when p.kind = 'MEMBER' then private.direct_lead_of(p.id) end,
          'tasks', (select jsonb_build_object(
                      'assigned', count(*),
                      'completed', count(*) filter (where w.status = 'COMPLETED'),
                      'pending', count(*) filter (where w.status <> 'COMPLETED'),
                      'overdue', count(*) filter (where w.status <> 'COMPLETED' and w.due_date < private.office_today()))
                      from public.work_tasks w
                     where w.assignee_id = p.id
                       and (w.created_at::date between p_from and p_to or w.due_date between p_from and p_to
                            or (w.status <> 'COMPLETED' and w.created_at::date <= p_to))),
          'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'date', r.report_date, 'title', r.title, 'status', r.status,
                                   'teamLeadStatus', r.tl_status, 'departmentHeadStatus', r.dh_status, 'submittedAt', r.submitted_at) order by r.report_date desc)
                                 from public.work_reports r
                                where r.author_id = p.id and r.status <> 'DRAFT' and r.report_date between p_from and p_to), '[]'::jsonb))
        order by case p.kind when 'DEPARTMENT_HEAD' then 0 when 'TEAM_LEAD' then 1 else 2 end, p.full_name)
        from private.report_people(v_dept, null) p
       where v_div is null
          or (p.kind = 'DEPARTMENT_HEAD' and exists (select 1 from public.profiles a where a.id = p.id and (a.head_division is null or a.head_division = v_div)))
          or (p.kind <> 'DEPARTMENT_HEAD' and p.team_id is not null and private.team_in_division(p.team_id, v_div))), '[]'::jsonb));
end $$;
revoke all on function public.operations_people_daily(uuid, date, date) from public, anon;
grant execute on function public.operations_people_daily(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Who reads work_tasks (the policy of 20261225000100, plus the chain rule and the function of an Operations Head's task)
-- ---------------------------------------------------------------------------
drop policy if exists work_tasks_select on public.work_tasks;
create policy work_tasks_select on public.work_tasks for select to authenticated
  using (assignee_id = (select private.my_id()) or assigned_by = (select private.my_id())
      or ((select private.my_role()) = 'SUPER_ADMIN'::public.app_role)
      or ((select private.my_role()) = 'DEPARTMENT_HEAD'::public.app_role and department_id = (select private.my_department_id()) and private.sales_scope_team(team_id)
          and (division is null or coalesce(private.scope_division_in((select private.my_id()), department_id), division) = division))
      or ((select private.my_role()) = 'TEAM_HEAD'::public.app_role and private.lead_sees(team_id, assignee_id))
      -- everyone above a task in its chain (the Operations Head who gave it, the Department Head who passed it on)
      or (parent_id is not null and private.task_in_my_chain(id)));


notify pgrst, 'reload schema';
