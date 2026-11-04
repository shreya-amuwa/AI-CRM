-- =============================================================================
-- Department Head -> Team Lead -> Team Members: what each Team Member was given out of a Team Lead's task. Run after 20261224000200.
-- Safe to run again. Reuses work_tasks (parent_id = the Team Lead's task) - no second copy of a task is made to display it.
--
-- Why: a Team Lead's delegation copied the Team Lead's task to each member (same title, same description), so the Department Head saw names and
-- statuses but not who was given which part ("Team Member 1 - follow up with 40 customers"). The share is now stored on the member's own
-- task row (work_tasks.assignment_note), written only by the Team Lead who delegates, and read through the existing row-level rules.
-- The member's task keeps the parent's title, priority and due date; progress and completion still roll up only through the Team Lead's own
-- updates, so the parent task is never completed by a member's update.
-- =============================================================================

alter table public.work_tasks add column if not exists assignment_note text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'work_tasks_assignment_note_check') then
    alter table public.work_tasks add constraint work_tasks_assignment_note_check check (assignment_note is null or length(assignment_note) <= 500);
  end if;
end $$;
create index if not exists work_tasks_parent_idx on public.work_tasks (parent_id) where parent_id is not null;

-- The Team Lead hands their task to their OWN Team Members, each with an optional share of the work:
--   p_assignments = [{ "memberId": uuid, "work": "Follow up with 40 customers" }]
-- Same rules as assign_task_to_members (only the lead's own ordinary, active members; a member who already has it is skipped, never duplicated).
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
  if t.parent_id is not null then
    raise exception 'VALIDATION_ERROR: This task is already a team member task.' using errcode = 'P0001';
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
    insert into public.work_tasks (department_id, team_id, parent_id, title, description, priority, due_date, assigned_by, assignee_id, assignment_note)
    values (t.department_id, me.team_id, t.id, t.title, t.description, t.priority, t.due_date, me.id, m.id, v_work)
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
  if t.status = 'ASSIGNED' then
    update public.work_tasks set status = 'IN_PROGRESS' where id = t.id;
  end if;
  perform private.write_audit('TASK_DELEGATED', 'work_task', t.id, t.department_id, t.team_id,
    jsonb_build_object('members', (select jsonb_agg(x ->> 'memberId') from jsonb_array_elements(p_assignments) x), 'with_shares', true));
  -- the Department Head who gave the task learns who has it now
  if t.assigned_by is not null and t.assigned_by <> me.id then
    perform private.notify(t.assigned_by, 'TASK_DELEGATED', format('%s shared out: %s', me.full_name, t.title),
      format('Now with %s team member(s).', (select count(*) from public.work_tasks c where c.parent_id = t.id)), 'work_task', t.id);
  end if;
  return n;
end $$;
revoke all on function public.delegate_task_to_members(uuid, jsonb) from public, anon;
grant execute on function public.delegate_task_to_members(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
