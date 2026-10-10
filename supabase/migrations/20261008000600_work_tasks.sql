-- =============================================================================
-- Work tasks: Department Head → Team Lead → Team Member, updates flow back up.
--
--  * A Department Head assigns a task to a Team Lead of the department
--    (work_tasks row with parent_id null).
--  * The Team Lead assigns the same task to one or more Team Members of
--    their team (child rows: parent_id = the lead's task).
--  * The Team Member sends an update (status, progress, note) to the Team
--    Lead; the Team Lead sends an update on their task to the Department
--    Head. Every update is kept in work_task_updates.
--
-- All writes go through the functions below (no direct insert/update), which
-- check the hierarchy. Reads follow the hierarchy too (RLS).
-- Additive / idempotent.
-- =============================================================================

create table if not exists public.work_tasks (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  parent_id uuid references public.work_tasks (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  description text check (length(description) <= 4000),
  priority text not null default 'MEDIUM' check (priority in ('LOW', 'MEDIUM', 'HIGH')),
  due_date date,
  assigned_by uuid not null references public.profiles (id) on delete cascade,
  assignee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'ASSIGNED' check (status in ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'NOT_COMPLETED')),
  progress integer not null default 0 check (progress between 0 and 100),
  last_update_note text check (length(last_update_note) <= 2000),
  last_update_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists work_tasks_department_idx on public.work_tasks (department_id, created_at desc);
create index if not exists work_tasks_assignee_idx on public.work_tasks (assignee_id, status);
create index if not exists work_tasks_parent_idx on public.work_tasks (parent_id);
create unique index if not exists work_tasks_one_per_member on public.work_tasks (parent_id, assignee_id) where parent_id is not null;
drop trigger if exists work_tasks_set_updated_at on public.work_tasks;
create trigger work_tasks_set_updated_at before update on public.work_tasks
  for each row execute function public.tg_set_updated_at();

create table if not exists public.work_task_updates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  status text not null check (status in ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'NOT_COMPLETED')),
  progress integer not null check (progress between 0 and 100),
  note text check (length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists work_task_updates_task_idx on public.work_task_updates (task_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Visibility: assignee, assigner, the team lead of the task's team, the
-- department head of the department, super admin.
-- ---------------------------------------------------------------------------
create or replace function private.can_view_work_task(p_task uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.work_tasks t
    where t.id = p_task and (
      t.assignee_id = private.my_id() or t.assigned_by = private.my_id()
      or private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD' and t.department_id = private.my_department_id())
      or (private.my_role() = 'TEAM_HEAD' and t.team_id = private.my_team_id())))
$$;
grant execute on function private.can_view_work_task(uuid) to authenticated;

alter table public.work_tasks enable row level security;
alter table public.work_task_updates enable row level security;
revoke all on public.work_tasks, public.work_task_updates from anon, authenticated;
grant select on public.work_tasks, public.work_task_updates to authenticated;

drop policy if exists work_tasks_select on public.work_tasks;
create policy work_tasks_select on public.work_tasks for select to authenticated
  using (
    assignee_id = (select private.my_id()) or assigned_by = (select private.my_id())
    or (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and team_id = (select private.my_team_id())));
drop policy if exists work_task_updates_select on public.work_task_updates;
create policy work_task_updates_select on public.work_task_updates for select to authenticated
  using (private.can_view_work_task(task_id));

-- ---------------------------------------------------------------------------
-- 1. Department Head → Team Lead
-- ---------------------------------------------------------------------------
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
  select * into lead from public.profiles where id = p_assignee;
  if lead.id is null or lead.role <> 'TEAM_HEAD' or lead.status <> 'ACTIVE'
     or (me.role = 'DEPARTMENT_HEAD' and lead.department_id is distinct from me.department_id) then
    raise exception 'VALIDATION_ERROR: Choose an active team lead of your department.' using errcode = 'P0001';
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

-- ---------------------------------------------------------------------------
-- 2. Team Lead → Team Member (the same task)
-- ---------------------------------------------------------------------------
create or replace function public.assign_task_to_members(p_task uuid, p_members uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.work_tasks;
  m public.profiles;
  v_id uuid;
  n integer := 0;
begin
  select * into me from public.profiles where id = private.my_id();
  select * into t from public.work_tasks where id = p_task for update;
  if t.id is null or t.assignee_id is distinct from me.id or me.role <> 'TEAM_HEAD' then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0001';
  end if;
  if t.parent_id is not null then
    raise exception 'VALIDATION_ERROR: This task is already a team member task.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_members, 1), 0) = 0 then
    raise exception 'VALIDATION_ERROR: Choose at least one team member.' using errcode = 'P0001';
  end if;

  for m in select * from public.profiles where id = any (p_members) loop
    if m.role <> 'TEAM_MEMBER' or m.status <> 'ACTIVE' or m.team_id is distinct from me.team_id then
      raise exception 'VALIDATION_ERROR: % is not an active member of your team.', m.full_name using errcode = 'P0001';
    end if;
    if exists (select 1 from public.work_tasks where parent_id = t.id and assignee_id = m.id) then
      continue;
    end if;
    insert into public.work_tasks (department_id, team_id, parent_id, title, description, priority, due_date, assigned_by, assignee_id)
    values (t.department_id, me.team_id, t.id, t.title, t.description, t.priority, t.due_date, me.id, m.id)
    returning id into v_id;
    n := n + 1;
    perform private.notify(m.id, 'TASK_ASSIGNED', format('New task: %s', t.title),
      format('Assigned by %s%s', me.full_name, case when t.due_date is null then '' else format(' · due %s', to_char(t.due_date, 'DD Mon')) end),
      'work_task', v_id);
  end loop;
  if n = 0 then
    raise exception 'CONFLICT: These team members already have this task.' using errcode = 'P0001';
  end if;

  if t.status = 'ASSIGNED' then
    update public.work_tasks set status = 'IN_PROGRESS' where id = t.id;
  end if;
  perform private.write_audit('TASK_DELEGATED', 'work_task', t.id, t.department_id, t.team_id,
    jsonb_build_object('members', p_members));
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Updates go up: member → team lead, team lead → department head.
-- ---------------------------------------------------------------------------
create or replace function public.submit_task_update(p_task uuid, p_status text, p_progress integer, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.work_tasks;
  v_progress integer := case when p_status = 'COMPLETED' then 100 else greatest(0, least(100, coalesce(p_progress, 0))) end;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 2000);
begin
  select * into me from public.profiles where id = private.my_id();
  select * into t from public.work_tasks where id = p_task for update;
  if t.id is null or t.assignee_id is distinct from me.id then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0001';
  end if;
  if p_status not in ('IN_PROGRESS', 'COMPLETED', 'NOT_COMPLETED') then
    raise exception 'VALIDATION_ERROR: Choose In progress, Completed or Not completed.' using errcode = 'P0001';
  end if;
  if p_status = 'NOT_COMPLETED' and v_note is null then
    raise exception 'VALIDATION_ERROR: Say why the task could not be completed.' using errcode = 'P0001';
  end if;

  update public.work_tasks
     set status = p_status, progress = v_progress, last_update_note = v_note, last_update_at = now(),
         completed_at = case when p_status = 'COMPLETED' then now() else null end
   where id = t.id;
  insert into public.work_task_updates (task_id, author_id, status, progress, note)
  values (t.id, me.id, p_status, v_progress, v_note);

  perform private.write_audit('TASK_UPDATED', 'work_task', t.id, t.department_id, t.team_id,
    jsonb_build_object('status', p_status, 'progress', v_progress));
  -- The update goes to whoever assigned the task (team lead, or department head).
  perform private.notify(t.assigned_by, 'TASK_UPDATE',
    format('%s: %s', me.full_name, case p_status when 'COMPLETED' then 'completed' when 'NOT_COMPLETED' then 'could not complete'
                                      else format('%s%% done', v_progress) end),
    format('%s%s', t.title, coalesce(' - ' || v_note, '')), 'work_task', t.id,
    '{}'::jsonb, case when p_status = 'NOT_COMPLETED' then 'urgent' else 'normal' end);
end $$;

revoke all on function public.assign_task_to_team_lead(uuid, text, text, text, date) from public, anon;
revoke all on function public.assign_task_to_members(uuid, uuid[]) from public, anon;
revoke all on function public.submit_task_update(uuid, text, integer, text) from public, anon;
grant execute on function public.assign_task_to_team_lead(uuid, text, text, text, date) to authenticated;
grant execute on function public.assign_task_to_members(uuid, uuid[]) to authenticated;
grant execute on function public.submit_task_update(uuid, text, integer, text) to authenticated;

do $$
begin
  begin
    alter publication supabase_realtime add table public.work_tasks;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.work_task_updates;
  exception when duplicate_object then null;
  end;
end $$;
