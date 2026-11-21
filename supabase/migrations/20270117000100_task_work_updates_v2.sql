-- =============================================================================
-- Task management v2: structured work updates, the Urgent priority, and a task details function
-- =============================================================================
-- Improves the existing Task module (work_tasks, work_task_updates, the hierarchy, the work update requests of 20270116000100). Nothing is
-- replaced and the assignment flow is unchanged: who may assign to whom, who sees which task and every existing function work as before.
--
--  1. Priority Urgent: the work_tasks check and the four assignment functions that validate the priority accept it (their bodies are the live
--     definitions with one word added; nothing else in them changes).
--  2. Structured work updates: every update an employee submits is one row of work_task_updates (the history; never overwritten) and now keeps
--     what was completed, what remains, blockers, next steps and the expected completion date, and which update request it answers.
--     submit_work_update() is the new employee action; the old submit_task_update() still works for older screens.
--  3. History is protected: a signed-in user cannot edit or delete an update row (only inserts through the functions).
--  4. work_task_details(): one task's overview, progress history, update requests and activity timeline, readable by exactly the people who may
--     already read the task (private.can_view_work_task).
-- Safe to run twice. No existing task, update or request is changed or deleted.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Priority: Low, Medium, High, Urgent
-- ---------------------------------------------------------------------------
alter table public.work_tasks drop constraint if exists work_tasks_priority_check;
alter table public.work_tasks add constraint work_tasks_priority_check check (priority in ('LOW', 'MEDIUM', 'HIGH', 'URGENT'));

-- The assignment functions validate the priority against a fixed list. Their current definitions are re-created with 'URGENT' added to that list
-- and nothing else changed (so this follows whatever the live definition is, and does nothing the second time).
do $$
declare
  f record;
  v_def text;
  n integer := 0;
begin
  for f in select p.oid, p.oid::regprocedure as sig
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.prokind = 'f'
              and p.proname in ('assign_task_to_team_lead', 'assign_team_task', 'assign_task_to_department_head', 'assign_task_direct') loop
    v_def := pg_get_functiondef(f.oid);
    if v_def like '%''LOW'', ''MEDIUM'', ''HIGH'')%' and v_def not like '%''URGENT''%' then
      execute replace(v_def, '''LOW'', ''MEDIUM'', ''HIGH'')', '''LOW'', ''MEDIUM'', ''HIGH'', ''URGENT'')');
      n := n + 1;
    end if;
  end loop;
  raise notice 'task priority: % assignment function(s) now accept Urgent', n;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Each update keeps its details
-- ---------------------------------------------------------------------------
alter table public.work_task_updates add column if not exists work_completed text;
alter table public.work_task_updates add column if not exists remaining_work text;
alter table public.work_task_updates add column if not exists blockers text;
alter table public.work_task_updates add column if not exists next_steps text;
alter table public.work_task_updates add column if not exists expected_completion date;
alter table public.work_task_updates add column if not exists request_id uuid references public.work_update_requests (id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'work_task_updates_details_len') then
    alter table public.work_task_updates add constraint work_task_updates_details_len check (
      length(coalesce(work_completed, '')) <= 4000 and length(coalesce(remaining_work, '')) <= 4000
      and length(coalesce(blockers, '')) <= 4000 and length(coalesce(next_steps, '')) <= 4000);
  end if;
end $$;
create index if not exists work_task_updates_request_idx on public.work_task_updates (request_id) where request_id is not null;

-- ---------------------------------------------------------------------------
-- 3. The history cannot be edited or deleted by a signed-in user
-- ---------------------------------------------------------------------------
-- Signed-in users have no write privileges on the table already; this also stops a function that forgets to check. A task being deleted still removes
-- its updates (cascade), and the server's service role (no signed-in user) keeps its maintenance access.
create or replace function private.tg_work_task_updates_protect()
returns trigger language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 or auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'CONFLICT: A task update cannot be changed or deleted.' using errcode = 'P0001';
end $$;
revoke all on function private.tg_work_task_updates_protect() from public, anon, authenticated;
drop trigger if exists work_task_updates_protect on public.work_task_updates;
create trigger work_task_updates_protect before update or delete on public.work_task_updates
  for each row execute function private.tg_work_task_updates_protect();

-- ---------------------------------------------------------------------------
-- 4. Submit a work update (the assignee, on their own task)
-- ---------------------------------------------------------------------------
-- A real update: the status, the progress percentage and what was done (or, when blocked, what blocks). It is added to the history; the task shows
-- the latest. The task is only 100% when the employee submits Completed at 100: a status change alone never sets the progress. When it answers an
-- update request (p_request) the request is marked answered. Notifies whoever gave the task, whoever asked, and above them when blocked / completed.
create or replace function public.submit_work_update(
  p_task uuid, p_status text, p_progress integer, p_completed text default null, p_remaining text default null, p_blockers text default null,
  p_next text default null, p_expected date default null, p_request uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.work_update_me();
  t public.work_tasks;
  r public.work_update_requests;
  u public.work_task_updates;
  v_done text := nullif(btrim(coalesce(p_completed, '')), '');
  v_left text := nullif(btrim(coalesce(p_remaining, '')), '');
  v_block text := nullif(btrim(coalesce(p_blockers, '')), '');
  v_next text := nullif(btrim(coalesce(p_next, '')), '');
  v_note text;
  v_to uuid;
  v_type text;
  v_title text;
  v_parent_by uuid;
  v_prev public.work_task_updates;
begin
  select * into t from public.work_tasks where id = p_task for update;
  if t.id is null then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0002';
  end if;
  if t.assignee_id is distinct from me.id then
    raise exception 'FORBIDDEN: You can only submit a work update on a task assigned to you.' using errcode = '42501';
  end if;
  if t.status = 'COMPLETED' then
    raise exception 'CONFLICT: This task is already completed.' using errcode = 'P0001';
  end if;
  if p_status not in ('IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'NOT_COMPLETED') then
    raise exception 'VALIDATION_ERROR: Choose In progress, Blocked, Completed or Not completed.' using errcode = '22023';
  end if;
  if p_progress is null or p_progress < 0 or p_progress > 100 then
    raise exception 'VALIDATION_ERROR: Give the progress as a percentage from 0 to 100.' using errcode = '22023';
  end if;
  if p_status = 'COMPLETED' and p_progress <> 100 then
    raise exception 'VALIDATION_ERROR: A completed task is 100%%. Submit your final update at 100%%.' using errcode = '22023';
  end if;
  if p_status <> 'COMPLETED' and p_progress = 100 then
    raise exception 'VALIDATION_ERROR: Choose Completed when the work is 100%% done.' using errcode = '22023';
  end if;
  -- a meaningful update: what was done; or, when blocked / not completed, what is in the way
  if p_status in ('BLOCKED', 'NOT_COMPLETED') then
    if v_block is null or length(v_block) < 10 then
      raise exception 'VALIDATION_ERROR: %', case p_status when 'BLOCKED' then 'Explain what is blocking the task (at least 10 characters).'
        else 'Explain why the task could not be completed (at least 10 characters).' end using errcode = '22023';
    end if;
  elsif v_done is null or length(v_done) < 10 then
    raise exception 'VALIDATION_ERROR: Describe the work completed since your last update (at least 10 characters).' using errcode = '22023';
  end if;
  if length(coalesce(v_done, '')) > 4000 or length(coalesce(v_left, '')) > 4000 or length(coalesce(v_block, '')) > 4000 or length(coalesce(v_next, '')) > 4000 then
    raise exception 'VALIDATION_ERROR: Each answer can have at most 4000 characters.' using errcode = '22023';
  end if;
  if p_expected is not null and (p_expected < current_date or p_expected > current_date + 730) then
    raise exception 'VALIDATION_ERROR: Give an expected completion date from today to two years ahead.' using errcode = '22023';
  end if;
  -- the same update twice is not progress
  select * into v_prev from public.work_task_updates where task_id = t.id order by created_at desc, id desc limit 1;
  if v_prev.id is not null and v_prev.status = p_status and v_prev.progress = p_progress
     and coalesce(v_prev.work_completed, '') = coalesce(v_done, '') and coalesce(v_prev.blockers, '') = coalesce(v_block, '') then
    raise exception 'CONFLICT: This is the same as your last update. Say what changed since then.' using errcode = 'P0001';
  end if;
  if p_request is not null then
    select * into r from public.work_update_requests where id = p_request for update;
    if r.id is null or r.requested_from <> me.id or r.task_id <> t.id then
      raise exception 'FORBIDDEN: That update request was not sent to you for this task.' using errcode = '42501';
    end if;
    if r.status <> 'PENDING' then
      raise exception 'CONFLICT: You already answered this update request.' using errcode = 'P0001';
    end if;
  end if;

  v_note := left(coalesce(v_done, v_block), 2000);
  update public.work_tasks
     set status = p_status, progress = p_progress, last_update_note = v_note, last_update_at = now(),
         completed_at = case when p_status = 'COMPLETED' then now() else null end
   where id = t.id returning * into t;
  insert into public.work_task_updates (task_id, author_id, status, progress, note, work_completed, remaining_work, blockers, next_steps, expected_completion, request_id)
  values (t.id, me.id, p_status, p_progress, v_note, v_done, v_left, v_block, v_next, p_expected, r.id)
  returning * into u;

  if r.id is not null then
    insert into public.work_update_responses (request_id, task_id, responder_id, progress_summary, work_completed, remaining_work, blockers, expected_completion)
    values (r.id, t.id, me.id, left(format('%s%% (%s): %s', p_progress, lower(replace(p_status, '_', ' ')), coalesce(v_done, v_block)), 4000), v_done, v_left, v_block, p_expected);
    update public.work_update_requests set status = 'RESPONDED', responded_at = now() where id = r.id returning * into r;
    perform private.work_update_event(r.id, t.id, 'RESPONDED', coalesce(v_done, v_block),
      jsonb_build_object('blockers', v_block, 'expectedCompletion', p_expected, 'progress', p_progress, 'status', p_status));
  end if;

  perform private.write_audit('TASK_UPDATED', 'work_task', t.id, t.department_id, t.team_id,
    jsonb_build_object('status', p_status, 'progress', p_progress, 'updateId', u.id, 'requestId', r.id));

  -- who hears: whoever gave the task and whoever asked (a reminder too); for blocked / completed also whoever gave the task above them
  v_title := left(t.title, 120);
  v_type := case p_status when 'BLOCKED' then 'TASK_BLOCKED' when 'COMPLETED' then 'TASK_COMPLETED' when 'NOT_COMPLETED' then 'TASK_NOT_COMPLETED' else 'WORK_UPDATE_SUBMITTED' end;
  if p_status in ('BLOCKED', 'COMPLETED', 'NOT_COMPLETED') and t.parent_id is not null then
    select p.assigned_by into v_parent_by from public.work_tasks p where p.id = t.parent_id;
  end if;
  for v_to in select distinct x from (
                select t.assigned_by as x
                union select r.requested_by where r.id is not null
                union select e.actor_id from public.work_update_events e where r.id is not null and e.request_id = r.id and e.kind = 'FOLLOW_UP'
                union select v_parent_by where v_parent_by is not null) s
              where x is not null and x <> me.id loop
    perform private.notify_once(v_to, v_type,
      left(me.full_name, 40) || case p_status when 'BLOCKED' then ' is blocked: ' when 'COMPLETED' then ' completed: ' when 'NOT_COMPLETED' then ' could not complete: '
                                              else format(' updated (%s%%): ', p_progress) end || v_title,
      left(coalesce(v_done, v_block), 300) || case when p_status <> 'BLOCKED' and v_block is not null then ' · Blockers: ' || left(v_block, 200) else '' end,
      'work_task', t.id, jsonb_build_object('taskId', t.id, 'requestId', r.id, 'updateId', u.id),
      case when p_status in ('BLOCKED', 'NOT_COMPLETED') or v_block is not null then 'urgent' else 'normal' end);
  end loop;

  return jsonb_build_object('id', u.id, 'taskId', t.id, 'status', t.status, 'progress', t.progress, 'at', u.created_at, 'requestId', r.id);
end $$;

-- ---------------------------------------------------------------------------
-- 5. One task, in full (overview, progress history, update requests, timeline)
-- ---------------------------------------------------------------------------
create or replace function public.work_task_details(p_task uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.work_update_me();
  t public.work_tasks;
  v_requests jsonb := '[]'::jsonb;
  r public.work_update_requests;
  v_see boolean;
begin
  select * into t from public.work_tasks where id = p_task;
  -- exactly the people who may read the task today (the Task module's own rule); everyone else gets "not found"
  if t.id is null or not private.can_view_work_task(t.id) then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0002';
  end if;
  v_see := private.work_update_can_see(t.id);
  if v_see then
    for r in select * from public.work_update_requests x where x.task_id = t.id order by x.created_at desc loop
      v_requests := v_requests || jsonb_build_array(private.work_update_json(r));
    end loop;
  end if;
  return jsonb_build_object(
    'task', jsonb_build_object(
      'id', t.id, 'parentId', t.parent_id, 'title', t.title, 'description', t.description, 'priority', t.priority, 'status', t.status, 'progress', t.progress,
      'dueDate', t.due_date, 'createdAt', t.created_at, 'completedAt', t.completed_at, 'lastUpdateAt', t.last_update_at, 'lastUpdateNote', t.last_update_note,
      'assignmentNote', t.assignment_note, 'handling', t.handling,
      'overdue', t.due_date is not null and t.status <> 'COMPLETED' and t.due_date < private.hr_today(), 'blocked', t.status = 'BLOCKED',
      'assignee', (select jsonb_build_object('id', a.id, 'name', a.full_name, 'role', a.role, 'designation', private.employee_snapshot(a.id) ->> 'designation',
                          'team', (select tm.name from public.teams tm where tm.id = a.team_id), 'department', (select d.name from public.departments d where d.id = a.department_id))
                     from public.profiles a where a.id = t.assignee_id),
      'assignedBy', (select jsonb_build_object('id', b.id, 'name', b.full_name, 'designation', private.employee_snapshot(b.id) ->> 'designation')
                       from public.profiles b where b.id = t.assigned_by),
      'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'code', c.customer_code) from public.customers c where c.id = t.customer_id)),
    'updates', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', u.id, 'at', u.created_at, 'authorId', u.author_id, 'authorName', (select full_name from public.profiles where id = u.author_id),
                  'status', u.status, 'progress', u.progress, 'workCompleted', u.work_completed, 'remainingWork', u.remaining_work, 'blockers', u.blockers,
                  'nextSteps', u.next_steps, 'expectedCompletion', u.expected_completion, 'note', u.note, 'requestId', u.request_id) order by u.created_at desc, u.id desc)
                  from (select * from public.work_task_updates x where x.task_id = t.id order by x.created_at desc, x.id desc limit 200) u), '[]'::jsonb),
    'requests', v_requests,
    'canUpdate', t.assignee_id = me.id and t.status <> 'COMPLETED',
    'canRequest', t.status <> 'COMPLETED' and private.work_update_is_manager(t.id)
                  and not exists (select 1 from public.work_update_requests x where x.task_id = t.id and x.status = 'PENDING'),
    'canManage', private.work_update_is_manager(t.id),
    'timeline', (select coalesce(jsonb_agg(e order by (e ->> 'at')::timestamptz, e ->> 'seq'), '[]'::jsonb) from (
        select jsonb_build_object('kind', 'TASK_CREATED', 'at', t.created_at, 'seq', '0a', 'actorName', (select full_name from public.profiles where id = t.assigned_by), 'note', null, 'data', '{}'::jsonb) as e
        union all
        select jsonb_build_object('kind', 'TASK_ASSIGNED', 'at', t.created_at, 'seq', '0b', 'actorName', (select full_name from public.profiles where id = t.assigned_by), 'note', null,
                 'data', jsonb_build_object('assignee', (select full_name from public.profiles where id = t.assignee_id)))
        union all
        select jsonb_build_object('kind', 'PROGRESS_UPDATE', 'at', u.created_at, 'seq', '1' || lpad(extract(epoch from u.created_at)::bigint::text, 12, '0') || u.id::text,
                 'actorName', (select full_name from public.profiles where id = u.author_id), 'note', coalesce(u.work_completed, u.blockers, u.note),
                 'data', jsonb_build_object('status', u.status, 'progress', u.progress, 'requestId', u.request_id,
                   'statusChangedFrom', (select p2.status from public.work_task_updates p2 where p2.task_id = u.task_id and (p2.created_at, p2.id) < (u.created_at, u.id)
                                          order by p2.created_at desc, p2.id desc limit 1)))
          from public.work_task_updates u where u.task_id = t.id
        union all
        select jsonb_build_object('kind', 'WORK_UPDATE_' || x.kind, 'at', x.created_at, 'seq', '2' || lpad(x.id::text, 12, '0'), 'actorName', x.actor_name, 'note', x.note,
                 'data', x.data || jsonb_build_object('requestId', x.request_id))
          from public.work_update_events x where v_see and x.task_id = t.id) s));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['public.submit_work_update(uuid, text, integer, text, text, text, text, date, uuid)', 'public.work_task_details(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
