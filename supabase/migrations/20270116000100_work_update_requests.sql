-- =============================================================================
-- Work update requests: a Department Head or Team Lead asks the employee a task is assigned to for a progress update
-- =============================================================================
-- Adds ONLY the ability to ask for, answer and follow a work update on a task that already exists in the Task module. The task assignment flow
-- (work_tasks, work_task_updates, delegate_task_*, assign_task_*, submit_task_update, the hierarchy and its policies) is not touched: nothing here
-- edits a work_tasks row, so a work update can never change a task's status, progress or assignee.
--
-- Who may ask. Only a Department Head or Team Lead, only for a task they can ALREADY see under the Task module's own rule
-- (private.can_view_work_task: the one who gave it, everyone above it in its chain, a Department Head of the department, a Team Lead of the member),
-- and never for a task assigned to themselves. The person asked is the task's assignee, read from the database; no id or role is accepted from
-- the caller. The employee answers on their own request only; nobody else can answer it.
--
-- New structure (all linked to the existing task):
--   work_update_requests   one row per request (at most ONE open request per task: no duplicates; a reminder is a follow-up on it)
--   work_update_responses  the employee's answer (progress, work done, what remains, blockers, expected completion date)
--   work_update_events     the append-only history: requested, follow-up, responded (who, when)
-- Signed-in users have no table privileges: everything goes through the functions below (SECURITY DEFINER, search_path = '').
-- Notifications reuse the CRM's notification table (private.notify_once: never twice while unread) and open the task from the bell.
-- Safe to run twice: "if not exists", "create or replace", no data is deleted or changed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.work_update_requests (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_from uuid not null references public.profiles (id) on delete cascade,
  message text check (message is null or length(message) <= 2000),
  due_at timestamptz,
  status text not null default 'PENDING' check (status in ('PENDING', 'RESPONDED')),
  followup_count integer not null default 0 check (followup_count between 0 and 5),
  last_notified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (status <> 'RESPONDED' or responded_at is not null)
);
create unique index if not exists work_update_requests_one_open on public.work_update_requests (task_id) where status = 'PENDING';
create index if not exists work_update_requests_task_idx on public.work_update_requests (task_id, created_at desc);
create index if not exists work_update_requests_from_idx on public.work_update_requests (requested_from, status, created_at desc);
create index if not exists work_update_requests_by_idx on public.work_update_requests (requested_by, status, created_at desc);

create table if not exists public.work_update_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.work_update_requests (id) on delete cascade,
  task_id uuid not null references public.work_tasks (id) on delete cascade,
  responder_id uuid not null references public.profiles (id) on delete cascade,
  progress_summary text not null check (length(btrim(progress_summary)) between 3 and 4000),
  work_completed text check (work_completed is null or length(work_completed) <= 4000),
  remaining_work text check (remaining_work is null or length(remaining_work) <= 4000),
  blockers text check (blockers is null or length(blockers) <= 4000),
  expected_completion date,
  created_at timestamptz not null default now()
);
create index if not exists work_update_responses_task_idx on public.work_update_responses (task_id, created_at desc);

create table if not exists public.work_update_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.work_update_requests (id) on delete cascade,
  task_id uuid not null references public.work_tasks (id) on delete cascade,
  kind text not null check (kind in ('REQUESTED', 'FOLLOW_UP', 'RESPONDED')),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  note text check (note is null or length(note) <= 4000),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists work_update_events_task_idx on public.work_update_events (task_id, id);

-- nobody reads or writes these tables directly; the functions below (and the server's service role) do
alter table public.work_update_requests enable row level security;
alter table public.work_update_responses enable row level security;
alter table public.work_update_events enable row level security;
revoke all on public.work_update_requests, public.work_update_responses, public.work_update_events from public, anon, authenticated;
grant all on public.work_update_requests, public.work_update_responses, public.work_update_events to service_role;

-- the history never changes (a cascade from a deleted task is the only way a row leaves)
create or replace function private.tg_work_update_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'CONFLICT: The work update history cannot be changed.' using errcode = 'P0001';
end $$;
revoke all on function private.tg_work_update_events_append_only() from public, anon, authenticated;
drop trigger if exists work_update_events_append_only on public.work_update_events;
create trigger work_update_events_append_only before update or delete on public.work_update_events
  for each row execute function private.tg_work_update_events_append_only();

-- a response is final: nobody edits or deletes it (an employee cannot change their own, let alone another's)
create or replace function private.tg_work_update_responses_final()
returns trigger language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'CONFLICT: A submitted work update cannot be changed.' using errcode = 'P0001';
end $$;
revoke all on function private.tg_work_update_responses_final() from public, anon, authenticated;
drop trigger if exists work_update_responses_final on public.work_update_responses;
create trigger work_update_responses_final before update or delete on public.work_update_responses
  for each row execute function private.tg_work_update_responses_final();

-- ---------------------------------------------------------------------------
-- 2. Who may do what (the one place the rule lives)
-- ---------------------------------------------------------------------------
-- The signed-in person may ASK for an update on this task: a Department Head or Team Lead (active) who can already see the task under the Task
-- module's rule, who is not its assignee, whose assignee is an active person. The role and the person come from the session, never the caller.
create or replace function private.work_update_is_manager(p_task uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.work_tasks t
      join public.profiles me on me.id = auth.uid() and me.status = 'ACTIVE' and me.role in ('DEPARTMENT_HEAD', 'TEAM_HEAD')
      join public.profiles a on a.id = t.assignee_id and a.status = 'ACTIVE'
     where t.id = p_task and t.assignee_id <> me.id and private.can_view_work_task(t.id))
$$;
revoke all on function private.work_update_is_manager(uuid) from public, anon, authenticated;

-- may READ the requests and updates of this task: the one it is assigned to, whoever may ask about it, and the Super Admin (read only)
create or replace function private.work_update_can_see(p_task uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.work_tasks t where t.id = p_task and t.assignee_id = auth.uid())
      or private.work_update_is_manager(p_task)
      or exists (select 1 from public.profiles me where me.id = auth.uid() and me.status = 'ACTIVE' and me.role = 'SUPER_ADMIN')
$$;
revoke all on function private.work_update_can_see(uuid) from public, anon, authenticated;

create or replace function private.work_update_me()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  return me;
end $$;
revoke all on function private.work_update_me() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. JSON the screens read
-- ---------------------------------------------------------------------------
create or replace function private.work_update_json(r public.work_update_requests)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'taskId', r.task_id, 'taskTitle', t.title, 'taskDescription', t.description, 'taskStatus', t.status, 'taskProgress', t.progress,
    'taskDueDate', t.due_date, 'priority', t.priority,
    'requestedBy', r.requested_by, 'requestedByName', rb.full_name, 'requestedFrom', r.requested_from, 'requestedFromName', rf.full_name,
    'employeeRole', rf.role, 'message', r.message, 'dueAt', r.due_at, 'status', r.status,
    'overdue', r.status = 'PENDING' and r.due_at is not null and r.due_at < now(),
    'followupCount', r.followup_count, 'lastNotifiedAt', r.last_notified_at, 'createdAt', r.created_at, 'respondedAt', r.responded_at,
    -- what the viewer may do with it (the database decides again when they do it)
    'canRespond', r.status = 'PENDING' and r.requested_from = auth.uid() and t.assignee_id = auth.uid(),
    'canFollowUp', r.status = 'PENDING' and r.followup_count < 5 and r.last_notified_at <= now() - interval '1 hour' and private.work_update_is_manager(t.id),
    'followUpAvailableAt', case when r.status = 'PENDING' and r.followup_count < 5 then r.last_notified_at + interval '1 hour' end,
    'response', (select jsonb_build_object('id', x.id, 'progress', x.progress_summary, 'workCompleted', x.work_completed, 'remainingWork', x.remaining_work,
                   'blockers', x.blockers, 'expectedCompletion', x.expected_completion, 'submittedAt', x.created_at)
                   from public.work_update_responses x where x.request_id = r.id))
    from public.work_tasks t
    left join public.profiles rb on rb.id = r.requested_by
    join public.profiles rf on rf.id = r.requested_from
   where t.id = r.task_id
$$;
revoke all on function private.work_update_json(public.work_update_requests) from public, anon, authenticated;

create or replace function private.work_update_event(p_request uuid, p_task uuid, p_kind text, p_note text, p_data jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.work_update_events (request_id, task_id, kind, actor_id, actor_name, note, data)
  values (p_request, p_task, p_kind, auth.uid(), (select full_name from public.profiles where id = auth.uid()), p_note, coalesce(p_data, '{}'::jsonb))
$$;
revoke all on function private.work_update_event(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Ask for an update (Department Head / Team Lead)
-- ---------------------------------------------------------------------------
create or replace function public.work_update_request(p_task uuid, p_message text default null, p_due timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.work_update_me();
  t public.work_tasks;
  a public.profiles;
  r public.work_update_requests;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  select * into t from public.work_tasks where id = p_task for update;      -- the lock serialises two people asking at once
  if t.id is null then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0002';
  end if;
  if not private.work_update_is_manager(t.id) then
    raise exception 'FORBIDDEN: You can only request an update on a task of your own reporting hierarchy, from the person it is assigned to.' using errcode = '42501';
  end if;
  if t.status = 'COMPLETED' then
    raise exception 'VALIDATION_ERROR: This task is already completed.' using errcode = '22023';
  end if;
  if v_msg is not null and length(v_msg) > 2000 then
    raise exception 'VALIDATION_ERROR: The message can have at most 2000 characters.' using errcode = '22023';
  end if;
  if p_due is not null and (p_due < now() or p_due > now() + interval '90 days') then
    raise exception 'VALIDATION_ERROR: Give a response deadline in the future (within 90 days).' using errcode = '22023';
  end if;
  select * into a from public.profiles where id = t.assignee_id;
  if exists (select 1 from public.work_update_requests x where x.task_id = t.id and x.status = 'PENDING') then
    raise exception 'CONFLICT: An update was already requested from % and is waiting. Send a reminder instead.', a.full_name using errcode = 'P0001';
  end if;

  insert into public.work_update_requests (task_id, requested_by, requested_from, message, due_at)
  values (t.id, me.id, a.id, v_msg, p_due)
  returning * into r;
  perform private.work_update_event(r.id, t.id, 'REQUESTED', v_msg, jsonb_build_object('requestedFrom', a.id, 'dueAt', p_due));
  perform private.notify_once(a.id, 'WORK_UPDATE_REQUESTED', 'Work update requested: ' || left(t.title, 150),
    'From ' || me.full_name || case when p_due is null then '' else ' · reply by ' || to_char(p_due at time zone 'Asia/Kolkata', 'DD Mon HH24:MI') end
      || coalesce(' — ' || left(v_msg, 300), ''),
    'work_task', t.id, jsonb_build_object('taskId', t.id, 'requestId', r.id), 'normal');
  perform private.write_audit('WORK_UPDATE_REQUESTED', 'work_task', t.id, t.department_id, t.team_id,
    jsonb_build_object('requestId', r.id, 'from', a.id, 'dueAt', p_due));
  return private.work_update_json(r);
end $$;

-- ---------------------------------------------------------------------------
-- 5. A reminder on the open request (no second request, at most every hour, at most five)
-- ---------------------------------------------------------------------------
create or replace function public.work_update_follow_up(p_request uuid, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.work_update_me();
  r public.work_update_requests;
  t public.work_tasks;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  select * into r from public.work_update_requests where id = p_request for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Update request not found.' using errcode = 'P0002';
  end if;
  select * into t from public.work_tasks where id = r.task_id;
  if not private.work_update_is_manager(r.task_id) then
    raise exception 'FORBIDDEN: Only the person who may request updates on this task can send a reminder.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'CONFLICT: This update was already submitted.' using errcode = 'P0001';
  end if;
  if r.followup_count >= 5 then
    raise exception 'CONFLICT: Five reminders were already sent. Talk to the employee directly.' using errcode = 'P0001';
  end if;
  if r.last_notified_at > now() - interval '1 hour' then
    raise exception 'CONFLICT: A reminder was sent less than an hour ago. Please wait before sending another.' using errcode = 'P0001';
  end if;
  if v_msg is not null and length(v_msg) > 2000 then
    raise exception 'VALIDATION_ERROR: The message can have at most 2000 characters.' using errcode = '22023';
  end if;
  update public.work_update_requests set followup_count = followup_count + 1, last_notified_at = now() where id = r.id returning * into r;
  perform private.work_update_event(r.id, t.id, 'FOLLOW_UP', v_msg, jsonb_build_object('number', r.followup_count));
  perform private.notify_once(r.requested_from, 'WORK_UPDATE_FOLLOW_UP', format('Reminder %s: work update requested: %s', r.followup_count, left(t.title, 140)),
    'From ' || me.full_name || coalesce(' — ' || left(v_msg, 300), ''), 'work_task', t.id,
    jsonb_build_object('taskId', t.id, 'requestId', r.id), 'urgent');
  perform private.write_audit('WORK_UPDATE_FOLLOW_UP', 'work_task', t.id, t.department_id, t.team_id,
    jsonb_build_object('requestId', r.id, 'number', r.followup_count));
  return private.work_update_json(r);
end $$;

-- ---------------------------------------------------------------------------
-- 6. The employee answers (only their own request; the task is NOT changed)
-- ---------------------------------------------------------------------------
create or replace function public.work_update_respond(p_request uuid, p_progress text, p_completed text default null, p_remaining text default null,
  p_blockers text default null, p_expected date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.work_update_me();
  r public.work_update_requests;
  t public.work_tasks;
  v_progress text := nullif(btrim(coalesce(p_progress, '')), '');
  v_done text := nullif(btrim(coalesce(p_completed, '')), '');
  v_left text := nullif(btrim(coalesce(p_remaining, '')), '');
  v_block text := nullif(btrim(coalesce(p_blockers, '')), '');
  v_to uuid;
  v_n integer := 0;
begin
  select * into r from public.work_update_requests where id = p_request for update;
  -- the request must be addressed to the signed-in person, and the task must still be theirs: anything else is the same answer
  if r.id is null or r.requested_from <> me.id then
    raise exception 'FORBIDDEN: You can only answer an update request that was sent to you.' using errcode = '42501';
  end if;
  select * into t from public.work_tasks where id = r.task_id;
  if t.assignee_id is distinct from me.id then
    raise exception 'FORBIDDEN: This task is no longer assigned to you.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'CONFLICT: You already sent this update.' using errcode = 'P0001';
  end if;
  if v_progress is null or length(v_progress) < 3 then
    raise exception 'VALIDATION_ERROR: Describe the current progress (at least 3 characters).' using errcode = '22023';
  end if;
  if length(v_progress) > 4000 or length(coalesce(v_done, '')) > 4000 or length(coalesce(v_left, '')) > 4000 or length(coalesce(v_block, '')) > 4000 then
    raise exception 'VALIDATION_ERROR: Each answer can have at most 4000 characters.' using errcode = '22023';
  end if;
  if p_expected is not null and (p_expected < current_date or p_expected > current_date + 730) then
    raise exception 'VALIDATION_ERROR: Give an expected completion date from today to two years ahead.' using errcode = '22023';
  end if;

  insert into public.work_update_responses (request_id, task_id, responder_id, progress_summary, work_completed, remaining_work, blockers, expected_completion)
  values (r.id, t.id, me.id, v_progress, v_done, v_left, v_block, p_expected);
  update public.work_update_requests set status = 'RESPONDED', responded_at = now() where id = r.id returning * into r;
  perform private.work_update_event(r.id, t.id, 'RESPONDED', v_progress,
    jsonb_build_object('blockers', v_block, 'expectedCompletion', p_expected, 'taskStatus', t.status));
  -- tell everyone who asked (the requester and whoever sent a reminder), once each
  for v_to in select distinct x from (select r.requested_by as x
                                       union select e.actor_id from public.work_update_events e where e.request_id = r.id and e.kind = 'FOLLOW_UP') s
              where x is not null and x <> me.id loop
    perform private.notify_once(v_to, 'WORK_UPDATE_SUBMITTED', left(me.full_name, 40) || ' sent a work update: ' || left(t.title, 130),
      left(v_progress, 300) || case when v_block is null then '' else ' · Blockers: ' || left(v_block, 200) end, 'work_task', t.id,
      jsonb_build_object('taskId', t.id, 'requestId', r.id), case when v_block is null then 'normal' else 'urgent' end);
    v_n := v_n + 1;
  end loop;
  perform private.write_audit('WORK_UPDATE_SUBMITTED', 'work_task', t.id, t.department_id, t.team_id, jsonb_build_object('requestId', r.id));
  return private.work_update_json(r);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Lists
-- ---------------------------------------------------------------------------
-- The employee: requests sent to me (waiting first) and the updates I already sent
create or replace function public.work_update_my_requests(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.work_update_me();
  v_status text := upper(nullif(btrim(coalesce(p_status, '')), ''));
  r public.work_update_requests;
  v_items jsonb := '[]'::jsonb;
begin
  if v_status is not null and v_status not in ('PENDING', 'RESPONDED') then
    raise exception 'VALIDATION_ERROR: Choose PENDING or RESPONDED.' using errcode = '22023';
  end if;
  for r in select * from public.work_update_requests x where x.requested_from = me.id and (v_status is null or x.status = v_status)
            order by (x.status = 'PENDING') desc, x.created_at desc limit 100 loop
    v_items := v_items || jsonb_build_array(private.work_update_json(r));
  end loop;
  return jsonb_build_object(
    'pending', (select count(*) from public.work_update_requests x where x.requested_from = me.id and x.status = 'PENDING'),
    'responded', (select count(*) from public.work_update_requests x where x.requested_from = me.id and x.status = 'RESPONDED'),
    'items', v_items);
end $$;

-- The Department Head / Team Lead (and, read only, the Super Admin): the requests on the tasks they may ask about.
-- Filters: ALL, PENDING, RESPONDED, OVERDUE (waiting past the response deadline).
create or replace function public.work_update_list(p_filter text default 'ALL', p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.work_update_me();
  v_f text := upper(coalesce(nullif(btrim(p_filter), ''), 'ALL'));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_sa boolean := me.role = 'SUPER_ADMIN';
  v_counts jsonb;
  v_items jsonb := '[]'::jsonb;
  r public.work_update_requests;
begin
  if v_f not in ('ALL', 'PENDING', 'RESPONDED', 'OVERDUE') then
    raise exception 'VALIDATION_ERROR: Choose ALL, PENDING, RESPONDED or OVERDUE.' using errcode = '22023';
  end if;
  if not v_sa and me.role not in ('DEPARTMENT_HEAD', 'TEAM_HEAD') then
    return jsonb_build_object('filter', v_f, 'counts', jsonb_build_object('all', 0, 'pending', 0, 'responded', 0, 'overdue', 0), 'items', '[]'::jsonb);
  end if;
  select jsonb_build_object(
           'all', count(*), 'pending', count(*) filter (where x.status = 'PENDING'), 'responded', count(*) filter (where x.status = 'RESPONDED'),
           'overdue', count(*) filter (where x.status = 'PENDING' and x.due_at is not null and x.due_at < now()))
    into v_counts
    from public.work_update_requests x where v_sa or private.work_update_is_manager(x.task_id);
  for r in select x.* from public.work_update_requests x
            where (v_sa or private.work_update_is_manager(x.task_id))
              and case v_f when 'PENDING' then x.status = 'PENDING' when 'RESPONDED' then x.status = 'RESPONDED'
                           when 'OVERDUE' then x.status = 'PENDING' and x.due_at is not null and x.due_at < now() else true end
            order by x.created_at desc limit v_limit offset v_offset loop
    v_items := v_items || jsonb_build_array(private.work_update_json(r));
  end loop;
  return jsonb_build_object('filter', v_f, 'counts', v_counts, 'items', v_items, 'limit', v_limit, 'offset', v_offset);
end $$;

-- One task: may I ask about it, the requests and answers on it, and its timeline (the existing history plus the work update events)
create or replace function public.work_update_for_task(p_task uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.work_update_me();
  t public.work_tasks;
  r public.work_update_requests;
  v_requests jsonb := '[]'::jsonb;
begin
  select * into t from public.work_tasks where id = p_task;
  if t.id is null or not private.work_update_can_see(t.id) then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0002';
  end if;
  for r in select * from public.work_update_requests x where x.task_id = t.id order by x.created_at desc loop
    v_requests := v_requests || jsonb_build_array(private.work_update_json(r));
  end loop;
  return jsonb_build_object(
    'taskId', t.id, 'taskTitle', t.title, 'taskStatus', t.status,
    'canRequest', t.status <> 'COMPLETED' and private.work_update_is_manager(t.id)
                  and not exists (select 1 from public.work_update_requests x where x.task_id = t.id and x.status = 'PENDING'),
    'canManage', private.work_update_is_manager(t.id),
    'requests', v_requests,
    'timeline', (select coalesce(jsonb_agg(e order by (e ->> 'at')::timestamptz, e ->> 'seq'), '[]'::jsonb) from (
        select jsonb_build_object('kind', 'TASK_ASSIGNED', 'at', t.created_at, 'seq', '0', 'actorName', (select full_name from public.profiles where id = t.assigned_by),
                 'note', null, 'data', jsonb_build_object('assignee', (select full_name from public.profiles where id = t.assignee_id))) as e
        union all
        select jsonb_build_object('kind', 'TASK_UPDATE', 'at', u.created_at, 'seq', '1' || u.id::text, 'actorName', (select full_name from public.profiles where id = u.author_id),
                 'note', u.note, 'data', jsonb_build_object('status', u.status, 'progress', u.progress))
          from public.work_task_updates u where u.task_id = t.id
        union all
        select jsonb_build_object('kind', 'WORK_UPDATE_' || x.kind, 'at', x.created_at, 'seq', '2' || lpad(x.id::text, 12, '0'), 'actorName', x.actor_name,
                 'note', x.note, 'data', x.data || jsonb_build_object('requestId', x.request_id))
          from public.work_update_events x where x.task_id = t.id) s));
end $$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.work_update_request(uuid, text, timestamptz)', 'public.work_update_follow_up(uuid, text)',
    'public.work_update_respond(uuid, text, text, text, text, date)', 'public.work_update_my_requests(text)',
    'public.work_update_list(text, integer, integer)', 'public.work_update_for_task(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
